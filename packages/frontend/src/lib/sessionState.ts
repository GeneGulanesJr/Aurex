const PREFIX = "aurex_session_";

export function setSessionState<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // sessionStorage unavailable (e.g. incognito overflow) — non-critical
  }
}

export function getSessionState<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearSessionState(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // non-critical
  }
}
