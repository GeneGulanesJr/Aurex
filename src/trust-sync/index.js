// Module boundary:
// Owns the integration between declarative memories and indexed code symbols:
// Symbol links, related-memory lookup, trust policy, and change detection. This
// Is the only feature module that should coordinate memory and code tables.

module.exports = {
  ...require('./symbol-links'),
  ...require('./related-memory'),
  trustPolicy: require('./trust-policy'),
  changeDetector: require('./change-detector'),
};
