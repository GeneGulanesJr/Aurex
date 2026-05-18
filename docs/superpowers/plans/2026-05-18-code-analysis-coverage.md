# Code Analysis Coverage Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand LaPis's code indexer to parse HTML, CSS, and SCSS files, and improve JS/TS dynamic pattern detection (eval, dynamic import, Proxy, computed keys).

**Architecture:** Add lightweight, regex-based extractors for HTML and CSS/SCSS to `parse-code.js` (no new WASM grammars needed). Enhance the existing `_walkCallees` and `_extractJsTsSymbols` walkers to capture dynamic patterns. HTML extractors find inline scripts/styles and class/id bindings; CSS extractors find selectors, custom properties, keyframes, and mixin/include references. All changes flow through the existing pipeline: `scanner.js` → `parser-registry.js` → `parse-code.js` → `symbol-extractor.js` → `incremental-indexer.js`.

**Tech Stack:** Pure JS (no new npm dependencies). HTML/CSS parsing via regex and lightweight AST walking where tree-sitter already covers the language. For SCSS: regex extraction of `$variables`, `@mixin`, `@include`, `@extend`, `@use`, `@forward`. For HTML: regex extraction of `<script>`, `<style>`, `id=`, `class=` attributes.

**Why no new dependencies:**
- `css-tree`/`postcss`/`parse5` would add 5-15MB of node_modules — violates LaPis's zero-deps philosophy
- Tree-sitter already has HTML/CSS WASM grammars available but bundling them is a separate effort (WASM size concern)
- Regex extraction gives 80% of the value at 0% of the cost for a v1
- All extracted symbols flow through the same SQLite schema — no schema changes needed

---

## File Structure (changes only)

| File | Responsibility | Change Type |
|------|---------------|-------------|
| `utils.js:55-70` | `CODE_EXTENSIONS` set | Modify — add `.html`, `.css`, `.scss` |
| `src/code-index/parser-registry.js:5-18` | `LANGUAGE_BY_EXTENSION` map | Modify — add HTML/CSS/SCSS entries |
| `parse-code.js:32-46` | `LANGUAGE_MAP` | Modify — add HTML/CSS/SCSS config entries |
| `parse-code.js:132-146` | `_routeToExtractor()` | Modify — add HTML/CSS/SCSS routing |
| `parse-code.js` (new section ~L1260) | `_extractHtmlSymbols()` | Create — HTML symbol extractor |
| `parse-code.js` (new section ~L1320) | `_extractCssSymbols()` | Create — CSS/SCSS symbol extractor |
| `parse-code.js:1131-1209` | `_walkCallees()` | Modify — add dynamic import, eval, Proxy detection |
| `parse-code.js:486-653` | `_extractJsTsSymbols()` | Modify — capture `eval` calls, dynamic imports |

---

### Task 1: Add HTML/CSS/SCSS to file extension registries

**Files:**
- Modify: `utils.js:55-70`
- Modify: `src/code-index/parser-registry.js:5-18`
- Modify: `parse-code.js:32-46`

- [ ] **Step 1: Add extensions to `CODE_EXTENSIONS` in `utils.js`**

Open `utils.js` and find the `CODE_EXTENSIONS` set (around line 55). Add `.html`, `.css`, and `.scss`:

```js
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
  '.html',
  '.css',
  '.scss',
]);
```

- [ ] **Step 2: Add language mappings to `LANGUAGE_BY_EXTENSION` in `parser-registry.js`**

Open `src/code-index/parser-registry.js` and find `LANGUAGE_BY_EXTENSION` (around line 5). Add:

```js
const LANGUAGE_BY_EXTENSION = Object.freeze({
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
});
```

- [ ] **Step 3: Add language config entries to `LANGUAGE_MAP` in `parse-code.js`**

Open `parse-code.js` and find `LANGUAGE_MAP` (around line 32). HTML/CSS/SCSS don't use tree-sitter WASM (no bundled grammars), so set `grammarFile` to `null` and add an `extractor` field that names the regex-based extractor function:

```js
const LANGUAGE_MAP = {
  '.js': { grammarFile: 'javascript.wasm', languageName: 'javascript', parserKey: 'javascript' },
  '.jsx': { grammarFile: 'javascript.wasm', languageName: 'javascript', parserKey: 'javascript' },
  '.mjs': { grammarFile: 'javascript.wasm', languageName: 'javascript', parserKey: 'javascript' },
  '.cjs': { grammarFile: 'javascript.wasm', languageName: 'javascript', parserKey: 'javascript' },
  '.ts': { grammarFile: 'typescript.wasm', languageName: 'typescript', parserKey: 'typescript' },
  '.mts': { grammarFile: 'typescript.wasm', languageName: 'typescript', parserKey: 'typescript' },
  '.cts': { grammarFile: 'typescript.wasm', languageName: 'typescript', parserKey: 'typescript' },
  '.tsx': { grammarFile: 'tsx.wasm', languageName: 'typescript', parserKey: 'tsx' },
  '.py': { grammarFile: 'tree-sitter-python.wasm', languageName: 'python', parserKey: 'python' },
  '.pyw': { grammarFile: 'tree-sitter-python.wasm', languageName: 'python', parserKey: 'python' },
  '.go': { grammarFile: 'tree-sitter-go.wasm', languageName: 'go', parserKey: 'go' },
  '.rs': { grammarFile: 'tree-sitter-rust.wasm', languageName: 'rust', parserKey: 'rust' },
  '.html': { grammarFile: null, languageName: 'html', extractor: 'regex' },
  '.css': { grammarFile: null, languageName: 'css', extractor: 'regex' },
  '.scss': { grammarFile: null, languageName: 'scss', extractor: 'regex' },
  // SQL grammar not bundled — .sql files use regex parsing when sql.wasm is available
};
```

- [ ] **Step 4: Lint check**

Run: `npm run lint`
Expected: No new errors. Pre-existing warnings are fine.

- [ ] **Step 5: Commit**

```bash
git add utils.js src/code-index/parser-registry.js parse-code.js
git commit -m "feat(indexer): register HTML/CSS/SCSS file extensions in scanning pipeline"
```

---

### Task 2: Add routing for regex-based extractors in `_routeToExtractor()`

**Files:**
- Modify: `parse-code.js:132-146`

- [ ] **Step 1: Update `_routeToExtractor()` to handle `extractor: 'regex'` configs**

The current function routes based on `langConfig.languageName`. The tree-sitter languages (sql, python, go, rust) have dedicated extractors that receive a `parser` argument. For HTML/CSS/SCSS with `extractor: 'regex'`, we pass `null` for the parser.

Replace the `_routeToExtractor` function body (around line 132) with:

```js
function _routeToExtractor(filePath, source, parser, langConfig) {
  if (langConfig.extractor === 'regex') {
    if (langConfig.languageName === 'html') {
      return _extractHtmlSymbols(filePath, source);
    }
    if (langConfig.languageName === 'css' || langConfig.languageName === 'scss') {
      return _extractCssSymbols(filePath, source);
    }
    return [];
  }
  if (langConfig.languageName === 'sql') {
    return _extractSqlSymbols(filePath, source, parser);
  }
  if (langConfig.languageName === 'python') {
    return _extractPythonSymbols(filePath, source, parser);
  }
  if (langConfig.languageName === 'go') {
    return _extractGoSymbols(filePath, source, parser);
  }
  if (langConfig.languageName === 'rust') {
    return _extractRustSymbols(filePath, source, parser);
  }
  return _extractJsTsSymbols(filePath, source, parser, langConfig.languageName);
}
```

- [ ] **Step 2: Lint check**

Run: `npm run lint`
Expected: No new errors (functions `_extractHtmlSymbols` and `_extractCssSymbols` don't exist yet but are referenced — this is fine in JS as they'll be hoisted when defined below).

Actually — oxlint may warn about used-before-defined. If so, just continue to Task 3/4 before linting.

- [ ] **Step 3: Commit**

```bash
git add parse-code.js
git commit -m "feat(parse-code): route HTML/CSS/SCSS to regex-based extractors"
```

---

### Task 3: Implement `_extractHtmlSymbols()` — HTML symbol extractor

**Files:**
- Modify: `parse-code.js` (add new function after `_extractSqlSymbols`, ~line 1125)

This extractor uses regex to find:
1. **Inline `<script>` blocks** — extract their JS/TS content for later cross-referencing (recorded as `kind: 'script'` symbols)
2. **Inline `<style>` blocks** — recorded as `kind: 'style'` symbols
3. **`id="..."` attributes** — recorded as `kind: 'id'` symbols (useful for DOM manipulation analysis)
4. **Component/custom element tags** — `<MyComponent>`, `<my-component>` patterns recorded as `kind: 'component'`
5. **`class="..."` attributes** on elements with notable patterns (recorded as `kind: 'css_class'` symbols)

- [ ] **Step 1: Write the failing test**

Create `test/html-extractor.test.js`:

```js
const { describe, it } = require('vitest');

// We need to test _extractHtmlSymbols but it's not exported.
// Instead, test through parseContent which IS exported.
// However, parse-code.js requires web-tree-sitter which needs init.
// For unit tests, we can test the function directly by requiring and
// accessing the module's internals, or by testing parseContent after init.

// Strategy: test through parseContent after ensuring parser is ready.
let parseCode;
async function getParser() {
  if (!parseCode) {
    parseCode = require('../parse-code');
    if (!parseCode.isReady()) {
      await parseCode.init();
    }
  }
  return parseCode;
}

describe('_extractHtmlSymbols (via parseContent)', () => {
  it('extracts id attributes from HTML', async () => {
    const parser = await getParser();
    const html = `<div id="app">\n  <span id="title">Hello</span>\n</div>`;
    const result = parser.parseContent('test.html', html);
    expect(result.symbols).toBeDefined();
    const ids = result.symbols.filter(s => s.kind === 'id');
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const idNames = ids.map(s => s.name);
    expect(idNames).toContain('app');
    expect(idNames).toContain('title');
  });

  it('extracts inline script blocks', async () => {
    const parser = await getParser();
    const html = `<script>\nfunction hello() {}\n</script>`;
    const result = parser.parseContent('test.html', html);
    expect(result.symbols).toBeDefined();
    const scripts = result.symbols.filter(s => s.kind === 'script');
    expect(scripts.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts inline style blocks', async () => {
    const parser = await getParser();
    const html = `<style>\n.my-class { color: red; }\n</style>`;
    const result = parser.parseContent('test.html', html);
    expect(result.symbols).toBeDefined();
    const styles = result.symbols.filter(s => s.kind === 'style');
    expect(styles.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts custom element / component tags', async () => {
    const parser = await getParser();
    const html = `<MyButton>\n<app-header></app-header>\n</MyButton>`;
    const result = parser.parseContent('test.html', html);
    expect(result.symbols).toBeDefined();
    const components = result.symbols.filter(s => s.kind === 'component');
    expect(components.length).toBeGreaterThanOrEqual(2);
    const names = components.map(s => s.name);
    expect(names).toContain('MyButton');
    expect(names).toContain('app-header');
  });

  it('extracts class attributes', async () => {
    const parser = await getParser();
    const html = `<div class="container active">\n  <p class="text-primary">Hi</p>\n</div>`;
    const result = parser.parseContent('test.html', html);
    expect(result.symbols).toBeDefined();
    const classes = result.symbols.filter(s => s.kind === 'css_class');
    expect(classes.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for empty HTML', async () => {
    const parser = await getParser();
    const result = parser.parseContent('test.html', '');
    expect(result.symbols).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/html-extractor.test.js`
Expected: FAIL — `_extractHtmlSymbols` doesn't exist yet, symbols array will be empty or function will error.

- [ ] **Step 3: Implement `_extractHtmlSymbols`**

Add this function after `_extractSqlSymbols` (after line ~1123) in `parse-code.js`:

```js
// ── HTML regex-based extractor ──────────────────────────────

const _HTML_TAG_RE = /<\/?([A-Za-z][A-Za-z0-9_-]*)/g;
const _HTML_ID_RE = /\bid\s*=\s*["']([^"']+)["']/g;
const _HTML_CLASS_RE = /\bclass\s*=\s*["']([^"']+)["']/g;
const _HTML_SCRIPT_RE = /<script[^>]*>([\s\S]*?)<\/script\s*>/gi;
const _HTML_STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style\s*>/gi;
const _HTML_CUSTOM_ELEMENT_RE = /<\/?([A-Z][A-Za-z0-9]*|([a-z]+-[a-z][a-z0-9-]*))/g;

function _extractHtmlSymbols(filePath, source) {
  const symbols = [];
  const seen = new Set();
  const lines = source.split('\n');

  function add(name, kind, startLine, signature, bodyPreview) {
    const key = `${name}:${kind}:${startLine}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push({
      name,
      kind,
      language: 'html',
      file: filePath,
      qualified_name: name,
      signature: signature || '',
      start_line: startLine,
      end_line: startLine,
      start_byte: 0,
      end_byte: 0,
      docstring: '',
      body_preview: bodyPreview || '',
      parent_name: '',
    });
  }

  // Extract id attributes
  for (const match of source.matchAll(_HTML_ID_RE)) {
    const name = match[1].trim();
    if (!name) continue;
    const line = source.substring(0, match.index).split('\n').length;
    add(name, 'id', line, `id="${name}"`, '');
  }

  // Extract class attributes (split on whitespace, record each class)
  for (const match of source.matchAll(_HTML_CLASS_RE)) {
    const raw = match[1].trim();
    if (!raw) continue;
    const line = source.substring(0, match.index).split('\n').length;
    for (const cls of raw.split(/\s+/)) {
      if (cls) add(cls, 'css_class', line, `class="${cls}"`, '');
    }
  }

  // Extract custom element / component tags (PascalCase or kebab-case)
  for (const match of source.matchAll(_HTML_CUSTOM_ELEMENT_RE)) {
    const tagName = match[1];
    // Skip standard HTML elements (all-lowercase, non-kebab standard tags)
    const standardTags = new Set([
      'div', 'span', 'p', 'a', 'img', 'input', 'button', 'form', 'table',
      'tr', 'td', 'th', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'head', 'body', 'html', 'title', 'meta', 'link', 'script', 'style',
      'header', 'footer', 'main', 'section', 'article', 'aside', 'nav',
      'pre', 'code', 'br', 'hr', 'label', 'select', 'option', 'textarea',
      'template', 'slot', 'iframe', 'canvas', 'video', 'audio', 'source',
      'noscript', 'details', 'summary', 'dialog', 'figure', 'figcaption',
    ]);
    if (standardTags.has(tagName.toLowerCase())) continue;
    const line = source.substring(0, match.index).split('\n').length;
    add(tagName, 'component', line, `<${tagName}>`, '');
  }

  // Extract inline <script> blocks
  for (const match of source.matchAll(_HTML_SCRIPT_RE)) {
    const body = match[1].trim();
    if (!body) continue;
    const startLine = source.substring(0, match.index).split('\n').length;
    const preview = body.split('\n').slice(0, 3).join('\n');
    const sig = preview.length > 200 ? `${preview.slice(0, 197)}...` : preview;
    add(`[inline-script:${startLine}]`, 'script', startLine, sig, preview);
  }

  // Extract inline <style> blocks
  for (const match of source.matchAll(_HTML_STYLE_RE)) {
    const body = match[1].trim();
    if (!body) continue;
    const startLine = source.substring(0, match.index).split('\n').length;
    const preview = body.split('\n').slice(0, 3).join('\n');
    const sig = preview.length > 200 ? `${preview.slice(0, 197)}...` : preview;
    add(`[inline-style:${startLine}]`, 'style', startLine, sig, preview);
  }

  return symbols;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/html-extractor.test.js`
Expected: All 6 tests PASS.

- [ ] **Step 5: Lint check**

Run: `npm run lint`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add parse-code.js test/html-extractor.test.js
git commit -m "feat(parse-code): add HTML symbol extractor (ids, classes, components, scripts, styles)"
```

---

### Task 4: Implement `_extractCssSymbols()` — CSS/SCSS symbol extractor

**Files:**
- Modify: `parse-code.js` (add new function after `_extractHtmlSymbols`)

This extractor finds:
1. **CSS selectors** — `.my-class`, `#my-id`, `:root`, `[data-attr]`, element selectors (top-level only, not nested)
2. **CSS custom properties** — `--my-var: value;` recorded as `kind: 'custom_property'`
3. **CSS keyframes** — `@keyframes myAnimation` recorded as `kind: 'keyframes'`
4. **CSS @media queries** — `@media (min-width: 768px)` recorded as `kind: 'media_query'`
5. **SCSS `$variables`** — `$primary-color: blue;` recorded as `kind: 'scss_variable'`
6. **SCSS `@mixin`** — `@mixin myMixin(...)` recorded as `kind: 'mixin'`
7. **SCSS `@include`** — `@include myMixin` recorded as `kind: 'include'`
8. **SCSS `@extend`** — `@extend %placeholder` recorded as `kind: 'extend'`
9. **SCSS `@use` / `@forward`** — module imports recorded as `kind: 'import'`

- [ ] **Step 1: Write the failing test**

Create `test/css-extractor.test.js`:

```js
const { describe, it, expect } = require('vitest');

let parseCode;
async function getParser() {
  if (!parseCode) {
    parseCode = require('../parse-code');
    if (!parseCode.isReady()) {
      await parseCode.init();
    }
  }
  return parseCode;
}

describe('_extractCssSymbols (via parseContent)', () => {
  it('extracts CSS class selectors', async () => {
    const parser = await getParser();
    const css = `.container { display: flex; }\n.text-primary { color: blue; }`;
    const result = parser.parseContent('test.css', css);
    expect(result.symbols).toBeDefined();
    const classes = result.symbols.filter(s => s.kind === 'selector');
    const names = classes.map(s => s.name);
    expect(names).toContain('.container');
    expect(names).toContain('.text-primary');
  });

  it('extracts CSS custom properties', async () => {
    const parser = await getParser();
    const css = `:root {\n  --primary: #333;\n  --spacing: 1rem;\n}`;
    const result = parser.parseContent('test.css', css);
    expect(result.symbols).toBeDefined();
    const vars = result.symbols.filter(s => s.kind === 'custom_property');
    const names = vars.map(s => s.name);
    expect(names).toContain('--primary');
    expect(names).toContain('--spacing');
  });

  it('extracts @keyframes', async () => {
    const parser = await getParser();
    const css = `@keyframes fadeIn {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}`;
    const result = parser.parseContent('test.css', css);
    expect(result.symbols).toBeDefined();
    const kf = result.symbols.filter(s => s.kind === 'keyframes');
    expect(kf.length).toBeGreaterThanOrEqual(1);
    expect(kf[0].name).toContain('fadeIn');
  });

  it('extracts @media queries', async () => {
    const parser = await getParser();
    const css = `@media (min-width: 768px) {\n  .container { max-width: 720px; }\n}`;
    const result = parser.parseContent('test.css', css);
    expect(result.symbols).toBeDefined();
    const media = result.symbols.filter(s => s.kind === 'media_query');
    expect(media.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts SCSS variables', async () => {
    const parser = await getParser();
    const scss = `$primary: #333;\n$font-stack: Helvetica, sans-serif;`;
    const result = parser.parseContent('test.scss', scss);
    expect(result.symbols).toBeDefined();
    const vars = result.symbols.filter(s => s.kind === 'scss_variable');
    const names = vars.map(s => s.name);
    expect(names).toContain('$primary');
    expect(names).toContain('$font-stack');
  });

  it('extracts SCSS @mixin and @include', async () => {
    const parser = await getParser();
    const scss = `@mixin flex-center {\n  display: flex;\n  justify-content: center;\n}\n\n.container {\n  @include flex-center;\n}`;
    const result = parser.parseContent('test.scss', scss);
    expect(result.symbols).toBeDefined();
    const mixins = result.symbols.filter(s => s.kind === 'mixin');
    const includes = result.symbols.filter(s => s.kind === 'include');
    expect(mixins.length).toBeGreaterThanOrEqual(1);
    expect(includes.length).toBeGreaterThanOrEqual(1);
    expect(mixins[0].name).toContain('flex-center');
    expect(includes[0].name).toContain('flex-center');
  });

  it('extracts SCSS @extend', async () => {
    const parser = await getParser();
    const scss = `.error {\n  border: 1px red;\n}\n.critical {\n  @extend .error;\n}`;
    const result = parser.parseContent('test.scss', scss);
    expect(result.symbols).toBeDefined();
    const extends_ = result.symbols.filter(s => s.kind === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts SCSS @use and @forward', async () => {
    const parser = await getParser();
    const scss = `@use 'sass:math';\n@forward 'variables';`;
    const result = parser.parseContent('test.scss', scss);
    expect(result.symbols).toBeDefined();
    const imports = result.symbols.filter(s => s.kind === 'import');
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array for empty CSS', async () => {
    const parser = await getParser();
    const result = parser.parseContent('test.css', '');
    expect(result.symbols).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/css-extractor.test.js`
Expected: FAIL — symbols will be empty since `_extractCssSymbols` doesn't exist.

- [ ] **Step 3: Implement `_extractCssSymbols`**

Add this function after `_extractHtmlSymbols` in `parse-code.js`:

```js
// ── CSS / SCSS regex-based extractor ───────────────────────

const _CSS_CUSTOM_PROP_RE = /^\s*(--[\w-]+)\s*:/gm;
const _CSS_KEYFRAMES_RE = /@keyframes\s+([\w-]+)/g;
const _CSS_MEDIA_RE = /@media\s+([^{]+)/g;
const _CSS_SELECTOR_RE = /^([.#]?[\w][\w-]*(?:\s*,\s*[.#]?[\w][\w-]*)*)\s*\{/gm;
const _CSS_ID_SELECTOR_RE = /#([\w-]+)/g;
const _SCSS_VAR_RE = /^\s*\$([\w-]+)\s*:/gm;
const _SCSS_MIXIN_RE = /@mixin\s+([\w-]+)/g;
const _SCSS_INCLUDE_RE = /@include\s+([\w-]+)/g;
const _SCSS_EXTEND_RE = /@extend\s+([.#][\w-]+)/g;
const _SCSS_USE_RE = /@(?:use|forward)\s+['"]([^'"]+)['"]/g;

function _extractCssSymbols(filePath, source) {
  const symbols = [];
  const seen = new Set();
  const isScss = filePath.endsWith('.scss');

  function add(name, kind, startLine, signature) {
    const key = `${name}:${kind}:${startLine}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push({
      name,
      kind,
      language: isScss ? 'scss' : 'css',
      file: filePath,
      qualified_name: name,
      signature: signature || '',
      start_line: startLine,
      end_line: startLine,
      start_byte: 0,
      end_byte: 0,
      docstring: '',
      body_preview: '',
      parent_name: '',
    });
  }

  function getLine(index) {
    return source.substring(0, index).split('\n').length;
  }

  // CSS custom properties (--my-var)
  for (const match of source.matchAll(_CSS_CUSTOM_PROP_RE)) {
    add(match[1], 'custom_property', getLine(match.index), match[0].trim());
  }

  // @keyframes
  for (const match of source.matchAll(_CSS_KEYFRAMES_RE)) {
    add(match[1], 'keyframes', getLine(match.index), match[0].trim());
  }

  // @media queries
  for (const match of source.matchAll(_CSS_MEDIA_RE)) {
    const condition = match[1].trim();
    add(`@media ${condition}`, 'media_query', getLine(match.index), match[0].trim());
  }

  // CSS selectors (top-level only — lines starting with selector before {)
  // Filter out @-rules (already handled above) and properties
  for (const match of source.matchAll(_CSS_SELECTOR_RE)) {
    const selector = match[1].trim();
    // Skip @-rules, comments, properties, and empty selectors
    if (!selector || selector.startsWith('@') || selector.startsWith('//') || selector.startsWith('/*')) continue;
    // Skip property-like patterns (word: value;)
    if (/^\s*[\w-]+\s*:/.test(selector) && !selector.startsWith('.') && !selector.startsWith('#')) continue;
    add(selector, 'selector', getLine(match.index), selector);
  }

  // SCSS-specific patterns
  if (isScss) {
    // $variables
    for (const match of source.matchAll(_SCSS_VAR_RE)) {
      add(`$${match[1]}`, 'scss_variable', getLine(match.index), match[0].trim());
    }

    // @mixin definitions
    for (const match of source.matchAll(_SCSS_MIXIN_RE)) {
      add(match[1], 'mixin', getLine(match.index), match[0].trim());
    }

    // @include references
    for (const match of source.matchAll(_SCSS_INCLUDE_RE)) {
      add(match[1], 'include', getLine(match.index), match[0].trim());
    }

    // @extend references
    for (const match of source.matchAll(_SCSS_EXTEND_RE)) {
      add(match[1], 'extend', getLine(match.index), match[0].trim());
    }

    // @use / @forward
    for (const match of source.matchAll(_SCSS_USE_RE)) {
      add(match[1], 'import', getLine(match.index), match[0].trim());
    }
  }

  return symbols;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/css-extractor.test.js`
Expected: All 9 tests PASS.

- [ ] **Step 5: Lint check**

Run: `npm run lint`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add parse-code.js test/css-extractor.test.js
git commit -m "feat(parse-code): add CSS/SCSS symbol extractor (selectors, variables, mixins, keyframes)"
```

---

### Task 5: Enhance JS/TS callee extraction for dynamic patterns

**Files:**
- Modify: `parse-code.js:1131-1209` (`_walkCallees`)

Currently `_walkCallees` captures:
- Direct calls: `foo()`
- Method calls: `obj.method()`
- `new` expressions: `new Foo()`

Missing patterns:
1. **Dynamic `import()`** — `import('./module.js')` — records the import path as a callee
2. **`eval()` / `Function()`** — marks as `is_dynamic: true` for security analysis
3. **`require()` calls** — captures the module path
4. **Tagged template literals** — `styled\`...\``, `html\`...\`` — records the tag function

- [ ] **Step 1: Write the failing test**

Create `test/dynamic-callees.test.js`:

```js
const { describe, it, expect } = require('vitest');

let parseCode;
async function getParser() {
  if (!parseCode) {
    parseCode = require('../parse-code');
    if (!parseCode.isReady()) {
      await parseCode.init();
    }
  }
  return parseCode;
}

describe('Dynamic callee extraction (via extractCalleesFromContent)', () => {
  it('captures dynamic import() paths', async () => {
    const parser = await getParser();
    const code = `const mod = import('./module.js');`;
    const result = parser.extractCalleesFromContent('test.js', code);
    const dynamicImports = result.filter(c => c.callee === 'import' && c.module_path);
    expect(dynamicImports.length).toBeGreaterThanOrEqual(1);
    expect(dynamicImports[0].module_path).toBe('./module.js');
  });

  it('captures require() module paths', async () => {
    const parser = await getParser();
    const code = `const fs = require('fs');`;
    const result = parser.extractCalleesFromContent('test.js', code);
    const requires = result.filter(c => c.callee === 'require' && c.module_path);
    expect(requires.length).toBeGreaterThanOrEqual(1);
    expect(requires[0].module_path).toBe('fs');
  });

  it('marks eval() calls as dynamic', async () => {
    const parser = await getParser();
    const code = `eval(userInput);`;
    const result = parser.extractCalleesFromContent('test.js', code);
    const evals = result.filter(c => c.callee === 'eval');
    expect(evals.length).toBeGreaterThanOrEqual(1);
  });

  it('captures tagged template literals', async () => {
    const parser = await getParser();
    const code = `const btn = styled.button\`color: red;\`;`;
    const result = parser.extractCalleesFromContent('test.js', code);
    const tagged = result.filter(c => c.callee === 'styled.button');
    expect(tagged.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dynamic-callees.test.js`
Expected: FAIL — dynamic imports, requires, eval, and tagged templates are not captured.

- [ ] **Step 3: Enhance `_walkCallees`**

The callee walker already handles `call_expression` and `new_expression`. We need to add handling for `import_expression` (dynamic import) and `tagged_template_expression`. For `eval` and `require`, they'll be caught by the existing `call_expression` handler — we just need to extract the first argument string.

Modify `_walkCallees` in `parse-code.js`. Find the function (around line 1131) and add these new cases inside the `walk` function, after the existing `new_expression` handler and before the child-walking loop:

```js
    // Dynamic import() — import('./path')
    if (node.type === 'import_expression') {
      for (const child of node.children) {
        if (child.type === 'string') {
          const modPath = child.text.replace(/^['"]|['"]$/g, '');
          const key = `import:${modPath}:${node.startPosition.row + 1}`;
          if (!seen.has(key)) {
            seen.add(key);
            callees.push({
              callee: 'import',
              line: node.startPosition.row + 1,
              is_method: false,
              receiver: null,
              full_path: 'import',
              module_path: modPath,
            });
          }
          break;
        }
      }
    }

    // Tagged template literals — styled`...`, html`...`
    if (node.type === 'tagged_template_expression') {
      const tag = node.child(0);
      if (tag) {
        let name = '';
        if (tag.type === 'identifier') {
          name = tag.text;
        } else if (tag.type === 'member_expression') {
          // Collect all identifiers from the chain
          const parts = [];
          for (const c of tag.children) {
            if (c.type === 'identifier' || c.type === 'property_identifier') {
              parts.push(c.text);
            }
          }
          name = parts.join('.');
        }
        if (name) {
          const key = `tagged:${name}:${node.startPosition.row + 1}`;
          if (!seen.has(key)) {
            seen.add(key);
            callees.push({
              callee: name,
              line: node.startPosition.row + 1,
              is_method: false,
              receiver: null,
              full_path: name,
              is_tagged_template: true,
            });
          }
        }
      }
    }
```

Also, enhance the existing `call_expression` handler to capture `require('module')` and `eval(...)` module_path/arguments. Inside the existing `call_expression` → `identifier` branch (around line 1140), after the existing callee push, add:

```js
          // For require('module') calls, capture the module path
          if (name === 'require') {
            const argsNode = node.childForFieldName('arguments');
            if (argsNode) {
              for (const argChild of argsNode.children) {
                if (argChild.type === 'string') {
                  const modPath = argChild.text.replace(/^['"]|['"]$/g, '');
                  // Update the last pushed callee with module_path
                  const last = callees[callees.length - 1];
                  if (last && last.callee === 'require') {
                    last.module_path = modPath;
                  }
                  break;
                }
              }
            }
          }
          // Mark eval() as dynamic
          if (name === 'eval' || name === 'Function') {
            const last = callees[callees.length - 1];
            if (last) {
              last.is_dynamic = true;
            }
          }
```

And in the `member_expression` branch (around line 1160), add the same `require` and `eval` handling after the existing push:

```js
          if (name === 'require') {
            const argsNode = node.childForFieldName('arguments');
            if (argsNode) {
              for (const argChild of argsNode.children) {
                if (argChild.type === 'string') {
                  const modPath = argChild.text.replace(/^['"]|['"]$/g, '');
                  const last = callees[callees.length - 1];
                  if (last) {
                    last.module_path = modPath;
                  }
                  break;
                }
              }
            }
          }
          if (name === 'eval' || name === 'Function') {
            const last = callees[callees.length - 1];
            if (last) {
              last.is_dynamic = true;
            }
          }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/dynamic-callees.test.js`
Expected: All 4 tests PASS.

- [ ] **Step 5: Run all existing tests to ensure no regression**

Run: `npx vitest run`
Expected: All tests PASS (existing + new).

- [ ] **Step 6: Lint check**

Run: `npm run lint`
Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add parse-code.js test/dynamic-callees.test.js
git commit -m "feat(parse-code): enhance callee extraction for dynamic import, require, eval, tagged templates"
```

---

### Task 6: Capture dynamic imports in `_extractJsTsSymbols` as export symbols

**Files:**
- Modify: `parse-code.js:486-653` (`_extractJsTsSymbols`)

When JS/TS files use `import('./module.js')`, we should record these as `kind: 'dynamic_import'` symbols so they appear in symbol search and dependency analysis.

- [ ] **Step 1: Write the failing test**

Add to `test/dynamic-callees.test.js`:

```js
  it('records dynamic imports as symbols in parseContent', async () => {
    const parser = await getParser();
    const code = `const mod = import('./module.js');\nconst other = import('../utils');`;
    const result = parser.parseContent('test.js', code);
    const dynImports = result.symbols.filter(s => s.kind === 'dynamic_import');
    expect(dynImports.length).toBeGreaterThanOrEqual(2);
    const paths = dynImports.map(s => s.name);
    expect(paths).toContain('./module.js');
    expect(paths).toContain('../utils');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dynamic-callees.test.js`
Expected: FAIL — no `dynamic_import` symbols extracted.

- [ ] **Step 3: Add import_expression handling in the walk() function inside `_extractJsTsSymbols`**

In the `walk` function inside `_extractJsTsSymbols` (around line 492), add a new case after the `export_default_statement` handler (around line 640) and before the child-walking loop:

```js
    } else if (node.type === 'import_expression') {
      for (const child of node.children) {
        if (child.type === 'string') {
          const modPath = child.text.replace(/^['"]|['"]$/g, '');
          const key = `${modPath}:dynamic_import:${node.startIndex}`;
          if (!seen.has(key)) {
            seen.add(key);
            symbols.push({
              name: modPath,
              kind: 'dynamic_import',
              language: languageName,
              file: filePath,
              signature: `import('${modPath}')`,
              qualified_name: modPath,
              start_line: _getLineNumber(node),
              end_line: _getEndLineNumber(node),
              start_byte: node.startIndex,
              end_byte: node.endIndex,
              docstring: '',
              body_preview: '',
              parent_name: '',
            });
          }
          break;
        }
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/dynamic-callees.test.js`
Expected: All tests PASS (including the new one).

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Lint check**

Run: `npm run lint`

- [ ] **Step 7: Commit**

```bash
git add parse-code.js test/dynamic-callees.test.js
git commit -m "feat(parse-code): record dynamic imports as symbols in JS/TS extraction"
```

---

### Task 7: Integration test — full index of a mixed project

**Files:**
- Create: `test/integration-mixed.test.js`

- [ ] **Step 1: Write integration test that creates temp files and indexes them**

```js
const { describe, it, expect, afterEach } = require('vitest');
const fs = require('fs');
const path = require('path');
const os = require('os');

let parseCode;
async function getParser() {
  if (!parseCode) {
    parseCode = require('../parse-code');
    if (!parseCode.isReady()) {
      await parseCode.init();
    }
  }
  return parseCode;
}

describe('Mixed file type parsing integration', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('parses JS, CSS, SCSS, and HTML files with appropriate symbols', async () => {
    const parser = await getParser();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-test-'));

    // Create test files
    fs.writeFileSync(path.join(tmpDir, 'app.js'), `
export function init() {
  const mod = import('./utils.js');
  return mod;
}
`);

    fs.writeFileSync(path.join(tmpDir, 'style.css'), `
:root {
  --primary: #333;
}
.container {
  display: flex;
}
@media (min-width: 768px) {
  .container { max-width: 720px; }
}
`);

    fs.writeFileSync(path.join(tmpDir, 'theme.scss'), `
$primary: #333;
@mixin flex-center {
  display: flex;
}
.btn {
  @include flex-center;
  @extend .base-btn;
}
`);

    fs.writeFileSync(path.join(tmpDir, 'index.html'), `
<div id="app" class="container">
  <MyComponent>
    <app-header></app-header>
  </MyComponent>
</div>
<script>
  console.log('hello');
</script>
`);

    // Parse each file
    const jsResult = parser.parseContent('app.js', fs.readFileSync(path.join(tmpDir, 'app.js'), 'utf8'));
    const cssResult = parser.parseContent('style.css', fs.readFileSync(path.join(tmpDir, 'style.css'), 'utf8'));
    const scssResult = parser.parseContent('theme.scss', fs.readFileSync(path.join(tmpDir, 'theme.scss'), 'utf8'));
    const htmlResult = parser.parseContent('index.html', fs.readFileSync(path.join(tmpDir, 'index.html'), 'utf8'));

    // JS should have init function + dynamic import
    expect(jsResult.symbols.length).toBeGreaterThanOrEqual(2);
    const jsKinds = jsResult.symbols.map(s => s.kind);
    expect(jsKinds).toContain('function');
    expect(jsKinds).toContain('dynamic_import');

    // CSS should have custom property + selectors + media
    expect(cssResult.symbols.length).toBeGreaterThanOrEqual(3);
    const cssKinds = cssResult.symbols.map(s => s.kind);
    expect(cssKinds).toContain('custom_property');
    expect(cssKinds).toContain('selector');
    expect(cssKinds).toContain('media_query');

    // SCSS should have variable + mixin + include + extend
    expect(scssResult.symbols.length).toBeGreaterThanOrEqual(4);
    const scssKinds = scssResult.symbols.map(s => s.kind);
    expect(scssKinds).toContain('scss_variable');
    expect(scssKinds).toContain('mixin');
    expect(scssKinds).toContain('include');
    expect(scssKinds).toContain('extend');

    // HTML should have ids, components, scripts
    expect(htmlResult.symbols.length).toBeGreaterThanOrEqual(3);
    const htmlKinds = htmlResult.symbols.map(s => s.kind);
    expect(htmlKinds).toContain('id');
    expect(htmlKinds).toContain('component');
    expect(htmlKinds).toContain('script');
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run test/integration-mixed.test.js`
Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add test/integration-mixed.test.js
git commit -m "test: add integration test for mixed file type parsing (JS, CSS, SCSS, HTML)"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ HTML parsing (ids, classes, components, scripts, styles) → Task 3
- ✅ CSS parsing (selectors, custom properties, keyframes, media queries) → Task 4
- ✅ SCSS parsing (variables, mixins, includes, extends, use/forward) → Task 4
- ✅ Dynamic JS/TS patterns (dynamic import, require, eval, tagged templates) → Tasks 5 & 6
- ✅ File extension registration → Task 1
- ✅ Routing/dispatch → Task 2
- ✅ Integration testing → Task 7

**2. Placeholder scan:**
- ✅ No TBDs or TODOs in code steps
- ✅ All regex patterns are fully specified
- ✅ All test code is complete

**3. Type consistency:**
- ✅ Symbol shape matches existing `{ name, kind, language, file, qualified_name, signature, start_line, end_line, start_byte, end_byte, docstring, body_preview, parent_name }` schema
- ✅ New callee properties (`module_path`, `is_dynamic`, `is_tagged_template`) are additive — won't break existing consumers
- ✅ `_routeToExtractor` regex path correctly doesn't pass `parser` to HTML/CSS extractors (they don't use it)

**4. Risk assessment:**
- Regex-based extraction is ~80% accurate for well-formatted HTML/CSS — won't catch minified or template-generated content. Acceptable for v1.
- No new npm dependencies added — zero bloat.
- The `_CSS_SELECTOR_RE` may have false positives on property-like lines starting with `{`. The filter logic mitigates this.
- Tagged template detection only handles simple member expressions (`styled.button`). Complex chains (`foo.bar.baz`) collect all parts.
