import {
  ADAPTERS,
  genericAdapter,
  squareAdapter,
  cloverAdapter,
  toastAdapter,
  readVoided,
  readMoney,
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

  it("square net sales leave out tax, tips and service charge (F-340)", () => {
    const [check] = squareAdapter.normalize({
      id: "sq-net",
      total_money: { amount: 13200 },
      net_amounts: {
        total_money: { amount: 13200 },
        tax_money: { amount: 1000 },
        tip_money: { amount: 1500 },
        service_charge_money: { amount: 700 },
        discount_money: { amount: 0 },
      },
    });
    expect(check.subtotal).toBeCloseTo(100);
    expect(check.total).toBeCloseTo(132);
    // No net_amounts at all is still "not recorded", never 0.
    const [bare] = squareAdapter.normalize({ id: "sq-bare" });
    expect(bare.subtotal).toBeNull();
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
 * F-572: a check the till took back is not a sale. Every revenue reader filters
 * `pos_checks` on `voided` alone, and the hub writes `voided: check.voided ===
 * true`, so an adapter that never set the flag made a voided Toast check and a
 * cancelled Square order count as takings.
 */
describe("a check the till took back lands voided (F-572)", () => {
  const toast = (over: Record<string, unknown>) =>
    toastAdapter.normalize({
      guid: "t-v",
      openedDate: "2026-10-01T18:00:00Z",
      closedDate: "2026-10-01T19:00:00Z",
      totalAmount: 118,
      ...over,
    })[0];

  it("a voided Toast check is voided", () => {
    expect(toast({ voided: true }).voided).toBe(true);
  });

  it("a deleted Toast check is voided", () => {
    expect(toast({ deleted: true }).voided).toBe(true);
  });

  it("an ordinary Toast check is not", () => {
    expect(toast({}).voided).toBe(false);
    expect(toast({ voided: false, deleted: false }).voided).toBe(false);
  });

  it("a cancelled Square order is voided; a completed or open one is not", () => {
    const square = (state: string) =>
      squareAdapter.normalize({
        id: "sq-v",
        state,
        created_at: "2026-10-01T18:00:00Z",
        closed_at: "2026-10-01T19:00:00Z",
        total_money: { amount: 11800 },
      })[0];
    expect(square("CANCELED").voided).toBe(true);
    expect(square("COMPLETED").voided).toBe(false);
    expect(square("OPEN").voided).toBe(false);
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
 * channel comes from the POS, *"else the check counts as table service"*.
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

describe("generic adapter reads voided strictly (sim F-397)", () => {
  const one = (voided: unknown) =>
    genericAdapter.normalize([{ externalCheckId: "c1", voided, items: [] }])[0];

  it("reads the word false as not voided", () => {
    expect(one("false").voided).toBe(false);
    expect(one("false").voidedUnread).toBeUndefined();
  });

  it.each([[true], ["true"], ["1"], [1], ["YES"]])(
    "reads %p as voided",
    (v) => {
      expect(one(v).voided).toBe(true);
    },
  );

  it.each([[false], ["0"], [0], ["no"], [null], [undefined], [""]])(
    "reads %p as not voided",
    (v) => {
      expect(one(v).voided).toBe(false);
      expect(one(v).voidedUnread).toBeUndefined();
    },
  );

  it("hands back a value it cannot read instead of guessing", () => {
    expect(one("maybe")).toMatchObject({
      voided: false,
      voidedUnread: "maybe",
    });
    expect(readVoided(2)).toEqual({ voided: false, unread: 2 });
  });
});

describe("toast drops a selection voided off the check (sim F-395)", () => {
  it("keeps only the selections that were sold", () => {
    const [check] = toastAdapter.normalize({
      guid: "t-v",
      closedDate: "2026-07-18T21:00:00Z",
      selections: [
        { displayName: "Sancerre", quantity: 1, price: 60, voided: true },
        { displayName: "Caymus", quantity: 2, price: 90, voided: false },
        { displayName: "Barolo", quantity: 1, price: 140 },
      ],
    });
    expect(check.items.map((i) => i.name)).toEqual(["Caymus", "Barolo"]);
  });
});

describe("money from a till is read in either locale, never guessed (sim F-396)", () => {
  it.each([
    ["1.250,00", 1250],
    ["1,250.00", 1250],
    ["1.350,50", 1350.5],
    ["100,00", 100],
    ["12,5", 12.5],
    ["12.50", 12.5],
    ["1250", 1250],
    ["₺1.250,00", 1250],
    ["1 250,00 TL", 1250],
    ["1.250.000", 1250000],
    [18, 18],
  ])("reads %p as %p", (raw, want) => {
    expect(readMoney(raw)).toEqual({ value: want });
  });

  it.each([
    ["1.250"],
    ["1,250"],
    ["12,50,1"],
    ["abc"],
    ["1,25.50"],
    ["1.2,5"],
    ["1.250,00,5"],
  ])("does not guess %p", (raw) => {
    expect(readMoney(raw)).toEqual({ value: null, unread: raw });
  });

  it("reads absent as absent, not as zero", () => {
    expect(readMoney(null)).toEqual({ value: null });
    expect(readMoney("")).toEqual({ value: null });
  });

  it("names the first money field it could not read", () => {
    const [c] = genericAdapter.normalize([
      {
        externalCheckId: "c1",
        total: "1.350,50",
        tip: "1.350",
        items: [{ name: "x", price: "1.250,00" }],
      },
    ]);
    expect(c.total).toBe(1350.5);
    expect(c.items[0].price).toBe(1250);
    expect(c.moneyUnread).toEqual({ field: "tip", value: "1.350" });
  });
});

describe("a line quantity is read in either locale, never guessed (sim F-1193)", () => {
  const CLOSED = "2026-10-08T21:00:00.000Z";
  // One check per adapter, carrying the given quantity on its only line.
  const byAdapter = (qty: unknown) => ({
    generic: genericAdapter.normalize([
      { externalCheckId: "g1", items: [{ name: "Rakı", qty }] },
    ])[0],
    square: squareAdapter.normalize({
      id: "s1",
      line_items: [{ name: "Rakı", quantity: qty }],
    })[0],
    clover: cloverAdapter.normalize({
      id: "c1",
      lineItems: { elements: [{ name: "Rakı", unitQty: qty }] },
    })[0],
    toast: toastAdapter.normalize({
      guid: "t1",
      closedDate: CLOSED,
      selections: [{ displayName: "Rakı", quantity: qty }],
    })[0],
  });

  it.each([
    ["0,5", 0.5],
    ["1.5", 1.5],
    ["2", 2],
    [3, 3],
  ])("reads %p as %p on every adapter", (qty, want) => {
    for (const c of Object.values(byAdapter(qty))) {
      expect(c.items[0].qty).toBe(want);
      expect(c.qtyUnread).toBeUndefined();
    }
  });

  it.each([["2,000"], ["1.250"], ["iki"]])(
    "names %p as unread on every adapter instead of reading one",
    (qty) => {
      for (const c of Object.values(byAdapter(qty))) {
        expect(c.qtyUnread).toEqual({ field: "items[0].qty", value: qty });
      }
    },
  );

  it("an absent quantity is still one, and is not unread", () => {
    for (const c of Object.values(byAdapter(undefined))) {
      expect(c.items[0].qty).toBe(1);
      expect(c.qtyUnread).toBeUndefined();
    }
  });
});

describe("a check with no opening time is dated by its close (sim F-1194)", () => {
  const CLOSED = "2026-10-01T21:00:00.000Z";

  it("every adapter opens a closed check at its close, not at arrival", () => {
    expect(
      genericAdapter.normalize([
        { externalCheckId: "g1", closed_at: CLOSED },
      ])[0].openedAt,
    ).toBe(CLOSED);
    expect(
      squareAdapter.normalize({
        id: "s1",
        state: "COMPLETED",
        closed_at: CLOSED,
      })[0].openedAt,
    ).toBe(CLOSED);
    expect(
      cloverAdapter.normalize({
        id: "c1",
        state: "paid",
        modifiedTime: Date.parse(CLOSED),
      })[0].openedAt,
    ).toBe(CLOSED);
    expect(
      toastAdapter.normalize({ guid: "t1", closedDate: CLOSED })[0].openedAt,
    ).toBe(CLOSED);
  });

  it("an open check with neither time keeps its arrival time", () => {
    const before = Date.now();
    const opened = [
      genericAdapter.normalize([{ externalCheckId: "g1" }])[0],
      squareAdapter.normalize({ id: "s1", state: "OPEN" })[0],
      cloverAdapter.normalize({ id: "c1", state: "open" })[0],
      toastAdapter.normalize({ guid: "t1" })[0],
    ].map((c) => Date.parse(c.openedAt));
    for (const t of opened) expect(t).toBeGreaterThanOrEqual(before - 1000);
  });

  it("an opening time the till sent is kept", () => {
    expect(
      genericAdapter.normalize([
        {
          externalCheckId: "g1",
          opened_at: "2026-10-01T19:00:00.000Z",
          closed_at: CLOSED,
        },
      ])[0].openedAt,
    ).toBe("2026-10-01T19:00:00.000Z");
  });
});
