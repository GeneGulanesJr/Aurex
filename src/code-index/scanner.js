const path = require('path');
const fs = require('fs');
const { CODE_EXTENSIONS, IGNORE_DIRS_CODE } = require('../../utils');

function shouldSkipDir(dirName, extraIgnoreDirs = []) {
  return dirName.startsWith('.') || IGNORE_DIRS_CODE.has(dirName) || extraIgnoreDirs.includes(dirName);
}

function isCodeFile(filePath) {
  return CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function loadIgnoreRules(repoPath, filename) {
  let ig;
  try {
    ig = require('ignore')();
  } catch {
    return null;
  }

  let added = false;

  function tryLoad(dir) {
    const ignorePath = path.join(dir, filename);
    try {
      const content = fs.readFileSync(ignorePath, 'utf-8');
      ig.add(content);
      added = true;
    } catch {}
  }

  let current = path.resolve(repoPath);
  const rootsToTry = [];

  let limit = 20;
  while (limit-- > 0) {
    rootsToTry.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  for (let i = rootsToTry.length - 1; i >= 0; i--) {
    tryLoad(rootsToTry[i]);
  }

  return added ? ig : null;
}

function loadGitignoreRules(repoPath) {
  return loadIgnoreRules(repoPath, '.gitignore');
}

function loadMemorycodeignoreRules(repoPath) {
  return loadIgnoreRules(repoPath, '.memorycodeignore');
}

function scanRepository(repoPath, options = {}) {
  const results = [];
  const extraIgnoreDirs = options.ignoreDirs || [];
  const gitignoreIg = loadGitignoreRules(repoPath);
  const memorycodeignoreIg = loadMemorycodeignoreRules(repoPath);

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name, extraIgnoreDirs)) {
          // Skip
        } else if ((gitignoreIg && gitignoreIg.ignores(path.relative(repoPath, fullPath))) || 
                   (memorycodeignoreIg && memorycodeignoreIg.ignores(path.relative(repoPath, fullPath)))) {
          // Skip
        } else {
          walk(fullPath);
        }
      } else if (entry.isFile() && isCodeFile(fullPath)) {
        const relativePath = path.relative(repoPath, fullPath);
        const shouldSkip = (gitignoreIg && gitignoreIg.ignores(relativePath)) || 
                           (memorycodeignoreIg && memorycodeignoreIg.ignores(relativePath));
        if (!shouldSkip) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(repoPath);
  return results;
}

module.exports = { isCodeFile, scanRepository, shouldSkipDir, loadGitignoreRules };
