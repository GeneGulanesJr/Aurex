// Module boundary:
// Owns procedural workflow memory: saved workflows, ordered steps, step
// Outcomes, and scoring. Depends on storage/project identity only; must not
// Depend on declarative-memory ranking or code/doc parser internals.

const workflows = require('./workflows');
const steps = require('./steps');
const scoring = require('./scoring');

module.exports = {
  ...workflows,
  recordStep: steps.recordStep,
  stepOutcome: steps.stepOutcome,
  workflows,
  steps,
  scoring,
};
