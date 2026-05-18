import { state } from '../state';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

function findLapisRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name === 'lapis') {
        return dir;
      }
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '..', '..', '..');
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

  const lapisRoot = findLapisRoot();
  console.log(`[memory-layer] Installing dependencies in ${lapisRoot}...`);
  try {
    execSync('npm install --omit=dev', {
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
