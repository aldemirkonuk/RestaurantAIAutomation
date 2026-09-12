/**
 * What an auth screen says back.
 *
 * Two things live here that are easy to get wrong in a component and hard to
 * see once they are wrong:
 *
 *  1. **`/forgot-password` must not leak whether an account exists.** The
 *     gateway is careful about this — `requestPasswordReset` returns the same
 *     sentence either way, deliberately (`auth.controller.ts:221`). A client
 *     that renders "no account with that email" on a 404, or that shows a
 *     spinner-then-error for unknown addresses and spinner-then-success for
 *     known ones, hands the enumeration back. `forgotPasswordOutcome` is the
 *     rule, and it is tested.
 *  2. **A phone is offline a lot.** `ApiError` carries an HTTP status; a
 *     dropped connection carries none. Those are different sentences and the
 *     difference matters most on exactly these screens, where the user cannot
 *     retry from memory.
 */

export type ForgotPasswordOutcome = "sent" | "rateLimited" | "serverError";

/**
 * Maps the response to what the screen shows.
 *
 * `forgot-password.md` §1a: *"always answers success — deliberately
 * enumeration-resistant"* and *"Rate-limit (429) and server-error states;
 * everything else looks like success by design."* So only two statuses are
 * allowed to produce anything other than the success card.
 *
 * `status` is `null` for a transport failure — no response at all. That is a
 * server-error-shaped outcome, not a success: claiming the mail was sent when
 * the request never arrived would be a lie the user acts on by waiting.
 */
export function forgotPasswordOutcome(
  status: number | null,
): ForgotPasswordOutcome {
  if (status === null) return "serverError";
  if (status === 429) return "rateLimited";
  if (status >= 500) return "serverError";
  return "sent";
}

export const ENUMERATION_SAFE_SENT_MESSAGE =
  "If that address has an account, a reset link is on its way. Check your mail — and your spam folder.";

/**
 * Human copy for a failed auth call.
 *
 * `fallback` is the server's own message where there is one; it is preferred
 * for the statuses where the server knows something the client does not (a
 * 400 explaining *which* field), and ignored for the statuses where the
 * server's phrasing is either generic or unsafe to repeat.
 */
export function describeAuthFailure(
  status: number | null,
  fallback?: string | null,
): string {
  if (status === null) {
    return "Couldn't reach WineOps. Check your connection and try again.";
  }
  switch (status) {
    case 401:
      return "That email and password don't match an account.";
    case 403:
      return fallback ?? "You don't have access to that.";
    case 404:
      return fallback ?? "We couldn't find that.";
    case 409:
      return fallback ?? "That's already been used.";
    case 429:
      return "Too many attempts. Wait a minute and try again.";
    default:
      if (status >= 500) {
        return "Something broke on our side. Try again in a moment.";
      }
      return fallback ?? "That didn't work. Check the details and try again.";
  }
}

/**
 * Pull an HTTP status out of whatever was thrown.
 *
 * `ApiError` carries `status`; `session.ts` throws a plain `Error` for a
 * failed sign-in, and `fetch` throws a `TypeError` when the network is gone.
 * Only the first has a status, and treating the absence as `null` rather than
 * as `0` or `500` is what lets `describeAuthFailure` say "check your
 * connection" instead of blaming the server for a subway tunnel.
 */
export function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/** Not exported: a part of `authErrorMessage`, covered through it. */
function messageOf(error: unknown): string | null {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.trim() ? message : null;
}

/** The one-liner a screen shows for a thrown auth failure. */
export function authErrorMessage(error: unknown): string {
  return describeAuthFailure(statusOf(error), messageOf(error));
}

/**
 * Where a freshly-verified session lands.
 *
 * `verify-email.md` §1a: *"Routes onward smartly: to Get Started, or straight
 * to the dashboard when a menu already exists."* Web reads
 * `GET /onboarding/progress` and branches on `menu_uploaded`
 * (`VerifyEmail.tsx:41-43`); this mirrors it.
 *
 * An unreadable progress record routes to Get Started, not to the dashboard:
 * sending someone who has not onboarded to an empty dashboard is a worse
 * failure than showing the guide to someone who no longer needs it.
 */
export function routeAfterVerification(progress: {
  menu_uploaded?: boolean | null;
} | null): string {
  return progress?.menu_uploaded ? "/" : "/get-started";
}

/**
 * Where a session lands after signing in.
 *
 * `login.md` §1a: *"Return-to-where-you-were after signing in (`?redirect=`)"*.
 * `redirect` must already have been through `safeRedirectTarget`.
 */
export function routeAfterSignIn(redirect: string | null): string {
  return redirect ?? "/";
}
