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
  const skipReport = { builtIn: {}, gitignore: {}, memorycodeignore: {}, unsupportedExt: 0 };
  const ignoreFiles = options.onProgress || null;
  const reportScanProgress = options.onScanProgress || null;
  const scanStats = { dirsVisited: 0, entriesSeen: 0, codeFiles: 0 };

  function maybeReportScanProgress() {
    if (!reportScanProgress) {
      return;
    }
    if (
      scanStats.entriesSeen <= 10 ||
      scanStats.entriesSeen % 500 === 0 ||
      (scanStats.codeFiles > 0 && scanStats.codeFiles % 100 === 0)
    ) {
      reportScanProgress({ ...scanStats });
    }
  }

  function walk(dir) {
    scanStats.dirsVisited++;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      scanStats.entriesSeen++;
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(repoPath, fullPath);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name, extraIgnoreDirs)) {
          skipReport.builtIn[entry.name] = (skipReport.builtIn[entry.name] || 0) + 1;
          if (ignoreFiles) {
            ignoreFiles(relativePath, 'built-in');
          }
        } else if (gitignoreIg && gitignoreIg.ignores(relativePath)) {
          skipReport.gitignore[entry.name] = (skipReport.gitignore[entry.name] || 0) + 1;
          if (ignoreFiles) {
            ignoreFiles(relativePath, '.gitignore');
          }
        } else if (memorycodeignoreIg && memorycodeignoreIg.ignores(relativePath)) {
          skipReport.memorycodeignore[entry.name] = (skipReport.memorycodeignore[entry.name] || 0) + 1;
          if (ignoreFiles) {
            ignoreFiles(relativePath, '.memorycodeignore');
          }
        } else {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        if (!isCodeFile(fullPath)) {
          skipReport.unsupportedExt++;
          maybeReportScanProgress();
        } else {
          const shouldSkip =
            (gitignoreIg && gitignoreIg.ignores(relativePath)) ||
            (memorycodeignoreIg && memorycodeignoreIg.ignores(relativePath));
          if (!shouldSkip) {
            results.push(fullPath);
            scanStats.codeFiles++;
            maybeReportScanProgress();
          }
        }
      }
    }
  }

  walk(repoPath);
  if (reportScanProgress) {
    reportScanProgress({ ...scanStats, done: true });
  }
  return { files: results, skipReport };
}

module.exports = { isCodeFile, scanRepository, shouldSkipDir, loadGitignoreRules };
