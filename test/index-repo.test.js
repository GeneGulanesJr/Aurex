// test/index-repo.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const STORE = path.resolve(__dirname, '..', 'memory-store.js');

describe('index-repo (WASM)', () => {
  it('should index a small repo without Python', () => {
    // Create a temp repo with a JS file
    const tmpRepo = path.join('/tmp', 'test-wasm-integ');
    fs.mkdirSync(tmpRepo, { recursive: true });
    fs.writeFileSync(path.join(tmpRepo, 'app.js'),
      '/** App entry */\nfunction main() {\n  console.log("hello");\n}\n\nclass Server {\n  start() {\n    return 42;\n  }\n}');

    const out = execSync(`node "${STORE}" index-repo --path "${tmpRepo}" --name test-wasm-integ`, {
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

  it('should search indexed code', () => {
    const out = execSync(`node "${STORE}" search-code --query main --repo test-wasm-integ`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    const result = JSON.parse(out);
    assert.ok(result.results.length >= 1, 'Expected at least 1 search result');
    assert.equal(result.results[0].symbol, 'main');
  });

  it('should get code source', () => {
    const out = execSync(`node "${STORE}" get-code-source --repo test-wasm-integ --file /tmp/test-wasm-integ/app.js --name main`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    const result = JSON.parse(out);
    assert.ok(result.success, 'get-code-source should succeed');
    assert.equal(result.symbol, 'main');
    assert.ok(result.source.includes('main'), 'Source should contain function name');
  });

  it('should list code repos', () => {
    const out = execSync(`node "${STORE}" list-code-repos`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    const result = JSON.parse(out);
    assert.ok(result.total >= 1, 'Should have at least 1 repo');
  });

  it('should not reference Python in any error messages', () => {
    const out = execSync(`node "${STORE}" index-repo --path /nonexistent/path/abc123 --name nope`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    // Should not mention Python in error messages
    assert.ok(!out.includes('Python'), `Found Python reference: ${out}`);
    assert.ok(!out.includes('pip'), `Found pip reference: ${out}`);
    assert.ok(!out.includes('venv'), `Found venv reference: ${out}`);
  });
});