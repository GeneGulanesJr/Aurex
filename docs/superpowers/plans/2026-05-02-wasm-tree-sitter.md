# WASM tree-sitter Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Python tree-sitter subprocess with in-process WASM tree-sitter, eliminating the Python/venv/pip dependency chain.

**Architecture:** `parse-code.js` loads web-tree-sitter WASM runtime + pre-compiled grammar .wasm files from `grammars/`. Parser lazy-inits on first use. After init, `parser.parse()` is synchronous. Only `index-repo` and `reindex-repo` code paths become async. All other subcommands stay sync.

**Tech Stack:** Node.js, web-tree-sitter (WASM), pre-compiled .wasm grammar files

---

### Task 1: Set up web-tree-sitter + fetch grammar .wasm files

**Files:**
- Create: `grammars/.gitkeep`
- Create: `scripts/fetch-grammars.sh`
- Create: `test/parse-code.test.js`
- Modify: `package.json` (new — project npm manifest)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "pi-memory-extension",
  "version": "1.0.0",
  "private": true,
  "description": "Standalone Memory Layer Engine for Pi coding agent",
  "dependencies": {},
  "devDependencies": {},
  "scripts": {
    "fetch-grammars": "bash scripts/fetch-grammars.sh",
    "test": "node --test test/parse-code.test.js"
  }
}
```

- [ ] **Step 2: Install web-tree-sitter**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && npm install web-tree-sitter`
Expected: `node_modules/web-tree-sitter/` created, `tree-sitter.wasm` present inside it

- [ ] **Step 3: Create fetch-grammars.sh to download .wasm files from GitHub releases**

```bash
#!/usr/bin/env bash
set -e
# Downloads pre-compiled tree-sitter .wasm grammar files from GitHub releases.
# Run: bash scripts/fetch-grammars.sh

GRAMMAR_DIR="$(cd "$(dirname "$0")/.." && pwd)/grammars"
mkdir -p "$GRAMMAR_DIR"

# tree-sitter org publishes .wasm files on GitHub releases
GRAMMARS=(
  "tree-sitter-javascript"
  "tree-sitter-typescript"
  "tree-sitter-sql"
)

for grammar in "${GRAMMARS[@]}"; do
  echo "⬇ Fetching $grammar.wasm ..."
  # Try GitHub releases first
  URL="https://github.com/tree-sitter/$grammar/releases/latest/download/$grammar.wasm"
  if curl -fsSL "$URL" -o "$GRAMMAR_DIR/$grammar.wasm" 2>/dev/null; then
    echo "  ✅ Downloaded from GitHub releases"
  else
    echo "  ⚠ GitHub release not found, trying npm package..."
    # Fallback: install npm package and extract .wasm
    TMPDIR=$(mktemp -d)
    trap "rm -rf $TMPDIR" EXIT
    npm install --prefix "$TMPDIR" "$grammar" 2>/dev/null
    WASM_FILE=$(find "$TMPDIR/node_modules/$grammar" -name "*.wasm" 2>/dev/null | head -1)
    if [ -n "$WASM_FILE" ]; then
      cp "$WASM_FILE" "$GRAMMAR_DIR/$grammar.wasm"
      echo "  ✅ Extracted from npm package"
    else
      echo "  ❌ Could not find .wasm for $grammar"
    fi
    rm -rf "$TMPDIR"
  fi
done

# TypeScript ships both typescript + tsx; rename for clarity
if [ -f "$GRAMMAR_DIR/tree-sitter-typescript.wasm" ]; then
  cp "$GRAMMAR_DIR/tree-sitter-typescript.wasm" "$GRAMMAR_DIR/typescript.wasm"
fi

echo ""
echo "📋 Grammar files in $GRAMMAR_DIR:"
ls -lh "$GRAMMAR_DIR"/*.wasm 2>/dev/null || echo "  (none found)"
```

- [ ] **Step 4: Run fetch-grammars.sh**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && bash scripts/fetch-grammars.sh`
Expected: `.wasm` files downloaded to `grammars/`

- [ ] **Step 5: If GitHub releases don't have .wasm files, build them using tree-sitter-cli**

Run: `npm install --save-dev tree-sitter-cli tree-sitter-javascript tree-sitter-typescript tree-sitter-sql`
Then: `npx tree-sitter build --wasm node_modules/tree-sitter-javascript && mv tree-sitter-javascript.wasm grammars/javascript.wasm`
Then: `npx tree-sitter build --wasm node_modules/tree-sitter-typescript && mv tree-sitter-typescript.wasm grammars/typescript.wasm`
Then: `npx tree-sitter build --wasm node_modules/tree-sitter-sql && mv tree-sitter-sql.wasm grammars/sql.wasm`

Expected: `.wasm` files in `grammars/`

- [ ] **Step 6: Verify .wasm files exist and list sizes**

Run: `ls -lh /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension/grammars/`
Expected: `javascript.wasm`, `typescript.wasm`, `sql.wasm` present (total ~5-10MB)

- [ ] **Step 7: Verify web-tree-sitter loads in Node.js**

Run: `node -e "const P = require('web-tree-sitter'); P.init().then(() => console.log('web-tree-sitter ready')).catch(e => console.error(e))"`
Expected: `web-tree-sitter ready`

- [ ] **Step 8: Verify grammar loading works**

Run: `node -e "const {Parser, Language} = require('web-tree-sitter'); (async () => { await Parser.init(); const lang = await Language.load('grammars/javascript.wasm'); const p = new Parser(); p.setLanguage(lang); const tree = p.parse('function hello() {}'); console.log(tree.rootNode.toString()); })()"`
Expected: S-expression tree printed

- [ ] **Step 9: Add grammars/ to .gitignore if .wasm files are too large, or commit them**

Since we chose to bundle grammars inside the skill directory, commit the .wasm files:
Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && git add grammars/ package.json package-lock.json scripts/fetch-grammars.sh`

- [ ] **Step 10: Commit**

```bash
git add grammars/ package.json package-lock.json scripts/fetch-grammars.sh
git commit -m "chore: add web-tree-sitter + bundled WASM grammar files"
```

---

### Task 2: Write parse-code.js — WASM-based parser module

**Files:**
- Create: `parse-code.js`
- Create: `test/parse-code.test.js`

- [ ] **Step 1: Write the test for parse-code.js**

```js
// test/parse-code.test.js
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const codeParser = require('../parse-code');

describe('parse-code', () => {
  before(async () => {
    await codeParser.init();
  });

  it('should initialize successfully', () => {
    assert.equal(codeParser.isReady(), true);
  });

  it('should extract JS function declarations', () => {
    const tmpFile = path.join('/tmp', 'test-parse.js');
    fs.writeFileSync(tmpFile, 'function hello(name) {\n  return name;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    assert.ok(symbols.length >= 1, `Expected >= 1 symbol, got ${symbols.length}`);
    const fn = symbols.find(s => s.name === 'hello');
    assert.ok(fn, 'hello function not found');
    assert.equal(fn.kind, 'function');
    assert.equal(fn.start_line, 1);
    assert.ok(fn.signature.includes('hello'));
  });

  it('should extract JS class declarations', () => {
    const tmpFile = path.join('/tmp', 'test-class.js');
    fs.writeFileSync(tmpFile, 'class MyClass {\n  greet() {\n    return "hi";\n  }\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const cls = symbols.find(s => s.name === 'MyClass' && s.kind === 'class');
    assert.ok(cls, 'MyClass class not found');

    const method = symbols.find(s => s.name === 'greet' && s.kind === 'method');
    assert.ok(method, 'greet method not found');
    assert.equal(method.parent_name, 'MyClass');
  });

  it('should extract arrow function variables', () => {
    const tmpFile = path.join('/tmp', 'test-arrow.js');
    fs.writeFileSync(tmpFile, 'const add = (a, b) => a + b;');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'add' && s.kind === 'function');
    assert.ok(fn, 'add arrow function not found');
  });

  it('should extract TS interface and type', () => {
    const tmpFile = path.join('/tmp', 'test-types.ts');
    fs.writeFileSync(tmpFile, 'interface User {\n  name: string;\n  age: number;\n}\n\ntype ID = string;');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const iface = symbols.find(s => s.name === 'User' && s.kind === 'interface');
    assert.ok(iface, 'User interface not found');

    const typeAlias = symbols.find(s => s.name === 'ID' && s.kind === 'type');
    assert.ok(typeAlias, 'ID type alias not found');
  });

  it('should extract TSX component', () => {
    const tmpFile = path.join('/tmp', 'test-comp.tsx');
    fs.writeFileSync(tmpFile, 'export function Header({ title }: { title: string }) {\n  return <h1>{title}</h1>;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'Header');
    assert.ok(fn, 'Header component not found');
  });

  it('should extract SQL CREATE TABLE', () => {
    const tmpFile = path.join('/tmp', 'test-schema.sql');
    fs.writeFileSync(tmpFile, 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n);');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const table = symbols.find(s => s.name === 'users' && s.kind === 'table');
    assert.ok(table, 'users table not found');
    assert.equal(table.language, 'sql');
  });

  it('should return empty array for unsupported file types', () => {
    const symbols = codeParser.parseFile('/tmp/test.rb');
    assert.deepEqual(symbols, []);
  });

  it('should return empty array for nonexistent files', () => {
    const symbols = codeParser.parseFile('/tmp/does_not_exist_abc123.js');
    assert.deepEqual(symbols, []);
  });

  it('should return same output schema as Python version', () => {
    const tmpFile = path.join('/tmp', 'test-schema.js');
    fs.writeFileSync(tmpFile, '/** A greeter */\nfunction greet(who) {\n  return "Hello " + who;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'greet');
    assert.ok(fn, 'greet function not found');

    // Verify all expected fields exist
    const requiredFields = ['name', 'kind', 'language', 'file', 'signature', 'qualified_name',
                            'start_line', 'end_line', 'start_byte', 'end_byte',
                            'docstring', 'body_preview', 'parent_name'];
    for (const field of requiredFields) {
      assert.ok(field in fn, `Missing field: ${field}`);
    }
    assert.equal(fn.language, 'javascript');
    assert.ok(fn.docstring.includes('greeter'), `Expected docstring to contain 'greeter', got: "${fn.docstring}"`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node --test test/parse-code.test.js`
Expected: FAIL — `Cannot find module '../parse-code'`

- [ ] **Step 3: Write parse-code.js**

```js
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
  '.tsx':  { grammarFile: 'typescript.wasm', languageName: 'typescript', parserKey: 'tsx' },
  '.sql':  { grammarFile: 'sql.wasm',        languageName: 'sql',         parserKey: 'sql' },
};

// ── Module state ──
let _ready = false;
let _initPromise = null;
let _Parser = null;
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
      _Parser = require('web-tree-sitter');
      await _Parser.init();

      // Load available grammars
      const grammarEntries = [
        ['javascript', 'javascript.wasm'],
        ['typescript', 'typescript.wasm'],
        ['tsx',        'typescript.wasm'],  // TSX shares TypeScript grammar, different entry point
        ['sql',        'sql.wasm'],
      ];

      for (const [key, wasmFile] of grammarEntries) {
        const wasmPath = path.join(GRAMMAR_DIR, wasmFile);
        if (!fs.existsSync(wasmPath)) {
          console.error(`[parse-code] Grammar not found, skipping: ${wasmPath}`);
          continue;
        }
        try {
          const lang = await _Parser.Language.load(wasmPath);
          _languages[key] = lang;
          const parser = new _Parser();
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
  return _extractJsTsSymbols(filePath, Buffer.from(source, 'utf-8'), source, parser, langConfig.languageName);
}

// ── JS/TS symbol extraction ──

const _JS_TS_SYMBOL_NODES = {
  'function_declaration': 'function',
  'generator_function_declaration': 'function',
  'class_declaration': 'class',
  'method_definition': 'method',
  'interface_declaration': 'interface',
  'type_alias_declaration': 'type',
  'enum_declaration': 'enum',
};

const _VARIABLE_FUNCTION_NODES = new Set(['arrow_function', 'function_expression']);

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
  const siblings = node.parent.children;
  const idx = siblings.indexOf(node);
  if (idx <= 0) return '';
  const prev = siblings[idx - 1];
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

function _getLineNumber(node, sourceBuf) {
  // Count newlines before node.startIndex
  let count = 1;
  const end = node.startIndex;
  for (let i = 0; i < end; i++) {
    if (sourceBuf[i] === 0x0A) count++;  // '\n'
  }
  return count;
}

function _getEndLineNumber(node, sourceBuf) {
  let count = 1;
  const end = node.endIndex;
  for (let i = 0; i < end; i++) {
    if (sourceBuf[i] === 0x0A) count++;
  }
  return count;
}

function _extractJsTsSymbols(filePath, sourceBuf, sourceStr, parser, languageName) {
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
          const parentName = kind === 'method' ? _getParentClassName(node) : '';
          const qualified = parentName ? `${parentName}.${name}` : name;
          symbols.push({
            name,
            kind,
            language: languageName,
            file: filePath,
            signature: _getSignature(node, sourceStr),
            qualified_name: qualified,
            start_line: _getLineNumber(node, sourceBuf),
            end_line: _getEndLineNumber(node, sourceBuf),
            start_byte: node.startIndex,
            end_byte: node.endIndex,
            docstring: _getDocstring(node),
            body_preview: _getBodyPreview(node, sourceStr),
            parent_name: parentName,
          });
        }
      }
    } else if (_VARIABLE_FUNCTION_NODES.has(node.type)) {
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
              start_line: _getLineNumber(parent, sourceBuf),
              end_line: _getEndLineNumber(parent, sourceBuf),
              start_byte: parent.startIndex,
              end_byte: parent.endIndex,
              docstring: _getDocstring(parent),
              body_preview: _getBodyPreview(node, sourceStr),
              parent_name: parentName,
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

// ── SQL symbol extraction ──

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

  const sourceBuf = Buffer.from(sourceStr, 'utf-8');

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
        start_line: _getLineNumber(node, sourceBuf),
        end_line: _getEndLineNumber(node, sourceBuf),
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

module.exports = { init, isReady, parseFile };
```

- [ ] **Step 4: Run tests**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node --test test/parse-code.test.js`
Expected: All tests PASS

- [ ] **Step 5: If TypeScript TSX grammar needs a separate entry point, handle it**

Note: web-tree-sitter's TypeScript .wasm may contain both `typescript` and `tsx` languages. If parsing `.tsx` files with the typescript grammar doesn't capture JSX:
- Check if `Language.load` exposes multiple languages via `Language.load(path, 'tsx')`
- Or use the `getLanguageNames()` method to discover available sub-languages
- If separate .wasm is needed, update `fetch-grammars.sh` and `GRAMMAR_DIR` accordingly

- [ ] **Step 6: Commit**

```bash
git add parse-code.js test/parse-code.test.js
git commit -m "feat: add WASM-based tree-sitter parser (parse-code.js)"
```

---

### Task 3: Modify memory-store.js — replace Python subprocess with WASM parser

**Files:**
- Modify: `memory-store.js`

- [ ] **Step 1: Write test for the integration**

```js
// test/index-repo.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const STORE = path.resolve(__dirname, '..', 'memory-store.js');
const DB_DIR = path.join(process.env.HOME, '.pi', 'memory');

describe('index-repo (WASM)', () => {
  it('should index a small repo without Python', async () => {
    // Create a temp repo with a JS file
    const tmpRepo = path.join('/tmp', 'test-wasm-repo');
    fs.mkdirSync(tmpRepo, { recursive: true });
    fs.writeFileSync(path.join(tmpRepo, 'app.js'),
      '/** App entry */\nfunction main() {\n  console.log("hello");\n}\n\nclass Server {\n  start() {\n    return 42;\n  }\n}');

    const out = execSync(`node "${STORE}" index-repo --path "${tmpRepo}" --name test-wasm`, {
      encoding: 'utf8',
      timeout: 30000,
    });
    const result = JSON.parse(out);

    assert.ok(result.success, `index-repo failed: ${out}`);
    assert.ok(result.files_indexed >= 1, `Expected >= 1 file, got ${result.files_indexed}`);
    assert.ok(result.symbols_extracted >= 3, `Expected >= 3 symbols (main, Server, start), got ${result.symbols_extracted}`);

    // Clean up
    fs.rmSync(tmpRepo, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails (still uses Python)**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node --test test/index-repo.test.js`
Expected: FAIL or passes with Python subprocess

- [ ] **Step 3: Replace Python references in memory-store.js with WASM module**

Find and replace these sections in `memory-store.js`:

**Remove these constants (lines ~655-656):**
```js
const PARSER_SCRIPT = path.resolve(__dirname, 'parse_code.py');
const PYTHON_BIN = path.resolve(__dirname, '.venv', 'bin', 'python3');
```

**Replace with:**
```js
const codeParser = require('./parse-code');
```

**Replace `ensureParserAvailable()` function with:**
```js
async function ensureParserAvailable() {
  if (codeParser.isReady()) return true;
  await codeParser.init();
  return codeParser.isReady();
}
```

**Replace `parseCodeFile()` function with:**
```js
function parseCodeFile(filePath) {
  return codeParser.parseFile(filePath);
}
```

**Make `indexRepoInternal()` async:**
Change signature from:
```js
function indexRepoInternal(repoPath, repoName) {
```
To:
```js
async function indexRepoInternal(repoPath, repoName) {
```

And change the parser availability check:
```js
if (!ensureParserAvailable()) {
  return { error: 'Python tree-sitter parser not available...' };
}
```
To:
```js
if (!await ensureParserAvailable()) {
  return { error: 'WASM tree-sitter parser not available. Run: npm install web-tree-sitter in the skill directory.' };
}
```

**Make `reindexRepoInternal()` async:**
Change signature from:
```js
function reindexRepoInternal(repo, mode) {
```
To:
```js
async function reindexRepoInternal(repo, mode) {
```

And its parser check:
```js
if (!ensureParserAvailable()) return { error: 'Python tree-sitter parser not available' };
```
To:
```js
if (!await ensureParserAvailable()) return { error: 'WASM tree-sitter parser not available' };
```

**Make the dispatch section async:**
Replace the bottom dispatch block:
```js
ensureDb();

if (cmd && commands[cmd]) {
  const result = commands[cmd](args);
  jsonOut(result);
} else {
```
With:
```js
(async () => {
  ensureDb();

  if (cmd && commands[cmd]) {
    const result = await commands[cmd](args);
    jsonOut(result);
  } else {
    console.error(
      'Usage: node memory-store.js <subcommand> [--option value ...]\n' +
      'Subcommands: ' + Object.keys(commands).join(', ')
    );
    process.exit(1);
  }
})();
```

- [ ] **Step 4: Run integration test**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node --test test/index-repo.test.js`
Expected: PASS — indexes repo without Python

- [ ] **Step 5: Run existing parse-code unit tests to verify no regression**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node --test test/parse-code.test.js`
Expected: All PASS

- [ ] **Step 6: Test CLI subcommands still work**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node memory-store.js stats`
Expected: JSON stats output (no error)

Run: `node memory-store.js search --query test --project test-project`
Expected: JSON search results (no error, even with empty results)

- [ ] **Step 7: Commit**

```bash
git add memory-store.js test/index-repo.test.js
git commit -m "feat: replace Python tree-sitter subprocess with WASM in-process parser"
```

---

### Task 4: Update install.sh — remove Python, add npm

**Files:**
- Modify: `install.sh`

- [ ] **Step 1: Replace install.sh content**

```bash
#!/usr/bin/env bash
set -e

SKILL_DIR="${HOME}/.pi/agent/skills/memory-layer"
REPO_URL="https://github.com/genegulanesjr/PiMemoryExtension"

echo "📦 Installing Pi Memory Layer..."

# 1. Clone to temp
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT
git clone --depth 1 "$REPO_URL" "$TMPDIR"
cd "$TMPDIR"

# 2. Install web-tree-sitter (WASM runtime)
echo "🕸 Setting up web-tree-sitter..."
npm install --production

# 3. Fetch grammar .wasm files if not already bundled
if [ ! -f "grammars/javascript.wasm" ]; then
  echo "📥 Fetching grammar WASM files..."
  bash scripts/fetch-grammars.sh
fi

# 4. Install as Pi skill
rm -rf "$SKILL_DIR"
mkdir -p "$(dirname "$SKILL_DIR")"
cp -r . "$SKILL_DIR"

# 5. Register with Pi
if command -v pi &>/dev/null; then
    pi install "$SKILL_DIR" 2>/dev/null || true
fi

echo ""
echo "✅ Memory Layer installed."
echo "   Location: $SKILL_DIR"
echo "   Parser: web-tree-sitter (WASM, zero Python dependency)"
echo "   Restart Pi to activate."
```

- [ ] **Step 2: Test install.sh locally (dry run)**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && bash -n install.sh`
Expected: No syntax errors

- [ ] **Step 3: Commit**

```bash
git add install.sh
git commit -m "chore: update install.sh — replace Python/pip with npm/web-tree-sitter"
```

---

### Task 5: Update SKILL.md and delete parse_code.py

**Files:**
- Modify: `SKILL.md`
- Delete: `parse_code.py`

- [ ] **Step 1: Read current SKILL.md**

Run: `cat /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension/SKILL.md`

- [ ] **Step 2: Update SKILL.md to remove Python references**

Replace any mentions of:
- "Python tree-sitter" → "web-tree-sitter (WASM)"
- `.venv` references → `node_modules/web-tree-sitter`
- `parse_code.py` → `parse-code.js`
- "pip install tree-sitter" → "npm install web-tree-sitter"
- Add note: "Zero Python dependency — code parsing uses WASM tree-sitter in-process"

- [ ] **Step 3: Delete parse_code.py**

Run: `rm /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension/parse_code.py`

- [ ] **Step 4: Verify everything still works without parse_code.py**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node --test test/parse-code.test.js && node --test test/index-repo.test.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add SKILL.md
git rm parse_code.py
git commit -m "chore: delete parse_code.py, update SKILL.md for WASM parser"
```

---

### Task 6: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Verify clean install from scratch**

Simulate fresh install:
```bash
cd /tmp
rm -rf pi-memory-test
git clone https://github.com/genegulanesjr/PiMemoryExtension pi-memory-test
cd pi-memory-test
npm install --production
```
Expected: No errors, `node_modules/web-tree-sitter/` exists

- [ ] **Step 2: Verify grammar files are present**

Run: `ls -lh /tmp/pi-memory-test/grammars/`
Expected: `javascript.wasm`, `typescript.wasm`, `sql.wasm` present

- [ ] **Step 3: Verify parsing works end-to-end**

Run: `cd /tmp/pi-memory-test && node -e "const p = require('./parse-code'); p.init().then(() => { const s = p.parseFile('memory-store.js'); console.log(s.length + ' symbols found'); })"`
Expected: Positive symbol count

- [ ] **Step 4: Verify index-repo works on a real project**

Run: `cd /tmp/pi-memory-test && node memory-store.js index-repo --path /tmp/pi-memory-test --name test-repo`
Expected: JSON with `success: true`, `symbols_extracted > 0`

- [ ] **Step 5: Verify search-code works**

Run: `node memory-store.js search-code --query parse --repo test-repo`
Expected: JSON with search results

- [ ] **Step 6: Verify no Python dependency exists**

Run: `grep -r "python" /tmp/pi-memory-test/memory-store.js /tmp/pi-memory-test/parse-code.js /tmp/pi-memory-test/install.sh 2>/dev/null`
Expected: No Python references (except in comments explaining history, if any)

- [ ] **Step 7: Final commit with any fixes**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension
git add -A
git commit -m "chore: finalize WASM tree-sitter migration"
```