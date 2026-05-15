const symDA = require('../data-access/symbols');
const trustService = require('../services/trust');
const searchService = require('../services/search');

function getTrustSyncRepository(deps) {
  if (deps.trustSyncRepository) {
    return deps.trustSyncRepository;
  }
  return {
    linkSymbol: (params) => symDA.linkSymbol(deps, params),
    findUnlinked: (project) => symDA.findUnlinked(deps, project),
    insertSymbolLink: (params) => symDA.insertSymbolLink(deps, params),
    adjustTrust: (params) => symDA.adjustTrust(deps, params),
    recordRecall: (params) => symDA.recordRecall(deps, params),
    getStaleLinks: (repo) => symDA.getStaleLinks(deps, repo),
    getAnchoredLinks: (repo) => symDA.getAnchoredLinks(deps, repo),
    updateLinkTrust: (params) => symDA.updateLinkTrust(deps, params),
    insertTrustAdjustment: (params) => symDA.insertTrustAdjustment(deps, params),
  };
}

function syncCodeTrust(deps, args) {
  const trustSyncRepository = getTrustSyncRepository(deps);
  return trustService.syncCodeTrust(
    {
      sqlJson: deps.sqlJson,
      jsonErrNoExit: deps.jsonErrNoExit,
      getAnchoredLinks: (repo) => trustSyncRepository.getAnchoredLinks(repo),
      updateLinkTrust: (params) => trustSyncRepository.updateLinkTrust(params),
      insertTrustAdjustment: (params) => trustSyncRepository.insertTrustAdjustment(params),
    },
    args,
  );
}

function symbolCluster(deps, args) {
  return searchService.symbolCluster({ sqlJson: deps.sqlJson, jsonErrNoExit: deps.jsonErrNoExit }, args);
}

function linkSymbol(deps, args) {
  const memoryId = args['memory-id'] || args.memoryId;
  const symbolId = args['symbol-id'] || args.symbolId;
  const repo = args.repo;
  const trust = parseFloat(args.trust || '0.5');
  if (!memoryId) {
    return deps.jsonErrNoExit('--memory-id required');
  }
  if (!repo) {
    return deps.jsonErrNoExit('--repo required');
  }
  const trustSyncRepository = getTrustSyncRepository(deps);
  return trustSyncRepository.linkSymbol({ memoryId, symbolId, repo, trust });
}

function autoLink(deps, args) {
  const project = args.project;
  if (!project) {
    return deps.jsonErrNoExit('--project required');
  }
  const trustSyncRepository = getTrustSyncRepository(deps);
  const unlinked = trustSyncRepository.findUnlinked(project);
  let linked = 0;
  for (const row of unlinked) {
    trustSyncRepository.insertSymbolLink({
      memoryId: row.memory_id,
      symbolId: '__unlinked__',
      repo: project,
      trustScore: 0.5,
    });
    linked++;
  }
  return { ok: true, linked, total: unlinked.length };
}

function adjustTrust(deps, args) {
  const memoryId = args['memory-id'] || args.memoryId;
  const delta = parseFloat(args.delta || '0');
  const reason = args.reason || 'manual';
  if (!memoryId) {
    return deps.jsonErrNoExit('--memory-id required');
  }
  const trustSyncRepository = getTrustSyncRepository(deps);
  const newTrust = trustSyncRepository.adjustTrust({ memoryId, delta, reason });
  if (newTrust === null) {
    return { ok: true, memoryId, newTrust: null, delta, reason, warning: 'No symbol link found for this memory' };
  }
  return { ok: true, memoryId, newTrust, delta, reason };
}

function recordRecall(deps, args) {
  const sessionId = args['session-id'] || args.sessionId;
  const memoryId = args['memory-id'] || args.memoryId;
  if (!sessionId || !memoryId) {
    return deps.jsonErrNoExit('--session-id and --memory-id required');
  }
  const trustSyncRepository = getTrustSyncRepository(deps);
  trustSyncRepository.recordRecall({ sessionId, memoryId });
  return { ok: true, sessionId, memoryId };
}

function staleLinks(deps, args) {
  const repo = args.repo;
  if (!repo) {
    return deps.jsonErrNoExit('--repo required');
  }
  const trustSyncRepository = getTrustSyncRepository(deps);
  const links = trustSyncRepository.getStaleLinks(repo);
  return { links, total: links.length };
}

function related(deps, args) {
  return searchService.related({ sqlJson: deps.sqlJson, jsonErrNoExit: deps.jsonErrNoExit }, args);
}

module.exports = { syncCodeTrust, symbolCluster, related, linkSymbol, autoLink, adjustTrust, recordRecall, staleLinks };
