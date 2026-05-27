function createAurexRepository(deps) {
  const { sqlJson, sqlRun } = deps;

  const repository = {
    // --- Missions ---
    createMission({ id, description, status, configJson }) {
      sqlRun(
        'INSERT INTO missions (id, description, status, config_json) VALUES (?, ?, ?, ?)',
        [id, description, status || 'planning', typeof configJson === 'string' ? configJson : JSON.stringify(configJson || {})],
      );
      return sqlJson('SELECT * FROM missions WHERE id = ?', [id]);
    },
    getMission(id) {
      return sqlJson('SELECT * FROM missions WHERE id = ?', [id]);
    },
    updateMissionStatus(id, status) {
      sqlRun('UPDATE missions SET status = ? WHERE id = ?', [status, id]);
    },

    // --- Milestones ---
    createMilestone({ id, missionId, title, description, orderIndex, status }) {
      sqlRun(
        'INSERT INTO milestones (id, mission_id, title, description, order_index, status) VALUES (?, ?, ?, ?, ?, ?)',
        [id, missionId, title, description || '', orderIndex || 0, status || 'planned'],
      );
      return sqlJson('SELECT * FROM milestones WHERE id = ?', [id]);
    },
    getMilestone(id) {
      return sqlJson('SELECT * FROM milestones WHERE id = ?', [id]);
    },
    updateMilestoneStatus(id, status) {
      sqlRun('UPDATE milestones SET status = ? WHERE id = ?', [status, id]);
    },

    // --- Working Units ---
    createWorkingUnit({ id, milestoneId, description, declaredPaths, declaredModules, status, taskBranch, worktreePath, sessionId }) {
      sqlRun(
        'INSERT INTO working_units (id, milestone_id, description, declared_paths, declared_modules, status, task_branch, worktree_path, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, milestoneId, description || '', JSON.stringify(declaredPaths || []), JSON.stringify(declaredModules || []), status || 'spawned', taskBranch || '', worktreePath || '', sessionId || null],
      );
      return sqlJson('SELECT * FROM working_units WHERE id = ?', [id]);
    },
    getWorkingUnit(id) {
      return sqlJson('SELECT * FROM working_units WHERE id = ?', [id]);
    },
    getWorkingUnitsForMilestone(milestoneId) {
      return sqlJson('SELECT * FROM working_units WHERE milestone_id = ?', [milestoneId]);
    },
    updateWorkingUnitStatus(id, status) {
      sqlRun('UPDATE working_units SET status = ? WHERE id = ?', [status, id]);
    },

    // --- Validation Contracts ---
    createContract({ id, milestoneId, version, content, supersedes }) {
      sqlRun(
        'INSERT INTO validation_contracts (id, milestone_id, version, content, supersedes) VALUES (?, ?, ?, ?, ?)',
        [id, milestoneId, version || 1, typeof content === 'string' ? content : JSON.stringify(content || {}), supersedes || null],
      );
      return sqlJson('SELECT * FROM validation_contracts WHERE id = ?', [id]);
    },
    supersedeContract({ oldId, newId, milestoneId, newContract, rescopeEvent }) {
      const existing = sqlJson('SELECT version, milestone_id FROM validation_contracts WHERE id = ?', [oldId]);
      const version = (existing.length > 0 ? existing[0].version : 0) + 1;
      const mid = milestoneId || (existing.length > 0 ? existing[0].milestone_id : null);
      sqlRun(
        'INSERT INTO validation_contracts (id, milestone_id, version, content, supersedes) VALUES (?, ?, ?, ?, ?)',
        [newId, mid, version, typeof newContract === 'string' ? newContract : JSON.stringify(newContract || {}), oldId],
      );
      sqlRun('UPDATE validation_contracts SET superseded_by = ? WHERE id = ?', [newId, oldId]);
      if (rescopeEvent) {
        sqlRun(
          'INSERT INTO rescope_events (id, milestone_id, contract_id, reason, previous_scope, new_scope) VALUES (?, ?, ?, ?, ?, ?)',
          [rescopeEvent.id || `re-${Date.now()}`, mid, oldId, rescopeEvent.reason || '', rescopeEvent.previousScope || '', rescopeEvent.newScope || ''],
        );
      }
      return sqlJson('SELECT * FROM validation_contracts WHERE id = ?', [newId]);
    },
    getContractHistory(milestoneId) {
      return sqlJson('SELECT * FROM validation_contracts WHERE milestone_id = ? ORDER BY version', [milestoneId]);
    },

    // --- Validation Verdicts ---
    createVerdict({ id, milestoneId, contractId, validatorType, sessionId, verdict, findings, failedUnitIds }) {
      sqlRun(
        'INSERT INTO validation_verdicts (id, milestone_id, contract_id, validator_type, session_id, verdict, findings, failed_unit_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, milestoneId, contractId, validatorType, sessionId, verdict, findings || '', JSON.stringify(failedUnitIds || [])],
      );
      return sqlJson('SELECT * FROM validation_verdicts WHERE id = ?', [id]);
    },
    classifyVerdict(id, classification) {
      sqlRun('UPDATE validation_verdicts SET classification = ? WHERE id = ?', [classification, id]);
    },
    getVerdicts(milestoneId) {
      return sqlJson('SELECT * FROM validation_verdicts WHERE milestone_id = ?', [milestoneId]);
    },

    // --- Broadcasts ---
    createBroadcast({ id, missionId, authorId, authorType, category, title, content, status, ttl, expiresAt }) {
      sqlRun(
        'INSERT INTO broadcasts (id, mission_id, author_id, author_type, category, title, content, status, ttl, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, missionId, authorId, authorType, category || 'info', title || '', content || '', status || 'active', ttl ?? null, expiresAt || null],
      );
      return sqlJson('SELECT * FROM broadcasts WHERE id = ?', [id]);
    },
    transitionBroadcast(id, newStatus) {
      sqlRun('UPDATE broadcasts SET status = ? WHERE id = ?', [newStatus, id]);
      return sqlJson('SELECT * FROM broadcasts WHERE id = ?', [id]);
    },
    getBroadcasts(missionId, statusFilter) {
      if (statusFilter && statusFilter.length > 0) {
        const placeholders = statusFilter.map(() => '?').join(',');
        return sqlJson(`SELECT * FROM broadcasts WHERE mission_id = ? AND status IN (${placeholders})`, [missionId, ...statusFilter]);
      }
      return sqlJson('SELECT * FROM broadcasts WHERE mission_id = ?', [missionId]);
    },

    // --- Research Findings ---
    createFinding({ id, missionId, authorId, domain, title, content, relevance, status, ttl, expiresAt }) {
      sqlRun(
        'INSERT INTO research_findings (id, mission_id, author_id, domain, title, content, relevance, status, ttl, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, missionId, authorId, JSON.stringify(domain || []), title || '', content || '', relevance || 'medium', status || 'unverified', ttl ?? null, expiresAt || null],
      );
      return sqlJson('SELECT * FROM research_findings WHERE id = ?', [id]);
    },
    transitionFinding(id, newStatus) {
      sqlRun('UPDATE research_findings SET status = ? WHERE id = ?', [newStatus, id]);
      return sqlJson('SELECT * FROM research_findings WHERE id = ?', [id]);
    },
    getFindings(missionId, status) {
      if (status) {
        return sqlJson('SELECT * FROM research_findings WHERE mission_id = ? AND status = ?', [missionId, status]);
      }
      return sqlJson('SELECT * FROM research_findings WHERE mission_id = ?', [missionId]);
    },

    // --- Agent Sessions ---
    registerSession({ sessionId, agentType, missionId, milestoneId, unitId }) {
      sqlRun(
        'INSERT INTO agent_sessions (session_id, agent_type, mission_id, milestone_id, unit_id) VALUES (?, ?, ?, ?, ?)',
        [sessionId, agentType, missionId, milestoneId || null, unitId || null],
      );
    },
    getSessionsForMilestone(milestoneId) {
      return sqlJson('SELECT * FROM agent_sessions WHERE milestone_id = ?', [milestoneId]);
    },

    // --- Cost Tracking ---
    logCost({ id, missionId, agentSessionId, model, promptTokens, completionTokens, cost, timestamp }) {
      sqlRun(
        'INSERT INTO cost_entries (id, mission_id, agent_session_id, model, prompt_tokens, completion_tokens, cost, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, missionId, agentSessionId, model, promptTokens || 0, completionTokens || 0, cost || 0, timestamp || new Date().toISOString()],
      );
    },
    getMissionCost(missionId) {
      const rows = sqlJson('SELECT SUM(cost) as totalCost, SUM(prompt_tokens + completion_tokens) as totalTokens, COUNT(*) as entries FROM cost_entries WHERE mission_id = ?', [missionId]);
      if (rows.length === 0) return { totalCost: 0, totalTokens: 0, entries: 0 };
      return {
        totalCost: rows[0].totalCost || 0,
        totalTokens: rows[0].totalTokens || 0,
        entries: rows[0].entries || 0,
      };
    },

    // --- Retry / Rescope ---
    incrementRetry(milestoneId) {
      sqlRun('UPDATE milestones SET retries = retries + 1 WHERE id = ?', [milestoneId]);
      const rows = sqlJson('SELECT retries, rescopes FROM milestones WHERE id = ?', [milestoneId]);
      return rows.length > 0 ? rows[0] : { milestoneId, retries: 0, rescopes: 0 };
    },
    logRescope(milestoneId, event) {
      sqlRun('UPDATE milestones SET rescopes = rescopes + 1 WHERE id = ?', [milestoneId]);
      sqlRun(
        'INSERT INTO rescope_events (id, milestone_id, contract_id, reason, previous_scope, new_scope) VALUES (?, ?, ?, ?, ?, ?)',
        [`re-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, milestoneId, event.contractId || '', event.reason || '', event.previousScope || '', event.newScope || ''],
      );
    },

    // --- Checkpoints ---
    createCheckpoint({ id, missionId, trigger, milestoneId, summary }) {
      sqlRun(
        'INSERT INTO checkpoints (id, mission_id, trigger, milestone_id, summary) VALUES (?, ?, ?, ?, ?)',
        [id, missionId, trigger, milestoneId, summary],
      );
      return sqlJson('SELECT * FROM checkpoints WHERE id = ?', [id]);
    },
    getCheckpoint(id) {
      return sqlJson('SELECT * FROM checkpoints WHERE id = ?', [id]);
    },
    resolveCheckpoint(id, decision, guidance, reason) {
      const existing = sqlJson('SELECT * FROM checkpoints WHERE id = ?', [id]);
      if (existing.length > 0 && existing[0].status === 'resolved') {
        return existing;
      }
      sqlRun(
        "UPDATE checkpoints SET status = 'resolved', decision = ?, guidance = ?, reason = ?, resolved_at = datetime('now') WHERE id = ?",
        [decision, guidance || null, reason || null, id],
      );
      return sqlJson('SELECT * FROM checkpoints WHERE id = ?', [id]);
    },
    getPendingCheckpoints(missionId) {
      return sqlJson("SELECT * FROM checkpoints WHERE mission_id = ? AND status = 'pending'", [missionId]);
    },

    // --- Mission listing ---
    listMissions(status) {
      if (status) {
        return sqlJson('SELECT * FROM missions WHERE status = ?', [status]);
      }
      return sqlJson('SELECT * FROM missions');
    },
  };

  return Object.freeze(repository);
}

module.exports = { createAurexRepository };
