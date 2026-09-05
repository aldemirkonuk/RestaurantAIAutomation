/**
 * ProfileNext data — every read this page makes, and every write it offers.
 *
 * THE TWO SILENT READS ARE THE POINT (profile.md §10, §13.1)
 * ----------------------------------------------------------
 * The shipping page has two `catch {}` blocks and they are the page's whole
 * defect surface:
 *
 *   Profile.tsx:110-118  `profileApi.getMe()` fails into an empty catch — so
 *                        phone, `hasPassword` and the linked providers render
 *                        blank or stale and nothing says the record was never
 *                        read.
 *   Profile.tsx:143-146  the restaurant loader falls back to the auth store's
 *                        CACHED branch name/city on failure. The form then
 *                        shows one name while the server holds another, and
 *                        `saveRestaurant` PATCHes the cached value back over
 *                        the real one. It is the only data-loss path on the
 *                        page.
 *
 * Here both reads are first-class query states. The account record has an
 * error branch that says which register could not be read. The restaurant
 * record has NO cache fallback at all: on failure the fields stay empty, the
 * form is disabled, and `saveRestaurant` refuses to fire — a value that was
 * never read cannot become a write.
 *
 * TENANT KEYING
 * -------------
 * The gateway scopes by the `X-Restaurant-Id` header the api client stamps
 * from localStorage (services/api/client.ts), so the header never reaches the
 * query key on its own. Every key below carries `activeRestaurantId` (and the
 * user id) so a branch switch cannot serve the previous tenant's restaurant
 * record, and `GET /auth/me` re-resolves its JWT-scoped `restaurantId`.
 *
 * SECOND PASS, 2026-09-03 — THREE DASHES BECAME READS
 * ---------------------------------------------------
 * The first pass reported three things honestly as absent. The founder's answer
 * was to build them, so this hook now reads three registers that did not exist:
 *
 *   MCP      `GET/POST/PUT/DELETE /mcp-connections` — a new gateway module and
 *            the `user_mcp_connections` table (migration 20260903094500). Real
 *            list, real add, real revoke.
 *
 *            THIRD PASS, the same day: the register now CALLS. `POST
 *            /mcp-connections/:id/probe` performs the Model Context Protocol
 *            handshake over Streamable HTTP (`apps/api-gateway/src/mcp-runtime/`,
 *            migration 20260903104500) and the row records what answered — so
 *            `lastUsedAt` is a real timestamp when a server answers, and stays
 *            null when it does not. Two fields, not one: `lastProbeAt` is when
 *            we called and `lastUsedAt` is when it answered, because a month of
 *            failed calls must not read as a month of traffic.
 *
 *            `GET /mcp-connections/runtime` is read alongside the list and
 *            carries the DEPLOYMENT's state: whether a secret can be stored at
 *            all (`MCP_CONNECTION_SECRET_KEY`) and whether a tool may be called
 *            (never — ADR 0013's commitment guardrail comes first). Both
 *            sentences are the server's, so the page states a rule rather than
 *            describing one.
 *   PAYMENT  `GET /payment-methods` — a new gateway module and the
 *            `payment_methods` table (migration 20260903094600). The response
 *            carries the PROVIDER's state beside the rows, which is the field
 *            that stops an empty register from lying: "no cards on file" and
 *            "no provider is connected, so no card can exist" are the same empty
 *            array otherwise. The create path refuses server-side while no
 *            credential is configured, and the page's submit is disabled with
 *            the same sentence.
 *
 * THIRD PASS, 2026-09-03 — THE PROVIDER PATH (ADR 0110)
 * -----------------------------------------------------
 * The second pass filed the remainder as "one credential away". It was not:
 * nothing in the repo spoke to Stripe, so `provider_ref` was a required field no
 * caller could fill and setting `STRIPE_SECRET_KEY` would have enabled a form
 * whose four hand-typed fields became the register's content. So this hook
 * gained three writes over a new `billing/` module — `createSetupIntent` (the
 * client secret Stripe.js needs, minted server-side), `syncPayments` (reconcile
 * against the provider, which also DROPS what it no longer holds) and
 * `setDefaultPaymentMethod` (written at the provider before the local flag) —
 * and `stripePublishableKey`, read from `import.meta.env` here rather than asked
 * of the gateway, because that variable is baked into this bundle and the
 * gateway has no view of the bundle that is running.
 *
 * FOURTH PASS, 2026-09-04 — THE PAYMENT WRITES ARE SEALED (ADR 0110 addendum)
 * ---------------------------------------------------------------------------
 * `PATCH /payment-methods/:id/default` and `DELETE /payment-methods/:id` now
 * REDEEM a one-time seal rather than trusting the role alone, so both writes
 * here take an optional `challenge` and carry it in `X-Seal-Challenge`.
 * `mintPaymentSeal` is the mint, and it is called from `HoldToApprove`'s
 * `onChallenge` — when the gesture begins, never at the moment of the write.
 * The parameter is optional only so a caller that has not been converted still
 * COMPILES and receives the gateway's refusal in words; it is not optional in
 * practice, because the gateway refuses without it.
 *   PLAN     `GET /organizations/locations/:id` now selects and returns
 *            `subscription_tier` (organizations.service.ts). The page's most
 *            visible em dash is a figure.
 *
 * The same endpoint also gained the role check it was missing: `getLocation`
 * calls `assertManagerOrOwner` now, so the read posture matches the write
 * posture and the page's copy can state a server rule instead of describing a
 * gap between them.
 *
 * THE SESSION IS READ FROM THE TOKEN THIS BROWSER HOLDS
 * ----------------------------------------------------
 * There is no session table in this product: `POST /auth/logout` blacklists the
 * token presented with it (auth/services/token-blacklist.service.ts) and nothing
 * records a device, an address or a last-seen. So the only session this page can
 * name is the one it is running in, and it names it from real evidence — the
 * `iat`/`exp` claims of the JWT in localStorage and this browser's own
 * user-agent. Every other device is UNKNOWN, and the Security register says so
 * in one line instead of drawing an empty devices list that would read as
 * "you are signed in nowhere else".
 */

import { useCallback, useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth, type RestaurantBranch, type User } from '../../../contexts/AuthContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { apiClient } from '../../../services/api/client';
import { profileApi, type LinkedProviders } from '../../../services/api/profile';
import {
  integrationsApi,
  type IntegrationCatalogEntry,
  type IntegrationConnection,
  type IntegrationId,
} from '../../../services/api/integrations';
import { apiMessage, describeDevice } from './pf-format';
import { stripePublishableKey } from './stripe-js';
import { useMudavymDesign } from '../../../lib/mudavym/useMudavymDesign';

/** What a read is: not asked, in flight, answered, or refused. */
export type ReadState = 'idle' | 'loading' | 'ok' | 'error';

export interface LocationRecord {
  name: string;
  city: string;
  billingEmail: string;
  billingPhone: string;
  /** `restaurants.subscription_tier`. Null when the column is empty. */
  subscriptionTier: string | null;
}

/** What the last probe of a server found. Every field is evidence or null. */
export interface McpProbeVM {
  status: 'ok' | 'unreachable' | 'refused' | 'protocol_error' | 'unconfigured';
  detail: string | null;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  /** Null when tools were never read; `[]` when the server offers none. */
  tools: { name: string; title: string | null; description: string | null }[] | null;
  /** What the server reported, which may exceed `tools.length` when capped. */
  toolCount: number | null;
}

/** One declared model-context server, as `/mcp-connections` returns it. */
export interface McpServerVM {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  createdAt: string;
  /** When it last ANSWERED. Null until a probe completes; never moved by a
   *  probe that failed. */
  lastUsedAt: string | null;
  /** When it was last CALLED, answered or not. Null until probed. */
  lastProbeAt: string | null;
  revokedAt: string | null;
  /** The GRANT's state — not the server's health, which is `probe`. */
  status: 'active' | 'revoked';
  /** Whether a credential is stored. The value is never on the wire. */
  hasSecret: boolean;
  secretSetAt: string | null;
  /** Null when never probed. Never a benign default. */
  probe: McpProbeVM | null;
  /**
   * The READER's own consent, and how many people have given theirs.
   *
   * Modelled here because it is the one part of this register that is the
   * PERSON's (ADR 0114 §2: the house declares, each person consents). Every
   * other field above describes an attachment the house owns and only a
   * manager may change.
   *
   * Optional, because a gateway that has not been redeployed does not send it
   * and a defaulted `{given: false}` would print "you have not consented"
   * about a question nobody asked. `ConsentRegister` renders the absence as
   * words, not as a false.
   */
  consent?: { given: boolean; at: string | null; liveCount: number };
}

/**
 * What this DEPLOYMENT can do with a model-context server, as opposed to what
 * this house has declared. Read from `GET /mcp-connections/runtime`.
 */
export interface McpRuntimeVM {
  secretStorage: { configured: boolean; reason: string | null };
  invocation: { enabled: boolean; reason: string };
  probeTimeoutMs: number;
}

/** One instrument on file. Today there are none, and the provider says why. */
export interface PaymentMethodVM {
  id: string;
  kind: 'card' | 'bank_account' | 'apple_pay' | 'invoice' | 'other';
  brand: string | null;
  last4: string | null;
  exp: string | null;
  isDefault: boolean;
  provider: string;
  createdAt: string;
  /**
   * Stripe's own type string, verbatim. Our register offers four kinds and the
   * provider has roughly thirty, so an unmapped instrument is `kind: 'other'`
   * and the row prints this instead of pretending it is a card.
   */
  providerType: string | null;
  /**
   * When the row was last confirmed against the provider. Everything above
   * except the id is a CACHED COPY of the provider's answer, so the row says
   * when it last agreed with Stripe rather than asserting a present tense.
   * Null means never confirmed.
   */
  syncedAt: string | null;
  /** Whether the provider reported it under a live key. Null when unknown. */
  livemode: boolean | null;
}

/**
 * The provider behind the payment register. `connected: false` with a reason is
 * the difference between an empty register and an impossible one.
 */
export interface PaymentProviderVM {
  id: string;
  connected: boolean;
  reason: string | null;
  /** 'test' | 'live' from the secret key's own prefix. Null when no key. */
  mode: 'test' | 'live' | 'unknown' | null;
  secretKeyPresent: boolean;
  webhookSecretPresent: boolean;
  apiVersion: string;
  /**
   * When a signed delivery last arrived. NULL IS NOT HEALTH — a webhook secret
   * being set is not a webhook working, and if the endpoint was never
   * registered at Stripe everything looks fine until a card is removed there
   * and this register goes on showing it.
   */
  webhookLastReceivedAt: string | null;
  webhookLastEventType: string | null;
  /** Null exactly when a delivery is on record. Otherwise it says why not. */
  webhookReason: string | null;
}

/**
 * The one session this page can name: the browser it is running in.
 *
 * Every field is either evidence or null. `device` is null when the user-agent
 * matched nothing we recognise; `signedInAt`/`expiresAt` are null when the token
 * is absent or its payload will not decode. Nulls render as em dashes.
 */
export interface SessionVM {
  device: string | null;
  signedInAt: string | null;
  expiresAt: string | null;
  /** False when there was no decodable token to read at all. */
  readable: boolean;
}

/**
 * One row of the Connections register, whatever rail it sits on.
 *
 * `unbuilt` and `unprovisioned` are the pair that matter, and conflating them
 * was the exact fault this page exists to remove:
 *
 *   `unbuilt`        nothing exists. No table, no route, no code. The four
 *                    Security rows (session list, 2FA, passkeys, API tokens).
 *   `unprovisioned`  it is BUILT and it is not switched on. The payment
 *                    register has a table, a module and three working routes;
 *                    what is missing is one provider credential. Drawing that
 *                    with the same "Not built" chip as a feature with zero code
 *                    behind it understates the work and misdescribes the fix —
 *                    one is a build, the other is a decision and an env var.
 */
export type ConnectionState =
  | 'connected'
  | 'available'
  | 'unavailable'
  | 'unbuilt'
  | 'unprovisioned'
  | 'unknown';

export interface WorkspaceVM {
  id: IntegrationId;
  label: string;
  providerLabel: string;
  description: string;
  state: ConnectionState;
  /** Present only when `state === 'connected'`. */
  account: string | null;
  connectedAt: string | null;
  /** Scopes actually granted (connected) — never the requested list. */
  grantedScopes: string[];
  /** What we would ask for, from the server's own disclosure. */
  requestedScopes: { scope: string; label: string; reason: string }[];
  notRequested: string[];
  /** Non-null exactly when the control is disabled. */
  blockedReason: string | null;
}

/**
 * Promote the gateway's own sentence onto `.message`, and rethrow the SAME
 * object.
 *
 * A sealed write answers 403 with a whole sentence — which check failed and
 * that nothing was changed (`common/seal/seal-subject.ts:100-124`). Axios puts
 * that sentence in `response.data.message` and "Request failed with status
 * code 403" in `.message`, and every caller in this directory reads `.message`.
 * Without this, the one refusal the seal exists to produce would reach the
 * operator as a status code — the same failure as an empty register standing in
 * for an unread one (ADR 0020).
 *
 * The same error object is returned rather than a fresh `Error` so `response`,
 * `status` and `isAxiosError` survive for anything that branches on them.
 */
function spoken(e: unknown): unknown {
  if (e && typeof e === 'object') {
    (e as { message?: string }).message = apiMessage(e);
  }
  return e;
}

function readState(q: UseQueryResult<unknown>, enabled: boolean): ReadState {
  if (!enabled) return 'idle';
  if (q.isError) return 'error';
  if (q.data !== undefined) return 'ok';
  return 'loading';
}

/**
 * The current session, from the token this browser is holding.
 *
 * Reads the JWT's `iat`/`exp` claims — signed values the gateway put there, not
 * anything this page decided — and this browser's user-agent. Nothing here is a
 * network call and nothing is stored; every failure path returns nulls, which
 * the page renders as dashes rather than as a plausible-looking device row.
 */
function readCurrentSession(): SessionVM {
  const device =
    typeof navigator === 'undefined' ? null : describeDevice(navigator.userAgent);
  let token: string | null = null;
  try {
    token = typeof localStorage === 'undefined' ? null : localStorage.getItem('accessToken');
  } catch {
    token = null; // storage disabled — unknown, not "signed out"
  }
  if (!token) return { device, signedInAt: null, expiresAt: null, readable: false };
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as {
      iat?: number;
      exp?: number;
    };
    const at = (s?: number) =>
      typeof s === 'number' && Number.isFinite(s) ? new Date(s * 1000).toISOString() : null;
    return {
      device,
      signedInAt: at(payload.iat),
      expiresAt: at(payload.exp),
      readable: true,
    };
  } catch {
    return { device, signedInAt: null, expiresAt: null, readable: false };
  }
}

export function useProfileNextData() {
  const {
    user,
    activeRestaurantId,
    activeRole,
    availableRestaurants,
    setActiveRestaurantId,
    refreshBranches,
    logout,
  } = useAuth();
  const { theme, setTheme } = useTheme();

  /**
   * Recomputed on every render rather than memoised: `exp` is a countdown and a
   * stale "expires in" is a worse answer than a recomputed one. It costs a
   * base64 decode.
   */
  const session = readCurrentSession();

  const uid = user?.userId ?? '';
  const rid = activeRestaurantId ?? '';
  const effectiveRole = activeRole ?? user?.role ?? null;
  const isManagerOrOwner = effectiveRole === 'owner' || effectiveRole === 'manager';

  /* ── read 1: the account record ─────────────────────────────────────── */

  const meQ = useQuery({
    queryKey: ['profile-next-me', rid, uid],
    queryFn: () => profileApi.getMe(),
    enabled: !!uid,
    staleTime: 30_000,
  });

  /* ── read 2: the restaurant record ───────────────────────────────────
   *
   * Gated on `isManagerOrOwner`, and now the SERVER agrees. Until 2026-09-03
   * `getLocation` checked organisation membership and stopped while
   * `updateLocation` called `assertManagerOrOwner`, so the write posture was
   * manager/owner and the read posture was any member — and this page had to
   * say, awkwardly, that the withholding was its own choice (gap G8). The check
   * now runs on both sides (organizations.service.ts, `getLocation` →
   * `assertManagerOrOwner(..., "read the restaurant record")`), so skipping the
   * fetch for staff mirrors a rule the endpoint enforces rather than inventing
   * one, and the copy says the server refuses.
   *
   * The same read now returns `subscription_tier`, which is why the Payment
   * register can name the plan.
   */

  /**
   * THE COLLAPSE (2026-09-04). The two HOUSE reads stop when `/connections` is
   * routed, because the two registers that consumed them have moved there.
   *
   * `locationQ` fed Register VI (the restaurant record) and Register V's plan
   * line; `paymentsQ` fed Register V. Nothing else on this page reads either —
   * measured by grepping `locationState|data.location|refetchLocation` and
   * `paymentMethods|paymentProvider` across `profile/next/*.tsx`, which hit
   * only `HouseRegister.tsx` and `PaymentRegister.tsx`.
   *
   * The honest limitation: `useMudavymDesign` has no settled state, so with the
   * per-restaurant FLAG (rather than the localStorage override, which resolves
   * synchronously) both reads still fire once on first paint before the verdict
   * arrives. This removes the steady-state reads, not the first pair. Giving the
   * hook a tri-state is a change to a file every gated page shares and is not
   * this pass's to make — filed in `profile.md` §13.
   */
  const connectionsRouted = useMudavymDesign('connections');
  const locationEnabled = isManagerOrOwner && !!rid && !connectionsRouted;
  const locationQ = useQuery({
    queryKey: ['profile-next-location', rid, uid],
    queryFn: async (): Promise<LocationRecord> => {
      const { data } = await apiClient.get<{
        id: string;
        name: string;
        city: string | null;
        email: string | null;
        phone: string | null;
        subscriptionTier?: string | null;
      }>(`/organizations/locations/${rid}`);
      // No `?? activeBranch.name` anywhere in this function, deliberately.
      return {
        name: data?.name ?? '',
        city: data?.city ?? '',
        billingEmail: data?.email ?? '',
        billingPhone: data?.phone ?? '',
        // `?? null` and never `?? 'free'`: a gateway that has not been
        // redeployed yet omits the field, and an omitted plan is unknown.
        subscriptionTier: data?.subscriptionTier ?? null,
      };
    },
    enabled: locationEnabled,
    staleTime: 30_000,
  });

  /* ── read 3+4: the workspace integrations ───────────────────────────── */

  const catalogQ = useQuery({
    queryKey: ['profile-next-integration-catalog', rid, uid],
    queryFn: () => integrationsApi.getCatalog(),
    enabled: !!uid,
    staleTime: 300_000,
  });
  const connectionsQ = useQuery({
    queryKey: ['profile-next-integration-connections', rid, uid],
    queryFn: () => integrationsApi.getConnections(),
    enabled: !!uid,
    staleTime: 60_000,
  });

  /**
   * Two ways the connection register can fail to answer, and both must read as
   * "unknown" rather than "nothing connected":
   *
   *  - the request itself failed (`connectionsQ.isError`);
   *  - it succeeded and returned a bare `[]` against a non-empty catalogue.
   *    `listConnections` returns one row per catalogued integration on success
   *    and `[]` on a swallowed query error
   *    (integrations-oauth.service.ts:485-488), so an empty array there is a
   *    failed read wearing the costume of an answer.
   */
  const connectionsUnreadable =
    connectionsQ.isError ||
    (connectionsQ.data !== undefined &&
      connectionsQ.data.length === 0 &&
      (catalogQ.data?.length ?? 0) > 0);

  const workspace: WorkspaceVM[] = useMemo(() => {
    const catalog: IntegrationCatalogEntry[] = catalogQ.data ?? [];
    const byId = new Map<IntegrationId, IntegrationConnection>(
      (connectionsQ.data ?? []).map((c) => [c.integrationId, c]),
    );
    return catalog.map((entry) => {
      const conn = byId.get(entry.id);
      let state: ConnectionState;
      let blockedReason: string | null = null;
      if (connectionsUnreadable) {
        state = 'unknown';
        blockedReason =
          'The connection register could not be read, so this row makes no claim either way.';
      } else if (conn?.connected) {
        state = 'connected';
      } else if (!entry.available) {
        state = 'unavailable';
        blockedReason = entry.unavailableReason ?? 'This deployment cannot offer it yet.';
      } else {
        state = 'available';
      }
      return {
        id: entry.id,
        label: entry.label,
        providerLabel: entry.providerLabel,
        description: entry.description,
        state,
        account: conn?.account ?? null,
        connectedAt: conn?.connectedAt ?? null,
        grantedScopes: conn?.connected ? (conn.scopes ?? []) : [],
        requestedScopes: entry.scopes ?? [],
        notRequested: entry.notRequested ?? [],
        blockedReason,
      };
    });
  }, [catalogQ.data, connectionsQ.data, connectionsUnreadable]);

  /* ── read 5: model-context servers ──────────────────────────────────
   *
   * New this pass. The endpoint THROWS on a query error rather than returning
   * `[]` (mcp-connections.service.ts), so — unlike the workspace rail — this
   * register never has to infer a failure from an empty answer: an empty list
   * here genuinely means no server is declared, and a failed read is an error
   * state with the gateway's own words in it.
   */

  const mcpQ = useQuery({
    queryKey: ['profile-next-mcp', rid, uid],
    queryFn: async (): Promise<McpServerVM[]> => {
      const { data } = await apiClient.get<McpServerVM[]>('/mcp-connections');
      return Array.isArray(data) ? data : [];
    },
    enabled: !!uid && !!rid,
    staleTime: 30_000,
  });

  /* ── read 5a: what this DEPLOYMENT can do about them ──────────────────
   *
   * Separate from the list on purpose. An absent `MCP_CONNECTION_SECRET_KEY`
   * is a sentence beside one disabled field, not a failure of the whole
   * register — so it must not be able to take the list down with it, and the
   * list must not have to carry deployment configuration on every row.
   *
   * There is NO client-side default. A failed read leaves this null and the
   * register says the deployment did not report its state; inventing
   * `{configured: false}` here would print a confident sentence about a
   * question that was never answered.
   */
  const mcpRuntimeQ = useQuery({
    queryKey: ['profile-next-mcp-runtime', rid, uid],
    queryFn: async (): Promise<McpRuntimeVM> => {
      const { data } = await apiClient.get<McpRuntimeVM>('/mcp-connections/runtime');
      return data;
    },
    enabled: !!uid && !!rid,
    staleTime: 300_000,
  });

  /* ── read 6: payment methods, and the provider behind them ──────────── */

  const paymentsQ = useQuery({
    queryKey: ['profile-next-payments', rid, uid],
    queryFn: async (): Promise<{
      provider: PaymentProviderVM;
      methods: PaymentMethodVM[];
    }> => {
      const { data } = await apiClient.get<{
        provider: PaymentProviderVM;
        methods: PaymentMethodVM[];
      }>('/payment-methods');
      return {
        provider: data?.provider ?? {
          id: 'stripe',
          connected: false,
          // Reached only if the gateway answered without the field — which is
          // itself an unknown, so it must not read as a confident "connected".
          reason:
            'The payment provider did not report its state, so this page cannot say whether one is connected.',
          mode: null,
          secretKeyPresent: false,
          webhookSecretPresent: false,
          apiVersion: '—',
          webhookLastReceivedAt: null,
          webhookLastEventType: null,
          webhookReason:
            'The deployment did not report its webhook state either, so nothing is claimed about deliveries.',
        },
        methods: Array.isArray(data?.methods) ? data.methods : [],
      };
    },
    // Stops when Register V moves to `/connections` — see `connectionsRouted`.
    enabled: !!uid && !!rid && !connectionsRouted,
    staleTime: 30_000,
  });

  /* ── sign-in methods, from the record we already fetched ────────────── */

  const linked: LinkedProviders | null = meQ.data?.linkedProviders ?? null;
  const hasPassword: boolean | null = meQ.data?.hasPassword ?? null;

  /**
   * The server refuses to unlink the last credential
   * (auth.service.ts:2043-2058, "Cannot unlink your only sign-in method").
   * Counting them here lets the page state that rule BEFORE the click instead
   * of surfacing it as a failed request afterwards. Null while the record is
   * unknown — a count we could not read is not a count of one.
   */
  const credentialCount: number | null =
    hasPassword === null || linked === null
      ? null
      : (hasPassword ? 1 : 0) + (linked.google ? 1 : 0) + (linked.microsoft ? 1 : 0);

  const connectedWorkspaceCount: number | null =
    catalogQ.data === undefined || connectionsQ.data === undefined || connectionsUnreadable
      ? null
      : workspace.filter((w) => w.state === 'connected').length;

  /* ── writes ─────────────────────────────────────────────────────────── */

  const saveAccount = useCallback(async (name: string, phone: string) => {
    await profileApi.updateMe({ name: name.trim(), phone: phone.trim() || undefined });
    await meQ.refetch();
  }, [meQ]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await profileApi.changePassword({
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      await meQ.refetch();
    },
    [meQ],
  );

  const unlinkProvider = useCallback(
    async (provider: 'google' | 'microsoft') => {
      await profileApi.unlinkProvider(provider);
      await meQ.refetch();
    },
    [meQ],
  );

  const refreshLinked = useCallback(async () => {
    await meQ.refetch();
  }, [meQ]);

  const disconnectWorkspace = useCallback(
    async (id: IntegrationId) => {
      await integrationsApi.disconnect(id);
      await connectionsQ.refetch();
    },
    [connectionsQ],
  );

  /**
   * Refuses on an unread record rather than writing a value nobody read.
   * This is the guard the shipping page does not have.
   */
  const saveRestaurant = useCallback(
    async (name: string, city: string) => {
      if (!rid) throw new Error('No active restaurant');
      if (locationQ.data === undefined) {
        throw new Error(
          'The restaurant record has not been read, so it cannot be written back.',
        );
      }
      await apiClient.patch(`/organizations/locations/${rid}`, {
        name: name.trim(),
        city: city.trim() || undefined,
      });
      await Promise.all([locationQ.refetch(), refreshBranches()]);
    },
    [rid, locationQ, refreshBranches],
  );

  const saveBillingContact = useCallback(
    async (email: string, phone: string) => {
      if (!rid) throw new Error('No active restaurant');
      if (locationQ.data === undefined) {
        throw new Error(
          'The restaurant record has not been read, so it cannot be written back.',
        );
      }
      await apiClient.patch(`/organizations/locations/${rid}`, {
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      await locationQ.refetch();
    },
    [rid, locationQ],
  );

  /* ── writes: the model-context register ─────────────────────────────── */

  const addMcpServer = useCallback(
    async (input: {
      name: string;
      url: string;
      scopes: string[];
      secret?: string;
    }) => {
      const secret = input.secret?.trim();
      await apiClient.post('/mcp-connections', {
        name: input.name.trim(),
        url: input.url.trim(),
        scopes: input.scopes,
        // Omitted rather than sent empty: the gateway refuses an empty secret,
        // and "no credential" is a different request from "a blank one".
        ...(secret ? { secret } : {}),
      });
      await mcpQ.refetch();
    },
    [mcpQ],
  );

  const revokeMcpServer = useCallback(
    async (id: string) => {
      await apiClient.delete(`/mcp-connections/${id}`);
      await mcpQ.refetch();
    },
    [mcpQ],
  );

  /**
   * Call one declared server and record what answered.
   *
   * The route returns 200 for a handshake that FAILED — the probe succeeded in
   * finding out the server is unreachable — so this resolves, the row comes back
   * carrying the failure, and the register prints it. Only a refusal by the
   * gateway itself (revoked, not yours, write failed) rejects.
   */
  const probeMcpServer = useCallback(
    async (id: string) => {
      await apiClient.post(`/mcp-connections/${id}/probe`);
      await mcpQ.refetch();
    },
    [mcpQ],
  );

  /** Set or clear one server's credential. `null` clears. */
  const setMcpSecret = useCallback(
    async (id: string, secret: string | null) => {
      await apiClient.put(`/mcp-connections/${id}/secret`, { secret });
      await mcpQ.refetch();
    },
    [mcpQ],
  );

  /**
   * The reader's OWN consent — the only model-context write on this page that
   * a staff member may make.
   *
   * `PUT /mcp-connections/:id/consent` takes no user id in any shape
   * (`mcp-connections.controller.ts:218-235`), so "record someone else's
   * consent" is not a request this API can express. It is deliberately NOT
   * gated on `assertCanManageRestaurant`, unlike declare / probe / secret /
   * revoke, which is why this one control stays on `/profile` when the three
   * house registers move to the manager-only `/connections` (ADR 0114 §2 and
   * §5).
   */
  const setMcpConsent = useCallback(
    async (id: string, given: boolean) => {
      await apiClient.put(`/mcp-connections/${id}/consent`, { given });
      await mcpQ.refetch();
    },
    [mcpQ],
  );

  /* ── writes: the payment register ────────────────────────────────────
   *
   * Present, and never reachable from the page while no provider is connected:
   * the form's submit is disabled and this would refuse anyway
   * (payment-methods.service.ts, 503 with the reason). It exists so that
   * connecting a provider is a credential and a hosted flow, not a rewrite.
   */

  /**
   * Mint the one-time seal a payment write has to carry back — at the moment
   * the hold BEGINS.
   *
   * THE SEAL IS REDEEMED, NOT ASSERTED (founder, 2026-09-04; ADR 0110's
   * addendum). `POST /payment-methods/seal-challenge` issues a 120-second
   * token bound to (this manager, this act, this instrument, and the brand and
   * last four the manager was looking at); `PATCH :id/default` and
   * `DELETE :id` each redeem it exactly once and refuse in words when it is
   * absent (`payment-methods.controller.ts:86-115`, `:124-179`).
   *
   * Called from `HoldToApprove`'s `onChallenge`, which is what guarantees the
   * timing: a token fetched by the same request it authorises is the assertion
   * model with extra steps, which is precisely what this replaced.
   *
   * It returns null instead of throwing. `HoldToApprove` reads null as "do not
   * approve" and says so on the control; a rejected promise there would
   * surface as an unhandled error while the operator was still holding the
   * button, and the gesture would look like it had worked.
   */
  const mintPaymentSeal = useCallback(
    async (
      act: 'set_default' | 'remove',
      methodId: string,
    ): Promise<string | null> => {
      try {
        const { data } = await apiClient.post<{ challenge?: string }>(
          '/payment-methods/seal-challenge',
          { act, methodId },
        );
        return data?.challenge ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  const removePaymentMethod = useCallback(
    async (id: string, challenge?: string | null) => {
      try {
        await apiClient.delete(
          `/payment-methods/${id}`,
          // The seal travels in a HEADER, never in the body: it is not one of
          // the arguments it is a seal over, and `DELETE` has no body here at
          // all. The gateway reads `x-seal-challenge`
          // (`payment-methods.controller.ts:285`).
          challenge ? { headers: { 'X-Seal-Challenge': challenge } } : undefined,
        );
      } catch (e) {
        throw spoken(e);
      }
      await paymentsQ.refetch();
    },
    [paymentsQ],
  );

  /**
   * Permission to STORE an instrument, not a payment.
   *
   * The client secret it returns authorises Stripe.js to attach ONE instrument
   * to ONE customer; it cannot charge, list or read, which is why it is safe in
   * a browser and why the card fields can live on Stripe's origin instead of in
   * this DOM. `POST /billing/setup-intent` refuses with 503 and the provider's
   * own sentence while `STRIPE_SECRET_KEY` is unset, so the panel's failure
   * text is the server's, never page prose.
   */
  const createSetupIntent = useCallback(async (): Promise<{
    clientSecret: string;
    setupIntentId: string;
    livemode: boolean;
  }> => {
    const { data } = await apiClient.post<{
      clientSecret: string;
      setupIntentId: string;
      livemode: boolean;
    }>('/billing/setup-intent', {});
    if (!data?.clientSecret) {
      throw new Error(
        'The provider answered without a client secret, so the card form cannot open. Nothing was stored.',
      );
    }
    return data;
  }, []);

  /**
   * Reconcile the register against the provider's list.
   *
   * Called right after a confirmation so the row appears without waiting for a
   * webhook, and callable on its own. It DROPS instruments the provider no
   * longer has — a sync that only inserted would leave the register showing a
   * card that cannot be charged.
   */
  const syncPayments = useCallback(async (): Promise<{
    syncedAt: string;
    kept: number;
    removed: number;
    note: string | null;
  }> => {
    const { data } = await apiClient.post<{
      syncedAt: string;
      kept: number;
      removed: number;
      note: string | null;
    }>('/billing/sync', {});
    await paymentsQ.refetch();
    return data;
  }, [paymentsQ]);

  /**
   * Which instrument the house is charged first. Written at the provider before
   * the local flag, so the page and the charge cannot disagree.
   */
  const setDefaultPaymentMethod = useCallback(
    async (id: string, challenge?: string | null) => {
      try {
        await apiClient.patch(
          `/payment-methods/${id}/default`,
          {},
          challenge ? { headers: { 'X-Seal-Challenge': challenge } } : undefined,
        );
      } catch (e) {
        throw spoken(e);
      }
      await paymentsQ.refetch();
    },
    [paymentsQ],
  );

  const leaveRestaurant = useCallback(async () => {
    if (!rid) throw new Error('No active restaurant');
    await apiClient.post('/auth/me/leave-restaurant', { restaurantId: rid });
    await refreshBranches();
  }, [rid, refreshBranches]);

  const deleteAccount = useCallback(async () => {
    await apiClient.delete('/auth/me');
    window.location.href = '/login';
  }, []);

  return {
    /* identity */
    user: user as User | null,
    role: effectiveRole,
    isManagerOrOwner,
    activeRestaurantId,
    memberships: availableRestaurants as RestaurantBranch[],
    switchRestaurant: setActiveRestaurantId,

    /* preferences */
    theme,
    setTheme,

    /* read 1 */
    meState: readState(meQ, !!uid),
    meError: meQ.isError ? apiMessage(meQ.error) : null,
    phone: meQ.data?.phone ?? '',
    hasPassword,
    linked,
    credentialCount,
    refetchMe: () => void meQ.refetch(),

    /* read 2 */
    locationState: readState(locationQ, locationEnabled),
    locationError: locationQ.isError ? apiMessage(locationQ.error) : null,
    location: locationQ.data ?? null,
    refetchLocation: () => void locationQ.refetch(),

    /* read 5 — model context */
    mcpState: readState(mcpQ, !!uid && !!rid),
    mcpError: mcpQ.isError ? apiMessage(mcpQ.error) : null,
    mcpServers: mcpQ.data ?? [],
    /**
     * Null while the deployment has not answered. NOT a default of
     * `{configured: false}`: "we have not asked" and "there is no key" are
     * different sentences and the register prints different ones.
     */
    mcpRuntime: mcpRuntimeQ.data ?? null,
    refetchMcp: () => {
      void mcpQ.refetch();
      void mcpRuntimeQ.refetch();
    },

    /* read 6 — payment */
    paymentsState: readState(paymentsQ, !!uid && !!rid && !connectionsRouted),
    paymentsError: paymentsQ.isError ? apiMessage(paymentsQ.error) : null,
    paymentMethods: paymentsQ.data?.methods ?? [],
    /**
     * Null while the register has not answered. NOT a default of
     * `{connected: false}`: "we have not asked yet" and "there is no provider"
     * are different sentences and the page prints different ones.
     */
    paymentProvider: paymentsQ.data?.provider ?? null,
    refetchPayments: () => void paymentsQ.refetch(),
    /**
     * The BROWSER's half of the Stripe credential, read here rather than asked
     * of the gateway. `VITE_STRIPE_PUBLISHABLE_KEY` is baked into this bundle
     * at build time and the gateway has no view of the bundle that is running,
     * so a server-reported value would be a guess. Null renders as a named
     * missing variable, not as a generic "not configured".
     */
    stripePublishableKey: stripePublishableKey(),

    /* the one session this page can name */
    session,
    signOut: logout,

    /* reads 3+4 */
    workspaceState: readState(catalogQ, !!uid),
    workspaceError: catalogQ.isError ? apiMessage(catalogQ.error) : null,
    workspace,
    connectionsUnreadable,
    connectedWorkspaceCount,
    refetchWorkspace: () => {
      void catalogQ.refetch();
      void connectionsQ.refetch();
    },

    /* writes */
    saveAccount,
    changePassword,
    unlinkProvider,
    refreshLinked,
    disconnectWorkspace,
    saveRestaurant,
    saveBillingContact,
    addMcpServer,
    revokeMcpServer,
    probeMcpServer,
    setMcpSecret,
    setMcpConsent,
    mintPaymentSeal,
    removePaymentMethod,
    createSetupIntent,
    syncPayments,
    setDefaultPaymentMethod,
    leaveRestaurant,
    deleteAccount,
  };
}

export type ProfileNextData = ReturnType<typeof useProfileNextData>;
