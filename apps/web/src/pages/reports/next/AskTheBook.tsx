/**
 * "Ask the book" — the ⌘K palette, and the one thing it is careful never to do.
 *
 * The palette this page inherits once answered free-text questions from
 * `generateMockAnswer`: a hand-written switch returning confident, specific
 * numbers — "Tuesday's revenue was ~18% below weekly average", "Prosecco
 * (+72%)" — about a restaurant whose data it had never read. An owner could
 * have repriced a menu off those figures. Nothing on screen said so; only a
 * source comment did. That was removed in `58113e26` (verified 2026-09-02:
 * `generateMockAnswer` exists nowhere in `apps/web/src` outside comments and
 * two tests asserting its absence), and this palette keeps the property by
 * construction rather than by discipline.
 *
 * There is no free-text question endpoint on the gateway to route a question
 * to. `POST /analytics/consult/:id` takes a *persona*, not a question, and is
 * toggle-gated off by default. `GET /analytics/insights/:id` is the real
 * surface: deterministic sentences whose every number the engine computed from
 * this restaurant's own rows.
 *
 * So this palette SEARCHES that feed and says so in one line. It selects among
 * sentences the engine wrote; it never composes one. A short honest list beats
 * a fluent invented one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, settle } from '@/lib/mudavym';
import { failureLine } from './rp-format';
import type { ReadingRow, Register } from './useReportsNextData';

/** Question scaffolding carries no signal — dropping it lets "why did tuesday
 *  dip?" match on `tuesday`, instead of failing on `why`. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'about', 'into', 'over', 'than', 'then',
  'that', 'this', 'these', 'those', 'its', 'are', 'was', 'were', 'been', 'being',
  'does', 'did', 'doing', 'have', 'has', 'had', 'can', 'could', 'should', 'would',
  'will', 'shall', 'may', 'might', 'must', 'what', 'why', 'how', 'when', 'where',
  'which', 'who', 'whose', 'our', 'you', 'your', 'they', 'them', 'their', 'show',
  'tell', 'give', 'get', 'find', 'see', 'look', 'want', 'need', 'any', 'all',
  'some', 'much', 'many', 'more', 'most', 'less', 'least', 'versus', 'compare',
  'please',
]);

export function tokensOf(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    seen.add(raw);
  }
  return Array.from(seen);
}

/** Browse with no tokens; filter with them. Order by matches, then engine score. */
export function rank(rows: ReadingRow[], query: string): ReadingRow[] {
  const tokens = tokensOf(query);
  if (tokens.length === 0) return rows;
  const scored = rows
    .map((r) => {
      const hay = `${r.sentence} ${r.category} ${r.entityLabel ?? ''}`.toLowerCase();
      return { r, matched: tokens.filter((t) => hay.includes(t)).length };
    })
    .filter((s) => s.matched > 0);
  scored.sort((a, b) => b.matched - a.matched || b.r.score - a.r.score);
  return scored.map((s) => s.r);
}

export interface AskTheBookProps {
  open: boolean;
  onClose: () => void;
  reading: Register<ReadingRow[]>;
}

export function AskTheBook({ open, onClose, reading }: AskTheBookProps) {
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    inputRef.current?.focus();
    if (panelRef.current) {
      animate(
        panelRef.current,
        [
          { opacity: 0, transform: 'translateY(-6px)' },
          { opacity: 1, transform: 'none' },
        ],
        settle,
      );
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const results = useMemo(() => rank(reading.data ?? [], query), [reading.data, query]);
  if (!open) return null;

  return (
    <div className="rp-ask">
      <button type="button" aria-label="Close" className="rp-ask__scrim" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Ask the book" className="rp-ask__panel">
        <label style={{ display: 'block', padding: '12px 14px 8px' }}>
          <span className="rp-eyebrow" style={{ display: 'block', marginBottom: 6 }}>
            Ask the book
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search what the engine has already said…"
            className="rp-ask__field rp-focus"
          />
        </label>
        <hr className="rp-rule" style={{ margin: '0 14px' }} />
        <div className="rp-ask__body">
          {reading.failure ? (
            <p role="status" className="rp-note">
              {failureLine('insight register', reading.failure)}
            </p>
          ) : reading.loading ? (
            <p className="rp-quiet">Reading the insight register…</p>
          ) : results.length === 0 ? (
            <p className="rp-quiet">
              {(reading.data ?? []).length === 0
                ? 'The engine has produced no sentence for this restaurant yet.'
                : `Nothing the engine has said mentions that. It has ${(reading.data ?? []).length} sentences in total.`}
            </p>
          ) : (
            <ul className="rp-list">
              {results.slice(0, 20).map((r) => (
                <li key={r.ruleKey} style={{ display: 'grid', gap: 2 }}>
                  <span className="rp-eyebrow">
                    {r.category}
                    {r.entityLabel ? ` · ${r.entityLabel}` : ''}
                  </span>
                  <p className="rp-sentence">{r.sentence}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="rp-ask__foot">
          This searches sentences the engine computed from your own rows. It does not answer
          free-text questions — no endpoint in this product does, and a fluent invented answer is
          the one thing the book will not give you.
        </p>
      </div>
    </div>
  );
}

export default AskTheBook;
