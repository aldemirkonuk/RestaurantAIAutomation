/**
 * /inventory on a phone: the controls that left the page (critic c3 round 3,
 * P0 item 2 and P1 item 13).
 *
 * A phone has 343 px and a thumb. The book gets all of it, so every filter
 * lives behind ONE 48 px "Filter" button that opens a bottom sheet, and a
 * member of staff gets a count mode: search, big rows and a sticky "Count" bar,
 * with nothing else on the screen.
 */
import { useState, type ReactNode } from 'react';
import { Sheet } from '@/components/mudavym';
import type { InvRow } from './useInventoryNextData';

/** How many of the list's narrowing controls are set (the chip, kind, zone, type, sort and view). */
export function activeFilterCount(v: { chip: string; kind: string; zone: string; type: string; sort: string; view: string }): number {
  let n = 0;
  if (v.chip !== 'all') n += 1;
  if (v.kind !== '') n += 1;
  if (v.zone !== '') n += 1;
  if (v.type !== '') n += 1;
  if (v.sort !== 'needs') n += 1;
  if (v.view !== 'table') n += 1;
  return n;
}

/**
 * The good a counter should reach for next: one nobody has counted, in the
 * list's own order; otherwise the one counted longest ago. Null when the list
 * is empty. A date that cannot be read is treated as never counted.
 */
export function nextToCount(rows: InvRow[]): InvRow | null {
  let best: InvRow | null = null;
  let bestAt = Infinity;
  for (const r of rows) {
    const t = r.lastCountedAt ? Date.parse(r.lastCountedAt) : NaN;
    const at = Number.isFinite(t) ? t : -Infinity;
    if (best === null || at < bestAt) {
      best = r;
      bestAt = at;
    }
  }
  return best;
}

export interface PhoneFilterProps {
  /** How many controls are set; shown on the button and never hidden when zero is not. */
  active: number;
  onClear: () => void;
  children: (close: () => void) => ReactNode;
}

/** The one 48 px Filter button and the bottom sheet it opens. */
export function PhoneFilter({ active, onClear, children }: PhoneFilterProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="iv-btn iv-focus iv-filterbtn"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="inventory-filter-button"
        onClick={() => setOpen(true)}
      >
        Filter
        {active > 0 ? (
          <span className="iv-filterbtn__n iv-num" aria-label={`${active} set`}>
            {active}
          </span>
        ) : null}
      </button>
      {open ? (
        <Sheet
          open
          onClose={() => setOpen(false)}
          label="Filters for the list. Closing keeps what you picked."
          eyebrow="Inventory"
          title="Filter"
          spine="Filter"
          detents={['half', 'full']}
          className="iv-filtersheet"
          bodyClassName="iv-sheet-body iv-filtersheet__body"
        >
          <div data-testid="inventory-filter-sheet">
            {children(() => setOpen(false))}
            <div className="iv-filtersheet__foot">
              <button type="button" className="iv-btn iv-focus" onClick={onClear} disabled={active === 0}>
                Clear
              </button>
              <button type="button" className="iv-btn iv-focus" data-seal="true" onClick={() => setOpen(false)}>
                Show the list
              </button>
            </div>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

/** A member of staff counts: one sticky 56 px bar that opens the count for the next good. */
export function CountBar({ next, onCount }: { next: InvRow | null; onCount: (row: InvRow) => void }) {
  if (next === null) return null;
  return (
    <div className="iv-countbar" data-testid="inventory-count-bar">
      <button type="button" className="iv-countbar__btn iv-focus" onClick={() => onCount(next)}>
        <span className="iv-countbar__word">Count</span>
        <span className="iv-countbar__next">{next.name ?? 'the next good'}</span>
      </button>
    </div>
  );
}
