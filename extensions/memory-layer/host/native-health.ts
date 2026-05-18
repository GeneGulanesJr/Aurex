import { state } from '../state';
import path from 'node:path';
import { execSync } from 'node:child_process';

function getLapisRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export async function ensureNativeModules(): Promise<void> {
  if (state.nativeChecked) {
    return;
  }
  state.nativeChecked = true;

  try {
    require.resolve('@libsql/client');
    return;
  } catch {}

  const lapisRoot = getLapisRoot();
  console.log(`[memory-layer] Installing dependencies in ${lapisRoot}...`);
  try {
    execSync('npm install --ignore-scripts', {
      cwd: lapisRoot,
      stdio: 'pipe',
      timeout: 120_000,
    });
    console.log('[memory-layer] Dependencies installed successfully.');
  } catch (e: any) {
    console.error(`[memory-layer] Auto-install failed: ${e.message}`);
    console.warn(`[memory-layer] Please run manually: cd ${lapisRoot} && npm install`);
  }
}
