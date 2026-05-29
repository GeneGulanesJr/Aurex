const { jsonOk, jsonError } = require('../errors');

function writeHandoff(repo) {
  return async (req, res, ctx) => {
    const body = ctx.body;
    const errors = [];
    if (!body.featureName) { errors.push('featureName is required'); }
    if (!body.description) { errors.push('description is required'); }
    if (!body.gitCommitHash) { errors.push('gitCommitHash is required'); }
    if (errors.length > 0) {
      return jsonError(res, 400, 'bad_request', errors.join('; '));
    }
    jsonOk(res, { accepted: true, errors: [] });
  };
}

module.exports = { writeHandoff };
