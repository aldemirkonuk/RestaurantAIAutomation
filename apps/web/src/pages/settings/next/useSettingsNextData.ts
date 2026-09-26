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
 * 3. **Eager, all at once (changed 2026-09-17, sketch 109A).** The page used
 *    to be sixteen tab panels with one open at a time, so a key stayed `null`
 *    until its section was the active one — opening /settings cost one fetch,
 *    not sixteen. Direction A is a single interview: every register is on
 *    screen together, so there is no "closed" register left to defer a fetch
 *    for. Every key below is live as soon as its tenant/account id is known
 *    — except when `role === 'staff'`: tenant keys stay `null` so
 *    `GET /calendar/ical-token` (and the other house remotes) never fire for
 *    a viewer who is gated out of this page. SettingsNext gates staff before
 *    mounting this hook; the null keys are the belt if the hook is reached
 *    anyway. This is a real cost of the interview shape, stated once here
 *    rather than hidden: opening the page now issues on the order of fourteen
 *    requests instead of one.
 *    [Corrected 2026-09-19: this point previously said "the tally strip at
 *    the top counts across all of them" — true of sketch 109A's DRAWING, not
 *    of what was ever built. The tally shipped (`certaintyTally.ts`,
 *    `SettingsNext.tsx`'s own docblock) counts nine rows across five of these
 *    registers, not all of them; eager-fetch is justified on its own here —
 *    no closed register to defer for — without leaning on that wrong claim.]
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
import {
  restaurantsApi,
  type OperatingHours,
  type OperatingHoursResponse,
} from '@/services/api/restaurants';
import type { UserPreferences } from '@/hooks/useUserPreferences';
import { errText, httpStatus, type TermSource } from './st-format';

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


/* ── The fourth pass's three registers ───────────────────────────────────── */

/**
 * One term, with where it came from.
 *
 * Mirrors `apps/api-gateway/src/vendor-terms/vendor-terms.service.ts`'s
 * `TermCell`. Every optional field belongs to exactly one `source`, and the
 * component branches on `source` rather than on which fields happen to be
 * present — a cell with a `value` and no source would otherwise render as a
 * fact with no provenance, which is the one thing this register exists to make
 * impossible.
 */
export interface TermCell<T> {
  value: T | null;
  source: TermSource;
  statedBy?: { userId: string | null; name: string | null } | null;
  statedAt?: string | null;
  column?: string;
  n?: number;
  confidence?: 'high' | 'medium' | 'low';
  basis?: string;
  reason?: string;
  contradiction?: string | null;
}

export interface CutoffValue {
  time: string | null;
  offsetDays: number | null;
  notBefore?: string | null;
  notAfter?: string | null;
}

export interface VendorTermsRow {
  providerId: string;
  providerName: string;
  ordersInWindow: number;
  lastOrderedAt: string | null;
  deliveryWeekdays: TermCell<number[]>;
  orderCutoff: TermCell<CutoffValue>;
  minimumOrder: TermCell<number>;
  leadTimeDays: TermCell<number>;
  paymentTerms: TermCell<string>;
  notes: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  statedAt: string | null;
}

export interface SourceStatus {
  readable: boolean;
  reason: string | null;
  /** Null when unreadable — never 0. */
  rows: number | null;
}

export interface VendorTermsRegister {
  restaurantId: string;
  vendors: VendorTermsRow[];
  currency: { code: string; isColumnDefault: boolean };
  zone: { zone: string; isColumnDefault: boolean };
  windowDays: number;
  sources: { providers: SourceStatus; statedTerms: SourceStatus; orders: SourceStatus };
}

export type ApprovalRule = 'manager_ceiling' | 'new_vendor' | 'price_jump';

export interface ThresholdRow {
  rule: ApprovalRule;
  enabled: boolean;
  amountLimit: number | null;
  percentLimit: number | null;
  requiredRole: 'owner' | 'manager';
  setBy: { userId: string | null; name: string | null } | null;
  updatedAt: string | null;
}

export interface ThresholdsRegister {
  restaurantId: string;
  thresholds: ThresholdRow[];
  policyEmpty: boolean;
  readable: boolean;
  reason: string | null;
  retrospective: {
    counts: Array<{ rule: ApprovalRule; tested: number; wouldHaveFired: number }>;
    ordersRead: number;
    windowDays: number;
    readable: boolean;
    reason: string | null;
    caveat: string;
  };
  enforcement: { enforcedBy: string[]; wouldBeEnforcedAt: string; note: string };
}

export interface LedgerEntry {
  id: string;
  occurredAt: string | null;
  action: string;
  register: string | null;
  entityType: string;
  entityId: string | null;
  subject: string | null;
  actor: { userId: string | null; name: string | null; email: string | null };
  fields: Record<string, { from: unknown; to: unknown }>;
}

export interface LedgerRegister {
  restaurantId: string;
  entries: LedgerEntry[];
  readable: boolean;
  reason: string | null;
  oldestAt: string | null;
  recordingSince: string;
}

/**
 * The house's reporting currency, as `GET /settings/currency` answers it.
 *
 * Mirrors `HouseCurrencyReadout` (`apps/api-gateway/src/settings/
 * house-currency.service.ts`). Three states, never two: `readable: false` is a
 * failed READ, `code: null` is an unanswered QUESTION, and a code is an answer.
 * `country` is here so the page can derive the offered default from
 * `lib/countries.ts` — the gateway holds no country-to-currency table, so the
 * default is computed once, in one file, and is only ever WRITTEN once a person
 * has accepted the sentence that states it.
 */
export interface HouseCurrencyRegister {
  restaurantId: string;
  code: string | null;
  country: string | null;
  readable: boolean;
  reason: string | null;
  statedAt: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  /** Present on a write only. `false` = the change landed, the paper did not. */
  audited?: boolean;
  auditReason?: string | null;
}

/**
 * What holding stock costs this house, as `GET /settings/carrying-cost` answers.
 *
 * Mirrors `HouseCarryingCostReadout` (`apps/api-gateway/src/settings/
 * house-carrying-cost.service.ts`). Three states, never two: `readable: false`
 * is a failed READ, `percentPerMonth: null` is an unanswered QUESTION, and a
 * number is an answer.
 *
 * The number is a PERCENT PER MONTH. `0.75` is three quarters of one percent a
 * month — not 75, and not 0.0075. The gateway refuses both mis-spellings with
 * the same bounds the database's own CHECK holds.
 */
export interface HouseCarryingCostRegister {
  restaurantId: string;
  percentPerMonth: number | null;
  basis: string | null;
  readable: boolean;
  reason: string | null;
  statedAt: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  /** Present on a write only. `false` = the change landed, the paper did not. */
  audited?: boolean;
  auditReason?: string | null;
}

/**
 * Whether this house's /ask questions may be used for training, as
 * `GET /settings/ask-training` answers (ADR 0145, founder 2026-09-21, "Same as
 * the wine pool (Recommended)"). Mirrors `HouseAskTrainingReadout`
 * (`apps/api-gateway/src/settings/house-ask-training.service.ts`). Three
 * states: `readable: false` is a failed READ; `statedAt: null` means nobody has
 * answered and the default (not opted out) is in force; a date is an answer.
 */
export interface HouseAskTrainingRegister {
  restaurantId: string;
  optedOut: boolean;
  readable: boolean;
  reason: string | null;
  statedAt: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  /** Present on a write only. `false` = the change landed, the paper did not. */
  audited?: boolean;
  auditReason?: string | null;
}

/**
 * The recommendations digest sender's own preference row, as
 * `GET /analytics/recommendations/:restaurantId/digest` answers
 * (`analytics.controller.ts:1143`, `recommendation-actions.service.ts:285-297`).
 *
 * `recommendation_digest_prefs` is keyed one row per RESTAURANT — house-wide,
 * not per person, and one recipient email, not a list. The founder's brief for
 * this pass named "per-person frequency and weekday"; neither exists anywhere
 * in this table or this route (grepped 2026-09-17), so this register cannot
 * offer them — see the settings-build note's not_fixed for the exact question.
 *
 * `stated` is a field this pass ADDS to the gateway's response (small,
 * additive, backward compatible): the service's own defaults —
 * `digest_hour ?? 7`, `digest_min_urgency ?? "this_week"`
 * (`recommendation-actions.service.ts:294-295`) — made every never-written
 * house look like it had already answered "07:00, this week or sooner".
 * `stated` says whether a `recommendation_digest_prefs` row exists at all, so
 * the page can show empty controls with `Record` disabled rather than a
 * stored default dressed as an answer (ADR 0020).
 */
export interface DigestRegister {
  stated: boolean;
  digestEnabled: boolean;
  digestHour: number | null;
  digestMinUrgency: 'now' | 'this_week' | 'this_month' | null;
  recipientEmail: string | null;
  lastSentAt: string | null;
}

export interface SetDigestBody {
  digestEnabled?: boolean;
  digestHour?: number;
  digestMinUrgency?: 'now' | 'this_week' | 'this_month';
  recipientEmail?: string | null;
}

export interface SetVendorTermsBody {
  deliveryWeekdays?: number[] | null;
  orderCutoffTime?: string | null;
  orderCutoffOffsetDays?: number | null;
  minimumOrderAmount?: number | null;
  leadTimeDays?: number | null;
  paymentTerms?: string | null;
  notes?: string | null;
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

/**
 * Every register on the page, fetched together.
 *
 * No `active` parameter any more (removed 2026-09-17, sketch 109A) — see the
 * file header's rule 3. `tenantKey`/`accountKey` keep their old shape (a
 * per-register key namespaced by tenant or account id) because `useRemote`
 * still keys its cache on the string, and a stable per-register key is what
 * lets a branch switch blank exactly the registers that moved tenant.
 */
export function useSettingsNextData() {
  const { user, activeRestaurantId, activeRole, availableRestaurants, refreshBranches } = useAuth();
  const rid = activeRestaurantId ?? null;
  const uid = user?.userId ?? null;
  const role = (activeRole ?? user?.role ?? null) as 'owner' | 'manager' | 'staff' | null;
  const canManage = role === 'owner' || role === 'manager';

  const tenantKey = useCallback(
    // Staff never manage house settings; a live rid must not mint tenant
    // remotes (especially `/calendar/ical-token`) for them.
    (section: string) => (rid && role !== 'staff' ? `${rid}:${section}` : null),
    [rid, role],
  );
  const accountKey = useCallback(
    (sections: string[]) => (uid ? `${uid}:${sections[0]}` : null),
    [uid],
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

  // (2026-09-19, D5) `notification_preferences` is per (restaurant_id, user_id)
  // since ADR 0149 row 39, so this cannot share `accountKey`'s uid-only cache
  // bucket with the genuinely account-level registers above -- an
  // `accountKey` cache survives switching the active house, and the server
  // response for this endpoint does not (it derives the house from the
  // caller's token, per `notifications.controller.ts`'s `getPreferences`).
  // `tenantKey` re-keys on `rid`, so switching houses refetches instead of
  // reusing the previous house's preferences under the same key.
  const notif = useRemote<NotificationPreferences>(tenantKey('notifications'), () =>
    fetchNotificationPreferences(uid as string),
  );

  const integrations = useRemote<IntegrationsRegister>(accountKey(['services']), async () => {
    const [catalog, connections] = await Promise.all([
      integrationsApi.getCatalog(),
      integrationsApi.getConnections(),
    ]);
    return { catalog, connections };
  });

  // The three registers the fourth pass added. Each is tenant-keyed and lazy,
  // like every other one — opening /settings still costs the one fetch the open
  // register needs.
  const vendorTerms = useRemote<VendorTermsRegister>(tenantKey('vendor-terms'), async () => {
    const { data } = await apiClient.get<VendorTermsRegister>('/vendor-terms');
    return data;
  });

  const thresholds = useRemote<ThresholdsRegister>(tenantKey('thresholds'), async () => {
    const { data } = await apiClient.get<ThresholdsRegister>('/settings/approval-thresholds');
    return data;
  });

  const houseCurrency = useRemote<HouseCurrencyRegister>(tenantKey('currency'), async () => {
    const { data } = await apiClient.get<HouseCurrencyRegister>('/settings/currency');
    return data;
  });

  const houseCarryingCost = useRemote<HouseCarryingCostRegister>(
    tenantKey('carrying-cost'),
    async () => {
      const { data } = await apiClient.get<HouseCarryingCostRegister>(
        '/settings/carrying-cost',
      );
      return data;
    },
  );

  const houseAskTraining = useRemote<HouseAskTrainingRegister>(tenantKey('ask-training'), async () => {
    const { data } = await apiClient.get<HouseAskTrainingRegister>('/settings/ask-training');
    return data;
  });

  const ledger = useRemote<LedgerRegister>(tenantKey('ledger'), async () => {
    const { data } = await apiClient.get<LedgerRegister>('/settings-audit?limit=100');
    return data;
  });

  // Sketch 109A graft B: the hours editor gets its home on this page (ADR 0149
  // row 22). `restaurantsApi` is the same client `OperatingHoursSection.tsx`
  // (legacy) uses — `null` survives the round trip and is never coerced to
  // seven closed days (ADR 0093 D1).
  const hours = useRemote<OperatingHoursResponse>(tenantKey('hours'), () =>
    restaurantsApi.getOperatingHours(rid as string),
  );

  // Sketch 109A: "should it mail a recommendations digest?" (ADR 0149 row 26 —
  // build the sender). House-wide, one row, one recipient — see
  // `DigestRegister`'s own doc for what this deliberately cannot offer.
  const digest = useRemote<DigestRegister>(tenantKey('digest'), async () => {
    const { data } = await apiClient.get<DigestRegister>(
      `/analytics/recommendations/${rid}/digest`,
    );
    return data;
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

  const saveVendorTerms = useCallback(
    (providerId: string, body: SetVendorTermsBody) =>
      writer.run(`terms:${providerId}`, async () => {
        const { data } = await apiClient.put<{ readout: VendorTermsRegister }>(
          `/vendor-terms/${providerId}`,
          body,
        );
        // The server's answer replaces the register — never the value we hoped
        // for. The write recomputes every inference, so an optimistic patch
        // would show a stated term beside a stale contradiction.
        if (data?.readout) vendorTerms.set(data.readout);
        else vendorTerms.reload();
        // A term that moved is a row in the trail; the trail must not lag it.
        ledger.reload();
      }),
    [writer, vendorTerms, ledger],
  );

  const saveThreshold = useCallback(
    (rule: ApprovalRule, body: Omit<ThresholdRow, 'setBy' | 'updatedAt' | 'rule'>) =>
      writer.run(`threshold:${rule}`, async () => {
        const { data } = await apiClient.put<{ readout: ThresholdsRegister }>(
          '/settings/approval-thresholds',
          { rule, ...body },
        );
        if (data?.readout) thresholds.set(data.readout);
        else thresholds.reload();
        ledger.reload();
      }),
    [writer, thresholds, ledger],
  );

  /**
   * State the house's reporting currency.
   *
   * The code is always one a person picked or accepted — this function is never
   * called with a value the page worked out on its own. The server's answer
   * replaces the register rather than an optimistic patch, so a write whose
   * audit row failed shows that fact rather than a clean success.
   */
  const saveCurrency = useCallback(
    (code: string) =>
      writer.run('currency', async () => {
        const { data } = await apiClient.put<HouseCurrencyRegister>('/settings/currency', {
          code,
        });
        if (data) houseCurrency.set(data);
        else houseCurrency.reload();
        // A code that moved is a row in the trail; the trail must not lag it.
        ledger.reload();
      }),
    [writer, houseCurrency, ledger],
  );

  /**
   * State what holding stock costs this house.
   *
   * The percent is always one a person typed — this function is never called
   * with a figure the page worked out on its own, and there is no default
   * anywhere in the path. The server's answer replaces the register rather than
   * an optimistic patch, so a write whose audit row failed shows that fact.
   */
  const saveCarryingCost = useCallback(
    (percentPerMonth: number, basis: string | null) =>
      writer.run('carrying-cost', async () => {
        const { data } = await apiClient.put<HouseCarryingCostRegister>(
          '/settings/carrying-cost',
          basis === null ? { percentPerMonth } : { percentPerMonth, basis },
        );
        if (data) houseCarryingCost.set(data);
        else houseCarryingCost.reload();
        // A number that moved is a row in the trail; the trail must not lag it.
        ledger.reload();
      }),
    [writer, houseCarryingCost, ledger],
  );

  const saveAskTraining = useCallback(
    (optedOut: boolean) =>
      writer.run('ask-training', async () => {
        const { data } = await apiClient.put<HouseAskTrainingRegister>('/settings/ask-training', { optedOut });
        if (data) houseAskTraining.set(data);
        else houseAskTraining.reload();
        ledger.reload();
      }),
    [writer, houseAskTraining, ledger],
  );

  /**
   * Save the week — or `null`, an explicit "we do not know these hours".
   *
   * The key the gateway body ALWAYS carries is `operatingHours`, even when the
   * value is `null` — a body missing the key entirely is refused rather than
   * read as an erasure (`operating-hours.controller.ts` — `opts.explicit`).
   */
  const saveHours = useCallback(
    (next: OperatingHours | null) =>
      writer.run('hours', async () => {
        hours.set(await restaurantsApi.putOperatingHours(rid as string, next));
      }),
    [writer, hours, rid],
  );

  /**
   * State the digest — the value is always one a person chose. `digestHour`
   * and `digestMinUrgency` are optional on the body (the gateway upserts only
   * the keys present, `recommendation-actions.service.ts:301-329`), so a
   * partial patch never overwrites a field the caller did not touch.
   */
  const saveDigest = useCallback(
    (patch: SetDigestBody) =>
      writer.run('digest', async () => {
        const { data } = await apiClient.put<DigestRegister>(
          `/analytics/recommendations/${rid}/digest`,
          patch,
        );
        digest.set(data);
      }),
    [writer, digest, rid],
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
    vendorTerms, thresholds, ledger, houseCurrency, houseCarryingCost, houseAskTraining,
    hours, digest,
    writer,
    saveFlag, savePrefs, saveNotif, saveSender, sendTestEmail, regenerateIcal,
    setMemberRole, removeMember, revokeInvite, disconnectIntegration,
    saveVendorTerms, saveThreshold, saveCurrency, saveCarryingCost, saveAskTraining,
    saveHours, saveDigest,
  };
}

export type SettingsNextData = ReturnType<typeof useSettingsNextData>;
