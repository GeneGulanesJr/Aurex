const wsDA = require('../data-access/workspaces');

async function listWorkspaces(deps) {
  return wsDA.listWorkspaces(deps);
}

async function createWorkspace(deps, args) {
  const name = args.name;
  if (!name) {
    return { error: 'Missing --name' };
  }
  return wsDA.createWorkspace(deps, name);
}

async function archiveWorkspace(deps, args) {
  const name = args.name;
  if (!name) {
    return { error: 'Missing --name' };
  }
  return wsDA.archiveWorkspace(deps, name);
}

async function listProjects(deps) {
  return wsDA.listProjects(deps);
}

module.exports = { listWorkspaces, createWorkspace, archiveWorkspace, listProjects };
