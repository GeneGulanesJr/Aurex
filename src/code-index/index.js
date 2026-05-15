// Module boundary:
// Owns code indexing and retrieval: repository discovery, scanning, parser
// Selection, symbol/edge extraction, incremental indexing, and source lookup.
// Must not depend on memory observation ranking or Pi extension state.

module.exports = {
  ...require('./edge-extractor'),
  ...require('./incremental-indexer'),
  ...require('./parser-registry'),
  ...require('./repos'),
  ...require('./scanner'),
  ...require('./source-retrieval'),
  ...require('./symbol-extractor'),
};
