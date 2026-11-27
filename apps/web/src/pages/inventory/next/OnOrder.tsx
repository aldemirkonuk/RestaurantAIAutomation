/**
 * What of a good is already on order (r109 g1): the drawer's "On order" card,
 * its evidence list, the "with what is on its way" cover line and the Order
 * more sheet's "already open" line, all from GET …/figures `onOrder`.
 *
 * An unread read says it could not be read and never 0 (ADR 0020). There is
 * no money here: the card is a quantity, for everyone.
 */
import { Link } from 'react-router-dom';
import type { ItemOnOrder, ItemOpenOrder } from '../../../services/api/inventory';
import { EM, fmtCount, type InvRow } from './useInventoryNextData';
import { fmtQty } from './ItemCards';

/** The figures read as it reaches the card: reading, failed as a whole, or answered (absent from an older gateway). */
export type OnOrderLoad = 'reading' | 'failed' | ItemOnOrder | undefined;

export const ORDER_STATUS_WORDS: Record<string, string> = {
  PENDING: 'waiting to be placed',
  APPROVAL_NEEDED: 'waiting for approval',
  NEGOTIATING: 'price being agreed',
  APPROVED: 'approved, not yet sent',
  CONFIRMED: 'confirmed by the vendor',
  IN_TRANSIT: 'on its way',
  PARTIALLY_RECEIVED: 'part received, the rest to come',
};

const ORDER_UNIT_WORDS: Record<string, [string, string]> = {
  each: ['item', 'items'],
  liter: ['litre', 'litres'],
  split_case: ['split case', 'split cases'],
};

/** A quantity in the order's own unit: "6 bottles", "2 cases", "3 items". A unit-less order is in bottles. */
export function orderQty(n: number, unit: string | null): string {
  const w = ORDER_UNIT_WORDS[unit ?? ''];
  if (w) return `${fmtCount(n)} ${n === 1 ? w[0] : w[1]}`;
  return fmtQty(n, unit ?? 'bottle');
}

/** "3 Dec": an order's expected day, read as the calendar day it names. */
export function dueDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const distinct = (xs: ItemOpenOrder[]) => new Set(xs.map((x) => x.id)).size;
const plural = (n: number, one: string, many: string) => `${fmtCount(n)} ${n === 1 ? one : many}`;

/** The sent quantity: in the book's unit when every sent order is in it, else each unit summed apart. */
function sentFigure(o: Extract<ItemOnOrder, { readable: true }>, uom: string | null): string {
  if (o.arrivingInBookUnit !== null) return fmtQty(o.arrivingInBookUnit, uom);
  const byUnit = new Map<string | null, number>();
  for (const x of o.sent) byUnit.set(x.unit, (byUnit.get(x.unit) ?? 0) + x.openQty);
  return [...byUnit].map(([u, q]) => orderQty(q, u)).join(' + ');
}

/** The card: one figure and one sentence; unread for a failed or absent read. */
export function onOrderCard(load: OnOrderLoad, uom: string | null): { figure: string; source: string; unread: boolean } {
  if (load === 'reading') return { figure: EM, source: 'Reading…', unread: false };
  if (load === 'failed' || load === undefined || !load.readable) {
    return { figure: EM, source: 'What is on order could not be read, so whether an order is open is not known.', unread: true };
  }
  const sent = distinct(load.sent);
  const unsent = distinct(load.unsent);
  if (sent + unsent === 0) return { figure: 'Nothing open', source: 'No order for it is open on Orders.', unread: false };
  const due = load.sent
    .map((x) => x.expected)
    .filter((x): x is string => x !== null)
    .sort()[0];
  const parts: string[] = [];
  if (sent > 0) parts.push(`${fmtCount(sent)} on its way${due ? ` (due ${dueDay(due)})` : ''}`);
  if (unsent > 0) parts.push(`${fmtCount(unsent)} not yet sent`);
  return {
    figure: sent > 0 ? sentFigure(load, uom) : 'None on its way',
    source: `${plural(sent + unsent, 'order', 'orders')}: ${parts.join(', ')}.`,
    unread: false,
  };
}

/**
 * "with what is on its way: N days": (on hand + arriving) / usage a day. Only
 * when what arrives is in the book's unit and more than none, and the pace
 * was read and is running; otherwise null and the cover line stays as it was.
 */
export function coverWithArriving(row: InvRow, load: OnOrderLoad): string | null {
  if (load === 'reading' || load === 'failed' || load === undefined || !load.readable) return null;
  const arriving = load.arrivingInBookUnit;
  if (arriving === null || arriving <= 0) return null;
  if (!row.analyticsReadable || row.stock === null || row.velocity === null || row.velocity <= 0) return null;
  const days = Math.round((row.stock + arriving) / row.velocity);
  return `With what is on its way: ${plural(days, 'day', 'days')}.`;
}

/** How many orders are open, for the Order more sheet; null while unread. */
export function openOrderCount(load: OnOrderLoad): number | null {
  if (load === 'reading' || load === 'failed' || load === undefined || !load.readable) return null;
  return distinct(load.sent) + distinct(load.unsent);
}

/** The evidence: each open order, its state in words, what is still to come and when. */
export function OnOrderEvidence({ load }: { load: OnOrderLoad }) {
  let body;
  if (load === 'reading') body = <p className="iv-note">Reading the orders…</p>;
  else if (load === 'failed' || load === undefined || !load.readable) {
    body = <p className="iv-note">The orders could not be read. This is unread, not nothing on order.</p>;
  } else if (load.sent.length + load.unsent.length === 0) {
    body = <p className="iv-said">No order for it is open.</p>;
  } else {
    const all = [...load.sent, ...load.unsent];
    body = (
      <ul className="ivd-orders" data-testid="ivd-orders">
        {all.map((o, i) => {
          const due = dueDay(o.expected);
          return (
            <li key={`${o.id}-${o.unit ?? ''}-${i}`}>
              {o.orderNumber ?? 'An order with no number'} · {ORDER_STATUS_WORDS[o.status] ?? o.status.toLowerCase()} ·{' '}
              {orderQty(o.openQty, o.unit)} to come{due ? ` · due ${due}` : ''}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <section className="iv-col" data-testid="ivd-on-order">
      <h4 className="iv-sec">What is on order</h4>
      {body}
      <p className="iv-note">
        <Link to="/orders" className="iv-linkish iv-focus">
          Open Orders
        </Link>
      </p>
    </section>
  );
}
