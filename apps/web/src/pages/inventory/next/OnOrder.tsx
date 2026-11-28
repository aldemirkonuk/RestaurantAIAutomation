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
import { EM, fmtCount, suggestedToPar, type InvRow } from './useInventoryNextData';
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

const isAre = (n: number) => (n === 1 ? 'is' : 'are');

/** What is not taken off: orders not yet sent, and sent orders in a unit the book does not count in. */
function notCounted(o: Extract<ItemOnOrder, { readable: true }>): string[] {
  const out: string[] = [];
  if (o.arrivingInBookUnit === null) {
    // One order in a unit the book does not count means nothing on its way is
    // taken off, the orders in the book's own unit included (r110 inventory fix).
    const byUnit = new Map<string | null, number>();
    for (const x of o.sent) byUnit.set(x.unit, (byUnit.get(x.unit) ?? 0) + x.openQty);
    const total = [...byUnit.values()].reduce((a, b) => a + b, 0);
    const words = [...byUnit].map(([u, q]) => orderQty(q, u)).join(' + ');
    const other = distinct(o.sent.filter((x) => x.inBookUnit === null));
    out.push(
      `${words} on ${total === 1 ? 'its' : 'their'} way ${isAre(total)} not counted: ${other === 1 ? 'one is' : `${fmtCount(other)} are`} in a unit the book does not count`,
    );
  }
  const k = distinct(o.unsent);
  if (k > 0) {
    const inBook = o.unsent.every((x) => x.inBookUnit !== null);
    const sum = o.unsent.reduce((a, x) => a + (x.inBookUnit ?? 0), 0);
    out.push(
      inBook
        ? `${fmtCount(sum)} not yet sent ${isAre(sum)} not counted`
        : `${plural(k, 'order', 'orders')} not yet sent ${isAre(k)} not counted`,
    );
  }
  return out;
}

/**
 * The Order more sheet's sentence over the field (r110 g5): what brings it to
 * par, and what was taken off for what is already on its way. Undefined is a
 * sheet handed no orders: the sentence it always said.
 */
export function toParSentence(row: InvRow, load: OnOrderLoad): string {
  if (row.par === null || row.par <= 0) return 'No par is set on this row, so there is no suggested quantity.';
  if (row.stock === null) return 'The stock could not be read, so there is no suggested quantity.';
  const plain = suggestedToPar(row);
  if (plain === null) return 'It is at or above par, so there is no suggested quantity.';
  const par = fmtCount(row.par);
  if (load === undefined) return `${fmtCount(plain)} bring it back to par (${par}).`;
  if (load === 'reading') return 'Reading what is on order\u2026';
  if (load === 'failed' || !load.readable) {
    return `${fmtCount(plain)} bring it to par (${par}): what is on order could not be read, so nothing on its way is taken off.`;
  }
  const arriving = load.arrivingInBookUnit ?? 0;
  const k = distinct(load.sent);
  const rest = notCounted(load);
  const toPar = suggestedToPar(row, load);
  const onWay = `${fmtCount(arriving)} more ${isAre(arriving)} on ${arriving === 1 ? 'its' : 'their'} way on ${plural(k, 'order', 'orders')}`;
  if (toPar === null) {
    const tail = rest.length > 0 ? `; ${rest.join('; ')}` : '';
    return `With what is on its way (${fmtCount(arriving)} on ${plural(k, 'order', 'orders')}), it reaches par (${par}), so there is no suggested quantity${tail}.`;
  }
  const clauses = [...(arriving > 0 ? [onWay] : []), ...rest];
  if (clauses.length === 0) return `${fmtCount(toPar)} bring it back to par (${par}).`;
  return `${fmtCount(toPar)} bring it to par (${par}): ${clauses.join('; ')}.`;
}

/** The list's "Suggested to par" words beside the figure, so it reads as the sheet does; null adds nothing. */
export function toParNote(load: OnOrderLoad): string | null {
  if (load === undefined || load === 'reading') return null;
  if (load === 'failed' || !load.readable) return 'what is on order could not be read';
  if (load.arrivingInBookUnit === null) return 'nothing on its way is counted: an order is in another unit';
  if (load.arrivingInBookUnit > 0) return `less ${fmtCount(load.arrivingInBookUnit)} on its way`;
  return null;
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
