const workflows = require('../../../../data-access/workflows');

function createWorkflowRepository(deps) {
  return Object.freeze({
    saveWorkflow(params) {
      return workflows.saveWorkflow(deps, params);
    },
    recordStep(params) {
      return workflows.recordStep(deps, params);
    },
    stepOutcome(params) {
      return workflows.stepOutcome(deps, params);
    },
    getWorkflow(params) {
      return workflows.getWorkflow(deps, params);
    },
  });
}

module.exports = { createWorkflowRepository };
