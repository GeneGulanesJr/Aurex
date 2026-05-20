// Call graph extraction, callee resolution, and call hierarchy queries.

const { codeParser, _requireNativeDb, CALL_GRAPH, _SKIP_CALLEE_NAMES } = require('./shared-deps');
const { extractImportBindings } = require('./import-graph-impl');

function buildCallGraph(db, repoId, opts = {}) {
  const guard = _requireNativeDb(db);
  if (guard) {
    return guard;
  }
  const { onProgress } = opts;

  db.prepare('DELETE FROM code_calls WHERE repo_id = ?').run(repoId);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO code_calls (repo_id, caller_symbol_id, callee_name, callee_symbol_id, confidence, line_number) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const allSymbols = db
    .prepare(
      'SELECT id, name, file_id, file_path, parent_name, kind, qualified_name, start_byte, end_byte, start_line, end_line FROM code_symbols WHERE repo_id = ?',
    )
    .all(repoId);

  const symbolsByName = new Map();
  const symbolsByQualified = new Map();
  const symbolsByFile = new Map();
  for (const sym of allSymbols) {
    if (!symbolsByName.has(sym.name)) {
      symbolsByName.set(sym.name, []);
    }
    symbolsByName.get(sym.name).push(sym);
    if (sym.qualified_name && sym.qualified_name !== sym.name) {
      if (!symbolsByQualified.has(sym.qualified_name)) {
        symbolsByQualified.set(sym.qualified_name, []);
      }
      symbolsByQualified.get(sym.qualified_name).push(sym);
    }
    if (!symbolsByFile.has(sym.file_id)) {
      symbolsByFile.set(sym.file_id, []);
    }
    symbolsByFile.get(sym.file_id).push(sym);
  }

  const fileRows = db
    .prepare('SELECT id, path, size_bytes FROM code_files WHERE repo_id = ?')
    .all(repoId);
  const fileById = new Map();
  for (const f of fileRows) {
    fileById.set(f.id, f);
  }
  const contentStmt = db.prepare('SELECT content FROM code_files WHERE id = ?');

  const symbolsByFileAndName = new Map();
  for (const [fileId, syms] of symbolsByFile) {
    const byName = new Map();
    for (const s of syms) {
      if (!byName.has(s.name)) {
        byName.set(s.name, []);
      }
      byName.get(s.name).push(s);
    }
    symbolsByFileAndName.set(fileId, byName);
  }
  const classParentMap = new Map();
  for (const sym of allSymbols) {
    if (sym.kind === 'class' && sym.parent_name) {
      classParentMap.set(sym.name, sym.parent_name);
    }
  }
  const methodsByParent = new Map();
  for (const sym of allSymbols) {
    if (sym.parent_name) {
      if (!methodsByParent.has(sym.parent_name)) {
        methodsByParent.set(sym.parent_name, []);
      }
      methodsByParent.get(sym.parent_name).push(sym);
    }
  }
  const methodsByParentAndName = new Map();
  for (const [parent, methods] of methodsByParent) {
    const byName = new Map();
    for (const m of methods) {
      if (!byName.has(m.name)) {
        byName.set(m.name, []);
      }
      byName.get(m.name).push(m);
    }
    methodsByParentAndName.set(parent, byName);
  }

  let totalCalls = 0;
  const fileImportsCache = {};
  const fileBindingsCache = {};

  function getFileSymbol(fileId, name, kind) {
    const byName = symbolsByFileAndName.get(fileId);
    if (!byName) {
      return null;
    }
    const matches = byName.get(name);
    if (!matches) {
      return null;
    }
    if (kind) {
      return matches.find((s) => s.kind === kind) || null;
    }
    return matches[0] || null;
  }

  function getFileImports(fileId) {
    if (fileImportsCache[fileId]) {
      return fileImportsCache[fileId];
    }
    const imports = db
      .prepare(
        'SELECT target_file_id, target_module FROM code_imports WHERE source_file_id = ? AND target_file_id IS NOT NULL',
      )
      .all(fileId);
    fileImportsCache[fileId] = imports;
    return imports;
  }

  function getFileBindings(fileId, fileContent) {
    if (fileBindingsCache[fileId]) {
      return fileBindingsCache[fileId];
    }
    const bindings = extractImportBindings(fileContent || '');
    const imports = getFileImports(fileId);
    const importMap = new Map();
    for (const imp of imports) {
      importMap.set(imp.target_module, imp.target_file_id);
    }
    const resolved = bindings.map((b) => ({
      ...b,
      target_file_id: importMap.get(b.modulePath) || null,
    }));
    fileBindingsCache[fileId] = resolved;
    return resolved;
  }

  function resolveCallee(calleeName, callerSym, receiver, fileContent) {
    let calleeSymbolId = null;
    let confidence = 0.5;

    const bindings = getFileBindings(callerSym.file_id, fileContent);
    const bindingMatch = bindings.find((b) => b.localName === calleeName && !b.isReExport);
    if (bindingMatch) {
      const originalName = bindingMatch.originalName;
      if (bindingMatch.target_file_id) {
        if (originalName === '*' || originalName === 'default') {
          const matchSym = getFileSymbol(bindingMatch.target_file_id, calleeName);
          if (matchSym) {
            return { calleeSymbolId: matchSym.id, confidence: 1.0, resolvedVia: 'import-binding' };
          }
        } else {
          const matchSym = getFileSymbol(bindingMatch.target_file_id, originalName);
          if (matchSym) {
            return { calleeSymbolId: matchSym.id, confidence: 1.0, resolvedVia: 'import-binding-alias' };
          }
        }
      }
    }

    if (receiver === 'this' && callerSym.parent_name) {
      const qualifiedName = `${callerSym.parent_name}.${calleeName}`;
      const qualifiedMatches = symbolsByQualified.get(qualifiedName);
      if (qualifiedMatches && qualifiedMatches.length === 1) {
        return { calleeSymbolId: qualifiedMatches[0].id, confidence: 0.95, resolvedVia: 'this-dispatch' };
      }
      if (qualifiedMatches && qualifiedMatches.length > 1) {
        const sameFile = qualifiedMatches.find((m) => m.file_id === callerSym.file_id);
        if (sameFile) {
          return { calleeSymbolId: sameFile.id, confidence: 0.9, resolvedVia: 'this-dispatch-same-file' };
        }
      }
    }

    if (receiver === 'super' && callerSym.parent_name) {
      const parentName = classParentMap.get(callerSym.parent_name);
      if (parentName) {
        const superQualified = `${parentName}.${calleeName}`;
        const superMatches = symbolsByQualified.get(superQualified);
        if (superMatches && superMatches.length === 1) {
          return { calleeSymbolId: superMatches[0].id, confidence: 0.9, resolvedVia: 'super-dispatch' };
        }
      }
    }

    if (receiver && receiver !== 'this' && receiver !== 'super') {
      const binding = bindings.find((b) => b.localName === receiver && !b.isReExport);
      if (binding && binding.target_file_id) {
        if (binding.originalName === '*') {
          const matchSym = getFileSymbol(binding.target_file_id, calleeName, 'function');
          if (matchSym) {
            return { calleeSymbolId: matchSym.id, confidence: 0.95, resolvedVia: 'namespace-member' };
          }
        }
        const resolvedName = binding.originalName === 'default' ? receiver : binding.originalName;
        const classSym = getFileSymbol(binding.target_file_id, resolvedName, 'class');
        if (classSym) {
          const parentMethods = methodsByParentAndName.get(resolvedName);
          const methodSym = parentMethods ? parentMethods.get(calleeName)?.[0] || null : null;
          if (methodSym) {
            return { calleeSymbolId: methodSym.id, confidence: 0.9, resolvedVia: 'object-type-member' };
          }
        }
      }

      const qualifiedName = `${receiver}.${calleeName}`;
      const qualifiedMatches = symbolsByQualified.get(qualifiedName);
      if (qualifiedMatches && qualifiedMatches.length === 1) {
        return { calleeSymbolId: qualifiedMatches[0].id, confidence: 0.85, resolvedVia: 'qualified-name' };
      }
    }

    const fileImports = getFileImports(callerSym.file_id);
    for (const imp of fileImports) {
      const matchSym = getFileSymbol(imp.target_file_id, calleeName);
      if (matchSym) {
        calleeSymbolId = matchSym.id;
        confidence = 0.8;
        break;
      }
    }

    if (!calleeSymbolId) {
      const sameFile = getFileSymbol(callerSym.file_id, calleeName);
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

  function findEnclosingSymbol(line, fileSymbols) {
    for (const sym of fileSymbols) {
      if (line >= sym.start_line && line <= sym.end_line) {
        return sym;
      }
    }
    return null;
  }

  function processRegexFallback(sym, fileContent) {
    if (sym.end_byte <= sym.start_byte) {
      return;
    }
    const body = Buffer.from(fileContent, 'utf-8').toString('utf-8', sym.start_byte, sym.end_byte);
    if (!body || body.length < 2) {
      return;
    }

    const seen = new Set();
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
        if (_SKIP_CALLEE_NAMES.has(calleeName)) {
          // oxlint-disable-next-line no-continue
          continue;
        }
        if (seen.has(calleeName)) {
          // oxlint-disable-next-line no-continue
          continue;
        }
        seen.add(calleeName);

        const { calleeSymbolId, confidence } = resolveCallee(calleeName, sym, null, fileContent);
        const lineNum = sym.start_line + body.substring(0, match.index).split('\n').length - 1;
        insertStmt.run(repoId, sym.id, calleeName, calleeSymbolId, confidence, lineNum);
        totalCalls++;
      }
    }
  }

  const totalFiles = symbolsByFile.size;
  let processedFiles = 0;

  const runInTx = typeof db.transaction === 'function'
    ? (fn) => db.transaction(fn)()
    : (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  runInTx(() => {
    for (const [fileId, fileSymbols] of symbolsByFile) {
      const meta = fileById.get(fileId);
      if (!meta) {
        processedFiles++;
        // oxlint-disable-next-line no-continue
        continue;
      }

      const contentRow = contentStmt.get(fileId);
      if (!contentRow || !contentRow.content) {
        processedFiles++;
        // oxlint-disable-next-line no-continue
        continue;
      }

      const fileContent = contentRow.content;
      const filePath = meta.path;
      const fileSize = fileContent.length;

      let fileCallees = [];
      if (fileSize <= CALL_GRAPH.MAX_FILE_CONTENT_BYTES) {
        try {
          const extractFn = codeParser.extractCalleesFromContent || codeParser.extractCallees;
          fileCallees = extractFn(filePath, fileContent);
        } catch (_) {
          fileCallees = [];
        }
      }

      if (fileCallees.length > 0) {
        const calleeByLine = new Map();
        for (const c of fileCallees) {
          if (!calleeByLine.has(c.line)) {
            calleeByLine.set(c.line, []);
          }
          calleeByLine.get(c.line).push(c);
        }

        for (const sym of fileSymbols) {
          const seen = new Set();
          for (let line = sym.start_line; line <= sym.end_line; line++) {
            const lineCallees = calleeByLine.get(line);
            if (!lineCallees) {
              // oxlint-disable-next-line no-continue
              continue;
            }
            for (const c of lineCallees) {
              if (_SKIP_CALLEE_NAMES.has(c.callee)) {
                // oxlint-disable-next-line no-continue
                continue;
              }
              const key = `${c.callee}:${c.line}`;
              if (seen.has(key)) {
                // oxlint-disable-next-line no-continue
                continue;
              }
              seen.add(key);

              const { calleeSymbolId, confidence } = resolveCallee(c.callee, sym, c.receiver || null, fileContent);
              insertStmt.run(repoId, sym.id, c.callee, calleeSymbolId, confidence, c.line);
              totalCalls++;
            }
          }
        }
      } else {
        for (const sym of fileSymbols) {
          processRegexFallback(sym, fileContent);
        }
      }

      processedFiles++;
      if (onProgress && processedFiles % CALL_GRAPH.PROGRESS_INTERVAL_FILES === 0) {
        onProgress({ filesProcessed: processedFiles, totalFiles, callsFound: totalCalls });
      }
    }
  });

  return { success: true, calls: totalCalls };
}

function getCallHierarchy(db, repoId, opts) {
  const guard = _requireNativeDb(db);
  if (guard) {
    return guard;
  }
  const { symbol, direction = 'callers', depth = 3, minConfidence = 0.0 } = opts;
  if (!symbol) {
    return { error: 'Missing --symbol' };
  }

  const symRow = db
    .prepare('SELECT id, name, file_path FROM code_symbols WHERE repo_id = ? AND name = ?')
    .all(repoId, symbol);
  if (symRow.length === 0) {
    return { error: `Symbol "${symbol}" not found` };
  }
  if (symRow.length > 1) {
    return { error: `Multiple symbols named "${symbol}"`, candidates: symRow };
  }

  const symbolId = symRow[0].id;

  if (direction === 'callers') {
    const rows = db
      .prepare(`
      WITH RECURSIVE upstream AS (
        SELECT cc.caller_symbol_id, cs.name, cs.file_path, 1 as depth
        FROM code_calls cc JOIN code_symbols cs ON cs.id = cc.caller_symbol_id
        WHERE cc.callee_symbol_id = ? AND cc.confidence >= ?
        UNION ALL
        SELECT cc.caller_symbol_id, cs.name, cs.file_path, u.depth + 1
        FROM code_calls cc JOIN upstream u ON cc.callee_symbol_id = u.caller_symbol_id JOIN code_symbols cs ON cs.id = cc.caller_symbol_id
        WHERE u.depth < ? AND cc.confidence >= ?
      ) SELECT * FROM upstream
    `)
      .all(symbolId, minConfidence, depth, minConfidence);
    return { symbol: symRow[0].name, direction: 'callers', depth, callers: rows };
  }

  const rows = db
    .prepare(`
    WITH RECURSIVE downstream AS (
      SELECT cc.callee_name, cc.callee_symbol_id, cs.file_path, cc.confidence, 1 as depth
      FROM code_calls cc LEFT JOIN code_symbols cs ON cs.id = cc.callee_symbol_id
      WHERE cc.caller_symbol_id = ? AND cc.confidence >= ?
      UNION ALL
      SELECT cc.callee_name, cc.callee_symbol_id, cs.file_path, cc.confidence, d.depth + 1
      FROM code_calls cc JOIN downstream d ON cc.caller_symbol_id = d.callee_symbol_id LEFT JOIN code_symbols cs ON cs.id = cc.callee_symbol_id
      WHERE d.depth < ? AND cc.confidence >= ?
    ) SELECT * FROM downstream
  `)
    .all(symbolId, minConfidence, depth, minConfidence);
  return { symbol: symRow[0].name, direction: 'callees', depth, callees: rows };
}



module.exports = {
  buildCallGraph,
  getCallHierarchy,
};
