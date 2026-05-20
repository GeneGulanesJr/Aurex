/**
 * Code-analysis.js — Re-export barrel
 *
 * All implementations have been extracted into focused modules:
 *   - import-graph-impl.js
 *   - coupling-impl.js
 *   - call-graph-impl.js
 *   - dead-code-impl.js
 *   - complexity-impl.js
 *   - signal-chains-impl.js
 *   - risk-impl.js
 *   - incremental-builders.js
 *
 * This file preserves the original public API for backward compatibility.
 */

const _importGraph = require('./import-graph-impl');
const _coupling = require('./coupling-impl');
const _callGraph = require('./call-graph-impl');
const _deadCode = require('./dead-code-impl');
const _complexity = require('./complexity-impl');
const _signalChains = require('./signal-chains-impl');
const _risk = require('./risk-impl');
const _builders = require('./incremental-builders');

module.exports = {
  // Import graph
  buildImportGraph: _importGraph.buildImportGraph,
  getImportGraph: _importGraph.getImportGraph,
  extractImportBindings: _importGraph.extractImportBindings,

  // Blast radius
  getBlastRadius: _importGraph.getBlastRadius,

  // Hotspots
  getHotspots: _importGraph.getHotspots,

  // Dependency cycles
  getDependencyCycles: _importGraph.getDependencyCycles,

  // Winnow
  winnow: _importGraph.winnow,

  // PageRank
  buildPageRank: _coupling.buildPageRank,
  clearPageRankCache: _coupling.clearPageRankCache,

  // Symbol importance
  getSymbolImportance: _coupling.getSymbolImportance,

  // Coupling
  getCouplingMetrics: _coupling.getCouplingMetrics,
  getExtractionCandidates: _coupling.getExtractionCandidates,

  // Call graph
  buildCallGraph: _callGraph.buildCallGraph,
  getCallHierarchy: _callGraph.getCallHierarchy,

  // Dead code
  getDeadCode: _deadCode.getDeadCode,

  // Complexity
  buildComplexity: _complexity.buildComplexity,
  getComplexity: _complexity.getComplexity,
  getFileOutline: _complexity.getFileOutline,

  // Class hierarchy, signal chains, layer violations
  getClassHierarchy: _signalChains.getClassHierarchy,
  getSignalChains: _signalChains.getSignalChains,
  getLayerViolations: _signalChains.getLayerViolations,

  // Untested symbols + PR risk
  getUntestedSymbols: _risk.getUntestedSymbols,
  getPrRiskProfile: _risk.getPrRiskProfile,

  // Incremental builders
  buildImportGraphForFiles: _builders.buildImportGraphForFiles,
  buildCallGraphForFiles: _builders.buildCallGraphForFiles,
  buildComplexityForFiles: _builders.buildComplexityForFiles,
};
