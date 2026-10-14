/**
 * Whether tax is inside a cost, stamped where the cost is recorded (ADR 0341
 * §6, founder 2026-10-12 S218 F3: "Yes, stamp cost basis").
 *
 * Margin advice at a house whose till prices include tax works only on a cost
 * proven to be without tax (`margin-advice.service.ts` `costTaxProof`). The
 * columns exist (migration `house_tax_basis_and_rates`); this is their writer
 * where a cost is recorded: the order line, the receipt check, the delivery's
 * verification, and the bottles a manual receipt, a wine added with stock or
 * an opening count book (`stampLotsCostedByWrite`).
 *
 * THE RULE:
 *   1. A house whose till prices do NOT include tax (unset, prices exclude
 *      tax, no VAT charged) gets no stamp at all: nothing reads one there, and
 *      those houses stay exactly as they were. So does a house whose basis
 *      could not be read.
 *   2. Otherwise only what an owner or a manager said for this cost. Each
 *      route refuses the statement from anyone who does not hold the house's
 *      money (`holdsHouseMoney`), before anything is written.
 *   3. Nothing said, nothing stamped: "not stated", which advice refuses on.
 *      The house's country is NEVER turned into a stamp. ADR 0341 §1 calls
 *      the country "a proposal, never a value", and a stored stamp carries no
 *      mark of who said it, so a guessed one could never be found again.
 *      Whether a country default is wanted at all is OD-232.
 *
 * Writing the stamp on a lot is a SEPARATE statement after the cost: the
 * trigger `a_changed_cost_loses_its_unstated_tax_basis` clears the basis of a
 * cost changed in a write that leaves the basis as it was.
 */
import {
  asCostTaxBasis,
  asHouseTaxBasis,
  type CostTaxBasis,
} from "./tax-basis";

/** What a cost stamp needs to know about the house. */
export interface HouseCostTaxTerms {
  /** The house says its till prices include tax. */
  inclusive: boolean;
}

/** The minimum of a Supabase client these helpers use. */
type Client = { from: (table: string) => any };
type Log = { warn: (msg: string) => void };

/**
 * The stamp for one cost: null writes nothing (step 1), else what was said
 * (step 2), else null (step 3). A value outside the two reads as not said.
 */
export function costTaxStampFor(
  terms: HouseCostTaxTerms | null,
  stated: unknown,
): CostTaxBasis | null {
  if (!terms || !terms.inclusive) return null;
  return asCostTaxBasis(stated);
}

/**
 * Whether the house's till prices include tax, or null when they could not be read. Never
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
      .select("tax_basis")
      .eq("id", restaurantId)
      .maybeSingle();
    if (read?.error || !read?.data) {
      log?.warn(
        `house ${restaurantId}: whether its prices include tax could not be read (${read?.error?.message ?? "no row"}); the cost is recorded with its tax basis not stated`,
      );
      return null;
    }
    const row = read.data as { tax_basis?: unknown };
    return {
      inclusive: asHouseTaxBasis(row.tax_basis) === "prices_include_tax",
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

/**
 * The ids of an item's live lots that already carry a cost, read just before
 * a write that may cost new ones: a manual receipt, a wine added with stock,
 * an opening count (ADR 0341 F3; ledger S234, owed by w106-cost-truth). Null
 * when they could not be read, and then nothing is stamped: a lot this write
 * did not cost must never take a statement made about another one.
 */
export async function costedLiveLotIds(
  client: Client,
  restaurantId: string,
  inventoryId: string,
  log?: Log,
): Promise<Set<string> | null> {
  try {
    const { data, error } = await client
      .from("inventory_lots")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .eq("stock_state", "live")
      .not("unit_cost", "is", null);
    if (error || !Array.isArray(data)) {
      log?.warn(
        `item ${inventoryId}: its costed bottles could not be read (${error?.message ?? "no rows"}), so whether tax is inside the new cost is not recorded`,
      );
      return null;
    }
    return new Set(data.map((r: { id: string }) => r.id));
  } catch (err: any) {
    log?.warn(
      `item ${inventoryId}: its costed bottles could not be read (${err?.message ?? "unknown error"}), so whether tax is inside the new cost is not recorded`,
    );
    return null;
  }
}

/**
 * A cost in whole cents, rounded as `inventory_lots.unit_cost` (numeric(10,2))
 * rounds what it is given: on the decimal the number is sent as, half away
 * from zero (F-1707). A typed 12.345 is stored as 12.35, so comparing the
 * typed figure to the stored one as they stand never matched, and the
 * owner's answer was silently not stamped. Exported for its test.
 */
export function costCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // The decimal JSON sends for this number, which is what the column rounds.
  const text = String(Math.abs(n));
  if (text.includes("e")) return Math.sign(n) * Math.round(Math.abs(n) * 100);
  const [whole, frac = ""] = text.split(".");
  const cents =
    Number(whole) * 100 +
    Number(frac.slice(0, 2).padEnd(2, "0")) +
    (Number(frac[2] ?? "0") >= 5 ? 1 : 0);
  return n < 0 ? -cents : cents;
}

/**
 * Stamp the lots one write just costed: the item's live lots that carry
 * `unitCost` now (to the cent the column keeps, `costCents`), state no basis, and were not costed before the write
 * (`before`, from `costedLiveLotIds`). A lot costed earlier, or at another
 * figure, is left as it was. Logged, never thrown: the cost stands either way.
 */
export async function stampLotsCostedByWrite(
  client: Client,
  args: {
    restaurantId: string;
    inventoryId: string;
    before: Set<string>;
    unitCost: number;
    basis: CostTaxBasis;
  },
  log?: Log,
): Promise<void> {
  const notRecorded = (why: string) =>
    log?.warn(
      `the cost of ${args.inventoryId} was recorded, but whether tax is inside it (${args.basis}) was not: ${why}`,
    );
  try {
    const { data, error } = await client
      .from("inventory_lots")
      .select("id, unit_cost, unit_cost_tax_basis")
      .eq("restaurant_id", args.restaurantId)
      .eq("inventory_id", args.inventoryId)
      .eq("stock_state", "live");
    if (error || !Array.isArray(data)) {
      notRecorded(error?.message ?? "its bottles could not be read");
      return;
    }
    const ids = data
      .filter(
        (l: { id: string; unit_cost: unknown; unit_cost_tax_basis: unknown }) =>
          !args.before.has(l.id) &&
          l.unit_cost != null &&
          costCents(l.unit_cost) === costCents(args.unitCost) &&
          l.unit_cost_tax_basis == null,
      )
      .map((l: { id: string }) => l.id);
    if (!ids.length) {
      notRecorded("no bottles this write costed were found");
      return;
    }
    const { error: stampError } = await client
      .from("inventory_lots")
      .update({ unit_cost_tax_basis: args.basis })
      .eq("restaurant_id", args.restaurantId)
      .in("id", ids);
    if (stampError) notRecorded(stampError.message);
  } catch (err: any) {
    notRecorded(err?.message ?? "unknown error");
  }
}
