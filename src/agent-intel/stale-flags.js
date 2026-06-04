// Module boundary:
// Scans source code for stale feature flags (one-sided branches).
// A one-sided branch is an if/ternary where one side is always executed.

const fs = require('fs');
const path = require('path');

// Patterns that indicate stale flags:
// 1. if (true) / if (false)
// 2. if (process.env.NODE_ENV === 'development') inside non-dev code
// 3. Feature flags checked but never toggled
// 4. Constant conditions in if statements

const STALE_FLAG_PATTERNS = [
  /\bif\s*\(\s*true\s*\)/gi,
  /\bif\s*\(\s*false\s*\)/gi,
  /\bif\s*\(\s*![^()]+\s*\)\s*\{[^}]*\}\s*else\s*\{/g,  // if (!x) { } else { always runs }
  /FEATURE_[A-Z_]+\s*===\s*['"](?:enabled?|on|true)['"]/gi,
  /FEATURE_[A-Z_]+\s*!==\s*['"](?:disabled?|off|false)['"]/gi,
];

const ALWAYS_TRUE_CONTEXT = [
  'process.env.NODE_ENV',
  'process.env.DEBUG',
  'process.env.TESTING',
];

function scanFileForStaleFlags(filePath) {
  if (!fs.existsSync(filePath)) return [];
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const findings = [];

  // Pattern-based detection
  for (const pattern of STALE_FLAG_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const line = lines[lineNum - 1]?.trim() || '';
      
      findings.push({
        filePath,
        lineNumber: lineNum,
        type: 'constant_condition',
        context: line.substring(0, 100),
      });
    }
  }

  // Check for one-sided ternaries: condition ? expr : expr (where expr is same)
  const ternaryRegex = /(\w+)\s*\?\s*(\w+)\s*:\s*\w+/g;
  let match;
  while ((match = ternaryRegex.exec(content)) !== null) {
    const [, condition, truthyResult] = match;
    // Check if the condition looks like a flag constant
    if (ALWAYS_TRUE_CONTEXT.some(c => condition.includes(c))) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const line = lines[lineNum - 1]?.trim() || '';
      
      findings.push({
        filePath,
        lineNumber: lineNum,
        type: 'likely_stale_flag',
        context: line.substring(0, 100),
      });
    }
  }

  return findings;
}

function detectStaleFlagsInRepo(db, repoId, repoPath) {
  // Get all JS/TS files
  const files = db.prepare(`
    SELECT path FROM code_files
    WHERE repo_id = ? AND (path LIKE '%.js' OR path LIKE '%.ts')
  `).all(repoId);

  const allFindings = [];
  
  for (const { path: filePath } of files) {
    // Resolve relative to repo path
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath);
    const findings = scanFileForStaleFlags(fullPath);
    
    for (const f of findings) {
      allFindings.push({
        repo_id: repoId,
        file_path: f.filePath,
        line_number: f.lineNumber,
        flag_name: f.context.match(/FEATURE_\w+/)?.[0] || extractCondition(f.context),
        branch_type: f.type === 'constant_condition' && f.context.includes('false') ? 'always-false' : 'always-true',
        context: f.context,
      });
    }
  }

  return allFindings;
}

function extractCondition(context) {
  const match = context.match(/if\s*\(\s*([^)]+)\s*\)/);
  return match ? match[1].trim() : context.substring(0, 50);
}

function persistStaleFlags(db, findings) {
  if (findings.length === 0) return { inserted: 0 };

  // Check if table exists before inserting
  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stale_flags'").get();
    if (!tableCheck) return { inserted: 0 };
  } catch {
    return { inserted: 0 };
  }

  const insert = db.prepare(`
    INSERT INTO stale_flags (repo_id, file_path, line_number, flag_name, branch_type, context)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((items) => {
    let count = 0;
    for (const f of items) {
      try {
        insert.run(f.repo_id, f.file_path, f.line_number, f.flag_name, f.branch_type, f.context);
        count++;
      } catch {
        // Skip duplicates
      }
    }
    return count;
  });

  return { inserted: tx(findings) };
}

function getStaleFlags(db, repoId) {
  try {
    return db.prepare(`
      SELECT * FROM stale_flags WHERE repo_id = ? ORDER BY file_path, line_number
    `).all(repoId);
  } catch {
    return [];
  }
}

module.exports = {
  scanFileForStaleFlags,
  detectStaleFlagsInRepo,
  persistStaleFlags,
  getStaleFlags,
  STALE_FLAG_PATTERNS,
};
