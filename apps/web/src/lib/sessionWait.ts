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
  response?: { status?: number; headers?: Record<string, unknown> };
}

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
 */
export function sessionRetryDelayMs(
  attempt: number,
  err: unknown,
  now: number = Date.now(),
): number {
  const headers = ((err ?? {}) as ErrorLike).response?.headers ?? {};
  const named = retryAfterSeconds(headers['retry-after'] ?? headers['Retry-After'], now);
  const seconds =
    named !== null ? named : LADDER_S[Math.min(Math.max(attempt, 0), LADDER_S.length - 1)];
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
