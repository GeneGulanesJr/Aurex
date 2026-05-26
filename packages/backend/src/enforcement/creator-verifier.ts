// packages/backend/src/enforcement/creator-verifier.ts
import type { AgentSessionRecord, AgentType } from "@aurex/shared";

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

export function verifyCreatorSession(
  sessionId: string,
  expectedType: AgentType,
  sessions: AgentSessionRecord[],
): VerificationResult {
  if (sessionId === "human") {
    return { valid: true, reason: "human is a known non-session actor — exempt from Creator-Verifier session checks" };
  }

  const session = sessions.find((s) => s.sessionId === sessionId);

  if (!session) {
    return { valid: false, reason: `Session ${sessionId} is not registered in agent_sessions` };
  }

  if (session.agentType !== expectedType) {
    return { valid: false, reason: `Session ${sessionId} type mismatch: expected ${expectedType}, found ${session.agentType}` };
  }

  if (session.terminatedAt) {
    return { valid: false, reason: `Session ${sessionId} was terminated at ${session.terminatedAt}` };
  }

  return { valid: true };
}
