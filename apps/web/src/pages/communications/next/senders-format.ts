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
  if (f.expired) return `Your session has expired — sign in again and ${what} will read. Nothing below is claimed.`;
  if (f.forbidden)
    return `This account is not owner or manager, so ${what} is withheld. Nothing below is claimed — this is not an empty list.`;
  return `${what[0].toUpperCase()}${what.slice(1)} could not be read (${f.message}). Nothing below is claimed — this is not an empty list.`;
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
 */
export function strangerChips(p: Pick<ProspectDto, 'capture_reason' | 'attachments' | 'has_attachments' | 'message_count'>): string[] {
  const reasons = (p.capture_reason ?? '').split('+').filter(Boolean);
  const chips: string[] = [];
  if (reasons.includes('promotional')) chips.push('looks promotional');
  const n = p.attachments?.length ?? 0;
  if (n > 0) chips.push(`${n} attachment${n === 1 ? '' : 's'}`);
  else if (reasons.includes('attachment') || p.has_attachments) chips.push('has an attachment');
  if (chips.length === 0) chips.push('vendor outreach');
  if (p.message_count > 1) chips.push(`${p.message_count} emails`);
  return chips;
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
      sentence: `${who} was not added — the gateway did not create a vendor. It may belong to another house, or already be gone.`,
    };
  if (r.reused)
    return { kind: 'reused', sentence: `${who} is already a vendor of this house (same email) — linked, not duplicated.` };
  return { kind: 'added', sentence: `${who} is now a vendor of this house. Nothing about them is trusted yet.` };
}
