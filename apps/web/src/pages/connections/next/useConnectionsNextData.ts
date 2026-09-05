/**
 * ConnectionsNext data — one read per register, and each one fails alone.
 *
 * WHY SEVEN QUERIES AND NOT ONE LEDGER ENDPOINT
 * ---------------------------------------------
 * A single `GET /connections/ledger` was the obvious build and it is the wrong
 * one. ADR 0020 requires that a failed read NAME the register it could not
 * read; one endpoint assembling seven sources has exactly two answers — the
 * whole page, or a 500 — so the till being unreadable would blank the payment
 * register too, and the page would say nothing about which of the seven had
 * gone. Seven queries mean seven independent honesty states, which is the
 * thing this surface exists to have. It costs seven requests on a page a
 * manager opens rarely. Recorded in ADR 0114 with the alternative.
 *
 * G20 — ONE CATALOGUE, NOT A FOURTH
 * ---------------------------------
 * `components/settings/IntegrationsAuth.tsx:161`,
 * `settings/next/ServicesSection.tsx:128` and
 * `profile/next/ConnectionsRegister.tsx:224` each render the OAuth catalogue
 * and each shows a different subset. This page adds no fourth: it reads
 * `GET /integrations/oauth/catalog`, the same route the other three read,
 * which is served from the one shared constant
 * (`apps/api-gateway/src/integrations/integrations-oauth.constants.ts:43-66`).
 * The list it shows is longer than theirs only because it also reads the four
 * registers none of them has ever shown.
 *
 * TENANT KEYING
 * -------------
 * The api client stamps `X-Restaurant-Id` from localStorage
 * (services/api/client.ts), so the header never reaches a query key on its own.
 * Every key below carries `activeRestaurantId`, and a branch switch therefore
 * cannot serve the previous tenant's ledger.
 *
 * ROLE
 * ----
 * `/connections` is manager-and-owner. The page refuses in words for anyone
 * else, and the two registers that would actually leak are gated at the
 * GATEWAY as well (G19: `GET /payment-methods` and `GET /billing/provider`
 * now run `assertCanManageRestaurant`, and `GET /integrations/oauth/
 * house-grants` was born gated). A client-side check alone would be a curtain.
 */

import { useCallback, useContext, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthContext } from '../../../contexts/AuthContext';
import { apiClient } from '../../../services/api/client';
import { stripePublishableKey } from '../../../components/mudavym/stripe-js';
import { readError } from './cx-format';

/* ── view models ──────────────────────────────────────────────────────── */

/** Whose an attachment is. The first of the four columns on every row. */
export type Owner = 'house' | 'person' | 'deployment' | 'public';

export interface PosStatusVM {
  unavailable: boolean;
  totalChecks: number | null;
  sources:
    | Array<{
        source: string;
        providerName?: string;
        checks?: number;
        open?: number;
        latest?: string | null;
      }>
    | null;
  windowDays: number;
}

/**
 * The provider's state, field-for-field as `payment-methods/dto` declares it
 * (`PaymentProviderState`, `payment-method.dto.ts:116-135`). Named against the
 * DTO rather than invented: a first draft of this file guessed a
 * `secrets: Record<string, boolean>` bag, and the row rendered "the provider
 * did not say which secrets it holds" while the gateway was saying exactly
 * which — a page inventing an absence out of its own naming mistake, which is
 * the fault this surface exists to catch, caught on the surface itself.
 */
export interface ProviderStateVM {
  connected: boolean;
  mode: string | null;
  reason: string | null;
  secretKeyPresent?: boolean;
  webhookSecretPresent?: boolean;
  apiVersion?: string;
  webhookLastReceivedAt?: string | null;
  webhookLastEventType?: string | null;
  webhookReason?: string | null;
}

export interface PaymentMethodVM {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

export interface SenderIdentityVM {
  address: string | null;
  scope: 'deployment' | 'house';
  configuredBy: string;
  resolvedFromProfile: boolean;
  perHouse: { supported: boolean; reason: string };
}

/** The four MCP behaviour hints, tri-state. Null = the server did not say. */
export interface McpAnnotationsVM {
  readOnlyHint: boolean | null;
  destructiveHint: boolean | null;
  idempotentHint: boolean | null;
  openWorldHint: boolean | null;
}

export interface McpToolGrantVM {
  toolName: string;
  /** The classification the GATE uses. Never looser than `declaredRead`. */
  writes: boolean;
  /**
   * What the SERVER declared. TRUE = it said readOnlyHint: true. FALSE = it
   * said otherwise. NULL = it said nothing, which carries the same permission
   * as FALSE and is a different fact — so the row shows which.
   */
  declaredRead: boolean | null;
  declaredAnnotations: McpAnnotationsVM | null;
  /** 'manager_override' = a declared read that a manager made a write. */
  classificationSource: 'declared' | 'manager_override';
  /** Set = this grant is REFUSED at the gate until a manager re-consents. */
  needsReconsentAt: string | null;
  /** What changed, in words. Never null when the timestamp is set. */
  needsReconsentReason: string | null;
  toolListHash: string | null;
  /**
   * What the LAST sealed call on this tool was worth. 'proven' = a one-time
   * challenge was redeemed for exactly that call; 'asserted' = the caller
   * claimed the seal and nothing checked it (every call before 2026-09-04);
   * null = no sealed call has ever been made, which is a third state and not a
   * quiet 'asserted'.
   */
  lastSeal: 'proven' | 'asserted' | null;
  grantedBy: string | null;
  grantedByName: string | null;
  grantedAt: string;
}

export interface McpServerVM {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  lastProbeAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'revoked';
  declaredBy: string | null;
  declaredByName: string | null;
  hasSecret: boolean;
  secretSetAt: string | null;
  consent: { given: boolean; at: string | null; liveCount: number };
  toolGrants: McpToolGrantVM[];
  probe: {
    status: 'ok' | 'unreachable' | 'refused' | 'protocol_error' | 'unconfigured';
    detail: string | null;
    serverName: string | null;
    serverVersion: string | null;
    protocolVersion: string | null;
    tools: Array<{
      name: string;
      title: string | null;
      description: string | null;
      annotations: McpAnnotationsVM | null;
    }> | null;
    toolCount: number | null;
  } | null;
}

export interface McpRuntimeVM {
  secretStorage: { configured: boolean; reason: string | null };
  invocation: { enabled: boolean; reason: string };
  probeTimeoutMs: number;
}

export interface HouseGrantVM {
  connectionId: string;
  integrationId: string;
  provider: string;
  label: string;
  ownerUserId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  account: string | null;
  scopes: string[];
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  houseAccess: {
    revoked: boolean;
    at: string | null;
    by: string | null;
    byName: string | null;
    reason: string | null;
  };
}

export interface CatalogEntryVM {
  id: string;
  provider: string;
  label: string;
  providerLabel: string;
  description: string;
  available: boolean;
  unavailableReason: string | null;
  /**
   * The integration's OWN scope disclosure and its "never asked for" list,
   * straight off `INTEGRATION_DEFINITIONS` (`integrations-oauth.controller.ts:69-70`).
   * The page's permission bullets are built from these and from nothing else,
   * so one integration cannot print another's promise (`cx-permissions.ts`).
   * Optional because a gateway that predates them sends neither, and an absent
   * disclosure must render as the em dash rather than as a guess.
   */
  scopes?: Array<{ scope: string; label: string; reason?: string }> | null;
  notRequested?: string[] | null;
}

/** A query as this page consumes it: never "empty" when it means "unread". */
export interface Register<T> {
  data: T | null;
  loading: boolean;
  /** The gateway's own words, or null. Never a sentence this file invented. */
  error: string | null;
  /** 403 specifically: the read was refused because of who is asking. */
  refused: boolean;
}

interface AxiosLikeError {
  response?: { status?: number; data?: { message?: string | string[] } };
  message?: string;
}

function isRefusal(e: unknown): boolean {
  return (e as AxiosLikeError)?.response?.status === 403;
}

function toRegister<T>(q: {
  data: T | undefined;
  isLoading: boolean;
  error: unknown;
}): Register<T> {
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.error ? readError(q.error) : null,
    refused: q.error ? isRefusal(q.error) : false,
  };
}

/* ── the hook ─────────────────────────────────────────────────────────── */

export function useConnectionsNextData() {
  const auth = useContext(AuthContext);
  const qc = useQueryClient();
  const rid = auth?.activeRestaurantId ?? null;
  const uid = (auth?.user as { user_id?: string; id?: string } | undefined)?.user_id
    ?? (auth?.user as { id?: string } | undefined)?.id
    ?? null;
  const role = (auth?.user as { role?: string } | undefined)?.role ?? null;
  const isManager = role === 'owner' || role === 'manager';

  const on = Boolean(rid) && isManager;

  /* read 1 — the till. `unavailable` is the field that stops a dead read
     reading as a quiet integration (ADR 0067, pos-hub.service.ts:1230). */
  const posQ = useQuery({
    queryKey: ['connections-next-pos', rid],
    queryFn: async (): Promise<PosStatusVM> => {
      const { data } = await apiClient.get<PosStatusVM>(`/pos-hub/status/${rid}`);
      return data;
    },
    enabled: on,
    staleTime: 60_000,
  });

  /* read 2 — the payment provider, and what is on file behind it. */
  const providerQ = useQuery({
    queryKey: ['connections-next-provider', rid],
    queryFn: async (): Promise<ProviderStateVM> => {
      const { data } = await apiClient.get<ProviderStateVM>('/billing/provider');
      return data;
    },
    enabled: on,
    staleTime: 300_000,
  });

  const paymentsQ = useQuery({
    queryKey: ['connections-next-payments', rid],
    queryFn: async (): Promise<{ provider: ProviderStateVM; methods: PaymentMethodVM[] }> => {
      const { data } = await apiClient.get<{
        provider: ProviderStateVM;
        methods: PaymentMethodVM[];
      }>('/payment-methods');
      return { provider: data.provider, methods: data.methods ?? [] };
    },
    enabled: on,
    staleTime: 60_000,
  });

  /* read 3 — the address the letters leave from. */
  const senderQ = useQuery({
    queryKey: ['connections-next-sender', rid],
    queryFn: async (): Promise<SenderIdentityVM> => {
      const { data } = await apiClient.get<SenderIdentityVM>(
        '/communications/sender-identity',
      );
      return data;
    },
    enabled: on,
    staleTime: 300_000,
  });

  /* read 4 — the calendar feed. Provisioned on read by the gateway, which is
     why this is a GET that can create: the token exists so the row can name
     it, and naming a feed that does not exist yet would be worse. */
  const icalQ = useQuery({
    queryKey: ['connections-next-ical', rid],
    queryFn: async (): Promise<{ token: string }> => {
      const { data } = await apiClient.get<{ token: string }>('/calendar/ical-token');
      return data;
    },
    enabled: on,
    staleTime: 300_000,
  });

  /* read 5 — model-context servers, and what this deployment can do with one. */
  const mcpQ = useQuery({
    queryKey: ['connections-next-mcp', rid, uid],
    queryFn: async (): Promise<McpServerVM[]> => {
      const { data } = await apiClient.get<McpServerVM[]>('/mcp-connections');
      return Array.isArray(data) ? data : [];
    },
    enabled: on,
    staleTime: 30_000,
  });

  const mcpRuntimeQ = useQuery({
    queryKey: ['connections-next-mcp-runtime', rid],
    queryFn: async (): Promise<McpRuntimeVM> => {
      const { data } = await apiClient.get<McpRuntimeVM>('/mcp-connections/runtime');
      return data;
    },
    enabled: on,
    staleTime: 300_000,
  });

  /* read 6 — every personal grant recorded against this house.
     `unattributed` is carried through deliberately: a live grant with no
     recorded restaurant belongs to someone who works here and is on nobody's
     house page, and a list that dropped it silently would be incomplete in
     exactly the way this surface exists to prevent. */
  const houseGrantsQ = useQuery({
    queryKey: ['connections-next-house-grants', rid],
    queryFn: async (): Promise<{ grants: HouseGrantVM[]; unattributed: number }> => {
      const { data } = await apiClient.get<{
        grants: HouseGrantVM[];
        unattributed: number;
      }>('/integrations/oauth/house-grants');
      return { grants: data.grants ?? [], unattributed: data.unattributed ?? 0 };
    },
    enabled: on,
    staleTime: 60_000,
  });

  /* read 7 — the shared catalogue (G20: the SAME route the other three
     surfaces read, not a fourth copy). */
  const catalogQ = useQuery({
    queryKey: ['connections-next-catalog', rid],
    queryFn: async (): Promise<CatalogEntryVM[]> => {
      const { data } = await apiClient.get<{ integrations: CatalogEntryVM[] }>(
        '/integrations/oauth/catalog',
      );
      return data.integrations ?? [];
    },
    enabled: on,
    staleTime: 600_000,
  });

  /* ── writes ─────────────────────────────────────────────────────────── */

  const invalidate = useCallback(
    (key: string) => {
      void qc.invalidateQueries({ queryKey: [key, rid] });
      void qc.invalidateQueries({ queryKey: [key, rid, uid] });
    },
    [qc, rid, uid],
  );

  /**
   * Re-read the model-context register.
   *
   * Added by the collapse (2026-09-04) for `HouseServerControls`, which owns
   * declare and revoke since they left `/profile`. It is exposed rather than
   * given a mutation of its own so that component keeps NO react-query
   * dependency: it is a panel that can be lifted out whole the day the
   * ownership fork in ADR 0114 is answered, and a component holding a
   * `useQueryClient` cannot be rendered by a test that mocks this hook.
   */
  const refetchMcp = useCallback(() => {
    invalidate('connections-next-mcp');
    invalidate('connections-next-mcp-runtime');
  }, [invalidate]);

  const regenerateFeed = useMutation({
    mutationFn: async () => {
      await apiClient.post('/calendar/ical-token/regenerate');
    },
    onSuccess: () => invalidate('connections-next-ical'),
  });

  const setHouseGrantAccess = useMutation({
    mutationFn: async (v: { connectionId: string; houseUses: boolean; reason?: string }) => {
      await apiClient.put(
        `/integrations/oauth/house-grants/${v.connectionId}/access`,
        { houseUses: v.houseUses, reason: v.reason ?? null },
      );
    },
    onSuccess: () => invalidate('connections-next-house-grants'),
  });

  const setConsent = useMutation({
    mutationFn: async (v: { id: string; given: boolean }) => {
      await apiClient.put(`/mcp-connections/${v.id}/consent`, { given: v.given });
    },
    onSuccess: () => invalidate('connections-next-mcp'),
  });

  /**
   * Grant a tool, or re-consent to one whose declaration moved.
   *
   * `sealed` is not a second route. Re-consenting IS granting again — against
   * the declaration the server offers NOW — and a separate endpoint would have
   * been a second place for the classification rule to be applied slightly
   * differently. The gateway decides whether the seal was required; the page
   * sends it when it is re-consenting, which is the only case where it is.
   */
  /**
   * Ask the gateway for the one-time seal, at the moment the hold BEGINS.
   *
   * Not a mutation: it changes nothing the page renders, and a `useMutation`
   * here would put a pending flag on a request whose only visible effect is
   * that the gesture completes. It returns null on failure rather than
   * throwing, because `HoldToApprove` reads null as "do not approve" and says
   * so — a rejected promise there would surface as an unhandled error while
   * the operator was still holding the button.
   */
  const grantSeal = useCallback(
    async (v: { id: string; tool: string; writes: boolean }): Promise<string | null> => {
      try {
        const { data } = await apiClient.post<{ challenge: string }>(
          `/mcp-connections/${v.id}/tools/${encodeURIComponent(v.tool)}/grant-seal`,
          { writes: v.writes },
        );
        return data?.challenge ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  const grantTool = useMutation({
    mutationFn: async (v: {
      id: string;
      tool: string;
      writes: boolean;
      /**
       * The redeemed-once seal from `grantSeal`. There is no `sealed` boolean
       * to send any more: the gateway derives whether a grant was sealed by
       * redeeming this token, and a client that could assert it was the flaw
       * the seal exists to close (audit, 2026-09-04).
       */
      challenge?: string;
    }) => {
      await apiClient.put(
        `/mcp-connections/${v.id}/tools/${encodeURIComponent(v.tool)}`,
        { writes: v.writes, challenge: v.challenge },
      );
    },
    onSuccess: () => invalidate('connections-next-mcp'),
  });

  /* ── the payment register's two writes, both sealed ───────────────────
   *
   * G-C9, half-closed (2026-09-04). The collapse moved Register II here and
   * left both controls disabled, because the client that performs them stayed
   * behind on `/profile`. They are here now — and they arrive already sealed,
   * because ADR 0110's addendum made `PATCH /payment-methods/:id/default` and
   * `DELETE /payment-methods/:id` REDEEM a one-time token rather than trust the
   * role alone. Adding a card is still not here: that needs Stripe's own card
   * fields, which is a panel and not a request (see the row's stop note).
   */

  /**
   * Mint the seal, when the hold BEGINS.
   *
   * Not a mutation, for the same reason `grantSeal` is not: it changes nothing
   * the page renders. It returns null instead of throwing because
   * `HoldToApprove` reads null as "do not approve" and says so on the control.
   */
  const paymentSeal = useCallback(
    async (v: {
      act: 'set_default' | 'remove';
      methodId: string;
    }): Promise<string | null> => {
      try {
        const { data } = await apiClient.post<{ challenge?: string }>(
          '/payment-methods/seal-challenge',
          { act: v.act, methodId: v.methodId },
        );
        return data?.challenge ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * The same mint, for the act that has no instrument.
   *
   * `create` approves putting ONE instrument on this house's register, so its
   * subject is the register and no `methodId` is sent. It is a separate member
   * from `paymentSeal` above only because `CardPanelClient` asks for the
   * positional shape and the row controls already use the object one; both call
   * the same route.
   */
  const mintPaymentSeal = useCallback(
    async (act: 'create'): Promise<string | null> => {
      try {
        const { data } = await apiClient.post<{ challenge?: string }>(
          '/payment-methods/seal-challenge',
          { act },
        );
        return data?.challenge ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * The seal travels in a HEADER on both writes — it is not one of the
   * arguments it is a seal over, and `DELETE` carries no body here at all.
   * `payment-methods.controller.ts` reads `x-seal-challenge` on both.
   */
  const setDefaultPayment = useMutation({
    mutationFn: async (v: { methodId: string; challenge?: string | null }) => {
      await apiClient.patch(
        `/payment-methods/${v.methodId}/default`,
        {},
        v.challenge ? { headers: { 'X-Seal-Challenge': v.challenge } } : undefined,
      );
    },
    onSuccess: () => invalidate('connections-next-payments'),
  });

  const removePayment = useMutation({
    mutationFn: async (v: { methodId: string; challenge?: string | null }) => {
      await apiClient.delete(
        `/payment-methods/${v.methodId}`,
        v.challenge ? { headers: { 'X-Seal-Challenge': v.challenge } } : undefined,
      );
    },
    onSuccess: () => invalidate('connections-next-payments'),
  });

  /* ── adding a card: the two routes the panel actually walks ───────────
   *
   * G-C9's other half, closed 2026-09-05 ("port the card panel to /connections
   * now"). `StripeCardPanel` is shared with `/profile` and asks a page for
   * exactly these two functions (`CardPanelClient`), so this hook grows the two
   * members rather than the page growing a second copy of the panel.
   *
   * BOTH OF THESE NOW CARRY THE SEAL (G-PAY-SETUP closed, 2026-09-05).
   * `POST /billing/setup-intent` REDEEMS a `create` seal before it asks the
   * provider for anything and stamps the spent seal's id onto the intent;
   * `POST /billing/sync` names that intent and has the provider prove the id
   * back. So the pairing cannot be authored in this browser: the panel mints at
   * the hold that OPENS the form, because the client secret is the capability
   * and it exists the moment the form opens.
   */

  /**
   * Permission to STORE an instrument, not a payment.
   *
   * The client secret authorises Stripe.js to attach ONE instrument to ONE
   * customer; it cannot charge, list or read. `POST /billing/setup-intent`
   * answers 503 with the provider's own sentence while `STRIPE_SECRET_KEY` is
   * unset — which is this deployment's state — so the panel's failure text is
   * the server's, never page prose.
   */
  const createSetupIntent = useCallback(async (
    challenge: string,
  ): Promise<{
    clientSecret: string;
    setupIntentId: string;
    livemode: boolean;
  }> => {
    // A refused mint answers 403 with a whole sentence naming the check that
    // failed. Axios hides it in `response.data.message`, so it is lifted here:
    // the panel prints `.message`, and a status code is not an explanation.
    let data: {
      clientSecret?: string;
      setupIntentId: string;
      livemode: boolean;
    } | undefined;
    try {
      ({ data } = await apiClient.post<{
        clientSecret: string;
        setupIntentId: string;
        livemode: boolean;
      }>(
        '/billing/setup-intent',
        {},
        // The seal travels in a HEADER, never in the body: it is not one of the
        // arguments it is a seal over. The gateway reads `x-seal-challenge` and
        // REDEEMS before it asks the provider for anything
        // (`billing.controller.ts`, `setupIntent`).
        { headers: { 'X-Seal-Challenge': challenge } },
      ));
    } catch (e) {
      throw new Error(readError(e));
    }
    if (!data?.clientSecret) {
      throw new Error(
        'The provider answered without a client secret, so the card form cannot open. Nothing was stored.',
      );
    }
    return {
      clientSecret: data.clientSecret,
      setupIntentId: data.setupIntentId,
      livemode: data.livemode,
    };
  }, []);

  /**
   * Reconcile the register against the provider's list.
   *
   * Called right after a confirmation so the row appears without waiting for a
   * webhook. It DROPS instruments the provider no longer has — a sync that only
   * inserted would leave the register showing a card that cannot be charged.
   *
   * The refetch is awaited, not merely invalidated: the panel prints the count
   * the sync returned and the register beside it must already agree, or the two
   * would state different numbers of instruments in the same eyeful.
   */
  const syncPayments = useCallback(async (
    setupIntentId?: string,
  ): Promise<{
    syncedAt: string;
    kept: number;
    removed: number;
    note: string | null;
    provenance: 'sealed-intent' | 'reconcile-only';
  }> => {
    const { data } = await apiClient.post<{
      syncedAt: string;
      kept: number;
      removed: number;
      note: string | null;
      provenance: 'sealed-intent' | 'reconcile-only';
      // Naming the intent is what lets the gateway read the spent seal's id
      // back FROM STRIPE and prove this person opened that card form. Omitting
      // it is the register's plain refresh, and `provenance` says which ran.
    }>('/billing/sync', setupIntentId ? { setupIntentId } : {});
    await paymentsQ.refetch();
    return data;
  }, [paymentsQ]);

  const revokeTool = useMutation({
    mutationFn: async (v: { id: string; tool: string }) => {
      await apiClient.delete(
        `/mcp-connections/${v.id}/tools/${encodeURIComponent(v.tool)}`,
      );
    },
    onSuccess: () => invalidate('connections-next-mcp'),
  });

  const probeServer = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/mcp-connections/${id}/probe`);
    },
    onSuccess: () => invalidate('connections-next-mcp'),
  });

  /* ── the ledger sentence's own arithmetic ───────────────────────────── */

  const tally = useMemo(() => {
    const mcp = mcpQ.data ?? [];
    const grants = houseGrantsQ.data?.grants ?? [];
    const liveMcp = mcp.filter((s) => s.status === 'active');

    /**
     * Every count is `null` when the register behind it could not be read.
     * A zero here would be the page's own headline lying — "nothing can act"
     * is the most reassuring sentence on the surface and the one that must
     * never be produced by a failed request.
     */
    const houseCount =
      posQ.error || providerQ.error || senderQ.error || icalQ.error || mcpQ.error
        ? null
        : [
            (posQ.data?.totalChecks ?? 0) > 0 ? 1 : 0,
            providerQ.data?.connected ? 1 : 0,
            senderQ.data?.address ? 1 : 0,
            icalQ.data?.token ? 1 : 0,
            liveMcp.length,
          ].reduce((a, b) => a + b, 0);

    return {
      house: houseCount,
      persons: houseGrantsQ.error ? null : grants.length,
      /** How many can spend. Zero is MEASURED here, not assumed. */
      canSpend:
        providerQ.error || paymentsQ.error
          ? null
          : providerQ.data?.connected
            ? (paymentsQ.data?.methods.length ?? 0)
            : 0,
      /** How many may call a tool: live grants across live servers. */
      mayCallATool: mcpQ.error
        ? null
        : liveMcp.reduce((n, s) => n + s.toolGrants.length, 0),
      /** Of those, how many can change the world outside this app. */
      mayWrite: mcpQ.error
        ? null
        : liveMcp.reduce(
            (n, s) => n + s.toolGrants.filter((g) => g.writes).length,
            0,
          ),
      publicToAnyone: icalQ.error ? null : icalQ.data?.token ? 1 : 0,
      houseHasLetGoOf: houseGrantsQ.error
        ? null
        : grants.filter((g) => g.houseAccess.revoked).length,
    };
  }, [
    posQ.data, posQ.error,
    providerQ.data, providerQ.error,
    paymentsQ.data, paymentsQ.error,
    senderQ.data, senderQ.error,
    icalQ.data, icalQ.error,
    mcpQ.data, mcpQ.error,
    houseGrantsQ.data, houseGrantsQ.error,
  ]);

  return {
    restaurantId: rid,
    userId: uid,
    role,
    isManager,
    pos: toRegister(posQ),
    provider: toRegister(providerQ),
    payments: toRegister(paymentsQ),
    sender: toRegister(senderQ),
    ical: toRegister(icalQ),
    mcp: toRegister(mcpQ),
    mcpRuntime: toRegister(mcpRuntimeQ),
    houseGrants: toRegister(houseGrantsQ),
    catalog: toRegister(catalogQ),
    tally,
    regenerateFeed,
    setHouseGrantAccess,
    setConsent,
    grantSeal,
    grantTool,
    revokeTool,
    probeServer,
    paymentSeal,
    setDefaultPayment,
    removePayment,
    /* `CardPanelClient` — the three members `StripeCardPanel` asks a page for. */
    mintPaymentSeal,
    createSetupIntent,
    syncPayments,
    /**
     * The BROWSER's half of the Stripe credential, read here rather than asked
     * of the gateway: `VITE_STRIPE_PUBLISHABLE_KEY` is baked into this bundle at
     * build time and the gateway has no view of the bundle that is running, so a
     * server-reported value would be a guess. Null renders as a named missing
     * variable, never as a generic "not configured".
     */
    stripePublishableKey: stripePublishableKey(),
    refetchMcp,
  };
}

export type ConnectionsNextData = ReturnType<typeof useConnectionsNextData>;
