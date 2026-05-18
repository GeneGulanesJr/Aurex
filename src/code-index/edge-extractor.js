const codeAnalysis = require('../../code-analysis');

function buildImportEdges(db, repoId) {
  return codeAnalysis.buildImportGraph(db, repoId);
}

function buildCallEdges(db, repoId, opts) {
  return codeAnalysis.buildCallGraph(db, repoId, opts);
}

function buildComplexityMetrics(db, repoId) {
  return codeAnalysis.buildComplexity(db, repoId);
}

module.exports = { buildImportEdges, buildCallEdges, buildComplexityMetrics };
