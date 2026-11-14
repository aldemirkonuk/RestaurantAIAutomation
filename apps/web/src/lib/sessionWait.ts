/**
 * A stored session whose `/auth/me` read is refused for a reason that is not
 * "you are not who you said you were" waits and asks again. It is never sent
 * to /login (onboarding lane, 2026-11-11: a 429 on /auth/me showed /login
 * while the tokens were still on disk).
 *
 * The invariant: only a 401 that the shared refresh could not recover ends a
 * session. A rate limit (429), a server that is down or restarting (5xx,
 * 408, 425) and a dropped connection all mean "ask again later".
 */

export type SessionWaitReason = 'busy' | 'server' | 'offline';

export interface SessionWait {
  reason: SessionWaitReason;
  /** Epoch ms of the next attempt. */
  retryAt: number;
  /** 1 for the first wait. */
  attempt: number;
}

/** Back-off ladder in seconds when the gateway names no Retry-After. */
const LADDER_S = [1, 2, 4, 8, 15, 30];
/** A Retry-After longer than this is still waited, but at most this long. */
const MAX_WAIT_S = 60;

interface ErrorLike {
  isAxiosError?: boolean;
  code?: string;
  message?: string;
  request?: unknown;
  response?: {
    status?: number;
    headers?: Record<string, unknown>;
    data?: { retryAfter?: unknown } | null;
  };
}

/**
 * Added to a wait the gateway named, so the next ask lands after its window
 * has reset rather than on its last millisecond (#1249).
 */
const RETRY_AFTER_MARGIN_MS = 250;

/**
 * Why to wait, or null when the failure is not one a wait can mend (a 401 has
 * its own path, a 403 or 404 is an answer, and an error thrown by our own
 * code after a good answer is a bug, not the network).
 */
export function sessionWaitReason(err: unknown): SessionWaitReason | null {
  const e = (err ?? {}) as ErrorLike;
  const status = e.response?.status;
  if (status === 429) return 'busy';
  if (status === 408 || status === 425 || (typeof status === 'number' && status >= 500)) {
    return 'server';
  }
  if (status === undefined) {
    // A request this page cancelled is not "offline".
    if (e.code === 'ERR_CANCELED') return null;
    const network =
      e.isAxiosError === true ||
      e.code === 'ERR_NETWORK' ||
      e.code === 'ECONNABORTED' ||
      e.message === 'Network Error' ||
      e.request !== undefined;
    return network ? 'offline' : null;
  }
  return null;
}

/** Retry-After, in whole seconds, from a number of seconds or an HTTP date. */
export function retryAfterSeconds(
  header: unknown,
  now: number = Date.now(),
): number | null {
  if (typeof header === 'number' && Number.isFinite(header) && header >= 0) {
    return Math.ceil(header);
  }
  if (typeof header !== 'string' || header.trim() === '') return null;
  const asNumber = Number(header.trim());
  if (Number.isFinite(asNumber) && asNumber >= 0) return Math.ceil(asNumber);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * How long to wait before attempt `attempt + 1` (0-based `attempt` is the
 * one that just failed): the gateway's Retry-After when it gave one, else the
 * ladder. Never less than one second, never more than a minute.
 *
 * The header is read first. A browser does not expose it on a cross-origin
 * answer unless the gateway lists it in Access-Control-Expose-Headers, and
 * #1249 measured it as null from the web app on the local stack, so the 429
 * body's `retryAfter` (the same number, `RateLimitGuard`) is the fallback.
 * A named wait gets RETRY_AFTER_MARGIN_MS on top.
 */
export function sessionRetryDelayMs(
  attempt: number,
  err: unknown,
  now: number = Date.now(),
): number {
  const response = ((err ?? {}) as ErrorLike).response;
  const headers = response?.headers ?? {};
  const named =
    retryAfterSeconds(headers['retry-after'] ?? headers['Retry-After'], now) ??
    retryAfterSeconds(response?.data?.retryAfter, now);
  if (named !== null) {
    return Math.min(Math.max(named, 1) * 1000 + RETRY_AFTER_MARGIN_MS, MAX_WAIT_S * 1000);
  }
  const seconds = LADDER_S[Math.min(Math.max(attempt, 0), LADDER_S.length - 1)];
  return Math.min(Math.max(seconds, 1), MAX_WAIT_S) * 1000;
}

/** The sentence the person reads while the session waits. */
export function sessionWaitWords(wait: SessionWait, now: number = Date.now()): {
  title: string;
  body: string;
} {
  const seconds = Math.max(0, Math.ceil((wait.retryAt - now) / 1000));
  const when = seconds <= 1 ? 'in a moment' : `in ${seconds} seconds`;
  if (wait.reason === 'busy') {
    return {
      title: 'Mudavym is busy for a moment.',
      body: `Too many requests reached us from this connection at once. You are still signed in; we will try again ${when}.`,
    };
  }
  if (wait.reason === 'offline') {
    return {
      title: 'This device is not reaching Mudavym.',
      body: `Check the connection. You are still signed in; we will try again ${when}.`,
    };
  }
  return {
    title: 'Mudavym is not answering right now.',
    body: `You are still signed in; we will try again ${when}.`,
  };
}

/**
 * How long a loading screen says nothing but "Loading..." before it says the
 * read is slow (#1292). A boot read of `/auth/me` answers in well under a
 * second; five seconds of nothing reads as broken.
 */
export const SESSION_READ_SLOW_AFTER_MS = 5_000;

/**
 * The line under "Loading..." once an ordinary read has taken that long. It
 * does not claim the person is signed in: the read may still come back 401.
 * A read that is waiting to ask again is not "slow": it has its own screen
 * (SessionWaitScreen) that says why.
 */
export const SESSION_READ_SLOW_NOTE = 'Still reaching Mudavym. This is taking longer than usual.';
