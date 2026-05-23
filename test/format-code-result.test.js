import { formatCodeResult } from '../extensions/memory-layer/tools/format-code-result.ts';

describe('tools/format-code-result', () => {
  describe('search', () => {
    it('should format code search results', () => {
      const result = formatCodeResult('search', {
        query: 'context command',
        results: [
          {
            symbol: 'context',
            file: 'src/memory-domain/context.js',
            line: 4,
            signature: 'function context(deps, args) {',
            snippet: 'return { sessions, personal, observations }',
          },
        ],
      });

      expect(result).toContain('Code search');
      expect(result).toContain('src/memory-domain/context.js:4');
      expect(result).toContain('return');
    });
  });

  describe('callers', () => {
    it('should format callers result', () => {
      const result = formatCodeResult('callers', {
        symbol: 'myFunc',
        callers: [
          { depth: 1, name: 'callerA', file_path: 'src/a.ts' },
          { depth: 2, name: 'callerB', file_path: 'src/b.ts' },
        ],
      });
      expect(result).toContain('Callers of myFunc');
      expect(result).toContain('callerA (src/a.ts)');
      expect(result).toContain('[depth 1]');
    });

    it('should show none found when empty', () => {
      const result = formatCodeResult('callers', { symbol: 'myFunc', callers: [] });
      expect(result).toContain('(none found)');
    });
  });

  describe('callees', () => {
    it('should format callees result', () => {
      const result = formatCodeResult('callees', {
        symbol: 'myFunc',
        callees: [{ depth: 1, name: 'calleeA', file_path: 'src/c.ts' }],
      });
      expect(result).toContain('Callees from myFunc');
    });
  });

  describe('blast-radius', () => {
    it('should format blast radius result', () => {
      const result = formatCodeResult('blast-radius', {
        symbol: 'myFunc',
        file: 'src/main.ts',
        affected_files: ['a.ts', 'b.ts'],
        callers: [{ depth: 1, name: 'c1', file_path: 'c.ts' }],
        file_importers: [{ depth: 1, path: 'd.ts' }],
      });
      expect(result).toContain('Blast radius of myFunc');
      expect(result).toContain('Affected files: 2');
      expect(result).toContain('Callers:');
      expect(result).toContain('File importers:');
    });
  });

  describe('dead-code', () => {
    it('should format dead code result', () => {
      const result = formatCodeResult('dead-code', {
        dead_files: [{ path: 'unused.ts' }],
        dead_symbols: [{ confidence: 'high', name: 'oldFn', file: 'old.ts', signals: ['no callers'] }],
      });
      expect(result).toContain('Dead code analysis');
      expect(result).toContain('1 dead files');
      expect(result).toContain('unused.ts');
    });
  });

  describe('complexity', () => {
    it('should format array complexity result', () => {
      const result = formatCodeResult('complexity', [
        { name: 'complexFn', file_path: 'src/x.ts', assessment: 'high', cyclomatic: 15, nesting_depth: 4 },
        { name: 'medFn', file_path: 'src/y.ts', assessment: 'medium', cyclomatic: 8, nesting_depth: 2 },
        { name: 'lowFn', file_path: 'src/z.ts', assessment: 'low', cyclomatic: 2, nesting_depth: 1 },
      ]);
      expect(result).toContain('3 functions');
      expect(result).toContain('1 high');
      expect(result).toContain('complexFn');
    });

    it('should format single function complexity', () => {
      const result = formatCodeResult('complexity', {
        name: 'myFn',
        file_path: 'src/fn.ts',
        cyclomatic: 5,
        nesting_depth: 2,
        param_count: 3,
        lines_of_code: 20,
        assessment: 'medium',
      });
      expect(result).toContain('myFn');
      expect(result).toContain('cyclomatic=5');
    });
  });

  describe('deps', () => {
    it('should format downstream/upstream deps', () => {
      const result = formatCodeResult('deps', {
        downstream: [{ depth: 1, path: 'a.ts' }],
        upstream: [{ depth: 1, path: 'b.ts' }],
      });
      expect(result).toContain('Downstream:');
      expect(result).toContain('Upstream:');
    });

    it('should format edge list when no downstream/upstream', () => {
      const result = formatCodeResult('deps', {
        edges: [{ source: 'a.ts', target: 'b.ts', type: 'import' }],
      });
      expect(result).toContain('**Import graph:** 1 edges');
      expect(result).toContain('a.ts → b.ts');
    });
  });

  describe('outline', () => {
    it('should format classes outline', () => {
      const result = formatCodeResult('outline', {
        classes: [
          {
            name: 'MyClass',
            methods: [{ kind: 'method', name: 'doIt', signature: '(): void' }],
          },
        ],
        standalone: [{ kind: 'function', name: 'helper' }],
      });
      expect(result).toContain('File outline');
      expect(result).toContain('MyClass');
      expect(result).toContain('helper');
    });

    it('should format directory outlines as compact file summaries', () => {
      const result = formatCodeResult('outline', {
        file: 'src',
        directory: true,
        total_files: 30,
        truncated: true,
        files: ['src/a.js', 'src/b.js'],
      });

      expect(result).toContain('Directory outline');
      expect(result).toContain('src/a.js');
      expect(result).toContain('28 more files');
      expect(result).toContain('Refine --file');
    });

    it('should format missing-file suggestions instead of an empty outline', () => {
      const result = formatCodeResult('outline', {
        file: 'src/context-injection.ts',
        classes: [],
        standalone: [],
        not_found: true,
        message: 'File not found: "src/context-injection.ts". Did you mean one of these?',
        suggestions: ['extensions/memory-layer/hooks/context-injection.ts'],
        hint: 'Use --file with a path relative to the repo root.',
      });

      expect(result).toContain('File not found');
      expect(result).toContain('extensions/memory-layer/hooks/context-injection.ts');
      expect(result).not.toBe('**File outline**\n');
    });
  });

  describe('cycles', () => {
    it('should report no cycles', () => {
      const result = formatCodeResult('cycles', { cycles: [] });
      expect(result).toContain('No dependency cycles found');
    });

    it('should format cycles', () => {
      const result = formatCodeResult('cycles', {
        cycles: [{ size: 3, files: ['a.ts', 'b.ts', 'c.ts'], edges: [{ from: 'a.ts', to: 'b.ts' }] }],
      });
      expect(result).toContain('Cycle 1');
      expect(result).toContain('3 files');
    });
  });

  describe('hotspots', () => {
    it('should report no hotspots', () => {
      const result = formatCodeResult('hotspots', { hotspots: [], note: 'repo empty' });
      expect(result).toContain('No hotspots found');
    });
  });

  describe('index-repo', () => {
    it('should format successful indexing', () => {
      const result = formatCodeResult('index-repo', { name: 'myrepo', file_count: 10, symbol_count: 50 });
      expect(result).toContain('indexed');
      expect(result).toContain('10 files');
    });

    it('should format indexing error', () => {
      const result = formatCodeResult('index-repo', { error: 'no path' });
      expect(result).toContain('Error: no path');
    });
  });

  describe('default', () => {
    it('should JSON-stringify unknown modes', () => {
      const result = formatCodeResult('unknown-mode', { foo: 'bar' });
      expect(result).toContain('"foo"');
    });
  });
});
