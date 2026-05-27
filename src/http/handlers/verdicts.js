const { jsonOk, jsonCreated } = require('../errors');

function writeVerdict(repo) {
  return async (req, res, ctx) => {
    const { sessionId, ...verdict } = ctx.body;
    const id = `vv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rows = repo.createVerdict({ id, sessionId, ...verdict });
    jsonCreated(res, rows[0] || { id, sessionId, ...verdict, timestamp: new Date().toISOString() });
  };
}

function classifyVerdict(repo) {
  return async (req, res, ctx) => {
    const { classification } = ctx.body;
    repo.classifyVerdict(ctx.params.id, classification);
    jsonOk(res, { ok: true });
  };
}

function getVerdicts(repo) {
  return async (req, res, ctx) => {
    const verdicts = repo.getVerdicts(ctx.params.milestoneId);
    jsonOk(res, verdicts);
  };
}

module.exports = { writeVerdict, classifyVerdict, getVerdicts };
