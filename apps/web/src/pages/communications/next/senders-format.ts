/**
 * "Who is writing" formatting — the pure half of the Communications home for
 * sender reputation and strangers (ADR 0160 §113, Open item 3: the founder,
 * 2026-09-18, moved Trusted senders and Prospects here from `/promotions`).
 *
 * Every function is total and honest: an unknown is an em dash or a sentence
 * that says it is unknown, never a zero and never a guess (ADR 0020 / 0051).
 */

import type {
  ProspectDto,
  SenderReputationDto,
} from '../../../hooks/queries/usePromotionsQueries';
import { EM, GE } from './cm-format';

export interface ReadFailure {
  status: number | null;
  message: string;
  expired: boolean;
  forbidden: boolean;
}

/** Fold an axios-shaped error into the three cases the page says differently. */
export function readFailure(err: unknown): ReadFailure {
  const e = err as {
    response?: { status?: unknown; data?: { message?: unknown } };
    message?: string;
  } | null;
  const status = typeof e?.response?.status === 'number' ? e.response.status : null;
  const body = e?.response?.data?.message;
  const message =
    (typeof body === 'string' && body) ||
    (Array.isArray(body) && body.join(', ')) ||
    e?.message ||
    'the request failed';
  return { status, message, expired: status === 401, forbidden: status === 403 };
}

/**
 * The sentence for a failed READ. `what` is the register's name. A failed read
 * is never an empty list: the sentence says nothing below it is claimed.
 */
export function readFailureSentence(what: string, f: ReadFailure): string {
  // COMMS-W32: said in the house's words. "Nothing below is claimed — this is
  // not an empty list" became the page's own "That does not mean there are none."
  if (f.expired) return `Your session has expired — sign in again to see ${what}. That does not mean there are none.`;
  if (f.forbidden) return `Only an owner or manager can see ${what}. That does not mean there are none.`;
  return `${what[0].toUpperCase()}${what.slice(1)} could not be read (${f.message}). That does not mean there are none.`;
}

/** The sentence for a failed WRITE — said in words, next to the act that failed. */
export function writeFailureSentence(act: string, f: ReadFailure): string {
  if (f.expired) return `${act} was not saved: your session has expired — sign in again.`;
  if (f.forbidden) return `${act} was not saved: only an owner or manager can do this.`;
  return `${act} was not saved (${f.message}).`;
}

export type SenderTone = 'trusted' | 'plain' | 'suspended';

export interface SenderStateVM {
  tone: SenderTone;
  word: string;
}

/**
 * A suspended domain is not "trusted", whatever its `trusted` flag still says —
 * the gateway's own reading (`sender-reputation.service.ts`: "trusted AND not
 * suspended"). The reason is the row's own, or says none was recorded.
 */
export function senderState(s: Pick<SenderReputationDto, 'trusted' | 'suspended' | 'suspended_reason'>): SenderStateVM {
  if (s.suspended) return { tone: 'suspended', word: `suspended · ${s.suspended_reason?.trim() || 'no reason recorded'}` };
  if (s.trusted) return { tone: 'trusted', word: 'trusted' };
  return { tone: 'plain', word: 'not trusted' };
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** "9 Sep", or an em dash for a missing or unparseable stamp. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return EM;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? DAY.format(d) : EM;
}

/** A signal count as the triage lane recorded it; a non-number is an em dash, never 0. */
export function fmtCount(n: unknown): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(n) : EM;
}

/**
 * Why a stranger's mail was kept, in words. `capture_reason` is the bridge's
 * own `attachment` / `promotional` joined by `+` (rabbitmq-bridge.service.ts);
 * none recorded reads as plain vendor outreach — the legacy page's fallback.
 * A held letter (QA round 24) says first why it was not filed with a vendor.
 */
export function strangerChips(
  p: Pick<ProspectDto, 'capture_reason' | 'attachments' | 'has_attachments' | 'message_count' | 'held_reason' | 'sender_email' | 'domain'>,
): string[] {
  const reasons = (p.capture_reason ?? '').split('+').filter(Boolean);
  const chips: string[] = [];
  const held = heldWord(p);
  if (held) chips.push(held);
  if (reasons.includes('promotional')) chips.push('looks promotional');
  const n = p.attachments?.length ?? 0;
  if (n > 0) chips.push(`${n} attachment${n === 1 ? '' : 's'}`);
  else if (reasons.includes('attachment') || p.has_attachments) chips.push('has an attachment');
  if (chips.length === 0) chips.push('vendor outreach');
  if (held) {
    const i = chips.indexOf('vendor outreach');
    if (i >= 0) chips.splice(i, 1);
  }
  if (p.message_count > 1) chips.push(`${p.message_count} emails`);
  return chips;
}

/**
 * The chip for a held letter, or null for a stranger's introduction. Says
 * what is not known, never a guess at who wrote it.
 */
export function heldWord(p: Pick<ProspectDto, 'held_reason' | 'sender_email' | 'domain'>): string | null {
  if (p.held_reason === 'sender_unconfirmed') return `could not confirm it came from ${p.sender_email || p.domain || 'its sender'}`;
  if (p.held_reason === 'sender_unreadable') return 'could not read who sent it';
  return null;
}

/**
 * The sentence under a held letter, in place of "Add as a vendor": it was not
 * filed with any vendor, and an unconfirmed one is checked another way first.
 */
export function heldNote(p: Pick<ProspectDto, 'held_reason'>): string | null {
  if (p.held_reason === 'sender_unconfirmed')
    return 'Not filed with any vendor. Check with them another way before you pay or act on it.';
  if (p.held_reason === 'sender_unreadable') return 'Not filed with any vendor.';
  return null;
}

/**
 * Where a held letter can go (r35 mail, gap 9), for a `sender_unconfirmed`
 * row only: `file` names the vendor a person may file it under; `none` and
 * `unread` say in words why there is no such act. Null for any other row,
 * and for a gateway that does not name the vendor yet.
 */
export type HeldFiling =
  | { kind: 'file'; vendor: { id: string; name: string } }
  | { kind: 'none'; words: string }
  | { kind: 'unread'; words: string };

export function heldFiling(
  p: Pick<ProspectDto, 'held_reason' | 'sender_email' | 'held_vendor' | 'held_vendor_unread'>,
): HeldFiling | null {
  if (p.held_reason !== 'sender_unconfirmed' || !p.sender_email) return null;
  if (p.held_vendor_unread === true)
    return { kind: 'unread', words: `Which vendor lists ${p.sender_email} could not be read just now, so it cannot be filed yet.` };
  if (p.held_vendor) return { kind: 'file', vendor: p.held_vendor };
  if (p.held_vendor === null)
    return { kind: 'none', words: `No single vendor in your book lists ${p.sender_email}, so it cannot be filed under one.` };
  return null;
}

/** The sentence a person reads before filing a held letter: what they vouch for, and what follows. */
export function heldFilingWarning(sender: string, vendor: string): string {
  return (
    `The receiving mail server could not confirm ${sender} sent this letter. Filing it under ${vendor} says you know it is theirs: ` +
    `it joins their mail, and its files go where their files go, so an invoice in it is read as theirs.`
  );
}

/**
 * The accessible name of a held row's "file it there" button (r37 walk w3
 * M-F3). Two held letters from one vendor gave two buttons named alike; the
 * name now carries the letter's subject and day after the visible words, so
 * it still starts with what the button shows.
 */
export function heldFileAskLabel(
  p: Pick<ProspectDto, 'subject' | 'last_seen_at' | 'first_seen_at'>,
  vendor: string,
): string {
  const subject = p.subject && p.subject.trim() ? p.subject.trim() : 'no subject';
  return `It is from ${vendor}: file it there… (${subject}, ${fmtDay(p.last_seen_at ?? p.first_seen_at)})`;
}

/** A vendor's letter in Mail, as the gateway's notices link it: `?tab=mail&with=vendor:<id>`, and `&thread=` when known. */
export function mailLetterUrl(providerId: string, threadKey: string | null): string {
  const q = new URLSearchParams({ tab: 'mail', with: `vendor:${providerId}` });
  if (threadKey && threadKey.trim()) q.set('thread', threadKey.trim());
  return `/communications?${q.toString()}`;
}

/** The name a stranger's row shows: its name, its address, its domain, or says it has none. */
export function strangerName(p: Pick<ProspectDto, 'sender_name' | 'sender_email' | 'domain'>): string {
  return p.sender_name || p.sender_email || p.domain || 'no sender named';
}

/**
 * The line above the two registers. Each half is an em dash until ITS read
 * answers. The strangers list is served through a server cap, so a full window
 * prints as a floor (`≥100`), never as a total (ADR 0051 clause 2).
 */
export function whoIsWritingSummary(
  senders: readonly SenderReputationDto[] | undefined,
  strangers: readonly ProspectDto[] | undefined,
  strangersCap: number,
): string {
  const trusted = senders ? senders.filter((s) => s.trusted && !s.suspended).length : null;
  const suspended = senders ? senders.filter((s) => s.suspended).length : null;
  const waiting = strangers ? strangers.length : null;
  const floor = waiting !== null && waiting >= strangersCap ? GE : '';
  const part = (n: number | null, mark: string, one: string, many: string) =>
    n === null ? `${EM} ${many}` : `${mark}${n} ${n === 1 ? one : many}`;
  return [
    part(trusted, '', 'trusted sender', 'trusted senders'),
    part(suspended, '', 'suspended', 'suspended'),
    part(waiting, floor, 'stranger waiting', 'strangers waiting'),
  ].join(' · ');
}

/**
 * What a `POST /prospects/:id/promote` answer means. The gateway answers 200
 * `{promoted:false}` when the prospect is not this house's (or is gone), and
 * `{promoted:true, reused:true}` when the sender's email already belongs to a
 * vendor of the house — neither is a plain "added", and neither may print as one.
 */
export function promoteOutcome(
  r: { promoted?: boolean; reused?: boolean } | null | undefined,
  who: string,
): { kind: 'added' | 'reused' | 'not-added'; sentence: string } {
  if (!r || r.promoted !== true)
    return {
      kind: 'not-added',
      sentence: `${who} was not added — no vendor was made. It may belong to another house, or already be gone.`,
    };
  if (r.reused)
    return { kind: 'reused', sentence: `${who} is already a vendor of this house (same email address), so no second one was made.` };
  return { kind: 'added', sentence: `${who} is now a vendor of this house. Nothing about them is trusted yet.` };
}
