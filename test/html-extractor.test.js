import { describe, expect, it } from 'vitest';

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
    const symbols = parser.parseContent('test.html', html);
    const ids = symbols.filter((s) => s.kind === 'id');
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const idNames = ids.map((s) => s.name);
    expect(idNames).toContain('app');
    expect(idNames).toContain('title');
  });

  it('extracts inline script blocks', async () => {
    const parser = await getParser();
    const html = `<script>\nfunction hello() {}\n</script>`;
    const symbols = parser.parseContent('test.html', html);
    const scripts = symbols.filter((s) => s.kind === 'script');
    expect(scripts.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts inline style blocks', async () => {
    const parser = await getParser();
    const html = `<style>\n.my-class { color: red; }\n</style>`;
    const symbols = parser.parseContent('test.html', html);
    const styles = symbols.filter((s) => s.kind === 'style');
    expect(styles.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts custom element / component tags', async () => {
    const parser = await getParser();
    const html = `<MyButton>\n<app-header></app-header>\n</MyButton>`;
    const symbols = parser.parseContent('test.html', html);
    const components = symbols.filter((s) => s.kind === 'component');
    expect(components.length).toBeGreaterThanOrEqual(2);
    const names = components.map((s) => s.name);
    expect(names).toContain('MyButton');
    expect(names).toContain('app-header');
  });

  it('extracts class attributes', async () => {
    const parser = await getParser();
    const html = `<div class="container active">\n  <p class="text-primary">Hi</p>\n</div>`;
    const symbols = parser.parseContent('test.html', html);
    const classes = symbols.filter((s) => s.kind === 'css_class');
    expect(classes.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for empty HTML', async () => {
    const parser = await getParser();
    const symbols = parser.parseContent('test.html', '');
    expect(symbols).toEqual([]);
  });
});
