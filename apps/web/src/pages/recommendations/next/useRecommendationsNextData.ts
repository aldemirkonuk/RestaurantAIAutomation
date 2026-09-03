/**
 * RecommendationsNext data — the page's only ASSERTED-authenticated read.
 *
 * Every request goes through `apiClient` (services/api/client.ts:58-73), whose
 * synchronous request interceptor stamps `Authorization: Bearer` and
 * `X-Restaurant-Id`. The legacy page shipped six raw `fetch` calls with no
 * bearer against a controller class-guarded on 2026-08-24
 * (analytics.controller.ts:44-51) and 401'd on every call; that transport bug
 * was repaired in-place on the legacy file by `58113e26` — this hook is the
 * redesign's own client, and `useRecommendationsNextData.test.tsx` asserts it
 * never reaches `fetch`.
 *
 * Honesty contract:
 *   phase 'loading' → still asking (skeleton, never a zero)
 *   phase 'failed'  → a FailureVM with the status; 401/403/other are three
 *                     different sentences, never one empty list
 *   phase 'ready'   → a real answer, including a real empty book
 * `updatedAt` is null for entries the disposition store has never seen, so
 * "how long it has stood" renders as an em dash on the standing leaf — the
 * feed carries no first-fired timestamp (page note §13).
 *
 * Tenant-keyed: every read is keyed by `activeRestaurantId` and a sequence
 * number, so a restaurant switch can never paint the previous tenant's rows.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { getTeamMembers } from '@/services/api/team';
import {
  failureOf,
  handOf,
  num,
  stakeOf,
  type FailureVM,
  type Hand,
  type StakeId,
} from './rec-format';

const BASE = '/analytics/recommendations';

export type Leaf = 'standing' | 'snoozed' | 'dismissed' | 'done' | 'history';
export type Disposition = 'active' | 'dismissed' | 'snoozed' | 'done';

export interface EntryVM {
  ruleKey: string;
  /** The observed number, restated by the rule that fired. */
  observation: string;
  /** The concrete thing to do. */
  recommendation: string;
  /** Why the action follows from the number. Absent on stored snapshots. */
  rationale: string | null;
  category: string;
  urgency: string;
  /** Axis 1 — what acting on it would change. Derived from the category. */
  stake: StakeId;
  /** Axis 3 — whose hand does it, and where the work lands. */
  hand: Hand;
  score: number | null;
  pinned: boolean;
  acted: boolean;
  status: Disposition;
  reason: string | null;
  snoozeUntil: string | null;
  feedback: 'helpful' | 'not_helpful' | null;
  assignedTo: string | null;
  assignedName: string | null;
  /** Axis 2 — when the store last touched it. null = never touched = unknown. */
  updatedAt: string | null;
}

export interface StateCounts {
  active: number;
  snoozed: number;
  dismissed: number;
  done: number;
}

export interface DigestPref {
  digestEnabled: boolean;
  digestHour: number;
  digestMinUrgency: string;
  recipientEmail: string | null;
  lastSentAt: string | null;
}

export interface TeamOption {
  id: string;
  name: string;
}

type Phase = 'loading' | 'ready' | 'failed';

function toEntry(raw: Record<string, unknown>, fallbackStatus: Disposition): EntryVM {
  const ruleKey = String(raw.ruleKey ?? '');
  const category = typeof raw.category === 'string' && raw.category ? raw.category : '';
  return {
    ruleKey,
    observation: typeof raw.observation === 'string' ? raw.observation : '',
    recommendation: typeof raw.recommendation === 'string' ? raw.recommendation : '',
    rationale: typeof raw.rationale === 'string' && raw.rationale ? raw.rationale : null,
    category,
    urgency: typeof raw.urgency === 'string' ? raw.urgency : '',
    stake: stakeOf(category),
    hand: handOf(ruleKey, category),
    score: num(raw.score),
    pinned: !!raw.pinned,
    acted: !!raw.acted || !!raw.actedAt,
    status: (raw.status as Disposition) ?? fallbackStatus,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    snoozeUntil: typeof raw.snoozeUntil === 'string' ? raw.snoozeUntil : null,
    feedback: (raw.feedback as EntryVM['feedback']) ?? null,
    assignedTo: typeof raw.assignedTo === 'string' ? raw.assignedTo : null,
    assignedName: typeof raw.assignedName === 'string' ? raw.assignedName : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

export interface RecommendationsData {
  leaf: Leaf;
  setLeaf: (l: Leaf) => void;
  phase: Phase;
  entries: EntryVM[];
  failure: FailureVM | null;
  counts: StateCounts | null;
  rulesEvaluated: number | null;
  generatedAt: string | null;
  /** undefined = not asked yet; null = the read failed. */
  digest: DigestPref | null | undefined;
  team: TeamOption[] | null | undefined;
  teamFailed: boolean;
  loadTeam: () => void;
  /** The last write the page performed, said in words. */
  note: string | null;
  undo: { ruleKey: string; label: string } | null;
  clearUndo: () => void;
  refetch: () => void;
  setDisposition: (
    entry: EntryVM,
    patch: Record<string, unknown>,
    said: string,
    removeFromLeaf: boolean,
  ) => Promise<void>;
  restore: (ruleKey: string) => Promise<void>;
  bulk: (entries: EntryVM[], patch: Record<string, unknown>, said: string) => Promise<void>;
}

export function useRecommendationsNextData(): RecommendationsData {
  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId ?? null;

  const [leaf, setLeaf] = useState<Leaf>('standing');
  const [phase, setPhase] = useState<Phase>('loading');
  const [entries, setEntries] = useState<EntryVM[]>([]);
  const [failure, setFailure] = useState<FailureVM | null>(null);
  const [counts, setCounts] = useState<StateCounts | null>(null);
  const [rulesEvaluated, setRulesEvaluated] = useState<number | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [digest, setDigest] = useState<DigestPref | null | undefined>(undefined);
  const [team, setTeam] = useState<TeamOption[] | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ ruleKey: string; label: string } | null>(null);
  const seq = useRef(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (which: Leaf) => {
      const mine = ++seq.current;
      setPhase('loading');
      setFailure(null);
      // A tenant switch must never leave the previous restaurant's rows on
      // screen while the new read is in flight.
      setEntries([]);
      if (!rid) return; // AuthContext resolves a beat after login — stay loading.
      try {
        if (which === 'standing') {
          const { data } = await apiClient.get<Record<string, unknown>>(`${BASE}/${rid}`);
          if (mine !== seq.current) return;
          const list = Array.isArray(data?.recommendations)
            ? (data.recommendations as Record<string, unknown>[])
            : [];
          setEntries(list.map((r) => toEntry(r, 'active')));
          setRulesEvaluated(num(data?.rulesEvaluated));
          setGeneratedAt(typeof data?.generatedAt === 'string' ? data.generatedAt : null);
          const sc = data?.stateCounts as Partial<StateCounts> | undefined;
          setCounts(
            sc
              ? {
                  active: num(sc.active) ?? 0,
                  snoozed: num(sc.snoozed) ?? 0,
                  dismissed: num(sc.dismissed) ?? 0,
                  done: num(sc.done) ?? 0,
                }
              : null,
          );
        } else {
          const url =
            which === 'history'
              ? `${BASE}/${rid}/history`
              : `${BASE}/${rid}/actions?status=${which}`;
          const { data } = await apiClient.get<Record<string, unknown>>(url);
          if (mine !== seq.current) return;
          const list = Array.isArray(data?.items) ? (data.items as Record<string, unknown>[]) : [];
          const fallback: Disposition = which === 'history' ? 'done' : (which as Disposition);
          setEntries(list.map((r) => toEntry(r, fallback)));
        }
        setPhase('ready');
      } catch (err) {
        if (mine !== seq.current) return;
        setFailure(failureOf(err));
        setPhase('failed');
      }
    },
    [rid],
  );

  useEffect(() => {
    void load(leaf);
  }, [load, leaf]);

  // Digest preference — read once per tenant, separately from the book, so a
  // digest failure never takes the entries down with it.
  useEffect(() => {
    let cancelled = false;
    setDigest(undefined);
    if (!rid) return;
    apiClient
      .get<DigestPref>(`${BASE}/${rid}/digest`)
      .then(({ data }) => {
        if (!cancelled) setDigest(data ?? null);
      })
      .catch(() => {
        if (!cancelled) setDigest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rid]);

  // The roster is only fetched when someone opens an assign menu.
  const loadTeam = useCallback(() => {
    if (!rid || team !== undefined) return;
    setTeam(null);
    getTeamMembers(rid)
      .then((rows) =>
        setTeam(
          (rows ?? []).map((m) => ({
            id: String((m as { id?: unknown }).id ?? ''),
            name: String((m as { display_name?: unknown }).display_name ?? 'Unnamed'),
          })),
        ),
      )
      .catch(() => setTeam(null));
  }, [rid, team]);

  const say = useCallback((text: string) => {
    setNote(text);
  }, []);

  const offerUndo = useCallback((ruleKey: string, label: string) => {
    setUndo({ ruleKey, label });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 8000);
  }, []);
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const snapshotOf = (e: EntryVM) => ({
    observation: e.observation,
    recommendation: e.recommendation,
    category: e.category,
    urgency: e.urgency,
  });

  const setDisposition = useCallback(
    async (entry: EntryVM, patch: Record<string, unknown>, said: string, removeFromLeaf: boolean) => {
      if (!rid) return;
      const before = entry;
      if (removeFromLeaf) setEntries((prev) => prev.filter((e) => e.ruleKey !== entry.ruleKey));
      else
        setEntries((prev) =>
          prev.map((e) => (e.ruleKey === entry.ruleKey ? { ...e, ...patch } : e)),
        );
      try {
        await apiClient.post(`${BASE}/${rid}/action`, {
          ruleKey: entry.ruleKey,
          ...patch,
          snapshot: snapshotOf(entry),
        });
        say(said);
        if (removeFromLeaf) offerUndo(entry.ruleKey, said);
      } catch (err) {
        const f = failureOf(err);
        // The write did not land — put the entry back rather than let the
        // page imply a disposition the server never stored.
        setEntries((prev) =>
          removeFromLeaf
            ? [before, ...prev.filter((e) => e.ruleKey !== before.ruleKey)]
            : prev.map((e) => (e.ruleKey === before.ruleKey ? before : e)),
        );
        say(
          f.expired
            ? 'Your session has expired — that was not saved. Sign in again.'
            : `Not saved (${f.message}) — the entry is back where it was.`,
        );
      }
    },
    [rid, say, offerUndo],
  );

  const restore = useCallback(
    async (ruleKey: string) => {
      if (!rid) return;
      try {
        await apiClient.post(`${BASE}/${rid}/action`, { ruleKey, status: 'active' });
        setUndo(null);
        say('Restored to the standing book.');
        void load(leaf);
      } catch (err) {
        say(`Could not restore it (${failureOf(err).message}).`);
      }
    },
    [rid, leaf, load, say],
  );

  const bulk = useCallback(
    async (list: EntryVM[], patch: Record<string, unknown>, said: string) => {
      if (!rid || list.length === 0) return;
      const keys = new Set(list.map((e) => e.ruleKey));
      const before = entries;
      setEntries((prev) => prev.filter((e) => !keys.has(e.ruleKey)));
      try {
        await apiClient.post(`${BASE}/${rid}/bulk-action`, {
          items: list.map((e) => ({ ruleKey: e.ruleKey, snapshot: snapshotOf(e) })),
          ...patch,
        });
        say(said);
        void load(leaf);
      } catch (err) {
        setEntries(before);
        say(`Nothing was saved (${failureOf(err).message}) — all ${list.length} entries are back.`);
      }
    },
    [rid, entries, leaf, load, say],
  );

  const refetch = useCallback(() => {
    void load(leaf);
  }, [load, leaf]);

  return {
    leaf,
    setLeaf,
    phase,
    entries,
    failure,
    counts,
    rulesEvaluated,
    generatedAt,
    digest,
    team,
    teamFailed: team === null,
    loadTeam,
    note,
    undo,
    clearUndo: () => setUndo(null),
    refetch,
    setDisposition,
    restore,
    bulk,
  };
}
