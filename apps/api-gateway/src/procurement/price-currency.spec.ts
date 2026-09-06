/**
 * A recorded price names its own money — ADR 0117 Q25, founder 2026-09-05.
 *
 * WHAT WAS WRONG, AND HOW IT WAS PROVED
 * -------------------------------------
 * `restaurants.currency` said `USD` on all fourteen production houses, two of
 * them in Turkiye and one in London, because the column carried
 * `DEFAULT 'USD'` and no insert ever named it. The same fabricated answer was
 * about to be written onto every price: `own-paper-sighting.ts` read
 * `(input.currency ?? "USD")` and NEITHER caller passed a currency, and
 * `price_history` had no currency column at all.
 *
 * Proved against the pre-fix tree rather than argued. `git show
 * HEAD:apps/api-gateway/src/procurement/own-paper-sighting.ts` was written to a
 * same-depth probe file, imported beside the current module and run
 * (2026-09-05, `npx jest --testPathPattern "__prefix_probe_currency"`, 3/3):
 *
 *   PRE-FIX  currency: "USD"    <- a Turkish invoice stating no currency
 *   POST-FIX reason:   "No price sighting written for receipt_verified on order
 *                       ...: the currency is undefined. A number without its
 *                       currency is not a price ..."
 *
 * The probe was deleted afterwards. These tests hold the post-fix half of that
 * proof permanently; the pre-fix half cannot be committed without committing a
 * copy of the old file.
 */

import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { decideOwnPaperSighting } from "./own-paper-sighting";
import {
  agreementCurrencyClaim,
  invoiceCurrencyClaim,
  priceCurrency,
} from "./price-currency";
import {
  agreementCurrencyDefault,
  agreementCurrencyToRecord,
} from "./agreement-currency";

type Row = Record<string, any>;

const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";
const INVENTORY = "11111111-1111-4111-8111-111111111111";
const WINE = "55555555-5555-4555-8555-555555555555";

// ---------------------------------------------------------------------------
// The claim, on its own.
// ---------------------------------------------------------------------------
describe("priceCurrency", () => {
  it("records a stated code, folded to capitals", () => {
    const r = priceCurrency({
      kind: "stated",
      code: " try ",
      from: "the invoice for order 1",
    });
    expect(r.code).toBe("TRY");
    expect(r.reason).toBeNull();
    expect(r.note).toBeNull();
  });

  it("refuses a value that is not a code, and says which value", () => {
    const r = priceCurrency({
      kind: "stated",
      code: "$",
      from: "the invoice for order 1",
    });
    // NOT stored, and NOT silently dropped.
    expect(r.code).toBeNull();
    expect(r.reason).toContain('"$"');
    expect(r.reason).toContain("not a currency");
  });

  /*
   * MEMBERSHIP, NOT SHAPE (2026-09-06). `priceCurrency` asked `/^[A-Z]{3}$/`
   * and called the answer ISO 4217, so `ZZZ` was written to
   * `price_history.currency` as real money — and the four-way match then
   * compared a figure in it against a figure in a real currency.
   */
  it("refuses a well-formed code that names no currency, and names it", () => {
    for (const fake of ["ZZZ", "XTS", "ABC"]) {
      const r = priceCurrency({
        kind: "stated",
        code: fake,
        from: "the invoice for order 1",
      });
      expect(r.code).toBeNull();
      expect(r.reason).toContain(fake);
      expect(r.reason).toContain("is not a currency");
      expect(r.note).toContain(fake);
    }
  });

  it("records nothing for an unstated currency, and never USD", () => {
    const r = priceCurrency({
      kind: "unstated",
      because: "the agreement states no currency.",
    });
    expect(r.code).toBeNull();
    expect(r.reason).toContain("Currency not recorded");
    // The whole point: absence is not dollars.
    expect(r.code).not.toBe("USD");
  });

  it("names the missing column when an agreement states no currency", () => {
    const claim = agreementCurrencyClaim("order 7");
    expect(claim.kind).toBe("unstated");
    if (claim.kind !== "unstated") return;
    // A person reading the log can act on this: it names the table.
    expect(claim.because).toContain("procurement_order_items");
  });

  it("names the field when an invoice was keyed in without one", () => {
    const claim = invoiceCurrencyClaim(undefined, "order 7");
    expect(claim.kind).toBe("unstated");
    if (claim.kind !== "unstated") return;
    expect(claim.because).toContain("invoiceCurrency");
  });

  it("takes the invoice's code when the desk stated one", () => {
    const claim = invoiceCurrencyClaim("TRY", "order 7");
    expect(claim.kind).toBe("stated");
    if (claim.kind !== "stated") return;
    expect(claim.code).toBe("TRY");
  });
});

// ---------------------------------------------------------------------------
// The register refuses rather than inventing.
// ---------------------------------------------------------------------------
describe("the price register refuses a sighting with no currency", () => {
  const base = {
    restaurantId: REST,
    orderId: ORDER,
    providerId: "prov-1",
    vendorName: "Kavaklidere",
    masterWineId: WINE,
    productName: "Ancyra Kalecik Karasi",
    source: "receipt_verified" as const,
    unitPrice: 240,
    unitLabel: "case",
    packSize: 12,
    unitVolumeMl: 750,
    observedAt: "2026-09-04T10:00:00.000Z",
  };

  it("refuses when the paper stated none", () => {
    const d = decideOwnPaperSighting({ ...base, currency: undefined });
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toContain("A number without its currency is not a price");
  });

  it("refuses a currency that is not an ISO 4217 code", () => {
    for (const bad of ["$", "usd dollars", "TL", "US$", ""]) {
      const d = decideOwnPaperSighting({ ...base, currency: bad });
      expect(d.write).toBe(false);
    }
  });

  /*
   * MEMBERSHIP, NOT SHAPE (2026-09-06). Every code below passes
   * `/^[A-Z]{3}$/`, which is what this path asked until today, so `ZZZ` was
   * written into `vendor_price_observations.currency` — the register every
   * price reader joins on. A denomination that does not exist in the ladder is
   * invisible in exactly the way a wrong USD is.
   */
  it("refuses a well-formed code that names no currency", () => {
    for (const fake of ["ZZZ", "XTS", "XTT", "QQQ"]) {
      const d = decideOwnPaperSighting({ ...base, currency: fake });
      expect(d.write).toBe(false);
      if (d.write) return;
      expect(d.reason).toContain(fake);
    }
  });

  it("admits the document's own code, folded to capitals", () => {
    const d = decideOwnPaperSighting({ ...base, currency: "try" });
    expect(d.write).toBe(true);
    if (!d.write) return;
    expect(d.row.currency).toBe("TRY");
  });

  it("never substitutes the house's reporting currency", () => {
    // The scenario that started this: a house whose row says USD, holding a
    // Turkish invoice. The register must not read the house's column.
    const d = decideOwnPaperSighting({ ...base, currency: "TRY" });
    expect(d.write).toBe(true);
    if (!d.write) return;
    expect(d.row.currency).not.toBe("USD");
  });
});

// ---------------------------------------------------------------------------
// The series records the gap instead of hiding it.
// ---------------------------------------------------------------------------
function makeDb(opts: { orderRow?: Row | null; orderLineRow?: Row | null }) {
  const calls = { sightingInserts: [] as Row[], priceHistoryInserts: [] as Row[] };

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
              bottle_size_ml: 750,
              wine_name: "Ancyra Kalecik Karasi",
              shadow_stock: 0,
              in_transit_quantity: 0,
            },
            error: null,
          };
        }
        if (table === "vendor_price_observations") {
          if (selectedColumns.trim() === "id") return { data: null, error: null };
          return { data: [], error: null };
        }
        return { data: shape === "many" ? [] : null, error: null };
      };

      const q: any = {
        select(cols?: string) {
          if (op === "select" && typeof cols === "string") selectedColumns = cols;
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

  const db = {
    supabase,
    getClient: () => supabase,
    client: supabase,
  } as unknown as DatabaseService;
  return { db, calls };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

const turkishHouseOrder = {
  id: ORDER,
  order_number: "ORD-2026-00042",
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
  providers: { name: "Kavaklidere", contact_email: null },
};

// A line that STATES its price unit, so ADR 0119 Q4's unit rule admits the
// series row and the currency rule is the only thing under test here.
const statedLine = {
  unit_type: "bottle",
  bottles_per_unit: 1,
  price_uom: "bottle",
  price_pack_size: 1,
};

/** The same line, with the currency the desk confirmed on the sheet (Q31). */
const statedLineInLira = { ...statedLine, currency: "TRY", final_unit_price: 36 };

describe("price_history records the currency, or records that it has none", () => {
  it("writes the invoice's own code when the desk stated one", async () => {
    const { db, calls } = makeDb({ orderRow: turkishHouseOrder });

    await new ProcurementService(db, events, ledger).verifyReceipt(
      REST,
      ORDER,
      USER,
      {
        invoiceQuantity: 10,
        invoiceUnitPrice: 40,
        acceptedQuantity: 10,
        invoiceCurrency: "TRY",
      } as any,
    );

    expect(calls.priceHistoryInserts).toHaveLength(1);
    expect(calls.priceHistoryInserts[0].currency).toBe("TRY");
    // The house's own column is never read on this path — the number came off
    // the vendor's paper and carries the vendor's money.
    expect(calls.priceHistoryInserts[0].currency).not.toBe("USD");
  });

  it("writes NULL, not USD, when the invoice was keyed in without one", async () => {
    const { db, calls } = makeDb({ orderRow: turkishHouseOrder });

    await new ProcurementService(db, events, ledger).verifyReceipt(
      REST,
      ORDER,
      USER,
      {
        invoiceQuantity: 10,
        invoiceUnitPrice: 40,
        acceptedQuantity: 10,
      } as any,
    );

    expect(calls.priceHistoryInserts).toHaveLength(1);
    // NOT RECORDED. The observation is kept because it is real; the currency is
    // absent because nobody stated it, and the two facts are both on the row.
    expect(calls.priceHistoryInserts[0].currency).toBeNull();
    expect(calls.priceHistoryInserts[0].notes).toContain("Currency not recorded");
    // And the register, which cannot hold a null, holds nothing at all.
    expect(calls.sightingInserts).toHaveLength(0);
  });

  it("writes the agreement's price with NULL currency, because no column states one", async () => {
    const { db, calls } = makeDb({
      orderRow: turkishHouseOrder,
      orderLineRow: statedLine,
    });

    await new ProcurementService(db, events, ledger).confirmDeal(REST, ORDER, {
      finalPrice: 36,
      sendConfirmation: false,
    });

    // The unit IS stated on this line, so the series row is written — which is
    // what makes this a test of the currency rule and not of ADR 0119's.
    expect(calls.priceHistoryInserts).toHaveLength(1);
    expect(calls.priceHistoryInserts[0].unit).toBe("bottle");
    expect(calls.priceHistoryInserts[0].currency).toBeNull();
    expect(calls.priceHistoryInserts[0].notes).toContain("Currency not recorded");
    // The register refuses it: NOT NULL leaves no way to say "not recorded".
    expect(calls.sightingInserts).toHaveLength(0);
  });

  it("names the currency key explicitly even when the value is null", async () => {
    const { db, calls } = makeDb({ orderRow: turkishHouseOrder });

    await new ProcurementService(db, events, ledger).verifyReceipt(
      REST,
      ORDER,
      USER,
      { invoiceQuantity: 10, invoiceUnitPrice: 40, acceptedQuantity: 10 } as any,
    );

    // A conditional spread would leave the key off, and the capture-contract
    // guard reads write payloads without executing them: a column it cannot see
    // named is a column it cannot check.
    expect(Object.keys(calls.priceHistoryInserts[0])).toContain("currency");
  });
});

// ---------------------------------------------------------------------------
// ADR 0117 Q31 — the agreement line names its money.
// ---------------------------------------------------------------------------
describe("the agreement's own currency reaches both registers", () => {
  it("records the line's currency on the series and ADMITS the sighting", async () => {
    const { db, calls } = makeDb({
      orderRow: turkishHouseOrder,
      orderLineRow: statedLineInLira,
    });

    await new ProcurementService(db, events, ledger).confirmDeal(REST, ORDER, {
      finalPrice: 36,
      sendConfirmation: false,
    });

    expect(calls.priceHistoryInserts).toHaveLength(1);
    expect(calls.priceHistoryInserts[0].currency).toBe("TRY");
    expect(calls.priceHistoryInserts[0].notes).not.toContain(
      "Currency not recorded",
    );

    // THE BEHAVIOUR THIS QUESTION EXISTED TO RESTORE. Before Q31 the agreement
    // had no currency column, so `own-paper-sighting`'s refusal — correct, and
    // the right call — meant NO class-A sighting was ever written for a
    // confirmed order. With the column, a stated line is admitted again.
    expect(calls.sightingInserts).toHaveLength(1);
    expect(calls.sightingInserts[0].currency).toBe("TRY");
    expect(calls.sightingInserts[0].source_type).toBe("quote");
    expect(calls.sightingInserts[0].trust_tier).toBe(2);
  });

  it("still refuses when the desk stated no currency on the line", async () => {
    const { db, calls } = makeDb({
      orderRow: turkishHouseOrder,
      orderLineRow: statedLine,
    });

    await new ProcurementService(db, events, ledger).confirmDeal(REST, ORDER, {
      finalPrice: 36,
      sendConfirmation: false,
    });

    expect(calls.priceHistoryInserts[0].currency).toBeNull();
    expect(calls.sightingInserts).toHaveLength(0);
  });

  it("never inherits the house's currency onto the line", async () => {
    // The house is USD on its own row in this fixture's world. A line that
    // states nothing must not come out USD.
    const { db, calls } = makeDb({
      orderRow: turkishHouseOrder,
      orderLineRow: { ...statedLine, currency: null },
    });

    await new ProcurementService(db, events, ledger).confirmDeal(REST, ORDER, {
      finalPrice: 36,
      sendConfirmation: false,
    });

    expect(calls.priceHistoryInserts[0].currency).not.toBe("USD");
    expect(calls.priceHistoryInserts[0].currency).toBeNull();
  });
});

describe("agreementCurrencyDefault — the sheet's stated default", () => {
  it("prefers what this vendor last billed this house in", () => {
    const d = agreementCurrencyDefault({
      vendorPaperCurrency: "TRY",
      vendorName: "Kavaklidere",
      houseCurrency: "USD",
    });
    expect(d.code).toBe("TRY");
    expect(d.basis).toBe("vendor_paper");
    // The sentence names the evidence, not just the answer — a person can
    // check "your last invoice was in TRY"; they cannot check "we suggest TRY".
    expect(d.sentence).toContain("Kavaklidere");
    expect(d.sentence).toContain("last billed");
  });

  it("falls back to the house's reporting currency, and says which rung", () => {
    const d = agreementCurrencyDefault({
      vendorPaperCurrency: null,
      houseCurrency: "GBP",
    });
    expect(d.code).toBe("GBP");
    expect(d.basis).toBe("house");
    expect(d.sentence).toContain("this house reports in");
  });

  it("offers NOTHING when the house has not recorded a currency either", () => {
    // Live after ADR 0117 Q30 cleared every unattributable USD to NULL. A
    // fallback here would quietly refill exactly what that pass emptied.
    const d = agreementCurrencyDefault({
      vendorPaperCurrency: null,
      houseCurrency: null,
    });
    expect(d.code).toBeNull();
    expect(d.basis).toBeNull();
    expect(d.sentence).toContain("currency not recorded");
  });

  it("refuses a malformed code from either rung rather than passing it on", () => {
    expect(
      agreementCurrencyDefault({ vendorPaperCurrency: "TL", houseCurrency: "US$" })
        .code,
    ).toBeNull();
    // A lower-case code off the wire is folded, not rejected.
    expect(
      agreementCurrencyDefault({ vendorPaperCurrency: " try ", houseCurrency: null })
        .code,
    ).toBe("TRY");
  });

  /*
   * MEMBERSHIP, NOT SHAPE (2026-09-06). `ZZZ` passes `/^[A-Z]{3}$/`, so it was
   * offered on the sheet as a default and written onto agreement lines.
   */
  it("refuses a well-formed non-currency from any rung", () => {
    expect(
      agreementCurrencyDefault({
        vendorUsualCurrency: "ZZZ",
        vendorPaperCurrency: "XTS",
        houseCurrency: "ABC",
      }).code,
    ).toBeNull();
  });

  it("NAMES a refused code rather than reporting it as an absence", () => {
    // "Nobody has stated one" is false about a profile that plainly holds ZZZ,
    // and it sends a manager to an empty field that is not empty.
    const d = agreementCurrencyDefault({
      vendorUsualCurrency: "ZZZ",
      vendorPaperCurrency: null,
      houseCurrency: null,
    });
    expect(d.code).toBeNull();
    expect(d.sentence).toContain("ZZZ");
    expect(d.sentence).toContain("not a currency this system knows");
  });
});

describe("agreementCurrencyToRecord — untouched, changed, or refused", () => {
  it("takes the offered default when the person did not touch the field", () => {
    expect(agreementCurrencyToRecord(null, "TRY")).toBe("TRY");
    expect(agreementCurrencyToRecord(undefined, "TRY")).toBe("TRY");
  });

  it("takes the person's change", () => {
    expect(agreementCurrencyToRecord("EUR", "TRY")).toBe("EUR");
  });

  it("records nothing for an explicit empty answer", () => {
    // '' is "not now", and it is DIFFERENT from untouched. Collapsing the two
    // is what lets a default be written as though somebody chose it.
    expect(agreementCurrencyToRecord("", "TRY")).toBeNull();
  });
});
