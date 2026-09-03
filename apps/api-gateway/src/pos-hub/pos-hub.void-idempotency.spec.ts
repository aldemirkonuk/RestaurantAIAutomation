import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * THE VOID KEY (ADR 0093 D5).
 *
 * `applyStockEffects` used the SAME `p_idempotency_key` for a void that the
 * sale had used. The production definition of `apply_stock_movement` (read
 * 2026-09-02) opens with:
 *
 *     SELECT id INTO v_existing FROM inventory_transactions
 *      WHERE idempotency_key = p_idempotency_key ...;
 *     IF FOUND THEN RETURN v_existing; END IF;
 *
 * — so the void returned the SALE's transaction id and moved nothing. Stock
 * stayed depleted for a check the restaurant voided, forever, silently.
 *
 * `pos-hub.service.spec.ts`'s "reverses a bottle void with a positive return
 * delta (B19)" could not see this: its mock `rpc()` ignores the key entirely,
 * so it asserted the ARGUMENTS the app sent and never the EFFECT the database
 * would have had. That is the whole lesson here — a mock that cannot express
 * the contract cannot test the contract.
 *
 * The mock below DOES express it: `apply_stock_movement` is idempotent on the
 * key, and `stockLive` only moves when a key is new. So the assertions are
 * about the resulting stock level, not about argument shapes.
 *
 * NOT WIDENED: "voiding 5 glasses returns 5 bottles" (decision B19, recorded
 * as wrong in ADR 0011's Consequences and open as OD-67) is untouched. That is
 * a decision to supersede, not a bug to fold into this fix.
 */

type Row = Record<string, any>;

/**
 * A database whose `apply_stock_movement` behaves like the real one: a key it
 * has already seen returns the first transaction and moves NOTHING.
 */
function makeIdempotentDb(opening: number) {
  const seen = new Map<string, { id: string; delta: number }>();
  const state = { stockLive: opening };
  const calls: Array<{ name: string; args: Row; moved: boolean }> = [];

  const client: any = {
    from(table: string) {
      const q: any = {
        _table: table,
        select: () => q,
        eq: () => q,
        in: () => q,
        upsert: async () => ({ error: null }),
        insert: async () => ({ error: null }),
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({
          data: [
            {
              external_item_id: "item-1",
              item_name: "Caymus Cabernet",
              is_wine: true,
              inventory_id: "inv-1",
              sale_unit: "bottle",
            },
          ],
          error: null,
        });
      }
      if (table === "restaurant_inventory") {
        q.in = async () => ({
          data: [{ id: "inv-1", bottle_size_ml: 750, pour_size_ml: 150 }],
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      return q;
    },
    rpc: async (name: string, args: Row) => {
      const key = args.p_idempotency_key as string;
      if (name === "apply_stock_movement") {
        const prior = seen.get(key);
        if (prior) {
          // The early return. No delta is applied — this is the defect's
          // whole mechanism, and the caller cannot tell from the result.
          calls.push({ name, args, moved: false });
          return { data: prior.id, error: null };
        }
        state.stockLive += Number(args.p_delta) || 0;
        const id = `tx-${seen.size + 1}`;
        seen.set(key, { id, delta: Number(args.p_delta) || 0 });
        calls.push({ name, args, moved: true });
        return { data: id, error: null };
      }
      if (name === "record_glass_pour") {
        const prior = seen.get(key);
        if (prior) {
          calls.push({ name, args, moved: false });
          return { data: prior.id, error: null };
        }
        const id = `pour-${seen.size + 1}`;
        seen.set(key, { id, delta: 0 });
        calls.push({ name, args, moved: true });
        return { data: id, error: null };
      }
      calls.push({ name, args, moved: true });
      return { data: null, error: null };
    },
  };

  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    state,
    calls,
    seen,
  };
}

const check = (over: Row = {}) => ({
  externalCheckId: "chk-void-1",
  openedAt: "2026-09-02T18:00:00Z",
  closedAt: "2026-09-02T19:00:00Z",
  items: [
    { name: "Caymus Cabernet", externalItemId: "item-1", qty: 2, price: 90 },
  ],
  ...over,
});

describe("PosHubService — a void moves stock under its own key (ADR 0093 D5)", () => {
  it("returns the bottles a voided check took, against an idempotent apply_stock_movement", async () => {
    const { db, state, calls } = makeIdempotentDb(12);
    const service = new PosHubService(db);

    await service.ingest("r1", "generic_webhook", [check()]);
    expect(state.stockLive).toBe(10); // the sale took 2

    await service.ingest("r1", "generic_webhook", [check({ voided: true })]);

    // THE ASSERTION THAT MATTERS: the effect, not the arguments. Before the
    // fix this is still 10 — the void reused the sale's key, the RPC returned
    // the sale's transaction, and nothing moved.
    expect(state.stockLive).toBe(12);

    const movements = calls.filter((c) => c.name === "apply_stock_movement");
    expect(movements).toHaveLength(2);
    const [sale, voidMove] = movements;
    expect(sale.args.p_delta).toBe(-2);
    expect(voidMove.args.p_delta).toBe(2);
    expect(voidMove.args.p_transaction_type).toBe("return");
    expect(voidMove.moved).toBe(true);
    // Distinct keys, and the void's is derived from the sale's so a REPLAYED
    // void is still idempotent.
    expect(voidMove.args.p_idempotency_key).not.toBe(
      sale.args.p_idempotency_key,
    );
    expect(voidMove.args.p_idempotency_key).toBe(
      `${sale.args.p_idempotency_key}:void`,
    );
  });

  it("replaying the same void does not return the stock twice", async () => {
    const { db, state } = makeIdempotentDb(12);
    const service = new PosHubService(db);

    await service.ingest("r1", "generic_webhook", [check()]);
    await service.ingest("r1", "generic_webhook", [check({ voided: true })]);
    await service.ingest("r1", "generic_webhook", [check({ voided: true })]);

    // The void's key is stable, so the second delivery of the same void is a
    // no-op — the idempotency the sale already had, extended to the reversal.
    expect(state.stockLive).toBe(12);
  });

  it("a glass void reverses under its own key too (B19 unchanged, and still wrong)", async () => {
    const { db, state, calls } = makeIdempotentDb(12);
    const service = new PosHubService(db);

    // sale_unit 'glass' pours; the void of that sale goes through
    // apply_stock_movement, which is decision B19 and returns WHOLE BOTTLES.
    // OD-67 owns that; this test pins the KEY, and records the wrongness so a
    // later reader does not mistake it for an oversight.
    const glassDb: any = (db as any).getClient();
    const originalFrom = glassDb.from.bind(glassDb);
    glassDb.from = (table: string) => {
      const q = originalFrom(table);
      if (table === "pos_item_mappings") {
        q.in = async () => ({
          data: [
            {
              external_item_id: "item-1",
              item_name: "Caymus Cabernet",
              is_wine: true,
              inventory_id: "inv-1",
              sale_unit: "glass",
            },
          ],
          error: null,
        });
      }
      return q;
    };

    await service.ingest("r1", "generic_webhook", [check()]);
    // A pour does not move this mock's bottle count; only the void does.
    await service.ingest("r1", "generic_webhook", [check({ voided: true })]);

    const movements = calls.filter((c) => c.name === "apply_stock_movement");
    expect(movements).toHaveLength(1);
    expect(movements[0].args.p_delta).toBe(2); // B19: 2 glasses → 2 bottles
    expect(String(movements[0].args.p_idempotency_key)).toMatch(/:void$/);
    expect(state.stockLive).toBe(14); // 12 + B19's over-return, recorded not fixed
  });
});
