import { state } from '../state';

export async function ensureNativeModules(): Promise<void> {
  if (state.nativeChecked) {
    return;
  }
  state.nativeChecked = true;

  try {
    require.resolve('@libsql/client');
  } catch {
    console.warn('[memory-layer] @libsql/client not found — run `cd <lapis-dir> && npm install` to install dependencies.');
  }
}
