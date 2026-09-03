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
 * `firstSeenAt` is the first time a rule was ever shown, attached by the
 * gateway from `recommendation_impressions`; `updatedAt` is when the
 * disposition store last touched the entry. They are different facts and the
 * page says which one it is showing. Both null ⇒ an em dash, never a zero.
 *
 * Two stores, kept apart on purpose: `dismiss()` writes a SCOPED suppression
 * key to `recommendation_actions` (the gateway builds the key), and
 * `excludeDay()` writes a business date to `analytics_day_exclusions`. Hiding
 * a sentence and correcting an average are different acts, and a manager who
 * asked for both and got one is told which one landed.
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
  type SuppressionScope,
  type SuppressionVM,
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
  /**
   * The first time this rule was ever SHOWN, from `recommendation_impressions`
   * (gateway `attachFirstSeen`). Null when nothing recorded it — an em dash,
   * never today.
   */
  firstSeenAt: string | null;
  /** What the observation is about ("Wednesday"), when the rule names one. */
  subject: string | null;
  /** The period it covers at its grain ("d:2026-09-02"), when it has one. */
  periodKey: string | null;
  /**
   * The keys a dismissal writes, built by the gateway. Undefined only on rows
   * that came from the actions table (the dismissed/snoozed/history leaves),
   * where the stored `ruleKey` IS the key.
   */
  suppression: SuppressionVM | null;
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

/**
 * A goal as `analytics_goals` holds it (fourth pass, 2026-09-03).
 *
 * Read lazily — only when someone opens a goal sheet — for the one honest use
 * the page has for it: telling a manager that a goal on this metric ALREADY
 * exists before they set a second one. It is not a provenance link, because
 * there is no provenance to read: `analytics_goals` has no column that records
 * which recommendation a goal came from (baseline schema,
 * `20260805000000_baseline_from_production.sql:2157-2172`), so the page matches
 * on `metric_key` and says exactly that — "you already track this figure",
 * never "this recommendation is already a goal".
 */
export interface GoalRow {
  id: string;
  name: string;
  metricKey: string;
  targetValue: number | null;
  currentValue: number | null;
  deadline: string | null;
  status: string;
}

/** undefined = never asked · null = the read failed · [] = read, and empty. */
export type GoalsVM = GoalRow[] | null | undefined;

/** What a goal write answered. A failure carries the gateway's own sentence. */
export type GoalWrite =
  | { ok: true; goal: GoalRow }
  | { ok: false; message: string; expired: boolean };

/** Days the manager has ruled out of every baseline. */
export interface DayExclusion {
  businessDate: string;
  reason: string | null;
  createdAt: string | null;
}

/** One dismissal, as the sheet resolved it. Built in Entry, posted here. */
export interface DismissChoice {
  /** The reason code the manager picked. */
  reason: string;
  /** The scope they chose — and the one actually stored. */
  scope: SuppressionScope;
  /** The gateway-built key for that scope. The page never invents one. */
  key: string;
  /** A business date to also drop from the baselines, or null. */
  excludeDate: string | null;
  /** What will never be shown, in words — rendered back after the write. */
  said: string;
}

export interface ExclusionsVM {
  items: DayExclusion[];
  /** False = the store could not be read AT ALL. Not the same as empty. */
  readable: boolean;
  problem: string | null;
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
    firstSeenAt: typeof raw.firstSeenAt === 'string' ? raw.firstSeenAt : null,
    subject: typeof raw.subject === 'string' && raw.subject ? raw.subject : null,
    periodKey: typeof raw.periodKey === 'string' && raw.periodKey ? raw.periodKey : null,
    suppression: readSuppression(raw.suppression),
  };
}

/**
 * One `analytics_goals` row, read defensively — snake_case on the wire, and
 * `numeric(14,2)` arrives as a string from PostgREST often enough that `num()`
 * is the only safe reader. A figure that will not parse is null, never 0.
 */
function toGoal(raw: Record<string, unknown>): GoalRow {
  return {
    id: String(raw.id ?? ''),
    name: typeof raw.name === 'string' ? raw.name : 'Untitled goal',
    metricKey: typeof raw.metric_key === 'string' ? raw.metric_key : '',
    targetValue: num(raw.target_value),
    currentValue: num(raw.current_value),
    deadline: typeof raw.deadline === 'string' ? raw.deadline : null,
    status: typeof raw.status === 'string' ? raw.status : 'active',
  };
}

/**
 * The gateway's suppression block, read defensively. The page NEVER builds a
 * key — "the same insight" has to mean one thing on both sides of the wire —
 * so an entry that arrives without one gets `null` and the dismissal sheet
 * falls back to the bare rule key it already has, saying so.
 */
function readSuppression(raw: unknown): SuppressionVM | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { key?: unknown; scope?: unknown; keys?: unknown };
  const keys = s.keys as Record<string, unknown> | undefined;
  if (typeof s.key !== 'string' || !keys) return null;
  const pick = (k: string) => (typeof keys[k] === 'string' ? (keys[k] as string) : s.key as string);
  return {
    key: s.key,
    scope: (s.scope as SuppressionScope) ?? 'rule',
    keys: { insight: pick('insight'), subject: pick('subject'), rule: pick('rule') },
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
  /** How many fired and were withheld because they had been dismissed. */
  suppressed: number | null;
  /**
   * False when the dismissal store could not be read — the book below may
   * contain entries already dismissed, and the page has to say so.
   */
  suppressionsReadable: boolean;
  /** undefined = not asked yet. */
  exclusions: ExclusionsVM | undefined;
  excludeDay: (date: string, reason: string) => Promise<boolean>;
  includeDay: (date: string) => Promise<void>;
  /** undefined = not asked yet; null = the read failed. */
  digest: DigestPref | null | undefined;
  team: TeamOption[] | null | undefined;
  teamFailed: boolean;
  loadTeam: () => void;
  /** undefined = not asked yet; null = the read failed; [] = none set. */
  goals: GoalsVM;
  loadGoals: () => void;
  /** Writes one goal. Resolves with the gateway's own refusal on a 400. */
  createGoal: (input: {
    name: string;
    metricKey: string;
    targetValue: number;
    direction: 'at_least' | 'at_most';
    period: string;
    deadline: string;
  }) => Promise<GoalWrite>;
  /** The last write the page performed, said in words. */
  note: string | null;
  undo: { ruleKey: string; label: string } | null;
  clearUndo: () => void;
  refetch: () => void;
  /** Resolves TRUE only when the server stored it. Callers that navigate away
   *  must wait for this — a rollback message on an unmounted page is not a
   *  message. */
  setDisposition: (
    entry: EntryVM,
    patch: Record<string, unknown>,
    said: string,
    removeFromLeaf: boolean,
  ) => Promise<boolean>;
  dismiss: (entry: EntryVM, choice: DismissChoice) => Promise<void>;
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
  const [suppressed, setSuppressed] = useState<number | null>(null);
  const [suppressionsReadable, setSuppressionsReadable] = useState(true);
  const [exclusions, setExclusions] = useState<ExclusionsVM | undefined>(undefined);
  const [team, setTeam] = useState<TeamOption[] | null | undefined>(undefined);
  const [goals, setGoals] = useState<GoalsVM>(undefined);
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
          setSuppressed(num(data?.suppressed));
          // Absent field ⇒ an older gateway ⇒ we cannot claim the dismissals
          // were honoured. Only an explicit `true` counts as readable.
          setSuppressionsReadable(data?.suppressionsReadable === true);
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

  const say = useCallback((text: string) => {
    setNote(text);
  }, []);

  // The exclusion store — read once per tenant, and separately from the book,
  // so an unreadable exclusion list never takes the entries down with it. It
  // IS read eagerly, though: the dismissal sheet has to know whether the
  // "also exclude this day" choice can be offered at all before it is opened.
  useEffect(() => {
    let cancelled = false;
    setExclusions(undefined);
    if (!rid) return;
    apiClient
      .get<ExclusionsVM>(`/analytics/exclusions/${rid}`)
      .then(({ data }) => {
        if (cancelled) return;
        setExclusions({
          items: Array.isArray(data?.items) ? data.items : [],
          readable: data?.readable === true,
          problem: typeof data?.problem === 'string' ? data.problem : null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setExclusions({ items: [], readable: false, problem: failureOf(err).message });
      });
    return () => {
      cancelled = true;
    };
  }, [rid]);

  /**
   * Rule a day out of the analysis. Returns whether it landed — the caller
   * words its confirmation off the answer, never off the intent.
   */
  const excludeDay = useCallback(
    async (date: string, reason: string): Promise<boolean> => {
      if (!rid) return false;
      try {
        const { data } = await apiClient.post<DayExclusion>(
          `/analytics/exclusions/${rid}`,
          { businessDate: date, reason },
        );
        setExclusions((prev) => ({
          items: [
            { businessDate: date, reason, createdAt: data?.createdAt ?? null },
            ...(prev?.items ?? []).filter((e) => e.businessDate !== date),
          ],
          readable: true,
          problem: null,
        }));
        return true;
      } catch {
        return false;
      }
    },
    [rid],
  );

  const includeDay = useCallback(
    async (date: string) => {
      if (!rid) return;
      try {
        await apiClient.delete(`/analytics/exclusions/${rid}/${date}`);
        setExclusions((prev) =>
          prev
            ? { ...prev, items: prev.items.filter((e) => e.businessDate !== date) }
            : prev,
        );
        say(`${date} counts again in every average.`);
      } catch (err) {
        say(`That day is still excluded (${failureOf(err).message}).`);
      }
    },
    [rid, say],
  );

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

  /* ── goals (fourth pass) ─────────────────────────────────────────────── */

  // A restaurant switch invalidates the goal list the same way it invalidates
  // the book: goals are per tenant, and showing the previous house's targets
  // beside this house's entries would be the wrong-tenant read this page's
  // sequence numbers exist to prevent.
  useEffect(() => {
    setGoals(undefined);
  }, [rid]);

  /**
   * The goal list, read only when a goal sheet is opened.
   *
   * `status=active` on purpose: an archived goal is not a duplicate anyone
   * needs warning about, and the question this read answers is only ever "am I
   * about to set a second live target on this figure?".
   */
  const loadGoals = useCallback(() => {
    if (!rid || goals !== undefined) return;
    setGoals(null);
    apiClient
      .get<Record<string, unknown>[]>(`/analytics/goals/${rid}?status=active`)
      .then(({ data }) => setGoals(Array.isArray(data) ? data.map(toGoal) : []))
      .catch(() => setGoals(null));
  }, [rid, goals]);

  /**
   * Write one goal.
   *
   * The gateway refuses two ways and says why in plain English — 400
   * "Unsupported metric 'x'. Supported: …" and 400 "targetValue must be > 0"
   * (`goals.service.ts` `createGoal`, both curl-verified against :4000 on
   * 2026-09-03). Those sentences are handed straight back to the manager
   * rather than flattened into "could not save": a refusal that names the
   * reason is the difference between a fixable mistake and a dead button.
   *
   * `createdBy` is deliberately NOT sent. The controller passes the request
   * body to the service unfiltered (`analytics.controller.ts:507`), so a
   * client-supplied actor id would be an unverified claim written to a stored
   * record; the JWT is the only thing that knows who this is, and nothing on
   * this path reads it.
   */
  const createGoal = useCallback(
    async (input: {
      name: string;
      metricKey: string;
      targetValue: number;
      direction: 'at_least' | 'at_most';
      period: string;
      deadline: string;
    }): Promise<GoalWrite> => {
      if (!rid)
        return { ok: false, message: 'no restaurant is selected', expired: false };
      try {
        const { data } = await apiClient.post<Record<string, unknown>>(
          `/analytics/goals/${rid}`,
          input,
        );
        const goal = toGoal(data ?? {});
        // Keep the list true without a re-read: the sheet's "you already track
        // this" line must be right the moment a second entry opens.
        setGoals((prev) => (Array.isArray(prev) ? [goal, ...prev] : prev));
        say(`Goal set: “${goal.name}”. It is read in Reports, against your own numbers.`);
        return { ok: true, goal };
      } catch (err) {
        const f = failureOf(err);
        say(
          f.expired
            ? 'Your session has expired — no goal was set. Sign in again.'
            : `No goal was set (${f.message}).`,
        );
        return { ok: false, message: f.message, expired: f.expired };
      }
    },
    [rid, say],
  );

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
    async (
      entry: EntryVM,
      patch: Record<string, unknown>,
      said: string,
      removeFromLeaf: boolean,
    ): Promise<boolean> => {
      if (!rid) return false;
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
        return true;
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
        return false;
      }
    },
    [rid, say, offerUndo],
  );

  /**
   * Dismiss, at the scope the manager chose — and say what that means.
   *
   * This is the one write on the page that is a STANDING INSTRUCTION rather
   * than a note about a card, so it is the one write that has to be spelled
   * out afterwards. The key it posts is built by the gateway and carried on
   * the entry (`entry.suppression.keys`); the page never constructs one,
   * because "the same insight" must mean exactly one thing on both sides.
   *
   * The optional day exclusion is a SEPARATE write to a separate store, and
   * its success is reported separately: hiding the sentence does not fix an
   * average that a closure dragged down, and a manager who asked for both and
   * got one must be told which one.
   */
  const dismiss = useCallback(
    async (entry: EntryVM, choice: DismissChoice) => {
      if (!rid) return;
      const before = entry;
      setEntries((prev) => prev.filter((e) => e.ruleKey !== entry.ruleKey));
      try {
        await apiClient.post(`${BASE}/${rid}/action`, {
          ruleKey: choice.key,
          status: 'dismissed',
          reason: choice.reason,
          snapshot: snapshotOf(entry),
        });
      } catch (err) {
        const f = failureOf(err);
        setEntries((prev) => [before, ...prev.filter((e) => e.ruleKey !== before.ruleKey)]);
        say(
          f.expired
            ? 'Your session has expired — nothing was dismissed. Sign in again.'
            : `Nothing was dismissed (${f.message}) — the entry is back where it was.`,
        );
        return;
      }

      let tail = '';
      if (choice.excludeDate) {
        const landed = await excludeDay(choice.excludeDate, choice.reason);
        tail = landed
          ? ` ${choice.excludeDate} is also out of the analysis — its numbers stop counting toward every average.`
          : ` The entry is dismissed, but ${choice.excludeDate} could NOT be excluded from the analysis — the averages still count it.`;
      }
      say(`${choice.said}${tail} Undo here, or on the History leaf.`);
      offerUndo(choice.key, choice.said);
    },
    [rid, say, offerUndo, excludeDay],
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
    suppressed,
    suppressionsReadable,
    exclusions,
    excludeDay,
    includeDay,
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
    goals,
    loadGoals,
    createGoal,
    note,
    undo,
    clearUndo: () => setUndo(null),
    refetch,
    setDisposition,
    dismiss,
    restore,
    bulk,
  };
}
