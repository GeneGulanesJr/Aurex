/**
 * code-analysis.js — Import graph, call graph, dead code, complexity
 *
 * All functions receive the shared SQLite db handle.
 * Requires parse-code.js to be initialized for some features.
 */

const path = require('path');
const codeParser = require('./parse-code');

// Guard: reject calls when db handle is not available (CLI fallback mode)
function _requireNativeDb(db) {
  if (!db || typeof db.prepare !== 'function') {
    return {
      error:
        'This operation requires a native SQLite backend (node:sqlite or better-sqlite3). The CLI fallback does not support code analysis.',
    };
  }
  return null;
}

// Names to skip in call extraction
const _SKIP_CALLEE_NAMES = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'try',
  'catch',
  'finally',
  'class',
  'function',
  'return',
  'throw',
  'new',
  'typeof',
  'instanceof',
  'void',
  'delete',
  'in',
  'of',
  'yield',
  'await',
  'async',
  'export',
  'import',
  'from',
  'const',
  'let',
  'var',
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'super',
  'constructor',
  'extends',
  'static',
  'get',
  'set',
]);

// ══════════════════════════════════════════════════════════
// IMPORT GRAPH
// ══════════════════════════════════════════════════════════

function extractImportsFromSource(content) {
  const imports = [];
  const seen = new Set();

  function add(mod, type, line) {
    const key = `${mod}:${line}`;
    if (!seen.has(key)) {
      seen.add(key);
      imports.push({ target_module: mod, import_type: type, line_number: line });
    }
  }

  // ES imports: import X from 'module'
  const esRe = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s+)?['"]([^'"]+)['"]/g;
  // Re-exports: export ... from 'module'
  const reExportRe = /export\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+)['"]([^'"]+)['"]/g;
  // require()
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  // dynamic import
  const dynamicRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  let match;
  while ((match = esRe.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    const isReExport = /^export\s/.test(match[0]);
    add(match[1], isReExport ? 're-export' : 'static', line);
  }
  while ((match = reExportRe.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    add(match[1], 're-export', line);
  }
  while ((match = requireRe.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    add(match[1], 'static', line);
  }
  while ((match = dynamicRe.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    add(match[1], 'dynamic', line);
  }

  return imports;
}

function resolveImportTarget(db, repoId, sourceFilePath, targetModule) {
  if (!targetModule.startsWith('.') && !targetModule.startsWith('/')) return null;

  const sourceDir = path.dirname(sourceFilePath);
  let resolved = path.resolve(sourceDir, targetModule);

  const candidates = [
    resolved,
    resolved + '.js',
    resolved + '.mjs',
    resolved + '.cjs',
    resolved + '.ts',
    resolved + '.mts',
    resolved + '.cts',
    resolved + '.tsx',
    path.join(resolved, 'index.js'),
    path.join(resolved, 'index.ts'),
    path.join(resolved, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    const row = db.prepare('SELECT id FROM code_files WHERE repo_id = ? AND path = ?').get(repoId, candidate);
    if (row) return row.id;
  }
  return null;
}

function buildImportGraph(db, repoId) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  db.prepare('DELETE FROM code_imports WHERE repo_id = ?').run(repoId);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO code_imports (repo_id, source_file_id, target_module, target_file_id, import_type, line_number) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const files = db.prepare('SELECT id, path, content FROM code_files WHERE repo_id = ?').all(repoId);
  let totalEdges = 0;

  for (const file of files) {
    if (!file.content) continue;
    const imports = extractImportsFromSource(file.content);
    for (const imp of imports) {
      const targetFileId = resolveImportTarget(db, repoId, file.path, imp.target_module);
      insertStmt.run(repoId, file.id, imp.target_module, targetFileId, imp.import_type, imp.line_number);
      totalEdges++;
    }
  }

  return { success: true, edges: totalEdges };
}

function getImportGraph(db, repoId, opts) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const { file, direction = 'both', depth = 1 } = opts;

  if (depth <= 1 && file) {
    const fileRow = db.prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?').get(repoId, `%${file}%`);
    if (!fileRow) return { error: `File not found: ${file}` };

    const edges = db
      .prepare(`
      SELECT ci.import_type, ci.line_number, ci.target_module, sf.path as source_file, tf.path as target_file
      FROM code_imports ci JOIN code_files sf ON sf.id = ci.source_file_id LEFT JOIN code_files tf ON tf.id = ci.target_file_id
      WHERE ci.repo_id = ? AND (ci.source_file_id = ? OR ci.target_file_id = ?)
    `)
      .all(repoId, fileRow.id, fileRow.id);

    return {
      edges: edges.map((r) => ({
        source: r.source_file,
        target: r.target_file || r.target_module,
        type: r.import_type,
        line: r.line_number,
      })),
    };
  }

  if (depth > 1 && file) {
    const fileRow = db.prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?').get(repoId, `%${file}%`);
    if (!fileRow) return { error: `File not found: ${file}` };

    const result = {};
    if (direction === 'imports' || direction === 'both') {
      result.downstream = db
        .prepare(`
        WITH RECURSIVE deps AS (
          SELECT target_file_id as file_id, 1 as depth FROM code_imports WHERE source_file_id = ? AND target_file_id IS NOT NULL
          UNION ALL SELECT ci.target_file_id, d.depth + 1 FROM code_imports ci JOIN deps d ON ci.source_file_id = d.file_id WHERE d.depth < ? AND ci.target_file_id IS NOT NULL
        ) SELECT DISTINCT cf.path, d.depth FROM deps d JOIN code_files cf ON cf.id = d.file_id
      `)
        .all(fileRow.id, depth);
    }
    if (direction === 'importers' || direction === 'both') {
      result.upstream = db
        .prepare(`
        WITH RECURSIVE imp AS (
          SELECT source_file_id as file_id, 1 as depth FROM code_imports WHERE target_file_id = ? AND source_file_id IS NOT NULL
          UNION ALL SELECT ci.source_file_id, u.depth + 1 FROM code_imports ci JOIN imp u ON ci.target_file_id = u.file_id WHERE u.depth < ? AND ci.source_file_id IS NOT NULL
        ) SELECT DISTINCT cf.path, u.depth FROM imp u JOIN code_files cf ON cf.id = u.file_id
      `)
        .all(fileRow.id, depth);
    }
    return result;
  }

  // Repo-wide: just return all edges
  const edges = db
    .prepare(`
    SELECT ci.import_type, ci.target_module, sf.path as source_file, tf.path as target_file
    FROM code_imports ci JOIN code_files sf ON sf.id = ci.source_file_id LEFT JOIN code_files tf ON tf.id = ci.target_file_id
    WHERE ci.repo_id = ? LIMIT 500
  `)
    .all(repoId);

  return {
    edges: edges.map((r) => ({ source: r.source_file, target: r.target_file || r.target_module, type: r.import_type })),
  };
}

// ══════════════════════════════════════════════════════════
// CALL GRAPH
// ══════════════════════════════════════════════════════════

function buildCallGraph(db, repoId) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  db.prepare('DELETE FROM code_calls WHERE repo_id = ?').run(repoId);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO code_calls (repo_id, caller_symbol_id, callee_name, callee_symbol_id, confidence, line_number) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const symbols = db
    .prepare(`
    SELECT cs.id, cs.name, cs.file_id, cs.file_path, cs.start_byte, cs.end_byte, cs.start_line, cf.content as file_content
    FROM code_symbols cs JOIN code_files cf ON cf.id = cs.file_id WHERE cs.repo_id = ?
  `)
    .all(repoId);

  // Build name → symbol lookup
  const allSymbols = db.prepare('SELECT id, name, file_id, file_path FROM code_symbols WHERE repo_id = ?').all(repoId);
  const symbolsByName = new Map();
  for (const sym of allSymbols) {
    if (!symbolsByName.has(sym.name)) symbolsByName.set(sym.name, []);
    symbolsByName.get(sym.name).push(sym);
  }

  let totalCalls = 0;

  // Resolve callee name to symbol ID (import-aware → same-file → repo-wide)
  function resolveCallee(calleeName, sym, fileImportsCache) {
    let calleeSymbolId = null;
    let confidence = 0.7;

    // Import-aware resolution (cached per file)
    const fileImports =
      fileImportsCache[sym.file_id] ||
      (fileImportsCache[sym.file_id] = db
        .prepare('SELECT target_file_id FROM code_imports WHERE source_file_id = ? AND target_file_id IS NOT NULL')
        .all(sym.file_id));

    for (const imp of fileImports) {
      const matchSym = db
        .prepare('SELECT id FROM code_symbols WHERE file_id = ? AND name = ? LIMIT 1')
        .get(imp.target_file_id, calleeName);
      if (matchSym) {
        calleeSymbolId = matchSym.id;
        confidence = 1.0;
        break;
      }
    }

    if (!calleeSymbolId) {
      const sameFile = db
        .prepare('SELECT id FROM code_symbols WHERE file_id = ? AND name = ? LIMIT 1')
        .get(sym.file_id, calleeName);
      if (sameFile) {
        calleeSymbolId = sameFile.id;
        confidence = 0.9;
      }
    }

    if (!calleeSymbolId) {
      const matches = symbolsByName.get(calleeName);
      if (matches && matches.length === 1) {
        calleeSymbolId = matches[0].id;
        confidence = 0.7;
      }
    }

    return { calleeSymbolId, confidence };
  }

  const fileImportsCache = {};

  for (const sym of symbols) {
    if (!sym.file_content || sym.end_byte <= sym.start_byte) continue;

    // v5.3: Try AST-based call extraction first (more precise)
    let astCallees = [];
    try {
      const allCallees = codeParser.extractCallees(sym.file_path);
      // Filter to callees within this symbol's line range
      astCallees = allCallees.filter((c) => c.line >= sym.start_line && c.line <= sym.end_line);
    } catch (_) {
      astCallees = []; // Will fall back to regex
    }

    const seen = new Set();

    if (astCallees.length > 0) {
      // AST-based extraction: use callee names directly
      for (const c of astCallees) {
        if (_SKIP_CALLEE_NAMES.has(c.callee)) continue;
        const key = `${c.callee}:${c.line}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const { calleeSymbolId, confidence } = resolveCallee(c.callee, sym, fileImportsCache);
        insertStmt.run(repoId, sym.id, c.callee, calleeSymbolId, confidence, c.line);
        totalCalls++;
      }
    } else {
      // Regex fallback for SQL or when AST isn't available
      const body = Buffer.from(sym.file_content, 'utf-8').toString('utf-8', sym.start_byte, sym.end_byte);
      if (!body || body.length < 2) continue;

      const callPatterns = [
        /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
        /\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
        /\bnew\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      ];

      for (const pattern of callPatterns) {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(body)) !== null) {
          const calleeName = match[1];
          if (_SKIP_CALLEE_NAMES.has(calleeName)) continue;
          if (seen.has(calleeName)) continue;
          seen.add(calleeName);

          const { calleeSymbolId, confidence } = resolveCallee(calleeName, sym, fileImportsCache);
          const lineNum = sym.start_line + body.substring(0, match.index).split('\n').length - 1;
          insertStmt.run(repoId, sym.id, calleeName, calleeSymbolId, confidence, lineNum);
          totalCalls++;
        }
      }
    }
  }

  return { success: true, calls: totalCalls };
}

function getCallHierarchy(db, repoId, opts) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const { symbol, direction = 'callers', depth = 3 } = opts;
  if (!symbol) return { error: 'Missing --symbol' };

  const symRow = db
    .prepare('SELECT id, name, file_path FROM code_symbols WHERE repo_id = ? AND name = ?')
    .all(repoId, symbol);
  if (symRow.length === 0) return { error: `Symbol "${symbol}" not found` };
  if (symRow.length > 1) return { error: `Multiple symbols named "${symbol}"`, candidates: symRow };

  const symbolId = symRow[0].id;

  if (direction === 'callers') {
    const rows = db
      .prepare(`
      WITH RECURSIVE upstream AS (
        SELECT cc.caller_symbol_id, cs.name, cs.file_path, 1 as depth FROM code_calls cc JOIN code_symbols cs ON cs.id = cc.caller_symbol_id WHERE cc.callee_symbol_id = ?
        UNION ALL SELECT cc.caller_symbol_id, cs.name, cs.file_path, u.depth + 1 FROM code_calls cc JOIN upstream u ON cc.callee_symbol_id = u.caller_symbol_id JOIN code_symbols cs ON cs.id = cc.caller_symbol_id WHERE u.depth < ?
      ) SELECT * FROM upstream
    `)
      .all(symbolId, depth);
    return { symbol: symRow[0].name, direction: 'callers', depth, callers: rows };
  }

  const rows = db
    .prepare(`
    WITH RECURSIVE downstream AS (
      SELECT cc.callee_name, cc.callee_symbol_id, cs.file_path, cc.confidence, 1 as depth FROM code_calls cc LEFT JOIN code_symbols cs ON cs.id = cc.callee_symbol_id WHERE cc.caller_symbol_id = ?
      UNION ALL SELECT cc.callee_name, cc.callee_symbol_id, cs.file_path, cc.confidence, d.depth + 1 FROM code_calls cc JOIN downstream d ON cc.caller_symbol_id = d.callee_symbol_id LEFT JOIN code_symbols cs ON cs.id = cc.callee_symbol_id WHERE d.depth < ?
    ) SELECT * FROM downstream
  `)
    .all(symbolId, depth);
  return { symbol: symRow[0].name, direction: 'callees', depth, callees: rows };
}

// ══════════════════════════════════════════════════════════
// BLAST RADIUS
// ══════════════════════════════════════════════════════════

function getBlastRadius(db, repoId, opts) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const { symbol, depth = 3 } = opts;
  if (!symbol) return { error: 'Missing --symbol' };

  const symRow = db
    .prepare('SELECT id, name, file_id, file_path FROM code_symbols WHERE repo_id = ? AND name = ?')
    .all(repoId, symbol);
  if (symRow.length === 0) return { error: `Symbol "${symbol}" not found` };
  if (symRow.length > 1) return { error: `Multiple symbols named "${symbol}"`, candidates: symRow };

  const symbolId = symRow[0].id;
  const fileId = symRow[0].file_id;

  const callers = db
    .prepare(`
    WITH RECURSIVE upstream AS (
      SELECT cc.caller_symbol_id, cs.name, cs.file_path, 1 as depth FROM code_calls cc JOIN code_symbols cs ON cs.id = cc.caller_symbol_id WHERE cc.callee_symbol_id = ?
      UNION ALL SELECT cc.caller_symbol_id, cs.name, cs.file_path, u.depth + 1 FROM code_calls cc JOIN upstream u ON cc.callee_symbol_id = u.caller_symbol_id JOIN code_symbols cs ON cs.id = cc.caller_symbol_id WHERE u.depth < ?
    ) SELECT * FROM upstream
  `)
    .all(symbolId, depth);

  const fileImporters = db
    .prepare(`
    WITH RECURSIVE imp AS (
      SELECT ci.source_file_id, cf.path, 1 as depth FROM code_imports ci JOIN code_files cf ON cf.id = ci.source_file_id WHERE ci.target_file_id = ? AND ci.target_file_id IS NOT NULL
      UNION ALL SELECT ci.source_file_id, cf.path, u.depth + 1 FROM code_imports ci JOIN imp u ON ci.target_file_id = u.source_file_id JOIN code_files cf ON cf.id = ci.source_file_id WHERE u.depth < ? AND ci.target_file_id IS NOT NULL
    ) SELECT DISTINCT path, depth FROM imp
  `)
    .all(fileId, depth);

  return {
    symbol: symRow[0].name,
    file: symRow[0].file_path,
    callers,
    file_importers: fileImporters,
    affected_files: [...new Set([...callers.map((c) => c.file_path), ...fileImporters.map((f) => f.path)])],
  };
}

// ══════════════════════════════════════════════════════════
// DEAD CODE
// ══════════════════════════════════════════════════════════

function getDeadCode(db, repoId, opts) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const minConfidence = opts.minConfidence || 0.5;
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
    for (const r of rows) entryFiles.add(r.id);
  }

  // 2. Shebang files
  const shebangFiles = db
    .prepare("SELECT id FROM code_files WHERE repo_id = ? AND content LIKE '#!/usr/bin/env%'")
    .all(repoId);
  for (const r of shebangFiles) entryFiles.add(r.id);

  // 3. export default
  const exportDefaultFiles = db
    .prepare("SELECT id FROM code_files WHERE repo_id = ? AND content LIKE '%export default%'")
    .all(repoId);
  for (const r of exportDefaultFiles) entryFiles.add(r.id);

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
        if (mainRow) entryFiles.add(mainRow.id);
      }
      if (pkgData.bin) {
        const bins = typeof pkgData.bin === 'string' ? [pkgData.bin] : Object.values(pkgData.bin);
        for (const bin of bins) {
          const binRow = db
            .prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?')
            .get(repoId, `%${bin}%`);
          if (binRow) entryFiles.add(binRow.id);
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
  for (const b of barrelFiles) entryFiles.add(b.file_id);

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
  for (const re of reExports) reExportedNames.add(re.target_module);

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
      confidence += 0.33;
      signals.push('no_callers');
    }
    if (isFileDead) {
      confidence += 0.34;
      signals.push('unreachable_file');
    }
    if (isNameReExported) {
      confidence -= 0.34;
      signals.push('re_exported');
    }

    if (!includeTests && /test|spec|__tests__|\.test\./.test(sym.file_path)) continue;
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

// ══════════════════════════════════════════════════════════
// COMPLEXITY
// ══════════════════════════════════════════════════════════

function buildComplexity(db, repoId) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  db.prepare('DELETE FROM symbol_complexity WHERE symbol_id IN (SELECT id FROM code_symbols WHERE repo_id = ?)').run(
    repoId,
  );

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO symbol_complexity (symbol_id, cyclomatic, nesting_depth, param_count, lines_of_code, assessment) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const symbols = db
    .prepare(`
    SELECT cs.id, cs.name, cs.start_byte, cs.end_byte, cs.start_line, cs.end_line, cs.signature, cf.content as file_content
    FROM code_symbols cs JOIN code_files cf ON cf.id = cs.file_id WHERE cs.repo_id = ? AND cs.kind IN ('function', 'method')
  `)
    .all(repoId);

  let count = 0;
  for (const sym of symbols) {
    if (!sym.file_content || sym.end_byte <= sym.start_byte) continue;
    const body = Buffer.from(sym.file_content, 'utf-8').toString('utf-8', sym.start_byte, sym.end_byte);
    if (!body) continue;

    let cyclomatic = 1;
    const decisionPatterns = [
      /if\b/g,
      /else\s+if\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bdo\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\&\&/g,
      /\|\|/g,
      /\?\?/g,
    ];
    // Note: optional chaining (?.) is NOT a decision point per spec
    for (const pattern of decisionPatterns) {
      pattern.lastIndex = 0;
      const m = body.match(pattern);
      if (m) cyclomatic += m.length;
    }
    // Ternary (?:) — count only if not followed by . (to exclude ?.)
    const ternaryRe = /\?(?:\s*[^.:])/g;
    let ternaryMatch;
    while ((ternaryMatch = ternaryRe.exec(body)) !== null) {
      cyclomatic++;
    }

    // v5.1: String-aware brace counting for nesting depth
    let maxDepth = 0,
      currentDepth = 0;
    let inString = false,
      stringChar = '',
      templateDepth = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      const prev = i > 0 ? body[i - 1] : '';

      // Handle string literals (skip braces inside them)
      if (!inString && templateDepth === 0 && (ch === '"' || ch === "'")) {
        inString = true;
        stringChar = ch;
        continue;
      }
      if (inString && ch === stringChar && prev !== '\\') {
        inString = false;
        continue;
      }
      // Handle template literals (${...} inside backtick strings)
      if (!inString && ch === '`') {
        templateDepth++;
        continue;
      }
      if (templateDepth === 1 && ch === '`') {
        templateDepth--;
        continue;
      }

      if (!inString || templateDepth > 0) {
        if (ch === '{') {
          currentDepth++;
          maxDepth = Math.max(maxDepth, currentDepth);
        }
        if (ch === '}') {
          if (templateDepth > 0 && body.substring(i - 1, i + 1) === '}') {
            // Template expression ${...}
            currentDepth++;
            maxDepth = Math.max(maxDepth, currentDepth);
          }
          if (currentDepth > 0) currentDepth--;
        }
      }
    }

    const sigMatch = sym.signature ? sym.signature.match(/\(([^)]*)\)/) : null;
    const paramCount = sigMatch ? sigMatch[1].split(',').filter((p) => p.trim()).length : 0;
    const lines = body.split('\n');
    const codeLines = lines.filter((l) => l.trim() && !l.trim().startsWith('//')).length;
    const assessment = cyclomatic <= 4 ? 'low' : cyclomatic <= 10 ? 'medium' : 'high';

    insertStmt.run(sym.id, cyclomatic, maxDepth, paramCount, codeLines, assessment);
    count++;
  }

  return { success: true, symbols: count };
}

function getComplexity(db, repoId, symbolId) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  if (symbolId) {
    const row = db
      .prepare(
        'SELECT sc.*, cs.name, cs.file_path FROM symbol_complexity sc JOIN code_symbols cs ON cs.id = sc.symbol_id WHERE sc.symbol_id = ?',
      )
      .get(symbolId);
    if (!row) return { error: 'Complexity not computed' };
    return row;
  }
  return db
    .prepare(
      'SELECT sc.*, cs.name, cs.file_path FROM symbol_complexity sc JOIN code_symbols cs ON cs.id = sc.symbol_id WHERE cs.repo_id = ? ORDER BY sc.cyclomatic DESC',
    )
    .all(repoId);
}

// ══════════════════════════════════════════════════════════
// FILE OUTLINE
// ══════════════════════════════════════════════════════════

function getFileOutline(db, repoId, filePath) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const fileRow = db
    .prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?')
    .get(repoId, `%${filePath}%`);
  if (!fileRow) return { error: `File not found: ${filePath}` };

  const symbols = db
    .prepare(`
    SELECT cs.id, cs.name, cs.kind, cs.start_line, cs.end_line, cs.signature, cs.qualified_name, cs.parent_name,
           sc.cyclomatic, sc.assessment
    FROM code_symbols cs LEFT JOIN symbol_complexity sc ON sc.symbol_id = cs.id
    WHERE cs.repo_id = ? AND cs.file_path LIKE ? ORDER BY cs.start_line
  `)
    .all(repoId, `%${filePath}%`);

  const classes = [];
  const standalone = [];
  for (const sym of symbols) {
    if (sym.parent_name) {
      let cls = classes.find((c) => c.name === sym.parent_name);
      if (!cls) {
        cls = { name: sym.parent_name, methods: [] };
        classes.push(cls);
      }
      cls.methods.push(sym);
    } else {
      standalone.push(sym);
    }
  }

  return { file: filePath, classes, standalone };
}

// ══════════════════════════════════════════════════════════
// HOTSPOTS (complexity × churn)
// ══════════════════════════════════════════════════════════

function getHotspots(db, repoId, opts = {}) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const topN = opts.top || 20;
  const days = opts.days || 90;

  // Ensure churn data exists for this repo
  const churnCount = db
    .prepare('SELECT count(*) as c FROM churn_metrics WHERE repo_id = ? AND window_days = ?')
    .get(repoId, days);
  if (!churnCount || churnCount.c === 0) {
    return { hotspots: [], note: 'No churn data. Run `churn --repo X` first to populate git history metrics.' };
  }

  const rows = db
    .prepare(`
    SELECT
      cs.name,
      cs.kind,
      cs.file_path,
      sc.cyclomatic,
      sc.nesting_depth,
      cm.commits,
      cm.churn_per_week,
      cm.unique_authors,
      ROUND(sc.cyclomatic * LOG(1 + cm.commits), 2) as hotspot_score,
      CASE
        WHEN sc.cyclomatic * LOG(1 + cm.commits) >= 20 THEN 'critical'
        WHEN sc.cyclomatic * LOG(1 + cm.commits) >= 10 THEN 'high'
        WHEN sc.cyclomatic * LOG(1 + cm.commits) >= 5 THEN 'medium'
        ELSE 'low'
      END as risk
    FROM symbol_complexity sc
    JOIN code_symbols cs ON cs.id = sc.symbol_id
    JOIN churn_metrics cm ON cm.repo_id = cs.repo_id AND cm.file_path = cs.file_path
    WHERE cs.repo_id = ? AND cm.window_days = ?
    ORDER BY hotspot_score DESC
    LIMIT ?
  `)
    .all(repoId, days, topN);

  return { hotspots: rows };
}

// ══════════════════════════════════════════════════════════
// DEPENDENCY CYCLES (Tarjan's SCC on import graph)
// ══════════════════════════════════════════════════════════

function getDependencyCycles(db, repoId) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  // Build adjacency list from import edges (source → target)
  const edges = db
    .prepare(`
    SELECT DISTINCT cf_source.path as source, cf_target.path as target
    FROM code_imports ci
    JOIN code_files cf_source ON cf_source.id = ci.source_file_id
    JOIN code_files cf_target ON cf_target.id = ci.target_file_id
    WHERE ci.repo_id = ? AND ci.target_file_id IS NOT NULL
  `)
    .all(repoId);

  const adj = new Map();
  const allNodes = new Set();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
    allNodes.add(e.source);
    allNodes.add(e.target);
  }

  // Tarjan's SCC
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlink = new Map();
  const sccs = [];

  function strongconnect(v) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) || []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) sccs.push(scc);
    }
  }

  for (const v of allNodes) {
    if (!indices.has(v)) strongconnect(v);
  }

  // Find actual cycles (paths that close the loop)
  const cycles = sccs.map((scc) => {
    const sccSet = new Set(scc);
    const cycleEdges = [];
    for (const node of scc) {
      for (const neighbor of adj.get(node) || []) {
        if (sccSet.has(neighbor)) {
          cycleEdges.push({ from: node, to: neighbor });
        }
      }
    }
    return { files: scc, edges: cycleEdges, size: scc.length };
  });

  return {
    cycles: cycles.sort((a, b) => b.size - a.size),
    total_circular_files: cycles.reduce((sum, c) => sum + c.size, 0),
  };
}

// ══════════════════════════════════════════════════════════
// SYMBOL IMPORTANCE (PageRank on call graph)
// ══════════════════════════════════════════════════════════

function getSymbolImportance(db, repoId, opts = {}) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const topN = opts.top || 20;
  const scope = opts.scope || null;

  // Build call graph: caller → [callees] (only for symbols in this repo)
  const calls = db
    .prepare(`
    SELECT cc.caller_symbol_id, cc.callee_symbol_id
    FROM code_calls cc
    JOIN code_symbols cs ON cs.id = cc.caller_symbol_id
    WHERE cc.repo_id = ? AND cc.callee_symbol_id IS NOT NULL AND cs.repo_id = ?
  `)
    .all(repoId, repoId);

  // Get all symbols in repo (optionally scoped)
  let symbolQuery = 'SELECT id, name, kind, file_path FROM code_symbols WHERE repo_id = ?';
  const symbolParams = [repoId];
  if (scope) {
    symbolQuery += ' AND file_path LIKE ?';
    symbolParams.push(`${scope}%`);
  }
  const symbols = db.prepare(symbolQuery).all(...symbolParams);
  const symbolSet = new Set(symbols.map((s) => s.id));
  const symbolMap = new Map(symbols.map((s) => [s.id, s]));

  // Build outgoing edges map (only between repo symbols)
  const outEdges = new Map();
  for (const call of calls) {
    if (!symbolSet.has(call.caller_symbol_id) || !symbolSet.has(call.callee_symbol_id)) continue;
    if (!outEdges.has(call.caller_symbol_id)) outEdges.set(call.caller_symbol_id, []);
    outEdges.get(call.caller_symbol_id).push(call.callee_symbol_id);
  }

  // Initialize PageRank
  const d = 0.85; // damping factor
  const n = symbolSet.size;
  let ranks = new Map();
  for (const id of symbolSet) ranks.set(id, 1 / n);

  // Iterate (10 iterations)
  for (let i = 0; i < 10; i++) {
    const newRanks = new Map();
    for (const id of symbolSet) newRanks.set(id, (1 - d) / n);

    for (const [callerId, calleeIds] of outEdges) {
      const outDegree = calleeIds.length;
      if (outDegree === 0) continue;
      const rankShare = ranks.get(callerId) / outDegree;
      for (const calleeId of calleeIds) {
        newRanks.set(calleeId, newRanks.get(calleeId) + d * rankShare);
      }
    }
    ranks = newRanks;
  }

  // Sort by rank and return top N
  const results = [...ranks.entries()]
    .map(([id, rank]) => ({ ...symbolMap.get(id), pagerank: Math.round(rank * 10000) / 10000 }))
    .sort((a, b) => b.pagerank - a.pagerank)
    .slice(0, topN);

  return { importance: results, total_symbols: n };
}

// ══════════════════════════════════════════════════════════
// COUPLING METRICS (afferent/efferent/instability per file)
// ══════════════════════════════════════════════════════════

function getCouplingMetrics(db, repoId, opts = {}) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const filePath = opts.file || null;
  const minCa = opts.minCa || 0;
  const sortBy = opts.sortBy || 'instability'; // 'instability', 'afferent', 'efferent'

  // Afferent coupling (Ca): files that import this file
  const afferentRows = db
    .prepare(`
    SELECT tf.path as file_path, COUNT(DISTINCT ci.source_file_id) as ca
    FROM code_imports ci
    JOIN code_files tf ON tf.id = ci.target_file_id
    WHERE ci.repo_id = ? AND ci.target_file_id IS NOT NULL
    GROUP BY tf.path
  `)
    .all(repoId);

  // Efferent coupling (Ce): files this file imports
  const efferentRows = db
    .prepare(`
    SELECT sf.path as file_path, COUNT(DISTINCT ci.target_file_id) as ce
    FROM code_imports ci
    JOIN code_files sf ON sf.id = ci.source_file_id
    WHERE ci.repo_id = ? AND ci.target_file_id IS NOT NULL AND ci.import_type != 're-export'
    GROUP BY sf.path
  `)
    .all(repoId);

  const afferentMap = new Map(afferentRows.map((r) => [r.file_path, r.ca]));
  const efferentMap = new Map(efferentRows.map((r) => [r.file_path, r.ce]));

  // Get all files in repo
  const allFiles = db.prepare('SELECT path FROM code_files WHERE repo_id = ?').all(repoId);
  const results = [];

  for (const f of allFiles) {
    if (filePath && f.path !== filePath && !f.path.endsWith(filePath)) continue;
    const ca = afferentMap.get(f.path) || 0;
    const ce = efferentMap.get(f.path) || 0;
    const total = ca + ce;
    const instability = total === 0 ? 0 : Math.round((ce / total) * 100) / 100;
    const category = instability <= 0.3 ? 'stable' : instability >= 0.7 ? 'unstable' : 'balanced';

    if (ca < minCa) continue;
    results.push({ file_path: f.path, afferent: ca, efferent: ce, instability, category });
  }

  const sortKey = sortBy === 'afferent' ? 'afferent' : sortBy === 'efferent' ? 'efferent' : 'instability';
  results.sort((a, b) => b[sortKey] - a[sortKey]);

  return { metrics: results };
}

// ══════════════════════════════════════════════════════════
// EXTRACTION CANDIDATES (complexity × caller spread)
// ══════════════════════════════════════════════════════════

function getExtractionCandidates(db, repoId, opts = {}) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const minComplexity = opts.minComplexity || 5;
  const minCallers = opts.minCallers || 2;
  const topN = opts.top || 20;

  // Find symbols with high complexity that are called from multiple files
  const rows = db
    .prepare(`
    SELECT
      cs.name,
      cs.kind,
      cs.file_path,
      sc.cyclomatic,
      sc.nesting_depth,
      sc.lines_of_code,
      COUNT(DISTINCT caller.file_path) as caller_file_count,
      ROUND(sc.cyclomatic * LOG(1 + COUNT(DISTINCT caller.file_path)), 2) as extraction_score,
      GROUP_CONCAT(DISTINCT caller.file_path) as caller_files
    FROM symbol_complexity sc
    JOIN code_symbols cs ON cs.id = sc.symbol_id
    JOIN code_calls cc ON cc.callee_symbol_id = cs.id AND cc.repo_id = cs.repo_id
    JOIN code_symbols caller ON caller.id = cc.caller_symbol_id AND caller.repo_id = cs.repo_id
    WHERE cs.repo_id = ? AND sc.cyclomatic >= ?
    GROUP BY cs.id
    HAVING COUNT(DISTINCT caller.file_path) >= ?
    ORDER BY extraction_score DESC
    LIMIT ?
  `)
    .all(repoId, minComplexity, minCallers, topN);

  // Parse caller_files from GROUP_CONCAT
  const results = rows.map((r) => ({
    ...r,
    caller_files: r.caller_files ? r.caller_files.split(',') : [],
  }));

  return { candidates: results };
}

// ══════════════════════════════════════════════════════════
// CLASS HIERARCHY (parent_name → ancestors/descendants)
// ══════════════════════════════════════════════════════════

function getClassHierarchy(db, repoId, opts = {}) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const className = opts.class || opts.symbol;
  const direction = opts.direction || 'both'; // 'ancestors', 'descendants', 'both'

  if (!className) return { error: 'Class name required. Pass --class or --symbol.' };

  // Find the symbol
  const sym = db
    .prepare('SELECT id, name, kind, file_path, parent_name FROM code_symbols WHERE repo_id = ? AND name = ?')
    .get(repoId, className);
  if (!sym) return { error: `Symbol "${className}" not found in repo.` };

  const result = { name: sym.name, kind: sym.kind, file_path: sym.file_path, parent_name: sym.parent_name };

  // Ancestors: walk parent_name chain upward
  if (direction === 'ancestors' || direction === 'both') {
    const ancestors = [];
    let current = sym;
    const visited = new Set();
    while (current.parent_name && !visited.has(current.parent_name)) {
      visited.add(current.parent_name);
      const parent = db
        .prepare('SELECT id, name, kind, file_path, parent_name FROM code_symbols WHERE repo_id = ? AND name = ?')
        .get(repoId, current.parent_name);
      if (!parent) break;
      ancestors.push({ name: parent.name, kind: parent.kind, file_path: parent.file_path });
      current = parent;
    }
    result.ancestors = ancestors;
  }

  // Descendants: find symbols whose parent_name matches this class
  if (direction === 'descendants' || direction === 'both') {
    const descendants = db
      .prepare(`
      SELECT name, kind, file_path, parent_name FROM code_symbols
      WHERE repo_id = ? AND parent_name = ?
      ORDER BY kind, name
    `)
      .all(repoId, className);
    result.descendants = descendants;
  }

  return result;
}

// ══════════════════════════════════════════════════════════
// SIGNAL CHAINS (HTTP routes, CLI commands → call graph)
// ══════════════════════════════════════════════════════════

const _HTTP_PATTERNS = [
  /\.(get|post|put|delete|patch|head|options|all)\s*\(\s*['"\`]([^'"\`]+)['"\`]/g,
  /\.(use|route)\s*\(\s*['"\`]([^'"\`]+)['"\`]/g,
];

const _CLI_PATTERNS = [/@click\.command\s*\(/g, /@app\.route\s*\(\s*['"\`]([^'"\`]+)['"\`]/g];

function getSignalChains(db, repoId, opts = {}) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  const kind = opts.kind || null; // 'http', 'cli', or null for all
  const symbol = opts.symbol || null;
  const maxDepth = opts.maxDepth || 5;

  // Get all symbols with their signatures
  const symbols = db
    .prepare('SELECT id, name, kind, file_path, signature, start_line FROM code_symbols WHERE repo_id = ?')
    .all(repoId);

  // Build call graph for tracing
  const calls = db
    .prepare('SELECT caller_symbol_id, callee_name, callee_symbol_id FROM code_calls WHERE repo_id = ?')
    .all(repoId);

  const callGraph = new Map(); // caller_id → [{callee_id, callee_name}]
  for (const c of calls) {
    if (!callGraph.has(c.caller_symbol_id)) callGraph.set(c.caller_symbol_id, []);
    callGraph.get(c.caller_symbol_id).push({ callee_id: c.callee_symbol_id, callee_name: c.callee_name });
  }

  const symbolMap = new Map(symbols.map((s) => [s.id, s]));

  // Detect gateways from symbol signatures
  const gateways = [];
  for (const sym of symbols) {
    if (!sym.signature) continue;
    const sig = sym.signature;

    // HTTP detection
    if (!kind || kind === 'http') {
      for (const pat of _HTTP_PATTERNS) {
        pat.lastIndex = 0;
        const match = pat.exec(sig);
        if (match) {
          const method = match[1] ? match[1].toUpperCase() : 'ANY';
          const routePath = match[2] || '/';
          gateways.push({
            symbol_id: sym.id,
            name: sym.name,
            kind: 'http',
            method,
            path: routePath,
            file_path: sym.file_path,
            line: sym.start_line,
          });
          break;
        }
      }
    }

    // CLI detection
    if (!kind || kind === 'cli') {
      for (const pat of _CLI_PATTERNS) {
        pat.lastIndex = 0;
        const match = pat.exec(sig);
        if (match) {
          const routePath = match[1] || sym.name;
          gateways.push({
            symbol_id: sym.id,
            name: sym.name,
            kind: 'cli',
            method: 'CLI',
            path: routePath,
            file_path: sym.file_path,
            line: sym.start_line,
          });
          break;
        }
      }
    }
  }

  // If a specific symbol is requested, filter to chains containing it
  if (symbol) {
    const symRow = db.prepare('SELECT id, name FROM code_symbols WHERE repo_id = ? AND name = ?').get(repoId, symbol);
    if (!symRow) return { chains: [], note: `Symbol "${symbol}" not found` };

    // Trace upstream to find which gateway leads to this symbol
    const visited = new Set();
    const queue = [symRow.id];
    const parentMap = new Map();

    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      const callers = db
        .prepare('SELECT caller_symbol_id FROM code_calls WHERE callee_symbol_id = ? AND repo_id = ?')
        .all(current, repoId);
      for (const c of callers) {
        if (!visited.has(c.caller_symbol_id)) {
          parentMap.set(c.caller_symbol_id, current);
          queue.push(c.caller_symbol_id);
        }
      }
    }

    // Find which gateways are in the visited set
    const relevantGateways = gateways.filter((g) => visited.has(g.symbol_id));
    if (relevantGateways.length === 0) {
      return { chains: [], note: `No signal chain found for "${symbol}"` };
    }

    // Reconstruct chains from each gateway to the target symbol
    const chains = relevantGateways.map((gw) => {
      const chain = [{ symbol_id: gw.symbol_id, name: gw.name, kind: gw.kind, method: gw.method, path: gw.path }];
      let current = gw.symbol_id;
      while (parentMap.has(current) && current !== symRow.id) {
        const next = parentMap.get(current);
        const nextSym = symbolMap.get(next);
        chain.push({ symbol_id: next, name: nextSym ? nextSym.name : `id:${next}`, kind: 'callee' });
        current = next;
      }
      return { gateway: gw, chain };
    });

    return { symbol: symRow.name, chains };
  }

  // Discovery mode: return all gateways with their callees traced N levels deep
  const chains = gateways.map((gw) => {
    const chain = [{ symbol_id: gw.symbol_id, name: gw.name, kind: gw.kind, method: gw.method, path: gw.path }];
    let current = gw.symbol_id;
    const visited = new Set([current]);

    for (let depth = 0; depth < maxDepth; depth++) {
      const callees = callGraph.get(current) || [];
      if (callees.length === 0) break;
      // Follow the first resolved callee (most common path)
      const resolved = callees.find((c) => c.callee_id) || callees[0];
      if (!resolved || visited.has(resolved.callee_id || 0)) break;
      const calleeSym = resolved.callee_id ? symbolMap.get(resolved.callee_id) : null;
      chain.push({
        symbol_id: resolved.callee_id,
        name: resolved.callee_name,
        kind: calleeSym ? calleeSym.kind : 'unknown',
      });
      if (resolved.callee_id) visited.add(resolved.callee_id);
      current = resolved.callee_id;
    }

    return { gateway: gw, chain };
  });

  return { chains, gateway_count: gateways.length };
}

// ══════════════════════════════════════════════════════════
// LAYER VIOLATIONS (architectural boundary checks)
// ══════════════════════════════════════════════════════════

function getLayerViolations(db, repoId, opts = {}) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;
  let rules = opts.rules || null;

  // If no rules provided, look for .pimemory-layers.jsonc in repo root
  if (!rules) {
    const repo = db.prepare('SELECT path FROM code_repos WHERE id = ?').get(repoId);
    if (!repo) return { error: 'Repo not found' };

    const fs = require('fs');
    const configPath = path.join(repo.path, '.pimemory-layers.jsonc');
    if (!fs.existsSync(configPath)) {
      return {
        violations: [],
        note: 'No .pimemory-layers.jsonc config found. Create one to enable layer violation detection.',
      };
    }

    try {
      let content = fs.readFileSync(configPath, 'utf-8');
      // Strip JSONC comments
      content = content.replace(/\/\/.*$/gm, '');
      rules = JSON.parse(content);
    } catch (e) {
      return { error: `Failed to parse .pimemory-layers.jsonc: ${e.message}` };
    }
  }

  if (!rules || !rules.layers) {
    return { error: 'Invalid layer rules: missing "layers" array.' };
  }

  // Get all imports for this repo
  const imports = db
    .prepare(`
    SELECT cf_source.path as source_path, cf_target.path as target_path, ci.import_type
    FROM code_imports ci
    JOIN code_files cf_source ON cf_source.id = ci.source_file_id
    LEFT JOIN code_files cf_target ON cf_target.id = ci.target_file_id
    WHERE ci.repo_id = ? AND ci.target_file_id IS NOT NULL
  `)
    .all(repoId);

  // Determine which layer a file belongs to
  function fileLayer(filePath, layers) {
    for (const layer of layers) {
      for (const prefix of layer.paths) {
        if (filePath.includes(prefix)) return layer.name;
      }
    }
    return null; // Unaffiliated file
  }

  const violations = [];
  const layerMap = new Map();
  for (const layer of rules.layers) {
    layerMap.set(layer.name, new Set(layer.may_not_import || []));
  }

  for (const imp of imports) {
    const sourceLayer = fileLayer(imp.source_path, rules.layers);
    const targetLayer = fileLayer(imp.target_path, rules.layers);

    if (!sourceLayer || !targetLayer) continue; // Skip unaffiliated files
    if (sourceLayer === targetLayer) continue; // Same layer, ok

    const forbidden = layerMap.get(sourceLayer);
    if (forbidden && forbidden.has(targetLayer)) {
      violations.push({
        source: imp.source_path,
        source_layer: sourceLayer,
        target: imp.target_path,
        target_layer: targetLayer,
        rule: `${sourceLayer} may not import ${targetLayer}`,
      });
    }
  }

  return { violations, total: violations.length };
}

module.exports = {
  buildImportGraph,
  buildCallGraph,
  buildComplexity,
  getImportGraph,
  getCallHierarchy,
  getBlastRadius,
  getDeadCode,
  getComplexity,
  getFileOutline,
  getHotspots,
  getDependencyCycles,
  getSymbolImportance,
  getCouplingMetrics,
  getExtractionCandidates,
  getClassHierarchy,
  getSignalChains,
  getLayerViolations,
};
