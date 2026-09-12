/**
 * The vendor's name, in words, for every screen that shows one.
 *
 * `OrderResponseDto.providerName` has THREE states and they are three different
 * facts (ADR 0020 — absence reported as health is the fault this exists to
 * refuse):
 *
 *   * a string  — the route joined `providers` and this is the name;
 *   * `null`    — the route joined and got nothing back. Either `provider_id`
 *                 is null or the provider row is gone. That is a fact ABOUT
 *                 THIS ORDER;
 *   * key ABSENT — this route does not join `providers`, so it knows nothing
 *                 either way. That is a fact about the QUERY.
 *
 * Collapsing the last two is how "vendor" came to be printed over every
 * delivery on the dashboard: one word that meant "we did not ask" and read as
 * "there is nobody". One function, in the foundation, so the four surfaces that
 * print a vendor cannot disagree about what a missing one means — pages depend
 * on `lib/mudavym`, never on each other.
 */

/** Just the part of an order this cares about. Anything wider is a coupling. */
export interface HasProviderName {
  providerName?: string | null;
}

/** The name, trimmed, or `null` for every state that is not a name. */
export function vendorName(order: HasProviderName | null | undefined): string | null {
  const raw = order?.providerName;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/**
 * The sentence for a row whose vendor could not be named — the join was made
 * and answered nothing, or was never made at all. Deliberately short: it sits
 * in a subtitle beside a timestamp, not in a paragraph.
 */
export const VENDOR_UNNAMED = 'Vendor not named';

/**
 * What a row prints where the vendor goes: the name, or the words above.
 *
 * Never an empty string. A blank in that slot is the same absence the wire
 * spent this change learning to state.
 */
export function vendorLine(order: HasProviderName | null | undefined): string {
  return vendorName(order) ?? VENDOR_UNNAMED;
}

/**
 * The same answer as a CLAUSE to append to a sentence — " · Acme Wines", or
 * nothing at all when there is no name.
 *
 * The difference from `vendorLine` is deliberate and is the one judgement call
 * here: in a list row the vendor has its own slot and a silent slot would read
 * as "no vendor", so the words are printed. In a running sentence
 * ("Against order ORD-42 · ordered $2,100") there is no slot to leave empty,
 * and appending "Vendor not named" to every line of a receipts feed is noise
 * about the query rather than news about the order. Pass `sayWhenUnnamed` when
 * the caller wants the words anyway.
 */
export function vendorClause(
  order: HasProviderName | null | undefined,
  opts: { separator?: string; sayWhenUnnamed?: boolean } = {},
): string {
  const sep = opts.separator ?? ' · ';
  const name = vendorName(order);
  if (name) return `${sep}${name}`;
  return opts.sayWhenUnnamed ? `${sep}${VENDOR_UNNAMED}` : '';
}
