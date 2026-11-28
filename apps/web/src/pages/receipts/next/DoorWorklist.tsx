/**
 * COUNTED AT THE DOOR, NO PAPERWORK YET — a worklist, not a ticker (r110
 * invoices-g2). Each row names who sent it, which order, how much came in and
 * how late its paper is, in words: "Acme Wines · PO-9 · 24 counted · 2 days late".
 *
 * While the list is still being read nothing is drawn, but the strip's last
 * measured height stays reserved so the queue below does not jump when it
 * lands. Only a failed read says "unknown". Rows are text swaps; there is no
 * animation, so reduced motion is the same page.
 */
import { useLayoutEffect, useRef } from 'react';
import type { UnverifiedDelivery } from '../../../services/api/receiving';

export const DOOR_ROW_PX = 44;
export const DOOR_ROWS_SHOWN = 3;
const HEIGHT_KEY = 'receipts.doorWorklist.height';

export function ageWords(d: Pick<UnverifiedDelivery, 'severity' | 'ageHours'>): string {
  if (d.severity === 'overdue') return 'overdue';
  if (d.severity === 'fresh') return 'today';
  const n = Math.max(1, Math.floor(d.ageHours / 24));
  return `${n} day${n === 1 ? '' : 's'} late`;
}

export function vendorWords(d: Pick<UnverifiedDelivery, 'providerId' | 'providerName'>): string {
  if (d.providerName) return d.providerName;
  return d.providerId ? 'a vendor that could not be read' : 'no vendor on the order';
}

export function doorRowText(d: UnverifiedDelivery): string {
  return `${vendorWords(d)} · ${d.orderNumber ?? 'an order with no number'} · ${d.countedQtyBottles} counted · ${ageWords(d)}`;
}

function readHeight(): number {
  try {
    const v = Number(window.localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}
function writeHeight(h: number) {
  try {
    window.localStorage.setItem(HEIGHT_KEY, String(h));
  } catch {
    /* a blocked store only costs the reservation */
  }
}

export function DoorWorklist({
  items,
  failed,
  noRestaurant,
  sans,
  mono,
}: {
  items: UnverifiedDelivery[] | null;
  failed: boolean;
  noRestaurant: boolean;
  sans: string;
  mono: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (items === null) return;
    // an empty list measures 0: the next visit reserves nothing
    writeHeight(ref.current ? ref.current.offsetHeight : 0);
  }, [items]);

  if (noRestaurant) return null;
  if (items === null) {
    if (failed)
      return (
        <p className="mb-4" style={{ fontFamily: sans, fontSize: 12, color: 'var(--ink-4, #665D50)' }}>
          Deliveries counted at the door: unknown — that list has not answered, so this page is not
          claiming the door is caught up.
        </p>
      );
    const h = readHeight();
    return h > 0 ? <div aria-hidden="true" data-testid="door-reserve" style={{ height: h }} /> : null;
  }
  if (items.length === 0) return null;
  const shown = items.slice(0, DOOR_ROWS_SHOWN);
  const more = items.length - shown.length;
  return (
    <div
      ref={ref}
      className="mb-4 rounded-xl px-4 py-3"
      style={{ fontFamily: sans, border: '1px dashed var(--ink-3, #7C7365)', background: 'var(--paper-1, #F3EFE6)' }}
    >
      <span style={{ fontFamily: mono, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4, #665D50)' }}>
        Counted at the door, no paperwork yet
      </span>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((d) => (
          <li
            key={d.orderId}
            style={{ minHeight: DOOR_ROW_PX, display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--ink-2, #4F473C)', overflowWrap: 'anywhere' }}
          >
            {/* "btl" was a wine word; the count is of whatever came in (W38). */}
            {doorRowText(d)}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-4, #665D50)' }}>and {more} more</div>
      )}
    </div>
  );
}
