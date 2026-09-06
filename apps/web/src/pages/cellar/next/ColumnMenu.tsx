/**
 * THE COLUMN'S OWN MENU — and the one gesture set the cellar uses everywhere.
 *
 * THE GESTURE SET, STATED ONCE (and it is the same on every register):
 *
 *   the HEADER owns the COLUMN.
 *     right-click a header      → this menu
 *     click the header's caret  → this menu (the keyboard- and touch-reachable
 *                                 twin, because right-click is neither)
 *     click the header's label  → sort by it, and again to reverse
 *     Shift+F10 / the menu key  → this menu, from the keyboard
 *
 *   the CELL owns the ROW'S RECORD.
 *     double-click a cell       → the series behind that row × that column
 *     right-click a cell        → the same
 *     Enter on a focused cell   → the same
 *     single click a row        → the reading stand, unchanged since pass one
 *
 * WHY THIS SPLIT, AND WHOSE PRECEDENT IT IS. Every table tool the brief named
 * puts the SCHEMA on the header and the DATA on the cell, and none of them mix
 * the two. Airtable's field-header dropdown is Edit field · Edit description ·
 * Duplicate · Delete — schema, entirely
 * (https://support.airtable.com/articles/2361876459-field-type-overview).
 * TradingView's screener is the closest analogue to a register, and it is
 * explicit: *"You can click any row to open the chart"*, and *"With a
 * right-click on a column header, you can customize the column, select the
 * sorting type, change a column's position … or remove a column"*
 * (https://www.tradingview.com/support/solutions/43000718866-tradingview-stock-screener-trade-smarter-not-harder/).
 * Bloomberg does the same thing with two functions rather than two targets —
 * `GP <GO>` graphs the series, `HP <GO>` tables it.
 *
 * WHAT IS DELIBERATELY NOT ON THIS MENU. Nothing that edits a schema. Airtable
 * offers Edit field / Delete field because an Airtable column is the user's
 * own; a cellar column is a claim about a table in Postgres, and a menu that
 * offered to rename or delete one would be offering something the gateway would
 * refuse. What replaces it is the thing an operator actually cannot find out
 * anywhere else: **what this column is, where it is read from, and how much of
 * it is filled** — the founder's "research" view, attached to the column rather
 * than buried in a help page.
 *
 * ACCESSIBILITY. Right-click is not a keyboard gesture and is the browser's own
 * on touch, so it is never the only way in: the caret is a real
 * `<button aria-haspopup="menu">`, the menu is `role="menu"` with
 * `role="menuitem"` children, Escape closes and returns focus, and arrow keys
 * move between items.
 */

import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, BookOpen, EyeOff, LineChart } from 'lucide-react';
import { columnAccount, type CellarColumn } from './cellar-columns';

export interface ColumnMenuProps {
  column: CellarColumn;
  /** Where the menu opened, in client coordinates. */
  at: { x: number; y: number };
  sorted: 'asc' | 'desc' | null;
  onSort: (dir: 'asc' | 'desc') => void;
  /** Null when no row is selected — the item renders disabled with the reason. */
  onOpenSeries: (() => void) | null;
  onHide: (() => void) | null;
  onClose: () => void;
}

export default function ColumnMenu({
  column,
  at,
  sorted,
  onSort,
  onOpenSeries,
  onHide,
  onClose,
}: ColumnMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(
        ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'ArrowDown'
          ? items[(i + 1 + items.length) % items.length]
          : items[(i - 1 + items.length) % items.length];
      next.focus();
    };
    const onAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onAway);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onAway);
    };
  }, [onClose]);

  const account = columnAccount(column);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${column.label} column`}
      data-testid="column-menu"
      className="cl-menu"
      style={{ left: Math.max(8, at.x), top: Math.max(8, at.y) }}
    >
      <p className="cl-crumb" style={{ margin: '0 0 6px' }}>
        {column.label}
        <span className="cl-dim">
          {' · '}
          {column.side === 'house'
            ? 'our own record'
            : column.side === 'cellar'
              ? 'the cellar'
              : 'the shared catalogue'}
        </span>
      </p>

      <button
        type="button"
        role="menuitem"
        className="cl-menuitem cl-focus"
        onClick={() => onSort('asc')}
        data-on={sorted === 'asc'}
      >
        <ArrowUp size={13} aria-hidden /> Sort up
      </button>
      <button
        type="button"
        role="menuitem"
        className="cl-menuitem cl-focus"
        onClick={() => onSort('desc')}
        data-on={sorted === 'desc'}
      >
        <ArrowDown size={13} aria-hidden /> Sort down
      </button>

      {column.series === null ? (
        <p className="cl-menunote" data-testid="column-menu-no-series">
          <LineChart size={13} aria-hidden /> This column has no series. It is
          what the row IS, not something that happened to it — there is nothing
          to plot over time and nothing is offered.
        </p>
      ) : onOpenSeries === null ? (
        <p className="cl-menunote" data-testid="column-menu-series-needs-row">
          <LineChart size={13} aria-hidden /> Open the series from a cell — a
          series belongs to one row, and no row is chosen. Double-click any cell
          in this column.
        </p>
      ) : (
        <button
          type="button"
          role="menuitem"
          className="cl-menuitem cl-focus"
          onClick={onOpenSeries}
        >
          <LineChart size={13} aria-hidden /> Open the series for the chosen row
        </button>
      )}

      {onHide ? (
        <button
          type="button"
          role="menuitem"
          className="cl-menuitem cl-focus"
          onClick={onHide}
        >
          <EyeOff size={13} aria-hidden /> Hide this column
        </button>
      ) : null}

      <div className="cl-menuaccount">
        <p className="cl-crumb" style={{ margin: '0 0 4px' }}>
          <BookOpen size={12} aria-hidden style={{ verticalAlign: '-1px' }} /> What
          this column is
        </p>
        {account.map((line) => (
          <p key={line} className="cl-menunote-plain">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
