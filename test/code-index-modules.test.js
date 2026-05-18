const fs = require('fs');
const os = require('os');
const path = require('path');
const { getLanguageForFile, canParseFile } = require('../src/code-index/parser-registry');
const { normalizeSymbol, extractSymbolsFromFile } = require('../src/code-index/symbol-extractor');
const { sourceSliceFromRow } = require('../src/code-index/source-retrieval');
const { parsePhase, reindexRepository } = require('../src/code-index/incremental-indexer');
const { scanRepository } = require('../src/code-index/scanner');

describe('code-index parser registry', () => {
  it('maps supported file extensions to parser languages', () => {
    expect(getLanguageForFile('/repo/app.js')).toBe('javascript');
    expect(getLanguageForFile('/repo/app.tsx')).toBe('typescript');
    expect(getLanguageForFile('/repo/main.py')).toBe('python');
    expect(getLanguageForFile('/repo/main.go')).toBe('go');
    expect(getLanguageForFile('/repo/main.rs')).toBe('rust');
    expect(getLanguageForFile('/repo/README.md')).toBeNull();
  });

  it('only reports bundled code extensions as parseable', () => {
    expect(canParseFile('/repo/app.cjs')).toBe(true);
    expect(canParseFile('/repo/notes.txt')).toBe(false);
  });
});

describe('code-index parse progress', () => {
  it('reports what parsing sub-step is currently running', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-parse-progress-'));
    const filePath = path.join(tmp, 'app.js');
    fs.writeFileSync(filePath, 'function app() { return 1; }');
    const progress = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = (chunk, encoding, cb) => {
      progress.push(JSON.parse(String(chunk)));
      if (typeof cb === 'function') {
        cb();
      }
      return true;
    };

    try {
      await parsePhase(
        [filePath],
        {
          parserRegistry: {
            canParseFile: () => true,
            parseContent: () => [
              {
                name: 'app',
                kind: 'function',
                signature: 'function app()',
                qualified_name: 'app',
                start_line: 1,
                end_line: 1,
                start_byte: 0,
                end_byte: 28,
                language: 'javascript',
              },
            ],
          },
          repository: {
            withTransaction: (fn) => fn(),
            insertFile: () => 123,
            insertSymbol: () => {},
          },
        },
        7,
        { progress: true, repoRoot: tmp, noWorkers: true },
      );
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(progress.map((p) => p.step)).toEqual(
      expect.arrayContaining(['read-files', 'extract-symbols', 'store-index']),
    );
    expect(progress.some((p) => p.current_file === 'app.js')).toBe(true);
  });
});

describe('code-index symbol extractor', () => {
  it('normalizes optional parser fields without losing byte ranges', () => {
    const normalized = normalizeSymbol(
      {
        name: 'main',
        kind: 'function',
        start_line: 1,
        end_line: 3,
        start_byte: 0,
        end_byte: 30,
        language: 'javascript',
      },
      '/repo/app.js',
    );

    expect(normalized).toMatchObject({
      file_path: '/repo/app.js',
      name: 'main',
      qualified_name: 'main',
      docstring: '',
      body_preview: '',
      parent_name: '',
      start_byte: 0,
      end_byte: 30,
    });
  });

  it('extracts symbols through the parser registry abstraction', () => {
    const registry = {
      canParseFile: () => true,
      parseFile: () => [
        {
          name: 'answer',
          kind: 'function',
          signature: 'function answer()',
          qualified_name: 'answer',
          start_line: 1,
          end_line: 1,
          start_byte: 0,
          end_byte: 20,
          language: 'javascript',
        },
      ],
    };

    expect(extractSymbolsFromFile('/repo/app.js', registry)).toHaveLength(1);
    expect(extractSymbolsFromFile('/repo/app.js', registry)[0].name).toBe('answer');
  });
});

describe('code-index source retrieval', () => {
  it('slices source by UTF-8 byte offsets instead of JavaScript character offsets', () => {
    const content = 'const emoji = "💎";\nfunction target() { return emoji; }\n';
    const expected = 'function target() { return emoji; }';
    const startByte = Buffer.byteLength('const emoji = "💎";\n', 'utf-8');
    const endByte = startByte + Buffer.byteLength(expected, 'utf-8');

    expect(sourceSliceFromRow({ content, start_byte: startByte, end_byte: endByte })).toBe(expected);
  });
});

describe('code-index incremental reindexer', () => {
  it('removes deleted files through the CodeIndexRepository interface', async () => {
    const calls = [];
    const repository = {
      findRepoByName: () => ({ id: 7, name: 'repo', path: '/definitely/missing/repo' }),
      listFiles: () => [{ id: 10, path: '/definitely/missing/repo/deleted.js', mtime: 1 }],
      deleteFile: (fileId) => calls.push(['deleteFile', fileId]),
      updateRepoStats: (params) => calls.push(['updateRepoStats', params.repoId]),
    };
    const parserRegistry = { ensureReady: async () => true };

    const result = await reindexRepository({ db: {}, repository, parserRegistry, args: {} }, 'repo', 'incremental');

    expect(result.success).toBe(true);
    expect(result.files_removed).toBe(1);
    expect(calls).toContainEqual(['deleteFile', 10]);
    expect(calls).toContainEqual(['updateRepoStats', 7]);
  });
});

describe('code-index scanner', () => {
  it('continues scanning after unsupported files and reports discovery progress', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-scan-'));
    fs.writeFileSync(path.join(tmp, 'README.md'), '# docs');
    fs.writeFileSync(path.join(tmp, 'app.js'), 'function app() { return 1; }');
    const progress = [];

    const result = scanRepository(tmp, { onScanProgress: (stats) => progress.push(stats) });

    expect(result.files).toEqual([path.join(tmp, 'app.js')]);
    expect(result.skipReport.unsupportedExt).toBe(1);
    expect(progress[progress.length - 1]).toMatchObject({ done: true, codeFiles: 1 });
    expect(progress.some((p) => p.currentPath === 'app.js' && p.currentKind === 'file')).toBe(true);
  });
});
