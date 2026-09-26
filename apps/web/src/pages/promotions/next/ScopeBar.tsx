/**
 * ScopeBar — the house-first ladder and its facets for `/promotions`
 * (founder item 36; ADR 0160 §113, round-6 bracket). Page-local on purpose:
 * `/vendors` gets the same shape in its own lane, and the shared component is
 * extracted when that second user lands (DESIGN-FOUNDATION item 4's filter-bar
 * row), not guessed at from one.
 *
 * Not a modal (ADR 0112 has no shape for a standing lens): a segmented
 * control for the three rungs, each with its live count, then the facets as
 * toggle chips. Wide, a chip applies at once. At a phone (≤ 780px, the page's
 * own one-column breakpoint) the facets fold behind "Filters", and a choice is
 * STAGED until "Show N offers" — the apply step, so a thumb picking three
 * chips does not re-flow the docket three times under it.
 */

import { useEffect, useId, useState } from 'react';
import type { CoarseCategory } from './promotions-format';
import {
  CATEGORY_WORDS,
  NO_FACETS,
  RUNGS,
  activeFacetCount,
  type FacetOptions,
  type Facets,
  type Rung,
} from './promotions-scope';

const NARROW = '(max-width: 780px)';

/** True at a phone width. A browser without matchMedia (and jsdom) reads as wide. */
export function useNarrow(): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

interface FacetRowProps {
  value: Facets;
  options: FacetOptions;
  onChange: (f: Facets) => void;
  /** Stocked rows ever counted, and stocked rows — the only ones "Running low" may speak for. */
  counted: { counted: number; active: number } | null;
}

function FacetRow({ value, options, onChange, counted }: FacetRowProps) {
  const searchId = useId();
  return (
    <div className="pn-facets">
      <label className="pn-sr" htmlFor={searchId}>
        Search offers
      </label>
      <input
        id={searchId}
        className="pn-search"
        type="search"
        placeholder="Search wine or vendor"
        value={value.q}
        onChange={(e) => onChange({ ...value, q: e.target.value })}
      />
      <div className="pn-chips" role="group" aria-label="When and how much">
        <button
          type="button"
          className="pn-fchip"
          aria-pressed={value.endsSoon}
          onClick={() => onChange({ ...value, endsSoon: !value.endsSoon })}
        >
          Ends soon <span className="pn-fchip__n">{options.endsSoon}</span>
        </button>
        <button
          type="button"
          className="pn-fchip"
          aria-pressed={value.runningLow}
          onClick={() => onChange({ ...value, runningLow: !value.runningLow })}
          aria-describedby={counted ? `${searchId}-low` : undefined}
        >
          Running low <span className="pn-fchip__n">{options.runningLow}</span>
        </button>
      </div>
      {options.categories.length > 0 && (
        <div className="pn-chips" role="group" aria-label="Category">
          {options.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className="pn-fchip"
              aria-pressed={value.categories.includes(c.id)}
              onClick={() => onChange({ ...value, categories: toggle<CoarseCategory>(value.categories, c.id) })}
            >
              {CATEGORY_WORDS[c.id]} <span className="pn-fchip__n">{c.count}</span>
            </button>
          ))}
        </div>
      )}
      {options.vendors.length > 1 && (
        <div className="pn-chips" role="group" aria-label="Vendor">
          {options.vendors.map((v) => (
            <button
              key={v.id}
              type="button"
              className="pn-fchip"
              aria-pressed={value.vendors.includes(v.id)}
              onClick={() => onChange({ ...value, vendors: toggle(value.vendors, v.id) })}
            >
              {v.name} <span className="pn-fchip__n">{v.count}</span>
            </button>
          ))}
        </div>
      )}
      {counted && (
        <p className="pn-facets__note" id={`${searchId}-low`}>
          Running low speaks only for stock someone counted — {counted.counted} of the {counted.active} wines you stock
          {counted.counted === 1 ? ' has' : ' have'} a count. Categories are the wine library&rsquo;s own classification.
        </p>
      )}
    </div>
  );
}

export interface ScopeBarProps {
  rung: Rung;
  counts: Record<Rung, number>;
  onRung: (r: Rung) => void;
  facets: Facets;
  options: FacetOptions;
  onFacets: (f: Facets) => void;
  /** How many offers the current rung would show under `f` — the "Show N" of the apply step. */
  preview: (f: Facets) => number;
  counted: { counted: number; active: number } | null;
  narrow: boolean;
}

export function ScopeBar({ rung, counts, onRung, facets, options, onFacets, preview, counted, narrow }: ScopeBarProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Facets>(facets);
  const panelId = useId();
  const n = activeFacetCount(facets);

  const openPanel = () => {
    setDraft(facets);
    setOpen(true);
  };

  return (
    <div className="pn-scope" data-testid="pn-scope">
      <div className="pn-rungs" role="radiogroup" aria-label="Which offers">
        {RUNGS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={rung === r.id}
            className="pn-rung"
            onClick={() => onRung(r.id)}
          >
            <span className="pn-rung__label">{narrow ? r.short : r.label}</span>{' '}
            <span className="pn-rung__n" data-testid={`pn-rung-count-${r.id}`}>
              {counts[r.id]}
            </span>
          </button>
        ))}
      </div>

      {narrow ? (
        <>
          <button
            type="button"
            className="pn-btn pn-filters-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => (open ? setOpen(false) : openPanel())}
          >
            Filters{n > 0 ? ` · ${n}` : ''}
          </button>
          {open && (
            <div className="pn-filters-panel" id={panelId} role="group" aria-label="Filters">
              <FacetRow value={draft} options={options} onChange={setDraft} counted={counted} />
              <div className="pn-filters-panel__foot">
                <button type="button" className="pn-btn pn-btn--quiet" onClick={() => setDraft(NO_FACETS)}>
                  Clear
                </button>
                <button
                  type="button"
                  className="pn-btn pn-btn--primary"
                  onClick={() => {
                    onFacets(draft);
                    setOpen(false);
                  }}
                >
                  Show {preview(draft)} offer{preview(draft) === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <FacetRow value={facets} options={options} onChange={onFacets} counted={counted} />
          {n > 0 && (
            <button type="button" className="pn-btn pn-btn--quiet pn-clear" onClick={() => onFacets(NO_FACETS)}>
              Clear filters
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default ScopeBar;
