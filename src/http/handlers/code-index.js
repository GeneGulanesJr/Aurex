const { indexRepository, reindexRepository, getCodeRepoHealth } = require('../../code-index/incremental-indexer');

function indexRepo(deps) {
  return async (req, res, { body }) => {
    const { path: repoPath, name } = body || {};
    if (!repoPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'path is required' }));
    }
    const path = require('path');
    const repoName = name || path.basename(repoPath);
    const result = await indexRepository(
      { db: require('../db').getDb(), args: {} },
      repoPath,
      repoName,
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  };
}

function reindexRepo(deps) {
  return async (req, res, { body }) => {
    const { repo, mode } = body || {};
    if (!repo) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'repo is required' }));
    }
    const result = await reindexRepository(
      { db: require('../db').getDb(), args: {} },
      repo,
      mode || 'incremental',
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  };
}

function codeRepoHealthHandler(deps) {
  return async (req, res, { params }) => {
    const { repo } = params;
    if (!repo) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'repo is required' }));
    }
    const result = await getCodeRepoHealth(
      { db: require('../db').getDb(), args: {} },
      repo,
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  };
}

module.exports = { indexRepo, reindexRepo, codeRepoHealthHandler };
