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
 * B19 (a bottle back per voided glass) was superseded on 2026-11-07 (ADR
 * 0011 amendment): every void calls `return_glass_pour`, same key rule. QA 8c:
 * it follows the unit the SALE was booked in, not today's mapping, and the mock
 * below models that booking.
 */

type Row = Record<string, any>;

/**
 * A database whose `apply_stock_movement` behaves like the real one: a key it
 * has already seen returns the first transaction and moves NOTHING.
 */
function makeIdempotentDb(opening: number) {
  const seen = new Map<string, { id: string; unit?: string; qty?: number }>();
  const given = new Map<string, number>();
  const state = { stockLive: opening, saleUnit: "bottle" };
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
              sale_unit: state.saleUnit,
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
        seen.set(key, { id, unit: "bottle", qty: -Number(args.p_delta) });
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
        seen.set(key, { id, unit: "glass", qty: Number(args.p_pours) });
        calls.push({ name, args, moved: true });
        return { data: id, error: null };
      }
      if (name === "return_glass_pour") {
        // The booked unit, capped once per sale; no booking is an error.
        const sale = seen.get(args.p_sale_key);
        if (seen.has(key) || !sale) {
          calls.push({ name, args, moved: false });
          return seen.has(key)
            ? { data: { idempotent: true }, error: null }
            : { data: null, error: { code: "P0002", message: "no sale booked" } };
        }
        const n = Math.min(Number(args.p_pours), sale.qty! - (given.get(args.p_sale_key) ?? 0));
        given.set(args.p_sale_key, (given.get(args.p_sale_key) ?? 0) + n);
        if (sale.unit === "bottle") state.stockLive += n;
        seen.set(key, { id: `ret-${seen.size + 1}` });
        calls.push({ name, args, moved: n > 0 });
        return { data: { [`returned_${sale.unit}s`]: n }, error: null };
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

    const [sale] = calls.filter((c) => c.name === "apply_stock_movement");
    const [voidMove] = calls.filter((c) => c.name === "return_glass_pour");
    expect(sale.args.p_delta).toBe(-2);
    expect(voidMove.args.p_sale_key).toBe(sale.args.p_idempotency_key);
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

  it("a glass void returns its sale's pour under its own key (G11)", async () => {
    const { db, state, calls } = makeIdempotentDb(12);
    const service = new PosHubService(db);

    // Under B19 this void was apply_stock_movement(+2): stockLive 14.
    state.saleUnit = "glass";

    await service.ingest("r1", "generic_webhook", [check()]);
    // Neither the pour nor its void moves this mock's bottle count.
    await service.ingest("r1", "generic_webhook", [check({ voided: true })]);

    expect(calls.filter((c) => c.name === "apply_stock_movement")).toEqual([]);
    expect(state.stockLive).toBe(12);
    const [sale] = calls.filter((c) => c.name === "record_glass_pour");
    const voids = calls.filter((c) => c.name === "return_glass_pour");
    expect(voids.map((c) => c.args)).toEqual([
      {
        p_restaurant_id: "r1",
        p_inventory_id: "inv-1",
        p_sale_key: sale.args.p_idempotency_key,
        p_pours: 2,
        p_idempotency_key: `${sale.args.p_idempotency_key}:void`,
        p_occurred_at: expect.any(String),
      },
    ]);
  });

  it("a bottle sale voided after the item became a glass gives the bottles back (QA 8c)", async () => {
    const { db, state } = makeIdempotentDb(12);
    const service = new PosHubService(db);

    await service.ingest("r1", "generic_webhook", [check()]);
    state.saleUnit = "glass";
    const out = await service.ingest("r1", "generic_webhook", [check({ voided: true })]);

    // Before: the void looked for a glass pour, found none and booked 0 quietly.
    expect(state.stockLive).toBe(12);
    expect(out.stock.failed).toBe(0);
  });

  it("a glass sale voided after the item became a bottle returns no whole bottles (QA 8c)", async () => {
    const { db, state, calls } = makeIdempotentDb(12);
    const service = new PosHubService(db);

    state.saleUnit = "glass";
    await service.ingest("r1", "generic_webhook", [check()]);
    state.saleUnit = "bottle";
    await service.ingest("r1", "generic_webhook", [check({ voided: true })]);

    // Before: apply_stock_movement(+2), two sealed bottles for two glasses.
    expect(state.stockLive).toBe(12);
    expect(calls.map((c) => c.name)).toEqual(["record_glass_pour", "return_glass_pour"]);
  });

  it("a void with no booked sale is a failure the import names, never a quiet 0", async () => {
    const { db, state } = makeIdempotentDb(12);
    const service = new PosHubService(db);

    const out = await service.ingest("r1", "generic_webhook", [check({ voided: true })]);

    expect(state.stockLive).toBe(12);
    expect(out.stock.failed).toBe(1);
  });
});
