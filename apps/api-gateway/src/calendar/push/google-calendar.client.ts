import { Injectable, Logger } from "@nestjs/common";

/**
 * The one place this product speaks to the Google Calendar API.
 *
 * A seam, not a wrapper for its own sake. Direction 1 of ADR 0111 cannot be
 * proven against a live Google without `GOOGLE_CLIENT_ID` /
 * `GOOGLE_CLIENT_SECRET`, which are unset on every deployment — so the thing
 * that CAN be proven is the exact shape of every request we would send and the
 * exact handling of every answer we could get back. That proof only exists if
 * there is a single narrow interface to record against, which is this one.
 *
 * It deliberately does NOT throw on a non-2xx. Every failure mode of a push is
 * a different row in `calendar_push_outcomes` — refused, rate limited, token
 * expired, failed — and an exception flattens four answers into one. The status
 * and Google's own `reason` come back as data and the service decides.
 *
 * WHAT IS NOT HERE, AND WILL NOT BE ADDED BY THIS DIRECTION
 * --------------------------------------------------------
 * No list, no get, no sync token, no watch channel. `calendar.app.created`
 * would permit reading back the events we wrote; direction 1 does not read.
 * Adding a read verb here is what makes this direction 2, and that is ADR
 * 0111's next decision rather than a helper somebody adds in passing.
 */

const API_ROOT = "https://www.googleapis.com/calendar/v3";

/** How long a single call may take before we call it failed. */
const REQUEST_TIMEOUT_MS = 10_000;

export type GoogleCalendarMethod = "POST" | "PUT" | "DELETE";

export interface GoogleCalendarCall {
  method: GoogleCalendarMethod;
  /** Path under `/calendar/v3`, already encoded. */
  path: string;
  body?: Record<string, unknown>;
}

export interface GoogleCalendarAnswer {
  /** 0 when the call did not complete at all (network, timeout, abort). */
  status: number;
  body: Record<string, unknown> | null;
  /**
   * Google's own machine reason for the first error in the payload —
   * `rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded`, `duplicate`,
   * `notFound`, … Kept separate from `message` because the reason is what the
   * service branches on and the message is what a person reads.
   */
  reason: string | null;
  /** Google's own sentence, or ours when the call never reached Google. */
  message: string | null;
  /** From `Retry-After`, seconds, when present. */
  retryAfterSeconds: number | null;
}

export abstract class GoogleCalendarClient {
  abstract call(
    accessToken: string,
    request: GoogleCalendarCall,
  ): Promise<GoogleCalendarAnswer>;
}

@Injectable()
export class HttpGoogleCalendarClient extends GoogleCalendarClient {
  private readonly logger = new Logger(HttpGoogleCalendarClient.name);

  async call(
    accessToken: string,
    request: GoogleCalendarCall,
  ): Promise<GoogleCalendarAnswer> {
    const url = `${API_ROOT}${request.path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });

      // A 204 (delete) has no body and `json()` on it throws. A parse failure
      // is not an error either: the status is the answer, and inventing one
      // would be worse than reporting the status with a null body.
      let body: Record<string, unknown> | null = null;
      const text = await response.text().catch(() => "");
      if (text) {
        try {
          body = JSON.parse(text) as Record<string, unknown>;
        } catch {
          body = null;
        }
      }

      const retryAfter = response.headers.get("retry-after");
      const parsedRetry = retryAfter ? Number(retryAfter) : NaN;

      return {
        status: response.status,
        body,
        reason: firstErrorReason(body),
        message: errorMessage(body) ?? (response.ok ? null : text.slice(0, 500)),
        retryAfterSeconds: Number.isFinite(parsedRetry) ? parsedRetry : null,
      };
    } catch (error) {
      const message =
        (error as Error).name === "AbortError"
          ? `Google did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
          : `The call to Google did not complete: ${(error as Error).message}`;
      this.logger.warn(`${request.method} ${url} — ${message}`);
      return {
        status: 0,
        body: null,
        reason: null,
        message,
        retryAfterSeconds: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Google's error payload is `{ error: { code, message, errors: [{ reason }] } }`
 * on the classic APIs and `{ error: { status } }` on the newer shape. Both are
 * read, and an unrecognised shape yields null rather than a guess.
 */
export function firstErrorReason(
  body: Record<string, unknown> | null,
): string | null {
  const error = body?.error as Record<string, unknown> | undefined;
  if (!error) return null;

  const errors = error.errors as Array<Record<string, unknown>> | undefined;
  const reason = errors?.[0]?.reason;
  if (typeof reason === "string" && reason) return reason;

  const status = error.status;
  return typeof status === "string" && status ? status : null;
}

export function errorMessage(
  body: Record<string, unknown> | null,
): string | null {
  const error = body?.error as Record<string, unknown> | undefined;
  const message = error?.message;
  return typeof message === "string" && message ? message : null;
}

/**
 * The reasons Google uses for "you are going too fast", as opposed to "you may
 * not do this".
 *
 * A 403 is BOTH in this API: `rateLimitExceeded` and `quotaExceeded` arrive as
 * 403, and so does a genuine permission refusal. Branching on the status alone
 * would either back off on a permanent refusal (retrying forever) or retry a
 * rate limit as if it were fatal (never sending again). The reason string is
 * the only thing that separates them.
 * https://developers.google.com/workspace/calendar/api/guides/errors
 */
export const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "backendError",
  "RESOURCE_EXHAUSTED",
]);

export function isRateLimited(answer: GoogleCalendarAnswer): boolean {
  if (answer.status === 429) return true;
  if (answer.status !== 403) return false;
  return answer.reason !== null && RATE_LIMIT_REASONS.has(answer.reason);
}
