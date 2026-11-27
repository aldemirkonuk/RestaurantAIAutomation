import { InventoryService } from "./inventory.service";
import { settledMovesFrom, type SettledLot, type SettledRow } from "./settled-price-moves";

const lot = (id: string, inv: string, order: string | null, cost: number, at: string, prov = "invoice"): SettledLot => ({
  id,
  inventory_id: inv,
  source_order_id: order,
  delivery_id: null,
  unit_cost: cost,
  cost_provenance: prov,
  received_at: at,
});
const rv = (inv: string, order: string | null, cost: number, at: string, lotId: string | null = null): SettledRow => ({
  inventory_id: inv,
  lot_id: lotId,
  source_order_id: order,
  new_unit_cost: cost,
  new_cost_provenance: "invoice",
  created_at: at,
});

describe("a settled price is read from the lots too (r104 finding)", () => {
  it("a manual receipt between two door deliveries is a delivery in its own right", () => {
    const m = settledMovesFrom(
      [],
      [lot("a", "g", "o1", 10, "2026-01-01"), lot("b", "g", null, 13, "2026-01-15", "manual"), lot("c", "g", "o2", 10.5, "2026-02-01")],
    );
    expect(m.get("g")).toEqual({ last: 10.5, previous: 13 });
  });

  it("a good bought only through manual receipts has a signal", () => {
    const m = settledMovesFrom([], [lot("a", "g", null, 10, "2026-01-01", "manual"), lot("b", "g", null, 12, "2026-02-01", "manual")]);
    expect(m.get("g")).toEqual({ last: 12, previous: 10 });
  });

  it("a late invoice moves the price, not the order: deliveries are ordered by arrival", () => {
    // o1 arrived first but its invoice settled last (revaluation in March).
    const m = settledMovesFrom([rv("g", "o1", 11.05, "2026-03-01", "a")], [lot("a", "g", "o1", 11.05, "2026-01-01"), lot("b", "g", "o2", 10, "2026-02-01")]);
    expect(m.get("g")).toEqual({ last: 10, previous: 11.05 });
  });

  it("a revaluation of a lot that still exists is the same point, not a second one", () => {
    const m = settledMovesFrom([rv("g", "o1", 10, "2026-01-02", "a")], [lot("a", "g", "o1", 10, "2026-01-01")]);
    expect(m.has("g")).toBe(false);
  });

  it("a revaluation of a spent lot is still a delivery", () => {
    const m = settledMovesFrom([rv("g", "o1", 10, "2026-01-02", null)], [lot("b", "g", "o2", 12, "2026-02-01")]);
    expect(m.get("g")).toEqual({ last: 12, previous: 10 });
  });

  it("a provisional or estimated lot is not a settled price (the read asks only for final ones)", () => {
    const m = settledMovesFrom([], [lot("a", "g", "o1", 10, "2026-01-01"), lot("b", "g", "o2", 14, "2026-02-01", "estimated")]);
    expect(m.has("g")).toBe(false);
  });
});

describe("the list read asks for final lots of this house", () => {
  it("reads inventory_lots with cost_state final and settled provenance for one restaurant", async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      from: (table: string) => {
        const f: Record<string, unknown> = { table };
        seen.push(f);
        const c: any = {
          select: () => c,
          eq: (k: string, v: unknown) => ((f[k] = v), c),
          in: (k: string, v: unknown) => ((f[k] = v), c),
          order: () => c,
          range: () => c,
          then: (res: any) =>
            res(
              table === "inventory_lots"
                ? { data: [lot("a", "g1", null, 10, "2026-01-01", "manual"), lot("b", "g1", null, 13, "2026-02-01", "manual")], error: null, count: 2 }
                : { data: [], error: null, count: 0 },
            ),
        };
        return c;
      },
    };
    const db: any = { getClient: () => client, getRestaurantInventory: jest.fn().mockResolvedValue([{ id: "g1" }]) };
    const [row]: any[] = await new InventoryService(db).getRestaurantInventory("r1");
    const read = seen.find((f) => f.table === "inventory_lots")!;
    expect(read).toMatchObject({ restaurant_id: "r1", cost_state: "final", cost_provenance: ["invoice", "manual"] });
    expect(row).toMatchObject({ lastSettledCost: 13, previousSettledCost: 10 });
  });
});
