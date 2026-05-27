const { jsonOk } = require('../errors');

function registerSession(repo) {
  return async (req, res, ctx) => {
    const { agentType, sessionId, missionId, milestoneId, unitId } = ctx.body;
    repo.registerSession({ sessionId, agentType, missionId, milestoneId, unitId });
    jsonOk(res, { ok: true });
  };
}

function getSessionsForMilestone(repo) {
  return async (req, res, ctx) => {
    const sessions = repo.getSessionsForMilestone(ctx.params.milestoneId);
    jsonOk(res, sessions);
  };
}

module.exports = { registerSession, getSessionsForMilestone };
