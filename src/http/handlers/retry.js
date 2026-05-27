const { jsonOk } = require('../errors');

function incrementRetry(repo) {
  return async (req, res, ctx) => {
    const result = repo.incrementRetry(ctx.params.milestoneId);
    jsonOk(res, result);
  };
}

function logRescope(repo) {
  return async (req, res, ctx) => {
    repo.logRescope(ctx.params.milestoneId, ctx.body);
    jsonOk(res, { ok: true });
  };
}

module.exports = { incrementRetry, logRescope };
