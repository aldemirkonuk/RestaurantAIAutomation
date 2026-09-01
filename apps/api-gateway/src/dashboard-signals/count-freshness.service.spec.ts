import { Test, TestingModule } from "@nestjs/testing";
import { CountFreshnessService } from "./count-freshness.service";
import { DatabaseService } from "../database/database.service";
import { makeSupabaseStub, SupabaseStub } from "./testing/supabase-stub";

/**
 * Count freshness and attribution (dashboard rebuild spec §3.1).
 *
 * The sommelier's constraint is the design: "proof isn't a badge, it's a
 * before/after I can point to" — "4 days left → corrected to 2 days, reorder
 * triggered, because of your count on 8/29."
 *
 * And the part that must not be faked: attribution has to come from real
 * ledger rows. There is a specific trap in this schema and these tests pin it.
 * `recordSpotCount` writes through `set_stock_absolute`, which returns early
 * on a zero delta:
 *
 *     v_delta := p_target_qty - v_current;
 *     IF v_delta = 0 THEN RETURN NULL; END IF;
 *     -- supabase/migrations/20260805131000_stock_race_and_pour_idempotency.sql:44
 *
 * So a count that CONFIRMS the number writes no `inventory_transactions` row
 * at all, while still stamping `last_counted_at` (decision E41). An
 * implementation that reports "no correction found" as "never counted", or
 * that claims the previous count's correction for the latest count, is lying
 * about whose work moved the number.
 */

const R1 = "11111111-1111-1111-1111-111111111111";
/** A second unit, present in every fixture below as a leak tripwire. */
const R2 = "22222222-2222-2222-2222-222222222222";
/** A third unit that owns nothing anywhere. */
const R3 = "33333333-3333-3333-3333-333333333333";

const INV_CORRECTED = "cccccccc-0000-0000-0000-000000000001";
const INV_CONFIRMED = "cccccccc-0000-0000-0000-000000000002";
const INV_NEVER = "cccccccc-0000-0000-0000-000000000003";
const INV_NOVELOCITY = "cccccccc-0000-0000-0000-000000000004";
const INV_STALECORRECTION = "cccccccc-0000-0000-0000-000000000005";
/** Belongs to R2. Must never appear in an R1 answer. */
const INV_OTHER_UNIT = "cccccccc-0000-0000-0000-0000000000ff";

const NOW = "2026-09-02T12:00:00Z";

const INVENTORY = [
  // Counted on 8/29, and the count moved the number: 4 → 2.
  {
    id: INV_CORRECTED,
    restaurant_id: R1,
    wine_name: "Chablis 1er Cru",
    last_counted_at: "2026-08-29T18:00:05Z",
  },
  // Counted yesterday; the count confirmed the number, so no ledger row.
  {
    id: INV_CONFIRMED,
    restaurant_id: R1,
    wine_name: "Sancerre",
    last_counted_at: "2026-09-01T10:00:00Z",
  },
  // Never counted.
  {
    id: INV_NEVER,
    restaurant_id: R1,
    wine_name: "House Red",
    last_counted_at: null,
  },
  // Counted, corrected, but nothing sells — days-of-cover is not knowable.
  {
    id: INV_NOVELOCITY,
    restaurant_id: R1,
    wine_name: "Vin Santo",
    last_counted_at: "2026-08-30T09:00:02Z",
  },
  // Counted last week; the only reconciliation row predates that count by
  // months, so it belongs to an EARLIER count and must not be attributed here.
  {
    id: INV_STALECORRECTION,
    restaurant_id: R1,
    wine_name: "Barolo Riserva",
    last_counted_at: "2026-08-26T08:00:00Z",
  },
  // ---- Second unit. ----
  {
    id: INV_OTHER_UNIT,
    restaurant_id: R2,
    wine_name: "Other unit's Krug",
    last_counted_at: "2026-09-02T09:00:02Z",
  },
];

const TRANSACTIONS = [
  {
    id: "dddddddd-0000-0000-0000-000000000001",
    restaurant_id: R1,
    inventory_id: INV_CORRECTED,
    transaction_type: "reconciliation",
    source: "mobile_count",
    quantity_before: 4,
    quantity_after: 2,
    quantity_change: -2,
    transaction_date: "2026-08-29T18:00:00Z",
    performed_by: "eeeeeeee-0000-0000-0000-000000000001",
    reason: "Spot count",
  },
  {
    id: "dddddddd-0000-0000-0000-000000000002",
    restaurant_id: R1,
    inventory_id: INV_NOVELOCITY,
    transaction_type: "reconciliation",
    source: "mobile_count",
    quantity_before: 5,
    quantity_after: 4,
    quantity_change: -1,
    transaction_date: "2026-08-30T09:00:00Z",
    performed_by: null,
    reason: "Spot count",
  },
  {
    id: "dddddddd-0000-0000-0000-000000000003",
    restaurant_id: R1,
    inventory_id: INV_STALECORRECTION,
    transaction_type: "reconciliation",
    source: "mobile_count",
    quantity_before: 12,
    quantity_after: 10,
    quantity_change: -2,
    transaction_date: "2026-05-02T11:00:00Z",
    performed_by: null,
    reason: "Spot count",
  },
  {
    id: "dddddddd-0000-0000-0000-0000000000ff",
    restaurant_id: R2,
    inventory_id: INV_OTHER_UNIT,
    transaction_type: "reconciliation",
    source: "mobile_count",
    quantity_before: 40,
    quantity_after: 39,
    quantity_change: -1,
    transaction_date: "2026-09-02T09:00:00Z",
    performed_by: null,
    reason: "Spot count",
  },
];

const ANALYTICS = [
  // 1 bottle/day: 4 on hand = 4 days, 2 on hand = 2 days. This is the
  // sommelier's own example — "4 days left → corrected to 2 days".
  {
    inventory_id: INV_CORRECTED,
    restaurant_id: R1,
    velocity_per_day: 1,
    days_of_cover: 2,
  },
  { inventory_id: INV_CONFIRMED, restaurant_id: R1, velocity_per_day: 0.25 },
  // Nothing has sold: velocity 0. Days-of-cover is not knowable, not infinite,
  // and above all not zero.
  { inventory_id: INV_NOVELOCITY, restaurant_id: R1, velocity_per_day: 0 },
  {
    inventory_id: INV_STALECORRECTION,
    restaurant_id: R1,
    velocity_per_day: null,
  },
  { inventory_id: INV_OTHER_UNIT, restaurant_id: R2, velocity_per_day: 3 },
];

function build(stub: SupabaseStub) {
  return Test.createTestingModule({
    providers: [
      CountFreshnessService,
      { provide: DatabaseService, useValue: { getClient: () => stub.client } },
    ],
  }).compile();
}

function fullStub() {
  return makeSupabaseStub({
    restaurant_inventory: INVENTORY,
    inventory_transactions: TRANSACTIONS,
    inventory_analytics: ANALYTICS,
  });
}

describe("CountFreshnessService", () => {
  let service: CountFreshnessService;
  let stub: SupabaseStub;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    stub = fullStub();
    const module: TestingModule = await build(stub);
    service = module.get(CountFreshnessService);
  });

  afterEach(() => jest.useRealTimers());

  const item = async (id: string) =>
    (await service.getCountFreshness(R1)).items.find(
      (i) => i.inventoryId === id,
    )!;

  // =========================================================================
  // Freshness
  // =========================================================================

  it("reports when the last count happened and how long ago", async () => {
    const it1 = await item(INV_CORRECTED);
    expect(it1.lastCountedAt).toBe("2026-08-29T18:00:05Z");
    expect(it1.daysSinceCount).toBe(3);
  });

  it("says nothing about freshness for an item that was never counted", async () => {
    const it1 = await item(INV_NEVER);
    expect(it1.lastCountedAt).toBeNull();
    expect(it1.daysSinceCount).toBeNull();
    expect(it1.lastCountChangedStock).toBeNull();
  });

  it("publishes the staleness policy it is using instead of hiding a constant", async () => {
    const res = await service.getCountFreshness(R1);
    expect(typeof res.policy.staleAfterDays).toBe("number");
    expect(typeof res.policy.attributionWindowSeconds).toBe("number");
  });

  // =========================================================================
  // Attribution — real rows or nothing
  // =========================================================================

  it("attributes the before/after of the count that actually moved the number", async () => {
    const it1 = await item(INV_CORRECTED);

    expect(it1.lastCountChangedStock).toBe(true);
    expect(it1.lastCorrection).toEqual({
      transactionId: "dddddddd-0000-0000-0000-000000000001",
      at: "2026-08-29T18:00:00Z",
      quantityBefore: 4,
      quantityAfter: 2,
      delta: -2,
      source: "mobile_count",
      performedBy: "eeeeeeee-0000-0000-0000-000000000001",
      reason: "Spot count",
    });
  });

  it("gives the days-of-cover before and after, which is the sentence the sommelier asked for", async () => {
    const it1 = await item(INV_CORRECTED);

    // "4 days left → corrected to 2 days, because of your count on 8/29."
    expect(it1.coverDelta).toEqual({
      velocityPerDay: 1,
      velocityBasis: expect.stringContaining("inventory_analytics"),
      daysOfCoverBefore: 4,
      daysOfCoverAfter: 2,
      confidence: "estimated",
    });
  });

  it("distinguishes a count that confirmed the number from a count that never happened", async () => {
    const confirmed = await item(INV_CONFIRMED);
    const never = await item(INV_NEVER);

    // Counted, but the delta was zero so set_stock_absolute wrote no row.
    expect(confirmed.lastCountedAt).not.toBeNull();
    expect(confirmed.lastCorrection).toBeNull();
    expect(confirmed.lastCountChangedStock).toBe(false);
    expect(confirmed.correctionUnknownReason).toMatch(/no change|confirmed/i);

    // Never counted at all — a different claim entirely.
    expect(never.lastCorrection).toBeNull();
    expect(never.lastCountChangedStock).toBeNull();
    expect(never.correctionUnknownReason).toMatch(/never/i);
  });

  it("refuses to claim credit for a correction that predates the last count", async () => {
    const it1 = await item(INV_STALECORRECTION);

    // A reconciliation row exists for this item, but it is from May and the
    // last count was in August. Attributing it would credit the wrong count.
    expect(it1.lastCountChangedStock).toBe(false);
    expect(it1.lastCorrection).toBeNull();
  });

  it("ignores non-reconciliation ledger rows entirely", async () => {
    const withSale = makeSupabaseStub({
      restaurant_inventory: INVENTORY,
      inventory_analytics: ANALYTICS,
      inventory_transactions: [
        {
          id: "dddddddd-0000-0000-0000-00000000000f",
          restaurant_id: R1,
          inventory_id: INV_CONFIRMED,
          transaction_type: "sale",
          source: "pos",
          quantity_before: 6,
          quantity_after: 5,
          quantity_change: -1,
          transaction_date: "2026-09-01T10:00:00Z",
          performed_by: null,
          reason: null,
        },
      ],
    });
    const svc = (await build(withSale)).get(CountFreshnessService);
    const res = await svc.getCountFreshness(R1);
    const it1 = res.items.find((i) => i.inventoryId === INV_CONFIRMED)!;

    expect(it1.lastCorrection).toBeNull();
    expect(it1.lastCountChangedStock).toBe(false);

    // And the query itself must have asked only for reconciliation rows.
    const call = withSale.callsFor("inventory_transactions")[0];
    expect(
      call.filters.some(
        (f) =>
          f.method === "eq" &&
          f.args[0] === "transaction_type" &&
          f.args[1] === "reconciliation",
      ),
    ).toBe(true);
  });

  // =========================================================================
  // ADR 0051 — null, not zero
  // =========================================================================

  it("returns a null cover delta with a reason when nothing sells, never 0 days", async () => {
    const it1 = await item(INV_NOVELOCITY);

    expect(it1.lastCorrection).not.toBeNull();
    expect(it1.coverDelta).toBeNull();
    expect(it1.coverDeltaUnknownReason).toMatch(/velocity|no.*sale/i);
  });

  it("counts only what it can trace, and marks coverage", async () => {
    const res = await service.getCountFreshness(R1);

    expect(res.coverage).toEqual({
      itemsConsidered: 5,
      itemsEverCounted: 4,
      itemsWithTraceableCorrection: 2,
      truncated: false,
    });
  });

  it("marks coverage truncated when the row cap is hit, so counts render as floors", async () => {
    const res = await service.getCountFreshness(R1, { limit: 2 });
    expect(res.coverage.truncated).toBe(true);
    expect(res.items).toHaveLength(2);
  });

  // =========================================================================
  // Multi-unit (spec §6)
  // =========================================================================

  it("scopes every query to the requested restaurant, ledger included", async () => {
    await service.getCountFreshness(R1);

    for (const table of [
      "restaurant_inventory",
      "inventory_transactions",
      "inventory_analytics",
    ]) {
      expect(stub.filtered(table, "restaurant_id", R1)).toBe(true);
    }
  });

  it("never returns the other unit's items or attributes their counts", async () => {
    const res = await service.getCountFreshness(R1);

    expect(res.items.map((i) => i.inventoryId)).not.toContain(INV_OTHER_UNIT);
    expect(res.coverage.itemsConsidered).toBe(5);
    for (const i of res.items) {
      expect(i.lastCorrection?.transactionId).not.toBe(
        "dddddddd-0000-0000-0000-0000000000ff",
      );
    }
  });

  it("returns an empty, honest payload for a unit that owns nothing", async () => {
    const res = await service.getCountFreshness(R3);

    expect(res.items).toEqual([]);
    expect(res.coverage.itemsConsidered).toBe(0);
    expect(stub.callsFor("inventory_transactions")).toHaveLength(0);
  });

  it("can be narrowed to a set of inventory ids without losing the tenant filter", async () => {
    const res = await service.getCountFreshness(R1, {
      inventoryIds: [INV_CORRECTED],
    });

    expect(res.items.map((i) => i.inventoryId)).toEqual([INV_CORRECTED]);
    expect(stub.filtered("restaurant_inventory", "restaurant_id", R1)).toBe(
      true,
    );
  });
});
