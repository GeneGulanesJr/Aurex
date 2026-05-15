const wireFormat = require('../../../wire-format');

const DEFAULT_STRIP_FIELDS = ['symbol_id', 'id'];

function compactAnalysis(data, opts = {}) {
  return wireFormat.compactResponse(data, { stripFields: opts.stripFields || DEFAULT_STRIP_FIELDS });
}

function autoCompactAnalysis(data, opts = {}) {
  if (wireFormat.autoFormat(data) !== 'compact') {
    return data;
  }
  return compactAnalysis(data, opts);
}

module.exports = { DEFAULT_STRIP_FIELDS, compactAnalysis, autoCompactAnalysis };
