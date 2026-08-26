/**
 * Client-side mirror of the gateway's identity provider registry.
 *
 * The server registry (`apps/api-gateway/src/auth/identity-providers.ts`) is
 * the source of truth: labels, order, enabled/disabled and the reason a
 * provider is unavailable all arrive on the wire from
 * `POST /auth/sign-in-methods`. The login page renders whatever comes back and
 * branches on **no** provider name.
 *
 * What lives here is only what the wire cannot carry:
 *
 *  1. `FALLBACK_METHODS` — what to show when the resolve call cannot be made
 *     at all (gateway down, offline, rate-limited). Without it a network blip
 *     would lock every user out of a page that used to work; with it they get
 *     the same form they had before identity-first landed. See ADR 0024
 *     "Do not break the existing flow".
 *  2. `PROVIDER_RENDERERS` — which React control draws which provider. A
 *     genuinely new provider needs an SDK integration, so this map is the one
 *     place the web has to learn a new name.
 */

export type IdentityProviderId = 'password' | 'google' | 'microsoft' | 'apple'

export interface IdentityProviderDescriptor {
  id: IdentityProviderId
  label: string
  kind: 'password' | 'oauth'
  enabled: boolean
  disabledReason: string | null
  order: number
}

export interface SignInMethodsResult {
  email: string
  /** Methods this identity can actually use. */
  methods: IdentityProviderDescriptor[]
  /**
   * Linked to this identity but not usable here (e.g. a Microsoft-linked
   * account while Microsoft has no button). Usually empty; always rendered
   * when it is not.
   */
  unavailable: IdentityProviderDescriptor[]
  /**
   * Every provider the product declares, usable or not. Not rendered by
   * default — see SHOW_DECLARED_PROVIDERS in Login.tsx.
   */
  declared: IdentityProviderDescriptor[]
  /** A real account that has no password and no linked provider. */
  noSignInMethod: boolean
  /**
   * Set by the client, never by the server: true when the resolve call failed
   * and `FALLBACK_METHODS` is standing in. The page uses it to avoid making
   * any claim about the address — an assumed set is not a resolved one.
   */
  assumed?: boolean
}

/**
 * The set shown when the identity could not be resolved. Deliberately the
 * enabled providers only, and deliberately NOT `noSignInMethod: true` — an
 * unreachable server tells us nothing about the account, and "this account has
 * no sign-in method" would be a fabrication (ADR 0020).
 */
export const FALLBACK_METHODS: IdentityProviderDescriptor[] = [
  {
    id: 'password',
    label: 'Password',
    kind: 'password',
    enabled: true,
    disabledReason: null,
    order: 10,
  },
  {
    id: 'google',
    label: 'Google',
    kind: 'oauth',
    enabled: true,
    disabledReason: null,
    order: 20,
  },
]

/** What the page falls back to when it cannot ask the gateway. */
export function fallbackSignInMethods(email: string): SignInMethodsResult {
  return {
    email,
    methods: FALLBACK_METHODS,
    unavailable: [],
    declared: FALLBACK_METHODS,
    noSignInMethod: false,
    assumed: true,
  }
}

/**
 * Providers the login page knows how to draw. Adding Apple or Microsoft is an
 * entry here plus its sign-in button component — the page itself never learns
 * the name. Anything the server offers that is missing from this set is
 * skipped rather than rendered as a dead control.
 */
export const RENDERABLE_PROVIDER_IDS: readonly IdentityProviderId[] = [
  'password',
  'google',
] as const

export function canRender(id: IdentityProviderId): boolean {
  return RENDERABLE_PROVIDER_IDS.includes(id)
}
