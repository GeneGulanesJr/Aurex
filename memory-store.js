#!/usr/bin/env node
/**
 * Memory-store.js — Pi Memory Layer CLI entry point
 *
 * Database operations via db.js. Code parsing via parse-code.js (WASM).
 * Code analysis via code-analysis.js. Doc indexing via doc-indexer.js.
 *
 * Service modules handle domain logic:
 *   - services/dedup:        trigramOverlap, checkDuplicate, markDuplicate
 *   - services/sessions:     sessionStart, sessionEnd, sessionSummary, findLatestSession
 *   - services/dream:        runCompact, compact, dream, trustRecovery
 *   - services/search:       search, rankObservations, symbolCluster, related
 *   - services/code-indexing: parseCodeFile, ensureParserAvailable, indexRepoInternal, reindexRepoInternal, _emitProgress
 *
 * Usage: <subcommand> [options]
 */

const path = require('path');
const fs = require('fs');

const {
  DB_PATH,
  HOME,
  sqlJson,
  sqlRun,
  sqlRaw,
  ensureDb,
  getDb,
  getEngine,
  jsonOut,
  jsonErrNoExit,
  parseArgs,
  MemoryError,
} = require('./db');

const { getConfig } = require('./config');
const {
  TRUST_DELTA, DEDUP, TIME_WINDOWS, RESULT_LIMITS, RANKING, CONTEXT,
} = require('./constants');
const {
  IGNORE_DIRS_CODE: _IGNORE_DIRS,
  CODE_EXTENSIONS: _CODE_EXTS,
  walkDirForCode: walkDir,
  hashContent,
} = require('./utils');

// ── Service imports ──────────────────────────────────────────
const dedupService = require('./services/dedup');
const sessionsService = require('./services/sessions');
const dreamService = require('./services/dream');
const searchService = require('./services/search');
const codeIndexingService = require('./services/code-indexing');

// ── Re-exported constants from services ──────────────────────
const { TRUST_RECALL_JOINS, TYPE_PRIORITY_CASE } = searchService;

// ── Pure-function delegations (no deps needed) ───────────────
const { trigramOverlap, rankObservations } = searchService;
const { findLatestSession } = sessionsService;
const { runCompact, compact } = dreamService;
const { trustRecovery } = dreamService;
const { parseCodeFile, ensureParserAvailable } = codeIndexingService;

/* ── subcommands ───────────────────────────────────────────── */

// Tool tiering (v6) — control which commands appear in session-start context
const TOOL_TIERS = {
  core: new Set(['search', 'save', 'context', 'search-code', 'get-code-source', 'importance', 'outline', 'winnow', 'dream']),
  standard: new Set([
    'search',
    'save',
    'context',
    'search-code',
    'get-code-source',
    'importance',
    'outline',
    'winnow',
    'dream',
    'complexity',
    'dead-code',
    'hotspots',
    'blast-radius',
    'call-hierarchy',
    'cycles',
    'coupling',
    'churn',
    'signal-chains',
  ]),
  full: null, // Null = all commands
};

function _readTierConfig() {
  const configPath = getConfig().tier_config_path;
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    // Strip comments (//-style) for JSON parsing
    const cleaned = raw.replace(/\/\/.*$/gm, '');
    return JSON.parse(cleaned);
  } catch (_) {
    return { tier: 'full' };
  }
}

/* ── session delegations ──────────────────────────────────── */

function sessionStart(args) {
  return sessionsService.sessionStart({
    sqlJson, sqlRun, autoRecoverInternal, runCompact, _readTierConfig, TOOL_TIERS, commands,
  }, args);
}

function sessionEnd(args) {
  return sessionsService.sessionEnd({
    sqlJson, sqlRun, trustRecovery,
  }, args);
}

function sessionSummary(args) {
  return sessionsService.sessionSummary({
    sqlJson, jsonErrNoExit, findLatestSession,
  }, args);
}

/* ── observations ─────────────────────────────────────────── */

function save(args) {
  const title = args.title;
  const type = args.type || 'manual';
  const content = args.content;
  const project = args.project || null;
  const scope = args.scope || 'project';
  const topicKey = args['topic-key'] || null;
  const sessionId = args['session-id'] || findLatestSession(project);
  const force = args.force === 'true' || args.force === true;

  if (!title || !content) {
    return jsonErrNoExit('Missing --title and --content');
  }

  // Dedup check (skip if forced)
  if (!force) {
    const dupes = checkDuplicate(title, type, project, topicKey);
    if (dupes.potential_duplicates.length > 0) {
      const bestMatch = dupes.potential_duplicates[0];
      // Auto-merge at high confidence (≥85% trigram overlap)
      const dedupCfg = getConfig().dedup;
      if (bestMatch.similarity >= dedupCfg.auto_merge_threshold) {
        const keptId = bestMatch.id;
        const rows = sqlJson(
          `
          INSERT INTO observations (session_id, type, title, content, project, scope, topic_key)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          RETURNING id, created_at
        `,
          [String(sessionId), type, title, content, project, scope, topicKey],
        );
        const newId = rows[0].id;
        // Soft-delete the older duplicate, record the relation
        sqlRun(
          'INSERT OR IGNORE INTO observation_relations (source_id, target_id, relation, confidence) VALUES (?, ?, ?, ?)',
          [newId, keptId, 'duplicate', bestMatch.similarity],
        );
        softDeleteObservation(keptId);
        return {
          id: newId,
          title,
          created_at: rows[0].created_at,
          auto_merged: true,
          superseded_id: keptId,
          superseded_title: bestMatch.title,
          similarity: bestMatch.similarity,
        };
      }
      // Moderate confidence (60-84%): warn but let caller decide
      return {
        status: 'potential_duplicate',
        message: 'Similar observations exist. Use --force to save anyway.',
        matches: dupes.potential_duplicates.slice(0, 3),
        hint: 'save --force ...',
      };
    }
  }

  const rows = sqlJson(
    `
    INSERT INTO observations (session_id, type, title, content, project, scope, topic_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id, created_at
  `,
    [String(sessionId), type, title, content, project, scope, topicKey],
  );
  return { id: rows[0].id, title, created_at: rows[0].created_at };
}

/* ── search delegation ─────────────────────────────────────── */

function search(args) {
  return searchService.search({ sqlJson, sqlRun, jsonErrNoExit, searchCode }, args);
}

/* ── context (uses TRUST_RECALL_JOINS and TYPE_PRIORITY_CASE from searchService) ── */

function context(args) {
  const project = args.project || null;
  const limit = parseInt(args.limit || String(getConfig().context_limit), 10);
  const sessionId = args['session-id'] ? parseInt(args['session-id'], 10) : null;
  const topicKey = args['topic-key'] || null;
  const topicQuery = args.query || null;
  const deep = args.deep === 'true' || args.deep === true;
  const crossProject = !project || args['all-projects'] === 'true' || args['all-projects'] === true;
  if (!project && !crossProject) {
    return jsonErrNoExit('Missing --project');
  }

  // Active sessions
  const sessions = project
    ? sqlJson(
        `
    SELECT id, project, started_at, ended_at, memories_saved
    FROM session_log
    WHERE project = ?
    ORDER BY started_at DESC
    LIMIT ${RESULT_LIMITS.RECENT_SESSIONS}
  `,
        [project],
      )
    : [];

  const personal = sqlJson(`
    SELECT id, title, type, scope, topic_key, created_at
    FROM observations
    WHERE scope = 'personal' AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ${RESULT_LIMITS.PERSONAL_OBSERVATIONS}
  `);

  const RELEVANCE_WEIGHTS = CONTEXT.RELEVANCE_WEIGHTS;

  // Topic-aware, cross-project, or standard observations
  let obsQuery, obsParams;
  if (crossProject) {
    const crossLimit = deep ? Math.min(limit * CONTEXT.CROSS_PROJECT_DEEP_MULTIPLIER, CONTEXT.CROSS_PROJECT_DEEP_MAX) : limit;
    obsQuery = `
      SELECT o.id, o.title, o.type, o.scope, o.topic_key, o.project, o.created_at,
             COALESCE(sl.trust_score, ${RANKING.DEFAULT_TRUST_SCORE}) as trust_score,
             COALESCE(rl.recall_count, 0) as recall_count,
             ${TYPE_PRIORITY_CASE} as type_priority
      FROM observations o
      ${TRUST_RECALL_JOINS}
      WHERE o.deleted_at IS NULL AND o.type != 'skill' AND o.scope = 'project'
      ORDER BY recall_count DESC, trust_score DESC, type_priority DESC, o.created_at DESC
      LIMIT ?
    `;
    obsParams = [crossLimit];
  } else if (topicKey || topicQuery) {
    const topicLimit = deep ? Math.min(limit * CONTEXT.CROSS_PROJECT_DEEP_MULTIPLIER, CONTEXT.CROSS_PROJECT_DEEP_MAX) : limit;
    if (topicQuery) {
      obsQuery = `
        WITH topic_matches AS (
          SELECT id FROM observations
          WHERE project = ? AND deleted_at IS NULL AND type != 'skill'
            AND (topic_key LIKE ? OR title LIKE ? OR content LIKE ?)
          ORDER BY created_at DESC
          LIMIT ?
        )
        SELECT o.id, o.title, o.type, o.scope, o.topic_key, o.created_at,
               COALESCE(sl.trust_score, ${RANKING.DEFAULT_TRUST_SCORE}) as trust_score,
               COALESCE(rl.recall_count, 0) as recall_count,
               ${TYPE_PRIORITY_CASE} as type_priority
        FROM observations o
        JOIN topic_matches tm ON o.id = tm.id
        ${TRUST_RECALL_JOINS}
        ORDER BY recall_count DESC, trust_score DESC, type_priority DESC, o.created_at DESC
      `;
      const like = `%${topicQuery.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      obsParams = [project, like, like, like, topicLimit];
    } else {
      obsQuery = `
        SELECT o.id, o.title, o.type, o.scope, o.topic_key, o.created_at,
               COALESCE(sl.trust_score, ${RANKING.DEFAULT_TRUST_SCORE}) as trust_score,
               COALESCE(rl.recall_count, 0) as recall_count,
                CASE
                  WHEN o.topic_key = ? THEN ${CONTEXT.TOPIC_MATCH_BOOST}
                  WHEN o.type = 'decision' THEN ${RANKING.TYPE_PRIORITY.decision} WHEN o.type = 'architecture' THEN ${RANKING.TYPE_PRIORITY.architecture}
                  WHEN o.type = 'bugfix' THEN ${RANKING.TYPE_PRIORITY.bugfix} WHEN o.type = 'pattern' THEN ${RANKING.TYPE_PRIORITY.pattern}
                  WHEN o.type = 'preference' THEN ${RANKING.TYPE_PRIORITY.preference} WHEN o.type = 'config' THEN ${RANKING.TYPE_PRIORITY.config}
                  WHEN o.type = 'discovery' THEN ${RANKING.TYPE_PRIORITY.discovery} WHEN o.type = 'learning' THEN ${RANKING.TYPE_PRIORITY.learning}
                  ELSE 0
                END as type_priority
        FROM observations o
        ${TRUST_RECALL_JOINS}
        WHERE o.project = ? AND o.deleted_at IS NULL AND o.type != 'skill'
        ORDER BY recall_count DESC, CASE WHEN o.topic_key = ? THEN ${CONTEXT.TOPIC_MATCH_BOOST} ELSE type_priority END DESC, trust_score DESC, o.created_at DESC
        LIMIT ?
      `;
      obsParams = [topicKey, project, topicKey, topicLimit];
    }
  } else {
    obsQuery = `
      SELECT o.id, o.title, o.type, o.scope, o.topic_key, o.created_at,
             COALESCE(sl.trust_score, ${RANKING.DEFAULT_TRUST_SCORE}) as trust_score,
             COALESCE(rl.recall_count, 0) as recall_count,
             ${TYPE_PRIORITY_CASE} as type_priority
      FROM observations o
      ${TRUST_RECALL_JOINS}
      WHERE o.project = ? AND o.deleted_at IS NULL AND o.type != 'skill'
      ORDER BY recall_count DESC, type_priority DESC, trust_score DESC, o.created_at DESC
      LIMIT ?
    `;
    obsParams = [project, limit];
  }
  const observations = sqlJson(obsQuery, obsParams);

  // Active procedural workflows
  const workflows = project
    ? sqlJson(
        `
    SELECT id, name, status, success, updated_at
    FROM procedural_memory
    WHERE (project = ? OR project IS NULL) AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT ${RESULT_LIMITS.RECENT_SESSIONS}
  `,
        [project],
      )
    : [];

  // Wire recall tracking: batch insert
  if (sessionId && observations.length > 0) {
    const recallQuery = topicQuery || topicKey || 'context-auto';
    const placeholders = observations.map(() => '(?, ?, ?)').join(',');
    const params = observations.flatMap((o) => [o.id, sessionId, recallQuery]);
    sqlRun(`INSERT OR IGNORE INTO recall_log (memory_id, session_id, query) VALUES ${placeholders}`, params);
  }

  // Calculate stats: total across all projects vs current
  const totalAll = crossProject
    ? sqlJson('SELECT COUNT(*) as cnt FROM observations WHERE deleted_at IS NULL AND type != ?', ['skill'])[0].cnt
    : sqlJson('SELECT COUNT(*) as cnt FROM observations WHERE project = ? AND deleted_at IS NULL AND type != ?', [
        project,
        'skill',
      ])[0].cnt;

  return {
    sessions,
    personal,
    observations,
    workflows,
    project: project || null,
    cross_project: crossProject,
    topic: topicKey || topicQuery || null,
    stats: {
      total_memories: totalAll,
      total_personal: personal.length,
      active_workflows: workflows.length,
    },
  };
}

function get(args) {
  const id = args.id;
  if (!id) {
    return jsonErrNoExit('Missing --id');
  }
  const rows = sqlJson(
    `
    SELECT id, title, content, type, project, scope, topic_key,
           created_at, updated_at, deleted_at
    FROM observations
    WHERE id = ?
  `,
    [parseInt(id, 10)],
  );
  if (rows.length === 0) {
    return { error: 'Observation not found' };
  }

  const obs = rows[0];

  // Attach symbol links
  const links = sqlJson('SELECT symbol_id, repo, trust_score FROM symbol_links WHERE memory_id = ?', [String(id)]);
  if (links.length > 0) {
    obs.symbols = links;
  }

  // Attach recall count
  const recallCount = sqlJson('SELECT COUNT(*) as cnt FROM recall_log WHERE memory_id = ?', [parseInt(id, 10)]);
  obs.recall_count = recallCount[0].cnt;

  return obs;
}

function update(args) {
  const id = args.id;
  if (!id) {
    return jsonErrNoExit('Missing --id');
  }
  const sets = [];
  const params = [];
  if (args.title) {
    sets.push('title = ?');
    params.push(args.title);
  }
  if (args.content) {
    sets.push('content = ?');
    params.push(args.content);
  }
  if (args.type) {
    sets.push('type = ?');
    params.push(args.type);
  }
  if (args.project) {
    sets.push('project = ?');
    params.push(args.project);
  }
  if (args.scope) {
    sets.push('scope = ?');
    params.push(args.scope);
  }
  if (args['topic-key']) {
    sets.push('topic_key = ?');
    params.push(args['topic-key']);
  }
  if (sets.length === 0) {
    return jsonErrNoExit('Nothing to update');
  }

  params.push(parseInt(id, 10));
  sqlRun(`UPDATE observations SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, params);

  const rows = sqlJson(
    `
    SELECT id, title, content, type, project, scope, topic_key,
           created_at, updated_at
    FROM observations WHERE id = ?
  `,
    [parseInt(id, 10)],
  );
  return rows.length > 0 ? rows[0] : { error: 'Observation not found' };
}

function softDeleteObservation(id) {
  sqlRun("UPDATE observations SET deleted_at = datetime('now') WHERE id = ?", [parseInt(id, 10)]);
  try {
    sqlRun("INSERT INTO observations_fts(observations_fts, rowid, title, content, type, project, topic_key) VALUES ('delete', ?, '', '', '', '', '')", [parseInt(id, 10)]);
  } catch (_) {}
}

function del(args) {
  const id = args.id;
  const hard = args.hard === 'true' || args.hard === true;
  if (!id) {
    return jsonErrNoExit('Missing --id');
  }

  if (hard) {
    sqlRun('DELETE FROM observations WHERE id = ?', [parseInt(id, 10)]);
    return { ok: true, hardDeleted: true };
  }
  softDeleteObservation(id);
  return { ok: true, hardDeleted: false };
}

function timeline(args) {
  const id = parseInt(args.id);
  const before = parseInt(args.before || '5', 10);
  const after = parseInt(args.after || '5', 10);
  if (isNaN(id)) {
    return jsonErrNoExit('Missing --id');
  }

  return sqlJson(
    `
    SELECT id, title, type, project, scope, created_at
    FROM observations
    WHERE id BETWEEN ? AND ?
      AND deleted_at IS NULL
    ORDER BY id
  `,
    [id - before, id + after],
  );
}

function suggestTopicKey(args) {
  const title = args.title;
  const content = args.content;
  const source = title || content || '';
  const key = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return { topic_key: key || 'untitled' };
}

function savePrompt(args) {
  const content = args.content;
  const project = args.project || null;
  const sessionId = args['session-id'] || findLatestSession(project);
  if (!content) {
    return jsonErrNoExit('Missing --content');
  }

  const rows = sqlJson(
    `
    INSERT INTO user_prompts (session_id, content, project)
    VALUES (?, ?, ?)
    RETURNING id, created_at
  `,
    [String(sessionId), content, project],
  );
  return { id: rows[0].id, created_at: rows[0].created_at };
}

function capturePassive(args) {
  const content = args.content;
  if (!content) {
    return jsonErrNoExit('Missing --content');
  }

  const match = content.match(/##\s*Key\s*Learnings?:\s*([\s\S]*)/i);
  if (!match) {
    return { extracted: 0, items: [] };
  }

  const section = match[1];
  const itemRe = /(?:^|\n)\s*(?:[-*]|\d+[.)])\s*([^\n]*(?:\n(?!\s*(?:[-*]|\d+[.)])\s*)[^\n]*)*)/g;
  const items = [];
  let m;
  while ((m = itemRe.exec(section)) !== null) {
    const cleaned = m[1].replace(/\n\s+/g, ' ').trim();
    if (cleaned) {
      items.push(cleaned);
    }
  }

  let inserted = 0;
  const sessionId = findLatestSession(null);
  for (const item of items) {
    const summary = item.length > CAPTURE_PASSIVE.SUMMARY_MAX_LENGTH ? `${item.slice(0, CAPTURE_PASSIVE.SUMMARY_MAX_LENGTH - 3)}…` : item;
    sqlJson('INSERT INTO observations (session_id, type, title, content, scope) VALUES (?, ?, ?, ?, ?)', [
      String(sessionId),
      'learning',
      summary,
      item,
      'project',
    ]);
    inserted++;
  }
  return { extracted: inserted, items };
}

function getStats() {
  const obs = sqlJson('SELECT COUNT(*) as cnt FROM observations WHERE deleted_at IS NULL')[0].cnt;
  const prompts = sqlJson('SELECT COUNT(*) as cnt FROM user_prompts')[0].cnt;
  const sessions = sqlJson('SELECT COUNT(*) as cnt FROM session_log')[0].cnt;
  const links = sqlJson('SELECT COUNT(*) as cnt FROM symbol_links')[0].cnt;
  const workflows = sqlJson('SELECT COUNT(*) as cnt FROM procedural_memory')[0].cnt;
  return {
    total_observations: obs,
    total_prompts: prompts,
    total_sessions: sessions,
    total_symbol_links: links,
    total_workflows: workflows,
  };
}

/* ── symbol anchoring ─────────────────────────────────────── */

function linkSymbol(args) {
  const memoryId = args.memory;
  const symbolId = args.symbol;
  const repo = args.repo;
  const trust = parseFloat(args.trust || (symbolId ? '1.0' : String(TRUST_DELTA.DEFAULT_INITIAL)));

  if (!memoryId || !repo) {
    return jsonErrNoExit('Missing --memory and --repo');
  }
  const symVal = symbolId || '__unlinked__';

  sqlRun('INSERT OR REPLACE INTO symbol_links (memory_id, symbol_id, repo, trust_score) VALUES (?, ?, ?, ?)', [
    memoryId,
    symVal,
    repo,
    trust,
  ]);
  return { ok: true, memoryId, symbolId: symVal, repo, trustScore: trust };
}

function autoLink(args) {
  const project = args.project;
  if (!project) {
    return jsonErrNoExit('Missing --project');
  }

  const unlinked = sqlJson(
    `
    SELECT CAST(id AS TEXT) as memory_id FROM observations
    WHERE project = ? AND deleted_at IS NULL
      AND CAST(id AS TEXT) NOT IN (SELECT memory_id FROM symbol_links)
  `,
    [project],
  );

  let linked = 0;
  for (const row of unlinked) {
    sqlRun('INSERT OR IGNORE INTO symbol_links (memory_id, symbol_id, repo, trust_score) VALUES (?, ?, ?, ?)', [
      String(row.memory_id),
      '__unlinked__',
      project,
      TRUST_DELTA.DEFAULT_INITIAL,
    ]);
    linked++;
  }
  return { ok: true, project, linked, unlinkedCount: unlinked.length };
}

function adjustTrust(args) {
  const memoryId = args.memory;
  const reason = args.reason;
  const delta = parseFloat(args.delta);
  if (!memoryId || !reason || isNaN(delta)) {
    return jsonErrNoExit('Missing --memory, --reason, --delta');
  }

  sqlRun('UPDATE symbol_links SET trust_score = MIN(1.0, MAX(0.0, trust_score + ?)) WHERE memory_id = ?', [delta, memoryId]);
  sqlRun('INSERT INTO trust_adjustments (memory_id, reason, delta) VALUES (?, ?, ?)', [memoryId, reason, delta]);

  const updated = sqlJson('SELECT trust_score FROM symbol_links WHERE memory_id = ? LIMIT 1', [memoryId]);
  return { ok: true, memoryId, newTrustScore: updated.length > 0 ? updated[0].trust_score : null };
}

function recordRecall(args) {
  const sessionId = parseInt(args.session);
  const memoryId = args.memory;
  if (!sessionId || !memoryId) {
    return jsonErrNoExit('Missing --session and --memory');
  }
  sqlRun('INSERT OR IGNORE INTO session_recalls (session_id, memory_id) VALUES (?, ?)', [sessionId, memoryId]);
  return { ok: true };
}

function staleLinks(args) {
  const project = args.project;
  if (!project) {
    return jsonErrNoExit('Missing --project');
  }
  return sqlJson(
    `SELECT memory_id, symbol_id, repo, trust_score, last_verified
     FROM symbol_links
     WHERE repo = ? AND symbol_id != '__unlinked__'
     ORDER BY trust_score ASC`,
    [project],
  );
}

/* ── project discovery ─────────────────────────────────────── */

function listProjects() {
  const rows = sqlJson(`
    SELECT project, COUNT(*) as memory_count,
           MAX(created_at) as last_active
    FROM observations
    WHERE deleted_at IS NULL AND type != 'skill'
    GROUP BY project
    ORDER BY last_active DESC
  `);
  return { projects: rows };
}

/* ── code-aware trust sync ─────────────────────────────────── */

/**
 * Sync trust scores against code changes.
 * Pipe changed symbols JSON as --changed-symbols-json.
 * For each linked symbol:
 *   - Changed → trust -= 0.3 (code drifted from memory)
 *   - Unchanged → trust += 0.05 (memory survived, proven durable)
 */
function syncCodeTrust(args) {
  const repo = args.repo;
  const changedJson = args['changed-symbols-json'] || args['changed-symbols'];
  if (!repo || !changedJson) {
    return jsonErrNoExit('Missing --repo and --changed-symbols-json');
  }

  let changedData;
  try {
    changedData = JSON.parse(changedJson);
  } catch (_) {
    return jsonErrNoExit('Invalid JSON for --changed-symbols-json');
  }

  // Normalise to a flat set of changed symbol IDs/names
  const changedSet = new Set();
  if (Array.isArray(changedData)) {
    for (const s of changedData) {
      if (typeof s === 'string') {
        changedSet.add(s);
      } else if (s && s.symbol_id) {
        changedSet.add(s.symbol_id);
      } else if (s && s.name) {
        changedSet.add(s.name);
      }
    }
  } else if (changedData && typeof changedData === 'object') {
    for (const key of ['added', 'modified', 'removed', 'changed']) {
      const arr = changedData[key];
      if (!Array.isArray(arr)) {
        continue;
      }
      for (const s of arr) {
        if (typeof s === 'string') {
          changedSet.add(s);
        } else if (s && s.symbol_id) {
          changedSet.add(s.symbol_id);
        } else if (s && s.name) {
          changedSet.add(s.name);
        }
      }
    }
  }
  if (changedSet.size === 0) {
    return jsonErrNoExit('No changed symbols found in input');
  }

  // Get all anchored links for this repo
  const allLinks = sqlJson(
    `SELECT memory_id, symbol_id, trust_score, last_verified
     FROM symbol_links WHERE repo = ? AND symbol_id != '__unlinked__'`,
    [repo],
  );

  const result = { total: allLinks.length, adjusted: [], survived: [], unchanged: [] };

  for (const link of allLinks) {
    const isChanged = [...changedSet].some(
      (cs) => link.symbol_id === cs || link.symbol_id.endsWith(`::${cs}`) || link.symbol_id.includes(cs),
    );

    if (isChanged) {
      const delta = TRUST_DELTA.SYMBOL_CHANGED;
      const newTrust = Math.max(TRUST_DELTA.TRUST_FLOOR, link.trust_score + delta);
      sqlRun(
        "UPDATE symbol_links SET trust_score = ?, last_verified = datetime('now') WHERE memory_id = ? AND symbol_id = ?",
        [newTrust, link.memory_id, link.symbol_id],
      );
      sqlRun('INSERT INTO trust_adjustments (memory_id, reason, delta) VALUES (?, ?, ?)', [
        link.memory_id,
        'symbol_changed',
        delta,
      ]);
      result.adjusted.push({
        memory_id: link.memory_id,
        symbol_id: link.symbol_id,
        old_trust: link.trust_score,
        new_trust: newTrust,
      });
    } else if (link.trust_score < TRUST_DELTA.MAX_SURVIVED) {
      const delta = TRUST_DELTA.SURVIVED_UNCHANGED;
      const newTrust = Math.min(TRUST_DELTA.TRUST_CEILING, link.trust_score + delta);
      sqlRun(
        "UPDATE symbol_links SET trust_score = ?, last_verified = datetime('now') WHERE memory_id = ? AND symbol_id = ?",
        [newTrust, link.memory_id, link.symbol_id],
      );
      sqlRun('INSERT INTO trust_adjustments (memory_id, reason, delta) VALUES (?, ?, ?)', [
        link.memory_id,
        'survived_unchanged',
        delta,
      ]);
      result.survived.push({
        memory_id: link.memory_id,
        symbol_id: link.symbol_id,
        old_trust: link.trust_score,
        new_trust: newTrust,
      });
    } else {
      result.unchanged.push({ memory_id: link.memory_id, symbol_id: link.symbol_id });
    }
  }

  return result;
}

/* ── symbol-aware recall ─────────────────────────────────── */

function symbolCluster(args) {
  return searchService.symbolCluster({ sqlJson, jsonErrNoExit }, args);
}

function related(args) {
  return searchService.related({ sqlJson, jsonErrNoExit }, args);
}

/* ── deduplication ───────────────────────────────────────── */

function checkDuplicate(title, type, project, topicKey) {
  return dedupService.checkDuplicate({ sqlJson }, title, type, project, topicKey);
}

function markDuplicate(args) {
  return dedupService.markDuplicate({ sqlJson, sqlRun, softDeleteObservation }, args);
}

/* ── auto session recovery ──────────────────────────────── */

function autoRecoverInternal(sessionId) {
  const session = sqlJson('SELECT * FROM session_log WHERE id = ?', [parseInt(sessionId)]);
  if (session.length === 0) {
    return null;
  }

  const obs = sqlJson(
    `
    SELECT id, title, type, content, created_at
    FROM observations
    WHERE session_id = ? AND deleted_at IS NULL AND type NOT IN ('skill', 'session_summary', 'progress', 'accomplished')
    ORDER BY created_at ASC
  `,
    [sessionId],
  );

  // If no valuable observations, just close the session silently
  // (skip noise types: skill, session_summary, progress, accomplished)
  if (obs.length === 0) {
    sqlRun("UPDATE session_log SET ended_at = datetime('now') WHERE id = ?", [parseInt(sessionId)]);
    return null;
  }

  const types = {};
  for (const o of obs) {
    if (!types[o.type]) {
      types[o.type] = [];
    }
    types[o.type].push(o.title);
  }

  const lines = ['## Auto-Recovered Session Summary', ''];
  lines.push(`**Session:** ${sessionId}`);
  lines.push(`**Started:** ${session[0].started_at}`);
  lines.push(`**Observations:** ${obs.length}`);
  lines.push('');
  for (const [type, titles] of Object.entries(types)) {
    lines.push(`### ${type}`);
    for (const t of titles) {
      lines.push(`- ${  t}`);
    }
    lines.push('');
  }
  const summary = lines.join('\n');

  sqlJson(
    `
    INSERT INTO observations (session_id, type, title, content, project, scope)
    VALUES (?, 'session_summary', 'Auto-Recovered Session Summary', ?, ?, 'project')
    RETURNING id
  `,
    [sessionId, summary, session[0].project],
  );

  sqlRun("UPDATE session_log SET ended_at = datetime('now') WHERE id = ?", [parseInt(sessionId)]);

  return {
    status: 'recovered',
    observations_processed: obs.length,
    types: Object.fromEntries(Object.entries(types).map(([k, v]) => [k, v.length])),
  };
}

function autoRecover(args) {
  const sessionId = args.session;
  if (!sessionId) {
    return jsonErrNoExit('Missing --session');
  }
  const result = autoRecoverInternal(sessionId);
  if (!result) {
    return { status: 'nothing_to_recover' };
  }
  return result;
}

function recoverOrphans() {
  const orphans = sqlJson('SELECT id, project FROM session_log WHERE ended_at IS NULL ORDER BY started_at DESC');
  if (orphans.length === 0) {
    return { recovered: [], total: 0 };
  }

  const recovered = [];
  const allObservations = [];
  for (const o of orphans) {
    const r = autoRecoverInternal(String(o.id));
    if (r) {
      recovered.push(o.project);
      allObservations.push(r.observations_processed);
    }
  }

  // If multiple orphans were recovered, consolidate into a single summary
  // Instead of leaving N individual session_summary observations
  if (recovered.length > 1) {
    // Collect all auto-recovered session_summary observations created just now
    const recentSummaries = sqlJson(
      `SELECT id, content FROM observations
       WHERE type = 'session_summary'
       AND title = 'Auto-Recovered Session Summary'
        AND created_at > datetime('now', '-${TIME_WINDOWS.RECOVERY_RECENT_MINUTES} minutes')
       AND deleted_at IS NULL
       ORDER BY id ASC`,
    );

    if (recentSummaries.length > 1) {
      // Build a single consolidated summary
      const lines = ['## Consolidated Recovery Summary', ''];
      lines.push(`**Sessions recovered:** ${recentSummaries.length}`);
      lines.push(`**Total observations:** ${allObservations.reduce((a, b) => a + b, 0)}`);
      lines.push('');

      const projects = [...new Set(recovered)];
      lines.push(`**Projects:** ${projects.join(', ')}`);
      lines.push('');

      // Soft-delete the individual summaries
      for (const s of recentSummaries) {
        softDeleteObservation(s.id);
      }

      // Insert the consolidated summary
      const consolidatedContent = lines.join('\n');
      sqlJson(
        `INSERT INTO observations (session_id, type, title, content, project, scope)
         VALUES (?, 'session_summary', 'Consolidated Recovery Summary', ?, ?, 'project')
         RETURNING id`,
        [recentSummaries[0].id, consolidatedContent, orphans[0].project],
      );
    }
  }

  return { recovered, total: orphans.length };
}

/* ── procedural memory ────────────────────────────────────── */

function saveWorkflow(args) {
  const id = args.id;
  const name = args.name;
  const project = args.project || null;
  const stepsRaw = args.steps || null;
  if (!id || !name) {
    return jsonErrNoExit('Missing --id and --name');
  }

  sqlRun('INSERT OR IGNORE INTO procedural_memory (id, name, project) VALUES (?, ?, ?)', [id, name, project]);

  if (stepsRaw) {
    const steps = stepsRaw
      .split(/\\n|\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    let stepNum = 1;
    for (const cmd of steps) {
      sqlRun(
        'INSERT OR REPLACE INTO procedural_steps (workflow, step_num, command, success, attempts) VALUES (?, ?, ?, 1.0, 1)',
        [id, stepNum, cmd],
      );
      stepNum++;
    }
  }
  return { ok: true, stepsSaved: stepsRaw ? stepsRaw.split(/\\n|\n/).filter(Boolean).length : 0 };
}

function recordStep(args) {
  const workflow = args.workflow;
  const step = parseInt(args.step);
  const command = args.command;
  if (!workflow || isNaN(step) || !command) {
    return jsonErrNoExit('Missing --workflow, --step, --command');
  }
  sqlRun(
    'INSERT OR REPLACE INTO procedural_steps (workflow, step_num, command, success, attempts) VALUES (?, ?, ?, 1.0, 1)',
    [workflow, step, command],
  );
  return { ok: true };
}

function stepOutcome(args) {
  const workflow = args.workflow;
  const step = parseInt(args.step);
  const success = args.success === 'true';
  const workaround = args.workaround || null;
  if (!workflow || isNaN(step)) {
    return jsonErrNoExit('Missing --workflow and --step');
  }

  if (success) {
    sqlRun(
      `UPDATE procedural_steps SET success = MIN(1.0, success + ${TRUST_DELTA.STEP_SUCCESS}), attempts = attempts + 1 WHERE workflow = ? AND step_num = ?`,
      [workflow, step],
    );
  } else {
    sqlRun(
      `UPDATE procedural_steps SET success = MAX(0.0, success - ${Math.abs(TRUST_DELTA.STEP_FAILURE)}), attempts = attempts + 1, fail_workaround = ? WHERE workflow = ? AND step_num = ?`,
      [workaround || null, workflow, step],
    );
  }
  const updated = sqlJson(
    'SELECT success, attempts, fail_workaround FROM procedural_steps WHERE workflow = ? AND step_num = ?',
    [workflow, step],
  );
  return updated.length > 0 ? { ok: true, ...updated[0] } : { ok: true };
}

function getWorkflow(args) {
  const id = args.id;
  if (!id) {
    return jsonErrNoExit('Missing --id');
  }
  const meta = sqlJson('SELECT * FROM procedural_memory WHERE id = ? LIMIT 1', [id]);
  if (meta.length === 0) {
    return { error: 'Workflow not found' };
  }
  const steps = sqlJson('SELECT * FROM procedural_steps WHERE workflow = ? ORDER BY step_num', [id]);
  return { ...meta[0], steps };
}

/* ── compaction & dream — delegated to dreamService ────────── */
// runCompact, compact, trustRecovery are imported as pure delegations above.
// dream() needs softDeleteObservation injected:
function dream() {
  return dreamService.dream({ sqlJson, sqlRun, softDeleteObservation });
}

/* ── init ─────────────────────────────────────────────────── */
function initDb() {
  // EnsureDb() is called from the main dispatch block, so the DB is already initialized
  ensureDb();
  return { ok: true, db: DB_PATH, engine: getEngine() };
}

/* ═══════════════════════════════════════════════════════════
   CODE INDEXING — delegated to codeIndexingService
   ═══════════════════════════════════════════════════════════ */

const codeAnalysis = require('./code-analysis');
const gitAnalysis = require('./git-analysis');
const docIndexer = require('./doc-indexer');
const responseMeta = require('./response-meta');
const wireFormat = require('./wire-format');
const astPatterns = require('./ast-patterns');

// Internal DB fields that are meaningless to the LLM consumer — stripped from compact output
const _STRIP_FIELDS = ['symbol_id', 'id'];

async function indexRepoInternal(repoPath, repoName) {
  return codeIndexingService.indexRepoInternal({ db: getDb(), args }, repoPath, repoName);
}

async function reindexRepoInternal(repo, mode) {
  return codeIndexingService.reindexRepoInternal({ db: getDb(), args }, repo, mode);
}

function _emitProgress(phase, detail, stats) {
  codeIndexingService._emitProgress(args, phase, detail, stats);
}

/** Fallback search using LIKE when FTS5 is unavailable */
function searchCodeLike(query, repoName, kind, maxResults) {
  const likeQuery = `%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
  let sql = `
    SELECT
      s.id, r.name AS repo, s.file_path AS file,
      s.name AS symbol_name, s.kind, s.start_line, s.end_line,
      s.signature, s.docstring, s.body_preview AS snippet,
      s.qualified_name, s.language,
      0.0 AS score
    FROM code_symbols s
    JOIN code_repos r ON r.id = s.repo_id
    WHERE s.name LIKE ?
  `;
  const params = [likeQuery];

  if (repoName) {
    sql += ' AND r.name = ?';
    params.push(repoName);
  }
  if (kind) {
    sql += ' AND s.kind = ?';
    params.push(kind);
  }

  sql += ' LIMIT ?';
  params.push(maxResults);

  const rows = sqlJson(sql, params);
  return {
    results: rows.map((row, i) => ({
      rank: i + 1,
      score: row.score,
      repo: row.repo,
      file: row.file,
      symbol: row.symbol_name,
      kind: row.kind,
      line: row.start_line,
      end_line: row.end_line,
      signature: row.signature,
      docstring: row.docstring,
      snippet: row.snippet,
      qualified_name: row.qualified_name,
      language: row.language,
    })),
  };
}

function searchCode(query, repoName, kind, maxResults) {
  ensureDb();

  // Ensure FTS table exists (may fail silently on some SQLite builds)
  try {
    const ftsCheck = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='code_symbols_fts'");
    if (!ftsCheck.length) {
      // Try to create the FTS virtual table
      try {
        sqlRaw(`CREATE VIRTUAL TABLE IF NOT EXISTS code_symbols_fts USING fts5(
          name, kind, signature, docstring, file_path, body_preview, content=code_symbols, content_rowid=id)`);
      } catch (_) {
        // FTS5 not available — fall back to LIKE-based search
        return searchCodeLike(query, repoName, kind, maxResults);
      }
    }
  } catch (_) {
    return searchCodeLike(query, repoName, kind, maxResults);
  }

  const ftsQuery = query.replace(/"/g, "''").split(/\s+/).join(' OR ');

  let sql = `
    SELECT
      s.id, r.name AS repo, s.file_path AS file,
      s.name AS symbol_name, s.kind, s.start_line, s.end_line,
      s.signature, s.docstring, s.body_preview AS snippet,
      s.qualified_name, s.language,
      bm25(code_symbols_fts) AS score
    FROM code_symbols_fts
    JOIN code_symbols s ON s.id = code_symbols_fts.rowid
    JOIN code_repos r ON r.id = s.repo_id
    WHERE code_symbols_fts MATCH ?
  `;
  const params = [ftsQuery];

  if (repoName) {
    sql += ' AND r.name = ?';
    params.push(repoName);
  }
  if (kind) {
    sql += ' AND s.kind = ?';
    params.push(kind);
  }

  sql += ' ORDER BY bm25(code_symbols_fts) LIMIT ?';
  params.push(maxResults);

  const rows = sqlJson(sql, params);
  const results = rows.map((row, i) => ({
    rank: i + 1,
    score: row.score,
    repo: row.repo,
    file: row.file,
    symbol: row.symbol_name,
    kind: row.kind,
    line: row.start_line,
    end_line: row.end_line,
    signature: row.signature,
    docstring: row.docstring,
    snippet: row.snippet,
    language: row.language,
  }));

  return { query, results, total: results.length };
}

function getCodeSource(repoName, filePath, symbolName) {
  ensureDb();
  const rows = sqlJson(
    `SELECT s.*, f.content
     FROM code_symbols s
     JOIN code_files f ON f.id = s.file_id
     JOIN code_repos r ON r.id = s.repo_id
     WHERE r.name = ? AND s.file_path = ? AND s.name = ?`,
    [repoName, filePath, symbolName],
  );
  if (rows.length === 0) {
    return { success: false, error: 'Symbol not found' };
  }

  const row = rows[0];
  // Use Buffer for byte-accurate slicing (Python reports byte offsets,
  // But JS string operations use UTF-16 code units which differ for
  // Multi-byte Unicode characters like box-drawing ──)
  const buf = Buffer.from(row.content, 'utf-8');
  const source = buf.toString('utf-8', row.start_byte, row.end_byte);
  return {
    success: true,
    repo: repoName,
    file: filePath,
    symbol: row.name,
    kind: row.kind,
    start_line: row.start_line,
    end_line: row.end_line,
    source,
  };
}

function listCodeReposInternal() {
  ensureDb();
  const repos = sqlJson(
    'SELECT name, path, file_count, symbol_count, indexed_at, updated_at FROM code_repos ORDER BY updated_at DESC',
  );
  return { repos, total: repos.length };
}

function removeCodeRepoInternal(repo) {
  ensureDb();
  const existing = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repo]);
  if (existing.length === 0) {
    return { error: `Repo not found: ${repo}` };
  }
  sqlRun('DELETE FROM code_repos WHERE id = ?', [existing[0].id]);
  return { success: true, repo, removed: true };
}

/* ── workspace management (v4) ────────────────────────────── */

function listWorkspaces() {
  ensureDb();
  const workspaces = sqlJson(`
    SELECT w.id, w.name, w.created_at, w.archived_at,
           COUNT(CASE WHEN o.deleted_at IS NULL AND o.type != 'skill' THEN 1 END) as memory_count,
           MAX(o.created_at) as last_active
    FROM workspaces w
    LEFT JOIN observations o ON o.project = w.name
    GROUP BY w.id
    ORDER BY w.archived_at NULLS FIRST, last_active DESC
  `);
  return { workspaces, total: workspaces.length };
}

function createWorkspace(name) {
  if (!name) {
    return { error: 'Missing --name' };
  }
  ensureDb();
  try {
    sqlRun('INSERT INTO workspaces (name) VALUES (?)', [name]);
    const row = sqlJson('SELECT id, name, created_at FROM workspaces WHERE name = ?', [name]);
    return { success: true, workspace: row[0] };
  } catch (e) {
    return { error: `Workspace already exists: ${name}` };
  }
}

function archiveWorkspace(name) {
  if (!name) {
    return { error: 'Missing --name' };
  }
  ensureDb();
  const existing = sqlJson('SELECT id FROM workspaces WHERE name = ? AND archived_at IS NULL', [name]);
  if (existing.length === 0) {
    return { error: `Workspace not found or already archived: ${name}` };
  }
  sqlRun("UPDATE workspaces SET archived_at = datetime('now') WHERE id = ?", [existing[0].id]);
  return { success: true, workspace: name, archived: true };
}

/* ── dispatch helpers ─────────────────────────────────────── */

/** Per-command usage strings shown when --repo or other required args are missing. */
const _USAGE = {
  'import-graph': '--repo X [--file F] [--direction imports|importers|both] [--depth N]',
  'call-hierarchy': '--symbol S --repo X [--direction callers|callees] [--depth N]',
  'blast-radius': '--symbol S --repo X [--depth N]',
  'dead-code': '--repo X [--min-confidence 0.5] [--include-tests true]',
  complexity: '--repo X [--symbol S | --file F]',
  churn: '--repo X [--file F] [--days 90] [--refresh]',
  hotspots: '--repo X [--top N] [--days N]',
  cycles: '--repo X',
  importance: '--repo X [--top N] [--scope dir/]',
  coupling: '--repo X [--file F] [--sort-by instability|afferent|efferent]',
  extractable: '--repo X [--min-complexity N] [--min-callers N] [--top N]',
  hierarchy: '--repo X --symbol S [--direction both|ancestors|descendants]',
  'signal-chains': '--repo X [--kind http|cli] [--symbol S] [--max-depth N]',
  'layer-violations': '--repo X [--rules JSON]',
  winnow: '--repo X [--kind K] [--min-complexity N] [--top N] ...',
  'ast-patterns': '--repo X [--category C] [--pattern P] [--limit N]',
  provenance: '--repo X --symbol S',
  untested: '--repo X [--min-confidence 0.5] [--include-private]',
  'pr-risk': '--repo X [--branch B] [--base B]',
  'doc-orphans': '--repo X [--include-same-doc]',
  'stale-pages': '--repo X',
  'doc-duplicates': '--repo X',
  'reindex-docs': '--repo X [--mode full|incremental] [--ignore GLOB]',
  'doc-search': '--query Q --repo X [--level N] [--role TYPE]',
  'doc-outline': '--repo X [--file F]',
  backlinks: '--repo X --path F',
  'broken-links': '--repo X',
  glossary: '--repo X [--term T]',
  'tutorial-path': '--section S --repo X',
  'code-examples': '--query Q --repo X [--lang X]',
};

/**
 * _dispatch(cmd, repoName, fn) — DRY repo lookup for code analysis subcommands.
 * Resolves repo name → repoRow (with id, path, head_commit), calls fn(repoRow).
 * Returns fn's result or returns an error object via jsonErrNoExit if repo not found.
 */
function _dispatch(cmd, repoName, fn) {
  if (!repoName) {
    return jsonErrNoExit(`Missing --repo. Usage: ${cmd} ${_USAGE[cmd] || ''}`);
  }
  const repoRow = sqlJson('SELECT id, path, head_commit FROM code_repos WHERE name = ?', [repoName]);
  if (!repoRow.length) {
    return jsonErrNoExit(`Repo "${repoName}" not found. Run index-repo first.`);
  }
  return fn(repoRow[0]);
}

function _dispatchDoc(cmd, repoName, fn) {
  if (!repoName) {
    return jsonErrNoExit(`Missing --repo. Usage: ${cmd} ${_USAGE[cmd] || ''}`);
  }
  const repoRow = sqlJson('SELECT id FROM doc_repos WHERE name = ?', [repoName]);
  if (!repoRow.length) {
    return jsonErrNoExit(`Doc repo "${repoName}" not found. Run index-docs first.`);
  }
  return fn(repoRow[0]);
}

/**
 * _wrapAnalysis(toolName, data, repoRow, startTime, format) — wrap analysis result
 * with _meta envelope and optional format conversion.
 */
function _wrapAnalysis(toolName, data, repoRow, startTime, format) {
  // Map CLI subcommand names to internal tool names for confidence/computed
  const toolMap = {
    'import-graph': 'getImportGraph',
    'call-hierarchy': 'getCallHierarchy',
    'blast-radius': 'getBlastRadius',
    'dead-code': 'getDeadCode',
    complexity: 'getComplexity',
    outline: 'getFileOutline',
    churn: 'getChurn',
    hotspots: 'getHotspots',
    cycles: 'getDependencyCycles',
    importance: 'getSymbolImportance',
    coupling: 'getCouplingMetrics',
    extractable: 'getExtractionCandidates',
    hierarchy: 'getClassHierarchy',
    'signal-chains': 'getSignalChains',
    'layer-violations': 'getLayerViolations',
    winnow: 'winnow',
    'ast-patterns': 'astPatterns',
    provenance: 'getProvenance',
    untested: 'getUntestedSymbols',
    'pr-risk': 'getPrRiskProfile',
  };
  const internalName = toolMap[toolName] || toolName;

  const wrapped = responseMeta.buildEnvelope({
    toolName: internalName,
    data,
    db: getDb(),
    repoId: repoRow.id,
    repoPath: repoRow.path,
    storedHeadCommit: repoRow.head_commit || null,
    startTime,
  });

  if (format === 'compact') {
    wrapped.data = wireFormat.compactResponse(wrapped.data, { stripFields: _STRIP_FIELDS });
  } else if (format === 'auto') {
    const autoFmt = wireFormat.autoFormat(wrapped.data);
    if (autoFmt === 'compact') {
      wrapped.data = wireFormat.compactResponse(wrapped.data, { stripFields: _STRIP_FIELDS });
    }
  }
  // Format === 'json' (default) — no transformation

  return wrapped;
}

/* ── dispatch ─────────────────────────────────────────────── */
const commands = {
  'session-start': sessionStart,
  'session-end': sessionEnd,
  save,
  search,
  context,
  get,
  update,
  delete: del,
  timeline,
  'suggest-topic-key': suggestTopicKey,
  'save-prompt': savePrompt,
  'capture-passive': capturePassive,
  stats: getStats,
  'session-summary': sessionSummary,
  'link-symbol': linkSymbol,
  'auto-link': autoLink,
  'adjust-trust': adjustTrust,
  'record-recall': recordRecall,
  'trust-recovery': trustRecovery,
  'stale-links': staleLinks,
  'sync-code-trust': syncCodeTrust,
  'list-projects': listProjects,
  // ── v4 workspace commands ──
  'list-workspaces': () => listWorkspaces(),
  'create-workspace': (args) => createWorkspace(args.name),
  'archive-workspace': (args) => archiveWorkspace(args.name),
  'symbol-cluster': symbolCluster,
  related,
  'check-dup': (args) => checkDuplicate(args.title, args.type, args.project, args['topic-key']),
  'mark-dup': markDuplicate,
  'auto-recover': autoRecover,
  'save-workflow': saveWorkflow,
  'record-step': recordStep,
  'step-outcome': stepOutcome,
  'get-workflow': getWorkflow,
  'recover-orphans': recoverOrphans,
  init: initDb,
  compact,
  dream,
  // ── v3 code indexing commands ──
  'index-repo': (args) => {
    const repoPath = args.path;
    if (!repoPath) {
      return jsonErrNoExit('Usage: index-repo --path <path> [--name NAME]');
    }
    const repoName = args.name || path.basename(repoPath);
    return indexRepoInternal(repoPath, repoName);
  },
  'reindex-repo': (args) => {
    const repo = args.repo;
    if (!repo) {
      return jsonErrNoExit('Usage: reindex-repo --repo <repo-name> [--mode full|incremental]');
    }
    return reindexRepoInternal(repo, args.mode || 'incremental');
  },
  'search-code': (args) => {
    const query = args.query;
    if (!query) {
      return jsonErrNoExit(
        'Usage: search-code --query <text> [--repo NAME] [--kind TYPE] [--max-results N]',
      );
    }
    return searchCode(query, args.repo || null, args.kind || null, parseInt(args['max-results'] || '20', 10));
  },
  'get-code-source': (args) => {
    const repo = args.repo;
    const file = args.file;
    const name = args.name;
    if (!repo || !file || !name) {
      return jsonErrNoExit('Usage: get-code-source --repo NAME --file PATH --name SYMBOL');
    }
    return getCodeSource(repo, file, name);
  },
  'list-code-repos': () => listCodeReposInternal(),
  'remove-code-repo': (args) => {
    const repo = args.repo;
    if (!repo) {
      return jsonErrNoExit('Usage: remove-code-repo --repo <repo-name>');
    }
    return removeCodeRepoInternal(repo);
  },

  // ── v5: Code analysis subcommands ──

  'import-graph': (args) =>
    _dispatch('import-graph', args.repo, (r) =>
      codeAnalysis.getImportGraph(getDb(), r.id, {
        file: args.file || null,
        direction: args.direction || 'both',
        depth: parseInt(args.depth || '1'),
      }),
    ),

  'call-hierarchy': (args) => {
    if (!args.symbol) {
      return jsonErrNoExit('Missing --symbol. Usage: call-hierarchy --symbol S --repo X');
    }
    return _dispatch('call-hierarchy', args.repo, (r) =>
      codeAnalysis.getCallHierarchy(getDb(), r.id, {
        symbol: args.symbol,
        direction: args.direction || 'callers',
        depth: parseInt(args.depth || '3'),
      }),
    );
  },

  'blast-radius': (args) => {
    if (!args.symbol) {
      return jsonErrNoExit('Missing --symbol. Usage: blast-radius --symbol S --repo X');
    }
    return _dispatch('blast-radius', args.repo, (r) =>
      codeAnalysis.getBlastRadius(getDb(), r.id, {
        symbol: args.symbol,
        depth: parseInt(args.depth || '3'),
      }),
    );
  },

  'dead-code': (args) =>
    _dispatch('dead-code', args.repo, (r) =>
      codeAnalysis.getDeadCode(getDb(), r.id, {
        minConfidence: parseFloat(args['min-confidence'] || '0.5'),
        includeTests: args['include-tests'] === 'true',
      }),
    ),

  complexity: (args) =>
    _dispatch('complexity', args.repo, (r) => {
      const symbolId = args.symbol
        ? (sqlJson('SELECT id FROM code_symbols WHERE repo_id = ? AND name = ?', [r.id, args.symbol])[0]?.id ?? null)
        : null;
      return codeAnalysis.getComplexity(getDb(), r.id, symbolId);
    }),

  outline: (args) => {
    if (!args.file) {
      return jsonErrNoExit('Missing --file. Usage: outline --file F --repo X');
    }
    return _dispatch('outline', args.repo, (r) => codeAnalysis.getFileOutline(getDb(), r.id, args.file));
  },

  churn: (args) =>
    _dispatch('churn', args.repo, (r) =>
      gitAnalysis.getChurn(getDb(), r.id, args.file || '__all__', parseInt(args.days || '90'), args.refresh === 'true'),
    ),

  hotspots: (args) =>
    _dispatch('hotspots', args.repo, (r) =>
      codeAnalysis.getHotspots(getDb(), r.id, {
        top: args.top ? parseInt(args.top) : 20,
        days: args.days ? parseInt(args.days) : 90,
      }),
    ),

  cycles: (args) => _dispatch('cycles', args.repo, (r) => codeAnalysis.getDependencyCycles(getDb(), r.id)),

  importance: (args) =>
    _dispatch('importance', args.repo, (r) =>
      codeAnalysis.getSymbolImportance(getDb(), r.id, {
        top: args.top ? parseInt(args.top) : 20,
        scope: args.scope || null,
      }),
    ),

  coupling: (args) =>
    _dispatch('coupling', args.repo, (r) =>
      codeAnalysis.getCouplingMetrics(getDb(), r.id, {
        file: args.file || null,
        minCa: args['min-ca'] ? parseInt(args['min-ca']) : 0,
        sortBy: args['sort-by'] || 'instability',
      }),
    ),

  extractable: (args) =>
    _dispatch('extractable', args.repo, (r) =>
      codeAnalysis.getExtractionCandidates(getDb(), r.id, {
        minComplexity: args['min-complexity'] ? parseInt(args['min-complexity']) : 5,
        minCallers: args['min-callers'] ? parseInt(args['min-callers']) : 2,
        top: args.top ? parseInt(args.top) : 20,
      }),
    ),

  hierarchy: (args) =>
    _dispatch('hierarchy', args.repo, (r) =>
      codeAnalysis.getClassHierarchy(getDb(), r.id, {
        class: args.class,
        symbol: args.symbol,
        direction: args.direction || 'both',
      }),
    ),

  'signal-chains': (args) =>
    _dispatch('signal-chains', args.repo, (r) =>
      codeAnalysis.getSignalChains(getDb(), r.id, {
        kind: args.kind || null,
        symbol: args.symbol || null,
        maxDepth: args['max-depth'] ? parseInt(args['max-depth']) : 5,
      }),
    ),

  'layer-violations': (args) => {
    let rules = null;
    if (args.rules) {
      try {
        rules = JSON.parse(args.rules);
      } catch (e) {
        return jsonErrNoExit(`Invalid rules JSON: ${e.message}`);
      }
    }
    return _dispatch('layer-violations', args.repo, (r) => codeAnalysis.getLayerViolations(getDb(), r.id, { rules }));
  },

  // ── v6: Winnow multi-axis query ──

  winnow: (args) =>
    _dispatch('winnow', args.repo, (repoRow) =>
      codeAnalysis.winnow(getDb(), repoRow.id, {
        kind: args.kind || null,
        minComplexity: args['min-complexity'] ? parseInt(args['min-complexity']) : null,
        minChurn: args['min-churn'] ? parseInt(args['min-churn']) : null,
        minPageRank: args['min-pagerank'] ? parseFloat(args['min-pagerank']) : null,
        minCallers: args['min-callers'] ? parseInt(args['min-callers']) : null,
        fileGlob: args['file-glob'] || null,
        nameRegex: args['name-regex'] || null,
        sortBy: args['sort-by'] || 'pagerank',
        top: args.top ? parseInt(args.top) : 20,
      }),
    ),

  // ── v6: AST pattern matching ──

  'ast-patterns': (args) =>
    _dispatch('ast-patterns', args.repo, (repoRow) =>
      astPatterns.scanAstPatterns(getDb(), repoRow.id, {
        category: args.category || 'all',
        patterns: args.pattern ? args.pattern.split(',').map((s) => s.trim()) : [],
        limit: args.limit ? parseInt(args.limit) : 200,
      }),
    ),

  // ── v6: Symbol provenance ──

  provenance: (args) =>
    _dispatch('provenance', args.repo, (repoRow) => gitAnalysis.getProvenance(getDb(), repoRow.id, args.symbol)),

  // ── v6: Untested symbols + PR risk ──

  untested: (args) =>
    _dispatch('untested', args.repo, (repoRow) =>
      codeAnalysis.getUntestedSymbols(getDb(), repoRow.id, {
        minConfidence: args['min-confidence'] ? parseFloat(args['min-confidence']) : 0.5,
        includePrivate: args['include-private'] === 'true',
      }),
    ),

  'pr-risk': (args) =>
    _dispatch('pr-risk', args.repo, (repoRow) =>
      codeAnalysis.getPrRiskProfile(getDb(), repoRow.id, {
        branch: args.branch || 'HEAD',
        base: args.base || 'main',
      }),
    ),

  // ── v5.2: Doc analytics subcommands ──

  'doc-orphans': (args) =>
    _dispatchDoc('doc-orphans', args.repo, (r) =>
      docIndexer.getOrphanSections(getDb(), r.id, {
        includeSameDoc: args['include-same-doc'] === 'true',
      }),
    ),

  'doc-coverage': (args) => {
    const codeRepo = args.repo;
    const docRepo = args['doc-repo'] || codeRepo;
    if (!codeRepo) {
      return jsonErrNoExit('Missing --repo');
    }
    const codeRepoRow = sqlJson('SELECT id FROM code_repos WHERE name = ?', [codeRepo]);
    if (!codeRepoRow.length) {
      return jsonErrNoExit(`Code repo "${codeRepo}" not found. Run index-repo first.`);
    }
    const docRepoRow = sqlJson('SELECT id FROM doc_repos WHERE name = ?', [docRepo]);
    if (!docRepoRow.length) {
      return jsonErrNoExit(`Doc repo "${docRepo}" not found. Run index-docs first.`);
    }
    return docIndexer.getDocCoverage(getDb(), codeRepoRow[0].id, docRepoRow[0].id);
  },

  'stale-pages': (args) => _dispatchDoc('stale-pages', args.repo, (r) => docIndexer.getStalePages(getDb(), r.id)),

  'doc-duplicates': (args) =>
    _dispatchDoc('doc-duplicates', args.repo, (r) => docIndexer.getDuplicateSections(getDb(), r.id)),

  // ── v5: Doc indexing subcommands ──

  'index-docs': async (args) => {
    const docPath = args.path;
    const name = args.name;
    if (!docPath || !name) {
      return jsonErrNoExit('Usage: index-docs --path P --name X [--ignore GLOB]');
    }
    return docIndexer.indexDocs(getDb(), path.resolve(docPath), name, args.ignore || null);
  },

  'reindex-docs': async (args) =>
    _dispatchDoc('reindex-docs', args.repo, async (r) =>
      docIndexer.reindexDocs(getDb(), r.id, args.mode || 'full', args.ignore || null),
    ),

  'doc-search': (args) => {
    if (!args.query) {
      return jsonErrNoExit('Missing --query. Usage: doc-search --query Q --repo X');
    }
    return _dispatchDoc('doc-search', args.repo, (r) =>
      docIndexer.searchDocs(getDb(), r.id, args.query, {
        level: args.level ? parseInt(args.level) : null,
        role: args.role || null,
      }),
    );
  },

  'doc-outline': (args) =>
    _dispatchDoc('doc-outline', args.repo, (r) => docIndexer.getDocOutline(getDb(), r.id, args.file || null)),

  backlinks: (args) => {
    if (!args.path) {
      return jsonErrNoExit('Missing --path. Usage: backlinks --repo X --path F');
    }
    return _dispatchDoc('backlinks', args.repo, (r) => docIndexer.getBacklinks(getDb(), r.id, args.path));
  },

  'broken-links': (args) =>
    _dispatchDoc('broken-links', args.repo, (r) => ({ broken_links: docIndexer.getBrokenLinks(getDb(), r.id) })),

  glossary: (args) => _dispatchDoc('glossary', args.repo, (r) => docIndexer.lookupTerm(getDb(), r.id, args.term || null)),

  'tutorial-path': (args) => {
    if (!args.section) {
      return jsonErrNoExit('Missing --section. Usage: tutorial-path --section S --repo X');
    }
    return _dispatchDoc('tutorial-path', args.repo, (r) =>
      docIndexer.getTutorialPath(getDb(), r.id, parseInt(args.section)),
    );
  },

  'code-examples': (args) => {
    if (!args.query) {
      return jsonErrNoExit('Missing --query. Usage: code-examples --query Q --repo X');
    }
    return _dispatchDoc('code-examples', args.repo, (r) =>
      docIndexer.findCodeExamples(getDb(), r.id, args.query, args.lang || null),
    );
  },
};

const args = parseArgs(process.argv);
const cmd = process.argv[2];

// Code analysis tools that receive _meta envelope + format support
const _ANALYSIS_TOOLS = new Set([
  'import-graph',
  'call-hierarchy',
  'blast-radius',
  'dead-code',
  'complexity',
  'outline',
  'churn',
  'hotspots',
  'cycles',
  'importance',
  'coupling',
  'extractable',
  'hierarchy',
  'signal-chains',
  'layer-violations',
  'winnow',
  'ast-patterns',
  'provenance',
  'untested',
  'pr-risk',
]);

(async () => {
  ensureDb();
  const db = getDb();
  const format = args.format || 'json';

  if (cmd && commands[cmd]) {
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let result;
    try {
      result = await commands[cmd](args);
    } catch (e) {
      if (e instanceof MemoryError) {
        process.stderr.write(`${JSON.stringify({ error: e.message })}\n`);
        process.exit(1);
      }
      throw e;
    }

    if (result && result.error) {
      process.stderr.write(`${JSON.stringify(result)}\n`);
      process.exit(1);
    }

    // Wrap code analysis results with _meta envelope
    if (_ANALYSIS_TOOLS.has(cmd) && !result.error) {
      const repoName = args.repo;
      if (repoName) {
        const repoRow = sqlJson('SELECT id, path, head_commit FROM code_repos WHERE name = ?', [repoName]);
        if (repoRow.length > 0) {
          jsonOut(_wrapAnalysis(cmd, result, repoRow[0], startTime, format));
          return;
        }
        // For tools querying churn (which has a different repo resolution),
        // Still try to wrap but fall through gracefully
      }
    }

    jsonOut(result);
  } else {
    console.error(
      `Usage: memory-store <subcommand> [--option value ...]\n` +
        `Subcommands: ${Object.keys(commands).join(', ')}`,
    );
    process.exit(1);
  }
})();
