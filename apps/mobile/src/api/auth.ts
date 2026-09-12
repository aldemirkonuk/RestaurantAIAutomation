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

/** Path B — create an owner account and the restaurant record together. */
export interface RegisterRestaurantInput {
  name: string;
  email: string;
  password: string;
  restaurantName: string;
  address: string;
  city: string;
  country: string;
  stateProvince?: string;
  postalCode?: string;
  phone?: string;
  cuisineType?: string;
}

export function registerRestaurant(input: RegisterRestaurantInput) {
  return api<{ success: true } & AuthTokens>("/auth/register/restaurant", {
    method: "POST",
    body: input,
  });
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
