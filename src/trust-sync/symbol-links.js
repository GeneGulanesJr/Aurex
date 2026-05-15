const { TRUST_DELTA } = require('../../constants');
const { parseChangedSymbolsJson } = require('./change-detector');
const { evaluateTrustSync, stripOperations } = require('./trust-policy');

function getTrustSyncRepository(deps) {
  if (deps.trustSyncRepository) {
    return deps.trustSyncRepository;
  }
  if (deps.repositories && deps.repositories.trustSync) {
    return deps.repositories.trustSync;
  }
  if (deps.getAnchoredLinks || deps.updateLinkTrust || deps.insertTrustAdjustment) {
    return {
      linkSymbol: (params) => deps.linkSymbol(params),
      findUnlinked: (project) => deps.findUnlinked(project),
      insertSymbolLink: (params) => deps.insertSymbolLink(params),
      adjustTrust: (params) => deps.adjustTrust(params),
      recordRecall: (params) => deps.recordRecall(params),
      getStaleLinks: (repo) => deps.getStaleLinks(repo),
      getAnchoredLinks: (repo) => deps.getAnchoredLinks(repo),
      updateLinkTrust: (params) => deps.updateLinkTrust(params),
      insertTrustAdjustment: (params) => deps.insertTrustAdjustment(params),
      getSymbolsForMemory: (memoryId) => deps.getSymbolsForMemory(memoryId),
      getSymbolCluster: (params) => deps.getSymbolCluster(params),
      getRelatedMemories: (params) => deps.getRelatedMemories(params),
    };
  }
  throw new Error('trust-sync repository is required');
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
  return getTrustSyncRepository(deps).linkSymbol({ memoryId, symbolId, repo, trust });
}

function autoLink(deps, args) {
  const project = args.project;
  if (!project) {
    return deps.jsonErrNoExit('--project required');
  }
  const repository = getTrustSyncRepository(deps);
  const unlinked = repository.findUnlinked(project);
  let linked = 0;
  for (const row of unlinked) {
    repository.insertSymbolLink({
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
  const newTrust = getTrustSyncRepository(deps).adjustTrust({ memoryId, delta, reason });
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
  getTrustSyncRepository(deps).recordRecall({ sessionId, memoryId });
  return { ok: true, sessionId, memoryId };
}

function staleLinks(deps, args) {
  const repo = args.repo;
  if (!repo) {
    return deps.jsonErrNoExit('--repo required');
  }
  const links = getTrustSyncRepository(deps).getStaleLinks(repo);
  return { links, total: links.length };
}

function syncCodeTrust(deps, args) {
  const parsed = parseChangedSymbolsJson(args, deps.jsonErrNoExit);
  if (parsed.error) {
    return parsed.error;
  }

  const repository = getTrustSyncRepository(deps);
  const allLinks = repository.getAnchoredLinks(parsed.repo);
  const evaluated = evaluateTrustSync(allLinks, parsed.changedSet);

  for (const operation of evaluated.operations) {
    repository.updateLinkTrust({
      memoryId: operation.link.memory_id,
      symbolId: operation.link.symbol_id,
      newTrust: operation.newTrust,
    });
    repository.insertTrustAdjustment({
      memoryId: operation.link.memory_id,
      reason: operation.reason,
      delta: operation.delta,
    });
  }

  return stripOperations(evaluated);
}

function trustRecovery(deps, args) {
  const sessionId = parseInt(args.session, 10);
  if (!sessionId) {
    return deps.jsonErrNoExit('Missing --session');
  }

  const repository = getTrustSyncRepository(deps);
  const recalled = repository.getRecalledMemoryIds(sessionId);
  let recovered = 0;
  for (const row of recalled) {
    const memoryId = String(row.memory_id);
    repository.updateLinkTrustByMemoryId({ memoryId, newTrust: TRUST_DELTA.PASSIVE_SURVIVAL });
    repository.insertTrustAdjustment({
      memoryId,
      reason: 'passive_survival',
      delta: TRUST_DELTA.PASSIVE_SURVIVAL,
    });
    recovered++;
  }
  return { ok: true, memoriesRecovered: recovered };
}

module.exports = {
  getTrustSyncRepository,
  linkSymbol,
  autoLink,
  adjustTrust,
  recordRecall,
  staleLinks,
  syncCodeTrust,
  trustRecovery,
};
