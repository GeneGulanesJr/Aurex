/**
 * Utils.js — Shared utilities for the LaPis Memory Layer
 *
 * Consolidates duplicated functions from memory-store.js, code-analysis.js,
 * git-analysis.js, doc-indexer.js, parse-code.js, and wire-format.js.
 *
 * Issue #32: Duplicated utility functions across multiple files
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ── native DB guard ───────────────────────────────────────── */

function requireNativeDb(db, featureName) {
  if (!db || typeof db.prepare !== 'function') {
    return {
      error: `This operation requires a native SQLite backend (better-sqlite3). The CLI fallback does not support ${featureName}.`,
    };
  }
  return null;
}

function withDb(fn, featureName) {
  return function _guarded(db, ...args) {
    if (!db || typeof db.prepare !== 'function') {
      return {
        error: `This operation requires a native SQLite backend (better-sqlite3). The CLI fallback does not support ${featureName}.`,
      };
    }
    return fn(db, ...args);
  };
}

/* ── ignore directories ────────────────────────────────────── */

const IGNORE_DIRS_COMMON = new Set(['node_modules', '.git', '.next', '.nuxt', 'dist', 'build']);

const IGNORE_DIRS_CODE = new Set([...IGNORE_DIRS_COMMON, '.venv', 'coverage']);

const IGNORE_DIRS_DOCS = new Set([...IGNORE_DIRS_COMMON, '.svn', '.hg', '__pycache__', '.cache', '.pi', 'vendor']);

/* ── file extension sets ────────────────────────────────────── */

const CODE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.go',
  '.rs',
  '.py',
  '.pyw',
  '.sh',
  '.bash',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.html',
  '.css',
  '.scss',
  '.sql',
]);

const MD_EXTENSIONS = new Set(['.md', '.mdx']);

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.html', '.htm']);

/* ── directory walking ──────────────────────────────────────── */

function walkDirForCode(dirPath) {
  const results = [];
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          // oxlint-disable-next-line no-continue
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORE_DIRS_CODE.has(entry.name)) {
            walk(fullPath);
          }
        } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          results.push(fullPath);
        }
      }
    } catch {}
  }
  walk(dirPath);
  return results;
}

function walkDirForDocs(dirPath, ignoreGlob) {
  const results = [];
  const ignoreRe = ignoreGlob ? new RegExp(ignoreGlob.replace(/\*/g, '.*').replace(/\?/g, '.')) : null;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        // oxlint-disable-next-line no-continue
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS_DOCS.has(entry.name)) {
          // oxlint-disable-next-line no-continue
          continue;
        }
        if (ignoreRe && ignoreRe.test(fullPath)) {
          // oxlint-disable-next-line no-continue
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile() && DOC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (ignoreRe && ignoreRe.test(fullPath)) {
          // oxlint-disable-next-line no-continue
          continue;
        }
        results.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return results;
}

/* ── content hashing ───────────────────────────────────────── */

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/* ── skip callee names (shared between code-analysis and parse-code) ── */

const SKIP_CALLEE_NAMES = new Set([
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

/* ── token estimation ──────────────────────────────────────── */

function estimateTokens(bytesOrObj) {
  const str = typeof bytesOrObj === 'string' ? bytesOrObj : JSON.stringify(bytesOrObj);
  return Math.ceil(str.length / 3.5);
}

module.exports = {
  requireNativeDb,
  withDb,
  IGNORE_DIRS_COMMON,
  IGNORE_DIRS_CODE,
  IGNORE_DIRS_DOCS,
  CODE_EXTENSIONS,
  MD_EXTENSIONS,
  DOC_EXTENSIONS,
  walkDirForCode,
  walkDirForDocs,
  hashContent,
  SKIP_CALLEE_NAMES,
  estimateTokens,
};
