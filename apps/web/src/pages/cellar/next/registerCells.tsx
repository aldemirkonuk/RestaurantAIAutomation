/**
 * One column id → one cell, and one sort value. The only place a register row
 * is turned into something readable.
 *
 * WHY IT IS SEPARATE FROM THE COLUMN VOCABULARY. `cellar-columns.ts` says what
 * a column MEANS and what fills it — a claim about the schema, testable without
 * React. This file says what one row LOOKS like in that column — a claim about
 * rendering. Keeping them apart is what lets the whole-cellar view and each
 * register draw the same column with the same grammar and no second copy of the
 * rule.
 *
 * THE ONE RULE THAT MATTERS. An unknown is `—`. A zero is only ever printed
 * where a zero was counted. `restaurant_inventory.total_revenue` and
 * `times_ordered_count` are NOT NULL and zero on all 206 rows in this database,
 * and neither appears here or in the vocabulary for exactly that reason.
 */

import type { ReactNode } from 'react';
import { BOOK_LABEL, BOOK_ORDER, EM, count, money, shortDate, type HouseBookId } from './cellar-format';
import type { RegisterRowVM } from './useCellarNextData';

/**
 * The row's record at a glance: one mark per book that names it. Ink, never a
 * semantic colour — the chip rule (contrast measured, ADR 0042).
 *
 * A plain function returning nodes rather than a component, deliberately: this
 * module's job is the cell vocabulary, and a file that exports both a component
 * and a function breaks fast refresh (react-refresh/only-export-components).
 */
function booksCell(books: HouseBookId[]): ReactNode {
  if (books.length === 0) return <span className="cl-dim">{EM}</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {BOOK_ORDER.map((b) => (
        <span
          key={b}
          className="cl-mark"
          data-on={books.includes(b)}
          title={BOOK_LABEL[b]}
          aria-label={books.includes(b) ? BOOK_LABEL[b] : undefined}
        >
          {BOOK_LABEL[b].slice(0, 1)}
        </span>
      ))}
    </span>
  );
}

function dim(v: string): ReactNode {
  return <span className="cl-dim">{v}</span>;
}

export function cellFor(r: RegisterRowVM, id: string): ReactNode {
  const h = r.house;
  const c = r.catalogue;
  switch (id) {
    case 'name':
      return (
        <>
          <span className="cl-serif" style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>
            {r.name}
          </span>
          <span className="cl-dim" style={{ fontSize: 11 }}>
            {r.producer ?? (h ? 'this house’s own line' : 'unattributed')}
            {c?.matchedBy === 'contains' ? ' · matched loosely' : ''}
          </span>
        </>
      );
    case 'books':
      return booksCell(h?.books ?? []);
    case 'listed': {
      const m = h?.onMenu;
      if (!m) return dim(EM);
      const price = m.bottlePrice ?? m.glassPrice;
      if (price === null) return dim(EM);
      return (
        <>
          {money(price)}
          {m.bottlePrice === null ? <span className="cl-dim" style={{ fontSize: 10 }}> /gl</span> : null}
        </>
      );
    }
    case 'first':
      return h?.bought?.first ? shortDate(h.bought.first) : dim(EM);
    case 'paid':
      return money(h?.bought?.paidTotal);
    case 'sold':
      return count(h?.poured?.qty ?? null);
    case 'charged':
      return money(h?.poured?.revenue ?? null);
    case 'quote':
      return money(h?.quoted?.lastPrice ?? null);
    case 'ordered':
      return h?.ordered?.lastAt ? shortDate(h.ordered.lastAt) : dim(EM);
    case 'type':
      return c?.beverageType ?? dim(EM);
    case 'origin':
      return [c?.region, c?.country].filter(Boolean).join(', ') || dim(EM);
    case 'abv':
      return c?.abvPct === null || c?.abvPct === undefined ? dim(EM) : `${c.abvPct}%`;
    case 'format':
      return c?.volumeMl ? `${c.volumeMl} ml` : dim(EM);
    // Every column below is a real column of `public.beverages` with no writer
    // on this database (measured 0 of 609). They are off by default and the
    // header menu says why; when an operator turns one on they get the em dash
    // and the reason, never a blank cell that looks like a rendering bug.
    case 'style':
    case 'ibu':
    case 'age':
    case 'cask':
    case 'proof':
      return dim(EM);
    default:
      return dim(EM);
  }
}

/** Sort value, or null for unknown. Unknowns sink in BOTH directions. */
export function sortValueFor(r: RegisterRowVM, id: string): string | number | null {
  const h = r.house;
  const c = r.catalogue;
  switch (id) {
    case 'books': return h ? h.books.length : null;
    case 'listed': return h?.onMenu?.bottlePrice ?? h?.onMenu?.glassPrice ?? null;
    case 'first': return h?.bought?.first ? Date.parse(h.bought.first) : null;
    case 'paid': return h?.bought?.paidTotal ?? null;
    case 'sold': return h?.poured?.qty ?? null;
    case 'charged': return h?.poured?.revenue ?? null;
    case 'quote': return h?.quoted?.lastPrice ?? null;
    case 'ordered': return h?.ordered?.lastAt ? Date.parse(h.ordered.lastAt) : null;
    case 'type': return c?.beverageType?.toLowerCase() ?? null;
    case 'origin':
      return [c?.region, c?.country].filter(Boolean).join(', ').toLowerCase() || null;
    case 'abv': return c?.abvPct ?? null;
    case 'format': return c?.volumeMl ?? null;
    case 'style':
    case 'ibu':
    case 'age':
    case 'cask':
    case 'proof':
      return null;
    default: return r.name.toLowerCase();
  }
}
