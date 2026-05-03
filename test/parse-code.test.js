// test/parse-code.test.js
const path = require('path');
const fs = require('fs');
const codeParser = require('../parse-code');

describe.concurrent('parse-code', () => {
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
    const fn = symbols.find(s => s.name === 'hello');
    expect(fn).toBeDefined();
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

    const cls = symbols.find(s => s.name === 'MyClass' && s.kind === 'class');
    expect(cls).toBeDefined();

    const method = symbols.find(s => s.name === 'greet' && s.kind === 'method');
    expect(method).toBeDefined();
    expect(method.parent_name).toBe('MyClass');
    expect(method.qualified_name).toBe('MyClass.greet');
  });

  it('should extract arrow function variables', () => {
    const tmpFile = path.join('/tmp', 'test-arrow.js');
    fs.writeFileSync(tmpFile, 'const add = (a, b) => a + b;');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'add' && s.kind === 'function');
    expect(fn).toBeDefined();
  });

  it('should extract TS interface and type alias', () => {
    const tmpFile = path.join('/tmp', 'test-types.ts');
    fs.writeFileSync(tmpFile, 'interface User {\n  name: string;\n  age: number;\n}\n\ntype ID = string;');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const iface = symbols.find(s => s.name === 'User' && s.kind === 'interface');
    expect(iface).toBeDefined();
    expect(iface.language).toBe('typescript');

    const typeAlias = symbols.find(s => s.name === 'ID' && s.kind === 'type');
    expect(typeAlias).toBeDefined();
  });

  it('should extract TSX component', () => {
    const tmpFile = path.join('/tmp', 'test-comp.tsx');
    fs.writeFileSync(tmpFile, 'export function Header({ title }: { title: string }) {\n  return <h1>{title}</h1>;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'Header');
    expect(fn).toBeDefined();
    expect(fn.language).toBe('typescript');
  });

  it('should extract docstrings from JSDoc comments', () => {
    const tmpFile = path.join('/tmp', 'test-docstring.js');
    fs.writeFileSync(tmpFile, '/** A greeter function */\nfunction greet(who) {\n  return "Hello " + who;\n}');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'greet');
    expect(fn).toBeDefined();
    expect(fn.docstring).toContain('greeter');
  });

  it('should return output with all required fields', () => {
    const tmpFile = path.join('/tmp', 'test-schema.js');
    fs.writeFileSync(tmpFile, 'function myFunc(x) { return x; }');
    const symbols = codeParser.parseFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const fn = symbols.find(s => s.name === 'myFunc');
    expect(fn).toBeDefined();

    const requiredFields = ['name', 'kind', 'language', 'file', 'signature', 'qualified_name',
                            'start_line', 'end_line', 'start_byte', 'end_byte',
                            'docstring', 'body_preview', 'parent_name'];
    for (const field of requiredFields) {
      expect(field in fn).toBe(true);
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
    const symbols = codeParser.parseFile('/tmp/test.py');
    expect(symbols).toEqual([]);
  });

  // ── New tests: Multi-language support ──

  it('should parse Python files (.py) and extract functions', () => {
    const tmpFile = path.join('/tmp', 'test_py.py');
    fs.writeFileSync(tmpFile, 'def greet(name):\n    """Say hello."""\n    return f"Hello {name}"\n\nclass Animal:\n    def speak(self):\n        return "roar"');
    try {
      const symbols = codeParser.parseFile(tmpFile);
      expect(symbols.length).toBeGreaterThanOrEqual(2);
      const greet = symbols.find(s => s.name === 'greet' && s.kind === 'function');
      expect(greet).toBeDefined();
      expect(greet.language).toBe('python');
      if (greet.docstring) expect(greet.docstring).toContain('Say hello');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should parse Go files (.go) and extract functions', () => {
    const tmpFile = path.join('/tmp', 'test_go.go');
    fs.writeFileSync(tmpFile, 'package main\n\n// Greet says hello\nfunc Greet(name string) string {\n\treturn "Hello " + name\n}\n\nfunc add(a, b int) int {\n\treturn a + b\n}');
    try {
      const symbols = codeParser.parseFile(tmpFile);
      expect(symbols.length).toBeGreaterThanOrEqual(2);
      const greet = symbols.find(s => s.name === 'Greet' && s.kind === 'function');
      expect(greet).toBeDefined();
      expect(greet.language).toBe('go');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should parse Rust files (.rs) and extract functions', () => {
    const tmpFile = path.join('/tmp', 'test_rs.rs');
    fs.writeFileSync(tmpFile, '/// Adds two numbers\nfn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\npub fn greet(name: &str) -> String {\n    format!("Hello, {}", name)\n}');
    try {
      const symbols = codeParser.parseFile(tmpFile);
      expect(symbols.length).toBeGreaterThanOrEqual(2);
      const add = symbols.find(s => s.name === 'add' && s.kind === 'function');
      expect(add).toBeDefined();
      expect(add.language).toBe('rust');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  // ── New tests: AST callee extraction (v5.3) ──

  it('should extract callees from call expressions via AST', () => {
    const tmpFile = path.join('/tmp', 'test-callees.js');
    fs.writeFileSync(tmpFile, 'function foo() {\n  bar();\n  baz(x, y);\n  obj.method();\n  new ClassName();\n}');
    try {
      const callees = codeParser.extractCallees(tmpFile);
      const names = callees.map(c => c.callee);
      expect(names).toContain('bar');
      expect(names).toContain('baz');
      expect(names).toContain('method');
      expect(names).toContain('ClassName');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should not extract keyword-like callees', () => {
    const tmpFile = path.join('/tmp', 'test-kw-callees.js');
    fs.writeFileSync(tmpFile, 'function foo() {\n  if (x) return;\n  for (let i = 0; i < 10; i++) {}\n  while (true) {}\n  switch (v) { case 1: break; }\n  try {} catch (e) {}\n)');
    try {
      const callees = codeParser.extractCallees(tmpFile);
      const names = callees.map(c => c.callee);
      expect(names).not.toContain('if');
      expect(names).not.toContain('for');
      expect(names).not.toContain('while');
      expect(names).not.toContain('switch');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should deduplicate callee names by line', () => {
    const tmpFile = path.join('/tmp', 'test-dup-callees.js');
    fs.writeFileSync(tmpFile, 'function foo() {\n  bar();\n}');
    try {
      const callees = codeParser.extractCallees(tmpFile);
      const bars = callees.filter(c => c.callee === 'bar');
      // Only one call to bar() on one line
      expect(bars.length).toBe(1);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
