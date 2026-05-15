const symCmd = require('../../../commands/symbols');

const USAGE = {
  'link-symbol': '--memory-id ID --repo X [--trust N]',
  'auto-link': '--project X',
  'adjust-trust': '--memory-id ID [--delta N] [--reason R]',
  'record-recall': '--session-id ID --memory-id ID',
  'stale-links': '--repo X',
  'sync-code-trust': '--repo X',
  'symbol-cluster': '--repo X [--query Q]',
  related: '--memory-id ID [--repo X]',
};

function register(commands, deps) {
  const { sqlJson, sqlRun, jsonErrNoExit, repositories } = deps;
  const trustSyncRepository = repositories && repositories.trustSync;

  commands['link-symbol'] = (args) => symCmd.linkSymbol({ sqlJson, sqlRun, jsonErrNoExit, trustSyncRepository }, args);
  commands['auto-link'] = (args) => symCmd.autoLink({ sqlJson, sqlRun, jsonErrNoExit, trustSyncRepository }, args);
  commands['adjust-trust'] = (args) =>
    symCmd.adjustTrust({ sqlJson, sqlRun, jsonErrNoExit, trustSyncRepository }, args);
  commands['record-recall'] = (args) =>
    symCmd.recordRecall({ sqlJson, sqlRun, jsonErrNoExit, trustSyncRepository }, args);
  commands['stale-links'] = (args) => symCmd.staleLinks({ sqlJson, jsonErrNoExit, trustSyncRepository }, args);
  commands['sync-code-trust'] = (args) => symCmd.syncCodeTrust({ sqlJson, jsonErrNoExit, trustSyncRepository }, args);
  commands['symbol-cluster'] = (args) => symCmd.symbolCluster({ sqlJson, jsonErrNoExit }, args);
  commands.related = (args) => symCmd.related({ sqlJson, jsonErrNoExit }, args);
}

module.exports = { register, USAGE };
