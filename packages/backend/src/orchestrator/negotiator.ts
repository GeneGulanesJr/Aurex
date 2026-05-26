import { v4 as uuid } from 'uuid';
import type {
  NegotiatorVerdict,
  NegotiatorDecision,
  Handoff,
  ValidationContract,
} from '@aurex/shared';
import { getDb } from '../db.js';
import type { RouterClient } from '../clients/router-client.js';

export interface NegotiatorInput {
  missionId: string;
  milestoneId: string;
  milestoneTitle: string;
  milestoneDescription: string;
  validationContracts: ValidationContract[];
  handoffs: Handoff[];
  validatorFindings: string[];
  retryCount: number;
  rescopeCount: number;
  maxRetryCount: number;
  maxRescopeCount: number;
}

export interface NegotiatorOutput {
  decision: NegotiatorDecision;
}

export function createNegotiator(
  router: RouterClient,
) {
  async function negotiate(input: NegotiatorInput): Promise<NegotiatorOutput> {
    const db = getDb();

    const prompt = `Milestone: ${input.milestoneTitle}
Description: ${input.milestoneDescription}

Validation Contracts:
${input.validationContracts.map((c, i) => `${i + 1}. ${c.description} (${c.acceptanceCriteria.join(', ')})`).join('\n')}

Worker Handoffs:
${input.handoffs.map(h => `- [${h.status}] ${h.summary}\n  Rationale: ${h.rationale}\n  Files: ${h.filesModifiedJson}`).join('\n')}

Validator Findings:
${input.validatorFindings.map(f => `- ${f}`).join('\n')}

Current retry count: ${input.retryCount}/${input.maxRetryCount}
Current rescope count: ${input.rescopeCount}/${input.maxRescopeCount}

Decide the next action.`;

    const response = await router.negotiationCall(prompt, {
      missionDescription: input.milestoneDescription,
      previousFailures: input.validatorFindings,
    });

    const decision: NegotiatorDecision = {
      verdict: response.verdict,
      reasoning: response.reasoning,
      rescopedSpec: response.rescopedSpec,
      retryUnits: response.retryUnits,
    };

    const insertBroadcast = db.prepare(`
      INSERT INTO broadcasts (id, mission_id, milestone_id, content, category, lifecycle)
      VALUES (?, ?, ?, ?, 'decision', 'active')
    `);

    insertBroadcast.run(
      uuid(),
      input.missionId,
      input.milestoneId,
      `Negotiator verdict: ${decision.verdict} — ${decision.reasoning}`,
    );

    if (decision.verdict === 'rescope') {
      const insertRescope = db.prepare(`
        INSERT INTO rescope_history (id, mission_id, milestone_id, original_spec_json, revised_spec_json, reason, triggered_by)
        VALUES (?, ?, ?, ?, ?, ?, 'negotiator')
      `);

      insertRescope.run(
        uuid(),
        input.missionId,
        input.milestoneId,
        JSON.stringify(input.milestoneDescription),
        JSON.stringify(decision.rescopedSpec || ''),
        decision.reasoning,
      );
    }

    const insertCost = db.prepare(`
      INSERT INTO cost_entries (id, mission_id, milestone_id, role, model, input_tokens, output_tokens, estimated_cost_usd)
      VALUES (?, ?, ?, 'negotiator', ?, ?, ?, 0)
    `);

    insertCost.run(
      uuid(),
      input.missionId,
      input.milestoneId,
      response.modelUsed,
      response.tokensUsed.input,
      response.tokensUsed.output,
    );

    return { decision };
  }

  return { negotiate };
}
