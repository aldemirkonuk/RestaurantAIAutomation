/**
 * CatalogView — `/recommendations/catalog`, as a VIEW of `/recommendations`
 * rather than a page of its own (the relayed 2026-09-12 ruling; DIGEST.md
 * fork F1 (a), sketch 120 item 5: "the catalogue as a leaf — the same
 * rail-and-rows shape, read-only, with the server's own coverage numbers and
 * 'data present' relabelled as what it measures").
 *
 * A sibling component, not a sixth `Leaf`: it shares this page's head, its
 * CSS (`rec-next.css`) and its `mudavym_design_recommendations` flag (wired
 * in `App.tsx`), but reads none of the six book endpoints
 * `useRecommendationsNextData` fires — this view's whole network surface is
 * the one read below. The legacy `InsightCatalog.tsx` stays in the tree,
 * untouched, reachable only by a dev override until the founder approves the
 * deletion manifest (ADR 0149).
 *
 * Read-only by design (the page note's explicit ask) — no write exists here,
 * and none is added. See `rec-catalog.ts` for why "computable now" is
 * printed as "data present" instead.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { Wordmark } from '@/components/mudavym';
import { EM, ensureFraunces, failureOf, failureSentence, type FailureVM } from './rec-format';
import {
  PRESENCE_CAVEAT,
  READINESS_LABEL,
  REQUIREMENT_LABEL,
  countsByDimension,
  headSentence,
  matchesQuery,
  missingRequirements,
  readinessOf,
  type CatalogCandidate,
  type CatalogPayload,
} from './rec-catalog';
import './rec-next.css';

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

  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId ?? null;

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
            Every dimension × measure × comparator Mudavym knows · read-only ·{' '}
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
