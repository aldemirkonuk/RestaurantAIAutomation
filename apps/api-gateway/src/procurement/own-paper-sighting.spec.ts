/**
 * The house's own paper reaching the PRICE REGISTER.
 *
 * `price_history` has had two writers since 2026-09-01 and
 * `vendor_price_observations` has had none for a class-A price, so every reader
 * of prices — the market box, the beverage register's quote line, the market
 * producer — has been looking at a table the house's own invoices never enter
 * (ADR 0117). These tests are the proof that the mirror writes, that it refuses
 * rather than defaults, that it does not write twice, and that a ladder built
 * from own-paper rows can actually find a price below its average.
 *
 * The `priceBelowAverage` case at the end is the one that matters: it runs the
 * real reader over the rows the real writer produced, so a payload that is
 * merely well-shaped but unreadable by the comparison would still fail.
 */

import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import {
  decideOwnPaperSighting,
  isOutlierAgainstPriors,
  MIN_OUTLIER_SAMPLE,
} from "./own-paper-sighting";
import { priceBelowAverage } from "../vendor-intel/price-below-average";

type Row = Record<string, any>;

const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";
const INVENTORY = "11111111-1111-4111-8111-111111111111";
const WINE = "55555555-5555-4555-8555-555555555555";

interface Calls {
  sightingInserts: Row[];
  priceHistoryInserts: Row[];
}

function makeDb(opts: {
  orderRow?: Row | null;
  orderLineRow?: Row | null;
  /** `restaurant_inventory` as this shelf slot really is. */
  bottleSizeMl?: number | null;
  /** Rows already on the register for this wine. */
  existingSightings?: Row[];
}) {
  const calls: Calls = { sightingInserts: [], priceHistoryInserts: [] };
  const existing = opts.existingSightings ?? [];

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";
      let selectedColumns = "";
      const filters: Record<string, any> = {};

      const settle = (shape: "one" | "many"): Row => {
        if (table === "procurement_orders") {
          if (op === "update") return { data: opts.orderRow ?? {}, error: null };
          return { data: opts.orderRow ?? null, error: null };
        }
        if (table === "procurement_order_items")
          return { data: opts.orderLineRow ?? null, error: null };

        if (table === "restaurant_inventory") {
          if (selectedColumns.trim() === "id")
            return { data: { id: filters.id }, error: null };
          return {
            data: {
              master_wine_id: WINE,
              bottle_size_ml:
                "bottleSizeMl" in opts ? opts.bottleSizeMl : 750,
              wine_name: "Barolo Riserva",
              shadow_stock: 0,
              in_transit_quantity: 0,
            },
            error: null,
          };
        }

        if (table === "vendor_price_observations") {
          // The idempotency probe: select("id") by source_ref + content_hash.
          if (selectedColumns.trim() === "id") {
            const hit = [...existing, ...calls.sightingInserts].find(
              (r) =>
                r.source_ref === filters.source_ref &&
                r.content_hash === filters.content_hash,
            );
            return { data: hit ? { id: "existing" } : null, error: null };
          }
          // The outlier population read.
          return {
            data: existing.filter((r) => r.master_wine_id === WINE),
            error: null,
          };
        }

        return { data: shape === "many" ? [] : null, error: null };
      };

      const q: any = {
        select(cols?: string) {
          if (op === "select" && typeof cols === "string")
            selectedColumns = cols;
          return q;
        },
        eq(col: string, value: any) {
          filters[col] = value;
          return q;
        },
        neq: () => q,
        not: () => q,
        or: () => q,
        in: () => q,
        is: () => q,
        gt: () => q,
        gte: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        insert(payload: Row) {
          op = "insert";
          if (table === "price_history") calls.priceHistoryInserts.push(payload);
          if (table === "vendor_price_observations")
            calls.sightingInserts.push(payload);
          return q;
        },
        update() {
          op = "update";
          return q;
        },
        delete: () => {
          op = "delete";
          return q;
        },
        single: async () => settle("one"),
        maybeSingle: async () => settle("one"),
        then: (res: any, rej: any) =>
          Promise.resolve(settle("many")).then(res, rej),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({}) },
  };

  const db = { supabase, getClient: () => supabase, client: supabase } as unknown as DatabaseService;
  return { db, calls };
}

const events = { createEvent: jest.fn().mockResolvedValue({}) } as unknown as EventsService;
const ledger = { recordTransaction: jest.fn().mockResolvedValue({}) } as unknown as InventoryLedgerService;

function service(db: DatabaseService) {
  return new ProcurementService(db, events, ledger);
}

const deliveredOrder = {
  id: ORDER,
  order_number: "ORD-2026-00001",
  restaurant_id: REST,
  inventory_id: INVENTORY,
  provider_id: "prov-1",
  quantity: 10,
  bottles_total: 10,
  unit_type: "bottle",
  final_price: 40,
  quantity_received: 10,
  status: "DELIVERED",
  delivery_notes: null,
  providers: { name: "Vinos Iberia", contact_email: null },
};

// The PO price and the invoice price agree: a divergence is refused with a 422
// before any of this runs (`procurement.service.ts:3062`), which is correct and
// is a different test's subject.
const verifyBody = {
  invoiceQuantity: 10,
  invoiceUnitPrice: 40,
  acceptedQuantity: 10,
  // ADR 0117 Q25, founder 2026-09-05. This key was absent until then, and the
  // module supplied `?? "USD"` behind it: every sighting in this suite asserted
  // dollars and every one of them passed. A currency the desk did not state is
  // now a refusal, so the happy path has to state one — which is the point.
  invoiceCurrency: "TRY",
} as any;

// ---------------------------------------------------------------------------
// Both paths write a sighting, with the provenance ADR 0117 requires.
// ---------------------------------------------------------------------------
describe("own paper reaches vendor_price_observations", () => {
  it("a verified receipt writes one tier-1 invoice sighting", async () => {
    const { db, calls } = makeDb({ orderRow: deliveredOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, verifyBody);

    expect(calls.priceHistoryInserts).toHaveLength(1);
    expect(calls.sightingInserts).toHaveLength(1);
    const row = calls.sightingInserts[0];

    // Tenancy: never null. A null restaurant_id publishes this house's invoice
    // price into every other tenant's market box.
    expect(row.restaurant_id).toBe(REST);
    expect(row.source_type).toBe("invoice");
    expect(row.trust_tier).toBe(1);
    expect(row.source_ref).toBe(`receipt_verified:${ORDER}`);
    expect(row.master_wine_id).toBe(WINE);
    expect(row.provider_id).toBe("prov-1");
    // The invoice's own number, in the invoice's own unit — not the landed
    // per-bottle figure price_history got.
    expect(row.raw_price).toBe(40);
    expect(row.pack_size).toBe(1);
    expect(row.unit_volume_ml).toBe(750);
    // The INVOICE's currency, off the invoice — not the house's, and not USD.
    // Before ADR 0117 Q25 (2026-09-05) this line read `toBe("USD")` and passed
    // while `verifyBody` stated no currency at all: `own-paper-sighting.ts`
    // supplied `?? "USD"`. Proved against the pre-fix file, which stamps USD on
    // this same Turkish invoice — see `own-paper-currency.spec.ts`.
    expect(row.currency).toBe("TRY");
    expect(typeof row.content_hash).toBe("string");
    expect(row.is_outlier).toBe(false);
    // observed_at is the verification's own moment, and effective_date agrees.
    expect(row.observed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.effective_date).toBe(row.observed_at.slice(0, 10));
  });

  it("a confirmed order writes one tier-2 quote sighting", async () => {
    const { db, calls } = makeDb({
      orderRow: deliveredOrder,
      orderLineRow: { unit_type: "bottle", bottles_per_unit: 1 },
    });

    await service(db).confirmDeal(REST, ORDER, {
      finalPrice: 36,
      sendConfirmation: false,
    });

    // CHANGED BY ADR 0117 Q25 (founder, 2026-09-05), and this is the cost of
    // that decision written down rather than argued away.
    //
    // Until then this asserted one tier-2 quote sighting with every field the
    // register wants. It was written because the module supplied `?? "USD"` for
    // the currency nobody had stated. Measured on this tree, NOTHING on an
    // agreement states a currency: neither `procurement_orders` nor
    // `procurement_order_items` has the column. So the number was real, its
    // pack size was real, its date was real, and its currency was invented — on
    // a house that may be in Fethiye.
    //
    // `vendor_price_observations.currency` is NOT NULL, so the register can
    // record the code or refuse the row; there is no third option. It refuses,
    // in the sentence below, exactly as the class-D sweep already refuses
    // `currency_unstated`. The agreement path gets its sighting back the day the
    // agreement line names its currency — a founder question, not an assumption.
    expect(calls.sightingInserts).toHaveLength(0);

    // `price_history` is empty here too, and for a DIFFERENT and earlier
    // reason: this order line states no `price_uom`, so ADR 0119 Q4's unit rule
    // refuses the series row before the currency is ever considered. The two
    // refusals are kept apart deliberately — `price-currency.spec.ts` runs the
    // same path with a STATED unit and shows the series row being written with
    // `currency: null`, which is the currency rule on its own.
    expect(calls.priceHistoryInserts).toHaveLength(0);
  });

  it("writes no sighting for an order priced by the case, and says why", async () => {
    // The line, not the header, is where a pack size lives
    // (`procurement_orders` has no bottles_per_unit column at all), so an order
    // whose LINE says twelve-per-case resolves to a pack of 12 here.
    //
    // Nothing on `procurement_orders` states the unit of `final_price`
    // separately from the order's own unit, so a 36 against a case of 12 could
    // be $36 a bottle or $3 a bottle and the register cannot tell. It is
    // refused.
    //
    // CHANGED BY ADR 0119 Q4 (founder, 2026-09-05). Until then this test also
    // asserted that `price_history` STILL took the number "on its own inherited
    // per-bottle claim" — the inherited claim being precisely the hardcoded
    // `unit = 'BOTTLE'`. The series now carries a STATED unit, so an agreement
    // whose line states none is refused by BOTH registers, for the same reason,
    // and the two stop disagreeing about what the same event was.
    const { db, calls } = makeDb({
      orderRow: deliveredOrder,
      orderLineRow: { unit_type: "case", bottles_per_unit: 12 },
    });
    const svc = service(db);
    const logged: string[] = [];
    jest.spyOn((svc as any).logger, "warn").mockImplementation((...a: any[]) => {
      logged.push(String(a[0]));
    });

    await svc.confirmDeal(REST, ORDER, {
      finalPrice: 36,
      sendConfirmation: false,
    });

    expect(calls.priceHistoryInserts).toHaveLength(0);
    expect(calls.sightingInserts).toHaveLength(0);
    expect(
      logged.some(
        (l) => l.includes("the pack size is null") && l.includes('"case"'),
      ),
    ).toBe(true);
    // And the series says why, in its own words rather than by omission.
    expect(
      logged.some(
        (l) =>
          l.includes("No price_history row written") &&
          l.includes("states no unit for its price"),
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // A missing unit is a refusal in words, not a 750.
  // -------------------------------------------------------------------------
  it("writes nothing and says why when the item has no bottle volume", async () => {
    const { db, calls } = makeDb({
      orderRow: deliveredOrder,
      bottleSizeMl: null,
    });
    const svc = service(db);
    const logged: string[] = [];
    jest
      .spyOn((svc as any).logger, "warn")
      .mockImplementation((...a: any[]) => {
        logged.push(String(a[0]));
      });

    await svc.verifyReceipt(REST, ORDER, USER, verifyBody);

    // price_history still lands: it is a per-bottle series that does not need
    // the volume. The REGISTER does, and refuses.
    expect(calls.priceHistoryInserts).toHaveLength(1);
    expect(calls.sightingInserts).toHaveLength(0);
    expect(
      logged.some(
        (l) =>
          l.includes("no bottle volume is recorded") &&
          l.includes("Refusing rather than assuming 750ml"),
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Re-verifying the same receipt is not new evidence.
  // -------------------------------------------------------------------------
  it("does not write a second row when the same receipt is verified again", async () => {
    const { db, calls } = makeDb({ orderRow: deliveredOrder });
    const svc = service(db);

    await svc.verifyReceipt(REST, ORDER, USER, verifyBody);
    await svc.verifyReceipt(REST, ORDER, USER, verifyBody);

    expect(calls.priceHistoryInserts).toHaveLength(2);
    expect(calls.sightingInserts).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // is_outlier, written by the MAD test, against a seeded history.
  // -------------------------------------------------------------------------
  it("flags a sighting the MAD test finds far from the seeded history", async () => {
    const seeded = [18, 18.5, 19, 18.2, 18.8].map((p, i) => ({
      master_wine_id: WINE,
      raw_price: p,
      source_type: "invoice",
      observed_at: `2026-08-0${i + 1}T00:00:00.000Z`,
      pack_size: 1,
      unit_volume_ml: 750,
      yield_factor: 1,
    }));
    const { db, calls } = makeDb({
      orderRow: { ...deliveredOrder, final_price: 380 },
      existingSightings: seeded,
    });

    // 380 rather than 38: the decimal-lost parse the engine's own docblock
    // names as the failure that looks most like a bargain.
    await service(db).verifyReceipt(REST, ORDER, USER, {
      ...verifyBody,
      invoiceUnitPrice: 380,
    });

    expect(calls.sightingInserts).toHaveLength(1);
    expect(calls.sightingInserts[0].is_outlier).toBe(true);
  });

  it("does not flag an ordinary price against the same history", async () => {
    const seeded = [18, 18.5, 19, 18.2, 18.8].map((p, i) => ({
      master_wine_id: WINE,
      raw_price: p,
      source_type: "invoice",
      observed_at: `2026-08-0${i + 1}T00:00:00.000Z`,
      pack_size: 1,
      unit_volume_ml: 750,
      yield_factor: 1,
    }));
    const { db, calls } = makeDb({
      orderRow: { ...deliveredOrder, final_price: 18.4 },
      existingSightings: seeded,
    });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      ...verifyBody,
      invoiceUnitPrice: 18.4,
    });

    expect(calls.sightingInserts[0].is_outlier).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The pure decisions, without a database.
// ---------------------------------------------------------------------------
describe("decideOwnPaperSighting", () => {
  const base = {
    restaurantId: REST,
    orderId: ORDER,
    providerId: "prov-1",
    vendorName: "Vinos Iberia",
    masterWineId: WINE,
    productName: "Barolo Riserva",
    source: "receipt_verified" as const,
    unitPrice: 240,
    unitLabel: "case",
    packSize: 12,
    unitVolumeMl: 750,
    observedAt: "2026-09-04T10:00:00.000Z",
    // Stated, because a sighting without a stated currency is now refused (ADR
    // 0117 Q25). Before 2026-09-05 this key was absent from every case here and
    // the module supplied `?? "USD"`, which is exactly the defect: the fixture
    // asserted dollars and nobody had to notice.
    currency: "EUR",
  };

  it("keeps the case price unconverted and normalises it for the ladder", () => {
    const d = decideOwnPaperSighting(base);
    expect(d.write).toBe(true);
    if (!d.write) return;
    // The row carries what the paper said.
    expect(d.row.raw_price).toBe(240);
    expect(d.row.pack_size).toBe(12);
    // The ladder gets the conversion, done once, by the engine.
    expect(d.normalizedUnitPrice).toBeCloseTo(20, 6);
  });

  it("refuses a tenant-less sighting", () => {
    const d = decideOwnPaperSighting({ ...base, restaurantId: null });
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toContain("names no restaurant");
  });

  it("refuses a sighting that names no order", () => {
    // `source_ref` is `<source>:<orderId>`, and it is half the idempotency key
    // as well as the whole audit trail. With no order id there is nothing to
    // trace the number back to and nothing to dedupe on.
    const d = decideOwnPaperSighting({ ...base, orderId: null });
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toContain("names no order");
  });

  it("refuses a whitespace-only order id, not just a null one", () => {
    const d = decideOwnPaperSighting({ ...base, orderId: "   " });
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toContain("names no order");
  });

  it.each([
    ["zero", 0],
    ["negative", -12],
    ["absent", null],
    ["not a number", "free" as any],
  ])("refuses a %s price rather than averaging it in", (_label, unitPrice) => {
    const d = decideOwnPaperSighting({ ...base, unitPrice });
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toContain("the price is");
    expect(d.reason).toContain("not an");
  });

  it("refuses a missing pack size and names the unit it was stated in", () => {
    const d = decideOwnPaperSighting({ ...base, packSize: null });
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toContain("pack size");
    expect(d.reason).toContain('"case"');
  });

  it("refuses an undated sighting rather than stamping it with now()", () => {
    const d = decideOwnPaperSighting({ ...base, observedAt: null });
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toContain("observation date");
  });

  it("hashes identically for identical figures and differently for a new price", () => {
    const a = decideOwnPaperSighting(base);
    const b = decideOwnPaperSighting(base);
    const c = decideOwnPaperSighting({ ...base, unitPrice: 239 });
    if (!a.write || !b.write || !c.write) throw new Error("expected writes");
    expect(a.contentHash).toBe(b.contentHash);
    // A corrected price IS new evidence — the disagreement is the information.
    expect(c.contentHash).not.toBe(a.contentHash);
  });
});

describe("isOutlierAgainstPriors", () => {
  it("declines to judge a group smaller than the sample floor", () => {
    // Two unequal values: the MAD-is-zero branch would call BOTH outliers, and
    // the filter on is_outlier would erase a house's first two invoices.
    expect(isOutlierAgainstPriors([20], 400)).toBe(false);
    expect(MIN_OUTLIER_SAMPLE).toBeGreaterThan(2);
  });

  it("flags a decimal-lost price once the group is big enough", () => {
    expect(isOutlierAgainstPriors([20, 20.5, 19.8, 20.2], 200)).toBe(true);
    expect(isOutlierAgainstPriors([20, 20.5, 19.8, 20.2], 20.1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The reader, over the writer's own rows.
// ---------------------------------------------------------------------------
describe("priceBelowAverage over own-paper rows", () => {
  it("reads all five own-paper rows and classes every one of them as quoted", () => {
    // What this proves: the payload the mirror writes is LEGIBLE to the real
    // reader — every row carries a product key it can group on, a price it can
    // normalise, and a `source_type` its class rule recognises. That is the
    // integration this writer is responsible for.
    //
    // What it deliberately does NOT assert: the ranked `items`. As of
    // 2026-09-04 `priceBelowAverage` is being rewritten in this same worktree
    // by another session (ADR 0117 rule 6, the source-class partition), and its
    // group key is joined with a NUL byte
    // (`price-below-average.ts:252`) while the loop that splits it back apart
    // calls `groupKey.lastIndexOf(" ")` — a SPACE — at `:298`. `lastIndexOf`
    // returns -1, the product key is sliced to `groupKey.slice(0, -1)` and the
    // class to garbage, so EVERY group falls out as `unrecognisedClass` and
    // `items` is always empty. That file's own spec is red for the same reason.
    // It is not this module's file and not this module's defect; asserting
    // through it would only mean this test goes green when someone else fixes
    // their split.
    const rows = [30, 29.5, 30.5, 30].map((price, i) =>
      row(price, `2026-08-1${i}T00:00:00.000Z`),
    );
    rows.push(row(24, "2026-08-20T00:00:00.000Z"));

    const result = priceBelowAverage(rows as any, { minObservations: 3 });

    expect(result.scanned.observations).toBe(5);
    expect(result.scanned.products).toBe(1);
    // Nothing was dropped for a reason the WRITER controls.
    expect(result.skipped.noProductKey).toBe(0);
    expect(result.skipped.unnormalisable).toBe(0);
    // Own paper is class "quoted", never the tier-4 public-site line.
    expect((result as any).byClass).toEqual({ quoted: 5 });
  });

  it("produces prices whose arithmetic is a real drop below the earlier mean", () => {
    // The comparison itself, computed over the normalised prices the mirror
    // actually writes, so the claim "a comparison over own-paper rows finds a
    // below-average sighting" is proven on this module's own output rather than
    // on a reader that is mid-rewrite.
    const prices = [30, 29.5, 30.5, 30].map(
      (p) => normalised(p),
    );
    const latest = normalised(24);
    const average = prices.reduce((a, b) => a + b, 0) / prices.length;

    expect(prices).toHaveLength(4); // four EARLIER, the bar minObservations: 3
    expect(latest).toBeLessThan(average);
    expect((average - latest) / average).toBeGreaterThan(0.15);
  });

  function normalised(price: number): number {
    const d = decideOwnPaperSighting({
      restaurantId: REST,
      orderId: ORDER,
      providerId: "prov-1",
      vendorName: "Vinos Iberia",
      masterWineId: WINE,
      productName: "Barolo Riserva",
      source: "receipt_verified",
      unitPrice: price,
      unitLabel: "bottle",
      packSize: 1,
      unitVolumeMl: 750,
      observedAt: "2026-08-20T00:00:00.000Z",
      currency: "EUR",
    });
    if (!d.write) throw new Error(d.reason);
    return d.normalizedUnitPrice;
  }

  function row(price: number, observedAt: string) {
    // Exactly the payload the mirror writes, read back through the same column
    // names `belowTrailingAverage` selects.
    const d = decideOwnPaperSighting({
      restaurantId: REST,
      orderId: ORDER,
      providerId: "prov-1",
      vendorName: "Vinos Iberia",
      masterWineId: WINE,
      productName: "Barolo Riserva",
      source: "receipt_verified",
      unitPrice: price,
      unitLabel: "bottle",
      packSize: 1,
      unitVolumeMl: 750,
      observedAt,
      currency: "EUR",
    });
    if (!d.write) throw new Error(d.reason);
    return {
      master_wine_id: d.row.master_wine_id,
      signature_hash: null,
      product_name_raw: d.row.product_name_raw,
      vendor_name_raw: d.row.vendor_name_raw,
      provider_id: d.row.provider_id,
      source_type: d.row.source_type,
      observed_at: d.row.observed_at,
      raw_price: d.row.raw_price,
      currency: d.row.currency,
      pack_size: d.row.pack_size,
      unit_volume_ml: d.row.unit_volume_ml,
      yield_factor: 1,
    };
  }
});
