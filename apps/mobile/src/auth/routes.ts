/**
 * Which screens a signed-out phone is allowed to be on, and where the router
 * sends it when it is somewhere else.
 *
 * This exists as a pure module because the rule it encodes is the one that
 * silently deletes work. Before this file, `app/_layout.tsx` said:
 *
 *     if (status === "signedOut" && segments[0] !== "login")
 *       router.replace("/login");
 *
 * — every route except `login` was unreachable while signed out. A new
 * `/register` screen would have mounted and been replaced on the same frame,
 * forever, with nothing in the build to say so. That is the same shape as the
 * three defects P3.A found by measuring: a thing that exists and cannot be
 * reached. Keeping the rule here means it has tests.
 */

/** Route groups, keyed by the first expo-router segment. */
export type AuthStatus = "booting" | "signedOut" | "locked" | "signedIn";

/**
 * Readable with no session at all *and* with one — legal copy must not need
 * an account, and must not become unreachable once you have one.
 */
export const ALWAYS_PUBLIC = ["privacy"] as const;

/**
 * The way in. Meaningless once you are signed in, so a signed-in session on
 * one of these is bounced home.
 */
export const SIGNED_OUT_ONLY = [
  "login",
  "register",
  "forgot-password",
  "reset-password",
] as const;

/**
 * Reachable from either side. An invite preview is the obvious case: a signed
 * out user signs in to accept, a signed-in user accepts in one tap
 * (`invite-landing.md` §1a), and both must be able to sit on the screen.
 * `verify-email` is here because you reach it *holding a token that is not yet
 * usable*, and `no-access` because it explains a session that has no
 * restaurant.
 */
export const EITHER_SIDE = ["invite", "verify-email", "no-access"] as const;

/** The biometric gate. */
export const LOCK_ROUTE = "lock";

const ALWAYS_PUBLIC_SET: ReadonlySet<string> = new Set(ALWAYS_PUBLIC);
const SIGNED_OUT_ONLY_SET: ReadonlySet<string> = new Set(SIGNED_OUT_ONLY);
const EITHER_SIDE_SET: ReadonlySet<string> = new Set(EITHER_SIDE);

/** Every route a phone with no session may sit on. */
export const PUBLIC_ROUTES: readonly string[] = [
  ...ALWAYS_PUBLIC,
  ...SIGNED_OUT_ONLY,
  ...EITHER_SIDE,
];

/**
 * True when a signed-out session is allowed to stay on this segment.
 *
 * Not exported: `resolveAuthRedirect` is the whole outward surface of this
 * module, and the behaviour here is covered through it — `routes.test.ts`
 * walks every entry of `PUBLIC_ROUTES` and asserts a signed-out session is
 * left alone on each.
 */
function isPublicRoute(segment: string | undefined): boolean {
  if (!segment) return false;
  return (
    ALWAYS_PUBLIC_SET.has(segment) ||
    SIGNED_OUT_ONLY_SET.has(segment) ||
    EITHER_SIDE_SET.has(segment)
  );
}

/**
 * Where the router must send a session, or `null` to leave it alone.
 *
 * Pure on purpose: `app/_layout.tsx` does nothing but call this and act on the
 * answer, so every branch below is testable without a renderer.
 */
export function resolveAuthRedirect(
  status: AuthStatus,
  segments: readonly string[],
  /**
   * Where a session that has just become usable should land, if anywhere
   * other than home — `?redirect=` from `/login`, or `/verify-email` for a
   * fresh owner account. Supplied by the layout from `pendingRoute.ts`; see
   * that file for why the screens do not navigate themselves.
   */
  afterAuth?: string | null,
): string | null {
  const head = segments[0];

  // Nothing is known yet — moving now would fight the restore.
  if (status === "booting") return null;

  if (status === "signedOut") {
    return isPublicRoute(head) ? null : "/login";
  }

  if (status === "locked") {
    // Tokens exist but the gate has not been passed. Only the gate itself and
    // the always-public copy may render; anything else would show, or act on,
    // data belonging to a session that has not been proven.
    if (head === LOCK_ROUTE) return null;
    if (ALWAYS_PUBLIC_SET.has(head ?? "")) return null;
    return "/lock";
  }

  // signedIn
  if (head === LOCK_ROUTE) return afterAuth ?? "/";
  if (SIGNED_OUT_ONLY_SET.has(head ?? "")) return afterAuth ?? "/";
  return null;
}
