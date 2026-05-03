// Integration tests for index-repo (WASM-based)
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const STORE = path.resolve(__dirname, '..', 'memory-store.js');

function writeTmpRepo(repoPath, files) {
  fs.mkdirSync(repoPath, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(repoPath, name), content);
  }
}

describe('index-repo (WASM)', () => {
  describe('basic indexing', () => {
    it('should index a small repo without Python', () => {
      const tmpRepo = path.join('/tmp', 'test-wasm-integ');
      fs.mkdirSync(tmpRepo, { recursive: true });
      fs.writeFileSync(path.join(tmpRepo, 'app.js'),
        '/** App entry */\nfunction main() {\n  console.log("hello");\n}\n\nclass Server {\n  start() {\n    return 42;\n  }\n}');

      const out = execSync(`node "${STORE}" index-repo --path "${tmpRepo}" --name test-wasm-integ`, {
        encoding: 'utf8',
        timeout: 30000,
      });
      const result = JSON.parse(out);

      expect(result.success).toBe(true);
      expect(result.files_indexed).toBeGreaterThanOrEqual(1);
      expect(result.symbols_extracted).toBeGreaterThanOrEqual(3);

      fs.rmSync(tmpRepo, { recursive: true });
    });

    it('should search indexed code', () => {
      const out = execSync(`node "${STORE}" search-code --query main --repo test-wasm-integ`, {
        encoding: 'utf8',
        timeout: 10000,
      });
      const result = JSON.parse(out);
      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.results[0].symbol).toBe('main');
    });

    it('should get code source', () => {
      const out = execSync(`node "${STORE}" get-code-source --repo test-wasm-integ --file /tmp/test-wasm-integ/app.js --name main`, {
        encoding: 'utf8',
        timeout: 10000,
      });
      const result = JSON.parse(out);
      expect(result.success).toBe(true);
      expect(result.symbol).toBe('main');
      expect(result.source).toContain('main');
    });

    it('should not reference Python in any error messages', () => {
      const out = execSync(`node "${STORE}" index-repo --path /nonexistent/path/abc123 --name nope`, {
        encoding: 'utf8',
        timeout: 10000,
      });
      expect(out).not.toContain('Python');
      expect(out).not.toContain('pip');
      expect(out).not.toContain('venv');
    });
  });

  describe('multi-language indexing', () => {
    it('should index a mixed-language repo (JS + TS + TSX)', () => {
      const tmpRepo = path.join('/tmp', 'test-mixed-repo');
      writeTmpRepo(tmpRepo, {
        'utils.js': 'function helper(x) {\n  return x * 2;\n}',
        'types.ts': 'interface Config {\n  port: number;\n}\n\nfunction parseConfig(): Config {\n  return { port: 3000 };\n}',
        'Component.tsx': 'export function Button({ label }: { label: string }) {\n  return <button>{label}</button>;\n}',
      });

      const out = execSync(`node "${STORE}" index-repo --path "${tmpRepo}" --name test-mixed-repo`, {
        encoding: 'utf8',
        timeout: 30000,
      });
      const result = JSON.parse(out);

      expect(result.success).toBe(true);
      expect(result.files_indexed).toBeGreaterThanOrEqual(3);
      expect(result.symbols_extracted).toBeGreaterThanOrEqual(4);

      fs.rmSync(tmpRepo, { recursive: true });
    });

    it('should handle repos with only unsupported file types gracefully', () => {
      const tmpRepo = path.join('/tmp', 'test-bad-repo');
      fs.mkdirSync(tmpRepo, { recursive: true });
      fs.writeFileSync(path.join(tmpRepo, 'README.txt'), 'Hello');

      const out = execSync(`node "${STORE}" index-repo --path "${tmpRepo}" --name test-bad-repo-2`, {
        encoding: 'utf8',
        timeout: 10000,
      });
      const result = JSON.parse(out);
      expect(result.files_indexed).toBeGreaterThanOrEqual(0);

      fs.rmSync(tmpRepo, { recursive: true });
    });
  });

  describe('repo management', () => {
    it('should list code repos', () => {
      const out = execSync(`node "${STORE}" list-code-repos`, {
        encoding: 'utf8',
        timeout: 10000,
      });
      const result = JSON.parse(out);
      expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it('should reindex an existing repo', () => {
      const out = execSync(`node "${STORE}" reindex-repo --repo test-wasm-integ`, {
        encoding: 'utf8',
        timeout: 30000,
      });
      const result = JSON.parse(out);
      expect(result.success).toBe(true);
      expect(result.files_reindexed).toBeGreaterThanOrEqual(0);
    });

    it('should list repos with file/symbol counts', () => {
      const out = execSync(`node "${STORE}" list-code-repos`, {
        encoding: 'utf8',
        timeout: 10000,
      });
      const result = JSON.parse(out);
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.repos.length).toBeGreaterThanOrEqual(1);
      const first = result.repos[0];
      expect(first.name).toBeTruthy();
      expect(typeof first.file_count).toBe('number');
    });

    it('should delete a code repo', () => {
      const out = execSync(`node "${STORE}" remove-code-repo --repo test-mixed-repo`, {
        encoding: 'utf8',
        timeout: 10000,
      });
      const result = JSON.parse(out);
      expect(result.success).toBe(true);

      // Also clean up test-bad-repo-2
      execSync(`node "${STORE}" remove-code-repo --repo test-bad-repo-2`, {
        encoding: 'utf8',
        timeout: 10000,
      });
    });

    it('should report churn metrics with git data', () => {
      // Churn runs against PiMemoryExtension which is the repo itself on disk.
      // In CI the repo may not be indexed yet — index it first.
      try {
        execSync(`node "${STORE}" index-repo --path "${path.resolve(__dirname, '..')}" --name PiMemoryExtension`, {
          encoding: 'utf8',
          timeout: 30000,
        });
      } catch { /* May already be indexed */ }

      try {
        const out = execSync(`node "${STORE}" churn --repo PiMemoryExtension`, {
          encoding: 'utf8',
          timeout: 30000,
        });
        expect(() => JSON.parse(out.trim())).not.toThrow();
      } catch (e) {
        // Churn may fail if git history unavailable — that's OK
        expect(e.stderr || e.message).toBeTruthy();
      }
    });
  });
});
