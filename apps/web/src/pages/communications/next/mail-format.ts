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

import { EM, fmtWhen, sendState } from './cm-format';
import { formatVenueTime } from '../../../lib/venueTime';

/** The shapes GET /mail/* answers with (apps/api-gateway/src/conversations/mail.types.ts). */
export type MailDoor = 'house_mailbox' | 'whatsapp' | 'mudavym_mail' | 'from_house';

/**
 * Who a conversation is with. Only `vendor` was stored before the house said
 * yes to reading every conversation; a gateway that predates `kind` sends
 * none, and an absent or unknown one is read as `vendor` ({@link mailKindOf}).
 */
export type MailKind = 'vendor' | 'team' | 'guest';

export function mailKindOf(x: { kind?: string | null } | null | undefined): MailKind {
  return x?.kind === 'team' || x?.kind === 'guest' ? x.kind : 'vendor';
}

/** The Mail tab's kind filter: every kind, or one. */
export type MailKindFilter = 'all' | MailKind;

export const MAIL_KIND_FILTERS: ReadonlyArray<{ id: MailKindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'vendor', label: 'Vendors' },
  { id: 'team', label: 'Team' },
  { id: 'guest', label: 'Guests' },
];

/** Said under a letter the gateway names automatic: an auto-reply or a bounce, never a person's answer. */
export const AUTOMATIC_LETTER_WORDS = 'Automatic mail (an auto-reply or a bounce), not written by a person.';

/**
 * The chosen kind found no one among the people read so far, and more people are still to be read. That is not
 * "none": say what was looked at, never an empty claim (ADR 0020).
 */
export function kindPartialWords(kind: MailKindFilter): string {
  const who = kind === 'team' ? 'a team member' : kind === 'guest' ? 'a guest' : 'a vendor';
  return `Showing the people loaded so far, and none of them is ${who}. Show older people to look further.`;
}

/**
 * What the list says when the chosen kind has nobody in it. The reason is the reader's own: staff are never shown
 * team or guest mail (the gateway gives it to owners and managers only), and the Waiting filter is about vendors.
 */
export function kindEmptyWords(
  kind: MailKindFilter,
  readsAll: boolean,
  reader: { canReply: boolean; waitingOnly: boolean } = { canReply: true, waitingOnly: false },
): string {
  const who = kind === 'team' ? 'team members' : kind === 'guest' ? 'guests' : 'vendors';
  if (kind === 'all') return 'No one has written to this house yet.';
  if (reader.waitingOnly && kind !== 'vendor') {
    return `No ${kind === 'team' ? 'team member' : 'guest'} is waiting on the house: only vendors wait.`;
  }
  if (!reader.canReply && kind !== 'vendor') return 'Mail with team members and guests is shown to the owner and managers.';
  if (!readsAll && kind !== 'vendor') {
    return `Mail with ${who} is not read yet: the house reads vendor mail only, until an owner or manager says otherwise below.`;
  }
  return `No conversation with ${who} yet.`;
}

/** The integration id of the grant that reads every conversation (gateway: integrations-oauth.constants.ts). */
export const READ_ALL_ID = 'gmail_read_all' as const;

/**
 * Where the person agrees to it. The wider reading is a Gmail connection of
 * its own, so the consent screen (the gateway's words, shown in full, with the
 * retention figure) is the one place it is agreed; nothing is read until then.
 */
export function readAllConsentPath(): string {
  return `/authorize/${READ_ALL_ID}?returnPath=${encodeURIComponent('/communications?tab=mail')}`;
}

/** What the tab says before sending a person to the consent screen. */
export const READ_ALL_OFFER_WORDS =
  'Reading every conversation is its own Gmail connection with its own consent screen. That screen says, in full, ' +
  'what is read, who can see it and how long it is kept, and nothing is read until you agree there.';

export const READ_ALL_OFFER = 'Read every conversation, not only vendors';

/** What the tab says about its own reach, so a quiet Team or Guests list is never mistaken for an empty one. */
/**
 * The status block above the Mail list keeps its height from the first frame
 * (r81 walk w1 finding 3): at 375 it grew 97 -> 152 px as the summary and the
 * reader arrived, and the list below it moved. The loaded heights were measured
 * in a browser (r83 walk w1, production build, vendor-only and wide-grant
 * houses, owner, manager and staff): 155 px at 375 and 111 px at 1440 (header
 * sentence, today line, status line and the setup pill); each is reserved one
 * pixel over so rounding never leaves a shift. The first estimates, 152 and 100,
 * were 3 and 11 px short and moved the list at 1440 by 0.046-0.054.
 */
export const MAIL_HEADER_RESERVE = 'min-h-[176px] md:min-h-[112px]';
/**
 * The same reserve with the height the last visit settled at (`--mail-held`) as a
 * floor ON TOP of it: the block is never shorter than the reserve at this width,
 * so a short one-line visit cannot shrink the next load below what a wrapped
 * status sentence needs.
 */
export const MAIL_HEADER_RESERVE_HELD =
  'min-h-[max(176px,var(--mail-held,0px))] md:min-h-[max(112px,var(--mail-held,0px))]';
/**
 * r108 mail-r108-6: below md a house with no time zone says a three-line "time
 * zone isn't set" sentence that outgrew the 156 px reserve (CLS 0.061-0.097 in
 * the r107 walk), so the phone reserve is 176 px. The headline holds two lines
 * (a repeat load had it wrap from one line to two inside the block); at md and
 * up it is one line.
 */
export const MAIL_HEADLINE_HOLD = 'min-h-[45px] md:min-h-0';
/**
 * The read-scope placeholder, sized for the state it becomes: one block (the
 * line), or two (the line and the switch note) when the house's inbox switch
 * is already known to be off. Measured (r83 walk w1): the one-line block is
 * 38.4 px at 375 and 19.7 at 1440; the two-block state is 126 and 45. A first
 * visit cannot know the switch is off when it first paints, so a wide-grant
 * house with its switch off still grows from the one-block hold on that visit.
 */
export const READ_SCOPE_HOLD = {
  one: 'min-h-[39px] md:min-h-[20px]',
  two: 'min-h-[127px] md:min-h-[46px]',
} as const;
export const VENDOR_ONLY_LINE = 'This tab shows vendor mail only.';
/**
 * What the tab says it reads (r105 mail-7). The consent decides what Mudavym
 * reads; the rows decide what is listed. Letters already kept from team and
 * guests (a reply the house sent them, kept when the wider reading was
 * stopped) are listed without the wider reading, so the line must not claim
 * "vendor mail only" above them. It never widens the reader: it says the
 * reading is vendors' and names what else is listed.
 */
export function readScopeLine(reads: boolean, storedKinds: readonly string[] | null): string {
  if (reads) return READS_ALL_LINE;
  const team = storedKinds?.includes('team') ?? false;
  const guest = storedKinds?.includes('guest') ?? false;
  if (!team && !guest) return VENDOR_ONLY_LINE;
  const who = team && guest ? 'your team and guests' : team ? 'your team' : 'guests';
  return `Mudavym reads only vendors\u2019 mail. Letters already kept with ${who} are listed here too.`;
}
export const READS_ALL_LINE = 'This tab shows the letters that arrived in the mailbox: vendors, team and guests.';
/**
 * Agreeing to the wide reading does not switch the house's own inbox on: the
 * two are separate. Said when the first is agreed and the second is off, so
 * "reading is switched off" and "shows every conversation" are not left to
 * contradict each other (r77 w3 finding 4).
 */
export const READS_ALL_SWITCH_OFF_WORDS =
  'Nothing is read yet: the house\u2019s \u201cRead this house\u2019s mailbox\u201d switch in Settings must also be on.';

/**
 * Where one letter came from and went to, in one line. Null when the gateway
 * sent neither (an older one): the letter then shows nothing rather than a
 * guess.
 */
export function addressLine(m: Pick<MailMessage, 'fromAddress' | 'toAddresses'>): string | null {
  const from = (m.fromAddress ?? '').trim();
  const to = (m.toAddresses ?? []).map((a) => a.trim()).filter(Boolean);
  if (!from && to.length === 0) return null;
  if (from && to.length > 0) return `From ${from} to ${to.join(', ')}`;
  return from ? `From ${from}` : `To ${to.join(', ')}`;
}

export interface MailPersonRow {
  key: string;
  kind: MailKind;
  /** Null for a team or guest person: no vendor stands behind them. */
  providerId: string | null;
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
  /**
   * The stored status of the house's newest letter to this person that has
   * not left, when it is newer than the last one that did (or is the only
   * letter). The gateway keeps such a person listed so the letter can be seen
   * and pulled back (QA round 16, HARM 1); the row says its state in words.
   */
  unsentStatus: string | null;
  /**
   * The newest letter came from the vendor after the newest one this person
   * was shown, or they never opened it (r36 mail gap 6). Per person. Null
   * when the gateway could not read the marks; absent from a gateway that
   * predates it. Only `true` is ever drawn.
   */
  newToYou?: boolean | null;
  /**
   * Status of the newest letter to this person when it has not left (queued,
   * refused, pulled back, failed). Null when there is none; absent from a
   * gateway that predates it.
   */
  unsentStatus?: string | null;
  /**
   * When the house's newest letter to this person left, when nobody has
   * answered it (r108 mail-gap g7). Null when there is an answer, or for a
   * caller whose house letters are withheld; absent from an older gateway.
   */
  awaitingSince?: string | null;
}

export interface MailPeoplePage {
  people: MailPersonRow[];
  next: string | null;
  storedKinds: string[];
}

export interface MailPersonRef {
  key: string;
  kind: MailKind;
  providerId: string | null;
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
  /**
   * The newest letter came from the vendor after the newest one this person
   * was shown, or they never opened it (r36 mail gap 6). Per person. Null
   * when the gateway could not read the marks; absent from a gateway that
   * predates it. Only `true` is ever drawn.
   */
  newToYou?: boolean | null;
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
  /** A bounce or an automatic reply: shown, never counted as a letter (M-5). */
  automatic: boolean;
  /** A bounce or an auto-reply: on the thread, never a letter anyone owes. */
  automatic?: boolean;
  /**
   * When an owner or manager said this letter needs no reply (r28 mail gap
   * 4). Absent from a gateway that predates the mark: read as not marked.
   */
  noReplyMarkedAt?: string | null;
  /** Who the conversation is with. Absent from a gateway that predates it: read as a vendor. */
  kind?: MailKind;
  /** The address the letter came from. Absent from a gateway that predates it. */
  fromAddress?: string | null;
  /** The addresses the letter went to. Absent from a gateway that predates it. */
  toAddresses?: string[] | null;
  /**
   * The files the letter carried (r28 mail gap 13). Absent from a gateway
   * that predates them: read as none known, never as "carried none".
   */
  attachments?: MailAttachment[];
  /**
   * Set when a person filed this letter from Who is writing after it was held
   * (r37 walk w3 M-F2). Absent from a gateway that predates it.
   */
  filedFromHeld?: MailFiledFromHeld | null;
}

/** Who vouched for a held letter, as GET /mail/thread says it. */
export interface MailFiledFromHeld {
  heldReason: string | null;
  byName: string | null;
  byRecorded: boolean;
  at: string | null;
}

/**
 * The line under a letter a person vouched for (r37 walk w3 M-F2): why it
 * was held, under whom it was filed, by whom and when. With "Bank details
 * changed" as the stock example of a forged letter, a letter that only a
 * person's word put on a vendor's thread must not read like any other.
 */
export function filedFromHeldWords(f: MailFiledFromHeld, vendor: string): string {
  const why =
    f.heldReason === 'sender_unconfirmed'
      ? 'Held because the receiving mail server could not confirm the sender'
      : 'Held before it was filed';
  const who = f.byName ?? (f.byRecorded ? 'someone whose name is not on record' : 'nobody recorded');
  const when = f.at ? `, ${fmtWhen(f.at)}` : '';
  return `${why}; filed under ${vendor} by ${who}${when}.`;
  /**
   * Details (r108 mail-gap g8): the house mailbox a mirrored letter arrived in
   * (its address for an owner or manager, "a connected mailbox" for staff),
   * and the sender check it was stored with. Absent from an older gateway.
   */
  mailbox?: string | null;
  senderCheck?: 'passed' | 'failed' | null;
  signedBy?: string | null;
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
  /** False when whether a person filed these letters from Who is writing could not be read (M-F2). */
  heldMarksRead?: boolean;
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
  /**
   * How many vendor addresses the reader may ask Gmail about (r36 mail gap
   * 5). 0: connected, with nothing to read for until a vendor has an email
   * address. null or absent (an older gateway): not known, and no claim.
   */
  bookAddresses?: number | null;
}

/** What a connected mailbox with an empty vendor book needs, in the house's words (r36 mail gap 5). */
export const NOTHING_TO_READ_FOR =
  'Connected, but no vendor has an email address yet, so there is nothing to read for.';

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

/** No answer yet (r108 mail-gap g7): after 72 h, Gmail's three-day nudge. Elapsed time, never house days. */
export const NO_ANSWER_AFTER_MS = 72 * HOUR;
export const NO_ANSWER_CHIP = 'No answer yet';
export const NO_ANSWER_EMPTY = 'Every letter the house sent has had an answer, or is less than 3 days old.';

/**
 * "No answer · 4 days" for a person the house wrote to last, whose letter
 * left, who is not waiting on the house, with no letter still to leave, when
 * the letter is 72 h old or more. Null otherwise: the row says nothing.
 */
export function noAnswerWords(
  row: Pick<MailPersonRow, 'lastDirection' | 'waiting' | 'unsentStatus' | 'awaitingSince'>,
  now: number,
): string | null {
  if (row.lastDirection !== 'outbound' || row.waiting || row.unsentStatus) return null;
  const since = at(row.awaitingSince);
  if (since === null || now - since < NO_ANSWER_AFTER_MS) return null;
  return `No answer · ${spanWords(now - since)}`;
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

export type DoorState =
  | 'not_connected'
  | 'switched_off'
  | 'nothing_to_read'
  | 'reading'
  | 'behind'
  | 'failing'
  | 'cannot_tell';

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
  // A failing read speaks first; then an empty book, which no read can fix
  // (r36 mail gap 5). Only an exact 0 counts: an older gateway sends none.
  if (reader.bookAddresses === 0) {
    return { state: 'nothing_to_read', words: NOTHING_TO_READ_FOR, tone: 'warn' };
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
  | 'nothing_to_read'
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
        : mailbox.state === 'nothing_to_read'
          ? 'your mailbox has nothing to read for until a vendor has an email address'
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
  if (mailbox.state === 'nothing_to_read') {
    return {
      state: 'nothing_to_read',
      words: 'Not reading yet · your mailbox is connected, but no vendor has an email address to read for',
      tone: 'warn',
    };
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

/**
 * A received letter's Details, in order (r108 mail-gap g8): when it came, in
 * the house's clock; how it came; and, for email, whether its sender was
 * checked. A check that was never kept is said as not recorded, never as
 * "not signed". The From/To line is already on the letter, so it is not
 * said twice.
 */
export function letterDetails(
  m: Pick<MailMessage, 'door' | 'receivedAt' | 'createdAt' | 'toAddresses' | 'mailbox' | 'senderCheck' | 'signedBy'>,
  house: { address?: string | null; zone?: string | null },
): string[] {
  const when = formatVenueTime(m.receivedAt ?? m.createdAt, house.zone ?? null, { withDate: true });
  const lines = [
    when.inVenueZone
      ? `Received ${when.text}`
      : `Received ${when.text}, on this device's clock: the house's time zone is not set`,
  ];
  const address = house.address?.trim().toLowerCase() || null;
  switch (m.door) {
    case 'house_mailbox':
      lines.push(
        m.mailbox && m.mailbox.includes('@')
          ? `Arrived in ${m.mailbox} (a connected Gmail mailbox)`
          : 'Arrived in a connected mailbox',
      );
      break;
    case 'mudavym_mail':
      lines.push(
        address && (m.toAddresses ?? []).some((a) => a.toLowerCase() === address)
          ? `Arrived at ${address}`
          : "Arrived at Mudavym's mailbox or your Mudavym address",
      );
      break;
    case 'whatsapp':
      lines.push('WhatsApp');
      return lines;
    case 'from_house':
      return lines;
  }
  if (m.senderCheck === 'passed') {
    lines.push(m.signedBy ? `Signed by ${m.signedBy}, checked` : 'Its sender was checked');
  } else if (m.senderCheck === 'failed') {
    lines.push('Its sender could not be confirmed');
  } else {
    lines.push('Its sender check was not recorded: this letter was stored before Mail kept it');
  }
  return lines;
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
    // A bounce or an auto-reply is shown so nothing is hidden, and labelled so
    // nobody reads it as the vendor answering (M-5: it is not counted either).
    return m.automatic
      ? {
          ...base,
          chip: 'Automatic',
          line: `${doorWords(m.door)} · an automatic reply or a bounce, not a letter from the vendor`,
        }
      : { ...base, chip: null, line: doorWords(m.door) };
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

/**
 * A person row's line for a letter from the house that has not left (HARM 1).
 * Said in the same words as the letter's own chip; never "sent".
 */
export function unsentWords(status: string | null): string | null {
  if (status === null) return null;
  const s = status.toUpperCase();
  if (s === 'SCHEDULED' || s === 'AUTO_SEND_SCHEDULED') return 'A letter from the house is set to go later · not sent yet';
  switch (sendState(s)) {
    case 'queued':
      return 'A letter from the house is queued · not sent yet';
    case 'sending':
      return 'A letter from the house is being sent · not confirmed yet';
    case 'failed':
      return 'A letter from the house did not leave · not sent';
    case 'cancelled':
      return 'A letter from the house was pulled back · not sent';
    default:
      return 'A letter from the house has not been sent';
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
/** What a team or guest thread holds: only what came in. The reader never reads the house's own sent mail (r102 func-1). */
export const ARRIVED_ONLY =
  'Only letters that arrived are read for team and guests; replies sent from your own mailbox are not, so these threads show what came in, not the whole conversation.';

/** Rows of team or guest mail are stored, whatever the house's grant now says (the scope line and the search hint both follow this). */
export function storesNonVendor(storedKinds: readonly string[] | null): boolean {
  return Boolean(storedKinds && storedKinds.some((k) => k !== 'vendor'));
}

export function storedKindsLine(storedKinds: readonly string[] | null): string {
  if (storesNonVendor(storedKinds)) {
    return `Mail that arrived from ${storedKinds!.join(', ')} is listed by person and thread. ${ARRIVED_ONLY}`;
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
  opts: {
    waitingOnly: boolean;
    on: WaitingOn;
    /** A read still in flight is "still being read", never "could not be read" (r41 mail gap 6). */
    reading?: { reader: boolean; summary: boolean };
  },
): string {
  if (opts.waitingOnly) return `No vendor is waiting on ${opts.on}.`;
  const open: string[] = [];
  const shut: string[] = [];
  if (reader?.granted === true && reader.enabled && reader.bookAddresses === 0)
    shut.push('your mailbox is connected, but no vendor has an email address for it to read for');
  else if (reader?.granted === true && reader.enabled) open.push('your mailbox');
  else if (reader?.granted === false) shut.push('your mailbox is not connected');
  else if (reader && reader.granted === true && !reader.enabled) shut.push('your mailbox is connected but not being read');
  else if (opts.reading?.reader) shut.push('whether your mailbox is connected is still being read');
  else shut.push('whether your mailbox is connected could not be read');
  if (summary?.address.address) open.push(`your Mudavym address (${summary.address.address})`);
  else if (summary) shut.push('the house has no Mudavym address');
  else if (opts.reading?.summary) shut.push('whether the house has a Mudavym address is still being read');
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
  kind: MailKind = 'vendor',
): string {
  if (messageCount === 0) return 'Only automatic mail — a bounce or an auto-reply, nothing to answer';
  if (direction === 'inbound') return `${personWords(name, kind)} wrote last`;
  if (direction === 'outbound') return 'The house wrote last';
  return 'Nothing on it has been sent or received yet';
}

/**
 * What a person is called when the gateway sent no name (r104 mail-gap g3): a
 * guest or a team member is never "The vendor". Display only.
 */
export function personWords(name: string | null | undefined, kind: MailKind = 'vendor'): string {
  const named = typeof name === 'string' ? name.trim() : '';
  if (named) return named;
  return kind === 'guest' ? 'The guest' : kind === 'team' ? 'The team member' : 'The vendor';
}

/**
 * The 30-day letter count the strip shows (r104 mail-gap g5). A 30-day window
 * holds today, so a count below today's is a server that counted two ways (an
 * older one counted vendor letters only in the 30 days and every kind today);
 * the strip never shows it. Null when the server sent none: unknown, never 0.
 */
export function lettersLast30(
  summary: { inLast30?: number | null; inToday?: number | null } | null | undefined,
): number | null {
  if (typeof summary?.inLast30 !== 'number') return null;
  return typeof summary.inToday === 'number' ? Math.max(summary.inLast30, summary.inToday) : summary.inLast30;
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
  /** The vendor; null on a reply to a team member or a guest (then `person` is set). */
  providerId: string | null;
  answers: string;
  subject: string;
  /**
   * A team or guest person who wrote to the house: the reply goes to this exact
   * address, on that thread, and nowhere else (r104 mail-gap g1, ADR 0396).
   */
  person?: { kind: 'team' | 'guest'; address: string; name: string | null };
}

export function answerFor(
  head: Pick<MailThreadPage, 'subject' | 'person'> | null,
  letters: readonly MailMessage[],
): MailAnswer | null {
  const providerId = head?.person?.providerId ?? null;
  const kind = mailKindOf(head?.person);
  // A team or guest person has no vendor: their key is kind:address, and the
  // address is the one that wrote (ADR 0396).
  const address =
    head?.person && kind !== 'vendor' && head.person.key.startsWith(`${kind}:`)
      ? head.person.key.slice(kind.length + 1)
      : '';
  if (!providerId && !address) return null;
  // Mail only: a WhatsApp letter has no mail thread to answer. A row with
  // no channel is from before the column, and those are mail.
  const answerable = letters.filter(
    (m) =>
      (!m.channel || m.channel.toLowerCase() === 'email') &&
      (m.direction === 'inbound' || m.sentAt !== null) &&
      // A person with no vendor is answered on what they wrote: the newest
      // letter that arrived from them, never an auto-reply or the house's own.
      (providerId !== null || (m.direction === 'inbound' && !m.automatic)),
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
    ...(!providerId && kind !== 'vendor'
      ? { person: { kind, address, name: head?.person?.name ?? null } }
      : {}),
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

/** The word on a row that is new to the person reading it (r36 mail gap 6). */
export const NEW_TO_YOU = 'New';

/**
 * What a person's row says when the newest letter to them has not left, in the
 * words the thread page uses. Null for a missing status and for one that means
 * the letter did go (a person's row never claims more than the thread does).
 */
export function unsentChipText(status: string | null | undefined): string | null {
  if (status == null || String(status).trim() === '') return null;
  const state = sendState(status);
  if (state === 'sent' || state === 'closed') return null;
  if (state === 'queued') return 'Queued · not sent yet';
  if (state === 'cancelled') return 'Pulled back · not sent';
  if (state === 'unconfirmed') return 'Sent? Not confirmed';
  if (state === 'sending') return 'Sending · not confirmed yet';
  return 'Not sent';
}

/** What POST /mail/thread/seen is told when a thread is on screen. */
export interface SeenMark {
  key: string;
  with: string;
  through: string;
}

/**
 * The mark a thread on screen earns (r36 mail gap 6): the newest letter the
 * vendor sent that this page shows, by its time exactly as the gateway gave it
 * (a Date would drop Postgres's microseconds and the thread would never read
 * as seen). Only a vendor's letter can make a thread new, so only one is
 * named; the gateway keeps the smaller of this and the thread's own newest
 * letter. Null when the page names no person or shows no letter from them.
 * `head` is the newest page (pages are held newest-first; within a page,
 * letters run oldest to newest).
 */
export function seenMarkFor(head: Pick<MailThreadPage, 'key' | 'person' | 'messages'> | null): SeenMark | null {
  if (!head?.person) return null;
  const newestIn = head.messages.filter((m) => m.direction === 'inbound').slice(-1)[0];
  if (!newestIn) return null;
  return { key: head.key, with: head.person.key, through: letterAt(newestIn) };
}
