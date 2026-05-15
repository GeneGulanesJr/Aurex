const workflowDA = require('../data-access/workflows');

function getWorkflowRepository(deps) {
  if (deps.workflowRepository) {
    return deps.workflowRepository;
  }
  return {
    saveWorkflow: (params) => workflowDA.saveWorkflow(deps, params),
    recordStep: (params) => workflowDA.recordStep(deps, params),
    stepOutcome: (params) => workflowDA.stepOutcome(deps, params),
    getWorkflow: (params) => workflowDA.getWorkflow(deps, params),
  };
}

function saveWorkflow(deps, args) {
  const workflowRepository = getWorkflowRepository(deps);
  return workflowRepository.saveWorkflow({
    id: args.id,
    name: args.name,
    project: args.project || null,
    stepsRaw: args.steps || null,
  });
}

function recordStep(deps, args) {
  const workflowRepository = getWorkflowRepository(deps);
  return workflowRepository.recordStep({
    workflow: args.workflow,
    step: parseInt(args.step),
    command: args.command,
  });
}

function stepOutcome(deps, args) {
  const workflowRepository = getWorkflowRepository(deps);
  return workflowRepository.stepOutcome({
    workflow: args.workflow,
    step: parseInt(args.step),
    success: args.success === 'true',
    workaround: args.workaround || null,
  });
}

function getWorkflow(deps, args) {
  const workflowRepository = getWorkflowRepository(deps);
  return workflowRepository.getWorkflow({ id: args.id });
}

module.exports = { saveWorkflow, recordStep, stepOutcome, getWorkflow };
