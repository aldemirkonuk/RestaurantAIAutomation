/**
 * When the boot read of `/auth/me` fails without saying "signed out" (r20,
 * 2026-11-13).
 *
 * AuthProvider reads `/auth/me` once per page load. A 401 means the token is
 * dead, and ADR 0344 handles that. Anything else that is temporary (a rate
 * limit, a gateway error, a dropped connection, a timeout) says "ask again
 * later", not "you are not signed in". Before this, those failures ended the
 * load with no person, so ProtectedRoute sent a signed-in owner to /login on
 * about the sixth reload in a minute.
 *
 * Now AuthProvider stays loading and asks again after `sessionReadRetryDelayMs`.
 * Other statuses (403, 404, other 4xx) are not temporary, and asking again
 * would not change them, so they end the load as before.
 */

/** The longest wait between two reads, whatever the server says. */
export const SESSION_READ_MAX_DELAY_MS = 60_000;
/** The backoff ceiling when the server gives no Retry-After. */
export const SESSION_READ_BACKOFF_CAP_MS = 30_000;
const BACKOFF_BASE_MS = 1_000;
/** Added to a Retry-After so the read lands after the window resets. */
const RETRY_AFTER_MARGIN_MS = 250;

interface FailedRead {
  response?: {
    status?: number;
    headers?: Record<string, unknown> | { get?: (name: string) => unknown };
    data?: unknown;
  };
}

function statusOf(err: unknown): number | undefined {
  return (err as FailedRead | null)?.response?.status;
}

/**
 * True when the read failed in a way that does not say who the person is:
 * no response at all, 408, 429 or any 5xx.
 */
export function isTransientSessionReadFailure(err: unknown): boolean {
  const response = (err as FailedRead | null)?.response;
  if (!response) return true;
  const status = response.status;
  if (typeof status !== "number") return true;
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function headerOf(err: unknown, name: string): unknown {
  const headers = (err as FailedRead | null)?.response?.headers;
  if (!headers) return undefined;
  const getter = (headers as { get?: (n: string) => unknown }).get;
  if (typeof getter === "function") {
    const viaGet = getter.call(headers, name);
    if (viaGet !== undefined && viaGet !== null) return viaGet;
  }
  return (headers as Record<string, unknown>)[name];
}

/**
 * Seconds to wait, from a `Retry-After` header (seconds or an HTTP date) or
 * the gateway's `retryAfter` body field. The header is not always readable
 * across origins, so the body is the fallback. Undefined when neither parses.
 */
export function retryAfterSeconds(
  err: unknown,
  now: number = Date.now(),
): number | undefined {
  const raw = headerOf(err, "retry-after");
  if (typeof raw === "string" || typeof raw === "number") {
    const text = String(raw).trim();
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
    const at = Date.parse(text);
    if (!Number.isNaN(at)) return Math.max(0, (at - now) / 1000);
  }
  const body = (err as FailedRead | null)?.response?.data as
    | { retryAfter?: unknown }
    | undefined;
  const fromBody = body?.retryAfter;
  if (
    typeof fromBody === "number" &&
    Number.isFinite(fromBody) &&
    fromBody >= 0
  ) {
    return fromBody;
  }
  return undefined;
}

/**
 * How long to wait before read number `attempt + 1` (attempt counts from 0).
 * A 429 with a Retry-After waits that long plus a small margin. Anything else
 * backs off 1 s, 2 s, 4 s … up to 30 s. Never longer than 60 s.
 */
export function sessionReadRetryDelayMs(
  err: unknown,
  attempt: number,
  now: number = Date.now(),
): number {
  if (statusOf(err) === 429) {
    const seconds = retryAfterSeconds(err, now);
    if (seconds !== undefined) {
      return Math.min(
        SESSION_READ_MAX_DELAY_MS,
        Math.ceil(seconds * 1000) + RETRY_AFTER_MARGIN_MS,
      );
    }
  }
  const step = Math.max(0, Math.floor(attempt));
  return Math.min(SESSION_READ_BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** step);
}
