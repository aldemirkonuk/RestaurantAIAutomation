/**
 * F-1588 remainder (ADR 0341 F2, "reports mark the switch date"): the one
 * read a period's net reader makes to say whether the period spans a day the
 * net changed basis. The dashboard and the month close read the same history
 * (`readTaxBasisHistory`, `taxBasisStretches`); this is the shared form for
 * the readers that have no switch-day line of their own.
 *
 * A house with no answer in force (unset) is not read past its own row, so
 * it stays an exact no-op. Throws on a failed read: an unread history is not
 * one with no change, and each caller says so in its own words.
 */

import { countryCodeOf } from "./house-frame";
import {
  readTaxBasisHistory,
  taxBasisStretches,
  taxSwitchNote,
} from "./tax-basis-history";
import { asHouseTaxBasis } from "./tax-basis";
import { taxWordFor } from "../settings/house-tax-basis.service";

export async function readPeriodTaxNote(
  client: { from: (table: string) => any },
  restaurantId: string,
  zone: string | null,
  first: string,
  last: string,
): Promise<string | null> {
  if (!zone || first >= last) return null;
  const { data, error } = await client
    .from("restaurants")
    .select("tax_basis, tax_basis_confirmed_at, country")
    .eq("id", restaurantId)
    .maybeSingle();
  if (error)
    throw new Error(
      `The house's tax answer could not be read: ${error.message ?? String(error)}`,
    );
  const row = (data ?? {}) as Record<string, unknown>;
  const basis = asHouseTaxBasis(row.tax_basis);
  if (basis === null || basis === "unset") return null;
  const stretches = taxBasisStretches(
    await readTaxBasisHistory(client, restaurantId, {
      basis: typeof row.tax_basis === "string" ? row.tax_basis : null,
      confirmedAt:
        typeof row.tax_basis_confirmed_at === "string"
          ? row.tax_basis_confirmed_at
          : null,
    }),
    zone,
  );
  return taxSwitchNote(
    stretches,
    first,
    last,
    taxWordFor(
      countryCodeOf(typeof row.country === "string" ? row.country : null),
    ),
  );
}

/** What a reader says when the read above fails, in the owner's words. */
export const PERIOD_TAX_NOTE_UNREAD =
  "Whether the house changed its answer about tax in this period could not be read. If it did, the net here is not all on one basis.";

/**
 * w109-gross-basis (ADR 0341): the readers that sum `pos_checks.total` (the
 * till register's Taken, the room and server registers) or the till's own
 * line prices (Average check and Wine revenue goals) stay on what the till
 * rang, which is what /reports Taken is; ingest changes only `subtotal`
 * (Decision 5), so those figures keep one basis across the switch day. At a
 * house whose till prices include tax they hold that tax, so the reader says
 * so in the tax's own name. Every other answer, unset included, returns null:
 * an exact no-op. Throws on a failed read, like `readPeriodTaxNote`.
 */
export async function readTillPricesTaxWord(
  client: { from: (table: string) => any },
  restaurantId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("restaurants")
    .select("tax_basis, country")
    .eq("id", restaurantId)
    .maybeSingle();
  if (error)
    throw new Error(
      `The house's tax answer could not be read: ${error.message ?? String(error)}`,
    );
  const row = (data ?? {}) as Record<string, unknown>;
  if (asHouseTaxBasis(row.tax_basis) !== "prices_include_tax") return null;
  return taxWordFor(
    countryCodeOf(typeof row.country === "string" ? row.country : null),
  );
}

/** Said beside till totals at a house whose till prices include tax. */
export function tillTotalsTaxNote(word: string): string {
  return `Prices on your till include ${word}, so these totals include ${word}.`;
}

/** Said under an Average check or Wine revenue goal at such a house. */
export function goalTaxNote(label: string, word: string): string {
  return `${label} is worked out on your till's prices, which include ${word}, so it reads higher than net sales.`;
}

/** What a till-totals reader says when the house's answer cannot be read. */
export const TILL_TOTALS_TAX_UNREAD =
  "Whether your till's prices include tax could not be read, so these totals may or may not include it.";
