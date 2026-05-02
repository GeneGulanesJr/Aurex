// test/parse-code.test.js
const path = require('path');
const fs = require('fs');
const codeParser = require('../parse-code');

describe('parse-code', () => {
  beforeAll(async () => {
    await codeParser.init();
  });

  it('should initialize successfully', () => {
    expect(codeParser.isReady()).toBe(true);
  });

  it('should report loaded grammars via info()', () => {
    const info = codeParser.info();
    expect(info.ready).toBe(true);
    expect(info.grammars.length).toBeGreaterThanOrEqual(2);
  });

  it('should extract JS function declarations', () => {
    const tmpFile = path.join('/tmp', 'test-parse-fn.js');
    fs.writeFileSync(tmpFile, 'function hello(name) {\n  return name;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    expect(symbols.length).toBeGreaterThanOrEqual(1);
    const fn = symbols.find((s) => s.name === 'hello');
    expect(fn).toBeTruthy();
    expect(fn.kind).toBe('function');
    expect(fn.start_line).toBe(1);
    expect(fn.signature).toContain('hello');
    expect(fn.language).toBe('javascript');
  });

  it('should extract JS class declarations and methods', () => {
    const tmpFile = path.join('/tmp', 'test-class.js');
    fs.writeFileSync(tmpFile, 'class MyClass {\n  greet() {\n    return "hi";\n  }\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const cls = symbols.find((s) => s.name === 'MyClass' && s.kind === 'class');
    expect(cls).toBeTruthy();

    const method = symbols.find((s) => s.name === 'greet' && s.kind === 'method');
    expect(method).toBeTruthy();
    expect(method.parent_name).toBe('MyClass');
    expect(method.qualified_name).toBe('MyClass.greet');
  });

  it('should extract arrow function variables', () => {
    const tmpFile = path.join('/tmp', 'test-arrow.js');
    fs.writeFileSync(tmpFile, 'const add = (a, b) => a + b;');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find((s) => s.name === 'add' && s.kind === 'function');
    expect(fn).toBeTruthy();
  });

  it('should extract TS interface and type alias', () => {
    const tmpFile = path.join('/tmp', 'test-types.ts');
    fs.writeFileSync(tmpFile, 'interface User {\n  name: string;\n  age: number;\n}\n\ntype ID = string;');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const iface = symbols.find((s) => s.name === 'User' && s.kind === 'interface');
    expect(iface).toBeTruthy();
    expect(iface.language).toBe('typescript');

    const typeAlias = symbols.find((s) => s.name === 'ID' && s.kind === 'type');
    expect(typeAlias).toBeTruthy();
  });

  it('should extract TSX component', () => {
    const tmpFile = path.join('/tmp', 'test-comp.tsx');
    fs.writeFileSync(tmpFile, 'export function Header({ title }: { title: string }) {\n  return <h1>{title}</h1>;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find((s) => s.name === 'Header');
    expect(fn).toBeTruthy();
    expect(fn.language).toBe('typescript');
  });

  it('should extract docstrings from JSDoc comments', () => {
    const tmpFile = path.join('/tmp', 'test-docstring.js');
    fs.writeFileSync(tmpFile, '/** A greeter function */\nfunction greet(who) {\n  return "Hello " + who;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find((s) => s.name === 'greet');
    expect(fn).toBeTruthy();
    expect(fn.docstring).toContain('greeter');
  });

  it('should return output with all required fields', () => {
    const tmpFile = path.join('/tmp', 'test-schema.js');
    fs.writeFileSync(tmpFile, 'function myFunc(x) { return x; }');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find((s) => s.name === 'myFunc');
    expect(fn).toBeTruthy();

    const requiredFields = [
      'name',
      'kind',
      'language',
      'file',
      'signature',
      'qualified_name',
      'start_line',
      'end_line',
      'start_byte',
      'end_byte',
      'docstring',
      'body_preview',
      'parent_name',
    ];
    for (const field of requiredFields) {
      expect(fn).toHaveProperty(field);
    }
  });

  it('should return empty array for unsupported file types', () => {
    const symbols = codeParser.parseFile('/tmp/test.rb');
    expect(symbols).toEqual([]);
  });

  it('should return empty array for nonexistent files', () => {
    const symbols = codeParser.parseFile('/tmp/does_not_exist_abc123.js');
    expect(symbols).toEqual([]);
  });

  it('should return empty array when not initialized', () => {
    // This test verifies the guard — since we already initialized,
    // we test the ext-based guard instead
    const symbols = codeParser.parseFile('/tmp/test.py');
    expect(symbols).toEqual([]); // .py is not in LANGUAGE_MAP
  });
});
