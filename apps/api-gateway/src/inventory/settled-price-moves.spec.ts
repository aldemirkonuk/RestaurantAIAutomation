import { InventoryService } from "./inventory.service";
import { settledMovesFrom, type SettledRow } from "./settled-price-moves";

/**
 * The list row carries a good's last two settled delivery costs (r104 g3), so
 * the "Price signals" chip can say which goods' prices moved. Settled means
 * invoice or manual; one delivery is one point; a failed read is told apart
 * from no move; only this house's rows are asked for.
 */
const rv = (inv: string, order: string | null, cost: number | null, at: string, prov = "invoice"): SettledRow => ({
  inventory_id: inv,
  source_order_id: order,
  new_unit_cost: cost,
  new_cost_provenance: prov,
  created_at: at,
});

const rb = (order: string, cost: number, at: string, basis: string | null): SettledRow => ({
  ...rv("g1", order, cost, at),
  cost_tax_basis: basis,
});

describe("settledMovesFrom: the tax basis two costs hold (r108 inventory-1)", () => {
  it("two papers stating the same basis compare, and the move names it", () => {
    const m = settledMovesFrom([rb("o1", 10, "2026-01-01T00:00:00Z", "net"), rb("o2", 11.8, "2026-02-01T00:00:00Z", "net")]);
    expect(m.get("g1")).toEqual({ last: 11.8, previous: 10, basis: "net" });
    const g = settledMovesFrom([rb("o1", 11.8, "2026-01-01T00:00:00Z", "gross_cost"), rb("o2", 13, "2026-02-01T00:00:00Z", "gross_cost")]);
    expect(g.get("g1")?.basis).toBe("gross_cost");
  });

  it("a mixed pair names no basis: a net 10 and a gross 11.8 are the same price, not a move", () => {
    const m = settledMovesFrom([rb("o1", 10, "2026-01-01T00:00:00Z", "net"), rb("o2", 11.8, "2026-02-01T00:00:00Z", "gross_cost")]);
    expect(m.get("g1")?.basis).toBeUndefined();
  });

  it("an unstated basis on either side names none, and an unknown word is not a basis", () => {
    for (const pair of [
      ["net", null],
      [null, null],
      [null, "net"],
      ["included", "included"],
    ] as const) {
      const m = settledMovesFrom([rb("o1", 10, "2026-01-01T00:00:00Z", pair[0]), rb("o2", 11, "2026-02-01T00:00:00Z", pair[1])]);
      expect(m.get("g1")?.basis).toBeUndefined();
    }
  });

  it("a delivery's basis is its newest settled row's", () => {
    const m = settledMovesFrom([
      rb("o1", 10, "2026-01-01T00:00:00Z", "net"),
      rb("o2", 11, "2026-02-01T00:00:00Z", null),
      rb("o2", 11.5, "2026-02-02T00:00:00Z", "net"),
    ]);
    expect(m.get("g1")).toEqual({ last: 11.5, previous: 10, basis: "net" });
  });
});

describe("settledMovesFrom", () => {
  it("two settled deliveries give the newest and the one before", () => {
    const m = settledMovesFrom([rv("g1", "o1", 10, "2026-01-01T00:00:00Z"), rv("g1", "o2", 11.2, "2026-02-01T00:00:00Z")]);
    expect(m.get("g1")).toEqual({ last: 11.2, previous: 10 });
  });

  it("one delivery gives no move, never a zero", () => {
    expect(settledMovesFrom([rv("g1", "o1", 10, "2026-01-01T00:00:00Z")]).has("g1")).toBe(false);
  });

  it("an estimate or a sample price is not a settled price", () => {
    const m = settledMovesFrom([
      rv("g1", "o1", 10, "2026-01-01T00:00:00Z"),
      rv("g1", "o2", 99, "2026-02-01T00:00:00Z", "estimated"),
      rv("g1", "o3", 99, "2026-03-01T00:00:00Z", "sample"),
    ]);
    expect(m.has("g1")).toBe(false);
  });

  it("a correction moves the delivery's price, not its date; lots settled in one go are one point", () => {
    const m = settledMovesFrom([
      rv("g1", "o1", 10, "2026-01-01T00:00:00Z"),
      rv("g1", "o2", 12, "2026-02-01T00:00:00Z"),
      rv("g1", "o2", 12, "2026-02-01T00:00:00Z"),
      rv("g1", "o1", 9, "2026-03-01T00:00:00Z"),
    ]);
    // o1 was first settled in January, so it is still the earlier delivery; its price is the corrected 9.
    expect(m.get("g1")).toEqual({ last: 12, previous: 9 });
  });

  it("goods are kept apart, and an order-less settle is keyed by its moment", () => {
    const m = settledMovesFrom([
      rv("g1", null, 5, "2026-01-01T00:00:00Z"),
      rv("g1", null, 5, "2026-01-01T00:00:00Z"),
      rv("g1", null, 6, "2026-02-01T00:00:00Z"),
      rv("g2", "o9", 3, "2026-01-01T00:00:00Z"),
    ]);
    expect(m.get("g1")).toEqual({ last: 6, previous: 5 });
    expect(m.has("g2")).toBe(false);
  });

  it("a missing or negative cost is skipped", () => {
    const m = settledMovesFrom([rv("g1", "o1", null, "2026-01-01T00:00:00Z"), rv("g1", "o2", 4, "2026-02-01T00:00:00Z")]);
    expect(m.has("g1")).toBe(false);
  });
});

describe("the list read carries the settled costs", () => {
  function service(revals: { data?: any[]; error?: any }) {
    const calls: { table: string; filters: Record<string, unknown> }[] = [];
    const client = {
      from: (table: string) => {
        const call = { table, filters: {} as Record<string, unknown> };
        calls.push(call);
        const chain: any = {
          select: () => chain,
          eq: (k: string, v: unknown) => ((call.filters[k] = v), chain),
          in: (k: string, v: unknown) => ((call.filters[k] = v), chain),
          order: () => chain,
          range: () => chain,
          then: (res: any) =>
            res(table === "inventory_lot_revaluations" ? { data: revals.data ?? [], error: revals.error ?? null } : { data: [], error: null }),
        };
        return chain;
      },
    };
    const db: any = {
      getClient: () => client,
      getRestaurantInventory: jest.fn().mockResolvedValue([{ id: "g1", wine_name: "Gin" }, { id: "g2", wine_name: "Rum" }]),
    };
    return { svc: new InventoryService(db), calls };
  }

  it("a row with two settled deliveries names both; one with none says nothing; the read is one house's, settled only", async () => {
    const { svc, calls } = service({
      data: [rv("g1", "o2", 11.2, "2026-02-01T00:00:00Z"), rv("g1", "o1", 10, "2026-01-01T00:00:00Z")],
    });
    const out: any[] = await svc.getRestaurantInventory("r1");
    expect(out[0]).toMatchObject({ lastSettledCost: 11.2, previousSettledCost: 10, settledCostsReadable: true, settledCostsCapped: false });
    expect(out[1].lastSettledCost).toBeUndefined();
    const read = calls.find((c) => c.table === "inventory_lot_revaluations")!;
    expect(read.filters.restaurant_id).toBe("r1");
    expect(read.filters.new_cost_provenance).toEqual(["invoice", "manual"]);
  });

  it("a failed read says it failed, and the rest of the list still answers", async () => {
    const { svc } = service({ error: { message: "timeout" } });
    const out: any[] = await svc.getRestaurantInventory("r1");
    expect(out).toHaveLength(2);
    expect(out[0].settledCostsReadable).toBe(false);
    expect(out[0].lastSettledCost).toBeUndefined();
  });
});
