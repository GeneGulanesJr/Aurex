import { state } from '../state';

export async function ensureNativeModules(): Promise<void> {
  if (state.nativeChecked) {
    return;
  }
  state.nativeChecked = true;

  // LaPis uses @libsql/client via the async adapter in db.js. npm installs the
  // needed package graph, so there is no LaPis-specific rebuild step here.
  require.resolve('@libsql/client');
}
