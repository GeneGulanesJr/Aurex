import { describe, it, expect } from 'vitest';

let parseCode;
async function getParser() {
  if (!parseCode) {
    parseCode = require('../parse-code');
    if (!parseCode.isReady()) {
      await parseCode.init();
    }
  }
  return parseCode;
}

describe('Dynamic callee extraction (via extractCalleesFromContent)', () => {
  it('captures dynamic import() paths', async () => {
    const parser = await getParser();
    const code = `const mod = import('./module.js');`;
    const result = parser.extractCalleesFromContent('test.js', code);
    const dynamicImports = result.filter((c) => c.callee === 'import' && c.module_path);
    expect(dynamicImports.length).toBeGreaterThanOrEqual(1);
    expect(dynamicImports[0].module_path).toBe('./module.js');
  });

  it('captures require() module paths', async () => {
    const parser = await getParser();
    const code = `const fs = require('fs');`;
    const result = parser.extractCalleesFromContent('test.js', code);
    const requires = result.filter((c) => c.callee === 'require' && c.module_path);
    expect(requires.length).toBeGreaterThanOrEqual(1);
    expect(requires[0].module_path).toBe('fs');
  });

  it('marks eval() calls as dynamic', async () => {
    const parser = await getParser();
    const code = `eval(userInput);`;
    const result = parser.extractCalleesFromContent('test.js', code);
    const evals = result.filter((c) => c.callee === 'eval');
    expect(evals.length).toBeGreaterThanOrEqual(1);
  });

  it('captures tagged template literals', async () => {
    const parser = await getParser();
    const code = `const btn = styled.button\`color: red;\`;
console.log(btn);`;
    const result = parser.extractCalleesFromContent('test.js', code);
    // Tree-sitter parses tagged templates as call_expression with template_string args
    const tagged = result.filter((c) => c.full_path === 'styled.button' || c.callee === 'styled.button');
    expect(tagged.length).toBeGreaterThanOrEqual(1);
  });
});
