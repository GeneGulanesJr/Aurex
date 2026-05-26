import { v4 as uuid } from 'uuid';
import type {
  Mission,
  Milestone,
  WorkingUnit,
  Handoff,
  ValidationContract,
  MissionConfig,
} from '@aurex/shared';
import { getDb } from '../db.js';
import { computeOverlap } from './overlap.js';
import { createNegotiator, type NegotiatorInput } from './negotiator.js';
import type { PiProcessManager } from '../spawn/pi-process-manager.js';
import type { RouterClient } from '../clients/router-client.js';
import type { LaPisClient } from '../clients/lapis-client.js';
import { emitEvent } from '../events.js';

export interface CheckpointHandle {
  resolve: (decision: string) => void;
}

export class MilestoneLoop {
  private checkpoints = new Map<string, CheckpointHandle>();

  constructor(
    private piManager: PiProcessManager,
    private router: RouterClient,
    private lapis: LaPisClient,
  ) {}

  resolveCheckpoint(missionId: string, decision: string): boolean {
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

    const negotiator = createNegotiator(this.router, this.lapis);

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
        const success = await this.runMilestone(
          mission, milestone, config, negotiator,
        );

        if (!success) {
          db.prepare(`UPDATE missions SET status = 'failed', completed_at = datetime('now') WHERE id = ?`)
            .run(mission.id);

          emitEvent({
            type: 'mission_failed',
            missionId: mission.id,
            timestamp: new Date().toISOString(),
            data: { reason: `Milestone "${milestone.title}" failed` },
          });
          return;
        }
      }

      db.prepare(`UPDATE missions SET status = 'complete', completed_at = datetime('now') WHERE id = ?`)
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
      db.prepare(`UPDATE missions SET status = 'failed', completed_at = datetime('now') WHERE id = ?`)
        .run(mission.id);

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
  ): Promise<boolean> {
    const db = getDb();

    db.prepare(`UPDATE milestones SET status = 'in_progress' WHERE id = ?`).run(milestone.id);

    emitEvent({
      type: 'milestone_started',
      missionId: mission.id,
      milestoneId: milestone.id,
      timestamp: new Date().toISOString(),
      data: { seq: milestone.seq, title: milestone.title, workingUnitCount: 0 },
    });

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
      db.prepare(`UPDATE milestones SET status = 'failed', completed_at = datetime('now') WHERE id = ?`)
        .run(milestone.id);

      emitEvent({
        type: 'milestone_failed',
        missionId: mission.id,
        milestoneId: milestone.id,
        timestamp: new Date().toISOString(),
        data: { seq: milestone.seq, title: milestone.title, reason: 'No completed handoffs' },
      });

      return false;
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

    const retryCount = (db.prepare(
      `SELECT SUM(attempt_count) as total FROM retry_counters WHERE mission_id = ? AND milestone_id = ?`,
    ).get(mission.id, milestone.id) as { total: number | null })?.total || 0;

    const rescopeCount = (db.prepare(
      `SELECT COUNT(*) as cnt FROM rescope_history WHERE mission_id = ? AND milestone_id = ?`,
    ).get(mission.id, milestone.id) as { cnt: number })?.cnt || 0;

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
        db.prepare(`UPDATE milestones SET status = 'passed', completed_at = datetime('now') WHERE id = ?`)
          .run(milestone.id);

        emitEvent({
          type: 'milestone_completed',
          missionId: mission.id,
          milestoneId: milestone.id,
          timestamp: new Date().toISOString(),
          data: { seq: milestone.seq, title: milestone.title },
        });
        return true;

      case 'retry':
        if (retryCount >= config.maxRetryCount) {
          emitEvent({
            type: 'checkpoint_required',
            missionId: mission.id,
            milestoneId: milestone.id,
            timestamp: new Date().toISOString(),
            data: {
              milestoneId: milestone.id,
              trigger: 'rescope_limit' as const,
              milestoneTitle: milestone.title,
              validationContracts: contracts,
              handoffs: completedHandoffs,
              validatorFindings: [],
              retryCount,
              rescopeCount,
            },
          });

          await this.waitForCheckpoint(mission.id);
          return true;
        }
        return await this.runMilestone(mission, milestone, config, negotiator);

      case 'rescope':
        if (rescopeCount >= config.maxRescopeCount) {
          emitEvent({
            type: 'checkpoint_required',
            missionId: mission.id,
            milestoneId: milestone.id,
            timestamp: new Date().toISOString(),
            data: {
              milestoneId: milestone.id,
              trigger: 'rescope_limit' as const,
              milestoneTitle: milestone.title,
              validationContracts: contracts,
              handoffs: completedHandoffs,
              validatorFindings: [],
              retryCount,
              rescopeCount,
            },
          });

          await this.waitForCheckpoint(mission.id);
          return true;
        }

        db.prepare(`UPDATE milestones SET status = 'rescoped' WHERE id = ?`).run(milestone.id);
        return await this.runMilestone(mission, milestone, config, negotiator);

      case 'escalate':
        emitEvent({
          type: 'checkpoint_required',
          missionId: mission.id,
          milestoneId: milestone.id,
          timestamp: new Date().toISOString(),
          data: {
            milestoneId: milestone.id,
            trigger: 'unclassifiable_error' as const,
            milestoneTitle: milestone.title,
            validationContracts: contracts,
            handoffs: completedHandoffs,
            validatorFindings: [],
            retryCount,
            rescopeCount,
          },
        });

        await this.waitForCheckpoint(mission.id);
        return true;

      default:
        return false;
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
        `UPDATE working_units SET status = 'rejected' WHERE id = ?`,
      ).run(unit.id);

      db.prepare(
        `INSERT INTO broadcasts (id, mission_id, milestone_id, source_worker_id, content, category, lifecycle) VALUES (?, ?, ?, ?, ?, 'warning', 'active')`,
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

  private waitForCheckpoint(missionId: string): Promise<string> {
    return new Promise((resolve) => {
      this.checkpoints.set(missionId, { resolve });
    });
  }
}
