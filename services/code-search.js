const sourceRetrieval = require('../src/code-index/source-retrieval');

module.exports = {
  searchCodeLike: sourceRetrieval.searchCodeLike,
  searchCode: sourceRetrieval.searchCode,
  getCodeSource: sourceRetrieval.getCodeSource,
  rankedContext: sourceRetrieval.rankedContext,
  listCodeReposInternal: sourceRetrieval.listCodeRepos,
  removeCodeRepoInternal: sourceRetrieval.removeCodeRepo,
};
