/**
 * The page-load read of `/auth/me`, asked once (onboarding, r68).
 *
 * Two modules read the signed-in person when the page loads: the auth store
 * (as soon as it is imported) and `AuthContext` (when it mounts). Each used
 * to send its own `GET /auth/me`, so one load cost two requests and the
 * gateway's per-address limit of ten a minute ran out after about four
 * reloads. Both now go through `shareMeRead`: the first caller's read is the
 * one in flight, and a caller that arrives while it is in flight gets that
 * same answer, success or failure.
 *
 * Only reads that are in flight are shared, plus the page-load read, which
 * each of the two named callers may take once within ten seconds even after
 * it settled. Any other settled read is never reused, so sign-in, house
 * switches and retries always ask the gateway.
 */

let inFlight: Promise<unknown> | null = null;

// The page-load read, kept after it settles for the other module's single
// first ask. The auth store reads as it is imported; AuthContext mounts a
// little later, and on a fast gateway the store's read has already settled
// by then, so sharing only what is in flight sent a second request (r69).
// Each named caller may take this read once, and only within a few seconds.
const PAGE_LOAD_WINDOW_MS = 10_000;
let pageLoad: { read: Promise<unknown>; at: number; taken: Set<string> } | null =
  null;

export function shareMeRead<T>(
  read: () => Promise<T>,
  who?: string,
): Promise<T> {
  if (inFlight) {
    if (who && pageLoad && inFlight === pageLoad.read) pageLoad.taken.add(who);
    return inFlight as Promise<T>;
  }
  if (
    who &&
    pageLoad &&
    !pageLoad.taken.has(who) &&
    Date.now() - pageLoad.at < PAGE_LOAD_WINDOW_MS
  ) {
    pageLoad.taken.add(who);
    return pageLoad.read as Promise<T>;
  }
  const started = read();
  inFlight = started;
  if (who && !pageLoad) {
    pageLoad = { read: started, at: Date.now(), taken: new Set([who]) };
  }
  const clear = () => {
    if (inFlight === started) inFlight = null;
  };
  started.then(clear, clear);
  return started;
}

/** Test seam: forget any read in flight. */
export function forgetSharedMeRead(): void {
  inFlight = null;
  pageLoad = null;
}

/** How long to wait, in whole seconds, before asking again. */
export const BUSY_RETRY_DEFAULT_SECONDS = 3;
const BUSY_RETRY_MAX_SECONDS = 20;
/** How many times the page asks again before it tells the person to reload. */
export const BUSY_RETRY_TRIES = 3;

/**
 * A rate-limited or unreachable gateway is "busy", not "signed out": 429, or
 * no answer at all (a dropped connection). Any other status is something
 * else and keeps its own handling.
 */
export function isHouseBusy(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null)?.response
    ?.status;
  return status === 429 || status === undefined;
}

/** The gateway's `Retry-After` in seconds (1 to 20), else the default. */
export function busyRetrySeconds(err: unknown): number {
  const headers = (
    err as { response?: { headers?: Record<string, unknown> } } | null
  )?.response?.headers;
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return BUSY_RETRY_DEFAULT_SECONDS;
  }
  return Math.min(BUSY_RETRY_MAX_SECONDS, Math.max(1, Math.ceil(seconds)));
}
