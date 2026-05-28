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

function buildRelationEdges(db, repoId) {
  const results = [];
  results.push(codeAnalysis.buildExtendsEdges(db, repoId));
  results.push(codeAnalysis.buildImplementsEdges(db, repoId));
  results.push(codeAnalysis.buildReexportEdges(db, repoId));
  results.push(codeAnalysis.buildReferenceEdges(db, repoId));
  return {
    success: results.every((r) => r.success !== false),
    count: results.reduce((sum, r) => sum + (r.count || 0), 0),
  };
}

function buildCochangeEdges(db, repoId, opts) {
  return codeAnalysis.buildCochangeEdges(db, repoId, opts);
}

module.exports = {
  buildImportEdges,
  buildImportEdgesForFiles,
  buildCallEdges,
  buildCallEdgesForFiles,
  buildComplexityMetrics,
  buildComplexityMetricsForFiles,
  buildRelationEdges,
  buildCochangeEdges,
};
