import { v4 as uuid } from 'uuid';
import type {
  Mission,
  Milestone,
  WorkingUnit,
  Handoff,
  ValidationContract,
  MissionConfig,
  NegotiatorDecision,
  CheckpointDecision,
} from '@aurex/shared';
import { getDb } from '../db.js';
import { computeOverlap } from './overlap.js';
import { createNegotiator, type NegotiatorInput } from './negotiator.js';
import type { PiProcessManager } from '../spawn/pi-process-manager.js';
import type { RouterClient } from '../clients/router-client.js';
import type { LaPisClient } from '../clients/lapis-client.js';
import { emitEvent } from '../events.js';

export interface CheckpointHandle {
  resolve: (decision: CheckpointDecision) => void;
}

export class MilestoneLoop {
  private checkpoints = new Map<string, CheckpointHandle>();

  constructor(
    private piManager: PiProcessManager,
    private router: RouterClient,
    private lapis: LaPisClient,
  ) {}

  resolveCheckpoint(missionId: string, decision: CheckpointDecision): boolean {
    const handle = this.checkpoints.get(missionId);
    if (!handle) return false;
    handle.resolve(decision);
    this.checkpoints.delete(missionId);
    return true;
  }

  async run(mission: Mission): Promise<void> {
    const db = getDb();
    const config: MissionConfig = mission.configJson
      ? JSON.parse(mission.configJson)
      : { workerTimeoutMs: 300000, validatorTimeoutMs: 120000, researchTimeoutMs: 180000, maxRetryCount: 3, maxRescopeCount: 2, maxMilestoneCount: 10 };

    const negotiator = createNegotiator(this.router);

    const milestones = db.prepare(
      `SELECT * FROM milestones WHERE mission_id = ? ORDER BY seq`,
    ).all(mission.id) as Milestone[];

    emitEvent({
      type: 'mission_started',
      missionId: mission.id,
      timestamp: new Date().toISOString(),
      data: { description: mission.description, milestoneCount: milestones.length },
    });

    try {
      for (const milestone of milestones) {
        const result = await this.runMilestone(mission, milestone, config, negotiator);

        if (result === 'failed') {
          db.prepare(`UPDATE missions SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
            .run(mission.id);

          emitEvent({
            type: 'mission_failed',
            missionId: mission.id,
            timestamp: new Date().toISOString(),
            data: { reason: `Milestone "${milestone.title}" failed` },
          });
          return;
        }

        if (result === 'rejected') {
          db.prepare(`UPDATE missions SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
            .run(mission.id);

          emitEvent({
            type: 'mission_failed',
            missionId: mission.id,
            timestamp: new Date().toISOString(),
            data: { reason: 'Mission rejected by human' },
          });
          return;
        }
      }

      db.prepare(`UPDATE missions SET status = 'complete', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(mission.id);

      emitEvent({
        type: 'mission_completed',
        missionId: mission.id,
        timestamp: new Date().toISOString(),
        data: { totalCost: 0, durationMs: 0 },
      });

      try {
        await this.lapis.saveMemory({
          type: 'mission_summary',
          title: `Completed: ${mission.description.slice(0, 80)}`,
          content: JSON.stringify({
            missionId: mission.id,
            status: 'complete',
            milestoneCount: milestones.length,
          }),
        });
      } catch {
        // best-effort
      }
    } catch (err) {
      try {
        db.prepare(`UPDATE missions SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
          .run(mission.id);
      } catch {
        // DB may be the error cause; nothing we can do
      }

      emitEvent({
        type: 'mission_failed',
        missionId: mission.id,
        timestamp: new Date().toISOString(),
        data: { reason: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async runMilestone(
    mission: Mission,
    milestone: Milestone,
    config: MissionConfig,
    negotiator: ReturnType<typeof createNegotiator>,
  ): Promise<'passed' | 'failed' | 'rejected'> {
    const db = getDb();

    db.prepare(`UPDATE milestones SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`).run(milestone.id);

    emitEvent({
      type: 'milestone_started',
      missionId: mission.id,
      milestoneId: milestone.id,
      timestamp: new Date().toISOString(),
      data: { seq: milestone.seq, title: milestone.title, workingUnitCount: 0 },
    });

    this.resetWorkingUnitsForMilestone(milestone.id);

    const workingUnits = db.prepare(
      `SELECT * FROM working_units WHERE milestone_id = ?`,
    ).all(milestone.id) as WorkingUnit[];

    const serializationMap = computeOverlap(workingUnits);

    db.prepare(
      `INSERT INTO broadcasts (id, mission_id, milestone_id, content, category, lifecycle) VALUES (?, ?, ?, ?, 'info', 'active')`,
    ).run(
      uuid(),
      mission.id,
      milestone.id,
      `Serialization map: ${serializationMap.batches.length} batches, ${workingUnits.length} units`,
    );

    for (const batch of serializationMap.batches) {
      const batchUnits = workingUnits.filter(u => batch.unitIds.includes(u.id));

      const results = await Promise.all(
        batchUnits.map(unit =>
          this.piManager.spawnWorker(unit, config, mission.id, milestone.id),
        ),
      );

      for (let i = 0; i < batchUnits.length; i++) {
        const unit = batchUnits[i];
        const result = results[i];

        if (result.timedOut || !result.success) continue;

        await this.processHandoff(unit, result.output, mission.id, milestone.id);
      }
    }

    const completedHandoffs = db.prepare(
      `SELECT * FROM handoffs WHERE milestone_id = ? AND status != 'rejected'`,
    ).all(milestone.id) as Handoff[];

    if (completedHandoffs.length === 0) {
      db.prepare(`UPDATE milestones SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(milestone.id);

      emitEvent({
        type: 'milestone_failed',
        missionId: mission.id,
        milestoneId: milestone.id,
        timestamp: new Date().toISOString(),
        data: { seq: milestone.seq, title: milestone.title, reason: 'No completed handoffs' },
      });

      return 'failed';
    }

    emitEvent({
      type: 'validator_started',
      missionId: mission.id,
      milestoneId: milestone.id,
      timestamp: new Date().toISOString(),
      data: { validatorAId: uuid(), validatorBId: uuid() },
    });

    const contracts: ValidationContract[] = JSON.parse(milestone.validationContractsJson || '[]');
    const handoffSummaries = completedHandoffs.map(h => `Worker: ${h.summary}\nRationale: ${h.rationale}\nFiles: ${h.filesModifiedJson}`).join('\n\n');

    const [reviewResult, contractResult] = await Promise.all([
      this.piManager.spawnValidator(
        'implementation_reviewer',
        `Review the following worker handoffs for code quality and correctness:\n\n${handoffSummaries}`,
        config,
        mission.id,
        milestone.id,
      ),
      this.piManager.spawnValidator(
        'contract_checker',
        `Check if the following contracts are satisfied:\n\n${JSON.stringify(contracts, null, 2)}\n\nWorker changes:\n${handoffSummaries}`,
        config,
        mission.id,
        milestone.id,
      ),
    ]);

    const validatorFindings: string[] = [];
    if (reviewResult.success) validatorFindings.push(reviewResult.output);
    if (contractResult.success) validatorFindings.push(contractResult.output);

    const retryCount = this.getRetryCount(mission.id, milestone.id);
    const rescopeCount = this.getRescopeCount(mission.id, milestone.id);

    const negotiatorInput: NegotiatorInput = {
      missionId: mission.id,
      milestoneId: milestone.id,
      milestoneTitle: milestone.title,
      milestoneDescription: milestone.description,
      validationContracts: contracts,
      handoffs: completedHandoffs,
      validatorFindings,
      retryCount,
      rescopeCount,
      maxRetryCount: config.maxRetryCount,
      maxRescopeCount: config.maxRescopeCount,
    };

    const { decision } = await negotiator.negotiate(negotiatorInput);

    emitEvent({
      type: 'negotiator_decision',
      missionId: mission.id,
      milestoneId: milestone.id,
      timestamp: new Date().toISOString(),
      data: { verdict: decision.verdict, reasoning: decision.reasoning },
    });

    switch (decision.verdict) {
      case 'pass':
        db.prepare(`UPDATE milestones SET status = 'passed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
          .run(milestone.id);

        emitEvent({
          type: 'milestone_completed',
          missionId: mission.id,
          milestoneId: milestone.id,
          timestamp: new Date().toISOString(),
          data: { seq: milestone.seq, title: milestone.title },
        });
        return 'passed';

      case 'retry':
        if (retryCount >= config.maxRetryCount) {
          return this.handleCheckpoint(mission, milestone, contracts, completedHandoffs, retryCount, rescopeCount, 'retry_limit');
        }
        return await this.runMilestone(mission, milestone, config, negotiator);

      case 'rescope': {
        if (rescopeCount >= config.maxRescopeCount) {
          return this.handleCheckpoint(mission, milestone, contracts, completedHandoffs, retryCount, rescopeCount, 'rescope_limit');
        }

        if (decision.rescopedSpec) {
          db.prepare(`UPDATE milestones SET description = ?, status = 'pending', updated_at = datetime('now') WHERE id = ?`)
            .run(decision.rescopedSpec, milestone.id);
        }

        return await this.runMilestone(mission, milestone, config, negotiator);
      }

      case 'escalate':
        return this.handleCheckpoint(mission, milestone, contracts, completedHandoffs, retryCount, rescopeCount, 'unclassifiable_error');

      default:
        return 'failed';
    }
  }

  private resetWorkingUnitsForMilestone(milestoneId: string): void {
    const db = getDb();

    db.prepare(`DELETE FROM handoffs WHERE milestone_id = ?`).run(milestoneId);

    db.prepare(
      `UPDATE working_units SET status = 'pending', pi_pid = NULL, started_at = NULL, completed_at = NULL, updated_at = datetime('now') WHERE milestone_id = ?`,
    ).run(milestoneId);
  }

  private getRetryCount(missionId: string, milestoneId: string): number {
    const db = getDb();
    const row = db.prepare(
      `SELECT COALESCE(SUM(attempt_count), 0) as total FROM retry_counters WHERE mission_id = ? AND milestone_id = ?`,
    ).get(missionId, milestoneId) as { total: number };
    return row.total;
  }

  private getRescopeCount(missionId: string, milestoneId: string): number {
    const db = getDb();
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM rescope_history WHERE mission_id = ? AND milestone_id = ?`,
    ).get(missionId, milestoneId) as { cnt: number };
    return row.cnt;
  }

  private async handleCheckpoint(
    mission: Mission,
    milestone: Milestone,
    contracts: ValidationContract[],
    handoffs: Handoff[],
    retryCount: number,
    rescopeCount: number,
    trigger: string,
  ): Promise<'passed' | 'failed' | 'rejected'> {
    emitEvent({
      type: 'checkpoint_required',
      missionId: mission.id,
      milestoneId: milestone.id,
      timestamp: new Date().toISOString(),
      data: {
        milestoneId: milestone.id,
        trigger,
        milestoneTitle: milestone.title,
        validationContracts: contracts,
        handoffs,
        validatorFindings: [],
        retryCount,
        rescopeCount,
      },
    });

    const decision = await this.waitForCheckpoint(mission.id);

    switch (decision) {
      case 'approve':
        return 'passed';
      case 'reject':
        return 'rejected';
      case 'override':
        return 'passed';
      default:
        return 'failed';
    }
  }

  private async processHandoff(
    unit: WorkingUnit,
    rawOutput: string,
    missionId: string,
    milestoneId: string,
  ): Promise<void> {
    const db = getDb();

    let handoff: Record<string, unknown>;
    try {
      handoff = JSON.parse(rawOutput);
    } catch {
      handoff = { workerOutput: rawOutput };
    }

    const rationale = handoff.rationale as string | undefined;
    const assumptions = handoff.assumptions as string[] | undefined;

    if (!rationale || !Array.isArray(assumptions) || assumptions.length === 0) {
      db.prepare(
        `UPDATE working_units SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`,
      ).run(unit.id);

      db.prepare(
        `INSERT INTO broadcasts (id, mission_id, milestone_id, source_working_unit_id, content, category, lifecycle) VALUES (?, ?, ?, ?, ?, 'warning', 'active')`,
      ).run(
        uuid(),
        missionId,
        milestoneId,
        unit.id,
        `Worker "${unit.title}" rejected: handoff missing rationale or assumptions`,
      );

      emitEvent({
        type: 'worker_rejected',
        missionId,
        milestoneId,
        timestamp: new Date().toISOString(),
        data: {
          workingUnitId: unit.id,
          title: unit.title,
          rejectionReason: 'Missing rationale or assumptions in handoff',
        },
      });
      return;
    }

    db.prepare(
      `INSERT INTO handoffs (id, working_unit_id, mission_id, milestone_id, worker_output, files_modified_json, rationale, assumptions_json, summary, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).run(
      uuid(),
      unit.id,
      missionId,
      milestoneId,
      rawOutput,
      JSON.stringify(handoff.filesModified || []),
      rationale,
      JSON.stringify(assumptions),
      (handoff.summary as string) || rationale.slice(0, 200),
    );
  }

  private waitForCheckpoint(missionId: string): Promise<CheckpointDecision> {
    return new Promise((resolve) => {
      this.checkpoints.set(missionId, { resolve });
    });
  }
}
