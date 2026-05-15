const obsCmd = require('../../../commands/observation');
const searchCmd = require('../../../commands/search');
const codeSearchService = require('../../../services/code-search');

const USAGE = {};

function register(commands, deps) {
  const { sqlJson, sqlRun, sqlRaw, jsonErrNoExit } = deps;

  commands.save = (args) => obsCmd.save({ sqlJson, sqlRun, sqlRaw, jsonErrNoExit }, args);
  commands.search = (args) => searchCmd.search({ sqlJson, sqlRun, jsonErrNoExit, searchCode: (q, repo, kind, limit) => codeSearchService.searchCode(q, repo, kind, limit) }, args);
  commands.context = (args) => searchCmd.context({ sqlJson, sqlRun, jsonErrNoExit, searchCode: (q, repo, kind, limit) => codeSearchService.searchCode(q, repo, kind, limit) }, args);
  commands.get = (args) => obsCmd.get({ sqlJson, sqlRun, jsonErrNoExit }, args);
  commands.update = (args) => obsCmd.update({ sqlJson, sqlRun, jsonErrNoExit }, args);
  commands.delete = (args) => obsCmd.del({ sqlJson, sqlRun, jsonErrNoExit }, args);
  commands.timeline = (args) => obsCmd.timeline({ sqlJson, sqlRun, jsonErrNoExit }, args);
  commands['suggest-topic-key'] = (args) => obsCmd.suggestTopicKey(args);
  commands['save-prompt'] = (args) => obsCmd.savePrompt({ sqlJson, sqlRun, jsonErrNoExit }, args);
  commands['capture-passive'] = (args) => obsCmd.capturePassive({ sqlJson, sqlRun, jsonErrNoExit }, args);
  commands.stats = () => obsCmd.getStats(deps);
  commands['check-dup'] = (args) => searchCmd.checkDuplicate({ sqlJson, jsonErrNoExit }, args);
  commands['mark-dup'] = (args) => searchCmd.markDuplicate({ sqlJson, sqlRun, jsonErrNoExit }, args);
}

module.exports = { register, USAGE };
