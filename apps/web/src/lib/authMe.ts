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
 * Only reads that are in flight are shared. A read that has settled is never
 * reused, so sign-in, house switches and retries always ask the gateway.
 */

let inFlight: Promise<unknown> | null = null;

export function shareMeRead<T>(read: () => Promise<T>): Promise<T> {
  if (inFlight) return inFlight as Promise<T>;
  const started = read();
  inFlight = started;
  const clear = () => {
    if (inFlight === started) inFlight = null;
  };
  started.then(clear, clear);
  return started;
}

/** Test seam: forget any read in flight. */
export function forgetSharedMeRead(): void {
  inFlight = null;
}

/** How long to wait, in whole seconds, before asking again. */
export const BUSY_RETRY_DEFAULT_SECONDS = 3;
const BUSY_RETRY_MAX_SECONDS = 60;

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

/** The gateway's `Retry-After` in seconds (1 to 60), else the default. */
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
