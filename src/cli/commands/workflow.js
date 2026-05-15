const wfCmd = require('../../../commands/workflow');

const USAGE = {};

function register(commands, deps) {
  const { sqlJson, sqlRun, jsonErrNoExit } = deps;

  commands['save-workflow'] = (args) => wfCmd.saveWorkflow({ sqlJson, sqlRun, jsonErrNoExit }, args);
  commands['record-step'] = (args) => wfCmd.recordStep({ sqlJson, sqlRun, jsonErrNoExit }, args);
  commands['step-outcome'] = (args) => wfCmd.stepOutcome({ sqlJson, sqlRun, jsonErrNoExit }, args);
  commands['get-workflow'] = (args) => wfCmd.getWorkflow({ sqlJson, jsonErrNoExit }, args);
}

module.exports = { register, USAGE };
