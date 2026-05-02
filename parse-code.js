#!/usr/bin/env node
/**
 * parse-code.js — web-tree-sitter (WASM) AST parser
 *
 * Replaces parse_code.py. Zero Python dependency.
 * In-process parsing via web-tree-sitter WASM runtime + pre-compiled grammar .wasm files.
 *
 * Usage:
 *   const codeParser = require('./parse-code');
 *   await codeParser.init();
 *   const symbols = codeParser.parseFile('/path/to/file.js');
 *
 * Supported: .js/.mjs/.cjs, .ts/.mts/.cts, .tsx, .sql
 */

const path = require('path');
const fs = require('fs');

const GRAMMAR_DIR = path.resolve(__dirname, 'grammars');

// Language map: file extension → { grammarFile, languageName, parserKey }
const LANGUAGE_MAP = {
  '.js':   { grammarFile: 'javascript.wasm', languageName: 'javascript', parserKey: 'javascript' },
  '.mjs':  { grammarFile: 'javascript.wasm', languageName: 'javascript', parserKey: 'javascript' },
  '.cjs':  { grammarFile: 'javascript.wasm', languageName: 'javascript', parserKey: 'javascript' },
  '.ts':   { grammarFile: 'typescript.wasm', languageName: 'typescript', parserKey: 'typescript' },
  '.mts':  { grammarFile: 'typescript.wasm', languageName: 'typescript', parserKey: 'typescript' },
  '.cts':  { grammarFile: 'typescript.wasm', languageName: 'typescript', parserKey: 'typescript' },
  '.tsx':  { grammarFile: 'tsx.wasm',        languageName: 'typescript', parserKey: 'tsx' },
  '.sql':  { grammarFile: 'sql.wasm',        languageName: 'sql',         parserKey: 'sql' },
};

// ── Module state ──
let _ready = false;
let _initPromise = null;
let _ParserClass = null;
let _LanguageClass = null;
let _parsers = {};   // parserKey → Parser instance
let _languages = {};  // parserKey → Language object

/**
 * Initialize web-tree-sitter and load all available grammar .wasm files.
 * Must be called (and awaited) before parseFile().
 * Safe to call multiple times — returns same promise.
 */
async function init() {
  if (_ready) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const mod = require('web-tree-sitter');
      _ParserClass = mod.Parser;
      _LanguageClass = mod.Language;
      await _ParserClass.init();

      // Load available grammars (key → wasm filename)
      const grammarEntries = Object.entries(LANGUAGE_MAP)
        .map(([, config]) => [config.parserKey, config.grammarFile]);
      // Deduplicate by parserKey
      const uniqueEntries = [...new Map(grammarEntries).entries()];

      for (const [key, wasmFile] of uniqueEntries) {
        const wasmPath = path.join(GRAMMAR_DIR, wasmFile);
        if (!fs.existsSync(wasmPath)) {
          // Skip silently — grammar not bundled
          continue;
        }
        try {
          const lang = await _LanguageClass.load(wasmPath);
          _languages[key] = lang;
          const parser = new _ParserClass();
          parser.setLanguage(lang);
          _parsers[key] = parser;
        } catch (e) {
          console.error(`[parse-code] Failed to load grammar ${wasmFile}: ${e.message}`);
        }
      }

      _ready = Object.keys(_parsers).length > 0;
      if (!_ready) {
        console.error('[parse-code] No grammars loaded. Code indexing disabled.');
      }
    } catch (e) {
      console.error(`[parse-code] Init failed: ${e.message}`);
      _ready = false;
    }
  })();

  return _initPromise;
}

function isReady() {
  return _ready;
}

/**
 * Return info about loaded grammars (for debugging).
 */
function info() {
  return {
    ready: _ready,
    grammars: Object.keys(_parsers),
    grammarDir: GRAMMAR_DIR,
    availableFiles: fs.existsSync(GRAMMAR_DIR)
      ? fs.readdirSync(GRAMMAR_DIR).filter(f => f.endsWith('.wasm'))
      : [],
  };
}

/**
 * Parse a single file and return an array of symbol objects.
 * Returns [] if parser not initialized or file cannot be parsed.
 * Synchronous — must call init() first.
 */
function parseFile(filePath) {
  if (!_ready) return [];

  const ext = path.extname(filePath).toLowerCase();
  const langConfig = LANGUAGE_MAP[ext];
  if (!langConfig) return [];

  const parser = _parsers[langConfig.parserKey];
  if (!parser) return [];

  let source;
  try {
    source = fs.readFileSync(filePath, 'utf-8');
  } catch (_) {
    return [];
  }

  if (langConfig.languageName === 'sql') {
    return _extractSqlSymbols(filePath, source, parser);
  }
  return _extractJsTsSymbols(filePath, source, parser, langConfig.languageName);
}

// ═══════════════════════════════════════════════════════════
// JS/TS symbol extraction
// ═══════════════════════════════════════════════════════════

const _JS_TS_SYMBOL_NODES = {
  'function_declaration': 'function',
  'generator_function_declaration': 'function',
  'class_declaration': 'class',
  'method_definition': 'method',
  'interface_declaration': 'interface',
  'type_alias_declaration': 'type',
  'enum_declaration': 'enum',
  // v5.1: additional symbol types
  'public_field_definition': 'property',
  'assignment_expression': 'constant',
};

const _VARIABLE_FUNCTION_NODES = new Set(['arrow_function', 'function_expression']);

// v5.1: const/let/var declarations that should be extracted as symbols
const _CONST_PATTERN = /^const\s+([A-Z_][A-Z0-9_]*)\s*=/;
const _NAMED_EXPORT_PATTERN = /^export\s+(?:default\s+)?/;

function _getNodeName(node) {
  for (const child of node.children) {
    if (child.type === 'identifier' || child.type === 'type_identifier' || child.type === 'property_identifier') {
      return child.text;
    }
  }
  return null;
}

function _getParentClassName(node) {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'class_declaration') {
      for (const child of parent.children) {
        if (child.type === 'identifier' || child.type === 'type_identifier') {
          return child.text;
        }
      }
    }
    parent = parent.parent;
  }
  return '';
}

function _getSignature(node, sourceStr) {
  const text = sourceStr.substring(node.startIndex, node.endIndex);
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 200 ? firstLine.slice(0, 197) + '...' : firstLine;
}

function _getDocstring(node) {
  if (!node.parent) return '';
  // find index manually — WASM node objects don't support indexOf reference equality
  const parent = node.parent;
  let idx = -1;
  for (let i = 0; i < parent.childCount; i++) {
    if (parent.child(i).id === node.id) { idx = i; break; }
  }
  if (idx <= 0) return '';
  const prev = parent.child(idx - 1);
  if (prev.type === 'comment') {
    let text = prev.text;
    if (text.startsWith('/**')) text = text.slice(3);
    else if (text.startsWith('/*')) text = text.slice(2);
    if (text.endsWith('*/')) text = text.slice(0, -2);
    const lines = text.split('\n');
    const cleaned = [];
    for (let line of lines) {
      line = line.trim();
      if (line.startsWith('* ')) line = line.slice(2);
      else if (line === '*') line = '';
      cleaned.push(line.trim());
    }
    return cleaned.join('\n').trim();
  }
  return '';
}

function _getBodyPreview(node, sourceStr, maxLines = 5) {
  const text = sourceStr.substring(node.startIndex, node.endIndex);
  const lines = text.split('\n');
  const bodyLines = [];
  for (let i = 1; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped) {
      bodyLines.push(stripped);
      if (bodyLines.length >= maxLines) break;
    }
  }
  return bodyLines.join('\n');
}

function _getLineNumber(node) {
  let count = 1;
  let n = node;
  // Walk back to count rows
  // web-tree-sitter provides startPosition.row (0-indexed)
  return node.startPosition.row + 1;
}

function _getEndLineNumber(node) {
  return node.endPosition.row + 1;
}

function _extractJsTsSymbols(filePath, sourceStr, parser, languageName) {
  const tree = parser.parse(sourceStr);
  const root = tree.rootNode;
  const symbols = [];
  const seen = new Set();

  function walk(node) {
    if (node.type in _JS_TS_SYMBOL_NODES) {
      const kind = _JS_TS_SYMBOL_NODES[node.type];
      const name = _getNodeName(node);
      if (name) {
        const key = `${name}:${kind}:${node.startIndex}`;
        if (!seen.has(key)) {
          seen.add(key);
          const parentName = kind === 'method' || kind === 'property' ? _getParentClassName(node) : '';
          const qualified = parentName ? `${parentName}.${name}` : name;
          symbols.push({
            name,
            kind,
            language: languageName,
            file: filePath,
            signature: _getSignature(node, sourceStr),
            qualified_name: qualified,
            start_line: _getLineNumber(node),
            end_line: _getEndLineNumber(node),
            start_byte: node.startIndex,
            end_byte: node.endIndex,
            docstring: _getDocstring(node),
            body_preview: _getBodyPreview(node, sourceStr),
            parent_name: parentName,
          });
        }
      }
    } else if (_VARIABLE_FUNCTION_NODES.has(node.type)) {
      // Arrow functions and function expressions assigned to variables
      const parent = node.parent;
      if (parent && parent.type === 'variable_declarator') {
        let name = null;
        for (const child of parent.children) {
          if (child.type === 'identifier') {
            name = child.text;
            break;
          }
        }
        if (name) {
          const key = `${name}:function:${parent.startIndex}`;
          if (!seen.has(key)) {
            seen.add(key);
            const parentName = _getParentClassName(node);
            const qualified = parentName ? `${parentName}.${name}` : name;
            symbols.push({
              name,
              kind: 'function',
              language: languageName,
              file: filePath,
              signature: _getSignature(parent, sourceStr),
              qualified_name: qualified,
              start_line: _getLineNumber(parent),
              end_line: _getEndLineNumber(parent),
              start_byte: parent.startIndex,
              end_byte: parent.endIndex,
              docstring: _getDocstring(parent),
              body_preview: _getBodyPreview(node, sourceStr),
              parent_name: parentName,
            });
          }
        }
      }
    } else if (node.type === 'variable_declarator') {
      // v5.1: Extract const/let/var assignments as constants or functions
      // SCREAMING_SNAKE = constant; arrow function = function; _prefix = constant
      let name = null;
      let kind = 'constant';
      for (const child of node.children) {
        if (child.type === 'identifier') {
          name = child.text;
          break;
        }
      }
      if (name) {
        // Check if it's an arrow function assignment
        const parent = node.parent;
        let isArrowFn = false;
        if (parent && (parent.type === 'lexical_declaration' || parent.type === 'variable_declaration')) {
          for (const sib of parent.children) {
            if (sib.type === 'const' || sib.type === 'let' || sib.type === 'var') continue;
            if (sib === node) continue;
            if (sib.type === 'variable_declarator') continue;
          }
          // Check if the value is an arrow function
          for (const child of node.children) {
            if (child.type === 'arrow_function' || child.type === 'function_expression') {
              isArrowFn = true;
              break;
            }
          }
        }
        // Determine the kind: arrow function → 'function', SCREAMING_SNAKE or _prefix → 'constant'
        if (isArrowFn) {
          kind = 'function';
        } else if (/^[A-Z_][A-Z0-9_]*$/.test(name) || name.startsWith('_')) {
          kind = 'constant';
        } else {
          // Skip non-constant, non-arrow assignments (like `const result = ...`)
          // unless it's a module-level assignment pattern
          // Actually, extract all named const/let assignments that aren't just data
          kind = 'constant';
        }
        const key = `${name}:${kind}:${node.startIndex}`;
        if (!seen.has(key)) {
          seen.add(key);
          const parentName = _getParentClassName(node);
          const lineText = sourceStr.substring(node.startIndex, Math.min(node.startIndex + 200, sourceStr.length)).split('\n')[0];
          const sig = (parent ? sourceStr.substring(parent.startIndex, parent.endIndex) : lineText).split('\n')[0];
          symbols.push({
            name,
            kind,
            language: languageName,
            file: filePath,
            signature: sig.length > 200 ? sig.slice(0, 197) + '...' : sig,
            qualified_name: parentName ? `${parentName}.${name}` : name,
            start_line: _getLineNumber(node),
            end_line: _getEndLineNumber(node),
            start_byte: node.startIndex,
            end_byte: node.endIndex,
            docstring: _getDocstring(node),
            body_preview: '',
            parent_name: parentName,
          });
        }
      }
    } else if (node.type === 'export_statement' || node.type === 'export_default_statement') {
      // v5.1: Extract export default function X / class X
      for (const child of node.children) {
        if (child.type === 'function_declaration' || child.type === 'class_declaration') {
          const name = _getNodeName(child);
          if (name && !seen.has(`${name}:function:${child.startIndex}`) && !seen.has(`${name}:class:${child.startIndex}`)) {
            // Already handled by the _JS_TS_SYMBOL_NODES walk, just mark as entry point
            // We add an 'export' flag to existing symbols at query time instead
          }
        }
        // export default X;
        if (child.type === 'identifier' && node.type === 'export_default_statement') {
          const name = child.text;
          const key = `${name}:export:${node.startIndex}`;
          if (!seen.has(key)) {
            seen.add(key);
            symbols.push({
              name,
              kind: 'export',
              language: languageName,
              file: filePath,
              signature: `export default ${name}`,
              qualified_name: name,
              start_line: _getLineNumber(node),
              end_line: _getEndLineNumber(node),
              start_byte: node.startIndex,
              end_byte: node.endIndex,
              docstring: '',
              body_preview: '',
              parent_name: '',
            });
          }
        }
      }
    }

    for (const child of node.children) {
      if (child.type === 'statement_block') continue;
      walk(child);
    }
  }

  walk(root);
  tree.delete();
  return symbols;
}

// ═══════════════════════════════════════════════════════════
// SQL symbol extraction
// ═══════════════════════════════════════════════════════════

const SQL_STATEMENT_MAP = {
  'create_table': 'table',
  'create_view': 'view',
  'create_index': 'index',
  'select': 'query',
  'insert': 'query',
  'update': 'query',
  'delete': 'query',
  'alter_table': 'table',
};

function _extractSqlSymbols(filePath, sourceStr, parser) {
  const tree = parser.parse(sourceStr);
  const root = tree.rootNode;
  const symbols = [];

  function getSqlName(node) {
    for (const child of node.children) {
      if (child.type === 'object_reference' || child.type === 'identifier') {
        return child.text;
      }
    }
    return '';
  }

  function walk(node) {
    if (node.type in SQL_STATEMENT_MAP) {
      const kind = SQL_STATEMENT_MAP[node.type];
      let name = getSqlName(node);
      if (!name) {
        name = { select: 'SELECT', insert: 'INSERT', update: 'UPDATE', delete: 'DELETE' }[node.type] || 'UNKNOWN';
      }

      const fullText = node.text;
      let sig = fullText.split('\n')[0].trim();
      if (sig.length > 200) sig = sig.slice(0, 197) + '...';

      const bodyLines = fullText.split('\n').slice(1).map(l => l.trim()).filter(Boolean).slice(0, 5);
      const bodyPreview = bodyLines.join('\n');

      symbols.push({
        name,
        kind,
        language: 'sql',
        file: filePath,
        signature: sig,
        qualified_name: name,
        start_line: _getLineNumber(node),
        end_line: _getEndLineNumber(node),
        start_byte: node.startIndex,
        end_byte: node.endIndex,
        docstring: '',
        body_preview: bodyPreview,
        parent_name: '',
      });
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);
  tree.delete();
  return symbols;
}

module.exports = { init, isReady, parseFile, info };