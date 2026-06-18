// packages/backend/src/orchestrator/smoke-check.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Per-unit smoke check for the v1 sequential milestone loop (issue #119).
 *
 * After each worker commits to the shared feature branch, this runs the
 * cheap, deterministic checks (test + typecheck + lint) in the feature
 * worktree. It is NOT a full review — a full LLM validator runs once at the
 * end of the milestone. A failing smoke check triggers a `git reset` of the
 * feature branch to the pre-unit commit and a worker retry with feedback.
 *
 * Commands are sourced from the mission/contract test commands plus the
 * optional `smokeCheckCommands` config. Unsafe commands are rejected (the
 * allowlist mirrors `integration-lifecycle.ts`). Each command is independent:
 * a typecheck failure does not prevent the lint command from also running.
 */

const ALLOWED_COMMAND_PATTERN = /^[a-zA-Z0-9_./-]+(?: [a-zA-Z0-9_./=:"-]+)*$/;

function isSafeCommand(cmd: string): boolean {
  return ALLOWED_COMMAND_PATTERN.test(cmd) && !cmd.includes("..");
}

export interface SmokeCheckInput {
  worktreePath: string;
  testCommand?: string;
  typecheckCommand?: string;
  lintCommand?: string;
  timeoutMs?: number;
}

export interface SmokeCheckResult {
  pass: boolean;
  failures: string[];
}

async function runOne(
  label: string,
  cmd: string | undefined,
  worktreePath: string,
  timeoutMs: number,
  failures: string[],
): Promise<void> {
  if (!cmd || cmd.trim().length === 0) return;
  if (!isSafeCommand(cmd)) {
    failures.push(`Smoke check '${label}' rejected unsafe command: ${cmd.slice(0, 100)}`);
    return;
  }
  try {
    await execFileAsync("bash", ["-c", cmd], {
      cwd: worktreePath,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
  } catch (err: unknown) {
    const stderr = err instanceof Error && "stderr" in err
      ? String((err as { stderr: string }).stderr).slice(0, 200)
      : "";
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`Smoke check '${label}' failed (${cmd}): ${stderr || message}`);
  }
}

export async function runSmokeCheck(input: SmokeCheckInput): Promise<SmokeCheckResult> {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const failures: string[] = [];

  await runOne("typecheck", input.typecheckCommand, input.worktreePath, timeoutMs, failures);
  await runOne("lint", input.lintCommand, input.worktreePath, timeoutMs, failures);
  await runOne("test", input.testCommand, input.worktreePath, timeoutMs, failures);

  return { pass: failures.length === 0, failures };
}
