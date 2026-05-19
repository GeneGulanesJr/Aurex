const codeAnalysis = require('../../code-analysis');

function buildImportEdges(db, repoId) {
  return codeAnalysis.buildImportGraph(db, repoId);
}

function buildImportEdgesForFiles(db, repoId, changedFileIds, deletedFileIds) {
  return codeAnalysis.buildImportGraphForFiles(db, repoId, changedFileIds, deletedFileIds);
}

function buildCallEdges(db, repoId, opts) {
  return codeAnalysis.buildCallGraph(db, repoId, opts);
}

function buildCallEdgesForFiles(db, repoId, changedFileIds, deletedFileIds, opts) {
  return codeAnalysis.buildCallGraphForFiles(db, repoId, changedFileIds, deletedFileIds, opts);
}

function buildComplexityMetrics(db, repoId) {
  return codeAnalysis.buildComplexity(db, repoId);
}

function buildComplexityMetricsForFiles(db, repoId, changedFileIds, deletedFileIds) {
  return codeAnalysis.buildComplexityForFiles(db, repoId, changedFileIds, deletedFileIds);
}

module.exports = {
  buildImportEdges,
  buildImportEdgesForFiles,
  buildCallEdges,
  buildCallEdgesForFiles,
  buildComplexityMetrics,
  buildComplexityMetricsForFiles,
};
