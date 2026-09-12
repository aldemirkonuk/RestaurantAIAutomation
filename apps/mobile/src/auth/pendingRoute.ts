/**
 * Where the app should land the moment a session becomes usable.
 *
 * The problem this solves is a race, and it is the kind that only shows up on
 * a device. When `/login` finishes signing in, two things want to navigate:
 *
 *  - the screen, which knows about `?redirect=` and wants to honour it;
 *  - `useAuthRouting` in `app/_layout.tsx`, which sees a signed-in session
 *    sitting on a signed-out-only route and sends it home.
 *
 * Whichever runs second wins. React 18's automatic batching probably makes the
 * screen win, and "probably" is not a thing to ship a return-to-where-you-were
 * feature on — the failure is silent (you land on the dashboard instead of the
 * order you were opening) and it would only ever be caught by someone noticing.
 *
 * So the screens stop navigating. They leave a target here, and the layout —
 * the one place that moves the app between auth states — picks it up. One
 * mover, one rule, and `resolveAuthRedirect` stays a pure function that takes
 * the target as an argument.
 *
 * Module state rather than a store: this is a single value that lives for
 * milliseconds, is read exactly once, and must not cause a re-render.
 */

let pending: string | null = null;

/**
 * Set by an auth screen just before the session flips to `signedIn`.
 * `/login` leaves a sanitised `?redirect=`; `/register` Path B leaves
 * `/verify-email`, which is where a fresh owner account belongs.
 */
export function setPendingRoute(route: string | null): void {
  pending = route;
}

/** Read without consuming — the layout needs it to compute the target. */
export function peekPendingRoute(): string | null {
  return pending;
}

/** Consumed once the layout has acted on it, or on sign-out. */
export function clearPendingRoute(): void {
  pending = null;
}
