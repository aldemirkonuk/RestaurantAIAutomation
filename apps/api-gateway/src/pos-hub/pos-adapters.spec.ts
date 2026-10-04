import {
  ADAPTERS,
  genericAdapter,
  squareAdapter,
  cloverAdapter,
  toastAdapter,
} from "./pos-adapters";
import { POS_PROVIDERS, registrySummary } from "./pos-provider.registry";
import { CHECK_CHANNELS, checkChannelOf } from "./pos-types";

describe("POS provider registry", () => {
  it("covers 25+ providers across all tiers incl. Türkiye", () => {
    const s = registrySummary();
    expect(s.total).toBeGreaterThanOrEqual(25);
    expect(s.byTier.cloud).toBeGreaterThanOrEqual(9);
    expect(s.byTier.enterprise).toBeGreaterThanOrEqual(8);
    expect(s.byTier.partner_gated).toBeGreaterThanOrEqual(2);
    expect(s.byTier.regional_tr).toBeGreaterThanOrEqual(5);
    expect(s.byStatus.available).toBeGreaterThanOrEqual(2);
  });

  it("has unique keys and an adapter for every non-planned provider path", () => {
    const keys = new Set(POS_PROVIDERS.map((p) => p.key));
    expect(keys.size).toBe(POS_PROVIDERS.length);
    for (const key of [
      "generic_webhook",
      "csv_import",
      "square",
      "clover",
      "toast",
    ]) {
      expect(ADAPTERS[key]).toBeDefined();
    }
  });
});

describe("adapters normalize to the canonical check", () => {
  it("generic accepts canonical shape (single, array, wrapped)", () => {
    const one = genericAdapter.normalize({
      externalCheckId: "c1",
      openedAt: "2026-07-18T19:00:00Z",
      total: 120.5,
      items: [{ name: "Malbec", qty: 2, price: 15, is_wine: true }],
    });
    expect(one).toHaveLength(1);
    expect(one[0].externalCheckId).toBe("c1");
    expect(one[0].items[0].is_wine).toBe(true);
    expect(
      genericAdapter.normalize([
        { external_check_id: "a" },
        { externalCheckId: "b" },
      ]),
    ).toHaveLength(2);
    expect(
      genericAdapter.normalize({ checks: [{ externalCheckId: "x" }] }),
    ).toHaveLength(1);
    expect(genericAdapter.normalize({ nonsense: true })).toHaveLength(0);
  });

  it("square converts cents and reads the webhook envelope", () => {
    const [check] = squareAdapter.normalize({
      data: {
        object: {
          order: {
            id: "sq-1",
            state: "COMPLETED",
            created_at: "2026-07-18T18:00:00Z",
            closed_at: "2026-07-18T19:30:00Z",
            total_money: { amount: 15750 },
            total_tip_money: { amount: 2000 },
            line_items: [
              {
                name: "Ribeye",
                quantity: "1",
                base_price_money: { amount: 5800 },
              },
              {
                name: "Pinot Noir glass",
                quantity: "2",
                base_price_money: { amount: 1600 },
              },
            ],
          },
        },
      },
    });
    expect(check.externalCheckId).toBe("sq-1");
    expect(check.total).toBeCloseTo(157.5);
    expect(check.tip).toBeCloseTo(20);
    expect(check.closedAt).toBe("2026-07-18T19:30:00Z");
    expect(check.items[1].price).toBeCloseTo(16);
  });

  it("clover converts epoch millis and cents", () => {
    const [check] = cloverAdapter.normalize({
      id: "clv-1",
      state: "paid",
      createdTime: 1784750400000,
      modifiedTime: 1784757600000,
      total: 9900,
      tipAmount: 1500,
      employee: { id: "emp1", name: "Ada" },
      lineItems: { elements: [{ name: "Şarap Kadeh", price: 950 }] },
    });
    expect(check.externalCheckId).toBe("clv-1");
    expect(check.total).toBeCloseTo(99);
    expect(check.serverName).toBe("Ada");
    expect(check.closedAt).not.toBeNull();
    expect(check.items[0].price).toBeCloseTo(9.5);
  });

  it("toast keeps major units and joins server name", () => {
    const [check] = toastAdapter.normalize({
      checks: [
        {
          guid: "t-1",
          openedDate: "2026-07-18T18:00:00Z",
          closedDate: null,
          totalAmount: 210,
          tipAmount: 30,
          numberOfGuests: 4,
          server: { guid: "s1", firstName: "Maya", lastName: "K" },
          table: { guid: "tbl-9" },
          selections: [
            {
              displayName: "Barolo",
              quantity: 1,
              price: 140,
              salesCategory: { name: "Wine" },
            },
          ],
        },
      ],
    });
    expect(check.externalCheckId).toBe("t-1");
    expect(check.closedAt).toBeNull(); // open check → hot-table analytics
    expect(check.serverName).toBe("Maya K");
    expect(check.tableRef).toBe("tbl-9");
    expect(check.items[0].category).toBe("Wine");
  });
});

/**
 * An absent number and a zero are different facts (ADR 0105 D5, ADR 0020).
 *
 * `num()` was `Number(v)` guarded by `Number.isFinite`. `Number(null)` is `0`
 * and `0` is finite, so a provider that says "this check has no cover count"
 * — Square structurally cannot put covers on an Order — had that recorded as
 * a table that seated nobody. Measured on the Square day: 42 canonical checks
 * sent `covers: null` and read back `0`. Omitted keys were unaffected
 * (`Number(undefined)` is NaN), which is why the SimPOS lens saw 44 nulls on
 * the same column: the two runs hit opposite sides of the same coercion.
 */
describe("canonical adapter — a field a POS cannot supply stays null", () => {
  const base = {
    externalCheckId: "chk-1",
    openedAt: "2026-09-03T05:00:00.000Z",
    items: [],
  };

  it("keeps an explicit null covers as null, not 0", () => {
    const [check] = genericAdapter.normalize({ ...base, covers: null });
    expect(check.covers).toBeNull();
  });

  it("keeps an explicit null total/subtotal/tip as null, not $0.00", () => {
    const [check] = genericAdapter.normalize({
      ...base,
      total: null,
      subtotal: null,
      tip: null,
    });
    expect(check.total).toBeNull();
    expect(check.subtotal).toBeNull();
    expect(check.tip).toBeNull();
  });

  it("still reads a real zero as zero — a comped check is not an unknown one", () => {
    const [check] = genericAdapter.normalize({ ...base, covers: 0, tip: 0 });
    expect(check.covers).toBe(0);
    expect(check.tip).toBe(0);
  });

  it("treats an empty string as absent rather than as zero", () => {
    const [check] = genericAdapter.normalize({
      ...base,
      covers: "",
      total: "",
    });
    expect(check.covers).toBeNull();
    expect(check.total).toBeNull();
  });

  it("defaults a line with no quantity to 1", () => {
    // Passed before the fix too, and the reason is worth pinning: `it.qty ??
    // it.quantity` evaluates a null qty to `undefined`, and `Number(undefined)`
    // is NaN, so the line took the intended `?? 1` by luck rather than design.
    // With `num` now rejecting null directly, it takes it on purpose.
    const [check] = genericAdapter.normalize({
      ...base,
      items: [{ name: "Akakies", qty: null }],
    });
    expect(check.items[0].qty).toBe(1);
  });
});

/**
 * ADR 0302 (AW24, analytics walk on Tuzlu Rüzgar, 2026-10-03). A check carried
 * no channel, so a street-fair booth's checks were scored as a server's table
 * service. The founder's ruling: *"Own row, POS field (Recommended)"* — the
 * channel comes from the POS, and a check that names none is table service.
 * Fork AW24-b, his pick *"Wait, then owner maps (Recommended)"*: no POS order
 * type is mapped to a channel yet, and the order type stays in `raw`.
 */
describe("a check carries its channel (ADR 0302)", () => {
  const base = {
    externalCheckId: "TR-2026-08-22-BOOTH",
    openedAt: "2026-08-22T16:00:00.000Z",
    tableRef: "BOOTH",
    serverName: "Kerem",
    items: [],
  };

  it("the canonical feed names it exactly: booth_event and table are read, case and spaces aside", () => {
    expect(
      genericAdapter.normalize({ ...base, channel: "booth_event" })[0].channel,
    ).toBe("booth_event");
    expect(
      genericAdapter.normalize({ ...base, channel: " Booth_Event " })[0]
        .channel,
    ).toBe("booth_event");
    expect(
      genericAdapter.normalize({ ...base, channel: "table" })[0].channel,
    ).toBe("table");
    // csv_import is the generic adapter under another key: Tuzlu posts through it.
    expect(
      ADAPTERS.csv_import.normalize({ ...base, channel: "booth_event" })[0]
        .channel,
    ).toBe("booth_event");
  });

  it("a check that names no channel, or one outside the vocabulary, carries none", () => {
    expect(genericAdapter.normalize(base)[0].channel).toBeNull();
    expect(
      genericAdapter.normalize({ ...base, channel: "catering" })[0].channel,
    ).toBeNull();
    expect(
      genericAdapter.normalize({ ...base, channel: 3 })[0].channel,
    ).toBeNull();
  });

  it("a table called BOOTH is not a channel: nothing is guessed from the table ref", () => {
    const [check] = genericAdapter.normalize(base);
    expect(check.tableRef).toBe("BOOTH");
    expect(check.channel).toBeNull();
  });

  it("checkChannelOf takes only an exact member of the vocabulary", () => {
    expect(CHECK_CHANNELS).toEqual(["table", "booth_event"]);
    expect(checkChannelOf("BOOTH_EVENT")).toBe("booth_event");
    expect(checkChannelOf("booth")).toBeNull();
    expect(checkChannelOf("booth event")).toBeNull();
    expect(checkChannelOf("")).toBeNull();
    expect(checkChannelOf(null)).toBeNull();
    expect(checkChannelOf(undefined)).toBeNull();
  });

  it("a Clover order type is not a table, and is not mapped to a channel yet (fork AW24-b)", () => {
    const order = {
      id: "clv-2",
      state: "paid",
      createdTime: 1784750400000,
      modifiedTime: 1784757600000,
      total: 12000,
      orderType: { id: "OT1", label: "Dine In" },
      employee: { id: "emp1", name: "Ada" },
      lineItems: { elements: [] },
    };
    const [check] = cloverAdapter.normalize(order);
    // Before ADR 0302 the order type was folded into the table slot.
    expect(check.tableRef).toBeNull();
    expect(check.channel).toBeNull();
    // The order type is kept, so the owner's mapping can read it later.
    expect((check.raw as any).orderType.label).toBe("Dine In");
  });

  it("the registry says Clover sends no table", () => {
    const clover = POS_PROVIDERS.find((p) => p.key === "clover");
    expect(clover?.capabilities.tables).toBe(false);
  });
});
