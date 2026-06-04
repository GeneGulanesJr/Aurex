const { getConfig } = require('../../config');
const { RESULT_LIMITS, RANKING, CONTEXT } = require('../../constants');
const { TRUST_RECALL_JOINS, TYPE_PRIORITY_CASE } = require('./search');

const TOPIC_QUERY_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'what',
  'where',
  'when',
  'why',
  'how',
  'did',
  'does',
  'into',
  'instead',
  'keep',
  'answer',
  'concise',
]);

function topicQueryNeedles(query) {
  const normalized = String(query || '')
    .toLowerCase()
    .trim();
  if (!normalized) {
    return [];
  }

  const phrase = normalized.length <= 120 ? [normalized] : [];
  const terms = normalized
    .match(/[a-z0-9_.\/-]+/g)
    ?.filter((term) => term.length >= 3 && !TOPIC_QUERY_STOP_WORDS.has(term))
    .slice(0, 16);

  const needles = [...new Set([...phrase, ...(terms || [])])];
  return needles.length > 0 ? needles : [normalized.slice(0, 120)];
}

function buildTopicQueryMatch(needles) {
  const fields = ["lower(coalesce(o.topic_key, ''))", "lower(coalesce(o.title, ''))", "lower(coalesce(o.content, ''))"];
  const whereParts = [];
  const whereParams = [];
  const scoreParts = [];
  const scoreParams = [];

  for (const needle of needles) {
    const like = `%${needle.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    whereParts.push(`(${fields.map((field) => `${field} LIKE ?`).join(' OR ')})`);
    whereParams.push(...fields.map(() => like));
    for (const field of fields) {
      scoreParts.push(`CASE WHEN ${field} LIKE ? THEN 1 ELSE 0 END`);
      scoreParams.push(like);
    }
  }

  return {
    whereSql: whereParts.join(' OR '),
    scoreSql: scoreParts.length > 0 ? scoreParts.join(' + ') : '0',
    whereParams,
    scoreParams,
  };
}

function context(deps, args) {
  const { sqlJson, jsonErrNoExit } = deps;
  const insertRecallLog = deps.insertRecallLog || (() => {});
  const countObservationsByProjectAndType = deps.countObservationsByProjectAndType || (() => 0);

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

  let obsQuery, obsParams;
  if (crossProject) {
    const crossLimit = deep
      ? Math.min(limit * CONTEXT.CROSS_PROJECT_DEEP_MULTIPLIER, CONTEXT.CROSS_PROJECT_DEEP_MAX)
      : limit;
    obsQuery = `
      SELECT o.id, o.title, o.content, o.type, o.scope, o.topic_key, o.project, o.created_at,
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
    const topicLimit = deep
      ? Math.min(limit * CONTEXT.CROSS_PROJECT_DEEP_MULTIPLIER, CONTEXT.CROSS_PROJECT_DEEP_MAX)
      : limit;
    if (topicQuery) {
      const match = buildTopicQueryMatch(topicQueryNeedles(topicQuery));
      obsQuery = `
        WITH topic_matches AS (
          SELECT id, ${match.scoreSql} as match_score
          FROM observations o
          WHERE project = ? AND deleted_at IS NULL AND type != 'skill'
            AND (${match.whereSql})
          ORDER BY match_score DESC, created_at DESC
          LIMIT ?
        )
        SELECT o.id, o.title, o.content, o.type, o.scope, o.topic_key, o.created_at,
               COALESCE(sl.trust_score, ${RANKING.DEFAULT_TRUST_SCORE}) as trust_score,
               COALESCE(rl.recall_count, 0) as recall_count,
               ${TYPE_PRIORITY_CASE} as type_priority
        FROM observations o
        JOIN topic_matches tm ON o.id = tm.id
        ${TRUST_RECALL_JOINS}
        ORDER BY tm.match_score DESC, recall_count DESC, trust_score DESC, type_priority DESC, o.created_at DESC
      `;
      obsParams = [...match.scoreParams, project, ...match.whereParams, topicLimit];
    } else {
      obsQuery = `
        SELECT o.id, o.title, o.content, o.type, o.scope, o.topic_key, o.created_at,
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
      SELECT o.id, o.title, o.content, o.type, o.scope, o.topic_key, o.created_at,
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

  const excludedSet = new Set(CONTEXT.EXCLUDED_TYPES);
  const filtered = observations.filter((o) => !excludedSet.has(o.type));

  if (sessionId && filtered.length > 0) {
    const recallQuery = topicQuery || topicKey || 'context-auto';
    const entries = filtered.map((o) => ({
      memoryId: o.id,
      sessionId: String(sessionId),
      query: recallQuery,
    }));
    insertRecallLog(entries);
  }

  const totalAll = countObservationsByProjectAndType(crossProject ? null : project);

  return {
    sessions,
    personal,
    observations: filtered,
    project: project || null,
    cross_project: crossProject,
    topic: topicKey || topicQuery || null,
    stats: {
      total_memories: totalAll,
      total_personal: personal.length,
    },
  };
}

module.exports = { context };
