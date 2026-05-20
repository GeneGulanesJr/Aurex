// Dead code detection via call graph reachability analysis.

const { _requireNativeDb, DEAD_CODE } = require('./shared-deps');

function getDeadCode(db, repoId, opts) {
  const guard = _requireNativeDb(db);
  if (guard) {
    return guard;
  }
  const minConfidence = opts.minConfidence || DEAD_CODE.DEFAULT_MIN_CONFIDENCE;
  const includeTests = opts.includeTests || false;

  // ── Gather entry points ──
  const entryFiles = new Set();

  // 1. Filename patterns
  const entryPatterns = [
    '%main.js',
    '%index.js',
    '%index.ts',
    '%mod.ts',
    '%cli.js',
    '%app.js',
    '%app.ts',
    '%server.js',
    '%server.ts',
  ];
  for (const pattern of entryPatterns) {
    const rows = db.prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?').all(repoId, pattern);
    for (const r of rows) {
      entryFiles.add(r.id);
    }
  }

  // 2. Shebang files
  const shebangFiles = db
    .prepare("SELECT id FROM code_files WHERE repo_id = ? AND content LIKE '#!/usr/bin/env%'")
    .all(repoId);
  for (const r of shebangFiles) {
    entryFiles.add(r.id);
  }

  // 3. export default
  const exportDefaultFiles = db
    .prepare("SELECT id FROM code_files WHERE repo_id = ? AND content LIKE '%export default%'")
    .all(repoId);
  for (const r of exportDefaultFiles) {
    entryFiles.add(r.id);
  }

  // 4. package.json bin/main/exports fields
  const packageJsonFiles = db
    .prepare("SELECT id, path, content FROM code_files WHERE repo_id = ? AND path LIKE '%/package.json'")
    .all(repoId);
  for (const pkg of packageJsonFiles) {
    try {
      const pkgData = JSON.parse(pkg.content);
      if (pkgData.main) {
        const mainRow = db
          .prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?')
          .get(repoId, `%${pkgData.main}%`);
        if (mainRow) {
          entryFiles.add(mainRow.id);
        }
      }
      if (pkgData.bin) {
        const bins = typeof pkgData.bin === 'string' ? [pkgData.bin] : Object.values(pkgData.bin);
        for (const bin of bins) {
          const binRow = db
            .prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?')
            .get(repoId, `%${bin}%`);
          if (binRow) {
            entryFiles.add(binRow.id);
          }
        }
      }
    } catch (_) {}
  }

  // 5. Barrel files (index.js/ts that re-export other modules)
  const barrelFiles = db
    .prepare(
      "SELECT source_file_id as file_id FROM code_imports WHERE import_type = 're-export' AND repo_id = ? GROUP BY source_file_id",
    )
    .all(repoId);
  for (const b of barrelFiles) {
    entryFiles.add(b.file_id);
  }

  // ── BFS from entry points through import graph ──
  const reachable = new Set(entryFiles);
  const queue = [...entryFiles];
  while (queue.length > 0) {
    const current = queue.shift();
    const importers = db
      .prepare(
        'SELECT DISTINCT source_file_id FROM code_imports WHERE target_file_id = ? AND source_file_id IS NOT NULL',
      )
      .all(current);
    for (const imp of importers) {
      if (!reachable.has(imp.source_file_id)) {
        reachable.add(imp.source_file_id);
        queue.push(imp.source_file_id);
      }
    }
  }

  const allFiles = db.prepare('SELECT id, path FROM code_files WHERE repo_id = ?').all(repoId);
  const deadFiles = allFiles.filter((f) => !reachable.has(f.id));
  const deadFileSet = new Set(deadFiles.map((f) => f.id));

  // ── Symbols with zero callers ──
  const uncalledSymbols = db
    .prepare(`
    SELECT cs.id, cs.name, cs.file_path, cs.kind, cs.file_id FROM code_symbols cs
    WHERE cs.repo_id = ? AND cs.id NOT IN (SELECT callee_symbol_id FROM code_calls WHERE callee_symbol_id IS NOT NULL AND repo_id = ?)
  `)
    .all(repoId, repoId);

  // ── Symbols that are re-exported (barrel exports) ──
  const reExportedNames = new Set();
  const reExports = db
    .prepare(
      "SELECT fi.path, ci.target_module FROM code_imports ci JOIN code_files fi ON fi.id = ci.source_file_id WHERE ci.import_type = 're-export' AND ci.repo_id = ?",
    )
    .all(repoId);
  for (const re of reExports) {
    reExportedNames.add(re.target_module);
  }

  const results = [];
  for (const sym of uncalledSymbols) {
    const isFileDead = deadFileSet.has(sym.file_id);
    const isReExported = db
      .prepare("SELECT 1 FROM code_imports WHERE target_file_id = ? AND import_type = 're-export' LIMIT 1")
      .get(sym.file_id);
    const isNameReExported = reExportedNames.has(sym.name);

    let confidence = 0;
    const signals = [];
    if (!isReExported && !isNameReExported) {
      confidence += DEAD_CODE.NO_CALLERS_WEIGHT;
      signals.push('no_callers');
    }
    if (isFileDead) {
      confidence += DEAD_CODE.UNREACHABLE_FILE_WEIGHT;
      signals.push('unreachable_file');
    }
    if (isNameReExported) {
      confidence -= DEAD_CODE.RE_EXPORTED_PENALTY;
      signals.push('re_exported');
    }

    if (!includeTests && /test|spec|__tests__|\.test\./.test(sym.file_path)) {
      continue;
    }
    if (confidence >= minConfidence) {
      results.push({
        symbol_id: sym.id,
        name: sym.name,
        kind: sym.kind,
        file: sym.file_path,
        confidence: Math.round(confidence * 100) / 100,
        signals,
      });
    }
  }

  return {
    dead_files: deadFiles.map((f) => ({ id: f.id, path: f.path })),
    dead_symbols: results,
    total_symbols: allFiles.length,
  };
}


module.exports = { getDeadCode };
