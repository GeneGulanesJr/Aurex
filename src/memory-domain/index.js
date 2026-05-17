// Module boundary:
// Owns declarative memory: observations, search, context, sessions, recall,
// Dedupe, compaction, and workspaces. Depends on storage/config/ranking
// Helpers only; must not depend on code or documentation parser internals.

module.exports = {
  observations: require('./observations'),
  search: require('./search'),
  context: require('./context'),
  sessions: require('./sessions'),
  recall: require('./recall'),
  dedupe: require('./dedupe'),
  compaction: require('./compaction'),
  workspaces: require('./workspaces'),
};
