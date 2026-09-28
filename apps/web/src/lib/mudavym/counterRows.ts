/**
 * One act row, in the words a house reads (sketch 119 D's act anatomy: the
 * verb, what, one line of detail, when). Pure, so the copy is testable and a
 * missing field prints as missing rather than as an invented value.
 */

import { fmtMoney } from './format';
import type {
  CounterCreditRow,
  CounterDeliveryRow,
  CounterIdentityRow,
  CounterInvitationRow,
  CounterOrderRow,
  CounterProposalRow,
  CounterRegisterKey,
  CounterRowByKey,
  CounterThreadRow,
  HouseCounterRead,
} from './counterRead';

const EM = '—';

export interface ActLine {
  id: string;
  what: string;
  detail: string;
  /** Short time: "14:02" today, "19 Sep" otherwise. EM when unknown. */
  at: string;
}

/** The house's currency for a figure that does not carry its own. */
export function houseCurrencyCode(read: HouseCounterRead | null): string | null {
  return read?.house.currency.state === 'recorded' ? read.house.currency.code : null;
}

/** A money figure with the house's currency, or a sentence saying which is missing. */
export function orderMoney(total: number | null, read: HouseCounterRead | null): string {
  if (total === null || total === undefined) return 'total not stated';
  if (read?.house.currency.state === 'unreadable') {
    return `${total.toLocaleString('en-GB')} (currency could not be read)`;
  }
  return fmtMoney(total, houseCurrencyCode(read));
}

export function shortWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return EM;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function orderLine(o: CounterOrderRow, read: HouseCounterRead | null): ActLine {
  const qty =
    o.quantity !== null && o.quantity !== undefined
      ? `${o.quantity}${o.unitType ? ` ${o.unitType}` : ''}`
      : 'quantity not stated';
  return {
    id: o.id,
    what: `${o.vendor ?? 'Vendor not named'} — ${o.wine ?? `order ${o.orderNumber ?? EM}`}`,
    detail: `${qty} · ${orderMoney(o.total, read)}`,
    at: shortWhen(o.requestedAt),
  };
}

function deliveryLine(d: CounterDeliveryRow): ActLine {
  return {
    id: d.orderId,
    what: `Order ${d.orderNumber ?? EM} · ${d.countedQtyBottles} bottles counted by case`,
    detail:
      d.severity === 'overdue'
        ? `not counted by the bottle · ${d.ageHours} h, overdue`
        : `not counted by the bottle · ${d.ageHours} h`,
    at: shortWhen(d.countedAt),
  };
}

function creditLine(c: CounterCreditRow): ActLine {
  return {
    id: c.id,
    what: `${c.vendor ?? 'Vendor not named'} · ${fmtMoney(c.promisedAmount, c.currency)} promised`,
    detail: `not recovered until the memo arrives${c.summary ? ` · ${c.summary}` : ''}`,
    at: shortWhen(c.promisedAt),
  };
}

function threadLine(t: CounterThreadRow): ActLine {
  return {
    id: t.id,
    what: t.vendor ?? 'Vendor not named',
    detail: `${t.orderNumber ? `order ${t.orderNumber} · ` : ''}${
      t.aiGenerated ? 'a reply Mudavym drafted' : 'a reply'
    } · not sent`,
    at: shortWhen(t.createdAt),
  };
}

function identityLine(i: CounterIdentityRow): ActLine {
  const conf =
    i.confidence === null || i.confidence === undefined
      ? 'confidence not stated'
      : `confidence ${Math.round(i.confidence * 100) / 100}`;
  return {
    id: i.id,
    what: 'Two records may be the same bottle',
    detail: `${i.method ?? 'method not stated'} · ${conf}`,
    at: shortWhen(i.createdAt),
  };
}

function invitationLine(i: CounterInvitationRow): ActLine {
  return {
    id: i.id,
    what: `An invitation as ${i.role ?? 'a role not stated'}, not yet accepted`,
    detail: i.expiresAt ? `expires ${shortWhen(i.expiresAt)}` : 'no expiry recorded',
    at: shortWhen(i.createdAt),
  };
}

function proposalLine(p: CounterProposalRow): ActLine {
  return {
    id: p.id,
    what: p.summary ?? p.utterance ?? 'A proposal with no summary',
    detail: 'a proposal, not applied',
    at: shortWhen(p.createdAt),
  };
}

export function actLine<K extends CounterRegisterKey>(
  key: K,
  row: CounterRowByKey[K],
  read: HouseCounterRead | null,
): ActLine {
  switch (key) {
    case 'orders':
      return orderLine(row as CounterOrderRow, read);
    case 'deliveries':
      return deliveryLine(row as CounterDeliveryRow);
    case 'credits':
      return creditLine(row as CounterCreditRow);
    case 'threads':
      return threadLine(row as CounterThreadRow);
    case 'identities':
      return identityLine(row as CounterIdentityRow);
    case 'invitations':
      return invitationLine(row as CounterInvitationRow);
    default:
      return proposalLine(row as CounterProposalRow);
  }
}
