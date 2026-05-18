import { describe, it, expect } from 'vitest';

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
    const symbols = parser.parseContent('test.css', css);
    const classes = symbols.filter((s) => s.kind === 'selector');
    const names = classes.map((s) => s.name);
    expect(names).toContain('.container');
    expect(names).toContain('.text-primary');
  });

  it('extracts CSS custom properties', async () => {
    const parser = await getParser();
    const css = `:root {\n  --primary: #333;\n  --spacing: 1rem;\n}`;
    const symbols = parser.parseContent('test.css', css);
    const vars = symbols.filter((s) => s.kind === 'custom_property');
    const names = vars.map((s) => s.name);
    expect(names).toContain('--primary');
    expect(names).toContain('--spacing');
  });

  it('extracts @keyframes', async () => {
    const parser = await getParser();
    const css = `@keyframes fadeIn {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}`;
    const symbols = parser.parseContent('test.css', css);
    const kf = symbols.filter((s) => s.kind === 'keyframes');
    expect(kf.length).toBeGreaterThanOrEqual(1);
    expect(kf[0].name).toContain('fadeIn');
  });

  it('extracts @media queries', async () => {
    const parser = await getParser();
    const css = `@media (min-width: 768px) {\n  .container { max-width: 720px; }\n}`;
    const symbols = parser.parseContent('test.css', css);
    const media = symbols.filter((s) => s.kind === 'media_query');
    expect(media.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts SCSS variables', async () => {
    const parser = await getParser();
    const scss = `$primary: #333;\n$font-stack: Helvetica, sans-serif;`;
    const symbols = parser.parseContent('test.scss', scss);
    const vars = symbols.filter((s) => s.kind === 'scss_variable');
    const names = vars.map((s) => s.name);
    expect(names).toContain('$primary');
    expect(names).toContain('$font-stack');
  });

  it('extracts SCSS @mixin and @include', async () => {
    const parser = await getParser();
    const scss = `@mixin flex-center {\n  display: flex;\n  justify-content: center;\n}\n\n.container {\n  @include flex-center;\n}`;
    const symbols = parser.parseContent('test.scss', scss);
    const mixins = symbols.filter((s) => s.kind === 'mixin');
    const includes = symbols.filter((s) => s.kind === 'include');
    expect(mixins.length).toBeGreaterThanOrEqual(1);
    expect(includes.length).toBeGreaterThanOrEqual(1);
    expect(mixins[0].name).toContain('flex-center');
    expect(includes[0].name).toContain('flex-center');
  });

  it('extracts SCSS @extend', async () => {
    const parser = await getParser();
    const scss = `.error {\n  border: 1px red;\n}\n.critical {\n  @extend .error;\n}`;
    const symbols = parser.parseContent('test.scss', scss);
    const extends_ = symbols.filter((s) => s.kind === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts SCSS @use and @forward', async () => {
    const parser = await getParser();
    const scss = `@use 'sass:math';\n@forward 'variables';`;
    const symbols = parser.parseContent('test.scss', scss);
    const imports = symbols.filter((s) => s.kind === 'import');
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array for empty CSS', async () => {
    const parser = await getParser();
    const symbols = parser.parseContent('test.css', '');
    expect(symbols).toEqual([]);
  });
});
