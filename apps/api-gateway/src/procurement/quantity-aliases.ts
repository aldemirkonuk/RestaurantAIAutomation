import { BadRequestException } from "@nestjs/common";

/**
 * Reading a quantity that has a canonical, unit-declaring name and a deprecated
 * unitless alias.
 *
 * WHY THE ALIAS EXISTS AT ALL
 *
 * The receipt quantities used to be bare numbers — `invoiceQuantity`,
 * `acceptedQuantity`, `rejectedQuantity` — with nothing anywhere saying what
 * unit they were in. They are now named for the unit they carry
 * (`invoiceQuantityInInvoiceUom` and siblings). A bare rename would have been
 * the honest change if the server were the only thing that had to move, but it
 * is not: `apps/mobile/app/(tabs)/cellar/receive/[orderId].tsx` runs on a phone
 * that updates on the App Store's schedule and queues receipts in an offline
 * outbox, so a payload composed weeks ago can still arrive. Renaming without an
 * alias would answer those requests with "acceptedQuantity is not a known
 * field" — receiving would simply stop working on every phone that had not
 * updated, which is a worse outage than the bug being fixed.
 *
 * WHY THE ALIAS MAY NOT LIE
 *
 * The obvious failure of the alias pattern is that BOTH names arrive with
 * DIFFERENT values and the server quietly picks one. That is the same defect
 * class as the unitless quantity itself — a number chosen by a rule nobody can
 * see — so it is refused instead. Equal values are fine and expected: a client
 * mid-migration may legitimately send both.
 *
 * REMOVAL CONDITION — deliberately a trigger and not "someday"
 *
 * Every alias here can be deleted once no DEPLOYED CLIENT can still hold the old
 * name. Concretely: when the oldest mobile build still in the wild ships the
 * canonical names, and no queued offline receipt from before that build can
 * still be replayed (the outbox's own retention bounds this). Until both are
 * true, deleting an alias silently discards a real delivery count. Server-side
 * callers are not the gate — those are updated in-repo in the same change.
 */

/** One canonical/alias pair, for the reader below. */
export interface AliasedField<T> {
  canonicalName: string;
  canonical: T | null | undefined;
  aliasName: string;
  alias: T | null | undefined;
}

const present = (v: unknown) => v !== undefined && v !== null;

/**
 * Return the value of a field that may arrive under either name.
 *
 * Throws 400 when both names arrive with different values, naming both fields
 * and both values so the caller can see exactly which two numbers disagreed.
 * Returns `undefined` when neither was sent — absence stays absence, which for
 * these fields means "unknown" and never "zero".
 */
export function readAliasedQuantity<T extends number | string>(
  field: AliasedField<T>,
): T | undefined {
  const hasCanonical = present(field.canonical);
  const hasAlias = present(field.alias);

  if (hasCanonical && hasAlias && field.canonical !== field.alias) {
    throw new BadRequestException(
      `${field.canonicalName}=${String(field.canonical)} disagrees with its deprecated alias ` +
        `${field.aliasName}=${String(field.alias)}. They name the same quantity, so one of them is ` +
        `wrong and the server must not choose. Send only ${field.canonicalName}.`,
    );
  }

  if (hasCanonical) return field.canonical as T;
  if (hasAlias) return field.alias as T;
  return undefined;
}
