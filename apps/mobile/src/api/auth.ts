/**
 * The `/auth` calls themselves — thin wrappers over the fetch client.
 *
 * The endpoint *table* these correspond to lives in `./authEndpoints`, which
 * imports nothing, so the contract test can read it without Metro. This module
 * re-exports it so callers have one place to import from.
 *
 * None of these endpoints are new. Every one already existed when this file
 * was written; the screens were what was missing.
 */

import { api } from "./client";

export {
  AUTH_ENDPOINTS,
  type AuthEndpoint,
  type HttpMethod,
} from "./authEndpoints";

/** Tokens come back in the same shape from login, join, register and verify. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SignInMethod {
  id: "password" | "google" | "microsoft" | "apple";
  label: string;
  kind: string;
  enabled: boolean;
  disabledReason: string | null;
  order: number;
}

export interface SignInMethodsResult {
  email: string;
  methods: SignInMethod[];
  unavailable: SignInMethod[];
  declared: SignInMethod[];
  noSignInMethod: boolean;
}

export type InvitePreview =
  | { valid: false; reason: "not_found" | "used" | "expired" | string }
  | {
      valid: true;
      organization?: string;
      restaurant?: string;
      city?: string;
      inviter?: string;
      role?: string;
    };

export function fetchSignInMethods(email: string) {
  return api<{ success: true } & SignInMethodsResult>("/auth/sign-in-methods", {
    method: "POST",
    body: { email },
  });
}

export function checkEmailAvailable(email: string) {
  return api<{ available: boolean; email: string }>(
    `/auth/check-email?email=${encodeURIComponent(email)}`,
  );
}

/** Path A — join an existing restaurant with an 8-character invite code. */
export function joinViaInvite(input: {
  code: string;
  name: string;
  email: string;
  password: string;
}) {
  return api<{ success: true } & AuthTokens>("/auth/join", {
    method: "POST",
    body: input,
  });
}

/**
 * Path B, step 1 -- an account and nothing else. The address is proved
 * (verify-email) BEFORE a house is opened: `register/restaurant` opened an org
 * and a house on an address nobody had proved (r104, DD-r102-7).
 */
export interface RegisterAccountInput {
  name: string;
  email: string;
  password: string;
}

export function registerAccount(input: RegisterAccountInput) {
  return api<{ success: true } & AuthTokens>("/auth/register/account", {
    method: "POST",
    body: input,
  });
}

/** Path B, step 2 -- the verified owner opens the house (`register/house`). */
export interface FirstHouseInput {
  restaurantName: string;
  address: string;
  city: string;
  country: string;
}

export function createFirstHouse(input: FirstHouseInput) {
  return api<{ success: true; restaurantId: string } & AuthTokens>(
    "/auth/register/house",
    { method: "POST", body: input },
  );
}

export function requestPasswordReset(email: string) {
  return api<{ success: true; message: string }>(
    "/auth/request-password-reset",
    { method: "POST", body: { email } },
  );
}

export function resetPassword(token: string, newPassword: string) {
  return api<{ success: true; message: string }>("/auth/reset-password", {
    method: "POST",
    body: { token, newPassword },
  });
}

export function verifyEmail(token: string) {
  return api<{ success: true } & Partial<AuthTokens>>("/auth/verify-email", {
    method: "POST",
    body: { token },
  });
}

export function resendVerification() {
  return api<{ success: true; message?: string }>("/auth/resend-verification", {
    method: "POST",
  });
}

export function fetchInvitePreview(code: string) {
  return api<InvitePreview>(`/auth/invite/${encodeURIComponent(code)}`);
}

export function acceptInvite(code: string) {
  return api<{ success: true; restaurantId?: string; alreadyMember?: boolean }>(
    `/auth/invite/${encodeURIComponent(code)}/accept`,
    { method: "POST" },
  );
}

export function fetchOnboardingProgress() {
  return api<{ menu_uploaded?: boolean | null } | null>("/onboarding/progress");
}
