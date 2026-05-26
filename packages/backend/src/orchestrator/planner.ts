import { v4 as uuid } from 'uuid';
import type {
  Mission,
  Milestone,
  WorkingUnit,
  ValidationContract,
  PlannedMilestone,
  MissionConfig,
} from '@aurex/shared';
import { getDb } from '../db.js';
import type { LaPisClient, MemoryResult } from '../clients/lapis-client.js';
import type { RouterClient } from '../clients/router-client.js';
import type { AppConfig } from '../config.js';

export interface PlanResult {
  mission: Mission;
  milestones: Milestone[];
  workingUnits: WorkingUnit[];
  relevantMemories: MemoryResult[];
}

export function createPlanner(
  lapis: LaPisClient,
  router: RouterClient,
  config: AppConfig,
) {
  async function plan(missionDescription: string): Promise<PlanResult> {
    const db = getDb();

    let relevantMemories: MemoryResult[] = [];
    try {
      relevantMemories = await lapis.searchMemory(missionDescription, {
        includeCode: true,
      });
    } catch {
      // memory search is best-effort
    }

    const planResponse = await router.planningCall(missionDescription, {
      missionDescription,
      relevantMemories,
    });

    if (planResponse.milestones.length > config.defaultConfig.maxMilestoneCount) {
      throw new Error(
        `Plan has ${planResponse.milestones.length} milestones, max is ${config.defaultConfig.maxMilestoneCount}`,
      );
    }

    const missionId = uuid();
    const missionConfig: MissionConfig = { ...config.defaultConfig };

    const insertMission = db.prepare(`
      INSERT INTO missions (id, description, status, plan_json, config_json)
      VALUES (?, ?, 'running', ?, ?)
    `);

    const insertMilestone = db.prepare(`
      INSERT INTO milestones (id, mission_id, seq, title, description, status, validation_contracts_json)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `);

    const insertWorkingUnit = db.prepare(`
      INSERT INTO working_units (id, milestone_id, mission_id, title, description, task_spec_json, file_paths_json, modules_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    const insertCost = db.prepare(`
      INSERT INTO cost_entries (id, mission_id, role, model, input_tokens, output_tokens, estimated_cost_usd)
      VALUES (?, ?, 'planner', ?, ?, ?, 0)
    `);

    const transaction = db.transaction(() => {
      insertMission.run(
        missionId,
        missionDescription,
        JSON.stringify(planResponse),
        JSON.stringify(missionConfig),
      );

      const milestones: Milestone[] = [];
      const workingUnits: WorkingUnit[] = [];

      for (let i = 0; i < planResponse.milestones.length; i++) {
        const planned = planResponse.milestones[i];
        const milestoneId = uuid();
        const contracts: ValidationContract[] = planned.validationContracts || [];

        insertMilestone.run(
          milestoneId,
          missionId,
          i,
          planned.title,
          planned.description,
          JSON.stringify(contracts),
        );

        milestones.push({
          id: milestoneId,
          missionId,
          seq: i,
          title: planned.title,
          description: planned.description,
          status: 'pending',
          validationContractsJson: JSON.stringify(contracts),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
        });

        for (const plannedUnit of planned.workingUnits || []) {
          const unitId = uuid();
          insertWorkingUnit.run(
            unitId,
            milestoneId,
            missionId,
            plannedUnit.title,
            plannedUnit.description,
            plannedUnit.taskSpec || plannedUnit.description,
            JSON.stringify(plannedUnit.filePaths || []),
            JSON.stringify(plannedUnit.modules || []),
          );

          workingUnits.push({
            id: unitId,
            milestoneId,
            missionId,
            title: plannedUnit.title,
            description: plannedUnit.description,
            taskSpecJson: plannedUnit.taskSpec || plannedUnit.description,
            filePathsJson: JSON.stringify(plannedUnit.filePaths || []),
            modulesJson: JSON.stringify(plannedUnit.modules || []),
            status: 'pending',
            piPid: null,
            startedAt: null,
            completedAt: null,
            createdAt: new Date().toISOString(),
          });
        }
      }

      insertCost.run(
        uuid(),
        missionId,
        planResponse.modelUsed,
        planResponse.tokensUsed.input,
        planResponse.tokensUsed.output,
      );

      return { milestones, workingUnits };
    });

    const { milestones, workingUnits } = transaction();

    const mission: Mission = {
      id: missionId,
      description: missionDescription,
      status: 'running',
      planJson: JSON.stringify(planResponse),
      configJson: JSON.stringify(missionConfig),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };

    try {
      await lapis.saveMemory({
        type: 'mission_plan',
        title: `Mission: ${missionDescription.slice(0, 80)}`,
        content: JSON.stringify({
          missionId,
          description: missionDescription,
          milestoneCount: milestones.length,
          reasoning: planResponse.reasoning,
        }),
      });
    } catch {
      // memory save is best-effort
    }

    return { mission, milestones, workingUnits, relevantMemories };
  }

  return { plan };
}
