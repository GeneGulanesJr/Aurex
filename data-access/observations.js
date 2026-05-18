const { RESULT_LIMITS } = require('../constants');
const { getConfig } = require('../config');

async function insertObservation(deps, { sessionId, type, title, content, project, scope, topicKey }) {
  const { sqlJson } = deps;
  return sqlJson(
    `INSERT INTO observations (session_id, type, title, content, project, scope, topic_key)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, created_at`,
    [String(sessionId), type, title, content, project, scope, topicKey],
  );
}

async function insertObservationRelation(deps, { sourceId, targetId, relation, confidence }) {
  const { sqlRun } = deps;
  await sqlRun(
    'INSERT OR IGNORE INTO observation_relations (source_id, target_id, relation, confidence) VALUES (?, ?, ?, ?)',
    [sourceId, targetId, relation, confidence],
  );
}

async function softDeleteObservation(deps, id) {
  const { sqlRun } = deps;
  await sqlRun("UPDATE observations SET deleted_at = datetime('now') WHERE id = ?", [parseInt(id, 10)]);
  try {
    await sqlRun(
      "INSERT INTO observations_fts(observations_fts, rowid, title, content, type, project, topic_key) VALUES ('delete', ?, '', '', '', '', '')",
      [parseInt(id, 10)],
    );
  } catch (_) {}
}

async function hardDeleteObservation(deps, id) {
  const { sqlRun } = deps;
  await sqlRun('DELETE FROM observations WHERE id = ?', [parseInt(id, 10)]);
}

async function getObservation(deps, id) {
  const { sqlJson } = deps;
  return sqlJson(
    `SELECT id, title, content, type, project, scope, topic_key, created_at, updated_at, deleted_at
     FROM observations WHERE id = ?`,
    [parseInt(id, 10)],
  );
}

async function getSymbolLinksForMemory(deps, memoryId) {
  const { sqlJson } = deps;
  return sqlJson('SELECT symbol_id, repo, trust_score FROM symbol_links WHERE memory_id = ?', [String(memoryId)]);
}

async function getRecallCountForMemory(deps, memoryId) {
  const { sqlJson } = deps;
  return sqlJson('SELECT COUNT(*) as cnt FROM recall_log WHERE memory_id = ?', [parseInt(memoryId, 10)]);
}

async function updateObservation(deps, { id, title, content, type, project, scope, topicKey }) {
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
  await sqlRun(`UPDATE observations SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, params);
  return sqlJson(
    `SELECT id, title, content, type, project, scope, topic_key, created_at, updated_at
     FROM observations WHERE id = ?`,
    [parseInt(id, 10)],
  );
}

async function getTimeline(deps, { id, before, after }) {
  const { sqlJson } = deps;
  return sqlJson(
    `SELECT id, title, type, project, scope, created_at
     FROM observations WHERE id BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY id`,
    [id - before, id + after],
  );
}

async function insertUserPrompt(deps, { sessionId, content, project }) {
  const { sqlJson } = deps;
  return sqlJson(`INSERT INTO user_prompts (session_id, content, project) VALUES (?, ?, ?) RETURNING id, created_at`, [
    String(sessionId),
    content,
    project,
  ]);
}

async function insertCapturePassiveObservation(deps, { sessionId, summary, content }) {
  const { sqlJson } = deps;
  return sqlJson('INSERT INTO observations (session_id, type, title, content, scope) VALUES (?, ?, ?, ?, ?)', [
    String(sessionId),
    'learning',
    summary,
    content,
    'project',
  ]);
}

async function getObservationStats(deps) {
  const { sqlJson } = deps;
  const obs = (await sqlJson('SELECT COUNT(*) as cnt FROM observations WHERE deleted_at IS NULL'))[0].cnt;
  const prompts = (await sqlJson('SELECT COUNT(*) as cnt FROM user_prompts'))[0].cnt;
  const sessions = (await sqlJson('SELECT COUNT(*) as cnt FROM session_log'))[0].cnt;
  const links = (await sqlJson('SELECT COUNT(*) as cnt FROM symbol_links'))[0].cnt;
  const workflows = (await sqlJson('SELECT COUNT(*) as cnt FROM procedural_memory'))[0].cnt;
  return {
    total_observations: obs,
    total_prompts: prompts,
    total_sessions: sessions,
    total_symbol_links: links,
    total_workflows: workflows,
  };
}

async function countObservationsByProjectAndType(deps, project) {
  const { sqlJson } = deps;
  if (project) {
    return (
      await sqlJson('SELECT COUNT(*) as cnt FROM observations WHERE project = ? AND deleted_at IS NULL AND type != ?', [
        project,
        'skill',
      ])
    )[0].cnt;
  }
  return (
    await sqlJson('SELECT COUNT(*) as cnt FROM observations WHERE deleted_at IS NULL AND type != ?', ['skill'])
  )[0].cnt;
}

async function insertRecallLog(deps, entries) {
  const { sqlRun } = deps;
  const placeholders = entries.map(() => '(?, ?, ?)').join(',');
  const params = entries.flatMap((r) => [r.memoryId, r.sessionId, r.query]);
  await sqlRun(`INSERT OR IGNORE INTO recall_log (memory_id, session_id, query) VALUES ${placeholders}`, params);
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
