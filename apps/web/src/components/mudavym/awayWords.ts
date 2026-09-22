/**
 * The words the Away marker uses (ADR 0218), apart from the component so a
 * page can say the same sentence without importing a stylesheet.
 */

export interface AwayWindowLike {
  /** YYYY-MM-DD, the house's own calendar day, inclusive. */
  from: string;
  until: string;
}

export type AwayState = 'none' | 'now' | 'soon';

export function awayState(window: AwayWindowLike | null | undefined, today: string): AwayState {
  if (!window) return 'none';
  if (window.until < today) return 'none';
  return window.from <= today ? 'now' : 'soon';
}

export function dayWords(isoDay: string, locale?: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return isoDay;
  // UTC on both sides, so a calendar day never slides across a time zone.
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
}

/**
 * The sentence the note opens into. Exported so a page can reuse the words.
 *
 * "MOST alerts", not "no alerts": the notification funnel and the alert
 * producers skip a person who is Away, but some senders do not yet — a message
 * sent to them by name, a manager's team message (its push), calendar
 * reminders, and two in-app writers outside the funnel (ADR 0218, Open). Drop
 * the word only when the last of those is wired.
 */
export function awayExplanation(
  window: AwayWindowLike,
  opts: { personLabel?: string; self?: boolean; locale?: string } = {},
): string {
  const who = opts.self ? 'you' : (opts.personLabel ?? 'this person');
  const their = opts.self ? 'your' : 'their';
  const span = `${dayWords(window.from, opts.locale)} to ${dayWords(window.until, opts.locale)}`;
  return (
    `Away ${span}. Most alerts skip ${who} on these days; ${their} area's alerts go to the ` +
    'rest of the area, then its lead, then the owners and managers. Only the dates are kept.'
  );
}
