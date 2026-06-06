const locks = new Map<string, Promise<void>>();

export async function acquireQuotaLock(providerId: string): Promise<() => void> {
  while (locks.has(providerId)) {
    await locks.get(providerId);
  }
  let release: () => void;
  const p = new Promise<void>((resolve) => { release = resolve; });
  locks.set(providerId, p);
  return () => {
    locks.delete(providerId);
    release!();
  };
}
