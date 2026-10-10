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

/**
 * A money figure with the house's currency, or a sentence saying which is
 * missing. A total kept from this role (staff see counts, never amounts) says
 * so, rather than claiming the order states none.
 */
export function orderMoney(total: number | null, read: HouseCounterRead | null): string {
  if (read?.amounts === 'withheld') return 'amount withheld';
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

/**
 * How likely, in words. The matcher's method code and raw score are the
 * system's own terms, not the owner's, so neither is printed (F-267).
 */
function likelihoodWord(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) {
    return 'how likely is not recorded';
  }
  if (confidence >= 0.9) return 'very likely';
  if (confidence >= 0.7) return 'likely';
  return 'possible';
}

function identityLine(i: CounterIdentityRow): ActLine {
  return {
    id: i.id,
    what: 'May be the same wine',
    detail: `${likelihoodWord(i.confidence)} · kept for the record`,
    at: shortWhen(i.createdAt),
  };
}

/**
 * An invitation is a code, not a person — organization_invites records no
 * name or email — so the row cannot say whom it is for. It says what the
 * owner decides (send it again, or withdraw it) and where, and when it runs
 * out, in words when that is within a day (F-176).
 */
function invitationLine(i: CounterInvitationRow, now: Date = new Date()): ActLine {
  const role = i.role?.trim();
  const what = role
    ? `${/^[aeiou]/i.test(role) ? 'An' : 'A'} ${role} invitation nobody has used yet`
    : 'An invitation (role not recorded) nobody has used yet';
  const act = 'send it again or withdraw it on Team';
  const ends = i.expiresAt ? new Date(i.expiresAt).getTime() : NaN;
  let detail: string;
  if (Number.isNaN(ends)) detail = `no end date recorded · ${act}`;
  else if (ends <= now.getTime()) detail = `ran out ${shortWhen(i.expiresAt, now)} · withdraw it or send a new one on Team`;
  else if (ends - now.getTime() <= 86_400_000) detail = `ends within a day (${shortWhen(i.expiresAt, now)}) · ${act}`;
  else detail = `ends ${shortWhen(i.expiresAt, now)} · ${act}`;
  return { id: i.id, what, detail, at: shortWhen(i.createdAt, now) };
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
