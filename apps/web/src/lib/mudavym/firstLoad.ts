/**
 * True the first time it is asked for a key in a browser session, false after.
 * A flourish that should happen once (the greeting inking in) asks here. When
 * session storage is unavailable (a private window, blocked site data) it
 * falls back to a per-page-load flag, so the flourish still never repeats
 * inside one load.
 */
const seen = new Set<string>();

export function firstLoadThisSession(key: string): boolean {
  const name = `mdv:first:${key}`;
  if (seen.has(name)) return false;
  seen.add(name);
  try {
    if (window.sessionStorage.getItem(name)) return false;
    window.sessionStorage.setItem(name, '1');
  } catch {
    /* storage unavailable: the in-memory flag above is the whole answer */
  }
  return true;
}

/** Test seam: forget what was seen, so a spec can ask again. */
export function resetFirstLoad(): void {
  seen.clear();
}
