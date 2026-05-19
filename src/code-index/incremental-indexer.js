const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { RESULT_LIMITS, WORKER_POOL } = require('../../constants');
const { hashContent } = require('../../utils');
const { createCodeIndexRepository } = require('./repos');
const { scanRepository } = require('./scanner');
const { createParserRegistry, getLanguageForFile } = require('./parser-registry');
const { extractSymbolsFromFile } = require('./symbol-extractor');
const { buildImportEdges, buildImportEdgesForFiles, buildCallEdges, buildCallEdgesForFiles, buildComplexityMetrics, buildComplexityMetricsForFiles } = require('./edge-extractor');
const { createParsePool } = require('./worker-pool');

function emitProgress(args, phase, detail, stats) {
  if (!args || !args.progress) {
    return;
  }
  const payload = { progress: true, phase, ...detail };
  if (stats) {
    payload.files_total = stats.files_total;
    payload.files_done = stats.files_done;
    payload.symbols = stats.symbols;
  }
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

function progressPath(filePath, repoRoot) {
  if (!repoRoot) {
    return filePath;
  }
  const relative = path.relative(repoRoot, filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}

function shouldEmitFileProgress(done, total) {
  if (done <= 5 || done === total) {
    return true;
  }
  if (total <= 100) {
    return done % 10 === 0;
  }
  return done % 25 === 0;
}

function getHeadCommit(repoPath) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function getGitDelta(repoPath, baseCommit) {
  if (!baseCommit) {
    return null;
  }
  const currentHead = getHeadCommit(repoPath);
  if (!currentHead || currentHead === baseCommit) {
    return null;
  }
  try {
    const output = execFileSync('git', ['diff', '--name-status', `${baseCommit}..HEAD`], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const changed = new Set();
    const deleted = new Set();
    const renamed = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const parts = trimmed.split('\t');
      const status = parts[0];
      if (status.startsWith('D') && parts[1]) {
        deleted.add(path.resolve(repoPath, parts[1]));
      } else if (status.startsWith('R') && parts[1] && parts[2]) {
        deleted.add(path.resolve(repoPath, parts[1]));
        changed.add(path.resolve(repoPath, parts[2]));
        renamed.push({ from: parts[1], to: parts[2], status });
      } else if (parts[1]) {
        changed.add(path.resolve(repoPath, parts[1]));
      }
    }
    return { currentHead, changed: [...changed], deleted: [...deleted], renamed };
  } catch {
    return null;
  }
}

async function readFileRecord(filePath) {
  const [content, stats] = await Promise.all([fs.promises.readFile(filePath, 'utf-8'), fs.promises.stat(filePath)]);
  return { filePath, content, stats };
}

function fileRecordToParams(repoId, record) {
  const lines = record.content.split('\n');
  return {
    repoId,
    path: record.filePath,
    language: getLanguageForFile(record.filePath) || path.extname(record.filePath).slice(1),
    content: record.content,
    contentHash: hashContent(record.content),
    mtime: record.stats.mtimeMs,
    sizeBytes: record.stats.size,
    lineCount: lines.length,
  };
}

function recordDiagnostic(repository, repoId, record, status, message, symbolCount = 0) {
  if (typeof repository.upsertFileDiagnostic !== 'function') {
    return;
  }
  repository.upsertFileDiagnostic({
    repoId,
    filePath: record.filePath,
    status,
    message,
    symbolCount,
    contentHash: record.content ? hashContent(record.content) : null,
  });
}

function insertSymbols(repository, repoId, fileId, filePath, symbols) {
  let count = 0;
  for (const sym of symbols) {
    repository.insertSymbol({
      repoId,
      fileId,
      filePath,
      name: sym.name,
      kind: sym.kind,
      signature: sym.signature,
      qualifiedName: sym.qualified_name,
      startLine: sym.start_line,
      endLine: sym.end_line,
      startByte: sym.start_byte,
      endByte: sym.end_byte,
      docstring: sym.docstring || '',
      bodyPreview: sym.body_preview || '',
      language: sym.language,
      parentName: sym.parent_name || '',
    });
    count++;
  }
  return count;
}

function rebuildDerivedIndexes(db, repoId, args, totalFiles, fileCount, symbolCount, changedFileIds, deletedFileIds) {
  const stats = { files_total: totalFiles, files_done: fileCount, symbols: symbolCount };
  const useIncremental = Array.isArray(changedFileIds) && Array.isArray(deletedFileIds);

  if (useIncremental) {
    return rebuildDerivedIncremental(db, repoId, args, stats, changedFileIds, deletedFileIds);
  }

  emitProgress(args, 'analysis', { step: 'build-import-graph', message: 'Step 5/5: building import graph...' }, stats);

  let importEdges = 0;
  let callEdges = 0;
  let complexityCount = 0;
  try {
    const ig = buildImportEdges(db, repoId);
    if (ig.success) {
      importEdges = ig.edges;
    }
  } catch {}
  emitProgress(args, 'analysis', { step: 'build-call-graph', message: 'Step 5/5: building call graph...' }, stats);
  try {
    const cg = buildCallEdges(db, repoId, {
      onProgress: (p) => {
        emitProgress(
          args,
          'analysis',
          {
            step: 'build-call-graph',
            message: `Step 5/5: building call graph... ${p.filesProcessed}/${p.totalFiles} files, ${p.callsFound} calls`,
          },
          stats,
        );
      },
    });
    if (cg.success) {
      callEdges = cg.calls;
    }
  } catch {}
  emitProgress(
    args,
    'analysis',
    { step: 'compute-complexity', message: 'Step 5/5: computing complexity metrics...' },
    stats,
  );
  try {
    const cc = buildComplexityMetrics(db, repoId);
    if (cc.success) {
      complexityCount = cc.symbols;
    }
  } catch {}

  return { importEdges, callEdges, complexityCount, derived_scope: 'repo' };
}

function rebuildDerivedIncremental(db, repoId, args, stats, changedFileIds, deletedFileIds) {
  emitProgress(args, 'analysis', {
    step: 'build-import-graph',
    message: `Step 5/5: incrementally rebuilding import graph for ${changedFileIds.length + deletedFileIds.length} affected files...`,
  }, stats);

  let importEdges = 0;
  let callEdges = 0;
  let complexityCount = 0;
  let usedFallback = false;

  try {
    const ig = buildImportEdgesForFiles(db, repoId, changedFileIds, deletedFileIds);
    if (ig.success) importEdges = ig.edges;
  } catch {}

  emitProgress(args, 'analysis', {
    step: 'build-call-graph',
    message: `Step 5/5: incrementally rebuilding call graph for affected files...`,
  }, stats);
  try {
    const cg = buildCallEdgesForFiles(db, repoId, changedFileIds, deletedFileIds, {
      onProgress: (p) => {
        emitProgress(args, 'analysis', {
          step: 'build-call-graph',
          message: `Step 5/5: rebuilding call graph... ${p.filesProcessed}/${p.totalFiles} files, ${p.callsFound} calls`,
        }, stats);
      },
    });
    if (cg.success) callEdges = cg.calls;
  } catch {}

  emitProgress(args, 'analysis', {
    step: 'compute-complexity',
    message: 'Step 5/5: incrementally computing complexity metrics...',
  }, stats);
  try {
    const cc = buildComplexityMetricsForFiles(db, repoId, changedFileIds, deletedFileIds);
    if (cc.success) complexityCount = cc.symbols;
  } catch {}

  return {
    importEdges,
    callEdges,
    complexityCount,
    derived_scope: 'file',
    derived_files_changed: changedFileIds.length,
    derived_files_deleted: deletedFileIds.length,
    usedFallback,
  };
}

function formatSkipReport(report) {
  const lines = [];
  const topN = (obj, n = 5) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);
  if (Object.keys(report.builtIn).length > 0) {
    const top = topN(report.builtIn);
    lines.push(`  Built-in skip: ${top.map(([d]) => d).join(', ')}...`);
  }
  if (Object.keys(report.gitignore).length > 0) {
    const top = topN(report.gitignore);
    lines.push(`  .gitignore: ${top.map(([d]) => d).join(', ')}...`);
  }
  if (Object.keys(report.memorycodeignore).length > 0) {
    const top = topN(report.memorycodeignore);
    lines.push(`  .memorycodeignore: ${top.map(([d]) => d).join(', ')}...`);
  }
  if (report.unsupportedExt > 0) {
    lines.push(`  Non-code files: ${report.unsupportedExt} skipped`);
  }
  return lines.join('\n');
}

async function scanPhase(repoPath, options, args) {
  const absPath = path.resolve(repoPath);
  if (!fs.existsSync(absPath)) {
    return { error: `Path not found: ${absPath}` };
  }
  const dirCount = { skipped: 0 };
  const scanResult = scanRepository(absPath, {
    ...options,
    onProgress: (relativePath, reason) => {
      dirCount.skipped++;
      if (dirCount.skipped <= 8 || dirCount.skipped % 50 === 0) {
        emitProgress(args, 'discovery', { message: `Skipping [${reason}]: ${relativePath}` });
      }
    },
    onScanProgress: (stats) => {
      const suffix = stats.done ? 'complete' : 'in progress';
      emitProgress(args, 'discovery', {
        message: `Step 2/5: discovery ${suffix}; currently scanning ${stats.currentKind || 'entry'} ${stats.currentPath || '.'} (${stats.codeFiles} code files found, ${stats.entriesSeen} entries seen, ${stats.dirsVisited} dirs visited)`,
        step: 'discover-files',
        current_file: stats.currentPath || '.',
        files_done: stats.codeFiles,
      });
    },
  });
  return { files: scanResult.files, absPath, skipReport: scanResult.skipReport };
}

async function parsePhase(files, deps, repoId, args) {
  const registry = deps.parserRegistry || createParserRegistry();
  const repository = deps.repository || createCodeIndexRepository(require('../../db'));
  const batchSize = RESULT_LIMITS.INDEX_BATCH_SIZE;
  const totalFiles = files.length;
  const repoRoot = args.repoRoot || args.repoPath || null;

  let useWorkers = totalFiles >= WORKER_POOL.MIN_FILES_FOR_PARALLEL && !args.noWorkers;
  let pool = null;

  if (useWorkers) {
    try {
      pool = await createParsePool();
      emitProgress(args, 'init', {
        step: 'prepare-workers',
        message: `Preparing parser workers: using ${pool.numWorkers} worker threads for symbol extraction`,
      });
    } catch (e) {
      emitProgress(args, 'init', {
        step: 'prepare-workers',
        message: `Preparing parser workers failed (${e.message}); continuing with sequential symbol extraction`,
      });
      pool = null;
      useWorkers = false;
    }
  }

  let symbolCount = 0;
  let fileCount = 0;
  const skipped = [];

  function validateSymbols(record, symbols) {
    if (symbols.length === 0 && record.content.trim().length > 0) {
      const hasExports = /\bexport\s/.test(record.content);
      const hasFunction = /\bfunction\b|\b=>\s|\bdef\s|\bfunc\s|\bfn\s/.test(record.content);
      if (hasExports || hasFunction) {
        skipped.push({
          file: record.filePath,
          error: 'Parse returned 0 symbols despite containing exports/functions',
          zeroSymbolFile: true,
        });
      }
    }
  }

  try {
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(totalFiles / batchSize);
      const firstBatchPath = batch[0] ? progressPath(batch[0], repoRoot) : '(empty batch)';
      emitProgress(
        args,
        'parsing',
        {
          step: 'read-files',
          current_file: firstBatchPath,
          message: `Reading source files for batch ${batchNum}/${totalBatches}: ${batch.length} files starting at ${firstBatchPath}`,
        },
        { files_total: totalFiles, files_done: fileCount, symbols: symbolCount },
      );

      const reads = await Promise.all(
        batch.map(async (fp) => {
          try {
            return await readFileRecord(fp);
          } catch (e) {
            skipped.push({ file: fp, error: e.message });
            recordDiagnostic(repository, repoId, { filePath: fp, content: '' }, 'error', e.message, 0);
            return null;
          }
        }),
      );

      const validReads = reads.filter((r) => r !== null);
      emitProgress(
        args,
        'parsing',
        {
          step: 'extract-symbols',
          current_file: validReads[0] ? progressPath(validReads[0].filePath, repoRoot) : firstBatchPath,
          message: `Extracting symbols for batch ${batchNum}/${totalBatches}: ${validReads.length} readable files${useWorkers ? ' with workers' : ' sequentially'}`,
        },
        { files_total: totalFiles, files_done: fileCount, symbols: symbolCount },
      );

      const parsedRecords = [];
      if (useWorkers && pool) {
        try {
          const workerInputs = validReads.map((r) => ({ filePath: r.filePath, content: r.content }));
          const workerResults = await pool.parseAll(workerInputs);
          const symbolMap = new Map(workerResults.map((r) => [r.filePath, r.symbols]));
          for (const record of validReads) {
            const symbols = symbolMap.get(record.filePath) || [];
            validateSymbols(record, symbols);
            recordDiagnostic(
              repository,
              repoId,
              record,
              symbols.length === 0 && record.content.trim().length > 0 ? 'zero_symbols' : 'ok',
              symbols.length === 0 && record.content.trim().length > 0 ? 'No symbols extracted from non-empty file' : '',
              symbols.length,
            );
            parsedRecords.push({ record, symbols });
          }
        } catch (e) {
          emitProgress(args, 'parsing', {
            step: 'extract-symbols',
            message: `Worker symbol extraction failed (${e.message}); retrying this batch sequentially`,
          });
          useWorkers = false;
        }
      }

      if (!useWorkers || parsedRecords.length === 0) {
        let parsedInBatch = 0;
        for (const record of validReads) {
          const symbols = extractSymbolsFromFile(record.filePath, registry, record.content);
          validateSymbols(record, symbols);
          recordDiagnostic(
            repository,
            repoId,
            record,
            symbols.length === 0 && record.content.trim().length > 0 ? 'zero_symbols' : 'ok',
            symbols.length === 0 && record.content.trim().length > 0 ? 'No symbols extracted from non-empty file' : '',
            symbols.length,
          );
          parsedRecords.push({ record, symbols });
          parsedInBatch++;
          const absoluteDone = i + parsedInBatch;
          if (shouldEmitFileProgress(absoluteDone, totalFiles)) {
            emitProgress(
              args,
              'parsing',
              {
                step: 'extract-symbols',
                current_file: progressPath(record.filePath, repoRoot),
                message: `Extracted symbols ${absoluteDone}/${totalFiles}: ${progressPath(record.filePath, repoRoot)} (${symbols.length} symbols)`,
              },
              { files_total: totalFiles, files_done: fileCount, symbols: symbolCount },
            );
          }
        }
      }

      emitProgress(
        args,
        'parsing',
        {
          step: 'store-index',
          current_file: parsedRecords[0] ? progressPath(parsedRecords[0].record.filePath, repoRoot) : firstBatchPath,
          message: `Storing index records for batch ${batchNum}/${totalBatches}: ${parsedRecords.length} files`,
        },
        { files_total: totalFiles, files_done: fileCount, symbols: symbolCount },
      );

      const batchSymbols = [];
      const writeRecords = (insideTransaction = false) => {
        for (const { record, symbols } of parsedRecords) {
          try {
            const fileId = repository.insertFile(fileRecordToParams(repoId, record));
            for (const sym of symbols) {
              batchSymbols.push({
                repoId,
                fileId,
                filePath: record.filePath,
                name: sym.name,
                kind: sym.kind,
                signature: sym.signature,
                qualifiedName: sym.qualified_name,
                startLine: sym.start_line,
                endLine: sym.end_line,
                startByte: sym.start_byte,
                endByte: sym.end_byte,
                docstring: sym.docstring || '',
                bodyPreview: sym.body_preview || '',
                language: sym.language,
                parentName: sym.parent_name || '',
              });
            }
            symbolCount += symbols.length;
            fileCount++;
            if (shouldEmitFileProgress(fileCount, totalFiles)) {
              emitProgress(
                args,
                'parsing',
                {
                  step: 'store-index',
                  current_file: progressPath(record.filePath, repoRoot),
                  message: `Stored index ${fileCount}/${totalFiles}: ${progressPath(record.filePath, repoRoot)} (${symbols.length} symbols)`,
                },
                { files_total: totalFiles, files_done: fileCount, symbols: symbolCount },
              );
            }
          } catch (e) {
            skipped.push({ file: record.filePath, error: e.message });
            recordDiagnostic(repository, repoId, record, 'error', e.message, 0);
          }
        }

        if (batchSymbols.length > 0) {
          if (insideTransaction) {
            for (const sym of batchSymbols) {
              repository.insertSymbol(sym);
            }
          } else {
            repository.insertSymbolBatch(batchSymbols);
          }
        }
      };

      if (typeof repository.withTransaction === 'function') {
        repository.withTransaction(() => writeRecords(true));
      } else {
        writeRecords(false);
      }
    }
  } finally {
    if (pool) {
      await pool.terminate();
    }
  }

  return { fileCount, symbolCount, skipped };
}

async function derivedPhase(db, repoId, args, totalFiles, fileCount, symbolCount, changedFileIds, deletedFileIds) {
  return rebuildDerivedIndexes(db, repoId, args, totalFiles, fileCount, symbolCount, changedFileIds, deletedFileIds);
}

async function indexRepository(deps, repoPath, repoName) {
  const { db } = deps;
  const args = deps.args || {};
  const repository = deps.repository || createCodeIndexRepository(require('../../db'));
  const registry = deps.parserRegistry || createParserRegistry();
  const t0 = Date.now();

  if (!(await registry.ensureReady())) {
    return {
      error: `WASM tree-sitter parser not available. Run: cd ${path.resolve(__dirname, '..', '..')} && npm install web-tree-sitter`,
    };
  }

  emitProgress(args, 'init', { step: 'prepare-parser', message: 'Step 1/5: preparing tree-sitter parsers...' });
  emitProgress(args, 'discovery', { step: 'discover-files', message: 'Step 2/5: discovering code files to index...' });
  const scanResult = await scanPhase(repoPath, {}, args);
  if (scanResult.error) {
    return { error: scanResult.error };
  }
  const { files, absPath, skipReport } = scanResult;
  const scanMs = Date.now() - t0;
  const skipSummary = formatSkipReport(skipReport);

  emitProgress(args, 'discovery', {
    message: `Found ${files.length} code files to index (${scanMs}ms)`,
    files_total: files.length,
    detail: skipSummary,
  });
  if (skipSummary) {
    emitProgress(args, 'discovery', { message: skipSummary });
  }

  const repoId = repository.upsertRepo({ name: repoName, path: absPath });
  emitProgress(args, 'reset-index', {
    step: 'clear-index',
    message: `Step 3/5: clearing existing index rows for ${repoName}...`,
  });
  const clearT0 = Date.now();
  const clearTotals = repository.clearRepoIndex(repoId, {
    onProgress: (progress) => {
      emitProgress(args, 'reset-index', {
        step: 'clear-index',
        message: `Step 3/5: ${progress.message}`,
        rows_deleted: progress.deleted,
      });
    },
  });
  emitProgress(args, 'reset-index', {
    step: 'clear-index',
    message: `Step 3/5: cleared existing index rows for ${repoName} (${Date.now() - clearT0}ms)`,
    clear_totals: clearTotals,
  });

  emitProgress(args, 'parsing', {
    step: 'parse-and-store',
    message: `Step 4/5: reading files, extracting symbols, and storing index rows for ${files.length} files...`,
    files_total: files.length,
  });
  const parseT0 = Date.now();
  const parseResult = await parsePhase(files, { parserRegistry: registry, repository }, repoId, {
    ...args,
    repoRoot: absPath,
  });
  const parseMs = Date.now() - parseT0;

  emitProgress(args, 'analysis', {
    step: 'derived-indexes',
    message: 'Step 5/5: building derived indexes (imports, calls, complexity)...',
  });
  const derivedT0 = Date.now();
  const headCommit = getHeadCommit(absPath);
  repository.updateRepoStats({ repoId, headCommit });
  const derived = await derivedPhase(db, repoId, args, files.length, parseResult.fileCount, parseResult.symbolCount);
  const derivedMs = Date.now() - derivedT0;

  const totalMs = Date.now() - t0;
  const result = {
    success: true,
    repo: repoName,
    path: absPath,
    files_indexed: parseResult.fileCount,
    symbols_extracted: parseResult.symbolCount,
    files_skipped: parseResult.skipped.length,
    import_edges: derived.importEdges,
    call_edges: derived.callEdges,
    complexity_symbols: derived.complexityCount,
    name: repoName,
    file_count: parseResult.fileCount,
    symbol_count: parseResult.symbolCount,
    skipped: parseResult.skipped,
    skip_report: skipReport,
    timing_ms: { scan: scanMs, parse: parseMs, derived: derivedMs, total: totalMs },
  };

  emitProgress(
    args,
    'done',
    {
      message: `Done: ${parseResult.fileCount} files, ${parseResult.symbolCount} symbols (${(totalMs / 1000).toFixed(1)}s)`,
    },
    { files_total: files.length, files_done: parseResult.fileCount, symbols: parseResult.symbolCount },
  );
  return result;
}

async function reindexRepository(deps, repo, mode = 'incremental') {
  const { db } = deps;
  const args = deps.args || {};
  const repository = deps.repository || createCodeIndexRepository(require('../../db'));
  const registry = deps.parserRegistry || createParserRegistry();
  const t0 = Date.now();

  const existing = repository.findRepoByName(repo);
  if (!existing) {
    return { error: `Repo not found: ${repo}` };
  }

  if (mode === 'full') {
    return indexRepository({ ...deps, repository, parserRegistry: registry }, existing.path, repo);
  }

  if (!(await registry.ensureReady())) {
    return { error: 'WASM tree-sitter parser not available' };
  }

  emitProgress(args, 'init', {
    step: 'prepare-parser',
    message: `Step 1/5: preparing tree-sitter parsers for incremental reindex of "${repo}"...`,
  });
  emitProgress(args, 'discovery', { step: 'discover-files', message: 'Step 2/5: discovering code files to check...' });

  const gitDelta = fs.existsSync(existing.path) ? getGitDelta(existing.path, existing.head_commit) : null;
  const gitChangedFiles = gitDelta
    ? gitDelta.changed.filter((filePath) => fs.existsSync(filePath) && registry.canParseFile(filePath))
    : null;
  const gitDeletedFiles = gitDelta ? gitDelta.deleted : [];
  const scanResult = gitDelta
    ? {
        files: gitChangedFiles,
        skipReport: { builtIn: {}, gitignore: {}, memorycodeignore: {}, unsupportedExt: 0 },
        source: 'git-diff',
      }
    : fs.existsSync(existing.path)
      ? await scanPhase(existing.path, {}, args)
      : { files: [], skipReport: { builtIn: {}, gitignore: {}, memorycodeignore: {}, unsupportedExt: 0 } };
  const files = scanResult.files;
  const skipReport = scanResult.skipReport;
  const skipSummary = formatSkipReport(skipReport);
  emitProgress(args, 'discovery', {
    message: gitDelta
      ? `Git diff from ${existing.head_commit.slice(0, 8)} to ${gitDelta.currentHead.slice(0, 8)} found ${files.length} changed code files and ${gitDeletedFiles.length} deleted files`
      : `Found ${files.length} code files to check`,
    files_total: files.length,
    detail: skipSummary,
  });
  if (skipSummary) {
    emitProgress(args, 'discovery', { message: skipSummary });
  }

  const existingFiles = new Map(repository.listFiles(existing.id).map((file) => [file.path, file]));
  let reindexed = 0;
  let unchanged = 0;
  let symbolCount = 0;
  let hashed = 0;
  const skipped = [];
  const totalFiles = files.length;
  const changedFileIds = [];
  const deletedFileIds = [];

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    if (i % 50 === 0) {
      emitProgress(
        args,
        'parsing',
        {
          step: 'check-file',
          current_file: progressPath(filePath, existing.path),
          message: `Step 3/5: checking file ${i + 1}/${totalFiles}: ${progressPath(filePath, existing.path)}`,
        },
        { files_total: totalFiles, files_done: i, symbols: symbolCount },
      );
    }

    try {
      const record = await readFileRecord(filePath);
      const fileParams = fileRecordToParams(existing.id, record);
      hashed++;
      const prev = existingFiles.get(filePath);
      if (prev && prev.content_hash === fileParams.contentHash) {
        unchanged++;
      } else {
        const writeChangedFile = () => {
          let fileId;
          if (prev) {
            repository.clearFileSymbols(prev.id);
            repository.updateFile(prev.id, fileParams);
            fileId = prev.id;
          } else {
            fileId = repository.insertFile(fileParams);
          }

          emitProgress(args, 'parsing', {
            step: 'extract-symbols',
            current_file: progressPath(filePath, existing.path),
            message: `Step 3/5: extracting symbols from changed file ${progressPath(filePath, existing.path)}`,
          });
          const symbols = extractSymbolsFromFile(filePath, registry, record.content);
          recordDiagnostic(
            repository,
            existing.id,
            record,
            symbols.length === 0 && record.content.trim().length > 0 ? 'zero_symbols' : 'ok',
            symbols.length === 0 && record.content.trim().length > 0 ? 'No symbols extracted from non-empty file' : '',
            symbols.length,
          );
          emitProgress(args, 'parsing', {
            step: 'store-index',
            current_file: progressPath(filePath, existing.path),
            message: `Step 3/5: storing updated index rows for ${progressPath(filePath, existing.path)} (${symbols.length} symbols)`,
          });
          symbolCount += insertSymbols(repository, existing.id, fileId, filePath, symbols);
          reindexed++;
          changedFileIds.push(fileId);
        };
        if (typeof repository.withTransaction === 'function') {
          repository.withTransaction(writeChangedFile);
        } else {
          writeChangedFile();
        }
      }
    } catch (e) {
      skipped.push({ file: filePath, error: e.message });
      recordDiagnostic(repository, existing.id, { filePath, content: '' }, 'error', e.message, 0);
    }

    const done = i + 1;
    if (shouldEmitFileProgress(done, totalFiles)) {
      emitProgress(
        args,
        'parsing',
        {
          step: 'check-file',
          current_file: progressPath(filePath, existing.path),
          message: `Step 3/5: checked ${done}/${totalFiles}: ${progressPath(filePath, existing.path)} (${reindexed} changed, ${unchanged} unchanged)`,
        },
        { files_total: totalFiles, files_done: done, symbols: symbolCount },
      );
    }
  }

  const currentFilesSet = new Set(files);
  const staleFiles = gitDelta
    ? [...existingFiles.entries()].filter(([filePath]) => gitDeletedFiles.includes(filePath))
    : [...existingFiles.entries()].filter(([filePath]) => !currentFilesSet.has(filePath));
  for (const [, fileInfo] of staleFiles) {
    deletedFileIds.push(fileInfo.id);
    repository.deleteFile(fileInfo.id);
  }

  emitProgress(args, 'cleanup', {
    step: 'remove-stale-files',
    message: `Step 4/5: removing ${staleFiles.length} stale files from the index...`,
  });

  emitProgress(args, 'analysis', {
    step: 'derived-indexes',
    message: 'Step 5/5: rebuilding derived indexes (imports, calls, complexity)...',
  });
  repository.updateRepoStats({ repoId: existing.id, headCommit: gitDelta?.currentHead || getHeadCommit(existing.path) });
  const derived = rebuildDerivedIndexes(db, existing.id, args, totalFiles, totalFiles, symbolCount, changedFileIds, deletedFileIds);

  const totalMs = Date.now() - t0;
  emitProgress(
    args,
    'done',
    { message: `Reindexed: ${reindexed} changed, ${unchanged} unchanged (${(totalMs / 1000).toFixed(1)}s)` },
    { files_total: totalFiles, files_done: totalFiles, symbols: symbolCount },
  );

  return {
    success: true,
    repo,
    mode,
    name: repo,
    file_count: reindexed + unchanged,
    symbol_count: symbolCount,
    files_checked: totalFiles,
    files_hashed: hashed,
    files_reindexed: reindexed,
    files_unchanged: unchanged,
    files_removed: staleFiles.length,
    files_skipped: skipped.length,
    symbols_extracted: symbolCount,
    strategy: gitDelta ? 'git-diff' : 'scan-hash',
    derived_scope: derived.derived_scope || 'repo',
    git_base: gitDelta ? existing.head_commit : null,
    git_head: gitDelta ? gitDelta.currentHead : null,
    git_renames: gitDelta ? gitDelta.renamed : [],
    import_edges: derived.importEdges,
    call_edges: derived.callEdges,
    complexity_symbols: derived.complexityCount,
    skipped,
    skip_report: skipReport,
    timing_ms: { total: totalMs },
  };
}

async function getCodeRepoHealth(deps, repo) {
  const repository = deps.repository || createCodeIndexRepository(require('../../db'));
  const registry = deps.parserRegistry || createParserRegistry();
  const existing = repository.findRepoByName(repo);
  if (!existing) {
    return { error: `Repo not found: ${repo}` };
  }

  const pathExists = fs.existsSync(existing.path);
  const currentHead = pathExists ? getHeadCommit(existing.path) : null;
  const stale = Boolean(existing.head_commit && currentHead && existing.head_commit !== currentHead);
  const diagnostics = repository.summarizeDiagnostics(existing.id);
  const diagnosticCounts = Object.fromEntries(diagnostics.map((row) => [row.status, row.count]));
  const recentDiagnostics = repository.listDiagnostics(existing.id, RESULT_LIMITS.DEFAULT_SEARCH_LIMIT);
  let scan = null;

  if (pathExists) {
    const scanResult = scanRepository(existing.path, {});
    const parseableFiles = scanResult.files.filter((filePath) => registry.canParseFile(filePath));
    scan = {
      code_files_found: scanResult.files.length,
      parseable_files_found: parseableFiles.length,
      unsupported_files_skipped: scanResult.skipReport.unsupportedExt,
      skip_report: scanResult.skipReport,
      indexed_file_delta: parseableFiles.length - existing.file_count,
    };
  }

  const parseQuality =
    existing.file_count > 0
      ? Math.max(0, 1 - ((diagnosticCounts.error || 0) + (diagnosticCounts.zero_symbols || 0)) / existing.file_count)
      : 1;
  const healthScore = Math.round((((pathExists ? 1 : 0) + (stale ? 0 : 1) + parseQuality) / 3) * 100) / 100;

  return {
    ok: true,
    repo,
    path: existing.path,
    path_exists: pathExists,
    indexed_files: existing.file_count,
    indexed_symbols: existing.symbol_count,
    indexed_at: existing.indexed_at,
    updated_at: existing.updated_at,
    indexed_head: existing.head_commit,
    current_head: currentHead,
    stale,
    diagnostics: diagnosticCounts,
    recent_diagnostics: recentDiagnostics,
    scan,
    health_score: healthScore,
    recommendations: buildHealthRecommendations({ pathExists, stale, diagnosticCounts, scan }),
  };
}

function buildHealthRecommendations({ pathExists, stale, diagnosticCounts, scan }) {
  const recommendations = [];
  if (!pathExists) {
    recommendations.push('Indexed path no longer exists; remove or reindex this repo.');
  }
  if (stale) {
    recommendations.push('Repo HEAD changed since indexing; run reindex-repo.');
  }
  if ((diagnosticCounts.error || 0) > 0) {
    recommendations.push('Some files failed to read or index; inspect recent_diagnostics.');
  }
  if ((diagnosticCounts.zero_symbols || 0) > 0) {
    recommendations.push('Some non-empty files produced zero symbols; parser coverage may need improvement.');
  }
  if (scan && scan.indexed_file_delta !== 0) {
    recommendations.push('Discovered file count differs from indexed count; run reindex-repo.');
  }
  return recommendations;
}

module.exports = {
  emitProgress,
  fileRecordToParams,
  getHeadCommit,
  getCodeRepoHealth,
  indexRepository,
  insertSymbols,
  parsePhase,
  rebuildDerivedIndexes,
  rebuildDerivedIncremental,
  reindexRepository,
  scanPhase,
  derivedPhase,
};
