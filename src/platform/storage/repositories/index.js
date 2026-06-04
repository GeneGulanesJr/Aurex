const { createMemoryRepository } = require('./memory');
const { createCodeIndexRepository } = require('./code-index');
const { createDocIndexRepository } = require('./doc-index');
const { createTrustSyncRepository } = require('./trust-sync');
const { createAnalyticsRepository } = require('./analytics');
const { createAurexRepository } = require('./aurex');

function createRepositories(deps) {
  return Object.freeze({
    memory: createMemoryRepository(deps),
    codeIndex: createCodeIndexRepository(deps),
    docIndex: createDocIndexRepository(deps),
    trustSync: createTrustSyncRepository(deps),
    analytics: createAnalyticsRepository(deps),
    aurex: createAurexRepository(deps),
  });
}

module.exports = {
  createRepositories,
  createMemoryRepository,
  createCodeIndexRepository,
  createDocIndexRepository,
  createTrustSyncRepository,
  createAnalyticsRepository,
  createAurexRepository,
};
