/**
 * The counter's read model — `GET /house/counter` as the page understands it,
 * and the arithmetic the counter prints from it.
 *
 * Mirrors `apps/api-gateway/src/house/house-counter.types.ts`. The gateway is
 * the source of the shape; this file only declares what the page reads.
 *
 * THE RULES THE ARITHMETIC KEEPS (sketch 119 D, "What both hold")
 * ---------------------------------------------------------------
 * - The head counts REGISTERS, never acts: "5 of 7 registers · 2 not read".
 * - Never "n of n" when a register refused or was not read.
 * - Never a sum of acts across registers; a verb's count on the tucked strip
 *   is shown only when every register under that verb answered — one that did
 *   not is a hollow ring, never a partial number.
 * - A page-sized answer (`complete: false`) is a floor, printed with "+".
 */

export type CounterVerb = 'seal' | 'verify' | 'reply' | 'decide' | 'proposed';

export type CounterRegisterKey =
  | 'orders'
  | 'deliveries'
  | 'credits'
  | 'threads'
  | 'identities'
  | 'invitations'
  | 'proposals';

export type CounterAct = 'yours' | 'not_yours';

export interface CounterOrderRow {
  id: string;
  orderNumber: string | null;
  vendor: string | null;
  wine: string | null;
  quantity: number | null;
  unitType: string | null;
  total: number | null;
  status: string;
  requestedAt: string | null;
}

export interface CounterDeliveryRow {
  orderId: string;
  orderNumber: string | null;
  countedQtyBottles: number;
  countedAt: string;
  ageHours: number;
  severity: 'fresh' | 'stale' | 'overdue';
}

export interface CounterCreditRow {
  id: string;
  vendor: string | null;
  reason: string;
  summary: string | null;
  promisedAmount: number;
  currency: string | null;
  promisedAt: string | null;
}

export interface CounterThreadRow {
  id: string;
  vendor: string | null;
  orderNumber: string | null;
  channel: string | null;
  intent: string | null;
  aiGenerated: boolean;
  createdAt: string | null;
}

export interface CounterIdentityRow {
  id: string;
  subject: string | null;
  method: string | null;
  confidence: number | null;
  createdAt: string | null;
}

export interface CounterInvitationRow {
  id: string;
  role: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

export interface CounterProposalRow {
  id: string;
  summary: string | null;
  family: string | null;
  actionType: string | null;
  utterance: string | null;
  createdAt: string | null;
}

export interface CounterRowByKey {
  orders: CounterOrderRow;
  deliveries: CounterDeliveryRow;
  credits: CounterCreditRow;
  threads: CounterThreadRow;
  identities: CounterIdentityRow;
  invitations: CounterInvitationRow;
  proposals: CounterProposalRow;
}

interface RegisterBase {
  key: CounterRegisterKey;
  verb: CounterVerb;
  readAt: string;
  ms: number;
}

export interface CounterRegisterAnswered extends RegisterBase {
  state: 'answered';
  count: number;
  complete: boolean;
  rows: CounterRowByKey[CounterRegisterKey][];
  act: CounterAct;
}

export interface CounterRegisterRefused extends RegisterBase {
  state: 'refused';
  sentence: string;
}

export interface CounterRegisterUnreadable extends RegisterBase {
  state: 'unreadable';
  status: number | null;
  sentence: string;
}

export type CounterRegister =
  | CounterRegisterAnswered
  | CounterRegisterRefused
  | CounterRegisterUnreadable;

export interface HouseCounterRead {
  readAt: string;
  house: {
    id: string;
    currency: { state: 'recorded' | 'not_recorded' | 'unreadable'; code: string | null };
  };
  role: string | null;
  registers: CounterRegister[];
}

/** The verbs in the order the counter draws them. */
export const COUNTER_VERBS: readonly CounterVerb[] = ['seal', 'verify', 'reply', 'decide', 'proposed'];

export const VERB_WORD: Record<CounterVerb, string> = {
  seal: 'Seal',
  verify: 'Verify',
  reply: 'Reply',
  decide: 'Decide',
  proposed: 'Mudavym proposes',
};

/** The short word the tucked strip and the phone print. */
export const VERB_SHORT: Record<CounterVerb, string> = {
  seal: 'Seal',
  verify: 'Verify',
  reply: 'Reply',
  decide: 'Decide',
  proposed: 'Proposed',
};

/** What each register is, in the words a house reads. */
export const REGISTER_WORD: Record<CounterRegisterKey, string> = {
  orders: 'Orders awaiting the seal',
  deliveries: 'Deliveries counted by case',
  credits: 'Credits promised',
  threads: 'Replies waiting',
  identities: 'Identities',
  invitations: 'Invitations',
  proposals: 'Proposals',
};

/**
 * Where each register's records live — the page an act opens to. `null` where
 * no page holds the act today: identity candidates have no web surface at all
 * (nothing under apps/web reads `vendor-intel/identity/candidates`), and a
 * proposal is applied only by the seal — in the counter's own sheet — so the
 * counter does not send it to a click-to-confirm door.
 */
export const REGISTER_ROOM: Record<CounterRegisterKey, { name: string; path: string } | null> = {
  orders: { name: 'Orders', path: '/orders' },
  deliveries: { name: 'Receiving', path: '/receiving' },
  credits: { name: 'Receipts & Credits', path: '/receipts?tab=credits' },
  threads: { name: 'Communications', path: '/communications' },
  identities: null,
  invitations: { name: 'Team', path: '/team' },
  proposals: null,
};

/**
 * The counter's head, computed from the registers actually returned and their
 * outcomes — never a constant (sketch 119, second round: a constant head was
 * absence reported as health on the frame drawn to prove role honesty).
 */
export function counterHead(registers: readonly CounterRegister[]): string {
  const n = registers.length;
  if (n === 0) return 'no registers read';
  const answered = registers.filter((r) => r.state === 'answered').length;
  const refused = registers.filter((r) => r.state === 'refused').length;
  const unread = registers.filter((r) => r.state === 'unreadable').length;
  const parts = [`${answered} of ${n} registers`];
  if (refused) parts.push(`${refused} refused`);
  if (unread) parts.push(`${unread} not read`);
  return parts.join(' · ');
}

/** A register's own count as printed: "3", or "50+" when the read was a page. */
export function countWord(r: CounterRegisterAnswered): string {
  return r.complete ? String(r.count) : `${r.count}+`;
}

export type VerbMark =
  /** Every register under the verb answered: this many rows wait. */
  | { kind: 'count'; count: number; floor: boolean }
  /** At least one register under the verb could not be read: no number. */
  | { kind: 'unread' }
  /** Every register under the verb refused this role. */
  | { kind: 'refused' }
  /** The verb has no register in this read. */
  | { kind: 'absent' };

/**
 * What the tucked strip (and the phone's Counter door) prints for one verb.
 *
 * A number only when every register under the verb answered or refused and at
 * least one answered — a failed register makes the whole verb a ring, because a
 * partial sum is a failure printed as a smaller number.
 */
export function verbMark(registers: readonly CounterRegister[], verb: CounterVerb): VerbMark {
  const mine = registers.filter((r) => r.verb === verb);
  if (mine.length === 0) return { kind: 'absent' };
  if (mine.some((r) => r.state === 'unreadable')) return { kind: 'unread' };
  const answered = mine.filter((r): r is CounterRegisterAnswered => r.state === 'answered');
  if (answered.length === 0) return { kind: 'refused' };
  return {
    kind: 'count',
    count: answered.reduce((s, r) => s + r.count, 0),
    floor: answered.some((r) => !r.complete),
  };
}

/**
 * Does anything wait on THIS person? Drives the dot on the header toggle and
 * the phone's Counter door — a dot, never a number (the bell's number and the
 * counter's never share one).
 *
 * `null` means "cannot say": a register that could have held an act for this
 * person was not read. The dot is then hollow, not absent.
 */
export function actsWaiting(registers: readonly CounterRegister[]): boolean | null {
  let unknown = false;
  for (const r of registers) {
    if (r.state === 'unreadable') unknown = true;
    if (r.state === 'answered' && r.act === 'yours' && r.count > 0) return true;
  }
  return unknown ? null : false;
}

/** "14:02:11" in the reader's own clock. The device's time, labelled as a read. */
export function clockOf(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
