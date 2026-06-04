'use strict';

const { DUPLICATE_DETECTION: CFG } = require('../../constants');
const { fingerprintSymbol, jaccardSimilarity } = require('../code-analysis/fingerprint');

function _requireNativeDb(db) {
  if (!db || !db.prepare) return { error: 'Native database connection required' };
  return null;
}

/**
 * Find duplicate code in a repo.
 * Fingerprints all symbols, clusters by Jaccard similarity.
 */
function findDupes(db, repoId, opts = {}) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;

  const {
    threshold = CFG.SIMILARITY_THRESHOLD,
    topK = CFG.TOP_K_GROUPS,
    minBodyLength = CFG.MIN_BODY_LENGTH,
  } = opts;

  const startTime = Date.now();

  const symbols = db
    .prepare(
      `SELECT id, name, kind, file_path, start_line, body_preview
       FROM code_symbols
       WHERE repo_id = ? AND body_preview IS NOT NULL AND length(body_preview) >= ?`,
    )
    .all(repoId, minBodyLength);

  if (symbols.length === 0) {
    return { duplicate_groups: [], total_symbols_scanned: 0, groups_found: 0, scan_duration_ms: 0 };
  }

  // Fingerprint all symbols
  const fingerprints = [];
  for (const sym of symbols) {
    const fp = fingerprintSymbol(sym);
    if (fp) {
      fingerprints.push({ ...fp, symbolId: sym.id });
    }
  }

  // Compare all pairs, cluster by similarity
  const groups = [];
  const assigned = new Set();

  for (let i = 0; i < fingerprints.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [i];

    for (let j = i + 1; j < fingerprints.length; j++) {
      if (assigned.has(j)) continue;
      const sim = jaccardSimilarity(fingerprints[i].signature, fingerprints[j].signature);
      if (sim >= threshold) {
        cluster.push(j);
      }
    }

    if (cluster.length >= 2) {
      for (const idx of cluster) assigned.add(idx);
      groups.push(cluster);
    }
  }

  // Build output
  const duplicateGroups = groups.slice(0, topK).map((cluster) => {
    const instances = cluster.map((idx) => ({
      symbol_id: fingerprints[idx].symbolId,
      symbol_name: fingerprints[idx].symbolName,
      file_path: fingerprints[idx].filePath,
      line_start: fingerprints[idx].startLine,
    }));

    let maxSim = 0;
    for (let a = 0; a < cluster.length; a++) {
      for (let b = a + 1; b < cluster.length; b++) {
        const sim = jaccardSimilarity(fingerprints[cluster[a]].signature, fingerprints[cluster[b]].signature);
        if (sim > maxSim) maxSim = sim;
      }
    }

    const risk = maxSim > 0.85 ? 'high' : maxSim > 0.7 ? 'medium' : 'low';
    const primaryName = instances[0].symbol_name;
    const recommendation = `Consider merging ${instances.map((i) => i.symbol_name).join(' and ')} into a single implementation.`;

    return {
      intent: `Similar behavior to ${primaryName}`,
      risk,
      detection_type: 'structural',
      recommendation,
      similarity: Math.round(maxSim * 100) / 100,
      instances,
    };
  });

  // Persist to duplicate_groups / duplicate_instances
  _persistGroups(db, repoId, duplicateGroups);

  return {
    duplicate_groups: duplicateGroups,
    total_symbols_scanned: symbols.length,
    groups_found: duplicateGroups.length,
    scan_duration_ms: Date.now() - startTime,
  };
}

function _persistGroups(db, repoId, groups) {
  db.prepare(
    `DELETE FROM duplicate_instances WHERE group_id IN (SELECT id FROM duplicate_groups WHERE repo_id = ?)`,
  ).run(repoId);
  db.prepare(`DELETE FROM duplicate_groups WHERE repo_id = ?`).run(repoId);

  const insertGroup = db.prepare(
    `INSERT INTO duplicate_groups (repo_id, intent, risk, detection_type, recommendation) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertInstance = db.prepare(
    `INSERT INTO duplicate_instances (group_id, symbol_id, file_path, symbol_name, line_start) VALUES (?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    for (const group of groups) {
      const result = insertGroup.run(
        repoId,
        group.intent,
        group.risk,
        group.detection_type,
        group.recommendation,
      );
      const groupId = result.lastInsertRowid;
      for (const inst of group.instances) {
        insertInstance.run(groupId, inst.symbol_id, inst.file_path, inst.symbol_name, inst.line_start);
      }
    }
  });
  tx();
}

/**
 * Load persisted duplicate groups for a repo (no re-scan).
 */
function loadDupes(db, repoId) {
  const groups = db.prepare(`SELECT * FROM duplicate_groups WHERE repo_id = ? ORDER BY created_at DESC`).all(repoId);

  const instances = db
    .prepare(
      `SELECT * FROM duplicate_instances WHERE group_id IN (SELECT id FROM duplicate_groups WHERE repo_id = ?)`,
    )
    .all(repoId);

  const byGroup = new Map();
  for (const inst of instances) {
    if (!byGroup.has(inst.group_id)) byGroup.set(inst.group_id, []);
    byGroup.get(inst.group_id).push(inst);
  }

  return groups.map((g) => ({
    ...g,
    instances: byGroup.get(g.id) || [],
  }));
}

module.exports = { findDupes, loadDupes };
