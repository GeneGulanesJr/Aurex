import type {
  PlannedMilestone,
  ValidationContract,
  NegotiatorVerdict,
} from '@aurex/shared';
import type { Milestone } from '@aurex/shared';
import type { MemoryResult } from './lapis-client.js';
import type { AppConfig } from '../config.js';

export interface RouterContext {
  missionDescription?: string;
  milestoneHistory?: MilestoneSummary[];
  relevantMemories?: MemoryResult[];
  previousFailures?: string[];
}

export interface MilestoneSummary {
  title: string;
  status: string;
}

export interface PlanningResponse {
  milestones: PlannedMilestone[];
  reasoning: string;
  modelUsed: string;
  tokensUsed: { input: number; output: number };
}

export interface ResearchResponse {
  findings: string;
  confidence: 'high' | 'medium' | 'low';
  sources: string[];
  modelUsed: string;
  tokensUsed: { input: number; output: number };
}

export interface NegotiatorResponse {
  verdict: NegotiatorVerdict;
  reasoning: string;
  rescopedSpec?: string;
  retryUnits?: string[];
  modelUsed: string;
  tokensUsed: { input: number; output: number };
}

export interface RouterClient {
  planningCall(prompt: string, context: RouterContext): Promise<PlanningResponse>;
  researchCall(prompt: string): Promise<ResearchResponse>;
  negotiationCall(prompt: string, context: RouterContext): Promise<NegotiatorResponse>;
}

export function createRouterClient(config: AppConfig): RouterClient {
  async function callModel(systemPrompt: string, userPrompt: string): Promise<{
    content: string;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  }> {
    const response = await fetch(`${config.pinyxEndpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Router call failed (${response.status}): ${body}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      content: data.choices[0]?.message?.content ?? '',
      model: data.model,
      usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
    };
  }

  function parseJsonFromResponse<T>(content: string): T {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ||
                      content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in router response');
    }
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    return JSON.parse(jsonStr) as T;
  }

  return {
    async planningCall(prompt, context) {
      const systemPrompt = `You are a mission planner for a coding orchestrator. Given a mission description, produce a structured milestone plan.

Respond with a JSON object:
{
  "milestones": [
    {
      "title": "...",
      "description": "...",
      "workingUnits": [
        {
          "title": "...",
          "description": "...",
          "taskSpec": "...",
          "filePaths": ["..."],
          "modules": ["..."]
        }
      ],
      "validationContracts": [
        {
          "id": "...",
          "description": "...",
          "acceptanceCriteria": ["..."]
        }
      ]
    }
  ],
  "reasoning": "..."
}

Rules:
- Each milestone should be independently testable
- Working units within a milestone can run in parallel if they don't touch the same files
- Every milestone needs at least one validation contract
- taskSpec should be a clear, self-contained instruction for a coding agent`;

      const contextParts: string[] = [];
      if (context.relevantMemories?.length) {
        contextParts.push('Relevant past decisions:\n' +
          context.relevantMemories.map(m => `- ${m.title}: ${m.content}`).join('\n'));
      }
      if (context.milestoneHistory?.length) {
        contextParts.push('Previous milestones:\n' +
          context.milestoneHistory.map(m => `- ${m.title} (${m.status})`).join('\n'));
      }
      if (context.previousFailures?.length) {
        contextParts.push('Previous failures:\n' +
          context.previousFailures.map(f => `- ${f}`).join('\n'));
      }

      const userPrompt = contextParts.length > 0
        ? `${contextParts.join('\n\n')}\n\nMission: ${prompt}`
        : `Mission: ${prompt}`;

      const result = await callModel(systemPrompt, userPrompt);
      const parsed = parseJsonFromResponse<{
        milestones: PlannedMilestone[];
        reasoning: string;
      }>(result.content);

      if (!parsed.milestones?.length) {
        throw new Error('Router returned no milestones');
      }

      return {
        milestones: parsed.milestones,
        reasoning: parsed.reasoning || '',
        modelUsed: result.model,
        tokensUsed: {
          input: result.usage.prompt_tokens,
          output: result.usage.completion_tokens,
        },
      };
    },

    async researchCall(prompt) {
      const systemPrompt = `You are a research assistant for a coding orchestrator. Answer the research question with findings.

Respond with JSON:
{
  "findings": "...",
  "confidence": "high|medium|low",
  "sources": ["..."]
}`;

      const result = await callModel(systemPrompt, prompt);
      const parsed = parseJsonFromResponse<{
        findings: string;
        confidence: 'high' | 'medium' | 'low';
        sources: string[];
      }>(result.content);

      return {
        findings: parsed.findings,
        confidence: parsed.confidence || 'medium',
        sources: parsed.sources || [],
        modelUsed: result.model,
        tokensUsed: {
          input: result.usage.prompt_tokens,
          output: result.usage.completion_tokens,
        },
      };
    },

    async negotiationCall(prompt, context) {
      const systemPrompt = `You are a code review negotiator. Given worker handoffs and validator verdicts, decide the next action.

Respond with JSON:
{
  "verdict": "pass|retry|rescope|escalate",
  "reasoning": "...",
  "rescopedSpec": "... (only if verdict is rescope)",
  "retryUnits": ["... (working unit IDs, only if verdict is retry)"]
}

Rules:
- "pass" if validation contracts are satisfied
- "retry" if specific working units can be re-run with clearer instructions
- "rescope" if the milestone needs to be simplified or split
- "escalate" if human judgment is required`;

      const result = await callModel(systemPrompt, prompt);
      const parsed = parseJsonFromResponse<{
        verdict: NegotiatorVerdict;
        reasoning: string;
        rescopedSpec?: string;
        retryUnits?: string[];
      }>(result.content);

      return {
        verdict: parsed.verdict,
        reasoning: parsed.reasoning || '',
        rescopedSpec: parsed.rescopedSpec,
        retryUnits: parsed.retryUnits,
        modelUsed: result.model,
        tokensUsed: {
          input: result.usage.prompt_tokens,
          output: result.usage.completion_tokens,
        },
      };
    },
  };
}
