/**
 * Whether tax is inside a cost, stamped where the cost is recorded (ADR 0341
 * §6, founder 2026-10-12 S218 F3: "Yes, stamp cost basis").
 *
 * Margin advice at a house whose till prices include tax works only on a cost
 * proven to be without tax (`margin-advice.service.ts` `costTaxProof`). The
 * columns exist (migration `house_tax_basis_and_rates`); this is their writer
 * at the three places a cost is recorded: the order line, the receipt check
 * and the delivery's verification.
 *
 * THE RULE, IN ORDER:
 *   1. A house whose till prices do NOT include tax (unset, prices exclude
 *      tax, no VAT charged) gets no stamp at all: nothing reads one there, and
 *      those houses stay exactly as they were. So does a house whose basis
 *      could not be read.
 *   2. What an owner or a manager said for this cost. Each route refuses the
 *      statement from anyone who does not hold the house's money
 *      (`holdsHouseMoney`), before anything is written.
 *   3. Otherwise the house's country rule: in Türkiye a vendor's price is
 *      taken to include KDV, in the United States a wholesale price is taken
 *      to exclude sales tax. A country with no rule here stamps nothing:
 *      "not stated", which advice refuses on.
 *
 * Writing the stamp on a lot is a SEPARATE statement after the cost: the
 * trigger `a_changed_cost_loses_its_unstated_tax_basis` clears the basis of a
 * cost changed in a write that leaves the basis as it was.
 */
import { countryCodeOf } from "./house-frame";
import {
  asCostTaxBasis,
  asHouseTaxBasis,
  type CostTaxBasis,
} from "./tax-basis";

/** What a cost stamp needs to know about the house. */
export interface HouseCostTaxTerms {
  /** The house says its till prices include tax. */
  inclusive: boolean;
  /** The house's recorded country, as a code; null when none is known. */
  country: string | null;
}

/** The minimum of a Supabase client these helpers use. */
type Client = { from: (table: string) => any };
type Log = { warn: (msg: string) => void };

/** The country rule (step 3), or null where none is recorded here. */
export function costTaxDefaultFor(country: string | null): CostTaxBasis | null {
  if (country === "TR") return "includes_tax";
  if (country === "US") return "excludes_tax";
  return null;
}

/**
 * The stamp for one cost: null writes nothing (step 1), else what was said
 * (step 2), else the country rule (step 3). A value outside the two reads as
 * not said.
 */
export function costTaxStampFor(
  terms: HouseCostTaxTerms | null,
  stated: unknown,
): CostTaxBasis | null {
  if (!terms || !terms.inclusive) return null;
  return asCostTaxBasis(stated) ?? costTaxDefaultFor(terms.country);
}

/**
 * The house's basis and country, or null when they could not be read. Never
 * throws: a cost is recorded either way, and an unread house stamps nothing,
 * which advice reads as "not stated" -- never as a proven cost.
 */
export async function readHouseCostTaxTerms(
  client: Client,
  restaurantId: string,
  log?: Log,
): Promise<HouseCostTaxTerms | null> {
  try {
    const read = await client
      .from("restaurants")
      .select("tax_basis, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (read?.error || !read?.data) {
      log?.warn(
        `house ${restaurantId}: whether its prices include tax could not be read (${read?.error?.message ?? "no row"}); the cost is recorded with its tax basis not stated`,
      );
      return null;
    }
    const row = read.data as { tax_basis?: unknown; country?: unknown };
    return {
      inclusive: asHouseTaxBasis(row.tax_basis) === "prices_include_tax",
      country: countryCodeOf(
        typeof row.country === "string" ? row.country : null,
      ),
    };
  } catch (err: any) {
    log?.warn(
      `house ${restaurantId}: whether its prices include tax could not be read (${err?.message ?? "unknown error"}); the cost is recorded with its tax basis not stated`,
    );
    return null;
  }
}

/**
 * Stamp the live lots one cost write just priced. `scope` names them the way
 * that write did: by the order it restated, or by the delivery it settled.
 * A failure is logged, never thrown: the cost stands, and its basis reads as
 * not stated.
 */
export async function stampLotsCostTaxBasis(
  client: Client,
  args: {
    restaurantId: string;
    inventoryIds: string[];
    scope: { orderId: string } | { deliveryId: string };
    basis: CostTaxBasis;
  },
  log?: Log,
): Promise<void> {
  if (!args.inventoryIds.length) return;
  try {
    let q = client
      .from("inventory_lots")
      .update({ unit_cost_tax_basis: args.basis })
      .eq("restaurant_id", args.restaurantId);
    q =
      "orderId" in args.scope
        ? q.eq("source_order_id", args.scope.orderId)
        : q.eq("delivery_id", args.scope.deliveryId);
    const { error } = await q
      .eq("stock_state", "live")
      .in("inventory_id", args.inventoryIds);
    if (error)
      log?.warn(
        `the cost of ${args.inventoryIds.join(", ")} was recorded, but whether tax is inside it (${args.basis}) was not: ${error.message}`,
      );
  } catch (err: any) {
    log?.warn(
      `the cost of ${args.inventoryIds.join(", ")} was recorded, but whether tax is inside it (${args.basis}) was not: ${err?.message ?? "unknown error"}`,
    );
  }
}
