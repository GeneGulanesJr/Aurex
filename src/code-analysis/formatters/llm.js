const { buildAnalysisEnvelope } = require('../metadata');
const { compactAnalysis, autoCompactAnalysis, DEFAULT_STRIP_FIELDS } = require('./compact');

function formatAnalysisForLlm(toolName, data, repoRow, startTime, format, deps) {
  const wrapped = buildAnalysisEnvelope(toolName, data, repoRow, startTime, deps);
  if (format === 'compact') {
    wrapped.data = compactAnalysis(wrapped.data, { stripFields: DEFAULT_STRIP_FIELDS });
  } else if (format === 'auto') {
    wrapped.data = autoCompactAnalysis(wrapped.data, { stripFields: DEFAULT_STRIP_FIELDS });
  }
  return wrapped;
}

module.exports = { formatAnalysisForLlm };
