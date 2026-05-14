const path = require('path');
const fs = require('fs');
const { sqlJson, sqlRun, ensureDb } = require('../db');
const { RESULT_LIMITS } = require('../constants');
const { walkDirForCode: walkDir, hashContent } = require('../utils');
const codeParser = require('../parse-code');
const codeAnalysis = require('../code-analysis');

function parseCodeFile(filePath) {
  return codeParser.parseFile(filePath);
}

async function ensureParserAvailable() {
  if (codeParser.isReady()) {
    return true;
  }
  await codeParser.init();
  return codeParser.isReady();
}

function _emitProgress(args, phase, detail, stats) {
  if (!args || !args.progress) { return; }
  const payload = { progress: true, phase, ...detail };
  if (stats) {
    payload.files_total = stats.files_total;
    payload.files_done = stats.files_done;
    payload.symbols = stats.symbols;
  }
  process.stderr.write(JSON.stringify(payload) + '\n');
}

async function indexRepoInternal(deps, repoPath, repoName) {
  const { db } = deps;
  if (!(await ensureParserAvailable())) {
    return { error: `WASM tree-sitter parser not available. Run: cd ${__dirname} && npm install web-tree-sitter` };
  }

  const args = deps.args || {};
  const absPath = path.resolve(repoPath);
  if (!fs.existsSync(absPath)) {
    return { error: `Path not found: ${absPath}` };
  }

  _emitProgress(args, 'init', { message: 'Initializing parser and walking files...' });

  const files = walkDir(absPath);
  let symbolCount = 0;
  let fileCount = 0;
  const skipped = [];

  _emitProgress(args, 'discovery', { message: `Found ${files.length} code files to index`, files_total: files.length });

  const existingByName = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repoName]);
  const existingByPath = sqlJson('SELECT id FROM code_repos WHERE path = ?', [absPath]);
  let repoId;
  if (existingByName.length > 0) {
    repoId = existingByName[0].id;
    sqlRun('UPDATE code_repos SET path = ? WHERE id = ?', [absPath, repoId]);
    sqlRun('DELETE FROM code_symbols WHERE repo_id = ?', [repoId]);
    sqlRun('DELETE FROM code_files WHERE repo_id = ?', [repoId]);
    sqlRun('DELETE FROM churn_metrics WHERE repo_id = ?', [repoId]);
  } else if (existingByPath.length > 0) {
    repoId = existingByPath[0].id;
    sqlRun('UPDATE code_repos SET name = ? WHERE id = ?', [repoName, repoId]);
    sqlRun('DELETE FROM code_symbols WHERE repo_id = ?', [repoId]);
    sqlRun('DELETE FROM code_files WHERE repo_id = ?', [repoId]);
    sqlRun('DELETE FROM churn_metrics WHERE repo_id = ?', [repoId]);
  } else {
    sqlRun('INSERT INTO code_repos (name, path) VALUES (?, ?)', [repoName, absPath]);
    repoId = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repoName])[0].id;
  }

  let headCommit = null;
  try {
    headCommit = require('child_process')
      .execSync('git rev-parse HEAD', { cwd: absPath, encoding: 'utf-8', timeout: 5000 })
      .trim();
  } catch (_) {}

  const BATCH_SIZE = RESULT_LIMITS.INDEX_BATCH_SIZE;
  const totalFiles = files.length;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalFiles / BATCH_SIZE);
    _emitProgress(args, 'parsing', { message: `Parsing files batch ${batchNum}/${totalBatches}...` }, { files_total: totalFiles, files_done: fileCount, symbols: symbolCount });

    const reads = await Promise.all(batch.map(async (fp) => {
      try {
        const [content, stats] = await Promise.all([
          fs.promises.readFile(fp, 'utf-8'),
          fs.promises.stat(fp),
        ]);
        return { filePath: fp, content, stats };
      } catch (e) {
        skipped.push({ file: fp, error: e.message });
        return null;
      }
    }));

    for (const entry of reads) {
      if (!entry) { continue; }
      const { filePath, content, stats } = entry;
      try {
        const contentHash = hashContent(content);
        const lines = content.split('\n');

        sqlRun(
          'INSERT INTO code_files (repo_id, path, language, content, content_hash, mtime, size_bytes, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [repoId, filePath, path.extname(filePath).slice(1), content, contentHash, stats.mtimeMs, stats.size, lines.length],
        );
        const fileRow = sqlJson('SELECT id FROM code_files WHERE repo_id = ? AND path = ?', [repoId, filePath]);
        const fileId = fileRow[0].id;

        const symbols = parseCodeFile(filePath);
        for (const sym of symbols) {
          sqlRun(
            `INSERT INTO code_symbols (repo_id, file_id, file_path, name, kind, signature, qualified_name,
             start_line, end_line, start_byte, end_byte, docstring, body_preview, language, parent_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [repoId, fileId, filePath, sym.name, sym.kind, sym.signature, sym.qualified_name,
             sym.start_line, sym.end_line, sym.start_byte, sym.end_byte,
             sym.docstring || '', sym.body_preview || '', sym.language, sym.parent_name || ''],
          );
          symbolCount++;
        }
        fileCount++;
      } catch (e) {
        skipped.push({ file: filePath, error: e.message });
      }
    }
  }

  _emitProgress(args, 'analysis', { message: 'Building import graph...' }, { files_total: totalFiles, files_done: fileCount, symbols: symbolCount });

  sqlRun(
    "UPDATE code_repos SET file_count = (SELECT count(*) FROM code_files WHERE repo_id = ?), symbol_count = (SELECT count(*) FROM code_symbols WHERE repo_id = ?), head_commit = ?, updated_at = datetime('now') WHERE id = ?",
    [repoId, repoId, headCommit || null, repoId],
  );

  let importEdges = 0, callEdges = 0, complexityCount = 0;
  try {
    const ig = codeAnalysis.buildImportGraph(db, repoId);
    if (ig.success) { importEdges = ig.edges; }
  } catch (_) {}
  _emitProgress(args, 'analysis', { message: 'Building call graph...' }, { files_total: totalFiles, files_done: fileCount, symbols: symbolCount });
  try {
    const cg = codeAnalysis.buildCallGraph(db, repoId);
    if (cg.success) { callEdges = cg.calls; }
  } catch (_) {}
  _emitProgress(args, 'analysis', { message: 'Computing complexity...' }, { files_total: totalFiles, files_done: fileCount, symbols: symbolCount });
  try {
    const cc = codeAnalysis.buildComplexity(db, repoId);
    if (cc.success) { complexityCount = cc.symbols; }
  } catch (_) {}

  const result = {
    success: true, repo: repoName, path: absPath,
    files_indexed: fileCount, symbols_extracted: symbolCount,
    files_skipped: skipped.length,
    import_edges: importEdges, call_edges: callEdges, complexity_symbols: complexityCount,
    name: repoName, file_count: fileCount, symbol_count: symbolCount, skipped,
  };

  _emitProgress(args, 'done', { message: `Indexed ${fileCount} files, ${symbolCount} symbols` }, { files_total: totalFiles, files_done: fileCount, symbols: symbolCount });
  return result;
}

async function reindexRepoInternal(deps, repo, mode) {
  const { db } = deps;
  const args = deps.args || {};
  const existing = sqlJson('SELECT id, path FROM code_repos WHERE name = ?', [repo]);
  if (existing.length === 0) {
    return { error: `Repo not found: ${repo}` };
  }
  const { id: repoId, path: repoPath } = existing[0];

  if (mode === 'full') {
    sqlRun('DELETE FROM code_symbols WHERE repo_id = ?', [repoId]);
    sqlRun('DELETE FROM code_files WHERE repo_id = ?', [repoId]);
    sqlRun('DELETE FROM churn_metrics WHERE repo_id = ?', [repoId]);
    return indexRepoInternal(deps, repoPath, repo);
  }

  if (!(await ensureParserAvailable())) {
    return { error: 'WASM tree-sitter parser not available' };
  }

  _emitProgress(args, 'init', { message: `Reindexing "${repo}" (incremental)...` });

  const files = walkDir(repoPath);
  let reindexed = 0;
  let unchanged = 0;
  let symbolCount = 0;

  _emitProgress(args, 'discovery', { message: `Found ${files.length} code files to check`, files_total: files.length });

  const existingFiles = {};
  const efRows = sqlJson('SELECT path, mtime, id FROM code_files WHERE repo_id = ?', [repoId]);
  for (const row of efRows) {
    existingFiles[row.path] = { mtime: row.mtime, id: row.id };
  }

  const totalFiles = files.length;
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    if (i % 50 === 0) {
      _emitProgress(args, 'parsing', { message: `Reindexing file ${i + 1}/${totalFiles}...` }, { files_total: totalFiles, files_done: i, symbols: symbolCount });
    }
    try {
      const stats = fs.statSync(filePath);
      const prev = existingFiles[filePath];

      if (prev && prev.mtime === stats.mtimeMs) {
        unchanged++;
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const contentHash = hashContent(content);
      const lines = content.split('\n');
      let fileId;

      if (prev) {
        sqlRun('DELETE FROM code_symbols WHERE file_id = ?', [prev.id]);
        sqlRun(
          'UPDATE code_files SET content = ?, content_hash = ?, mtime = ?, size_bytes = ?, line_count = ? WHERE id = ?',
          [content, contentHash, stats.mtimeMs, stats.size, lines.length, prev.id],
        );
        fileId = prev.id;
      } else {
        sqlRun(
          'INSERT INTO code_files (repo_id, path, language, content, content_hash, mtime, size_bytes, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [repoId, filePath, path.extname(filePath).slice(1), content, contentHash, stats.mtimeMs, stats.size, lines.length],
        );
        fileId = sqlJson('SELECT id FROM code_files WHERE repo_id = ? AND path = ?', [repoId, filePath])[0].id;
      }

      const symbols = parseCodeFile(filePath);
      for (const sym of symbols) {
        sqlRun(
          `INSERT INTO code_symbols (repo_id, file_id, file_path, name, kind, signature, qualified_name,
           start_line, end_line, start_byte, end_byte, docstring, body_preview, language, parent_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [repoId, fileId, filePath, sym.name, sym.kind, sym.signature, sym.qualified_name,
           sym.start_line, sym.end_line, sym.start_byte, sym.end_byte,
           sym.docstring || '', sym.body_preview || '', sym.language, sym.parent_name || ''],
        );
        symbolCount++;
      }
      reindexed++;
    } catch (_) {}
  }

  const currentFilesSet = new Set(files);
  const staleFiles = Object.entries(existingFiles).filter(([fp]) => !currentFilesSet.has(fp));
  for (const [filePath, fileInfo] of staleFiles) {
    sqlRun('DELETE FROM code_symbols WHERE file_id = ?', [fileInfo.id]);
    sqlRun('DELETE FROM code_files WHERE id = ?', [fileInfo.id]);
  }
  let staleCount = staleFiles.length;

  sqlRun(
    "UPDATE code_repos SET file_count = (SELECT count(*) FROM code_files WHERE repo_id = ?), symbol_count = (SELECT count(*) FROM code_symbols WHERE repo_id = ?), updated_at = datetime('now') WHERE id = ?",
    [repoId, repoId, repoId],
  );

  _emitProgress(args, 'analysis', { message: 'Building import graph...' }, { files_total: totalFiles, files_done: totalFiles, symbols: symbolCount });

  let importEdges = 0, callEdges = 0, complexityCount = 0;
  try {
    const ig = codeAnalysis.buildImportGraph(db, repoId);
    if (ig.success) { importEdges = ig.edges; }
  } catch (_) {}
  try {
    const cg = codeAnalysis.buildCallGraph(db, repoId);
    if (cg.success) { callEdges = cg.calls; }
  } catch (_) {}
  try {
    const cc = codeAnalysis.buildComplexity(db, repoId);
    if (cc.success) { complexityCount = cc.symbols; }
  } catch (_) {}

  _emitProgress(args, 'done', { message: `Reindexed: ${reindexed} files, ${symbolCount} symbols` }, { files_total: totalFiles, files_done: totalFiles, symbols: symbolCount });

  return {
    success: true, repo, mode, name: repo,
    file_count: reindexed + unchanged, symbol_count: symbolCount,
    files_reindexed: reindexed, files_unchanged: unchanged,
    files_removed: staleCount, symbols_extracted: symbolCount,
    import_edges: importEdges, call_edges: callEdges, complexity_symbols: complexityCount,
  };
}

module.exports = { parseCodeFile, ensureParserAvailable, indexRepoInternal, reindexRepoInternal };
