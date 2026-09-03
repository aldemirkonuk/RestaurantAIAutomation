/**
 * SettingsNext data layer — every register on the page, through `apiClient`.
 *
 * Three rules this file exists to hold:
 *
 * 1. **Four states, never three.** Each register is a `Remote<T>` carrying
 *    `idle | loading | ok | error | denied`. A 403 is `denied` and says so in
 *    words; every other failure is `error` and says which register could not be
 *    read. Neither ever renders as an empty list (ADR 0020).
 * 2. **Tenant-keyed, and cleared on the way in.** Every fetch key contains
 *    `activeRestaurantId` (or the user id, for account-scoped registers) and
 *    the effect blanks `data` BEFORE the new request, so a branch switch can
 *    never leave the previous tenant's roster on screen.
 * 3. **Lazy by register.** A key is `null` until its section is open, so
 *    opening /settings costs the one fetch the open register needs — not ten.
 *
 * Every endpoint here is one this page's dossier already lists (06-pages/
 * settings.md §4/§11), reached with the authenticated `apiClient` — the legacy
 * page's hand-attached Bearer tokens are not reproduced.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/services/api/client';
import { useAuth, type RestaurantBranch } from '@/contexts/AuthContext';
import {
  integrationsApi,
  type IntegrationCatalogEntry,
  type IntegrationConnection,
} from '@/services/api/integrations';
import {
  getPosProviders,
  getPosStatus,
  type PosProvidersResponse,
  type PosStatusResponse,
} from '@/services/api/posHub';
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from '@/services/api/notifications';
import type { UserPreferences } from '@/hooks/useUserPreferences';
import { errText, httpStatus, type SectionId } from './st-format';

/* ── Remote ──────────────────────────────────────────────────────────────── */

export type RemoteStatus = 'idle' | 'loading' | 'ok' | 'error' | 'denied';

export interface Remote<T> {
  status: RemoteStatus;
  data: T | null;
  error: string | null;
  reload: () => void;
  /** Replace the held value after a confirmed write (never optimistically). */
  set: (value: T) => void;
}

function useRemote<T>(key: string | null, fetcher: () => Promise<T>): Remote<T> {
  const [state, setState] = useState<{ status: RemoteStatus; data: T | null; error: string | null }>({
    status: 'idle',
    data: null,
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key) {
      setState({ status: 'idle', data: null, error: null });
      return;
    }
    let cancelled = false;
    // Blank first: a tenant switch must not show the previous tenant's rows
    // while the new request is in flight.
    setState({ status: 'loading', data: null, error: null });
    fetcherRef
      .current()
      .then((value) => {
        if (!cancelled) setState({ status: 'ok', data: value, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: httpStatus(e) === 403 ? 'denied' : 'error',
          data: null,
          error: errText(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((value: T) => setState({ status: 'ok', data: value, error: null }), []);
  return { ...state, reload, set };
}

/* ── Row shapes the gateway returns ──────────────────────────────────────── */

export interface TeamMemberRow {
  user_id: string;
  role: string;
  users: { name?: string; email?: string } | null;
  /**
   * When this person's access row was written — i.e. when they were let in.
   *
   * `members.service.ts:68-70` has always selected it; this type stopped at
   * `role` and dropped it, so the roster printed an em dash over a date it had
   * been handed. It is a GRANTED date, not a changed date: `user_restaurant_access`
   * (baseline_from_production.sql:5810-5822) has `created_at` and `valid_from`
   * and no update column, so a later role change moves nothing here. The row
   * says "granted", never "changed" — see `Provenance.verb`.
   */
  created_at?: string | null;
  /** Whether the access is still live. The endpoint filters to `true`. */
  is_active?: boolean;
}

export interface PendingInviteRow {
  id: string;
  code: string;
  role: string;
  expires_at: string;
  /**
   * When the invite was issued. `members.service.ts:101-107` has always put it
   * on the wire; this type used to stop at `expires_at` and drop it, so the
   * page rendered "an invite records no issued date" over data it had been
   * handed (audit BLOCKER 4).
   */
  created_at?: string | null;
}

export interface TeamRegister {
  members: TeamMemberRow[];
  /** null = the invite book was refused for this role, said in words. */
  invites: PendingInviteRow[] | null;
  invitesDenied: boolean;
}

export interface ChainRow {
  id: string;
  name: string;
  /**
   * The chain's own last-changed date, now genuinely on the wire.
   *
   * `restaurant_chains.updated_at` has always existed
   * (baseline_from_production.sql:5053-5060); `getChainsForUser` selected only
   * `id, name, cuisine_type`, so the page printed "the chains table records no
   * last-changed date" — a true absence blamed on the wrong layer (audit
   * BLOCKER 2). The gateway now selects and returns it, and `renameChain`
   * stamps it, because that table has no `BEFORE UPDATE` trigger and the column
   * would otherwise have held the creation time for ever
   * (`organizations.service.ts` — `RestaurantChain.updated_at`, `renameChain`).
   * Optional here only so a stale gateway degrades to the em dash rather than
   * to a wrong date.
   */
  updated_at?: string | null;
}

/**
 * A branch as the session holds it, plus the date the gateway now returns.
 *
 * `AuthContext`'s `RestaurantBranch` is the session's own type and is not this
 * page's to widen; the branch objects themselves are passed through from the
 * response verbatim (`contexts/AuthContext.tsx:321-326` assigns `response.data`
 * with no field mapping), so `updated_at` arrives on the object even though the
 * declared type has no name for it. `restaurants.updated_at` is maintained by
 * `update_restaurants_updated_at BEFORE UPDATE`
 * (baseline_from_production.sql:12300), so it is a real last-changed date.
 */
export type BranchWithDate = RestaurantBranch & { updated_at?: string | null };

export function branchUpdatedAt(b: RestaurantBranch): string | null {
  return (b as BranchWithDate).updated_at ?? null;
}

export interface SenderIdentityRow {
  id: string;
  body: string;
  type: string;
  /**
   * The gateway's `TemplateResponseDto` is camelCase (`mapRow`,
   * restaurant-templates.service.ts:110-120) and there is no case-converting
   * response interceptor on `apiClient`. Reading `updated_at` here made the
   * em dash fire on every real response, reporting a present date as absent
   * (audit BLOCKER 5). Both spellings are declared so a future server-side
   * alias does not silently re-break it, and the reader prefers camelCase.
   */
  updatedAt?: string | null;
  updated_at?: string | null;
}

/** The sign-off row's date, whichever spelling the gateway used. */
export function senderUpdatedAt(row: SenderIdentityRow | null): string | null {
  return row?.updatedAt ?? row?.updated_at ?? null;
}

export interface PrefsRegister {
  preferences: UserPreferences;
  /** The whole preference record's date — the gateway does not date rows. */
  updatedAt: string | null;
}

export interface PosRegister {
  providers: PosProvidersResponse;
  status: PosStatusResponse | null;
  /** The status read failed on its own; the provider list still answered. */
  statusError: string | null;
}

export interface IntegrationsRegister {
  catalog: IntegrationCatalogEntry[];
  connections: IntegrationConnection[];
}

/* ── Writes ──────────────────────────────────────────────────────────────── */

export interface Writer {
  /** Key of the write in flight, or null. */
  busy: string | null;
  /** Last failure, kept until the next attempt. Rendered, never swallowed. */
  failed: { key: string; message: string } | null;
  run: (key: string, fn: () => Promise<void>) => Promise<boolean>;
  clear: () => void;
}

function useWriter(): Writer {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setFailed(null);
    try {
      await fn();
      return true;
    } catch (e) {
      // Nothing is assumed saved. The caller re-reads or reverts; the message
      // goes on screen rather than into a toast that scrolls away.
      setFailed({ key, message: errText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }, []);
  const clear = useCallback(() => setFailed(null), []);
  return { busy, failed, run, clear };
}

/* ── The hook ────────────────────────────────────────────────────────────── */

async function fetchTeam(restaurantId: string, canSeeInvites: boolean): Promise<TeamRegister> {
  const { data: members } = await apiClient.get<TeamMemberRow[]>(
    `/restaurants/${restaurantId}/members`,
  );
  const rows = Array.isArray(members) ? members : [];
  if (!canSeeInvites) return { members: rows, invites: null, invitesDenied: true };
  try {
    const { data } = await apiClient.get<PendingInviteRow[]>(
      `/restaurants/${restaurantId}/invites`,
    );
    return { members: rows, invites: Array.isArray(data) ? data : [], invitesDenied: false };
  } catch (e) {
    // The roster answered; only the invite book refused. Say exactly that
    // rather than failing the whole register.
    if (httpStatus(e) === 403) return { members: rows, invites: null, invitesDenied: true };
    throw e;
  }
}

export function useSettingsNextData(active: SectionId) {
  const { user, activeRestaurantId, activeRole, availableRestaurants, refreshBranches } = useAuth();
  const rid = activeRestaurantId ?? null;
  const uid = user?.userId ?? null;
  const role = (activeRole ?? user?.role ?? null) as 'owner' | 'manager' | 'staff' | null;
  const canManage = role === 'owner' || role === 'manager';

  const tenantKey = useCallback(
    (section: SectionId) => (rid && active === section ? `${rid}:${section}` : null),
    [rid, active],
  );
  const accountKey = useCallback(
    (sections: SectionId[]) => (uid && sections.includes(active) ? `${uid}:${sections[0]}` : null),
    [uid, active],
  );

  const team = useRemote<TeamRegister>(tenantKey('team'), () => fetchTeam(rid as string, canManage));

  const flags = useRemote<Record<string, boolean>>(tenantKey('features'), async () => {
    const { data } = await apiClient.get<Record<string, boolean>>('/settings/feature-flags');
    return data ?? {};
  });

  const ical = useRemote<{ token: string }>(tenantKey('calendar'), async () => {
    const { data } = await apiClient.get<{ token: string }>('/calendar/ical-token');
    return data;
  });

  const sender = useRemote<SenderIdentityRow | null>(tenantKey('email'), async () => {
    const { data } = await apiClient.get<SenderIdentityRow[]>(`/restaurants/${rid}/templates`);
    return (Array.isArray(data) ? data : []).find((t) => t.type === 'sender_identity') ?? null;
  });

  const chains = useRemote<ChainRow[]>(tenantKey('locations'), async () => {
    const { data } = await apiClient.get<ChainRow[]>('/organizations/chains');
    return Array.isArray(data)
      ? data.map((c) => ({ id: c.id, name: c.name, updated_at: c.updated_at ?? null }))
      : [];
  });

  const pos = useRemote<PosRegister>(tenantKey('pos'), async () => {
    const providers = await getPosProviders();
    try {
      const status = await getPosStatus(rid as string);
      return { providers, status, statusError: null };
    } catch (e) {
      return { providers, status: null, statusError: errText(e) };
    }
  });

  // One preferences record serves three registers; the key is shared so moving
  // between them does not re-fetch it.
  const prefs = useRemote<PrefsRegister>(accountKey(['services', 'map', 'pos']), async () => {
    const { data } = await apiClient.get<{ preferences: UserPreferences; updatedAt?: string }>(
      `/users/${uid}/preferences`,
    );
    return { preferences: data?.preferences ?? {}, updatedAt: data?.updatedAt ?? null };
  });

  const notif = useRemote<NotificationPreferences>(accountKey(['notifications']), () =>
    fetchNotificationPreferences(uid as string),
  );

  const integrations = useRemote<IntegrationsRegister>(accountKey(['services']), async () => {
    const [catalog, connections] = await Promise.all([
      integrationsApi.getCatalog(),
      integrationsApi.getConnections(),
    ]);
    return { catalog, connections };
  });

  const writer = useWriter();

  const saveFlag = useCallback(
    (key: string, value: boolean) =>
      writer.run(key, async () => {
        const { data } = await apiClient.put<Record<string, boolean>>('/settings/feature-flags', {
          [key]: value,
        });
        // The server's answer replaces the map — never the value we hoped for.
        flags.set(data ?? {});
      }),
    [writer, flags],
  );

  const savePrefs = useCallback(
    (key: string, partial: Partial<UserPreferences>) =>
      writer.run(key, async () => {
        const { data } = await apiClient.patch<{ preferences: UserPreferences; updatedAt?: string }>(
          `/users/${uid}/preferences`,
          { preferences: partial },
        );
        prefs.set({ preferences: data?.preferences ?? {}, updatedAt: data?.updatedAt ?? null });
      }),
    [writer, prefs, uid],
  );

  const saveNotif = useCallback(
    (key: string, partial: Partial<Omit<NotificationPreferences, 'userId'>>) =>
      writer.run(key, async () => {
        notif.set(await updateNotificationPreferences(uid as string, partial));
      }),
    [writer, notif, uid],
  );

  const saveSender = useCallback(
    (name: string) =>
      writer.run('sender', async () => {
        const body = name.trim();
        const current = sender.data;
        if (current?.id) await apiClient.patch(`/restaurants/${rid}/templates/${current.id}`, { body });
        else
          await apiClient.post(`/restaurants/${rid}/templates`, {
            name: 'Sender identity',
            body,
            type: 'sender_identity',
          });
        sender.reload();
      }),
    [writer, sender, rid],
  );

  const sendTestEmail = useCallback(
    () => writer.run('test-email', async () => { await apiClient.post('/communications/test/email'); }),
    [writer],
  );

  const regenerateIcal = useCallback(
    () =>
      writer.run('ical', async () => {
        const { data } = await apiClient.post<{ token: string }>('/calendar/ical-token/regenerate');
        ical.set(data);
      }),
    [writer, ical],
  );

  const setMemberRole = useCallback(
    (memberUserId: string, newRole: string) =>
      writer.run(`role:${memberUserId}`, async () => {
        await apiClient.patch(`/restaurants/${rid}/members/${memberUserId}`, { role: newRole });
        team.reload();
        await refreshBranches();
      }),
    [writer, team, rid, refreshBranches],
  );

  const removeMember = useCallback(
    (memberUserId: string) =>
      writer.run(`remove:${memberUserId}`, async () => {
        await apiClient.delete(`/restaurants/${rid}/members/${memberUserId}`);
        team.reload();
        await refreshBranches();
      }),
    [writer, team, rid, refreshBranches],
  );

  const revokeInvite = useCallback(
    (code: string) =>
      writer.run(`invite:${code}`, async () => {
        await apiClient.delete(`/restaurants/${rid}/invites/${encodeURIComponent(code)}`);
        team.reload();
      }),
    [writer, team, rid],
  );

  const disconnectIntegration = useCallback(
    (id: IntegrationConnection['integrationId']) =>
      writer.run(`integration:${id}`, async () => {
        await integrationsApi.disconnect(id);
        integrations.reload();
      }),
    [writer, integrations],
  );

  const locations: RestaurantBranch[] = useMemo(
    () => availableRestaurants ?? [],
    [availableRestaurants],
  );

  return {
    /** Identity of the tenant every register above is keyed by. */
    restaurantId: rid,
    userId: uid,
    role,
    canManage,
    isOwner: role === 'owner',
    locations,
    refreshBranches,
    team, flags, ical, sender, chains, pos, prefs, notif, integrations,
    writer,
    saveFlag, savePrefs, saveNotif, saveSender, sendTestEmail, regenerateIcal,
    setMemberRole, removeMember, revokeInvite, disconnectIntegration,
  };
}

export type SettingsNextData = ReturnType<typeof useSettingsNextData>;
