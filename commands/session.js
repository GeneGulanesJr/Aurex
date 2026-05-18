const recoveryService = require('../services/recovery');
const sessionsService = require('../services/sessions');
const dreamService = require('../services/dream');

async function sessionStart(deps, args) {
  return sessionsService.sessionStart(
    {
      sqlJson: deps.sqlJson,
      sqlRun: deps.sqlRun,
      autoRecoverInternal: (sessionId) => recoveryService.autoRecoverInternal(deps, sessionId),
      runCompact: dreamService.runCompact,
      _readTierConfig: deps._readTierConfig,
      TOOL_TIERS: deps.TOOL_TIERS,
      commands: deps.commands,
    },
    args,
  );
}

async function sessionEnd(deps, args) {
  return sessionsService.sessionEnd(
    {
      sqlJson: deps.sqlJson,
      sqlRun: deps.sqlRun,
      trustRecovery: dreamService.trustRecovery,
    },
    args,
  );
}

async function sessionSummary(deps, args) {
  return sessionsService.sessionSummary(
    {
      sqlJson: deps.sqlJson,
      jsonErrNoExit: deps.jsonErrNoExit,
      findLatestSession: sessionsService.findLatestSession,
    },
    args,
  );
}

async function autoRecover(deps, args) {
  return recoveryService.autoRecover(deps, args);
}

async function recoverOrphans(deps) {
  return recoveryService.recoverOrphans(deps);
}

async function dream(deps) {
  return dreamService.dream({
    sqlJson: deps.sqlJson,
    sqlRun: deps.sqlRun,
    softDeleteObservation: (id) => deps.softDeleteObservation(id),
  });
}

async function compact() {
  return dreamService.compact();
}

async function trustRecovery(args) {
  return dreamService.trustRecovery(args);
}

module.exports = {
  sessionStart,
  sessionEnd,
  sessionSummary,
  autoRecover,
  recoverOrphans,
  dream,
  compact,
  trustRecovery,
};
