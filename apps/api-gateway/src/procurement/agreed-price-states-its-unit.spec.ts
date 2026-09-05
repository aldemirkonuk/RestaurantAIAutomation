/**
 * ADR 0119 phase 1 — the agreed price states its unit.
 *
 * The defect, in one sentence: `procurement_order_items` stated the unit of its
 * QUANTITY and nothing about the unit of its PRICE, so a case price and a
 * bottle price were the same row, and every reader guessed per-bottle by
 * arithmetic. `20260905010000_an_agreed_price_states_its_unit.sql` adds
 * `price_uom`/`price_pack_size`; this file is the code half's proof.
 *
 * HOW THE PRE-FIX PROOF IS DONE HERE
 * ----------------------------------
 * `git stash` wiped 73 uncommitted files from this shared worktree on
 * 2026-09-04, so nothing below reverts anything. The pre-fix behaviours are
 * TRANSCRIBED VERBATIM from copies made with
 * `git show HEAD:<path> > <scratch>` at `129fbfc6`:
 *
 *   * `preFixSentence` — `procurement.service.ts:186-216` at HEAD (the phase-0
 *     builder, which reads the QUANTITY's unit because that was all there was).
 *   * `preFixOrderTotal` — `procurement.service.ts:529` at HEAD
 *     (`dto.totalCost ?? finalPrice * bottlesTotal`) and the identical line
 *     total at `:879-881`.
 *   * `preFixSightingOperands` — `procurement.service.ts:4952-4972` at HEAD
 *     (`packSize: bottlesPerConfirmedUnit === 1 ? 1 : null`).
 *
 * `decideOwnPaperSighting` itself is UNCHANGED by this pass and is used as the
 * live function in both directions, which is the strongest form available: the
 * same refusal engine accepts the post-fix operands and refuses the pre-fix
 * ones, so the change is proven to be in what the caller states, not in what
 * the register was talked into.
 */

import {
  PRICE_UOM_TYPES,
  agreedOrderTotal,
  describeAgreedPrice,
  perBottleFromAgreedPrice,
  readStatedPriceUnit,
  resolveStatedPriceUnit,
  unstatedPriceUnitSentence,
} from "./agreed-price";
import { ORDER_UNIT_TYPES } from "./order-units";
import { decideOwnPaperSighting } from "./own-paper-sighting";
import { describeConfirmedOrderTerms } from "./procurement.service";

// ---------------------------------------------------------------------------
// The pre-fix tree, transcribed. Nothing here is imported from the working copy.
// ---------------------------------------------------------------------------

/** `procurement.service.ts:186-216` at `129fbfc6`. */
function preFixSentence(input: {
  quantity: number;
  unitType: string | null;
  bottlesPerUnit: number | null;
  wineName: string;
  finalPrice: number | null;
}): string {
  const unit = (input.unitType ?? "").trim() || "unit";
  const isBottle = unit === "bottle";
  const pack = input.bottlesPerUnit;
  const packKnown = pack != null && Number.isFinite(pack) && pack > 0;
  const quantityPhrase =
    `${input.quantity} ${unit}${input.quantity === 1 ? "" : "s"}` +
    (!isBottle && packKnown
      ? ` (${pack} bottle${pack === 1 ? "" : "s"} each)`
      : "");
  const priceLine =
    input.finalPrice != null
      ? ` at $${Number(input.finalPrice).toFixed(2)} per ${unit}`
      : "";
  const packNote =
    isBottle || packKnown
      ? ""
      : ` Our records do not state how many bottles are in a ${unit}, so please confirm the pack size.`;
  return `We'd like to confirm our order: ${quantityPhrase} of ${input.wineName}${priceLine}.${packNote}`;
}

/** `procurement.service.ts:529` (and the identical `:879-881`) at `129fbfc6`. */
function preFixOrderTotal(finalPrice: number, bottlesTotal: number): number {
  return finalPrice * bottlesTotal;
}

/** `procurement.service.ts:4952-4972` at `129fbfc6`. */
function preFixSightingOperands(confirmUnits: {
  unitType: string | null;
  bottlesPerUnit: number | null;
}): { unitLabel: string; packSize: number | null } {
  const bottlesPerConfirmedUnit =
    confirmUnits.bottlesPerUnit ??
    (confirmUnits.unitType == null || confirmUnits.unitType === "bottle"
      ? 1
      : null);
  return {
    unitLabel: confirmUnits.unitType ?? "bottle",
    packSize: bottlesPerConfirmedUnit === 1 ? 1 : null,
  };
}

const WINE = "Château Test 2019";

// ---------------------------------------------------------------------------

describe("the price unit vocabulary", () => {
  it("is the same seven words the quantity may use — all four copies or none", () => {
    expect([...PRICE_UOM_TYPES]).toEqual([...ORDER_UNIT_TYPES]);
  });
});

describe("resolveStatedPriceUnit — half a statement is refused, not completed", () => {
  it("accepts an absent pair as UNSTATED rather than as an error", () => {
    const r = resolveStatedPriceUnit({});
    expect(r).toEqual({ ok: true, stated: null });
  });

  it("refuses a unit with no pack size, naming what is missing", () => {
    const r = resolveStatedPriceUnit({ priceUom: "case" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("price_unit_half_stated");
    expect(r.message).toContain("how many bottles are in one case");
  });

  it("refuses a pack size with no unit", () => {
    const r = resolveStatedPriceUnit({ pricePackSize: 12 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("price_unit_half_stated");
    expect(r.message).toContain("not a price");
  });

  it("refuses a word outside the vocabulary rather than guessing at it", () => {
    const r = resolveStatedPriceUnit({ priceUom: "bxs", pricePackSize: 12 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("unknown_price_unit");
  });

  it("normalises a plural to the singular the CHECK constraint accepts", () => {
    const r = resolveStatedPriceUnit({ priceUom: "Cases", pricePackSize: 12 });
    expect(r).toEqual({ ok: true, stated: { priceUom: "case", pricePackSize: 12 } });
  });

  it("refuses a bottle priced per twelve — that is a case price with the wrong word", () => {
    const r = resolveStatedPriceUnit({ priceUom: "bottle", pricePackSize: 12 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("price_pack_size_conflict");
  });

  it("refuses a pack size below one, which divides a price instead of multiplying it", () => {
    const r = resolveStatedPriceUnit({ priceUom: "case", pricePackSize: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("bad_price_pack_size");
  });

  it("accepts a PER-BOTTLE price on an order placed in CASES — the two units are independent", () => {
    // Connecticut posts a bottle price and a case price separately for the same
    // item and they are not related by division. A schema that forced the two
    // units to agree could not record ordinary trade.
    const r = resolveStatedPriceUnit({ priceUom: "bottle", pricePackSize: 1 });
    expect(r).toEqual({ ok: true, stated: { priceUom: "bottle", pricePackSize: 1 } });
  });
});

describe("readStatedPriceUnit — a row states both halves or it states nothing", () => {
  it("reads the pair off a row", () => {
    expect(readStatedPriceUnit({ price_uom: "case", price_pack_size: 12 })).toEqual({
      priceUom: "case",
      pricePackSize: 12,
    });
  });

  it("reads a NULL pair as unstated", () => {
    expect(readStatedPriceUnit({ price_uom: null, price_pack_size: null })).toBeNull();
  });

  it("reads a half-written row as UNSTATED, never as half a claim", () => {
    expect(readStatedPriceUnit({ price_uom: "case", price_pack_size: null })).toBeNull();
  });

  it("reads a missing row as unstated", () => {
    expect(readStatedPriceUnit(null)).toBeNull();
  });
});

describe("agreedOrderTotal — the total is drawn from the price's own unit", () => {
  it("PRE-FIX: 60 bottles at $420 per case totals $25,200 — twelve times the truth", () => {
    expect(preFixOrderTotal(420, 60)).toBe(25200);
  });

  it("POST-FIX: the same order totals $2,100 — five cases at $420", () => {
    const r = agreedOrderTotal({
      price: 420,
      stated: { priceUom: "case", pricePackSize: 12 },
      bottlesTotal: 60,
      quantity: 5,
      unitType: "case",
      opaque: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.total).toBe(2100);
    expect(r.note).toContain("÷ 12");
  });

  it("leaves an order with NO stated unit on the historical per-bottle arithmetic, byte for byte", () => {
    const r = agreedOrderTotal({
      price: 35,
      stated: null,
      bottlesTotal: 60,
      quantity: 5,
      unitType: "case",
      opaque: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.total).toBe(preFixOrderTotal(35, 60));
  });

  it("totals a per-KEG price on a keg order by the keg count", () => {
    const r = agreedOrderTotal({
      price: 180,
      stated: { priceUom: "keg", pricePackSize: 1 },
      bottlesTotal: 3,
      quantity: 3,
      unitType: "keg",
      opaque: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.total).toBe(540);
  });

  it("REFUSES a keg order priced per bottle rather than inventing its value", () => {
    const r = agreedOrderTotal({
      price: 12,
      stated: { priceUom: "bottle", pricePackSize: 1 },
      bottlesTotal: 3,
      quantity: 3,
      unitType: "keg",
      opaque: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("price_unit_not_countable");
    expect(r.message).toContain("cannot be worked out");
  });

  it("keeps a fractional count rather than rounding to a whole unit", () => {
    // Five bottles bought at a case price is five twelfths of a case. Real
    // trade, and rounding it to a whole case would invent $2,275 of goods.
    const r = agreedOrderTotal({
      price: 420,
      stated: { priceUom: "case", pricePackSize: 12 },
      bottlesTotal: 5,
      quantity: 5,
      unitType: "bottle",
      opaque: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.total).toBe(175);
  });
});

describe("perBottleFromAgreedPrice — one conversion, and it says so", () => {
  it("divides a case price by its pack and records the arithmetic", () => {
    const r = perBottleFromAgreedPrice({
      price: 420,
      stated: { priceUom: "case", pricePackSize: 12 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.perBottle).toBe(35);
    expect(r.note).toContain("$420.00 per case of 12");
    expect(r.note).toContain("$35.0000");
  });

  it("leaves a per-bottle price alone", () => {
    const r = perBottleFromAgreedPrice({
      price: 35,
      stated: { priceUom: "bottle", pricePackSize: 1 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.perBottle).toBe(35);
  });

  it("REFUSES a per-keg price rather than filing it in a column that says BOTTLE", () => {
    const r = perBottleFromAgreedPrice({
      price: 180,
      stated: { priceUom: "keg", pricePackSize: 1 },
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toContain("not a number of bottles");
  });
});

describe("the register admits a case-priced agreement once the row states its unit", () => {
  const base = {
    restaurantId: "11111111-1111-1111-1111-111111111111",
    orderId: "22222222-2222-2222-2222-222222222222",
    providerId: "33333333-3333-3333-3333-333333333333",
    vendorName: "Anadolu Şarap",
    masterWineId: "44444444-4444-4444-4444-444444444444",
    productName: WINE,
    source: "order_confirmed" as const,
    unitPrice: 420,
    unitVolumeMl: 750,
    observedAt: "2026-09-04T10:00:00.000Z",
    currency: "USD",
    notes: null,
  };
  const confirmUnits = { unitType: "case", bottlesPerUnit: 12 };

  it("PRE-FIX: the same agreement is REFUSED, and the refusal names the pack size", () => {
    const pre = preFixSightingOperands(confirmUnits);
    expect(pre.packSize).toBeNull();
    const decision = decideOwnPaperSighting({ ...base, ...pre });
    expect(decision.write).toBe(false);
    if (decision.write) throw new Error("unreachable");
    expect(decision.reason).toContain("the pack size is null");
  });

  it("POST-FIX: stating (case, 12) admits it, and the register normalises to $35 a bottle", () => {
    const decision = decideOwnPaperSighting({
      ...base,
      unitLabel: "case",
      packSize: 12,
    });
    expect(decision.write).toBe(true);
    if (!decision.write) throw new Error("unreachable");
    // The DOCUMENT's own number in the DOCUMENT's own unit, with the pack beside
    // it — `normalizeUnitPrice` does the one conversion (ADR 0119 invariant 2).
    expect(decision.row.raw_price).toBe(420);
    expect(decision.row.pack_size).toBe(12);
    expect(decision.normalizedUnitPrice).toBe(35);
    expect(decision.row.trust_tier).toBe(2);
    expect(decision.row.source_type).toBe("quote");
  });

  it("a case order priced PER BOTTLE files the bottle price, not the case price", () => {
    // The pre-fix path could not express this at all: it read the QUANTITY's
    // unit, so a per-bottle price on a case order would have been filed as a
    // case price if it had been filed at all.
    const decision = decideOwnPaperSighting({
      ...base,
      unitPrice: 35,
      unitLabel: "bottle",
      packSize: 1,
    });
    expect(decision.write).toBe(true);
    if (!decision.write) throw new Error("unreachable");
    expect(decision.row.raw_price).toBe(35);
    expect(decision.row.pack_size).toBe(1);
    expect(decision.normalizedUnitPrice).toBe(35);
  });

  it("an UNSTATED unit keeps refusing — the failure mode is the status quo", () => {
    const decision = decideOwnPaperSighting({
      ...base,
      unitLabel: "case",
      packSize: null,
    });
    expect(decision.write).toBe(false);
  });
});

describe("the refusal is a sentence a person can act on", () => {
  it("names the consequence, not the null column", () => {
    const s = unstatedPriceUnitSentence("This agreement");
    expect(s).toContain("does not enter the price register");
    expect(s).toContain("factor of the pack");
    expect(s).not.toContain("null");
  });
});

describe("describeConfirmedOrderTerms — the mail states the price's own unit", () => {
  it("PRE-FIX: a case order priced per BOTTLE is mailed as $35.00 per CASE", () => {
    expect(
      preFixSentence({
        quantity: 5,
        unitType: "case",
        bottlesPerUnit: 12,
        wineName: WINE,
        finalPrice: 35,
      }),
    ).toBe(
      `We'd like to confirm our order: 5 cases (12 bottles each) of ${WINE} at $35.00 per case.`,
    );
  });

  it("POST-FIX: the same order is mailed as $35.00 per bottle", () => {
    expect(
      describeConfirmedOrderTerms({
        quantity: 5,
        unitType: "case",
        bottlesPerUnit: 12,
        wineName: WINE,
        finalPrice: 35,
        statedPriceUnit: { priceUom: "bottle", pricePackSize: 1 },
      }),
    ).toBe(
      `We'd like to confirm our order: 5 cases (12 bottles each) of ${WINE} at $35.00 per bottle.`,
    );
  });

  it("names the pack in the price when the price is per case", () => {
    expect(
      describeConfirmedOrderTerms({
        quantity: 5,
        unitType: "case",
        bottlesPerUnit: 12,
        wineName: WINE,
        finalPrice: 420,
        statedPriceUnit: { priceUom: "case", pricePackSize: 12 },
      }),
    ).toBe(
      `We'd like to confirm our order: 5 cases (12 bottles each) of ${WINE} at $420.00 per case (12 bottles).`,
    );
  });

  it("falls back to phase 0's sentence, unchanged, when the row states no unit", () => {
    const input = {
      quantity: 5,
      unitType: "case",
      bottlesPerUnit: 12,
      wineName: WINE,
      finalPrice: 120,
    };
    expect(describeConfirmedOrderTerms({ ...input, statedPriceUnit: null })).toBe(
      preFixSentence(input),
    );
    expect(describeConfirmedOrderTerms(input)).toBe(preFixSentence(input));
  });

  it("still asks for an unknown pack, and does so beside a stated price unit", () => {
    expect(
      describeConfirmedOrderTerms({
        quantity: 5,
        unitType: "case",
        bottlesPerUnit: null,
        wineName: WINE,
        finalPrice: 420,
        statedPriceUnit: { priceUom: "case", pricePackSize: 12 },
      }),
    ).toBe(
      `We'd like to confirm our order: 5 cases of ${WINE} at $420.00 per case (12 bottles).` +
        " Our records do not state how many bottles are in a case, so please confirm the pack size.",
    );
  });
});

describe("describeAgreedPrice — the phrase the page and the vendor both read", () => {
  it("names the pack for a multiplying unit", () => {
    expect(
      describeAgreedPrice({
        price: 420,
        stated: { priceUom: "case", pricePackSize: 12 },
      }),
    ).toBe("$420.00 per case (12 bottles)");
  });

  it("does not say '(1 bottle)' after a bottle price", () => {
    expect(
      describeAgreedPrice({
        price: 35,
        stated: { priceUom: "bottle", pricePackSize: 1 },
      }),
    ).toBe("$35.00 per bottle");
  });

  it("shows a bare figure when no unit is stated, rather than inventing one", () => {
    expect(describeAgreedPrice({ price: 35, stated: null })).toBe("$35.00");
  });

  it("is null when there is no price at all", () => {
    expect(describeAgreedPrice({ price: null, stated: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The write path. A pure resolver that nothing calls is a refusal nobody makes,
// so these assert what `createOrder` actually puts in the insert payload.
//
// The stub is a trimmed copy of `order-capture.spec.ts`'s, deliberately local:
// that file is the order-capture contract's own proof and this pass does not
// edit it. It distinguishes a terminal `await` (a list) from `.single()` /
// `.maybeSingle()` (one row) because the service relies on that difference.
// ---------------------------------------------------------------------------

import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

type Row = Record<string, any>;

const MASTER_WINE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const INSERTED_ORDER = {
  id: "44444444-4444-4444-8444-444444444444",
  order_number: "ORD-2026-00042",
  restaurant_id: "rest-1",
  inventory_id: "inv-1",
  provider_id: "prov-1",
  quantity: 5,
  unit_type: "case",
  bottles_total: 60,
  final_price: 420,
  total_cost: 2100,
  status: "PENDING",
  inventory: { wine_name: "Barolo Riserva" },
};

const INVENTORY_ROW = {
  master_wine_id: MASTER_WINE,
  wine_name: "Barolo Riserva",
  sku: "INT-9001",
  master_wine_library: {
    name: "Barolo Riserva",
    producer: "Giacomo Conterno",
    vintage: 2016,
  },
};

function makeDb() {
  const calls = { orderInserts: [] as Row[], lineInserts: [] as Row[] };
  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";
      const settle = (shape: "one" | "many") => {
        if (table === "providers")
          return { data: null, count: 1, error: null };
        if (table === "restaurant_inventory")
          return { data: INVENTORY_ROW, error: null };
        if (table === "procurement_orders") {
          if (op === "insert") return { data: INSERTED_ORDER, error: null };
          if (shape === "one") return { data: null, error: null };
          return { data: [], error: null };
        }
        return { data: shape === "many" ? [] : null, error: null };
      };
      const q: any = {
        select: () => q,
        eq: () => q,
        neq: () => q,
        not: () => q,
        in: () => q,
        is: () => q,
        gt: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        insert(payload: Row) {
          op = "insert";
          if (table === "procurement_order_items") calls.lineInserts.push(payload);
          if (table === "procurement_orders") calls.orderInserts.push(payload);
          return q;
        },
        update() {
          op = "update";
          return q;
        },
        delete() {
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

const CASE_ORDER = {
  inventoryId: "inv-1",
  providerId: "prov-1",
  quantity: 5,
  unitType: "cases",
  bottlesPerUnit: 12,
  finalPrice: 420,
} as any;

describe("createOrder — the pair reaches the row, or the order is refused", () => {
  it("writes price_uom and price_pack_size as EXPLICIT keys when the form states them", async () => {
    const { db, calls } = makeDb();
    await new ProcurementService(db, events, ledger).createOrder(
      "rest-1",
      USER,
      { ...CASE_ORDER, priceUom: "case", pricePackSize: 12 },
    );
    expect(calls.lineInserts).toHaveLength(1);
    const line = calls.lineInserts[0];
    expect(line.price_uom).toBe("case");
    expect(line.price_pack_size).toBe(12);
    // The keys are present-and-explicit rather than spread in conditionally —
    // `check_order_capture_contract.py` reads payload keys without executing
    // them, and a conditional spread is a key set it cannot read.
    expect(Object.prototype.hasOwnProperty.call(line, "price_uom")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(line, "price_pack_size")).toBe(true);
  });

  it("writes BOTH as null when no unit is stated — never a defaulted 'bottle'", async () => {
    const { db, calls } = makeDb();
    await new ProcurementService(db, events, ledger).createOrder(
      "rest-1",
      USER,
      CASE_ORDER,
    );
    const line = calls.lineInserts[0];
    expect(line).toHaveProperty("price_uom", null);
    expect(line).toHaveProperty("price_pack_size", null);
  });

  it("totals a per-case agreement from the pair, not from the bottle count", async () => {
    const { db, calls } = makeDb();
    await new ProcurementService(db, events, ledger).createOrder(
      "rest-1",
      USER,
      { ...CASE_ORDER, priceUom: "case", pricePackSize: 12 },
    );
    // Pre-fix this row read 420 x 60 = 25,200 (`procurement.service.ts:529` at
    // 129fbfc6). Five cases at $420 is $2,100.
    expect(calls.orderInserts[0].total_cost).toBe(2100);
    expect(calls.lineInserts[0].line_total).toBe(2100);
  });

  it("leaves an order with no stated unit on the old arithmetic exactly", async () => {
    const { db, calls } = makeDb();
    await new ProcurementService(db, events, ledger).createOrder(
      "rest-1",
      USER,
      CASE_ORDER,
    );
    expect(calls.orderInserts[0].total_cost).toBe(preFixOrderTotal(420, 60));
  });

  it("refuses half a statement with a 400 the desk can read, and writes nothing", async () => {
    const { db, calls } = makeDb();
    await expect(
      new ProcurementService(db, events, ledger).createOrder("rest-1", USER, {
        ...CASE_ORDER,
        priceUom: "case",
      }),
    ).rejects.toMatchObject({
      response: { reason: "price_unit_half_stated" },
    });
    expect(calls.orderInserts).toHaveLength(0);
    expect(calls.lineInserts).toHaveLength(0);
  });

  it("refuses a price unit the order cannot be counted in", async () => {
    const { db, calls } = makeDb();
    await expect(
      new ProcurementService(db, events, ledger).createOrder("rest-1", USER, {
        inventoryId: "inv-1",
        providerId: "prov-1",
        quantity: 3,
        unitType: "keg",
        finalPrice: 12,
        priceUom: "bottle",
        pricePackSize: 1,
      } as any),
    ).rejects.toMatchObject({
      response: { reason: "price_unit_not_countable" },
    });
    expect(calls.orderInserts).toHaveLength(0);
  });
});
