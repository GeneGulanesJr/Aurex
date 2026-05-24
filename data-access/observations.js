const { RESULT_LIMITS: _RESULT_LIMITS } = require('../constants');
const { getConfig: _getConfig } = require('../config');

function insertObservation(deps, { sessionId, type, title, content, project, scope, topicKey }) {
  const { sqlJson } = deps;
  return sqlJson(
    `INSERT INTO observations (session_id, type, title, content, project, scope, topic_key)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, created_at`,
    [String(sessionId), type, title, content, project, scope, topicKey],
  );
}

function insertObservationRelation(deps, { sourceId, targetId, relation, confidence }) {
  const { sqlRun } = deps;
  sqlRun(
    'INSERT OR IGNORE INTO observation_relations (source_id, target_id, relation, confidence) VALUES (?, ?, ?, ?)',
    [sourceId, targetId, relation, confidence],
  );
}

function softDeleteObservation(deps, id) {
  const { sqlRun } = deps;
  sqlRun("UPDATE observations SET deleted_at = datetime('now') WHERE id = ?", [parseInt(id, 10)]);
  try {
    sqlRun(
      "INSERT INTO observations_fts(observations_fts, rowid, title, content, type, project, topic_key) VALUES ('delete', ?, '', '', '', '', '')",
      [parseInt(id, 10)],
    );
  } catch {}
}

function hardDeleteObservation(deps, id) {
  const { sqlRun } = deps;
  sqlRun('DELETE FROM observations WHERE id = ?', [parseInt(id, 10)]);
}

function getObservation(deps, id) {
  const { sqlJson } = deps;
  return sqlJson(
    `SELECT id, title, content, type, project, scope, topic_key, created_at, updated_at, deleted_at
     FROM observations WHERE id = ?`,
    [parseInt(id, 10)],
  );
}

function getSymbolLinksForMemory(deps, memoryId) {
  const { sqlJson } = deps;
  return sqlJson('SELECT symbol_id, repo, trust_score FROM symbol_links WHERE memory_id = ?', [String(memoryId)]);
}

function getRecallCountForMemory(deps, memoryId) {
  const { sqlJson } = deps;
  return sqlJson('SELECT COUNT(*) as cnt FROM recall_log WHERE memory_id = ?', [parseInt(memoryId, 10)]);
}

function updateObservation(deps, { id, title, content, type, project, scope, topicKey }) {
  const { sqlJson, sqlRun } = deps;
  const sets = [];
  const params = [];
  if (title) {
    sets.push('title = ?');
    params.push(title);
  }
  if (content) {
    sets.push('content = ?');
    params.push(content);
  }
  if (type) {
    sets.push('type = ?');
    params.push(type);
  }
  if (project) {
    sets.push('project = ?');
    params.push(project);
  }
  if (scope) {
    sets.push('scope = ?');
    params.push(scope);
  }
  if (topicKey) {
    sets.push('topic_key = ?');
    params.push(topicKey);
  }
  if (sets.length === 0) {
    return null;
  }
  params.push(parseInt(id, 10));
  sqlRun(`UPDATE observations SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, params);
  return sqlJson(
    `SELECT id, title, content, type, project, scope, topic_key, created_at, updated_at
     FROM observations WHERE id = ?`,
    [parseInt(id, 10)],
  );
}

function getTimeline(deps, { id, before, after }) {
  const { sqlJson } = deps;
  return sqlJson(
    `SELECT id, title, type, project, scope, created_at
     FROM observations WHERE id BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY id`,
    [id - before, id + after],
  );
}

function insertUserPrompt(deps, { sessionId, content, project }) {
  const { sqlJson } = deps;
  return sqlJson(`INSERT INTO user_prompts (session_id, content, project) VALUES (?, ?, ?) RETURNING id, created_at`, [
    String(sessionId),
    content,
    project,
  ]);
}

function insertCapturePassiveObservation(deps, { sessionId, summary, content }) {
  const { sqlJson } = deps;
  return sqlJson('INSERT INTO observations (session_id, type, title, content, scope) VALUES (?, ?, ?, ?, ?)', [
    String(sessionId),
    'learning',
    summary,
    content,
    'project',
  ]);
}

function getObservationStats(deps) {
  const { sqlJson } = deps;
  const obs = sqlJson('SELECT COUNT(*) as cnt FROM observations WHERE deleted_at IS NULL')[0].cnt;
  const prompts = sqlJson('SELECT COUNT(*) as cnt FROM user_prompts')[0].cnt;
  const sessions = sqlJson('SELECT COUNT(*) as cnt FROM session_log')[0].cnt;
  const links = sqlJson('SELECT COUNT(*) as cnt FROM symbol_links')[0].cnt;
  const workflows = sqlJson('SELECT COUNT(*) as cnt FROM procedural_memory')[0].cnt;
  return {
    total_observations: obs,
    total_prompts: prompts,
    total_sessions: sessions,
    total_symbol_links: links,
    total_workflows: workflows,
  };
}

function countObservationsByProjectAndType(deps, project) {
  const { sqlJson } = deps;
  if (project) {
    return sqlJson('SELECT COUNT(*) as cnt FROM observations WHERE project = ? AND deleted_at IS NULL AND type != ?', [
      project,
      'skill',
    ])[0].cnt;
  }
  return sqlJson('SELECT COUNT(*) as cnt FROM observations WHERE deleted_at IS NULL AND type != ?', ['skill'])[0].cnt;
}

function insertRecallLog(deps, entries) {
  const { sqlRun } = deps;
  const placeholders = entries.map(() => '(?, ?, ?)').join(',');
  const params = entries.flatMap((r) => [r.memoryId, r.sessionId, r.query]);
  sqlRun(`INSERT OR IGNORE INTO recall_log (memory_id, session_id, query) VALUES ${placeholders}`, params);
}

module.exports = {
  insertObservation,
  insertObservationRelation,
  softDeleteObservation,
  hardDeleteObservation,
  getObservation,
  getSymbolLinksForMemory,
  getRecallCountForMemory,
  updateObservation,
  getTimeline,
  insertUserPrompt,
  insertCapturePassiveObservation,
  getObservationStats,
  countObservationsByProjectAndType,
  insertRecallLog,
};
