const crypto = require('crypto');
const path = require('path');
const { createParserRegistry } = require('./parser-registry');

function safeJson(value, fallback = []) {
  try {
    return JSON.stringify(Array.isArray(value) ? value : fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function hashText(text) {
  return crypto
    .createHash('sha256')
    .update(text || '')
    .digest('hex');
}

function sliceByBytes(content, startByte, endByte) {
  if (!Number.isFinite(startByte) || !Number.isFinite(endByte) || endByte <= startByte) {
    return '';
  }
  return Buffer.from(content || '', 'utf-8').toString('utf-8', startByte, endByte);
}

function extractDecorators(source) {
  const decorators = [];
  for (const line of (source || '').split('\n').slice(0, 12)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@')) {
      decorators.push(trimmed.split(/[\s(]/)[0]);
    }
  }
  return decorators;
}

function extractKeywords(symbol, source) {
  const text = [
    symbol.name,
    symbol.qualified_name,
    symbol.kind,
    symbol.signature,
    symbol.docstring,
    symbol.parent_name,
    source,
  ]
    .filter(Boolean)
    .join(' ');
  const words =
    text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .match(/[a-z_][a-z0-9_]{2,}/g) || [];
  return [...new Set(words)].slice(0, 40);
}

function makeSummary(symbol) {
  const doc = (symbol.docstring || '').trim().split('\n').find(Boolean);
  if (doc) {
    return doc.slice(0, 240);
  }
  const signature = (symbol.signature || '').trim();
  if (signature) {
    return signature.slice(0, 240);
  }
  return `${symbol.kind || 'symbol'} ${symbol.qualified_name || symbol.name}`.slice(0, 240);
}

function stableSymbolId(symbol, fallbackFilePath) {
  return `${symbol.file_path || symbol.file || fallbackFilePath}::${symbol.qualified_name || symbol.name}#${symbol.kind || 'symbol'}`;
}

function collectCallReferences(symbol, callees) {
  if (!Array.isArray(callees) || !Number.isFinite(symbol.start_line) || !Number.isFinite(symbol.end_line)) {
    return [];
  }
  const refs = [];
  for (const call of callees) {
    const line = call.line || 0;
    const name = call.full_path || call.callee;
    if (name && line >= symbol.start_line && line <= symbol.end_line && name !== symbol.name) {
      refs.push(name);
    }
  }
  return [...new Set(refs)].slice(0, 80);
}

function normalizeSymbol(symbol, fallbackFilePath, context = {}) {
  const normalized = {
    file_path: symbol.file_path || symbol.file || fallbackFilePath,
    name: symbol.name,
    kind: symbol.kind,
    signature: symbol.signature || '',
    qualified_name: symbol.qualified_name || symbol.name,
    start_line: symbol.start_line,
    end_line: symbol.end_line,
    start_byte: symbol.start_byte,
    end_byte: symbol.end_byte,
    docstring: symbol.docstring || '',
    body_preview: symbol.body_preview || '',
    language: symbol.language || '',
    parent_name: symbol.parent_name || '',
  };
  const source = context.content ? sliceByBytes(context.content, normalized.start_byte, normalized.end_byte) : '';
  const decorators = symbol.decorators || extractDecorators(source);
  const callReferences = symbol.call_references || collectCallReferences(normalized, context.callees || []);
  normalized.stable_symbol_id = symbol.stable_symbol_id || symbol.id || stableSymbolId(normalized, fallbackFilePath);
  normalized.content_hash =
    symbol.content_hash || hashText(source || normalized.signature || normalized.qualified_name);
  normalized.summary = symbol.summary || makeSummary(normalized);
  normalized.decorators_json = safeJson(decorators);
  normalized.keywords_json = safeJson(symbol.keywords || extractKeywords(normalized, source));
  normalized.call_references_json = safeJson(callReferences);
  normalized.ecosystem_context = symbol.ecosystem_context || '';
  return normalized;
}

function extractSymbolsFromFile(filePath, registry, content) {
  const reg = registry || createParserRegistry();
  if (!reg.canParseFile(filePath)) {
    return [];
  }
  let rawSymbols;
  let source = content;
  if (content !== undefined) {
    rawSymbols = reg.parseContent(filePath, content);
  } else {
    rawSymbols = reg.parseFile(filePath);
    try {
      source = require('fs').readFileSync(filePath, 'utf-8');
    } catch {
      source = '';
    }
  }
  let callees = [];
  if (source && typeof reg.extractCalleesFromContent === 'function') {
    try {
      callees = reg.extractCalleesFromContent(filePath, source);
    } catch {}
  }
  return rawSymbols.map((symbol) =>
    normalizeSymbol(symbol, filePath, { content: source || '', callees, relativeFile: path.basename(filePath) }),
  );
}

module.exports = { extractSymbolsFromFile, normalizeSymbol };
