/**
 * CatalogView — `/recommendations/catalog`, as a VIEW of `/recommendations`
 * rather than a page of its own (the relayed 2026-09-12 ruling; DIGEST.md
 * fork F1 (a), sketch 120 item 5: "the catalogue as a leaf — the same
 * rail-and-rows shape … with the server's own coverage numbers and
 * 'data present' relabelled as what it measures").
 *
 * A sibling component, not a sixth `Leaf`: it shares this page's head, its
 * CSS (`rec-next.css`) and its `mudavym_design_recommendations` flag (wired
 * in `App.tsx`), but reads none of the six book endpoints
 * `useRecommendationsNextData` fires. The legacy `InsightCatalog.tsx` stays
 * in the tree, untouched, reachable only by a dev override until the founder
 * approves the deletion manifest (ADR 0149).
 *
 * **ACTIONABLE as of ADR 0191 (founder, 2026-09-21).** The "read-only by
 * design" leaf this was built as (sketch 120 item 5) is superseded: the
 * page note's own §"Forks built on a DEFAULT" flagged the read-only-ness as
 * a standing open fork, not a founder decision, and today's ruling closes
 * it — "each type can be turned on or off for the house and opened to its
 * live recommendations, with the same one-tap acts as the feed." Both writes
 * reuse the SAME `recommendation_actions` store NEW-434 already keys
 * `insight:<candidate_key>` — see `rec-catalog.ts`'s ADR 0191 section. See
 * `rec-catalog.ts` for why "computable now" is printed as "data present".
 *
 * **Round 2 (founder, 2026-09-21, ADR 0191).** Turning a type off is a
 * whole-type dismissal, so it asks its reason (a labelled signal). The live
 * items offer Snooze, Done and a reason-labelled Dismiss — shown because the
 * gateway now resolves ONE shared per-item state on every read the feed,
 * Reports and the rails use, so each act holds everywhere, not just here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { Wordmark } from '@/components/mudavym';
import {
  DISMISS_REASONS,
  EM,
  SNOOZE_CHOICES,
  ensureFraunces,
  failureOf,
  failureSentence,
  type FailureVM,
} from './rec-format';
import {
  PRESENCE_CAVEAT,
  READINESS_LABEL,
  REQUIREMENT_LABEL,
  countsByDimension,
  headSentence,
  isTypeEnabled,
  liveInsightsForType,
  matchesQuery,
  missingRequirements,
  offTypeKeys,
  readinessOf,
  typeRuleKey,
  type CatalogCandidate,
  type CatalogPayload,
  type DispositionRow,
  type LiveInsight,
  type Readiness,
} from './rec-catalog';
import './rec-next.css';

/** One catalogue type's live-items panel state. */
interface LivePanelState {
  phase: 'loading' | 'ready' | 'failed';
  items: LiveInsight[];
  message?: string;
  /**
   * The generator's own `suppressionsReadable`. `false` means the house's
   * dismissals could not be read, so this list may hold items already
   * dismissed — the panel says so rather than presenting it as clean.
   */
  suppressionsReadable?: boolean;
  /**
   * How many of this type's items the shared per-item state withheld, by
   * state (the generator's own `withheld`, ADR 0191). Hidden here is hidden
   * on the feed, Reports and the rails too — the panel says how many.
   */
  withheld?: { dismissed: number; snoozed: number; done: number };
}

/** Which one-item sheet is open on a live item, if any. */
type LiveMenu = { key: string; kind: 'dismiss' | 'snooze' } | null;

type Phase = 'loading' | 'ready' | 'failed';

function DoubleRule() {
  return (
    <div className="rc-double">
      <i />
      <i />
    </div>
  );
}

export interface CatalogViewProps {
  ground?: 'charcoal';
}

export default function CatalogView({ ground }: CatalogViewProps) {
  useEffect(() => {
    ensureFraunces();
  }, []);

  const { activeRestaurantId, user, activeRole } = useAuth();
  const rid = activeRestaurantId ?? null;
  const role = activeRole ?? user?.role ?? null;
  // Owner/manager only — a house policy, not a note on one card (ADR 0191).
  // The gateway's set (`RolesGuard`): owner, manager, admin.
  const canManage = ['owner', 'manager', 'admin'].includes(String(role ?? ''));

  const [phase, setPhase] = useState<Phase>('loading');
  const [payload, setPayload] = useState<CatalogPayload | null>(null);
  const [failure, setFailure] = useState<FailureVM | null>(null);
  const [searchParams] = useSearchParams();
  const [dimension, setDimension] = useState<string | 'all'>('all');
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [open, setOpen] = useState<string | null>(null);
  // Bumped by the "Read it again" retry button. `rid` alone does not change
  // on a retry, so the fetch effect needs a deps entry that does — mirrors
  // `useDigestSubscription`'s `seq`/`refresh` pattern in this same lane.
  const [retryCount, setRetryCount] = useState(0);

  // ADR 0191 — which types are off for this house. A SEPARATE read from a
  // SEPARATE store call (`recommendation_actions`, not the catalogue), and
  // its failure must not blank the catalogue itself: `null` means "not known
  // yet", never "everything is on".
  const [offKeys, setOffKeys] = useState<Set<string> | null>(null);
  // Why the on/off read failed — rendered, so a failed read never sits on
  // screen as "Reading…" for ever.
  const [offReadFailure, setOffReadFailure] = useState<string | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [toggleFailure, setToggleFailure] = useState<{ key: string; message: string } | null>(
    null,
  );
  // The toggle landed but its audit row did not (the gateway's receipt).
  const [auditMiss, setAuditMiss] = useState<{ key: string; message: string } | null>(null);
  // A Pin/Dismiss on a live item that did not land — put back and said.
  const [liveActFailure, setLiveActFailure] = useState<{ key: string; message: string } | null>(
    null,
  );

  // Live-items panels, one entry per opened type; cached once read.
  const [liveOpenFor, setLiveOpenFor] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<Record<string, LivePanelState>>({});
  const [pinnedLive, setPinnedLive] = useState<Set<string>>(new Set());
  const [liveMenu, setLiveMenu] = useState<LiveMenu>(null);
  // Turning a type OFF is a whole-rule dismissal, so it asks the reason
  // first — the founder's labelled signal (2026-09-21). Holds the type key
  // whose reason row is open.
  const [offReasonFor, setOffReasonFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    const qs = rid ? `?restaurantId=${encodeURIComponent(rid)}` : '';
    apiClient
      .get<CatalogPayload>(`/analytics/insight-catalog/types${qs}`)
      .then(({ data }) => {
        if (cancelled) return;
        setPayload(data ?? null);
        setPhase('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setFailure(failureOf(err));
        setPhase('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [rid, retryCount]);

  useEffect(() => {
    if (!rid) {
      setOffKeys(null);
      return;
    }
    let cancelled = false;
    setOffReadFailure(null);
    apiClient
      .get<{ items: DispositionRow[] }>(`/analytics/recommendations/${rid}/actions?status=dismissed`)
      .then(({ data }) => {
        if (cancelled) return;
        // A reply with no `items` list is not "nothing is off" — it is a read
        // that did not answer, and every type would otherwise print "On".
        if (!Array.isArray(data?.items)) {
          setOffKeys(null);
          setOffReadFailure('the reply carried no list');
          return;
        }
        setOffKeys(offTypeKeys(data.items));
      })
      .catch((err) => {
        if (cancelled) return;
        setOffKeys(null);
        setOffReadFailure(failureOf(err).message);
      });
    return () => {
      cancelled = true;
    };
  }, [rid, retryCount]);

  const toggleType = useCallback(
    async (c: CatalogCandidate, reason: string | null = null) => {
      if (!rid || !canManage) return;
      const key = typeRuleKey(c.key);
      const wasOn = offKeys ? !offKeys.has(key) : true;
      const nextOn = !wasOn;
      // Off needs its label; the reason row asks for it before this runs.
      if (!nextOn && !reason) return;
      setOffReasonFor(null);
      setTogglingKey(c.key);
      setToggleFailure(null);
      setAuditMiss(null);
      setOffKeys((prev) => {
        const s = new Set(prev ?? []);
        if (nextOn) s.delete(key);
        else s.add(key);
        return s;
      });
      try {
        const { data } = await apiClient.put<{
          audit?: { recorded?: boolean; reason?: string | null };
        }>(`/analytics/insight-catalog/types/${rid}/${encodeURIComponent(c.key)}/toggle`, {
          enabled: nextOn,
          ...(nextOn ? {} : { reason }),
        });
        // The live list read before this flip no longer holds.
        setLiveState((prev) => {
          if (!prev[c.key]) return prev;
          const next = { ...prev };
          delete next[c.key];
          return next;
        });
        if (data?.audit && data.audit.recorded === false)
          setAuditMiss({ key: c.key, message: data.audit.reason ?? 'no reason given' });
      } catch (err) {
        // Put it back — the server never got it, so the page must not claim
        // otherwise.
        setOffKeys((prev) => {
          const s = new Set(prev ?? []);
          if (wasOn) s.delete(key);
          else s.add(key);
          return s;
        });
        setToggleFailure({ key: c.key, message: failureOf(err).message });
      } finally {
        setTogglingKey(null);
      }
    },
    [rid, canManage, offKeys],
  );

  const openLive = useCallback(
    (c: CatalogCandidate, readiness: Readiness, enabled: boolean | null) => {
      if (liveOpenFor === c.key) {
        setLiveOpenFor(null);
        return;
      }
      setLiveOpenFor(c.key);
      setLiveActFailure(null);
      if (!rid || readiness !== 'computable' || enabled === false) return; // the panel says why, nothing to fetch
      if (liveState[c.key]?.phase === 'ready') return; // cached
      setLiveState((prev) => ({ ...prev, [c.key]: { phase: 'loading', items: [] } }));
      // `candidateKey` narrows the read SERVER-side, before the generator's
      // five-per-category cap — a category-wide read filtered here would miss
      // any type ranked below its category's top five and call it empty.
      apiClient
        .get<{
          insights?: unknown[];
          suppressionsReadable?: boolean;
          withheld?: { dismissed?: number; snoozed?: number; done?: number };
        }>(
          `/analytics/insights/${rid}?categories=${encodeURIComponent(c.category)}&candidateKey=${encodeURIComponent(c.key)}&refresh=true`,
        )
        .then(({ data }) => {
          if (!Array.isArray(data?.insights)) {
            setLiveState((prev) => ({
              ...prev,
              [c.key]: { phase: 'failed', items: [], message: 'the reply carried no list' },
            }));
            return;
          }
          const items = liveInsightsForType(data.insights, c.key);
          const w = data.withheld;
          setLiveState((prev) => ({
            ...prev,
            [c.key]: {
              phase: 'ready',
              items,
              suppressionsReadable: data.suppressionsReadable,
              withheld: w
                ? { dismissed: w.dismissed ?? 0, snoozed: w.snoozed ?? 0, done: w.done ?? 0 }
                : undefined,
            },
          }));
        })
        .catch((err) => {
          setLiveState((prev) => ({
            ...prev,
            [c.key]: { phase: 'failed', items: [], message: failureOf(err).message },
          }));
        });
    },
    [rid, liveOpenFor, liveState],
  );

  /**
   * One state write on one live item — dismissed (with the reason picked),
   * snoozed until an instant, or done — at the item's own key, through the
   * same `POST …/action` the feed, Reports and the rails use. The founder
   * (2026-09-21, "Build it right, in order"): each act shows here only once
   * it is honoured on every surface, and all three now are — the generator
   * resolves the one shared per-item state on its live compute and its
   * stored read, and the feed resolves the same state for its own rules
   * (ADR 0191). A write that did not land puts the item back and says so,
   * as the feed's `setDisposition` does.
   */
  const actLive = useCallback(
    (c: CatalogCandidate, item: LiveInsight, patch: Record<string, unknown>) => {
      if (!rid) return;
      setLiveActFailure(null);
      setLiveMenu(null);
      setLiveState((prev) => {
        const cur = prev[c.key];
        if (!cur) return prev;
        return {
          ...prev,
          [c.key]: {
            ...cur,
            items: cur.items.filter((i) => i.suppressionKey !== item.suppressionKey),
          },
        };
      });
      apiClient
        .post(`/analytics/recommendations/${rid}/action`, {
          ruleKey: item.suppressionKey,
          ...patch,
          snapshot: {
            observation: item.sentence,
            recommendation: item.sentence,
            category: item.category,
          },
        })
        .catch((err) => {
          setLiveState((prev) => {
            const cur = prev[c.key];
            if (!cur || cur.items.some((i) => i.suppressionKey === item.suppressionKey))
              return prev;
            return {
              ...prev,
              [c.key]: {
                ...cur,
                items: [...cur.items, item].sort((a, b) => b.score - a.score),
              },
            };
          });
          setLiveActFailure({ key: c.key, message: failureOf(err).message });
        });
    },
    [rid],
  );

  const pinLive = useCallback(
    (c: CatalogCandidate, item: LiveInsight) => {
      if (!rid) return;
      setLiveActFailure(null);
      const key = item.suppressionKey;
      const wasPinned = pinnedLive.has(key);
      setPinnedLive((prev) => {
        const s = new Set(prev);
        if (wasPinned) s.delete(key);
        else s.add(key);
        return s;
      });
      apiClient
        .post(`/analytics/recommendations/${rid}/action`, {
          ruleKey: key,
          pinned: !wasPinned,
          snapshot: {
            observation: item.sentence,
            recommendation: item.sentence,
            category: item.category,
          },
        })
        .catch((err) => {
          setPinnedLive((prev) => {
            const s = new Set(prev);
            if (wasPinned) s.add(key);
            else s.delete(key);
            return s;
          });
          setLiveActFailure({ key: c.key, message: failureOf(err).message });
        });
    },
    [rid, pinnedLive],
  );

  const dims = useMemo(
    () => new Map((payload?.dimensions ?? []).map((d) => [d.key, d])),
    [payload],
  );
  const measures = useMemo(
    () => new Map((payload?.measures ?? []).map((m) => [m.key, m])),
    [payload],
  );
  const comparators = useMemo(
    () => new Map((payload?.comparators ?? []).map((c) => [c.key, c])),
    [payload],
  );
  const dimCounts = useMemo(
    () => countsByDimension(payload?.candidates ?? []),
    [payload],
  );

  const searching = query.trim() !== '';
  const rows: CatalogCandidate[] = useMemo(() => {
    if (!payload) return [];
    const base = searching
      ? payload.candidates
      : dimension === 'all'
        ? payload.candidates
        : payload.candidates.filter((c) => c.dimension === dimension);
    if (!searching) return base;
    return base.filter((c) => matchesQuery(c, dims, measures, comparators, query));
  }, [payload, dimension, query, searching, dims, measures, comparators]);

  const candidateLabel = (c: CatalogCandidate): string => {
    const m = measures.get(c.measure)?.label ?? c.measure;
    const cmp = comparators.get(c.comparator)?.label ?? c.comparator;
    const d = dims.get(c.dimension)?.label ?? c.dimension;
    return `${m} — ${cmp}, by ${d}`;
  };

  return (
    <div className="mudavym rc-page" data-ground={ground}>
      <div className="rc-wrap">
        <header className="rc-head">
          <Wordmark size={13} />
          <h1 className="rc-serif rc-title">The catalogue</h1>
          <p className="rc-serif rc-voice">
            {phase === 'loading'
              ? 'Reading the catalogue…'
              : phase === 'failed'
                ? failureSentence(failure ?? { status: null, message: 'unknown', expired: false, forbidden: false }, 'the catalogue')
                : payload
                  ? headSentence(payload.coverage, EM)
                  : ''}
          </p>
          <p className="rc-micro rc-readat">
            Every dimension × measure × comparator Mudavym knows · owner/manager can turn a
            type on or off for this house ·{' '}
            <Link to="/recommendations">← Back to Recommendations</Link>
          </p>
          <DoubleRule />
          {phase === 'ready' && (
            <p className="rc-said" data-testid="rc-presence-caveat">
              {PRESENCE_CAVEAT}
            </p>
          )}
        </header>

        {phase === 'failed' && (
          <div className="rc-alert" role="alert">
            <span>
              {failureSentence(
                failure ?? { status: null, message: 'unknown', expired: false, forbidden: false },
                'the catalogue',
              )}
            </span>
            <button
              type="button"
              className="rc-retry"
              onClick={() => setRetryCount((n) => n + 1)}
            >
              Read it again
            </button>
          </div>
        )}

        {phase === 'ready' && payload && (
          <>
            <div className="rc-aside-block">
              <label className="rc-field">
                <span className="rc-micro">Search every type</span>
                <input
                  type="text"
                  value={query}
                  onChange={(ev) => setQuery(ev.target.value)}
                  placeholder={`Search all ${payload.total} types…`}
                  aria-label="Search the catalogue"
                />
              </label>
              {searching && (
                <p className="rc-why">
                  Searching across every dimension — the rail below is not applied while you
                  search.
                </p>
              )}
            </div>

            <div className="rc-shell">
              <aside aria-disabled={searching || undefined}>
                <div className="rc-micro">By dimension</div>
                <div className="rc-reg-list">
                  <button
                    type="button"
                    className="rc-reg"
                    aria-pressed={!searching && dimension === 'all'}
                    onClick={() => setDimension('all')}
                  >
                    <span>All</span>
                    <span className="rc-num">{payload.total}</span>
                  </button>
                  {payload.dimensions.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      className="rc-reg"
                      aria-pressed={!searching && dimension === d.key}
                      onClick={() => setDimension(d.key)}
                    >
                      <span>{d.label}</span>
                      <span className="rc-num">{dimCounts.get(d.key) ?? 0}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="rc-leaf-body">
                {rows.length === 0 ? (
                  <p className="rc-empty-why">
                    {searching
                      ? `No type matches “${query}”.`
                      : 'No type is filed under this dimension.'}
                  </p>
                ) : (
                  <ul className="rc-catalog-rows">
                    {rows.map((c) => {
                      const readiness = readinessOf(c, payload.available);
                      const missing = missingRequirements(c, payload.available);
                      const expanded = open === c.key;
                      const enabled = isTypeEnabled(c.key, offKeys);
                      const live = liveState[c.key];
                      const liveOpen = liveOpenFor === c.key;
                      return (
                        <li key={c.key} className="rc-catalog-entry" data-testid="rc-catalog-row">
                          <button
                            type="button"
                            className="rc-catalog-row-head"
                            onClick={() => setOpen(expanded ? null : c.key)}
                            aria-expanded={expanded}
                          >
                            <span className="rc-num">{c.key}</span>
                            <span className="rc-micro" data-testid="rc-readiness">
                              {READINESS_LABEL[readiness]}
                            </span>
                          </button>
                          <p className="rc-plain">{candidateLabel(c)}</p>
                          {expanded && (
                            <div className="rc-said">
                              <p>Category: {c.category}</p>
                              <p>
                                Requires:{' '}
                                {c.requires.length === 0
                                  ? 'nothing beyond the tenant itself'
                                  : c.requires.map((r) => REQUIREMENT_LABEL[r]).join(', ')}
                              </p>
                              {readiness === 'blocked' && missing.length > 0 && (
                                <p>
                                  Missing: {missing.map((r) => REQUIREMENT_LABEL[r]).join(', ')}.
                                </p>
                              )}
                              {readiness === 'unknown' && (
                                <p>
                                  Whether this house has the data is not known — sign in, or
                                  the availability read failed.
                                </p>
                              )}

                              <div className="rc-controls" data-testid="rc-type-onoff">
                                <span className="rc-ctl-label">For this house:</span>
                                {canManage ? (
                                  <button
                                    type="button"
                                    className="rc-quiet"
                                    aria-pressed={enabled === true}
                                    disabled={enabled === null || togglingKey === c.key}
                                    onClick={() =>
                                      enabled
                                        ? setOffReasonFor(offReasonFor === c.key ? null : c.key)
                                        : void toggleType(c)
                                    }
                                  >
                                    {enabled === null ? 'Reading…' : enabled ? 'On' : 'Off'}
                                  </button>
                                ) : (
                                  <span className="rc-micro" data-testid="rc-type-onoff-badge">
                                    {enabled === null ? 'Unknown' : enabled ? 'On' : 'Off'}
                                  </span>
                                )}
                              </div>
                              {canManage && enabled === true && offReasonFor === c.key && (
                                <div
                                  className="rc-row"
                                  role="group"
                                  aria-label="Why turn it off"
                                  data-testid="rc-type-off-reason"
                                >
                                  <span className="rc-micro">
                                    Turning it off dismisses the whole type for the house {EM} why?
                                  </span>
                                  {DISMISS_REASONS.map((r) => (
                                    <button
                                      key={r.id}
                                      type="button"
                                      className="rc-quiet"
                                      onClick={() => void toggleType(c, r.id)}
                                    >
                                      {r.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {enabled === null && offReadFailure && (
                                <p className="rc-why" role="alert">
                                  Couldn't read whether this type is on for the house (
                                  {offReadFailure}).
                                </p>
                              )}
                              {toggleFailure && toggleFailure.key === c.key && (
                                <p className="rc-why" role="alert">
                                  Not saved ({toggleFailure.message}).
                                </p>
                              )}
                              {auditMiss && auditMiss.key === c.key && (
                                <p className="rc-why" role="alert">
                                  Saved, but not written to the house log ({auditMiss.message}).
                                </p>
                              )}

                              {readiness === 'computable' && (
                                <div className="rc-controls">
                                  {enabled === false ? (
                                    <p className="rc-why">
                                      This type is off for this house — turn it on to see its
                                      live items.
                                    </p>
                                  ) : (
                                    <button
                                      type="button"
                                      className="rc-quiet"
                                      aria-pressed={liveOpen}
                                      onClick={() => openLive(c, readiness, enabled)}
                                    >
                                      {liveOpen ? 'Hide live items' : 'Open live items'}
                                    </button>
                                  )}
                                </div>
                              )}

                              {liveOpen && readiness === 'computable' && enabled !== false && (
                                <div className="rc-live-items" data-testid="rc-live-items">
                                  {live?.phase === 'loading' && (
                                    <p className="rc-loading">Reading live items…</p>
                                  )}
                                  {live?.phase === 'failed' && (
                                    <p className="rc-why" role="alert">
                                      Couldn't read live items ({live.message}).
                                    </p>
                                  )}
                                  {live?.phase === 'ready' && live.suppressionsReadable === false && (
                                    <p className="rc-why" role="alert">
                                      Dismissals could not be read — some of these may already
                                      be dismissed.
                                    </p>
                                  )}
                                  {live?.phase === 'ready' &&
                                    live.withheld &&
                                    live.withheld.dismissed + live.withheld.snoozed + live.withheld.done > 0 && (
                                      <p className="rc-said" data-testid="rc-live-withheld">
                                        Not shown: {live.withheld.dismissed} dismissed ·{' '}
                                        {live.withheld.snoozed} snoozed · {live.withheld.done} done
                                        {' '}{EM} hidden on the feed, Reports and the rails as well.
                                      </p>
                                    )}
                                  {liveActFailure && liveActFailure.key === c.key && (
                                    <p className="rc-why" role="alert">
                                      Not saved ({liveActFailure.message}) — the item is back
                                      where it was.
                                    </p>
                                  )}
                                  {live?.phase === 'ready' && live.items.length === 0 && (
                                    <p className="rc-empty-why">
                                      Nothing live for this type right now.
                                    </p>
                                  )}
                                  {live?.phase === 'ready' && live.items.length > 0 && (
                                    <ul className="rc-live-list">
                                      {live.items.map((item) => (
                                        <li key={item.suppressionKey} className="rc-live-item">
                                          <p className="rc-plain">{item.sentence}</p>
                                          <div className="rc-row">
                                            <button
                                              type="button"
                                              className="rc-quiet"
                                              aria-pressed={pinnedLive.has(item.suppressionKey)}
                                              onClick={() => pinLive(c, item)}
                                            >
                                              {pinnedLive.has(item.suppressionKey) ? 'Pinned' : 'Pin'}
                                            </button>
                                            {item.suppressionKey === typeRuleKey(c.key) ? (
                                              // An instance with no subject and no period has
                                              // only the bare key: a Snooze, Done or Dismiss
                                              // here would act on the whole type, house-wide,
                                              // under a one-item label (suppression.ts: never
                                              // claim a narrow scope you did not store). Say so.
                                              <span className="rc-micro" data-testid="rc-live-whole-type">
                                                Acting on this one acts on the whole type — that is
                                                the On/Off above.
                                              </span>
                                            ) : (
                                              <>
                                                <button
                                                  type="button"
                                                  className="rc-quiet"
                                                  aria-expanded={
                                                    liveMenu?.key === item.suppressionKey &&
                                                    liveMenu.kind === 'snooze'
                                                  }
                                                  onClick={() =>
                                                    setLiveMenu(
                                                      liveMenu?.key === item.suppressionKey &&
                                                        liveMenu.kind === 'snooze'
                                                        ? null
                                                        : { key: item.suppressionKey, kind: 'snooze' },
                                                    )
                                                  }
                                                >
                                                  Snooze
                                                </button>
                                                <button
                                                  type="button"
                                                  className="rc-quiet"
                                                  onClick={() => actLive(c, item, { status: 'done' })}
                                                >
                                                  Done
                                                </button>
                                                <button
                                                  type="button"
                                                  className="rc-quiet"
                                                  aria-expanded={
                                                    liveMenu?.key === item.suppressionKey &&
                                                    liveMenu.kind === 'dismiss'
                                                  }
                                                  onClick={() =>
                                                    setLiveMenu(
                                                      liveMenu?.key === item.suppressionKey &&
                                                        liveMenu.kind === 'dismiss'
                                                        ? null
                                                        : { key: item.suppressionKey, kind: 'dismiss' },
                                                    )
                                                  }
                                                >
                                                  Dismiss
                                                </button>
                                              </>
                                            )}
                                          </div>
                                          {liveMenu?.key === item.suppressionKey &&
                                            liveMenu.kind === 'snooze' && (
                                              <div
                                                className="rc-row"
                                                role="group"
                                                aria-label="Snooze this item"
                                              >
                                                <span className="rc-micro">It comes back…</span>
                                                {SNOOZE_CHOICES.map((o) => (
                                                  <button
                                                    key={o.id}
                                                    type="button"
                                                    className="rc-quiet"
                                                    onClick={() =>
                                                      actLive(c, item, {
                                                        status: 'snoozed',
                                                        snoozeUntil: new Date(
                                                          Date.now() + o.value * 86_400_000,
                                                        ).toISOString(),
                                                      })
                                                    }
                                                  >
                                                    {o.label}
                                                  </button>
                                                ))}
                                              </div>
                                            )}
                                          {liveMenu?.key === item.suppressionKey &&
                                            liveMenu.kind === 'dismiss' && (
                                              <div
                                                className="rc-row"
                                                role="group"
                                                aria-label="Why dismiss this item"
                                              >
                                                <span className="rc-micro">Why?</span>
                                                {DISMISS_REASONS.map((r) => (
                                                  <button
                                                    key={r.id}
                                                    type="button"
                                                    className="rc-quiet"
                                                    onClick={() =>
                                                      actLive(c, item, {
                                                        status: 'dismissed',
                                                        reason: r.id,
                                                      })
                                                    }
                                                  >
                                                    {r.label}
                                                  </button>
                                                ))}
                                              </div>
                                            )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
