function healthCheck(deps) {
  return async (req, res, ctx) => {
    const { jsonOk } = require('../errors');
    jsonOk(res, { status: 'ok', db: true });
  };
}

module.exports = { healthCheck };
