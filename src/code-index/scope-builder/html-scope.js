// HTML scope builder — resource refs only (inline script bindings deferred to v1 limitation).
// Covers: element_id, css_class, script_src.

const { addBinding, dedupBindings } = require('./shared');

function buildHtmlScopeBindings(tree, source, filePath) {
  const bindings = [];

  // v1: Use regex-based extraction for HTML since tree-sitter HTML grammars
  // vary widely and the spec says inline scripts produce no scope bindings.
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Script src
    const scriptSrcMatch = line.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (scriptSrcMatch && /<script/i.test(line)) {
      addBinding(bindings, {
        name: scriptSrcMatch[1],
        kind: 'script_src',
        origin: 'external_file',
        sourceModule: scriptSrcMatch[1],
        sourceName: null,
        lineStart: lineNum,
        lineEnd: lineNum,
        scopeDepth: 0,
        byteStart: null,
        byteEnd: null,
      });
    }

    // Element IDs
    const idMatch = line.match(/\bid\s*=\s*["']([^"']+)["']/i);
    if (idMatch) {
      addBinding(bindings, {
        name: idMatch[1],
        kind: 'element_id',
        origin: 'local',
        sourceModule: null,
        sourceName: null,
        lineStart: lineNum,
        lineEnd: lineNum,
        scopeDepth: 0,
        byteStart: null,
        byteEnd: null,
      });
    }

    // CSS classes (multiple per line)
    const classMatch = line.match(/\bclass\s*=\s*["']([^"']+)["']/i);
    if (classMatch) {
      const classes = classMatch[1].split(/\s+/).filter(Boolean);
      for (const cls of classes) {
        addBinding(bindings, {
          name: cls,
          kind: 'css_class',
          origin: 'local',
          sourceModule: null,
          sourceName: null,
          lineStart: lineNum,
          lineEnd: lineNum,
          scopeDepth: 0,
          byteStart: null,
          byteEnd: null,
        });
      }
    }
  }

  return dedupBindings(bindings);
}

module.exports = { buildHtmlScopeBindings };
