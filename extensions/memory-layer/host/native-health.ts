import { state } from '../state';
import path from 'node:path';
import fs from 'node:fs';

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
    if (parent === dir) {break;}
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
  console.warn(
    `[memory-layer] Missing @libsql/client. LaPis will not install dependencies at runtime. ` +
      `Run manually: cd ${lapisRoot} && npm install`,
  );
}
