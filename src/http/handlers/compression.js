const { jsonOk } = require('../errors');

function runCompression() {
  return async (req, res, ctx) => {
    const trigger = ctx.body?.trigger || 'manual';
    const missionId = ctx.params.missionId;
    console.log(`[compression] Skipped — not implemented (trigger: ${trigger}, missionId: ${missionId})`);
    jsonOk(res, { accepted: true, skipped: true });
  };
}

module.exports = { runCompression };
