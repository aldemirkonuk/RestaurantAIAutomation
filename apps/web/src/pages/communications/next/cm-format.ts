/**
 * CommunicationsNext formatting — unknowns are em dashes, never zeros; a
 * count is only printed once the query that carries it has answered.
 */

export const EM = '—';

/**
 * The floor mark. A figure derived from a capped server window is a FLOOR, not
 * a total: `≥97` says "at least 97 and the window was full", which is the only
 * honest reading when the query could not see past its own cap (ADR 0051
 * clause 2). Exported rather than inlined so `check_windowed_figures.py` (W2)
 * can prove the marker still exists in the renderer that knows about
 * COMMS_SERVER_WINDOWS — deleting the `≥` while keeping the constant is the
 * cheapest way to silently undo this.
 */
export const GE = '≥';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Day, month (and year), hour:minute of a moment on `zone`'s clock — the device's when none. */
function wallParts(d: Date, zone: string | null | undefined) {
  const read = (timeZone: string | undefined) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).formatToParts(d);
  let p: Intl.DateTimeFormatPart[];
  try {
    p = read(zone || undefined);
  } catch {
    p = read(undefined); // a zone this browser cannot read: the device's clock
  }
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { dm: `${get('day')} ${get('month')}`, year: get('year'), hm: `${get('hour')}:${get('minute')}` };
}

/**
 * When a letter was sent or a request made, on the HOUSE's clock (`zone`,
 * from `useHouseZone`; the device's clock while none is known): the time when
 * it is the house's today, "10 Oct" earlier this year, "10 Oct 2025" before
 * it. The book runs back past a year in a quiet house, and a yearless "10 Oct"
 * read last October's letter as this October's; a device in another zone put
 * an Istanbul letter at 01:30 on the day before (F-903).
 */
export function fmtWhen(
  iso: string | null | undefined,
  zone?: string | null,
  now: Date = new Date(),
): string {
  if (!iso) return EM;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return EM;
  const at = wallParts(d, zone);
  const today = wallParts(now, zone);
  if (at.dm === today.dm && at.year === today.year) return at.hm;
  return at.year === today.year ? at.dm : `${at.dm} ${at.year}`;
}

/**
 * The outbound lifecycle, collapsed to what a manager needs to know.
 * APPROVED is PRE-send — approval authorises dispatch, it is not dispatch
 * (prc-02; same reading as conversationGrouping.ts and the receiving spine).
 * Only AUTO_SENT / SENT / DELIVERED may ever look sent.
 */
export type SendState =
  | 'draft'
  | 'queued'
  | 'cancelled'
  | 'failed'
  | 'sending'
  | 'scheduled'
  | 'sent'
  | 'unconfirmed'
  | 'closed'
  | 'other';

/**
 * NULL-TOLERANT ON PURPOSE. `procurement_conversations.status` is
 * `varchar(20) DEFAULT 'DRAFT'` with NO `NOT NULL`, and ADR 0084's ledger
 * deny-list admits a null-status row deliberately — `.or("status.is.null,…")`,
 * twice, on the reasoning that "an unrecognised or absent status is the case we
 * most want on screen" (procurement.service.ts `getConversationHistory`). The
 * mapper passes it through as `status: row.status`, so `null` reaches this
 * function and `null.toUpperCase()` took the whole page down with it.
 *
 * An absent status is 'other': it is not a lifecycle claim, so it may not be
 * rendered as one. Never 'draft' (that invites a second send) and never 'sent'.
 */
export function sendState(status: string | null | undefined): SendState {
  const s = String(status ?? '').toUpperCase();
  // The house composer's own lifecycle (ADR 0118). A queued letter is NOT a
  // draft — a draft is something nobody has decided about, and this is a letter
  // a person has already pressed Send on, still inside its undo window. It is
  // also emphatically not 'sent': the whole point of the window is that the
  // letter has not left, and the 30-day sent figure must not count it.
  if (s === 'HOUSE_QUEUED') return 'queued';
  // Written by Mudavym for a person to send (ADR 0230) — nobody has decided.
  if (s === 'HOUSE_DRAFT') return 'draft';
  if (s === 'HOUSE_CANCELLED') return 'cancelled';
  // Definitely NOT sent, which is a different fact from 'unconfirmed' (the
  // vendor may hold it and we could not confirm). This letter did not leave.
  if (s === 'HOUSE_FAILED') return 'failed';
  // The relay's own doors refused this exact request (400/403/422, or a
  // header refusal) before any transport — CLOSED, not retried (ADR 0099,
  // founder 2026-09-21). Same footing as HOUSE_FAILED: definitely not sent,
  // and not a draft either — it never re-enters PENDING_APPROVAL, so it
  // never appears in the approval queue for a stale "Approve" to reach.
  if (s === 'RELAY_REFUSED') return 'failed';
  if (s === 'DRAFT' || s === 'PENDING_APPROVAL' || s === 'APPROVED') return 'draft';
  // A send is in flight and the row is claimed. Not a draft — nobody may act
  // on it — and not yet sent, so it gets its own state rather than falling
  // through to 'other' and rendering as a raw enum.
  if (s === 'SENDING' || s === 'AUTO_SENDING') return 'sending';
  // F-424: an AI reply the house's auto-send switch staged to leave by itself
  // after its undo window (inbound-responder `AUTO_SEND_SCHEDULED`). It has NOT
  // left, and it is not a draft waiting on anyone either — it goes unless a
  // person stops it. It fell through to 'other' and printed the raw enum.
  if (s === 'AUTO_SEND_SCHEDULED') return 'scheduled';
  if (s === 'AUTO_SENT' || s === 'SENT' || s === 'DELIVERED') return 'sent';
  // The vendor may already hold this email but we could not confirm it. It is
  // NOT 'sent' (that would overclaim) and NOT 'draft' (that would invite a
  // second send). ADR 0020: say the uncertainty out loud.
  if (s === 'SEND_UNCONFIRMED') return 'unconfirmed';
  // The gateway refused to build it: definitely NOT sent, and closed (founder
  // answer 6, 2026-09-21) — the same fact as a house letter that failed.
  if (s === 'SEND_REFUSED') return 'failed';
  if (s === 'COMPLETED' || s === 'CLOSED') return 'closed';
  return 'other';
}

/** Chip wording for the pre-send states — approval is said as approval. */
export function draftChipText(status: string | null | undefined): string {
  const s = String(status ?? '').toUpperCase();
  if (s === 'APPROVED') return 'Approved · not sent';
  // Not an AI reply: a letter the house drafted from its own record (a credit
  // claim asked for, ADR 0230). Still not sent.
  if (s === 'HOUSE_DRAFT') return 'Drafted · not sent';
  return 'AI draft · not sent';
}

/**
 * The row's own type label. `outbound_email_type` is NULL on every INBOUND row
 * — the inbound writer (`rabbitmq-bridge.service.ts` `handleInboundEmail`)
 * never sets it, and it is null on all ten of production's inbound rows — so
 * once ADR 0084 let those rows onto this page, `emailType.toLowerCase()` threw.
 *
 * A vendor's own reply has no outbound type and never will. It gets said as
 * what it is rather than being given a borrowed one.
 */
export function typeLabel(
  emailType: string | null | undefined,
  labels: Record<string, string>,
  direction?: 'INBOUND' | 'OUTBOUND' | null,
): string {
  const t = String(emailType ?? '').trim();
  if (t === '') return direction === 'INBOUND' ? 'Vendor reply' : EM;
  return labels[t] ?? t.toLowerCase();
}

/**
 * Why the engine held a drafted letter, in the house's words (COMMS-W22). The
 * codes are the orchestrator's hard rules (`constraint_engine.py`,
 * `check_hard_constraints`); the page says what each one means and never the
 * code itself. A code with no words here is still said to exist.
 */
const HELD_BECAUSE: Record<string, string> = {
  'C-01': 'it does not seem to be about the order',
  'C-02': 'it commits the house to something',
  'C-03': 'it asks for more than one and a half times the quantity ordered',
  'C-04': 'the price is more than 15% over the house’s target',
  'C-05': 'the exchange has reached its limit of rounds',
  'C-13': 'the vendor’s side looks like an automatic reply',
  'C-19': 'it talks of buying around the distributor',
  'C-20': 'its tone is heated',
  'C-21': 'it holds personal details',
};

/**
 * The hard-constraint codes on a letter, or none. `constraint_flags` is a
 * jsonb every writer fills differently (`{}` by default, PO metadata, AI
 * reply reasons), so only a real array of strings under `hard` counts.
 */
export function hardCodesOf(flags: unknown): string[] {
  if (!flags || typeof flags !== 'object') return [];
  const hard = (flags as { hard?: unknown }).hard;
  return Array.isArray(hard) ? hard.filter((c): c is string => typeof c === 'string') : [];
}

/**
 * Like `HELD_BECAUSE`, for the reply engine’s held-for-review reasons
 * (`inbound-responder.service.ts`, `computeGuardrails`), which name their rule
 * in words rather than a C-number.
 */
const HELD_BECAUSE_REPLY: Record<string, string> = {
  commitment_language: 'it commits the house to something',
  price_above_target: 'the vendor’s price is above the house’s target',
  qty_or_budget_change: 'the vendor offers a different quantity than the house ordered',
  max_rounds: 'the exchange has gone back and forth three times or more',
  sender_unverified: 'the vendor’s mail could not be proven to come from them',
  price_inconsistent: 'the vendor’s case and bottle prices do not agree',
  moq_not_met: 'the order is below the vendor’s minimum',
  currency_ambiguous: 'the vendor’s currency is unclear',
  tax_status_unknown: 'the vendor did not say whether tax is included',
};

/** One held-for-review rule, in the house's words. */
export function heldWords(code: string): string {
  return HELD_BECAUSE[code] ?? HELD_BECAUSE_REPLY[code] ?? 'a rule this page has no words for yet';
}

export function heldBecause(codes: readonly string[]): string {
  const words = [...new Set(codes.map(heldWords))];
  const list =
    words.length < 3 ? words.join(' and ') : `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`;
  return `Held because ${list}.`;
}

/**
 * Whether this person is an owner or manager OF THIS HOUSE (COMMS-W31). The
 * gateway answers three things on this page only for those two — the house's
 * drafted letters (`GET communications/letters/drafts`), the trusted-senders
 * register (`/senders/*`) and adding a stranger as a vendor
 * (`POST prospects/:id/promote`) — so a staff member's page neither asks for
 * them nor offers them. Read the same way as /receipts (`canSeeCreditLedger`,
 * ADR 0167): `activeRole` is the role in the session's house, the account's
 * `users.role` only the fallback while no house is active, and an
 * unrecognised or missing role is treated as staff, as the server does.
 */
export function managesHouse(activeRole: string | null | undefined, globalRole: string | null | undefined): boolean {
  const role = (activeRole ?? globalRole ?? '').toLowerCase();
  return role === 'owner' || role === 'manager';
}

/**
 * When a read last answered, as a reader says it (COMMS-W33): "at 20:43" today,
 * "on 30 Sept at 20:43" before. `ms` is TanStack Query's `dataUpdatedAt`.
 */
export function fmtAsOf(ms: number): string {
  const d = new Date(ms);
  if (!ms || !Number.isFinite(d.getTime())) return 'at a time that was not recorded';
  const t = time.format(d);
  return new Date().toDateString() === d.toDateString() ? `at ${t}` : `on ${day.format(d)} at ${t}`;
}

/**
 * Why a read failed, for a sentence's brackets (COMMS-W33): the server's own
 * words when it sent some, without a full stop of their own. Never the HTTP
 * client's "Request failed with status code 500" — that is protocol, not a
 * reason, and it was what the page's banner printed.
 */
export function failedReadWords(err: unknown): string {
  const res = (err as { response?: { data?: { message?: unknown } } } | null)?.response;
  const m = res?.data?.message;
  const said = typeof m === 'string' ? m.trim() : Array.isArray(m) ? m.join(', ') : '';
  if (said) return said.replace(/[.!?]+$/, '');
  if (res) return 'it answered with an error';
  const e = err as { isAxiosError?: boolean; code?: string } | null;
  return e?.isAxiosError || e?.code === 'ERR_NETWORK' ? 'no answer — check the connection' : 'something went wrong reading it';
}

/**
 * A read that answered before and failed now (COMMS-W33, founder: "A: keep, say
 * when"). What it last read stays on screen, so the line under it says when
 * that was and that it could not be read again — a page left open never empties
 * on a blip, and never passes its last answer off as the present.
 */
export function readAgainFailed(words: string, atMs: number, wasEmpty: boolean, what?: string): string {
  const head = `${what ? capital(what) : 'Could'}${what ? ' could' : ''} not be read again (${words}).`;
  return wasEmpty
    ? `${head} ${capital(fmtAsOf(atMs))} there were none; there may be some now.`
    : `${head} This is as it was ${fmtAsOf(atMs)}; there may be more or fewer now.`;
}

function capital(s: string): string {
  return s ? `${s[0].toUpperCase()}${s.slice(1)}` : s;
}

/** One failed read on the page, for the banner over the strip. */
export interface FailedRead {
  name: string;
  /** True when it answered before: what it said is still on screen. */
  stale: boolean;
  /** When it last answered (`dataUpdatedAt`); 0 when it never has. */
  at: number;
}

/**
 * The banner's sentence (COMMS-W33). It names what could not be read and says
 * when what is on screen is from; each part of the page carries its own reason.
 * It used to say "those figures show — because they failed, not because they
 * are still in flight" over figures that showed 4, 3 and 3.
 */
export function failedReadsSentence(reads: readonly FailedRead[]): string {
  if (reads.length === 0) return '';
  const names = reads.map((r) => r.name);
  const list = names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const stale = reads.filter((r) => r.stale);
  const allStale = stale.length === reads.length;
  let s = `Part of this page could not be read${allStale ? ' again just now' : ''}: ${list}.`;
  if (stale.length > 0) s += ` What you see is as it was ${fmtAsOf(Math.min(...stale.map((r) => r.at)))}.`;
  if (!allStale) s += ' That does not mean there is nothing there.';
  return s;
}

/**
 * F-982: said in place of a letter's words when the gateway withheld them
 * (`wordsWithheld`): its words name prices, which only owners, managers and
 * the people an owner allows to write to vendors read.
 */
export const LETTER_WORDS_WITHHELD =
  'This letter names prices, so its words are shown to owners, managers and ' +
  'the people an owner has allowed to write to vendors.';

/**
 * F-1176: said in place of the files a vendor sent with a letter when the
 * gateway withheld them (`withheld`). A price list or an invoice names prices
 * as the letter does, so the same people open it.
 */
export const LETTER_FILES_WITHHELD =
  'Files came with this letter. They may name prices, so they are shown to ' +
  'owners, managers and the people an owner has allowed to write to vendors.';
