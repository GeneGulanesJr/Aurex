export type CommandRunEntry = { command: string; exitCode: number };

export function validateCommandsRunEntries(
  commandsRun: unknown,
): { ok: true; entries: CommandRunEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(commandsRun) || commandsRun.length === 0) {
    return { ok: false, error: "commandsRun must contain at least one command" };
  }

  const entries: CommandRunEntry[] = [];
  for (let i = 0; i < commandsRun.length; i++) {
    const entry = commandsRun[i];
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: `commandsRun[${i}] must be an object with command and exitCode` };
    }
    const { command, exitCode } = entry as Record<string, unknown>;
    if (typeof command !== "string" || command.trim().length === 0) {
      return { ok: false, error: `commandsRun[${i}].command must be a non-empty string` };
    }
    if (typeof exitCode !== "number" || !Number.isFinite(exitCode)) {
      return { ok: false, error: `commandsRun[${i}].exitCode must be a finite number` };
    }
    entries.push({ command, exitCode });
  }

  return { ok: true, entries };
}

export function parseCommandsRunJson(
  raw: string,
): { ok: true; entries: CommandRunEntry[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "commandsRun must be valid JSON array of {command, exitCode} objects" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "commandsRun must be a JSON array of {command, exitCode} objects" };
  }
  return validateCommandsRunEntries(parsed);
}
