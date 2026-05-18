async function listWorkspaces(deps) {
  const { sqlJson } = deps;
  const workspaces = await sqlJson(`
    SELECT w.id, w.name, w.created_at, w.archived_at,
           COUNT(CASE WHEN o.deleted_at IS NULL AND o.type != 'skill' THEN 1 END) as memory_count,
           MAX(o.created_at) as last_active
    FROM workspaces w
    LEFT JOIN observations o ON o.project = w.name
    GROUP BY w.id
    ORDER BY w.archived_at NULLS FIRST, last_active DESC
  `);
  return { workspaces, total: workspaces.length };
}

async function createWorkspace(deps, name) {
  const { sqlJson, sqlRun } = deps;
  if (!name) {
    return { error: 'Missing --name' };
  }
  try {
    await sqlRun('INSERT INTO workspaces (name) VALUES (?)', [name]);
    const row = await sqlJson('SELECT id, name, created_at FROM workspaces WHERE name = ?', [name]);
    return { success: true, workspace: row[0] };
  } catch {
    return { error: `Workspace already exists: ${name}` };
  }
}

async function archiveWorkspace(deps, name) {
  const { sqlJson, sqlRun } = deps;
  if (!name) {
    return { error: 'Missing --name' };
  }
  const existing = await sqlJson('SELECT id FROM workspaces WHERE name = ? AND archived_at IS NULL', [name]);
  if (existing.length === 0) {
    return { error: `Workspace not found or already archived: ${name}` };
  }
  await sqlRun("UPDATE workspaces SET archived_at = datetime('now') WHERE id = ?", [existing[0].id]);
  return { success: true, workspace: name, archived: true };
}

async function listProjects(deps) {
  const { sqlJson } = deps;
  const rows = await sqlJson(`
    SELECT project, COUNT(*) as memory_count,
           MAX(created_at) as last_active
    FROM observations
    WHERE deleted_at IS NULL AND type != 'skill'
    GROUP BY project
    ORDER BY last_active DESC
  `);
  return { projects: rows };
}

module.exports = {
  listWorkspaces,
  createWorkspace,
  archiveWorkspace,
  listProjects,
};
