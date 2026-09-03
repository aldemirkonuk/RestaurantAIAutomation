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

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return EM;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return EM;
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? time.format(d) : day.format(d);
}

/** Human line for a schedule row: "Weekly · Mondays 09:00" style, EM-honest. */
export function fmtCadence(frequency: string, dayOfWeek?: number | null, timeOfDay?: string | null): string {
  const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const parts = [frequency.charAt(0).toUpperCase() + frequency.slice(1)];
  if (typeof dayOfWeek === 'number' && days[dayOfWeek]) parts.push(days[dayOfWeek]);
  if (timeOfDay) parts.push(timeOfDay.slice(0, 5));
  return parts.join(' · ');
}

/**
 * The outbound lifecycle, collapsed to what a manager needs to know.
 * APPROVED is PRE-send — approval authorises dispatch, it is not dispatch
 * (prc-02; same reading as conversationGrouping.ts and the receiving spine).
 * Only AUTO_SENT / SENT / DELIVERED may ever look sent.
 */
export type SendState = 'draft' | 'sending' | 'sent' | 'unconfirmed' | 'closed' | 'other';

export function sendState(status: string): SendState {
  const s = status.toUpperCase();
  if (s === 'DRAFT' || s === 'PENDING_APPROVAL' || s === 'APPROVED') return 'draft';
  // A send is in flight and the row is claimed. Not a draft — nobody may act
  // on it — and not yet sent, so it gets its own state rather than falling
  // through to 'other' and rendering as a raw enum.
  if (s === 'SENDING' || s === 'AUTO_SENDING') return 'sending';
  if (s === 'AUTO_SENT' || s === 'SENT' || s === 'DELIVERED') return 'sent';
  // The vendor may already hold this email but we could not confirm it. It is
  // NOT 'sent' (that would overclaim) and NOT 'draft' (that would invite a
  // second send). ADR 0020: say the uncertainty out loud.
  if (s === 'SEND_UNCONFIRMED') return 'unconfirmed';
  if (s === 'COMPLETED' || s === 'CLOSED') return 'closed';
  return 'other';
}

/** Chip wording for the pre-send states — approval is said as approval. */
export function draftChipText(status: string): string {
  return status.toUpperCase() === 'APPROVED' ? 'Approved · not sent' : 'AI draft · not sent';
}
