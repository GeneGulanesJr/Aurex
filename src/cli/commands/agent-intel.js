const agentIntel = require('../../agent-intel/preflight');

const USAGE = {
  preflight: '--repo X --task "what to implement" [--code-limit N] [--memory-limit N] [--doc-limit N]',
  'agent-pack': '--repo X --task "what to implement" [--code-limit N] [--memory-limit N] [--doc-limit N]',
  dupes: '--repo X [--threshold 0.65] [--top 20]',
  'enrich-symbols': '--repo X',
  'symbol-meta': '--symbol-id N',
  'audit-diff': '--repo X --files f1,f2 [--task "description"]',
};

function register(commands, deps) {
  commands.preflight = (args) => agentIntel.preflight(deps, args);
  commands['agent-pack'] = (args) => agentIntel.agentPack(deps, args);

  const dupesModule = require('../../agent-intel/dupes');
  commands.dupes = (args) => {
    const db = deps.getDb ? deps.getDb() : deps.db;
    const repoName = args.repo;
    if (!repoName) return deps.jsonErrNoExit('Missing --repo. Usage: dupes --repo X');
    const repoRow = deps.sqlJson('SELECT id, path, head_commit FROM code_repos WHERE name = ?', [repoName]);
    if (!repoRow.length) return deps.jsonErrNoExit(`Repo "${repoName}" not found. Run index-repo first.`);
    return dupesModule.findDupes(db, repoRow[0].id, {
      threshold: args.threshold ? parseFloat(args.threshold) : undefined,
      topK: args.top ? parseInt(args.top) : undefined,
    });
  };

  const enrichment = require('../../agent-intel/symbol-enrichment');
  commands['enrich-symbols'] = (args) => {
    const db = deps.getDb ? deps.getDb() : deps.db;
    const repoName = args.repo;
    if (!repoName) return deps.jsonErrNoExit('Missing --repo. Usage: enrich-symbols --repo X');
    const repoRow = deps.sqlJson('SELECT id, path FROM code_repos WHERE name = ?', [repoName]);
    if (!repoRow.length) return deps.jsonErrNoExit(`Repo "${repoName}" not found.`);
    return enrichment.enrichSymbols(db, repoRow[0].id);
  };
  commands['symbol-meta'] = (args) => {
    const db = deps.getDb ? deps.getDb() : deps.db;
    const symbolId = args['symbol-id'];
    if (!symbolId) return deps.jsonErrNoExit('Missing --symbol-id');
    return enrichment.getSymbolMeta(db, parseInt(symbolId));
  };

  const auditDiffModule = require('../../agent-intel/audit-diff');
  commands['audit-diff'] = (args) => {
    const db = deps.getDb ? deps.getDb() : deps.db;
    const repoName = args.repo;
    if (!repoName) return deps.jsonErrNoExit('Missing --repo. Usage: audit-diff --repo X --files f1,f2');
    const repoRow = deps.sqlJson('SELECT id, path FROM code_repos WHERE name = ?', [repoName]);
    if (!repoRow.length) return deps.jsonErrNoExit(`Repo "${repoName}" not found.`);
    const files = (args.files || '').split(',').map((f) => f.trim()).filter(Boolean);
    return auditDiffModule.auditDiff(db, repoRow[0].id, {
      files,
      task: args.task || '',
    });
  };
}

module.exports = { register, USAGE };
