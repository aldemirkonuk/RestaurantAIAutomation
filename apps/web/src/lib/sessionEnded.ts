/**
 * A refused refresh token, said out loud instead of a page reload (F-335).
 *
 * Until 2026-10-09 a 401 from `/auth/refresh` ran `window.location.href =
 * '/login'`: a full page load, so every open form lost what was typed, nothing
 * said why, and after signing in the person landed on the dashboard instead of
 * the page they were on. The gateway already sends the reason (`code:
 * SESSION_ENDED`, auth.service.ts), and Login already honours `?redirect=`.
 *
 * Now the API client announces the end with this event and the page stays
 * where it is. `SessionEndedPanel` (mounted once inside the router) answers it
 * with a plain "sign in again" panel over the page.
 */

export const SESSION_ENDED_EVENT = "mudavym:session-ended";

/** The gateway's own sentence, used when the refusal carried none. */
export const SESSION_ENDED_WORDS = "This session was signed out. Sign in again.";

export interface SessionEndedDetail {
  message: string;
}

/** The sentence to show for a refused refresh: the gateway's, or ours. */
export function sessionEndedMessage(data: unknown): string {
  const body = data as { code?: unknown; message?: unknown } | null | undefined;
  return body?.code === "SESSION_ENDED" && typeof body.message === "string"
    ? body.message
    : SESSION_ENDED_WORDS;
}

export function announceSessionEnded(message: string = SESSION_ENDED_WORDS): void {
  try {
    window.dispatchEvent(
      new CustomEvent<SessionEndedDetail>(SESSION_ENDED_EVENT, {
        detail: { message },
      }),
    );
  } catch {
    /* no window */
  }
}

/** Sign-in that says why and brings the person back to `here` after. */
export function signInAgainPath(here: string): string {
  return `/login?redirect=${encodeURIComponent(here)}&ended=1`;
}
