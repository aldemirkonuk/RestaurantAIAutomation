/**
 * The `/auth` routes the phone calls, as data.
 *
 * Split out of `api/auth.ts` on purpose: that module imports the fetch client,
 * which imports `config.ts`, which imports `react-native` — and the contract
 * test that checks these strings against the gateway source runs in a plain
 * node environment with no Metro transform. A table with no runtime imports
 * can be read by both the app and the guard.
 *
 * Why a table at all: P3.A's measurement pass found `connectSocket`
 * subscribing to `order:updated` and `order_change`, two event names the
 * gateway has never emitted. Both typechecked forever, because a wrong string
 * is still a string. `src/auth/__tests__/authContract.test.ts` parses
 * `apps/api-gateway/src/auth/auth.controller.ts` and fails if anything below
 * is not there, so renaming a gateway route breaks the mobile build instead of
 * breaking account recovery in production.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface AuthEndpoint {
  method: HttpMethod;
  /** Path under the `auth` controller, exactly as the decorator spells it. */
  path: string;
  /** Which screen depends on it — so a failing contract test names a screen. */
  usedBy: string;
}

export const AUTH_ENDPOINTS = {
  signInMethods: {
    method: "POST",
    path: "sign-in-methods",
    usedBy: "app/login.tsx",
  },
  checkEmail: { method: "GET", path: "check-email", usedBy: "app/register.tsx" },
  join: { method: "POST", path: "join", usedBy: "app/register.tsx (Path A)" },
  registerRestaurant: {
    method: "POST",
    path: "register/restaurant",
    usedBy: "app/register.tsx (Path B)",
  },
  requestPasswordReset: {
    method: "POST",
    path: "request-password-reset",
    usedBy: "app/forgot-password.tsx",
  },
  resetPassword: {
    method: "POST",
    path: "reset-password",
    usedBy: "app/reset-password.tsx",
  },
  verifyEmail: {
    method: "POST",
    path: "verify-email",
    usedBy: "app/verify-email.tsx",
  },
  resendVerification: {
    method: "POST",
    path: "resend-verification",
    usedBy: "app/verify-email.tsx",
  },
  invitePreview: {
    method: "GET",
    path: "invite/:code",
    usedBy: "app/invite/[code].tsx",
  },
  acceptInvite: {
    method: "POST",
    path: "invite/:code/accept",
    usedBy: "app/invite/[code].tsx",
  },
} as const satisfies Record<string, AuthEndpoint>;
