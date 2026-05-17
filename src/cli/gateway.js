// Module boundary:
// Owns CLI command-map composition and feature router registration. Routers map
// Command arguments to feature services; business logic belongs in feature
// Modules, and Pi extension state must stay outside this gateway.

const memoryRouter = require('./commands/memory');
const workflowRouter = require('./commands/workflow');
const codeIndexRouter = require('./commands/code-index');
const codeAnalysisRouter = require('./commands/code-analysis');
const docsRouter = require('./commands/docs');
const trustRouter = require('./commands/trust');
const maintenanceRouter = require('./commands/maintenance');

function buildCommandMap(deps) {
  const commands = {};

  memoryRouter.register(commands, deps);
  workflowRouter.register(commands, deps);
  codeIndexRouter.register(commands, deps);
  codeAnalysisRouter.register(commands, deps);
  docsRouter.register(commands, deps);
  trustRouter.register(commands, deps);
  maintenanceRouter.register(commands, deps);

  return commands;
}

function getAllUsage() {
  return {
    ...memoryRouter.USAGE,
    ...workflowRouter.USAGE,
    ...codeIndexRouter.USAGE,
    ...codeAnalysisRouter.USAGE,
    ...docsRouter.USAGE,
    ...trustRouter.USAGE,
    ...maintenanceRouter.USAGE,
  };
}

module.exports = {
  buildCommandMap,
  getAllUsage,
  ANALYSIS_TOOLS: codeAnalysisRouter.ANALYSIS_TOOLS,
  _wrapAnalysis: codeAnalysisRouter._wrapAnalysis,
};
