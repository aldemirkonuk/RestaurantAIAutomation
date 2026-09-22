/**
 * hp-service — what the gateway's readiness probe means in words.
 *
 * `GET /health/ready` (`apps/api-gateway/src/health/readiness.controller.ts`)
 * is public by decision (ADR 0096) and answers 200 `ready` or 503 `not_ready`,
 * naming which of its two checks failed — the Supabase client, or a bounded
 * HEAD round trip to the database. It is memoised for five seconds and says
 * so in `checkedAt`.
 *
 * WHY THIS IS ITS OWN, CLEARLY LABELLED LINE (wave dossier fork F3, option c)
 * -----------------------------------------------------------------------
 * ADR 0144 §2 asks for three facts about THIS HOUSE — connections, waiting,
 * last failed — and forbids inventing apparatus. `/health/ready` is neither:
 * it is a DEPLOYMENT fact, true or false for every house at once. Folding it
 * into the house state would overstate what it says ("the house is fine"
 * when only the process is fine), so it renders separately, under its own
 * "This deployment" heading, and answers a different question: is it me, is
 * it this house, or is it the service.
 *
 * This module turns that payload, or the absence of one, into the sentence
 * the page prints. It never guesses: a body it cannot read is reported as a
 * body it could not read.
 */

export interface ReadinessChecks {
  injector?: string;
  supabaseClient?: string;
  database?: string;
}

export interface ReadinessPayload {
  status?: string;
  commit?: string;
  bootedAt?: string;
  checkedAt?: string;
  checks?: ReadinessChecks;
  reason?: string;
}

export type ServiceState =
  | { kind: 'checking' }
  | {
      kind: 'answered';
      ready: boolean;
      /** HTTP status the gateway sent. */
      httpStatus: number;
      commit: string | null;
      bootedAt: string | null;
      checkedAt: string | null;
      database: string | null;
      supabaseClient: string | null;
      reason: string | null;
      latencyMs: number;
      /** When THIS page took the reading. */
      readAt: Date;
    }
  | {
      kind: 'unreachable';
      /** What the client said, verbatim. */
      error: string;
      latencyMs: number;
      readAt: Date;
    };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** A gateway answer of any HTTP status, read into a state. */
export function readinessFromResponse(
  httpStatus: number,
  body: unknown,
  latencyMs: number,
  readAt: Date = new Date(),
): ServiceState {
  const p = (body && typeof body === 'object' ? body : {}) as ReadinessPayload;
  const ready = httpStatus === 200 && p.status === 'ready';
  return {
    kind: 'answered',
    ready,
    httpStatus,
    commit: str(p.commit),
    bootedAt: str(p.bootedAt),
    checkedAt: str(p.checkedAt),
    database: str(p.checks?.database),
    supabaseClient: str(p.checks?.supabaseClient),
    reason: str(p.reason),
    latencyMs,
    readAt,
  };
}

/** No answer at all — the client threw. */
export function readinessUnreachable(error: string, latencyMs: number, readAt: Date = new Date()): ServiceState {
  return { kind: 'unreachable', error: error.trim() || 'no error message', latencyMs, readAt };
}

/**
 * The one sentence under the heading. Written for the person who opened
 * /help because something felt wrong; the first thing they need is whether
 * it is them or the service.
 */
export function serviceSentence(s: ServiceState): string {
  if (s.kind === 'checking') return 'Asking the gateway whether it can serve requests.';
  if (s.kind === 'unreachable') return 'The gateway did not answer.';
  if (s.ready) return 'The service is up and can reach its database.';
  if (s.httpStatus === 200) return 'The gateway answered 200 but did not say it was ready.';
  return 'The gateway is up but says it is not ready to serve.';
}

/** What a person should do next, per state — the honesty clause's "what to do". */
export function serviceNextStep(s: ServiceState): string {
  if (s.kind === 'checking') return 'One request; it usually answers within a second.';
  if (s.kind === 'unreachable') {
    return 'Check your connection, then check again. If it keeps failing, the service is down for you — write to support with the block below.';
  }
  if (s.ready) return 'If a page still misbehaves, the fault is in that page, not the service — say which page when you write.';
  return 'Nothing you do on this side will fix it. Check again in a minute; if it stays not ready, write to support with the block below.';
}

/** The database word the gateway used, or the honest absence. */
export function databaseWord(s: ServiceState): string {
  if (s.kind !== 'answered') return 'not probed';
  if (!s.database) return 'not reported';
  return s.database;
}
