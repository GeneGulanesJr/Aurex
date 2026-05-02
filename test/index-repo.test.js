// test/index-repo.test.js
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const STORE = path.resolve(__dirname, '..', 'memory-store.js');

describe('index-repo (WASM)', () => {
  it('should index a small repo without Python', () => {
    // Create a temp repo with a JS file
    const tmpRepo = path.join('/tmp', 'test-wasm-integ');
    fs.mkdirSync(tmpRepo, { recursive: true });
    fs.writeFileSync(
      path.join(tmpRepo, 'app.js'),
      '/** App entry */\nfunction main() {\n  console.log("hello");\n}\n\nclass Server {\n  start() {\n    return 42;\n  }\n}',
    );

    const out = execSync(`node "${STORE}" index-repo --path "${tmpRepo}" --name test-wasm-integ`, {
      encoding: 'utf8',
      timeout: 30000,
    });
    const result = JSON.parse(out);

    expect(result.success).toBe(true);
    expect(result.files_indexed).toBeGreaterThanOrEqual(1);
    expect(result.symbols_extracted).toBeGreaterThanOrEqual(3);

    // Clean up
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
    const out = execSync(
      `node "${STORE}" get-code-source --repo test-wasm-integ --file /tmp/test-wasm-integ/app.js --name main`,
      { encoding: 'utf8', timeout: 10000 },
    );
    const result = JSON.parse(out);
    expect(result.success).toBe(true);
    expect(result.symbol).toBe('main');
    expect(result.source).toContain('main');
  });

  it('should list code repos', () => {
    const out = execSync(`node "${STORE}" list-code-repos`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    const result = JSON.parse(out);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('should not reference Python in any error messages', () => {
    const out = execSync(`node "${STORE}" index-repo --path /nonexistent/path/abc123 --name nope`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    // Should not mention Python in error messages
    expect(out).not.toContain('Python');
    expect(out).not.toContain('pip');
    expect(out).not.toContain('venv');
  });
});
