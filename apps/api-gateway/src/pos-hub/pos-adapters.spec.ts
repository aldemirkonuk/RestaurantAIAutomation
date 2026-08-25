import {
  ADAPTERS,
  genericAdapter,
  squareAdapter,
  cloverAdapter,
  toastAdapter,
} from "./pos-adapters";
import { POS_PROVIDERS, registrySummary } from "./pos-provider.registry";

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
