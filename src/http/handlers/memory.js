const { jsonOk } = require('../errors');

function searchMemory(deps) {
  return async (req, res, ctx) => {
    const { query, limit } = ctx.body;
    const searchDeps = { sqlJson: deps.sqlJson, sqlRun: deps.sqlRun, jsonErrNoExit: (msg) => ({ error: msg }) };
    const search = require('../../memory-domain/search').search;
    const result = search(searchDeps, { query, limit: String(limit || 10) });
    const mapped = (Array.isArray(result) ? result : []).map((r) => ({
      id: r.id,
      title: r.title || '',
      content: r.snippet || r.content || '',
      type: r.type || '',
      scope: r.scope || '',
      topicKey: r.topic_key || null,
    }));
    jsonOk(res, mapped);
  };
}

module.exports = { searchMemory };
