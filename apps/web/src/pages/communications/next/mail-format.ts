/**
 * The Mail tab's words (founder /goal 2026-11-07; sw-walk mail proposal §2,
 * Phase C). Pure: every sentence the tab prints about people, doors and
 * letters is decided here, so the rules are proved without a DOM.
 *
 * Rules kept here, not in the components:
 * - an unknown figure is the em dash, never 0 (ADR 0051);
 * - no score, percentage or confidence is ever printed (ADR 0104);
 * - a door with no durable record of its reads is "cannot tell", never
 *   "reading" (proposal G14, L3);
 * - an outbound letter that has not left never looks sent (prc-02).
 */

import { EM, sendState } from './cm-format';

/** The shapes GET /mail/* answers with (apps/api-gateway/src/conversations/mail.types.ts). */
export type MailDoor = 'house_mailbox' | 'whatsapp' | 'mudavym_mail' | 'from_house';

export interface MailPersonRow {
  key: string;
  kind: 'vendor';
  providerId: string;
  name: string | null;
  lastAt: string;
  lastLine: string | null;
  lastDirection: 'inbound' | 'outbound' | null;
  waiting: boolean;
  waitingSince: string | null;
  openThreads: number;
  channels: string[];
  newestOpenOrderId: string | null;
  newestOpenOrderNumber: string | null;
}

export interface MailPeoplePage {
  people: MailPersonRow[];
  next: string | null;
  storedKinds: string[];
}

export interface MailPersonRef {
  key: string;
  kind: 'vendor';
  providerId: string;
  name: string | null;
}

export interface MailThreadRow {
  key: string;
  subject: string | null;
  messageCount: number;
  lastAt: string;
  lastDirection: 'inbound' | 'outbound' | null;
  waiting: boolean;
  orderId: string | null;
  orderNumber: string | null;
}

export interface MailThreadsPage {
  person: MailPersonRef | null;
  threads: MailThreadRow[];
  next: string | null;
}

export interface MailMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  text: string;
  aiGenerated: boolean;
  status: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  rawDeletedAt: string | null;
  door: MailDoor;
}

export interface MailThreadPage {
  key: string;
  subject: string | null;
  person: MailPersonRef | null;
  order: { id: string; number: string | null; status: string | null } | null;
  messages: MailMessage[];
  before: string | null;
}

export interface MailSummary {
  waitingPeople: number;
  oldestWaitAt: string | null;
  inToday: number;
  outToday: number;
  heldAtDoor: number | null;
  doors: {
    houseMailbox: { lastStoredAt: string | null };
    whatsapp: { lastStoredAt: string | null };
    mudavymMail: { lastStoredAt: string | null };
  };
  address: { configured: boolean; address: string | null };
}

/** The house-mailbox reader, as GET /communications/letters/sender reports it. */
export interface MailboxReader {
  granted: boolean | 'unknown';
  enabled: boolean;
  lastReadAt: string | null;
  lastError: string | null;
}

/** A read inside this many minutes counts as "reading". */
export const READING_WITHIN_MIN = 15;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A span in the house's words: "less than a minute", "4 minutes", "3 hours",
 * "2 days". Whole units, rounded down, so a wait is never overstated.
 */
export function spanWords(ms: number): string {
  if (!Number.isFinite(ms) || ms < MIN) return 'less than a minute';
  if (ms < HOUR) return plural(Math.floor(ms / MIN), 'minute', 'minutes');
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour', 'hours');
  return plural(Math.floor(ms / DAY), 'day', 'days');
}

/** The short form for a line that is read at a glance: "4 min", "3 h", "2 days". */
export function shortSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < MIN) return 'under a minute';
  if (ms < HOUR) return `${Math.floor(ms / MIN)} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  return plural(Math.floor(ms / DAY), 'day', 'days');
}

function at(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * The header sentence. `summary` is null until the read answers; `failed`
 * says the read failed — then the figure is the em dash and the reason is
 * said, never a zero that reads as "no one is waiting".
 */
export function headerSentence(
  summary: MailSummary | null,
  opts: { failed: boolean; reason?: string; now: number },
): string {
  if (!summary) {
    return opts.failed
      ? `${EM} Who is waiting on you could not be read (${opts.reason || 'no reason was given'}). That does not mean no one is.`
      : `${EM} Reading who is waiting on you…`;
  }
  const n = summary.waitingPeople;
  if (n === 0) return 'No one is waiting on you.';
  const lead = n === 1 ? '1 vendor is waiting on you.' : `${n} vendors are waiting on you.`;
  const since = at(summary.oldestWaitAt);
  if (since === null) return lead;
  const span = spanWords(opts.now - since);
  return n === 1 ? `${lead} They have been waiting ${span}.` : `${lead} The oldest has been waiting ${span}.`;
}

/** "Today: 4 letters in, 2 out." — the house's own day, counted by the server. */
export function todayLine(summary: MailSummary | null): string {
  if (!summary) return `Today: ${EM}`;
  return `Today: ${plural(summary.inToday, 'letter', 'letters')} in, ${summary.outToday} out.`;
}

/** The tab label: "Mail · 3", or the em dash while the count is unknown. */
export function mailTabLabel(summary: MailSummary | null): string {
  return `Mail · ${summary ? summary.waitingPeople : EM}`;
}

export type DoorState = 'not_connected' | 'switched_off' | 'reading' | 'behind' | 'cannot_tell';

export interface DoorStatus {
  state: DoorState;
  /** The status in words, as the sheet prints it. */
  words: string;
  /** Which token colours it: a failed read is alarm, behind or off is warn. */
  tone: 'ink' | 'seal' | 'warn' | 'alarm';
}

/**
 * The house mailbox reader's status. `reader` is null when the sender read
 * failed or has not answered; `readFailed` tells those apart.
 *
 * - not connected: no read grant exists;
 * - reading: the last read was within READING_WITHIN_MIN minutes;
 * - behind by N min: the last read is older than that;
 * - cannot tell: no read was ever recorded, the grants could not be read,
 *   the last read failed, or the reader itself could not be read.
 */
export function houseMailboxStatus(
  reader: MailboxReader | null,
  opts: { readFailed: boolean; now: number },
): DoorStatus {
  if (!reader) {
    return opts.readFailed
      ? { state: 'cannot_tell', words: 'Cannot tell: the mailbox reader could not be read.', tone: 'alarm' }
      : { state: 'cannot_tell', words: 'Cannot tell yet: still reading the mailbox reader.', tone: 'ink' };
  }
  if (reader.granted === false) {
    return { state: 'not_connected', words: 'Not connected.', tone: 'ink' };
  }
  if (reader.granted === 'unknown') {
    return {
      state: 'cannot_tell',
      words: `Cannot tell: ${reader.lastError ?? 'whether it is connected could not be read.'}`,
      tone: 'alarm',
    };
  }
  if (!reader.enabled) {
    return { state: 'switched_off', words: 'Connected, but reading is switched off for this house.', tone: 'warn' };
  }
  if (reader.lastError) {
    return { state: 'cannot_tell', words: `Cannot tell: the last read failed (${reader.lastError}).`, tone: 'alarm' };
  }
  const last = at(reader.lastReadAt);
  if (last === null) {
    return { state: 'cannot_tell', words: 'Cannot tell: no read has been recorded yet.', tone: 'ink' };
  }
  const gap = opts.now - last;
  if (gap <= READING_WITHIN_MIN * MIN) {
    return { state: 'reading', words: `Reading. Last read ${shortSpan(gap)} ago.`, tone: 'seal' };
  }
  return { state: 'behind', words: `Behind by ${Math.floor(gap / MIN)} min.`, tone: 'warn' };
}

/**
 * A door that keeps no durable record of its reads (Mudavym's mailbox, the
 * house's Mudavym address, WhatsApp) — proposal L3. It is never "reading":
 * that a letter was stored once says nothing about whether the door is open now.
 */
export function unrecordedDoorStatus(): DoorStatus {
  return {
    state: 'cannot_tell',
    words: 'Cannot tell: this door keeps no record of its reads yet.',
    tone: 'ink',
  };
}

/** The one line under the header that opens the intake sheet. */
export function intakeLine(status: DoorStatus, reader: MailboxReader | null, now: number): string {
  if (status.state === 'reading' && reader?.lastReadAt) {
    const last = at(reader.lastReadAt);
    return `Your mailbox was read ${shortSpan(now - (last ?? now))} ago`;
  }
  if (status.state === 'behind' && reader?.lastReadAt) {
    const last = at(reader.lastReadAt) ?? now;
    return `Your mailbox is behind by ${Math.floor((now - last) / MIN)} min`;
  }
  if (status.state === 'switched_off') return 'Your mailbox is connected, but not being read';
  return 'Mail arrival: cannot tell yet';
}

/** "Last letter stored" for a door: when, "none stored yet", or the em dash on a failed read. */
export function lastStoredWords(iso: string | null | undefined, known: boolean, now: number): string {
  if (!known) return EM;
  const t = at(iso);
  if (t === null) return 'None stored yet';
  return `${shortSpan(now - t)} ago`;
}

/** The quiet provenance line under a letter, in words, from its door. */
export function doorWords(door: MailDoor): string {
  switch (door) {
    case 'house_mailbox':
      return 'arrived in your mailbox';
    case 'mudavym_mail':
      return "arrived at Mudavym's mailbox or your Mudavym address";
    case 'whatsapp':
      return 'WhatsApp';
    case 'from_house':
      return 'sent by the house';
  }
}

const removedDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export interface LetterLook {
  /** A chip for an outbound letter that has not left, or null. */
  chip: string | null;
  /** The provenance line. */
  line: string;
  /** Dashed border: a draft nobody has decided about. */
  dashed: boolean;
  /** The letter sits inside its undo window and may be pulled back. */
  queued: boolean;
  /** The original was removed under the retention rule. */
  removed: string | null;
}

/**
 * How one letter in a thread looks. An outbound letter wears its send state
 * in words; only sendState's 'sent' says "sent by the house" (prc-02 — an AI
 * draft, an approved letter or a queued one never looks sent).
 */
export function letterLook(m: MailMessage): LetterLook {
  const removedAt = at(m.rawDeletedAt);
  const removed =
    removedAt === null ? null : `Original removed on ${removedDay.format(new Date(removedAt))}; the facts stay.`;
  const base = { dashed: false, queued: false, removed };
  if (m.direction === 'inbound') {
    return { ...base, chip: null, line: doorWords(m.door) };
  }
  const by = m.aiGenerated ? ' · written by Mudavym' : '';
  switch (sendState(m.status)) {
    case 'sent':
      return { ...base, chip: null, line: `${doorWords('from_house')}${by}` };
    case 'draft':
      // Approval is said as approval; it is not dispatch (cm-format sendState).
      return {
        ...base,
        chip: String(m.status ?? '').toUpperCase() === 'APPROVED' ? 'Approved · not sent' : 'Draft · not sent',
        line: `not sent${by}`,
        dashed: true,
      };
    case 'queued':
      return { ...base, chip: 'Queued · not sent yet', line: `not sent yet${by}`, queued: true };
    case 'sending':
      return { ...base, chip: 'Sending · not confirmed yet', line: `not confirmed sent${by}` };
    case 'unconfirmed':
      return { ...base, chip: 'Sent? Not confirmed', line: `the vendor may have it; sending was not confirmed${by}` };
    case 'failed':
      return { ...base, chip: 'Not sent', line: `it did not leave the house${by}` };
    case 'cancelled':
      return { ...base, chip: 'Pulled back · not sent', line: `not sent${by}` };
    case 'closed':
      return { ...base, chip: null, line: `from the house${by}` };
    default:
      return { ...base, chip: null, line: `from the house; whether it was sent was not recorded${by}` };
  }
}

/** When a letter happened, from the field its direction fills. */
export function letterAt(m: MailMessage): string {
  return (m.direction === 'inbound' ? m.receivedAt : m.sentAt) ?? m.createdAt;
}

/**
 * The quiet line under the chips: only vendor mail reaches Mudavym today
 * (`storedKinds`), so the list says what it does not cover (proposal F5).
 */
export function storedKindsLine(storedKinds: readonly string[] | null): string {
  if (storedKinds && storedKinds.some((k) => k !== 'vendor')) {
    return `Mail from ${storedKinds.join(', ')} reaches Mudavym.`;
  }
  return 'Only vendor mail reaches Mudavym for now; mail from your team and guests is not read yet.';
}

/**
 * The empty list, said so it never reads as a healthy one: it names which
 * doors are connected and which are not.
 */
export function emptyListWords(
  reader: MailboxReader | null,
  summary: MailSummary | null,
  opts: { waitingOnly: boolean },
): string {
  if (opts.waitingOnly) return 'No vendor is waiting on you.';
  const open: string[] = [];
  const shut: string[] = [];
  if (reader?.granted === true && reader.enabled) open.push('your mailbox');
  else if (reader?.granted === false) shut.push('your mailbox is not connected');
  else if (reader && reader.granted === true && !reader.enabled) shut.push('your mailbox is connected but not being read');
  else shut.push('whether your mailbox is connected cannot be told');
  if (summary?.address.address) open.push(`your Mudavym address (${summary.address.address})`);
  else if (summary) shut.push('the house has no Mudavym address');
  else shut.push('whether the house has a Mudavym address cannot be told');
  const lead = 'No vendor mail has been stored yet.';
  const opened = open.length ? ` Mail is read from ${open.join(' and ')}.` : ' No door of this house is known to be connected.';
  const closed = shut.length ? ` ${shut.map((s, i) => (i === 0 ? s[0].toUpperCase() + s.slice(1) : s)).join('; ')}.` : '';
  return `${lead}${opened}${closed} Replies to letters sent from Mudavym's mailbox arrive there.`;
}

/** The thread list row's "who wrote last". */
export function lastWriterWords(direction: 'inbound' | 'outbound' | null, name: string | null): string {
  if (direction === 'inbound') return `${name ?? 'The vendor'} wrote last`;
  if (direction === 'outbound') return 'The house wrote last';
  return 'Who wrote last was not recorded';
}

/** Channel glyph names, in words, for an accessible label. */
export function channelWords(channel: string): string {
  const c = channel.toLowerCase();
  if (c === 'whatsapp') return 'WhatsApp';
  if (c === 'email') return 'mail';
  return c;
}
