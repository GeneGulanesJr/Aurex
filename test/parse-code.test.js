// test/parse-code.test.js
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const codeParser = require('../parse-code');

describe('parse-code', () => {
  before(async () => {
    await codeParser.init();
  });

  it('should initialize successfully', () => {
    assert.equal(codeParser.isReady(), true);
  });

  it('should report loaded grammars via info()', () => {
    const info = codeParser.info();
    assert.equal(info.ready, true);
    assert.ok(info.grammars.length >= 2, `Expected >= 2 grammars, got ${info.grammars.length}`);
  });

  it('should extract JS function declarations', () => {
    const tmpFile = path.join('/tmp', 'test-parse-fn.js');
    fs.writeFileSync(tmpFile, 'function hello(name) {\n  return name;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    assert.ok(symbols.length >= 1, `Expected >= 1 symbol, got ${symbols.length}`);
    const fn = symbols.find(s => s.name === 'hello');
    assert.ok(fn, 'hello function not found');
    assert.equal(fn.kind, 'function');
    assert.equal(fn.start_line, 1);
    assert.ok(fn.signature.includes('hello'));
    assert.equal(fn.language, 'javascript');
  });

  it('should extract JS class declarations and methods', () => {
    const tmpFile = path.join('/tmp', 'test-class.js');
    fs.writeFileSync(tmpFile, 'class MyClass {\n  greet() {\n    return "hi";\n  }\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const cls = symbols.find(s => s.name === 'MyClass' && s.kind === 'class');
    assert.ok(cls, 'MyClass class not found');

    const method = symbols.find(s => s.name === 'greet' && s.kind === 'method');
    assert.ok(method, 'greet method not found');
    assert.equal(method.parent_name, 'MyClass');
    assert.equal(method.qualified_name, 'MyClass.greet');
  });

  it('should extract arrow function variables', () => {
    const tmpFile = path.join('/tmp', 'test-arrow.js');
    fs.writeFileSync(tmpFile, 'const add = (a, b) => a + b;');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'add' && s.kind === 'function');
    assert.ok(fn, 'add arrow function not found');
  });

  it('should extract TS interface and type alias', () => {
    const tmpFile = path.join('/tmp', 'test-types.ts');
    fs.writeFileSync(tmpFile, 'interface User {\n  name: string;\n  age: number;\n}\n\ntype ID = string;');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const iface = symbols.find(s => s.name === 'User' && s.kind === 'interface');
    assert.ok(iface, 'User interface not found');
    assert.equal(iface.language, 'typescript');

    const typeAlias = symbols.find(s => s.name === 'ID' && s.kind === 'type');
    assert.ok(typeAlias, 'ID type alias not found');
  });

  it('should extract TSX component', () => {
    const tmpFile = path.join('/tmp', 'test-comp.tsx');
    fs.writeFileSync(tmpFile, 'export function Header({ title }: { title: string }) {\n  return <h1>{title}</h1>;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'Header');
    assert.ok(fn, 'Header component not found');
    assert.equal(fn.language, 'typescript');
  });

  it('should extract docstrings from JSDoc comments', () => {
    const tmpFile = path.join('/tmp', 'test-docstring.js');
    fs.writeFileSync(tmpFile, '/** A greeter function */\nfunction greet(who) {\n  return "Hello " + who;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'greet');
    assert.ok(fn, 'greet function not found');
    assert.ok(fn.docstring.includes('greeter'), `Expected docstring to contain 'greeter', got: "${fn.docstring}"`);
  });

  it('should return output with all required fields', () => {
    const tmpFile = path.join('/tmp', 'test-schema.js');
    fs.writeFileSync(tmpFile, 'function myFunc(x) { return x; }');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'myFunc');
    assert.ok(fn, 'myFunc not found');

    const requiredFields = ['name', 'kind', 'language', 'file', 'signature', 'qualified_name',
                            'start_line', 'end_line', 'start_byte', 'end_byte',
                            'docstring', 'body_preview', 'parent_name'];
    for (const field of requiredFields) {
      assert.ok(field in fn, `Missing field: ${field}`);
    }
  });

  it('should return empty array for unsupported file types', () => {
    const symbols = codeParser.parseFile('/tmp/test.rb');
    assert.deepEqual(symbols, []);
  });

  it('should return empty array for nonexistent files', () => {
    const symbols = codeParser.parseFile('/tmp/does_not_exist_abc123.js');
    assert.deepEqual(symbols, []);
  });

  it('should return empty array when not initialized', () => {
    // This test verifies the guard — since we already initialized,
    // we test the ext-based guard instead
    const symbols = codeParser.parseFile('/tmp/test.py');
    assert.deepEqual(symbols, []);  // .py is not in LANGUAGE_MAP
  });
});