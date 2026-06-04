// Module boundary:
// Ingests Istanbul/NYC coverage JSON and stores runtime hotness per symbol.
// Must not mutate code indexes or memory.

const path = require('path');
const fs = require('fs');

/**
 * Istanbul coverage JSON shape:
 * {
 *   "/path/to/file.js": {
 *     "path": "/path/to/file.js",
 *     "statementMap": { "0": { "start": {...}, "end": {...} } },
 *     "fnMap": { "0": { "name": "fnName", "line": 5, "loc": {...} } },
 *     "s": { "0": 10, "1": 5 },  // statement hits
 *     "f": { "0": 3 }            // function hits
 *   }
 * }
 */

const TRAFFIC_THRESHOLDS = {
  hot: 1000,    // >= 1000 hits in coverage period
  warm: 100,    // >= 100 hits
  cold: 0,      // < 100 hits
};

function classifyTraffic(hitCount) {
  if (hitCount >= TRAFFIC_THRESHOLDS.hot) return 'hot';
  if (hitCount >= TRAFFIC_THRESHOLDS.warm) return 'warm';
  return 'cold';
}

function parseCoverageFile(coveragePath) {
  const raw = fs.readFileSync(coveragePath, 'utf-8');
  return JSON.parse(raw);
}

function extractFunctionHits(coverageData) {
  const results = [];
  for (const [filePath, data] of Object.entries(coverageData)) {
    if (!data || !data.fnMap || !data.f) continue;
    
    const fnMap = data.fnMap;
    const hitCounts = data.f;
    
    for (const [idx, fn] of Object.entries(fnMap)) {
      const hitCount = hitCounts[idx] || 0;
      results.push({
        filePath,
        functionName: fn.name || `anonymous_${idx}`,
        lineStart: fn.line,
        hitCount,
        traffic: classifyTraffic(hitCount),
      });
    }
  }
  return results;
}

function ingestCoverage(db, repoId, coveragePath, sourceFile = '') {
  if (!fs.existsSync(coveragePath)) {
    return { error: `Coverage file not found: ${coveragePath}` };
  }

  const coverageData = parseCoverageFile(coveragePath);
  const functions = extractFunctionHits(coverageData);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO runtime_symbols 
      (repo_id, file_path, function_name, line_start, hit_count, traffic, last_seen, source_file)
    VALUES 
      (?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `);

  const upsert = db.transaction((fnList) => {
    let inserted = 0;
    for (const fn of fnList) {
      insertStmt.run(repoId, fn.filePath, fn.functionName, fn.lineStart, fn.hitCount, fn.traffic, sourceFile);
      inserted++;
    }
    return inserted;
  });

  const inserted = upsert(functions);

  return {
    functions_ingested: inserted,
    traffic_breakdown: {
      hot: functions.filter(f => f.traffic === 'hot').length,
      warm: functions.filter(f => f.traffic === 'warm').length,
      cold: functions.filter(f => f.traffic === 'cold').length,
    },
    source_file: coveragePath,
  };
}

function getHotSymbols(db, repoId, limit = 20) {
  const rows = db.prepare(`
    SELECT rs.*, cs.qualified_name, cs.kind
    FROM runtime_symbols rs
    LEFT JOIN code_symbols cs ON cs.id = rs.symbol_id
    WHERE rs.repo_id = ? AND rs.traffic IN ('hot', 'warm')
    ORDER BY rs.hit_count DESC
    LIMIT ?
  `).all(repoId, limit);

  return rows;
}

function getColdSymbols(db, repoId, limit = 20) {
  const rows = db.prepare(`
    SELECT rs.*, cs.qualified_name, cs.kind
    FROM runtime_symbols rs
    LEFT JOIN code_symbols cs ON cs.id = rs.symbol_id
    WHERE rs.repo_id = ? AND rs.traffic = 'cold'
    ORDER BY rs.hit_count ASC
    LIMIT ?
  `).all(repoId, limit);

  return rows;
}

module.exports = {
  ingestCoverage,
  getHotSymbols,
  getColdSymbols,
  classifyTraffic,
  TRAFFIC_THRESHOLDS,
};
