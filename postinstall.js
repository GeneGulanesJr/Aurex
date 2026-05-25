#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const grammarDir = path.join(__dirname, 'grammars');
const htmlSrc = path.join(__dirname, 'node_modules', 'tree-sitter-html', 'tree-sitter-html.wasm');

if (fs.existsSync(htmlSrc) && fs.existsSync(grammarDir)) {
  const dest = path.join(grammarDir, 'tree-sitter-html.wasm');
  if (!fs.existsSync(dest)) {
    try {
      fs.copyFileSync(htmlSrc, dest);
    } catch {}
  }
}

process.exit(0);
