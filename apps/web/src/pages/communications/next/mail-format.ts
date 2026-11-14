/**
 * The Mail tab's words (founder /goal 2026-11-07; sw-walk mail proposal §2,
 * Phase C). Pure: every sentence the tab prints about people, ways in and
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
  /**
   * Letters that came or went (r28 mail gap 14): a draft or a queued letter
   * is not one. Absent from a gateway that predates it: read messageCount.
   */
  letterCount?: number;
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
  /** A bounce or an auto-reply: on the thread, never a letter anyone owes. */
  automatic?: boolean;
  /**
   * When an owner or manager said this letter needs no reply (r28 mail gap
   * 4). Absent from a gateway that predates the mark: read as not marked.
   */
  noReplyMarkedAt?: string | null;
  /**
   * The files the letter carried (r28 mail gap 13). Absent from a gateway
   * that predates them: read as none known, never as "carried none".
   */
  attachments?: MailAttachment[];
}

/** One file a letter carried, as GET /mail/thread lists it. */
export interface MailAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** When the file itself was removed under the retention rule; the name stays. */
  removedAt: string | null;
}

export interface MailThreadPage {
  key: string;
  subject: string | null;
  person: MailPersonRef | null;
  order: { id: string; number: string | null; status: string | null } | null;
  messages: MailMessage[];
  before: string | null;
  /**
   * The house owes this thread a reply, over the whole thread. Absent from a
   * gateway that predates it: then the page offers no "No reply needed".
   */
  waiting?: boolean;
  /** False when the letters' files could not be read with this page (gap 13). */
  attachmentsRead?: boolean;
}

export interface MailSummary {
  waitingPeople: number;
  oldestWaitAt: string | null;
  /** Null when the house has no zone (its own, nor its country's only one): unknown, never 0. */
  inToday: number | null;
  outToday: number | null;
  /** The zone "today" was counted in. Absent from a server older than D6/D7. */
  zone?: { zone: string | null; source: 'house' | 'country' | 'none' };
  /** Letters in over the last 30 days, Mail's own count (D6). Absent from an older server. */
  inLast30?: number;
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
/**
 * Has any vendor letter ever been stored for this house, by any door? (r36
 * mail audit, gap 5.) The summary's three doors cover every inbound letter
 * (mail_inbox_summary: the house mailbox, WhatsApp, and every other inbound
 * letter as "Mudavym mail"), each the newest one stored, of all time. All
 * three empty means nothing has arrived yet, which on day 1 is not the same
 * news as "no one is waiting".
 */
export function nothingArrivedYet(summary: MailSummary): boolean {
  const d = summary.doors;
  return !d?.houseMailbox?.lastStoredAt && !d?.whatsapp?.lastStoredAt && !d?.mudavymMail?.lastStoredAt;
}

export const NOTHING_ARRIVED_YET = 'No vendor letter has reached Mail yet.';

/**
 * Who a waiting vendor waits on, in the reader's own words (r36 mail gap 14).
 * Only an owner or a manager can answer a vendor from Mail (MailThread's
 * `canReply`), so staff and an unknown role are told a vendor is waiting on
 * the house, never on them: they could not act on "waiting on you".
 */
export type WaitingOn = 'you' | 'the house';

export function waitingOn(canReply: boolean): WaitingOn {
  return canReply === true ? 'you' : 'the house';
}

/** The chip that keeps only the waiting people: "Waiting on you" / "Waiting on the house". */
export function waitingChipWords(on: WaitingOn): string {
  return `Waiting on ${on}`;
}

export function headerSentence(
  summary: MailSummary | null,
  opts: { failed: boolean; reason?: string; now: number; on: WaitingOn },
): string {
  const on = opts.on;
  if (!summary) {
    return opts.failed
      ? `${EM} Who is waiting on ${on} could not be read (${opts.reason || 'no reason was given'}). That does not mean no one is.`
      : `${EM} Reading who is waiting on ${on}…`;
  }
  const n = summary.waitingPeople;
  // Day 1 is not "healthy": with no letter ever stored, the honest news is
  // that nothing has come in, and the status line under it says why.
  if (n === 0) return nothingArrivedYet(summary) ? NOTHING_ARRIVED_YET : `No one is waiting on ${on}.`;
  const lead = n === 1 ? `1 vendor is waiting on ${on}.` : `${n} vendors are waiting on ${on}.`;
  const since = at(summary.oldestWaitAt);
  if (since === null) return lead;
  const span = spanWords(opts.now - since);
  return n === 1 ? `${lead} They have been waiting ${span}.` : `${lead} The oldest has been waiting ${span}.`;
}

/**
 * "Today: 4 letters in, 2 out." — the house's own day, counted by the server
 * in the house's zone, else its country's only zone. With neither, the day has
 * no midnight and the server sends no count; the line says why rather than
 * printing a UTC day's count as the house's (D7).
 */
export const TODAY_ZONE_UNSET =
  "Today's letters are not counted: this house's time zone isn't set. An owner or manager can set it in Settings, under Time zone.";

export function todayLine(summary: MailSummary | null): string {
  if (!summary) return `Today: ${EM}`;
  if (summary.inToday === null || summary.outToday === null) return TODAY_ZONE_UNSET;
  return `Today: ${plural(summary.inToday, 'letter', 'letters')} in, ${summary.outToday} out.`;
}

/**
 * The tab label: "Mail · 3", or the em dash while the count is unknown. A
 * house no letter has ever reached reads plain "Mail": a zero there, seen
 * from Letters, reads as "all answered" when nothing has arrived (r36 gap 5).
 */
export function mailTabLabel(summary: MailSummary | null): string {
  if (summary && summary.waitingPeople === 0 && nothingArrivedYet(summary)) return 'Mail';
  return `Mail · ${summary ? summary.waitingPeople : EM}`;
}

export type DoorState = 'not_connected' | 'switched_off' | 'reading' | 'behind' | 'failing' | 'cannot_tell';

export interface DoorStatus {
  state: DoorState;
  /** The status in words, as the sheet prints it. */
  words: string;
  /** Which token colours it: a failed read is alarm, behind or off is warn. */
  tone: 'ink' | 'seal' | 'warn' | 'alarm';
}

/**
 * A failed read of the house mailbox, in the house's words. The raw error
 * (`invalid_grant: Token has been expired or revoked.`, `HTTP 401 from
 * gmail.googleapis.com/...`) is never printed: it means nothing to an owner
 * and leaks how the reader works (QA round 16, finding 3). Google refusing
 * the grant is the one cause the owner can act on, so it is named; anything
 * else is said as a failed read.
 */
export function readErrorWords(raw: string | null | undefined): string {
  const r = String(raw ?? '').toLowerCase();
  if (/invalid_grant|expired|revoked|unauthori[sz]ed|insufficient|\b40[13]\b/.test(r)) {
    return 'Google no longer lets Mudavym read your mailbox. Connect it again in Connections.';
  }
  return 'The last read of your mailbox failed.';
}

/**
 * The house mailbox reader's status. `reader` is null when the sender read
 * failed, has not answered, or answered without a reader; `readFailed` says
 * the first or the last (MailTab passes both as failed, so a reply with no
 * reader never reads "checking" forever — QA S5b).
 *
 * - not connected: no read grant exists;
 * - reading: the last read was within READING_WITHIN_MIN minutes;
 * - behind: the last read is older than that, said as a span ("3 h");
 * - failing: the last read failed, said in words, never the raw error;
 * - cannot tell: no read was ever recorded, or the grants or the reader
 *   could not be read.
 */
export function houseMailboxStatus(
  reader: MailboxReader | null,
  opts: { readFailed: boolean; now: number },
): DoorStatus {
  if (!reader) {
    return opts.readFailed
      ? { state: 'cannot_tell', words: 'Whether your mailbox is connected could not be read.', tone: 'alarm' }
      : { state: 'cannot_tell', words: 'Checking your mailbox…', tone: 'ink' };
  }
  if (reader.granted === false) {
    return { state: 'not_connected', words: 'Not connected.', tone: 'ink' };
  }
  if (reader.granted === 'unknown') {
    return { state: 'cannot_tell', words: 'Whether your mailbox is connected could not be read.', tone: 'alarm' };
  }
  if (!reader.enabled) {
    return { state: 'switched_off', words: 'Connected, but reading is switched off for this house.', tone: 'warn' };
  }
  if (reader.lastError) {
    return { state: 'failing', words: readErrorWords(reader.lastError), tone: 'alarm' };
  }
  const last = at(reader.lastReadAt);
  if (last === null) {
    return { state: 'cannot_tell', words: 'Cannot tell yet: no read has been recorded.', tone: 'ink' };
  }
  const gap = opts.now - last;
  if (gap <= READING_WITHIN_MIN * MIN) {
    return { state: 'reading', words: `Reading. Last read ${shortSpan(gap)} ago.`, tone: 'seal' };
  }
  return { state: 'behind', words: `Behind: last read ${shortSpan(gap)} ago.`, tone: 'warn' };
}

/**
 * A way in that keeps no durable record of its reads (Mudavym's mailbox, the
 * house's Mudavym address, WhatsApp) — proposal L3. It is never "reading":
 * that a letter was stored once says nothing about whether it is open now.
 */
export function unrecordedDoorStatus(): DoorStatus {
  return {
    state: 'cannot_tell',
    words: 'Cannot tell: when this was last checked is not recorded yet.',
    tone: 'ink',
  };
}

/**
 * The intake record (GET /communications/letters/intake). `absent` is a 404 or
 * 403 (the route is not deployed yet, or the reader is staff) and while the
 * read is pending; `failed` is any other error. The two never read alike.
 */
export interface MailIntakeRecord {
  byStatus: Record<string, number>;
  waiting: number;
  oldestWaitingAt: string | null;
  unknown: boolean;
}
export type SharedMailboxRecord =
  | { lastReadAt: string | null; lastStoredAt: string | null; errored: boolean }
  | { unknown: true };
export interface MailIntakeResponse {
  intake: MailIntakeRecord | null;
  sharedMailbox: SharedMailboxRecord | null;
}
export type IntakeRead = { kind: 'absent' } | { kind: 'failed' } | { kind: 'known'; data: MailIntakeResponse };

/** "Letters held before reaching the house: <this>". */
export function heldAtDoorWords(read: IntakeRead, now: number): string {
  if (read.kind === 'failed') return 'could not be read — that is not the same as none.';
  if (read.kind === 'absent' || !read.data.intake) return `${EM} not recorded yet.`;
  const intake = read.data.intake;
  if (intake.unknown) return 'could not be read — that is not the same as none.';
  if (intake.waiting === 0) return 'none.';
  const oldest = at(intake.oldestWaitingAt);
  const head =
    oldest === null
      ? `${intake.waiting} waiting for a home`
      : `${intake.waiting} waiting for a home, the oldest for ${shortSpan(now - oldest)}`;
  const gaveUp = intake.byStatus.gave_up ?? 0;
  return gaveUp > 0 ? `${head}; ${gaveUp} stopped after six tries and ${gaveUp === 1 ? 'waits' : 'wait'} for \u201CRead again\u201D.` : `${head}.`;
}

/** The shared Mudavym mailbox's row: its own record when there is one. */
export function sharedMailboxDoor(read: IntakeRead, now: number): { status: DoorStatus; lastRead: string } {
  const none = { status: unrecordedDoorStatus(), lastRead: `${EM} not recorded yet` };
  if (read.kind === 'absent') return none;
  const cannot = {
    status: { state: 'cannot_tell' as const, words: "Cannot tell: the mailbox's record could not be read.", tone: 'alarm' as const },
    lastRead: EM,
  };
  if (read.kind === 'failed') return cannot;
  const shared = read.data.sharedMailbox;
  if (!shared) return none;
  if ('unknown' in shared) return cannot;
  if (shared.errored) {
    return {
      status: {
        state: 'failing',
        words: "Mudavym's mailbox: its last read failed. Letters wait at the door and are read again.",
        tone: 'alarm',
      },
      lastRead: lastReadAgo(shared.lastReadAt, now),
    };
  }
  return {
    status: { state: 'reading', words: "Mudavym's mailbox is read every few minutes.", tone: 'ink' },
    lastRead: lastReadAgo(shared.lastReadAt, now),
  };
}

function lastReadAgo(iso: string | null, now: number): string {
  const t = at(iso);
  return t === null ? EM : `${shortSpan(now - t)} ago`;
}

export type MailStatusState =
  | 'checking'
  | 'connected'
  | 'reading'
  | 'unproven'
  | 'switched_off'
  | 'needs_attention'
  | 'not_connected'
  | 'unknown';

export interface MailStatus {
  state: MailStatusState;
  words: string;
  tone: DoorStatus['tone'];
}

/**
 * Whether the house's test letter reached its Mudavym address, from GET
 * /communications/mail-setup. `checking` while that read is out; `failed`
 * when it failed or could not say.
 */
export type TestArrival =
  | { state: 'known'; arrivedAt: string | null }
  | { state: 'checking' }
  | { state: 'failed' };

const NO_TEST: TestArrival = { state: 'known', arrivedAt: null };

function newest(...ts: Array<number | null>): number | null {
  const known = ts.filter((t): t is number => t !== null);
  return known.length ? Math.max(...known) : null;
}

/**
 * The one status line of the Mail tab and the setup page (founder /goal
 * 2026-11-07: "check if the email comes"): "Connected · last letter 4 min
 * ago", or "Not connected".
 *
 * CONNECTED ONLY ON EVIDENCE (QA round 26, #977). "Connected" is said only
 * when a letter is known to have come in through a way in that is open now:
 * a letter stored from the house mailbox while it is being read, a letter
 * stored at the house's Mudavym address, or the house's test letter arriving
 * there. An address row on its own is not mail arriving: it is "Address made,
 * no letter yet". A mailbox whose read failed, could not be checked or is
 * switched off proves nothing about today, so its old letters are said with
 * their time and never as "Connected".
 *
 * "Not connected" is said only when both are known to be absent; it is never
 * softened to "cannot tell" (QA round 16, finding 4). What could not be read
 * is said as not read, never as not connected (ADR 0020).
 */
export function mailStatusLine(
  reader: MailboxReader | null,
  summary: MailSummary | null,
  opts: { readerFailed: boolean; summaryFailed: boolean; now: number; test?: TestArrival },
): MailStatus {
  const mailbox = houseMailboxStatus(reader, { readFailed: opts.readerFailed, now: opts.now });
  const test = opts.test ?? NO_TEST;
  const address = summary?.address.address ?? null;
  const ago = (t: number) => shortSpan(opts.now - t);

  if (mailbox.state === 'failing') {
    return { state: 'needs_attention', words: `Needs attention · ${mailbox.words}`, tone: 'alarm' };
  }

  const mailboxOpen = mailbox.state === 'reading' || mailbox.state === 'behind';
  const lastInMailbox = at(summary?.doors.houseMailbox.lastStoredAt);
  const lastAtAddress = address ? at(summary?.doors.mudavymMail.lastStoredAt) : null;
  // The test letter proves the address on its own: it reached it.
  const testArrived = test.state === 'known' ? at(test.arrivedAt) : null;
  const proof = newest(mailboxOpen ? lastInMailbox : null, lastAtAddress, testArrived);

  // What the mailbox adds when it is not the proof, in a clause.
  const lastRead = at(reader?.lastReadAt);
  const mailboxNote =
    mailbox.state === 'behind' && lastRead !== null
      ? `your mailbox was last read ${ago(lastRead)} ago`
      : mailbox.state === 'switched_off'
        ? 'reading your mailbox is switched off'
        : mailbox.state === 'cannot_tell' && reader?.granted === true && !opts.readerFailed
          ? 'no read of your mailbox is recorded yet'
          : mailbox.state === 'cannot_tell' && (opts.readerFailed || reader !== null)
            ? 'whether your mailbox is read could not be checked'
            : null;

  if (proof !== null) {
    const lead =
      testArrived === proof && proof !== newest(mailboxOpen ? lastInMailbox : null, lastAtAddress)
        ? `Connected · the test letter arrived ${ago(proof)} ago`
        : `Connected · last letter ${ago(proof)} ago`;
    return mailboxNote
      ? { state: 'connected', words: `${lead} · ${mailboxNote}`, tone: 'warn' }
      : { state: 'connected', words: lead, tone: 'ink' };
  }

  const readerOut = !reader && !opts.readerFailed;
  const summaryOut = !summary && !opts.summaryFailed;
  if (readerOut || summaryOut || (address && test.state === 'checking')) {
    return { state: 'checking', words: 'Checking the mail connection…', tone: 'ink' };
  }

  if (mailboxOpen) {
    const tail = summary ? 'no letter yet' : 'when the last letter came could not be read';
    return mailbox.state === 'behind' && mailboxNote
      ? { state: 'reading', words: `Reading your mailbox · ${tail} · ${mailboxNote}`, tone: 'warn' }
      : { state: 'reading', words: `Reading your mailbox · ${tail}`, tone: 'ink' };
  }

  if (address) {
    const parts = [test.state === 'failed' ? 'Address made, no letter stored yet' : 'Address made, no letter yet'];
    if (lastInMailbox !== null) parts.push(`the last letter came to your mailbox ${ago(lastInMailbox)} ago`);
    if (mailboxNote) parts.push(mailboxNote);
    return { state: 'unproven', words: parts.join(' · '), tone: 'warn' };
  }

  if (mailbox.state === 'switched_off') {
    return { state: 'switched_off', words: 'Not reading · your mailbox is connected, but reading is switched off', tone: 'warn' };
  }

  const mailboxKnownOff = mailbox.state === 'not_connected';
  if (mailboxKnownOff && summary !== null) {
    return { state: 'not_connected', words: 'Not connected', tone: 'warn' };
  }
  if (mailboxKnownOff) {
    return {
      state: 'unknown',
      words: "Your mailbox is not connected · whether the house's Mudavym address works could not be read",
      tone: 'alarm',
    };
  }
  if (reader?.granted === true && !opts.readerFailed && summary !== null) {
    return { state: 'unknown', words: 'Your mailbox is connected, but no read of it is recorded yet', tone: 'warn' };
  }
  return { state: 'unknown', words: 'Whether mail is connected could not be read', tone: 'alarm' };
}

/** The sender, as GET /communications/letters/sender answers it (the fields the line reads). */
export interface SenderLineInput {
  kind: 'house_mailbox' | 'mudavym_subdomain' | 'none' | 'unknown';
  address: string | null;
}

/**
 * Which address letters leave from. Only an address the server named is ever
 * printed: a failed or unknown read says it could not be read, and no
 * fallback address is invented (QA round 16, M13).
 */
export function senderLine(sender: SenderLineInput | null, opts: { failed: boolean }): string {
  if (opts.failed) return 'Which address letters leave from could not be read.';
  if (!sender) return 'Checking which address letters leave from…';
  if (sender.kind === 'unknown') return 'Which address letters leave from could not be read.';
  if (sender.address) return `Letters leave from ${sender.address}.`;
  if (sender.kind === 'none') return 'No address is set up yet for letters to leave from.';
  return 'Which address letters leave from could not be read.';
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
  // r28 gap 6: a letter from an unknown sender is kept (as a prospect, under
  // Who is writing) only when it carries an attachment or reads as an offer;
  // a plain one is read and not kept (rabbitmq-bridge.service.ts, the
  // no-provider branch logs and returns). The line said every stranger's
  // letter was there.
  return 'Vendor mail is listed here by person and thread. A letter from someone Mudavym does not know is under Who is writing, below, only when it carries an attachment or reads as an offer; a plain one is not kept. A letter held because its sender could not be confirmed is there too. Mail from your team and guests is not read yet.';
}

/**
 * The words on the Mail tab's way into Mail setup (r28 gap 15). An owner or a
 * manager sets mail up there; staff can only read it, so they are not told
 * to set up what they cannot change.
 */
export function setupLinkWords(canChange: boolean): string {
  return canChange ? 'Set up how mail reaches the house' : 'See how mail reaches the house';
}

/**
 * The empty list, said so it never reads as a healthy one: it names which
 * ways in are connected and which are not.
 */
export function emptyListWords(
  reader: MailboxReader | null,
  summary: MailSummary | null,
  opts: { waitingOnly: boolean; on: WaitingOn },
): string {
  if (opts.waitingOnly) return `No vendor is waiting on ${opts.on}.`;
  const open: string[] = [];
  const shut: string[] = [];
  if (reader?.granted === true && reader.enabled) open.push('your mailbox');
  else if (reader?.granted === false) shut.push('your mailbox is not connected');
  else if (reader && reader.granted === true && !reader.enabled) shut.push('your mailbox is connected but not being read');
  else shut.push('whether your mailbox is connected could not be read');
  if (summary?.address.address) open.push(`your Mudavym address (${summary.address.address})`);
  else if (summary) shut.push('the house has no Mudavym address');
  else shut.push('whether the house has a Mudavym address could not be read');
  const lead = 'No vendor mail has been stored yet.';
  const opened = open.length ? ` Mail is read from ${open.join(' and ')}.` : ' Nothing is known to be connected for this house yet.';
  const closed = shut.length ? ` ${shut.map((s, i) => (i === 0 ? s[0].toUpperCase() + s.slice(1) : s)).join('; ')}.` : '';
  return `${lead}${opened}${closed} Replies to letters sent from Mudavym's mailbox arrive there.`;
}

/**
 * The thread list row's "who wrote last". `messageCount` counts every
 * non-automatic row while `direction` comes from visible rows only, so a count
 * of 0 means the thread holds only automatic mail (a bounce, an auto-reply),
 * and a count above 0 with no direction means only letters the house has not
 * sent (drafts, refused sends).
 */
export function lastWriterWords(
  direction: 'inbound' | 'outbound' | null,
  name: string | null,
  messageCount: number,
): string {
  if (messageCount === 0) return 'Only automatic mail — a bounce or an auto-reply, nothing to answer';
  if (direction === 'inbound') return `${name ?? 'The vendor'} wrote last`;
  if (direction === 'outbound') return 'The house wrote last';
  return 'Nothing on it has been sent or received yet';
}

/**
 * "3 letters" on a thread row: the letters sent or received, never a draft
 * or a queued one (r28 mail gap 14). Null when there are none to count.
 */
export function threadCountWords(t: Pick<MailThreadRow, 'messageCount' | 'letterCount'>): string | null {
  const n = typeof t.letterCount === 'number' ? t.letterCount : t.messageCount;
  if (!(n > 0)) return null;
  return n === 1 ? '1 letter' : `${n} letters`;
}

/** The most the Mail search sends (the gateway refuses more). */
export const MAIL_SEARCH_MAX = 100;

/** What the search box sends: trimmed, at most 100 characters; '' for no search. */
export function mailSearchTerm(typed: string): string {
  return typed.trim().slice(0, MAIL_SEARCH_MAX).trim();
}

/** A search that found no one, in words, never "no mail is stored". */
export function searchEmptyWords(term: string, opts: { waitingOnly: boolean; on: WaitingOn }): string {
  return opts.waitingOnly
    ? `No one waiting on ${opts.on} matches “${term}”. The search reads names, subjects, order numbers and the words of each letter.`
    : `No one in this house's mail matches “${term}”. The search reads names, subjects, order numbers and the words of each letter.`;
}

/** A file's size in words: "880 bytes", "120 KB", "1.2 MB"; null when not recorded. */
export function fileSizeWords(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** What kind of file, in words, from its type; null when it says nothing useful. */
export function fileKindWords(mimeType: string | null | undefined): string | null {
  const t = (mimeType ?? '').toLowerCase();
  if (t === 'application/pdf') return 'PDF';
  if (t.startsWith('image/')) return 'photo';
  if (t.includes('spreadsheet') || t.includes('excel') || t === 'text/csv') return 'spreadsheet';
  if (t.includes('word')) return 'document';
  return null;
}

/** Why a file did not open, from GET /mail/attachments/:id/link's answer. */
export function fileOpenFailWords(err: unknown): string {
  const res = (err as { response?: { status?: unknown; data?: { message?: unknown } } } | null)?.response;
  if (typeof res?.status !== 'number') return 'No answer. Check the connection and try again.';
  const said = typeof res.data?.message === 'string' ? res.data.message.trim() : '';
  if ((res.status === 404 || res.status === 410) && said) return said;
  return 'The file could not be opened just now. Try again in a moment.';
}

/** Channel glyph names, in words, for an accessible label. */
export function channelWords(channel: string): string {
  const c = channel.toLowerCase();
  if (c === 'whatsapp') return 'WhatsApp';
  if (c === 'email') return 'mail';
  return c;
}

/** What the mail setup page was doing when it failed. */
export type SetupAct = 'read' | 'choose' | 'address' | 'test';

const NOT_READY = 'Mudavym cannot receive mail for houses yet, so there is no address';
const STILL_WORKS = 'Your own connected mailbox still works.';

/**
 * A failure on the mail setup page, in the page's own words (QA round 26,
 * #980 defect 3). The server's `message` is never printed: whatever it held —
 * a validation string, a crash's "Internal server error", a provider's
 * "invalid_grant: …" — reached the owner as it came. The page reads only the
 * status, and says every case it can meet in a sentence written here.
 */
export function setupFailWords(err: unknown, act: SetupAct): string {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  const answered = typeof status === 'number';
  if (act === 'read') {
    return answered
      ? 'The mail setup could not be read. That does not mean nothing is set up.'
      : 'The mail setup could not be read: no answer. Check the connection. That does not mean nothing is set up.';
  }
  if (!answered) return 'No answer. Check the connection, then try again.';
  if (act === 'choose') {
    if (status === 400) return 'That mailbox cannot send for this house any more. Nothing was changed.';
    if (status === 403)
      return 'You cannot choose that mailbox. Only an owner or a manager can change this, and only to a mailbox they connected themselves. Nothing was changed.';
    return 'The choice could not be saved; try again.';
  }
  if (act === 'address') {
    if (status === 409) return `${NOT_READY} to make. ${STILL_WORKS}`;
    if (status === 403) return 'Only an owner or a manager of this house can make its address.';
    return "The house's Mudavym address could not be made; try again.";
  }
  if (status === 409) return `${NOT_READY} to send a test letter to. ${STILL_WORKS}`;
  if (status === 403) return 'Only an owner or a manager of this house can send a test letter.';
  return 'The test letter could not be started; try again.';
}

/**
 * What "Write a reply" in a thread answers (r28 mail audit, gap 3): the
 * thread's newest mail letter that arrived, or that left the house (a draft
 * or a queued letter has nothing to answer), and the subject the reply opens
 * with. Null when the thread has no such letter or no vendor.
 */
export interface MailAnswer {
  providerId: string;
  answers: string;
  subject: string;
}

export function answerFor(
  head: Pick<MailThreadPage, 'subject' | 'person'> | null,
  letters: readonly MailMessage[],
): MailAnswer | null {
  const providerId = head?.person?.providerId;
  if (!providerId) return null;
  // Mail only: a WhatsApp letter has no mail thread to answer. A row with
  // no channel is from before the column, and those are mail.
  const answerable = letters.filter(
    (m) =>
      (!m.channel || m.channel.toLowerCase() === 'email') &&
      (m.direction === 'inbound' || m.sentAt !== null),
  );
  const last = answerable.reduce<MailMessage | null>(
    (best, m) => (best === null || letterAt(m) >= letterAt(best) ? m : best),
    null,
  );
  if (!last) return null;
  const subject = (head?.subject ?? '').trim();
  return {
    providerId,
    answers: last.id,
    subject: subject === '' ? '' : /^re\s*:/i.test(subject) ? subject : `Re: ${subject}`,
  };
}

/**
 * The letter "No reply needed" marks (r28 mail audit, gap 4): the thread's
 * newest letter that arrived and is not automatic mail, when the gateway says
 * the thread waits. The mark settles that letter and every earlier one of the
 * thread; naming the letter the page shows (never "now") means a letter that
 * arrives meanwhile still waits. Null when nothing is owed.
 */
export function noReplyTarget(
  head: Pick<MailThreadPage, 'waiting'> | null,
  letters: readonly MailMessage[],
): string | null {
  if (head?.waiting !== true) return null;
  const last = letters
    .filter((m) => m.direction === 'inbound' && m.automatic !== true)
    .reduce<MailMessage | null>((best, m) => (best === null || letterAt(m) >= letterAt(best) ? m : best), null);
  return last?.id ?? null;
}

/**
 * Why a "needs no reply" mark, or taking it back, did not hold. The page reads
 * only the status and says every case in words written here; a failure never
 * reads as done.
 */
export function noReplyFailWords(err: unknown, marking: boolean): string {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  if (typeof status !== 'number') return 'No answer. Check the connection; nothing was changed.';
  if (status === 403) return "Only the house's owner or a manager can say a letter needs no reply.";
  if (status === 404) return "That letter is no longer in this house's mail. Nothing was changed.";
  if (status === 409) return 'Only a letter the house received can be marked as needing no reply.';
  return marking
    ? 'It could not be marked just now, so nothing changed. Try again.'
    : 'The mark could not be taken back just now; it still holds. Try again.';
}
