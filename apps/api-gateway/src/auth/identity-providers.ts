/**
 * The identity providers this product supports, declared in one place.
 *
 * WHY A REGISTRY
 * --------------
 * Before this file, provider names were hard-coded into branches scattered
 * across the auth code, and one of those branches was actively lying to users:
 *
 *   const provider = user.oauth_provider === "microsoft" ? "microsoft" : "google";
 *
 * That `: "google"` is a *guess presented as fact* — it fired for any account
 * with no password, told the user "This account uses Google sign-in", and sent
 * them into a flow that could never work. In production on 2026-08-26 it was
 * wrong 4 times out of 4: every password-less account had zero rows in
 * `user_oauth_accounts` and a NULL `oauth_provider`. See ADR 0024 and
 * ADR 0020 (no fabricated answers).
 *
 * The rule this file enforces: **adding a provider is adding an entry here.**
 * Nothing else in the auth code may branch on a provider name. Anything that
 * needs to know "which providers exist", "what do we call them", or "is this
 * one usable yet" reads it from `IDENTITY_PROVIDERS`.
 *
 * WHAT `enabled` MEANS
 * --------------------
 * `enabled: true` means a user can complete a sign-in with it *today, on the
 * login page*. Not "the backend has an endpoint" — Microsoft has had
 * `POST /auth/oauth/microsoft` and an `AuthContext.loginWithMicrosoft` wrapper
 * for months with no button anywhere, which is precisely the gap that let the
 * fabricated "use Microsoft" message look plausible. A declared-but-disabled
 * entry renders as a visible, greyed-out row carrying its `disabledReason`, so
 * the absence is stated rather than hidden.
 *
 * KNOWN CONSTRAINT — the database does not know about `apple`
 * -----------------------------------------------------------
 * `user_oauth_accounts.provider` carries a CHECK constraint that admits only
 * `google` and `microsoft` (baseline_from_production.sql:5771). So `apple` can
 * be *declared* here, but linking an Apple account needs a migration widening
 * that constraint first. `enabledOAuthProvidersAreStorable` in
 * identity-providers.spec.ts fails the build if anyone flips an entry to
 * `enabled: true` without it — the constraint violation would otherwise show
 * up as a runtime insert failure during someone's first sign-in.
 */

export type IdentityProviderId = "password" | "google" | "microsoft" | "apple";

export interface IdentityProviderDescriptor {
  id: IdentityProviderId;
  /** Human-readable name. The only place a provider's display name lives. */
  label: string;
  /**
   * `password` — a secret this app stores and verifies itself.
   * `oauth` — an external identity provider; a row in `user_oauth_accounts`.
   */
  kind: "password" | "oauth";
  /** Can a user actually finish a sign-in with this today? See above. */
  enabled: boolean;
  /**
   * Why not, in words shown to the user. Non-null exactly when `enabled` is
   * false — an unexplained greyed-out button is its own small lie.
   */
  disabledReason: string | null;
  /** Render order on the sign-in page. Lower first. */
  order: number;
}

/**
 * The registry. Order here is the render order.
 *
 * To add a provider: add an entry, add a strategy in AuthService, and add one
 * renderer entry in the web `PROVIDER_RENDERERS` map. Nothing else.
 */
export const IDENTITY_PROVIDERS: readonly IdentityProviderDescriptor[] = [
  {
    id: "password",
    label: "Password",
    kind: "password",
    enabled: true,
    disabledReason: null,
    order: 10,
  },
  {
    id: "google",
    label: "Google",
    kind: "oauth",
    enabled: true,
    disabledReason: null,
    order: 20,
  },
  {
    id: "microsoft",
    label: "Microsoft",
    kind: "oauth",
    // The gateway route exists (auth.controller.ts, `POST /auth/oauth/microsoft`)
    // but no sign-in button does, so a user cannot complete this flow.
    enabled: false,
    disabledReason: "Microsoft sign-in isn't available on this page yet.",
    order: 30,
  },
  {
    id: "apple",
    label: "Apple",
    kind: "oauth",
    // Declared so the shape is ready; nothing is wired, and the
    // user_oauth_accounts CHECK constraint would reject the row anyway.
    enabled: false,
    disabledReason: "Apple sign-in isn't set up yet.",
    order: 40,
  },
] as const;

/**
 * Provider ids the `user_oauth_accounts.provider` CHECK constraint accepts.
 * Mirrors supabase/migrations/20260805000000_baseline_from_production.sql:5771.
 * Widening the constraint means widening this — and the spec that compares the
 * two will tell you if you forget one half.
 */
export const STORABLE_OAUTH_PROVIDER_IDS: readonly IdentityProviderId[] = [
  "google",
  "microsoft",
] as const;

const BY_ID = new Map<string, IdentityProviderDescriptor>(
  IDENTITY_PROVIDERS.map((p) => [p.id, p]),
);

/** Look up one descriptor. Returns undefined for an id we do not declare. */
export function getIdentityProvider(
  id: string,
): IdentityProviderDescriptor | undefined {
  return BY_ID.get(id);
}

/** True when `id` is a provider this product declares. */
export function isKnownIdentityProviderId(
  id: string,
): id is IdentityProviderId {
  return BY_ID.has(id);
}

/** Every declared OAuth provider, enabled or not. */
export function oauthProviders(): IdentityProviderDescriptor[] {
  return IDENTITY_PROVIDERS.filter((p) => p.kind === "oauth");
}

/**
 * The methods offered when we have no identity to resolve against — an email
 * that matches no account.
 *
 * This is deliberately *not* "nothing". Returning an empty set for an unknown
 * address would make the page say "this account has no sign-in method", which
 * fabricates an account that does not exist — the same class of lie this whole
 * change removes, pointed the other way. Offering the standard set states
 * nothing about the address and lets the user fall through to the existing,
 * honest "Invalid credentials" from POST /auth/login. See ADR 0024 §Unknown
 * emails.
 */
export function defaultSignInMethods(): IdentityProviderDescriptor[] {
  return sortForDisplay(IDENTITY_PROVIDERS.filter((p) => p.enabled));
}

/** Sort descriptors into render order. */
export function sortForDisplay(
  providers: IdentityProviderDescriptor[],
): IdentityProviderDescriptor[] {
  return [...providers].sort((a, b) => a.order - b.order);
}
