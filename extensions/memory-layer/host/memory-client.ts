import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
// oxlint-disable-next-line sort-imports
import { MEMORY_SCRIPT, MemResult, getTimeout } from '../state';

export type { MemResult };

let _inProcessDispatch: ((cmd: string, args: Record<string, string>) => Promise<MemResult | null>) | null = null;

async function getInProcessDispatch() {
  if (_inProcessDispatch) {
    return _inProcessDispatch;
  }
  try {
    const gateway = require('../../src/cli/gateway');
    if (typeof gateway.dispatch === 'function') {
      _inProcessDispatch = gateway.dispatch;
      return _inProcessDispatch;
    }
  } catch {}
  return null;
}

export async function mem(cmd: string, args: Record<string, string | number | boolean>): Promise<MemResult | null> {
  const dispatch = await getInProcessDispatch();
  if (dispatch) {
    try {
      const stringArgs: Record<string, string> = {};
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== null && v !== '') {
          stringArgs[k] = String(v);
        }
      }
      return await dispatch(cmd, stringArgs);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[memory-layer] in-process ${cmd} failed, falling back to child process:`, msg);
    }
  }
  return memViaChildProcess(cmd, args);
}

async function memViaChildProcess(
  cmd: string,
  args: Record<string, string | number | boolean>,
): Promise<MemResult | null> {
  const argList: string[] = [cmd];
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null || v === '') {
      // oxlint-disable-next-line no-continue
      continue;
    }
    argList.push(`--${k}`);
    argList.push(String(v));
  }
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const timeout = getTimeout(cmd);
      const child = execFile(
        'node',
        [MEMORY_SCRIPT, ...argList],
        {
          encoding: 'utf8',
          timeout,
          maxBuffer: 10 * 1024 * 1024,
        },
        (err, stdout) => {
          if (err) {
            reject(err);
          } else {
            resolve(stdout.trim());
          }
        },
      );
      child.on('error', reject);
    });
    return out ? JSON.parse(out) : null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('timed out')) {
      console.error(`[memory-layer] ${cmd} timed out after ${getTimeout(cmd)}ms`);
    } else {
      console.error(`[memory-layer] ${cmd} failed:`, msg);
    }
    return null;
  }
}

export async function memCmd(cmd: string): Promise<MemResult | null> {
  const dispatch = await getInProcessDispatch();
  if (dispatch) {
    try {
      return await dispatch(cmd, {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[memory-layer] in-process ${cmd} failed, falling back to child process:`, msg);
    }
  }
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const timeout = getTimeout(cmd);
      execFile(
        'node',
        [MEMORY_SCRIPT, cmd],
        {
          encoding: 'utf8',
          timeout,
          maxBuffer: 10 * 1024 * 1024,
        },
        (err, stdout) => {
          if (err) {
            reject(err);
          } else {
            resolve(stdout.trim());
          }
        },
      );
    });
    return out ? JSON.parse(out) : null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[memory-layer] ${cmd} failed:`, msg);
    return null;
  }
}

type ProgressCallback = (msg: string) => void;

export async function memStreaming(
  cmd: string,
  args: Record<string, string | number | boolean>,
  onProgress?: ProgressCallback,
): Promise<MemResult | null> {
  const dispatch = await getInProcessDispatch();
  if (dispatch) {
    try {
      const stringArgs: Record<string, string> = {};
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== null && v !== '') {
          stringArgs[k] = String(v);
        }
      }
      if (onProgress) {
        onProgress(`Running ${cmd} in-process...`);
      }
      return await dispatch(cmd, stringArgs);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[memory-layer] in-process ${cmd} streaming failed, falling back to child process:`, msg);
    }
  }
  const argList: string[] = [cmd, '--progress'];
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null || v === '') {
      // oxlint-disable-next-line no-continue
      continue;
    }
    argList.push(`--${k}`);
    argList.push(String(v));
  }
  const timeout = getTimeout(cmd);

  try {
    return await new Promise<MemResult | null>((resolve, reject) => {
      const child = spawn('node', [MEMORY_SCRIPT, ...argList], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let timer: ReturnType<typeof setTimeout> | null = null;
      const resetTimer = () => {
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          child.kill();
          reject(new Error(`${cmd} timed out after ${timeout}ms without output`));
        }, timeout + 5000);
      };
      resetTimer();

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        resetTimer();
      });

      if (onProgress) {
        const rl = createInterface({ input: child.stderr! });
        rl.on('line', (line: string) => {
          resetTimer();
          try {
            const parsed = JSON.parse(line);
            if (parsed.progress) {
              const phase = parsed.phase || '';
              const message = parsed.message || phase;
              const filesDone = parsed.files_done ?? '';
              const filesTotal = parsed.files_total ?? '';
              const symbols = parsed.symbols ?? '';
              let statusText = message;
              if (filesTotal) {
                statusText = `${message} (${filesDone}/${filesTotal} files, ${symbols} symbols)`;
              }
              onProgress(statusText);
            }
          } catch {}
        });
      }

      child.on('close', (code) => {
        if (timer) {
          clearTimeout(timer);
        }
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`${cmd} exited with code ${code}`));
          return;
        }
        try {
          const result = stdout.trim() ? JSON.parse(stdout.trim()) : null;
          resolve(result);
        } catch {
          reject(new Error(`${cmd} returned invalid JSON`));
        }
      });

      child.on('error', (err) => {
        if (timer) {
          clearTimeout(timer);
        }
        reject(err);
      });
    });
  } catch {
    return mem(cmd, args);
  }
}
