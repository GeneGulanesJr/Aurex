const markdownParser = require('../src/doc-index/markdown-parser');
const links = require('../src/doc-index/links');
const glossary = require('../src/doc-index/glossary');
const examples = require('../src/doc-index/examples');
const analytics = require('../src/doc-index/analytics');

describe('doc-index focused modules', () => {
  it('parses markdown sections through the parser module', () => {
    const sections = markdownParser.parseMarkdownSections('# API Reference\n\nUse #docs here.', '/tmp/api.md');
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ title: 'API Reference', level: 1, role: 'api' });
    expect(sections[0].tags).toBe('docs');
  });

  it('extracts internal links and ignores images/code links', () => {
    const found = links.extractLinks(
      '[Intro](./intro.md) ![Logo](./logo.png) `see [x](bad.md)`\n```md\n[Nope](hidden.md)\n```\n[Site](https://example.com)',
    );
    expect(found).toEqual([
      { target_path: './intro.md', link_text: 'Intro', is_internal: true },
      { target_path: 'https://example.com', link_text: 'Site', is_internal: false },
    ]);
  });

  it('extracts glossary terms from definition-style bold text', () => {
    expect(glossary.extractGlossaryTerms('**Index** — A searchable documentation corpus.')).toEqual([
      { term: 'index', definition: 'A searchable documentation corpus.' },
    ]);
  });

  it('extracts fenced code examples with byte offsets', () => {
    const blocks = examples.extractCodeBlocks('Before\n```js\nconsole.log("ok");\n```', 10);
    expect(blocks).toEqual([{ lang: 'js', content: 'console.log("ok");', byte_start: 17, byte_end: 42 }]);
  });

  it('computes doc coverage from a narrow symbol lookup result', () => {
    const report = analytics.getDocCoverageReport(
      [
        { id: 1, name: 'indexDocs', kind: 'function', file_path: 'doc-index.js' },
        { id: 2, name: 'missing_symbol', kind: 'function', file_path: 'x.js' },
      ],
      [{ id: 10, title: 'indexDocs', content: 'Call indexDocs(path).', role: 'api' }],
    );
    expect(report.coverage_pct).toBe(50);
    expect(report.documented_list).toHaveLength(1);
    expect(report.undocumented_list).toHaveLength(1);
  });
});
