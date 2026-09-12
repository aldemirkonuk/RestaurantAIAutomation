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
 *
 * THE SURFACE IS THE HOUSE PANEL, 2026-09-04 (ADR 0112). The `.rp-ask` wrapper,
 * its scrim button, its `role="dialog"` card, its own Esc listener and its own
 * `animate(settle)` call are gone; `components/mudavym/Sheet.tsx` runs all of
 * them, identically, and adds the focus trap, the returned focus and the body
 * scroll lock this copy never had. Every word of the copy is unchanged —
 * including the footer, which is the whole point of the palette.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '@/components/mudavym/Sheet';
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* Esc, the focus move, the scrim, the settle motion and the scroll lock all
     belong to the primitive now (ADR 0112). What stays here is the one thing
     that is this palette's own: a fresh query every time it opens. */
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const results = useMemo(() => rank(reading.data ?? [], query), [reading.data, query]);
  if (!open) return null;

  return (
    <Panel
      open={open}
      onClose={onClose}
      label="Ask the book"
      showClose={false}
      bodyClassName="mdv-ovl__body--flush"
      initialFocusRef={inputRef}
      footer={
        <>
          This searches sentences the engine computed from your own rows. It does not answer
          free-text questions — no endpoint in this product does, and a fluent invented answer is
          the one thing the book will not give you.
        </>
      }
    >
      <div className="mdv-field">
        <label className="rp-eyebrow" htmlFor="rp-ask-field">
          Ask the book
        </label>
        <input
          id="rp-ask-field"
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search what the engine has already said…"
        />
      </div>
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
    </Panel>
  );
}

export default AskTheBook;
