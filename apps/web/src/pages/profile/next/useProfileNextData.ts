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
 * WHAT IS NOT HERE
 * ----------------
 * No MCP read and no payment read, because neither backend exists — measured
 * 2026-09-02: zero matches for `mcp` and zero for `stripe` across
 * `apps/api-gateway/src`, `apps/web/src` and `supabase/migrations`, and no
 * billing/subscription/invoice table in any migration. The plan a restaurant
 * is on lives in `restaurants.subscription_tier`
 * (supabase/migrations/20260805000000_baseline_from_production.sql:3582,
 * default `pilot`) and is read by exactly one consumer, the model-spend
 * ceiling (common/model-client/model-client.service.ts:565-577). No endpoint
 * the browser can call returns it — `GET /organizations/locations/:id` selects
 * `id, name, city, email, phone` and nothing else
 * (organizations.service.ts:137-152). So the plan is UNKNOWN to this page, and
 * it renders as an em dash. The shipping page renders `Plan: Free` from a
 * hardcoded `useState('Free')` (Profile.tsx:90, rendered :723) — a label that matches neither
 * the column's default nor any measurement.
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
import { apiMessage } from './pf-format';

/** What a read is: not asked, in flight, answered, or refused. */
export type ReadState = 'idle' | 'loading' | 'ok' | 'error';

export interface LocationRecord {
  name: string;
  city: string;
  billingEmail: string;
  billingPhone: string;
}

/** One row of the Connections register, whatever rail it sits on. */
export type ConnectionState =
  | 'connected'
  | 'available'
  | 'unavailable'
  | 'unbuilt'
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

function readState(q: UseQueryResult<unknown>, enabled: boolean): ReadState {
  if (!enabled) return 'idle';
  if (q.isError) return 'error';
  if (q.data !== undefined) return 'ok';
  return 'loading';
}

export function useProfileNextData() {
  const {
    user,
    activeRestaurantId,
    activeRole,
    availableRestaurants,
    setActiveRestaurantId,
    refreshBranches,
  } = useAuth();
  const { theme, setTheme } = useTheme();

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
   * Gated on `isManagerOrOwner` HERE, by this page's own choice — not because
   * the endpoint is. `getLocation` checks organisation membership and stops
   * (organizations.service.ts:123-153); `assertManagerOrOwner` is called only
   * from `updateLocation` (:186). So the WRITE is genuinely manager/owner —
   * every field this page sends is in `touchesOps` (:178-187) — while the READ
   * is open to any member of the organisation. The page says so where it
   * declines to show the section, rather than implying the server is hiding
   * it. Filed as G8 in 06-pages/profile.md §9; the fix is in the gateway.
   */

  const locationEnabled = isManagerOrOwner && !!rid;
  const locationQ = useQuery({
    queryKey: ['profile-next-location', rid, uid],
    queryFn: async (): Promise<LocationRecord> => {
      const { data } = await apiClient.get<{
        id: string;
        name: string;
        city: string | null;
        email: string | null;
        phone: string | null;
      }>(`/organizations/locations/${rid}`);
      // No `?? activeBranch.name` anywhere in this function, deliberately.
      return {
        name: data?.name ?? '',
        city: data?.city ?? '',
        billingEmail: data?.email ?? '',
        billingPhone: data?.phone ?? '',
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
    leaveRestaurant,
    deleteAccount,
  };
}

export type ProfileNextData = ReturnType<typeof useProfileNextData>;
