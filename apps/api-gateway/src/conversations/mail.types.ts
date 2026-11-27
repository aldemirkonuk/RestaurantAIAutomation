/**
 * The response shapes of GET /mail/* — the server read model behind the
 * /communications Mail tab (founder /goal 2026-11-07; sw-walk mail proposal,
 * Phase B L8, narrowed to the store that exists today).
 *
 * These names are a contract with the web lane (feat/comms-mail-tab). Adding a
 * field is safe; renaming or removing one breaks that lane.
 *
 * Every time is the ISO string Postgres returned, untouched: a cursor built
 * from it keeps microseconds, which a JS Date would drop, so a page boundary
 * between two letters in the same millisecond still holds.
 */

/** Only vendor mail is stored today (procurement_conversations). */
export type MailPersonKind = "vendor";

/**
 * Which door a letter came in by, or that the house sent it.
 * - house_mailbox: read from a person's own mailbox under their grant.
 * - whatsapp: the house's WhatsApp line.
 * - mudavym_mail: Mudavym's shared mailbox OR the house's Mudavym address —
 *   the stored row cannot tell those two apart until an intake record exists.
 * - from_house: an outbound letter.
 */
export type MailDoor =
  | "house_mailbox"
  | "whatsapp"
  | "mudavym_mail"
  | "from_house";

export interface MailPersonRow {
  /** `vendor:<provider uuid>` — the `with=` value of GET /mail/threads. */
  key: string;
  kind: MailPersonKind;
  providerId: string;
  name: string | null;
  /**
   * The newest letter that passed between the house and this person; for a
   * person whose only letter has not left, that letter's time.
   */
  lastAt: string;
  /** Its first ~160 characters, without its "Subject:" line. Never a draft. */
  lastLine: string | null;
  lastDirection: "inbound" | "outbound" | null;
  /** The house owes this person a reply on at least one thread. */
  waiting: boolean;
  /** Since when, on the oldest waiting thread. Null when not waiting. */
  waitingSince: string | null;
  /** Threads that are waiting or whose order is not closed. */
  openThreads: number;
  channels: string[];
  newestOpenOrderId: string | null;
  newestOpenOrderNumber: string | null;
  /**
   * The newest letter came from the vendor after the newest letter of it this
   * person was shown, or they never opened it (r36 mail gap 6). Per person,
   * not per house: a colleague reading it does not make it read for you.
   * Null when the marks could not be read; never false for "unknown".
   */
  newToYou: boolean | null;
  /**
   * The stored status of the house's newest letter to this person that has
   * NOT left (queued, sending, scheduled, failed, refused, pulled back), when
   * it is newer than the last letter that passed — or the only letter there
   * is. Null otherwise. A person is never dropped from the list for having
   * only such a letter, so it can still be pulled back (QA round 16, HARM 1).
   */
  unsentStatus: string | null;
}

export interface MailPeoplePage {
  people: MailPersonRow[];
  /** Pass as `after=` for the next page; null on the last page. */
  next: string | null;
  /**
   * The kinds of person whose mail is stored. Team, guest and stranger mail
   * is not stored yet, so the UI must not imply an empty list covers them.
   */
  storedKinds: MailPersonKind[];
}

export interface MailPersonRef {
  key: string;
  kind: MailPersonKind;
  providerId: string;
  name: string | null;
}

export interface MailThreadRow {
  /** The `key=` value of GET /mail/thread. */
  key: string;
  subject: string | null;
  /** Every row on the thread that is not automatic mail, drafts included. */
  messageCount: number;
  /**
   * The letters that came or went: sent or received. A draft, a queued or a
   * refused letter is on the thread but is not one of its letters (r28 mail
   * gap 14).
   */
  letterCount: number;
  lastAt: string;
  lastDirection: "inbound" | "outbound" | null;
  waiting: boolean;
  orderId: string | null;
  orderNumber: string | null;
  /**
   * The thread's newest letter came from the vendor after the newest letter of it this
   * person was shown, or they never opened it (r36 mail gap 6). Per person,
   * not per house: a colleague reading it does not make it read for you.
   * Null when the marks could not be read; never false for "unknown".
   */
  newToYou: boolean | null;
}

export interface MailThreadsPage {
  /** Null when `with=` names nobody this house has mail with. */
  person: MailPersonRef | null;
  threads: MailThreadRow[];
  next: string | null;
}

export interface MailMessage {
  id: string;
  direction: "inbound" | "outbound";
  channel: string;
  /** The letter's text without its leading "Subject:" line. */
  text: string;
  aiGenerated: boolean;
  status: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  /** Set when the original was removed under the retention rule; facts stay. */
  rawDeletedAt: string | null;
  door: MailDoor;
  /**
   * Mail a machine wrote — an auto-reply or a bounce. Shown on the thread,
   * never counted as a letter, never the reason anyone is waiting (M-5).
   */
  automatic: boolean;
  /**
   * When an owner or manager said this letter needs no reply (r28 mail gap
   * 4); null when nobody did. Only a letter the house received is marked.
   */
  noReplyMarkedAt: string | null;
  /**
   * The files the letter carried, as stored when it arrived (r28 mail gap
   * 13): a price list, an invoice, a photo. Empty when it carried none, or
   * when the page's `attachmentsRead` is false.
   */
  attachments: MailAttachment[];
}

/** One file a letter carried. Opened through GET /mail/attachments/:id/link. */
export interface MailAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** When the file itself was removed under the retention rule; its name stays. */
  removedAt: string | null;
}

/** The answer to GET /mail/attachments/:id/link: a short-lived address. */
export interface MailAttachmentLink {
  id: string;
  filename: string;
  mimeType: string | null;
  url: string;
  /** How long `url` works, from when it was made. */
  expiresInSeconds: number;
}

export interface MailOrderRef {
  id: string;
  number: string | null;
  status: string | null;
}

export interface MailThreadPage {
  key: string;
  subject: string | null;
  person: MailPersonRef | null;
  order: MailOrderRef | null;
  /** Oldest to newest within the page; at most 50. */
  messages: MailMessage[];
  /** Pass as `before=` for the older page; null when this page is the oldest. */
  before: string | null;
  /**
   * The house owes this thread a reply: its newest letter is one it received
   * that nobody has answered or marked as needing no reply. Over the whole
   * thread, not this page.
   */
  waiting: boolean;
  /**
   * False when the letters' files could not be read with this page: the
   * letters are shown, and the page must say their files could not be read,
   * never that they carried none.
   */
  attachmentsRead: boolean;
}

/** The answer to POST /mail/thread/seen. */
export interface MailSeenAnswer {
  key: string;
  /** `vendor:<provider uuid>`, the thread's person. */
  with: string;
  /**
   * The newest letter of this thread now kept as seen by this person; null
   * when the thread has no letter between the house and this vendor.
   */
  seenThrough: string | null;
}

/** The answer to POST/DELETE /mail/letters/:id/no-reply-needed. */
export interface MailNoReplyAnswer {
  id: string;
  /** True when the letter now carries the mark. */
  marked: boolean;
}

export interface MailDoorState {
  /** The last letter stored from this door; null when none ever was. */
  lastStoredAt: string | null;
}

export interface MailSummary {
  waitingPeople: number;
  oldestWaitAt: string | null;
  /**
   * Letters in and out on the house's own day: in its own zone, else its
   * country's only zone (common/house-day.ts). NULL when the house has
   * neither — the day has no midnight, so the count is unknown, never a UTC
   * day's count (D7).
   */
  inToday: number | null;
  outToday: number | null;
  /** The zone "today" was counted in, and where it came from. */
  zone: { zone: string | null; source: "house" | "country" | "none" };
  /**
   * Letters in over the last 30 days, counted like inToday: a bounce, an
   * auto-reply or a second copy of one letter is not a letter. The Letters
   * strip's "Replies · 30 days" (D6).
   */
  inLast30: number;
  /**
   * Letters held at a door. Always null today: no intake record exists until
   * the durable intake store (proposal L2), so it cannot be told — never 0.
   */
  heldAtDoor: null;
  doors: {
    houseMailbox: MailDoorState;
    whatsapp: MailDoorState;
    mudavymMail: MailDoorState;
  };
  address: {
    /** INBOUND_EMAIL_DOMAIN is set on this deployment. */
    configured: boolean;
    /** The house's active Mudavym address, if one was ever made. Never made here. */
    address: string | null;
  };
}
