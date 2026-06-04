const agentIntel = require('../../agent-intel/preflight');

const USAGE = {
  preflight: '--repo X --task "what to implement" [--code-limit N] [--memory-limit N] [--doc-limit N]',
  'agent-pack': '--repo X --task "what to implement" [--code-limit N] [--memory-limit N] [--doc-limit N]',
};

function register(commands, deps) {
  commands.preflight = (args) => agentIntel.preflight(deps, args);
  commands['agent-pack'] = (args) => agentIntel.agentPack(deps, args);
}

module.exports = { register, USAGE };
