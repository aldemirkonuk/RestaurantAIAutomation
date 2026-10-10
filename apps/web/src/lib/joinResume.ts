/**
 * An invitation this device is holding while its person verifies their email
 * (F-274, F-288). Verifying happens through a link in a mail, usually in a new
 * tab, so neither router state nor the URL survives the trip: the invite path
 * is kept here, tied to the account that opened it, and the verify page and
 * the house chooser send that account back to it instead of to /get-started.
 *
 * Only the two join pages are ever kept, so this can never send anyone
 * anywhere else. It is bound to one account, lasts a week at most (an invite
 * lasts seven days), is dropped by the invite page once its person is back on
 * it, and is cleared at sign-out. It grants nothing: the invite page still
 * checks the invite with the server before anyone joins.
 */

export const JOIN_RESUME_KEY = "mudavym.joinAfterVerify.v1";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const JOIN_PATH = /^\/(?:invite|studio\/invite)\/[A-Za-z0-9._~%-]+$/;

export function isJoinPath(path: string): boolean {
  return JOIN_PATH.test(path);
}

export function rememberJoin(path: string, userId: string | undefined): void {
  if (!userId || !isJoinPath(path)) return;
  try {
    window.localStorage.setItem(
      JOIN_RESUME_KEY,
      JSON.stringify({ path, userId, at: Date.now() }),
    );
  } catch {
    // Storage blocked: the person finds the invite mail again.
  }
}

/** The invite path this account was on its way to join, if any. */
export function pendingJoin(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(JOIN_RESUME_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { path?: unknown; userId?: unknown; at?: unknown };
    if (
      v?.userId !== userId ||
      typeof v.path !== "string" ||
      !isJoinPath(v.path) ||
      typeof v.at !== "number" ||
      Date.now() - v.at > MAX_AGE_MS
    )
      return null;
    return v.path;
  } catch {
    return null;
  }
}

export function forgetJoin(): void {
  try {
    window.localStorage.removeItem(JOIN_RESUME_KEY);
  } catch {
    // nothing kept, nothing to clear
  }
}
