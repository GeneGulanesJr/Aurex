const responseMeta = require('../../response-meta');

const TOOL_NAMES = {
  'import-graph': 'getImportGraph',
  'call-hierarchy': 'getCallHierarchy',
  'blast-radius': 'getBlastRadius',
  'dead-code': 'getDeadCode',
  complexity: 'getComplexity',
  outline: 'getFileOutline',
  churn: 'getChurn',
  hotspots: 'getHotspots',
  cycles: 'getDependencyCycles',
  importance: 'getSymbolImportance',
  coupling: 'getCouplingMetrics',
  extractable: 'getExtractionCandidates',
  hierarchy: 'getClassHierarchy',
  'signal-chains': 'getSignalChains',
  'layer-violations': 'getLayerViolations',
  winnow: 'winnow',
  'ast-patterns': 'astPatterns',
  provenance: 'getProvenance',
  untested: 'getUntestedSymbols',
  'pr-risk': 'getPrRiskProfile',
};

function buildAnalysisEnvelope(toolName, data, repoRow, startTime, deps) {
  return responseMeta.buildEnvelope({
    toolName: TOOL_NAMES[toolName] || toolName,
    data,
    db: deps.getDb(),
    repoId: repoRow.id,
    repoPath: repoRow.path,
    storedHeadCommit: repoRow.head_commit || null,
    startTime,
  });
}

module.exports = { TOOL_NAMES, buildAnalysisEnvelope };
