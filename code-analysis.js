/**
 * code-analysis.js — Import graph, call graph, dead code, complexity
 *
 * All functions receive the shared SQLite db handle.
 * Requires parse-code.js to be initialized for some features.
 */

const path = require('path');

// Names to skip in call extraction
const _SKIP_CALLEE_NAMES = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'try', 'catch', 'finally',
  'class', 'function', 'return', 'throw', 'new', 'typeof', 'instanceof', 'void',
  'delete', 'in', 'of', 'yield', 'await', 'async', 'export', 'import', 'from',
  'const', 'let', 'var', 'true', 'false', 'null', 'undefined', 'this', 'super',
  'constructor', 'extends', 'static', 'get', 'set',
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
    resolved, resolved + '.js', resolved + '.mjs', resolved + '.cjs',
    resolved + '.ts', resolved + '.mts', resolved + '.cts', resolved + '.tsx',
    path.join(resolved, 'index.js'), path.join(resolved, 'index.ts'),
    path.join(resolved, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    const row = db.prepare('SELECT id FROM code_files WHERE repo_id = ? AND path = ?').get(repoId, candidate);
    if (row) return row.id;
  }
  return null;
}

function buildImportGraph(db, repoId) {
  db.prepare('DELETE FROM code_imports WHERE repo_id = ?').run(repoId);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO code_imports (repo_id, source_file_id, target_module, target_file_id, import_type, line_number) VALUES (?, ?, ?, ?, ?, ?)`
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
  const { file, direction = 'both', depth = 1 } = opts;

  if (depth <= 1 && file) {
    const fileRow = db.prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?').get(repoId, `%${file}%`);
    if (!fileRow) return { error: `File not found: ${file}` };

    const edges = db.prepare(`
      SELECT ci.import_type, ci.line_number, ci.target_module, sf.path as source_file, tf.path as target_file
      FROM code_imports ci JOIN code_files sf ON sf.id = ci.source_file_id LEFT JOIN code_files tf ON tf.id = ci.target_file_id
      WHERE ci.repo_id = ? AND (ci.source_file_id = ? OR ci.target_file_id = ?)
    `).all(repoId, fileRow.id, fileRow.id);

    return { edges: edges.map(r => ({ source: r.source_file, target: r.target_file || r.target_module, type: r.import_type, line: r.line_number })) };
  }

  if (depth > 1 && file) {
    const fileRow = db.prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?').get(repoId, `%${file}%`);
    if (!fileRow) return { error: `File not found: ${file}` };

    const result = {};
    if (direction === 'imports' || direction === 'both') {
      result.downstream = db.prepare(`
        WITH RECURSIVE deps AS (
          SELECT target_file_id as file_id, 1 as depth FROM code_imports WHERE source_file_id = ? AND target_file_id IS NOT NULL
          UNION ALL SELECT ci.target_file_id, d.depth + 1 FROM code_imports ci JOIN deps d ON ci.source_file_id = d.file_id WHERE d.depth < ? AND ci.target_file_id IS NOT NULL
        ) SELECT DISTINCT cf.path, d.depth FROM deps d JOIN code_files cf ON cf.id = d.file_id
      `).all(fileRow.id, depth);
    }
    if (direction === 'importers' || direction === 'both') {
      result.upstream = db.prepare(`
        WITH RECURSIVE imp AS (
          SELECT source_file_id as file_id, 1 as depth FROM code_imports WHERE target_file_id = ? AND source_file_id IS NOT NULL
          UNION ALL SELECT ci.source_file_id, u.depth + 1 FROM code_imports ci JOIN imp u ON ci.target_file_id = u.file_id WHERE u.depth < ? AND ci.source_file_id IS NOT NULL
        ) SELECT DISTINCT cf.path, u.depth FROM imp u JOIN code_files cf ON cf.id = u.file_id
      `).all(fileRow.id, depth);
    }
    return result;
  }

  // Repo-wide: just return all edges
  const edges = db.prepare(`
    SELECT ci.import_type, ci.target_module, sf.path as source_file, tf.path as target_file
    FROM code_imports ci JOIN code_files sf ON sf.id = ci.source_file_id LEFT JOIN code_files tf ON tf.id = ci.target_file_id
    WHERE ci.repo_id = ? LIMIT 500
  `).all(repoId);

  return { edges: edges.map(r => ({ source: r.source_file, target: r.target_file || r.target_module, type: r.import_type })) };
}

// ══════════════════════════════════════════════════════════
// CALL GRAPH
// ══════════════════════════════════════════════════════════

function buildCallGraph(db, repoId) {
  db.prepare('DELETE FROM code_calls WHERE repo_id = ?').run(repoId);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO code_calls (repo_id, caller_symbol_id, callee_name, callee_symbol_id, confidence, line_number) VALUES (?, ?, ?, ?, ?, ?)`
  );

  const symbols = db.prepare(`
    SELECT cs.id, cs.name, cs.file_id, cs.file_path, cs.start_byte, cs.end_byte, cs.start_line, cf.content as file_content
    FROM code_symbols cs JOIN code_files cf ON cf.id = cs.file_id WHERE cs.repo_id = ?
  `).all(repoId);

  // Build name → symbol lookup
  const allSymbols = db.prepare('SELECT id, name, file_id, file_path FROM code_symbols WHERE repo_id = ?').all(repoId);
  const symbolsByName = new Map();
  for (const sym of allSymbols) {
    if (!symbolsByName.has(sym.name)) symbolsByName.set(sym.name, []);
    symbolsByName.get(sym.name).push(sym);
  }

  let totalCalls = 0;

  for (const sym of symbols) {
    if (!sym.file_content || sym.end_byte <= sym.start_byte) continue;

    const body = Buffer.from(sym.file_content, 'utf-8')
      .toString('utf-8', sym.start_byte, sym.end_byte);

    if (!body || body.length < 2) continue;

    const callPatterns = [
      /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      /\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      /\bnew\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
    ];

    const seen = new Set();

    for (const pattern of callPatterns) {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(body)) !== null) {
        const calleeName = match[1];
        if (_SKIP_CALLEE_NAMES.has(calleeName)) continue;
        if (seen.has(calleeName)) continue;
        seen.add(calleeName);

        let calleeSymbolId = null;
        let confidence = 0.7;

        // Import-aware resolution
        const fileImports = db.prepare(
          'SELECT target_file_id FROM code_imports WHERE source_file_id = ? AND target_file_id IS NOT NULL'
        ).all(sym.file_id);

        for (const imp of fileImports) {
          const matchSym = db.prepare('SELECT id FROM code_symbols WHERE file_id = ? AND name = ? LIMIT 1').get(imp.target_file_id, calleeName);
          if (matchSym) { calleeSymbolId = matchSym.id; confidence = 1.0; break; }
        }

        if (!calleeSymbolId) {
          const sameFile = db.prepare('SELECT id FROM code_symbols WHERE file_id = ? AND name = ? LIMIT 1').get(sym.file_id, calleeName);
          if (sameFile) { calleeSymbolId = sameFile.id; confidence = 0.9; }
        }

        if (!calleeSymbolId) {
          const matches = symbolsByName.get(calleeName);
          if (matches && matches.length === 1) { calleeSymbolId = matches[0].id; confidence = 0.7; }
        }

        const lineNum = sym.start_line + body.substring(0, match.index).split('\n').length - 1;
        insertStmt.run(repoId, sym.id, calleeName, calleeSymbolId, confidence, lineNum);
        totalCalls++;
      }
    }
  }

  return { success: true, calls: totalCalls };
}

function getCallHierarchy(db, repoId, opts) {
  const { symbol, direction = 'callers', depth = 3 } = opts;
  if (!symbol) return { error: 'Missing --symbol' };

  const symRow = db.prepare('SELECT id, name, file_path FROM code_symbols WHERE repo_id = ? AND name = ?').all(repoId, symbol);
  if (symRow.length === 0) return { error: `Symbol "${symbol}" not found` };
  if (symRow.length > 1) return { error: `Multiple symbols named "${symbol}"`, candidates: symRow };

  const symbolId = symRow[0].id;

  if (direction === 'callers') {
    const rows = db.prepare(`
      WITH RECURSIVE upstream AS (
        SELECT cc.caller_symbol_id, cs.name, cs.file_path, 1 as depth FROM code_calls cc JOIN code_symbols cs ON cs.id = cc.caller_symbol_id WHERE cc.callee_symbol_id = ?
        UNION ALL SELECT cc.caller_symbol_id, cs.name, cs.file_path, u.depth + 1 FROM code_calls cc JOIN upstream u ON cc.callee_symbol_id = u.caller_symbol_id JOIN code_symbols cs ON cs.id = cc.caller_symbol_id WHERE u.depth < ?
      ) SELECT * FROM upstream
    `).all(symbolId, depth);
    return { symbol: symRow[0].name, direction: 'callers', depth, callers: rows };
  }

  const rows = db.prepare(`
    WITH RECURSIVE downstream AS (
      SELECT cc.callee_name, cc.callee_symbol_id, cs.file_path, cc.confidence, 1 as depth FROM code_calls cc LEFT JOIN code_symbols cs ON cs.id = cc.callee_symbol_id WHERE cc.caller_symbol_id = ?
      UNION ALL SELECT cc.callee_name, cc.callee_symbol_id, cs.file_path, cc.confidence, d.depth + 1 FROM code_calls cc JOIN downstream d ON cc.caller_symbol_id = d.callee_symbol_id LEFT JOIN code_symbols cs ON cs.id = cc.callee_symbol_id WHERE d.depth < ?
    ) SELECT * FROM downstream
  `).all(symbolId, depth);
  return { symbol: symRow[0].name, direction: 'callees', depth, callees: rows };
}

// ══════════════════════════════════════════════════════════
// BLAST RADIUS
// ══════════════════════════════════════════════════════════

function getBlastRadius(db, repoId, opts) {
  const { symbol, depth = 3 } = opts;
  if (!symbol) return { error: 'Missing --symbol' };

  const symRow = db.prepare('SELECT id, name, file_id, file_path FROM code_symbols WHERE repo_id = ? AND name = ?').all(repoId, symbol);
  if (symRow.length === 0) return { error: `Symbol "${symbol}" not found` };
  if (symRow.length > 1) return { error: `Multiple symbols named "${symbol}"`, candidates: symRow };

  const symbolId = symRow[0].id;
  const fileId = symRow[0].file_id;

  const callers = db.prepare(`
    WITH RECURSIVE upstream AS (
      SELECT cc.caller_symbol_id, cs.name, cs.file_path, 1 as depth FROM code_calls cc JOIN code_symbols cs ON cs.id = cc.caller_symbol_id WHERE cc.callee_symbol_id = ?
      UNION ALL SELECT cc.caller_symbol_id, cs.name, cs.file_path, u.depth + 1 FROM code_calls cc JOIN upstream u ON cc.callee_symbol_id = u.caller_symbol_id JOIN code_symbols cs ON cs.id = cc.caller_symbol_id WHERE u.depth < ?
    ) SELECT * FROM upstream
  `).all(symbolId, depth);

  const fileImporters = db.prepare(`
    WITH RECURSIVE imp AS (
      SELECT ci.source_file_id, cf.path, 1 as depth FROM code_imports ci JOIN code_files cf ON cf.id = ci.source_file_id WHERE ci.target_file_id = ? AND ci.target_file_id IS NOT NULL
      UNION ALL SELECT ci.source_file_id, cf.path, u.depth + 1 FROM code_imports ci JOIN imp u ON ci.target_file_id = u.source_file_id JOIN code_files cf ON cf.id = ci.source_file_id WHERE u.depth < ? AND ci.target_file_id IS NOT NULL
    ) SELECT DISTINCT path, depth FROM imp
  `).all(fileId, depth);

  return {
    symbol: symRow[0].name, file: symRow[0].file_path,
    callers, file_importers: fileImporters,
    affected_files: [...new Set([...callers.map(c => c.file_path), ...fileImporters.map(f => f.path)])],
  };
}

// ══════════════════════════════════════════════════════════
// DEAD CODE
// ══════════════════════════════════════════════════════════

function getDeadCode(db, repoId, opts) {
  const minConfidence = opts.minConfidence || 0.5;
  const includeTests = opts.includeTests || false;

  // Gather entry points
  const entryFiles = new Set();
  const entryPatterns = ['%main.js', '%index.js', '%index.ts', '%mod.ts', '%cli.js'];
  for (const pattern of entryPatterns) {
    const rows = db.prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?').all(repoId, pattern);
    for (const r of rows) entryFiles.add(r.id);
  }
  const shebangFiles = db.prepare("SELECT id FROM code_files WHERE repo_id = ? AND content LIKE '#!/usr/bin/env%'").all(repoId);
  for (const r of shebangFiles) entryFiles.add(r.id);
  const exportDefaultFiles = db.prepare("SELECT id FROM code_files WHERE repo_id = ? AND content LIKE '%export default%'").all(repoId);
  for (const r of exportDefaultFiles) entryFiles.add(r.id);

  // BFS from entry points through import graph
  const reachable = new Set(entryFiles);
  const queue = [...entryFiles];
  while (queue.length > 0) {
    const current = queue.shift();
    const importers = db.prepare('SELECT DISTINCT source_file_id FROM code_imports WHERE target_file_id = ? AND source_file_id IS NOT NULL').all(current);
    for (const imp of importers) {
      if (!reachable.has(imp.source_file_id)) { reachable.add(imp.source_file_id); queue.push(imp.source_file_id); }
    }
  }

  const allFiles = db.prepare('SELECT id, path FROM code_files WHERE repo_id = ?').all(repoId);
  const deadFiles = allFiles.filter(f => !reachable.has(f.id));
  const deadFileSet = new Set(deadFiles.map(f => f.id));

  // Symbols with zero callers
  const uncalledSymbols = db.prepare(`
    SELECT cs.id, cs.name, cs.file_path, cs.kind, cs.file_id FROM code_symbols cs
    WHERE cs.repo_id = ? AND cs.id NOT IN (SELECT callee_symbol_id FROM code_calls WHERE callee_symbol_id IS NOT NULL AND repo_id = ?)
  `).all(repoId, repoId);

  const results = [];
  for (const sym of uncalledSymbols) {
    const isFileDead = deadFileSet.has(sym.file_id);
    const isReExported = db.prepare("SELECT 1 FROM code_imports WHERE target_file_id = ? AND import_type = 're-export' LIMIT 1").get(sym.file_id);

    let confidence = 0;
    const signals = [];
    if (!isReExported) { confidence += 0.33; signals.push('no_callers'); }
    if (isFileDead) { confidence += 0.34; signals.push('unreachable_file'); }

    if (!includeTests && /test|spec|__tests__|\.test\./.test(sym.file_path)) continue;
    if (confidence >= minConfidence) {
      results.push({ symbol_id: sym.id, name: sym.name, kind: sym.kind, file: sym.file_path, confidence: Math.round(confidence * 100) / 100, signals });
    }
  }

  return { dead_files: deadFiles.map(f => ({ id: f.id, path: f.path })), dead_symbols: results, total_symbols: allFiles.length };
}

// ══════════════════════════════════════════════════════════
// COMPLEXITY
// ══════════════════════════════════════════════════════════

function buildComplexity(db, repoId) {
  db.prepare('DELETE FROM symbol_complexity WHERE symbol_id IN (SELECT id FROM code_symbols WHERE repo_id = ?)').run(repoId);

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO symbol_complexity (symbol_id, cyclomatic, nesting_depth, param_count, lines_of_code, assessment) VALUES (?, ?, ?, ?, ?, ?)`
  );

  const symbols = db.prepare(`
    SELECT cs.id, cs.name, cs.start_byte, cs.end_byte, cs.start_line, cs.end_line, cs.signature, cf.content as file_content
    FROM code_symbols cs JOIN code_files cf ON cf.id = cs.file_id WHERE cs.repo_id = ? AND cs.kind IN ('function', 'method')
  `).all(repoId);

  let count = 0;
  for (const sym of symbols) {
    if (!sym.file_content || sym.end_byte <= sym.start_byte) continue;
    const body = Buffer.from(sym.file_content, 'utf-8').toString('utf-8', sym.start_byte, sym.end_byte);
    if (!body) continue;

    let cyclomatic = 1;
    const decisionPatterns = [/\bif\b/g, /\belse\s+if\b/g, /\bfor\b/g, /\bwhile\b/g, /\bdo\b/g, /\bcase\b/g, /\bcatch\b/g, /\&\&/g, /\|\|/g, /\?\?/g, /\?\s*[^.]/g];
    for (const pattern of decisionPatterns) { const m = body.match(pattern); if (m) cyclomatic += m.length; }

    let maxDepth = 0, currentDepth = 0;
    for (const ch of body) {
      if (ch === '{') { currentDepth++; maxDepth = Math.max(maxDepth, currentDepth); }
      if (ch === '}') currentDepth--;
    }

    const sigMatch = sym.signature ? sym.signature.match(/\(([^)]*)\)/) : null;
    const paramCount = sigMatch ? sigMatch[1].split(',').filter(p => p.trim()).length : 0;
    const lines = body.split('\n');
    const codeLines = lines.filter(l => l.trim() && !l.trim().startsWith('//')).length;
    const assessment = cyclomatic <= 4 ? 'low' : cyclomatic <= 10 ? 'medium' : 'high';

    insertStmt.run(sym.id, cyclomatic, maxDepth, paramCount, codeLines, assessment);
    count++;
  }

  return { success: true, symbols: count };
}

function getComplexity(db, repoId, symbolId) {
  if (symbolId) {
    const row = db.prepare('SELECT sc.*, cs.name, cs.file_path FROM symbol_complexity sc JOIN code_symbols cs ON cs.id = sc.symbol_id WHERE sc.symbol_id = ?').get(symbolId);
    if (!row) return { error: 'Complexity not computed' };
    return row;
  }
  return db.prepare('SELECT sc.*, cs.name, cs.file_path FROM symbol_complexity sc JOIN code_symbols cs ON cs.id = sc.symbol_id WHERE cs.repo_id = ? ORDER BY sc.cyclomatic DESC').all(repoId);
}

// ══════════════════════════════════════════════════════════
// FILE OUTLINE
// ══════════════════════════════════════════════════════════

function getFileOutline(db, repoId, filePath) {
  const fileRow = db.prepare('SELECT id FROM code_files WHERE repo_id = ? AND path LIKE ?').get(repoId, `%${filePath}%`);
  if (!fileRow) return { error: `File not found: ${filePath}` };

  const symbols = db.prepare(`
    SELECT cs.id, cs.name, cs.kind, cs.start_line, cs.end_line, cs.signature, cs.qualified_name, cs.parent_name,
           sc.cyclomatic, sc.assessment
    FROM code_symbols cs LEFT JOIN symbol_complexity sc ON sc.symbol_id = cs.id
    WHERE cs.repo_id = ? AND cs.file_path LIKE ? ORDER BY cs.start_line
  `).all(repoId, `%${filePath}%`);

  const classes = [];
  const standalone = [];
  for (const sym of symbols) {
    if (sym.parent_name) {
      let cls = classes.find(c => c.name === sym.parent_name);
      if (!cls) { cls = { name: sym.parent_name, methods: [] }; classes.push(cls); }
      cls.methods.push(sym);
    } else {
      standalone.push(sym);
    }
  }

  return { file: filePath, classes, standalone };
}

module.exports = {
  buildImportGraph, buildCallGraph, buildComplexity,
  getImportGraph, getCallHierarchy, getBlastRadius, getDeadCode, getComplexity, getFileOutline,
};
