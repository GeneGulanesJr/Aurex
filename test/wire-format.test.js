// Tests for wire-format.js — compact encoding/decoding (MUNCH)
const wireFormat = require('../wire-format');

describe('wire-format.js', () => {
  describe('_escapePipe / _unescapePipe', () => {
    it('should round-trip basic values', () => {
      expect(wireFormat._unescapePipe(wireFormat._escapePipe('hello'))).toBe('hello');
      expect(wireFormat._unescapePipe(wireFormat._escapePipe('foo|bar'))).toBe('foo|bar');
      expect(wireFormat._unescapePipe(wireFormat._escapePipe('a\\b'))).toBe('a\\b');
      expect(wireFormat._unescapePipe(wireFormat._escapePipe('a\\b|c'))).toBe('a\\b|c');
    });

    it('should handle null/undefined', () => {
      expect(wireFormat._escapePipe(null)).toBe('');
      expect(wireFormat._escapePipe(undefined)).toBe('');
    });

    it('should handle edge case: literal backslash-p', () => {
      const input = 'foo\\pbar';
      const escaped = wireFormat._escapePipe(input);
      const unescaped = wireFormat._unescapePipe(escaped);
      expect(unescaped).toBe(input);
    });
  });

  describe('_encodeList / _decodeList', () => {
    it('should encode and decode an empty list', () => {
      const result = wireFormat._encodeList([]);
      expect(result._header).toEqual([]);
      expect(result._rows).toEqual([]);
      expect(wireFormat._decodeList(result)).toEqual([]);
    });

    it('should encode and decode a list of homogeneous objects', () => {
      const rows = [
        { name: 'foo', kind: 'function', file: 'src/a.js' },
        { name: 'bar', kind: 'class', file: 'src/b.js' },
        { name: 'baz', kind: 'method', file: 'src/c.js' },
      ];
      const compact = wireFormat._encodeList(rows);
      expect(compact._header).toEqual(['name', 'kind', 'file']);
      expect(compact._rows.length).toBe(3);

      const decoded = wireFormat._decodeList(compact);
      expect(decoded.length).toBe(3);
      expect(decoded[0].name).toBe('foo');
      expect(decoded[0].kind).toBe('function');
      expect(decoded[1].name).toBe('bar');
      expect(decoded[2].name).toBe('baz');
    });

    it('should handle null values in rows', () => {
      const rows = [
        { name: 'foo', value: null },
        { name: 'bar', value: 42 },
      ];
      const compact = wireFormat._encodeList(rows);
      const decoded = wireFormat._decodeList(compact);
      expect(decoded[0].value).toBeNull();
      expect(decoded[1].value).toBe(42);
    });

    it('should handle numeric values', () => {
      const rows = [
        { name: 'a', count: 5, ratio: 0.5 },
        { name: 'b', count: 10, ratio: 0.8 },
      ];
      const compact = wireFormat._encodeList(rows);
      const decoded = wireFormat._decodeList(compact);
      expect(decoded[0].count).toBe(5);
      expect(decoded[1].count).toBe(10);
      expect(decoded[0].ratio).toBe(0.5);
    });

    it('should apply path prefix interning for 3+ shared prefixes', () => {
      const rows = [
        { file: 'src/utils/helpers/string.js' },
        { file: 'src/utils/helpers/number.js' },
        { file: 'src/utils/helpers/array.js' },
        { file: 'src/utils/helpers/object.js' },
      ];
      const compact = wireFormat._encodeList(rows);
      expect(compact._prefixes).toBeDefined();
      // Should intern the common prefix
      const decoded = wireFormat._decodeList(compact);
      expect(decoded.length).toBe(4);
      expect(decoded[0].file).toBe('src/utils/helpers/string.js');
      expect(decoded[3].file).toBe('src/utils/helpers/object.js');
    });

    it('should handle values with pipe and backslash', () => {
      const rows = [
        { name: 'foo|bar', kind: 'func\\tion' },
      ];
      const compact = wireFormat._encodeList(rows);
      const decoded = wireFormat._decodeList(compact);
      expect(decoded[0].name).toBe('foo|bar');
      expect(decoded[0].kind).toBe('func\\tion');
    });
  });

  describe('_isHomogeneous', () => {
    it('should detect homogeneous lists', () => {
      const rows = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
      expect(wireFormat._isHomogeneous(rows)).toBe(true);
    });

    it('should reject non-homogeneous lists', () => {
      const rows = [{ a: 1, b: 2 }, { a: 3, c: 4 }];
      expect(wireFormat._isHomogeneous(rows)).toBe(false);
    });

    it('should reject non-object arrays', () => {
      expect(wireFormat._isHomogeneous([1, 2, 3])).toBe(false);
    });

    it('should reject arrays with fewer than 2 items', () => {
      expect(wireFormat._isHomogeneous([])).toBe(false);
      expect(wireFormat._isHomogeneous([{ a: 1 }])).toBe(false);
    });
  });

  describe('_findEncodableList', () => {
    it('should find the largest homogeneous array', () => {
      const data = {
        files: [{ name: 'a', kind: 'fn' }, { name: 'b', kind: 'cls' }],
        other: [{ x: 1 }, { x: 2 }, { x: 3 }],
      };
      const result = wireFormat._findEncodableList(data);
      expect(result).not.toBeNull();
      expect(result.key).toBe('other'); // larger list
      expect(result.len).toBe(3);
    });

    it('should return null for data without arrays', () => {
      const data = { name: 'test', value: 42 };
      expect(wireFormat._findEncodableList(data)).toBeNull();
    });

    it('should return null for null input', () => {
      expect(wireFormat._findEncodableList(null)).toBeNull();
    });
  });

  describe('compactResponse / expandResponse', () => {
    it('should round-trip a full response', () => {
      const data = {
        files: [
          { name: 'foo.js', commits: 5, authors: 2 },
          { name: 'bar.js', commits: 3, authors: 1 },
          { name: 'baz.js', commits: 0, authors: 0 },
        ],
        total: 3,
      };
      const compact = wireFormat.compactResponse(data);
      expect(compact.files._header).toBeDefined();

      const expanded = wireFormat.expandResponse(compact);
      expect(expanded.files.length).toBe(3);
      expect(expanded.files[0].name).toBe('foo.js');
      expect(expanded.files[0].commits).toBe(5);
      expect(expanded.total).toBe(3);
    });

    it('should not touch data without encodable lists', () => {
      const data = { ok: true, message: 'done' };
      const result = wireFormat.compactResponse(data);
      expect(result).toEqual(data);
    });
  });

  describe('autoFormat', () => {
    it('should return json for small payloads', () => {
      const data = { results: [{ a: 1 }, { a: 2 }] };
      expect(wireFormat.autoFormat(data)).toBe('json');
    });

    it('should return compact for large homogeneous payloads', () => {
      const rows = [];
      for (let i = 0; i < 50; i++) {
        rows.push({ name: `symbol_${i}`, kind: 'function', file: `src/module/file_${i}.js` });
      }
      const data = { symbols: rows };
      const fmt = wireFormat.autoFormat(data);
      // 50 homogeneous rows should trigger compact
      expect(fmt).toBe('compact');
    });

    it('should return json when no encodable list found', () => {
      expect(wireFormat.autoFormat({ ok: true })).toBe('json');
    });
  });

  describe('estimateTokens', () => {
    it('should estimate token count using 1 token ≈ 3.5 chars', () => {
      // 35 chars → 10 tokens
      const obj = { hello: 'world', extra: 'this is some padding text' };
      const tokens = wireFormat.estimateTokens(obj);
      const jsonStr = JSON.stringify(obj);
      const expected = Math.ceil(jsonStr.length / 3.5);
      expect(tokens).toBe(expected);
      expect(tokens).toBeGreaterThan(0);
    });
  });
});
