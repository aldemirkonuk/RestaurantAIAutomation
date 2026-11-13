import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

/**
 * A SALE CARRIES ITS COST (cost-math lane 2.2; slug a_sale_carries_its_cost).
 * Stock that leaves a lot through apply_stock_movement writes one
 * inventory_lot_draws row per lot touched, stamped with that lot's cost, and
 * the ledger row carries cost_total and unpriced_qty. Pins the LAST
 * definition in replay order, so a later migration that re-creates
 * apply_stock_movement without the draws goes red. CI runs no SQL; the SQL
 * proof is supabase/tests/*_a_sale_carries_its_cost_test.sql (see the PR).
 */

const MIGRATIONS = join(
  resolve(__dirname, "../../../.."),
  "supabase/migrations",
);
const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .join("\n");

/** The last `CREATE [OR REPLACE] FUNCTION public.<name>(` body, up to its closing `$$;`. */
function lastFunction(name: string): string {
  const starts = [
    ...sql.matchAll(
      new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\(`, "g"),
    ),
  ];
  expect(starts.length).toBeGreaterThan(0);
  const start = starts[starts.length - 1].index!;
  const open = sql.indexOf("$$", start);
  return sql.slice(start, sql.indexOf("$$;", open + 2) + 3);
}

describe("a sale carries its cost", () => {
  it("apply_stock_movement writes its draws after the ledger row, from what the FIFO loop took", () => {
    const body = lastFunction("apply_stock_movement");
    const ledger = body.indexOf("INSERT INTO inventory_transactions");
    const draws = body.indexOf("INSERT INTO inventory_lot_draws");
    expect(ledger).toBeGreaterThan(-1);
    expect(draws).toBeGreaterThan(ledger);
    expect(body.indexOf("RETURNING id INTO v_txn")).toBeLessThan(draws);
    expect(body).toMatch(
      /SELECT v_restaurant, v_txn, d\.lot_id, p_inventory_id, d\.qty, d\.unit_cost, d\.cost_state, d\.cost_provenance/,
    );
    // The loop reads each lot's cost as it takes from it.
    expect(body).toMatch(
      /FOR v_lot IN SELECT id, qty, unit_cost, cost_state, cost_provenance FROM inventory_lots/,
    );
  });

  it("the ledger row carries cost_total (priced bottles only, NULL when none) and unpriced_qty", () => {
    const body = lastFunction("apply_stock_movement");
    expect(body).toMatch(/delivery_id,\s+cost_total, unpriced_qty\)/);
    expect(body).toMatch(/v_delivery,\s+v_cost_total, v_unpriced\)/);
    expect(body).toMatch(
      /v_cost_total := COALESCE\(v_cost_total, 0\) \+ v_take \* v_lot\.unit_cost/,
    );
    expect(body).toMatch(/v_unpriced := v_unpriced \+ GREATEST\(v_remaining, 0\)/);
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS cost_total numeric\(12,2\) NULL/,
    );
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS unpriced_qty integer NULL/);
  });

  it("an idempotent replay returns before any draw is written", () => {
    const body = lastFunction("apply_stock_movement");
    const replay = body.indexOf("IF v_txn IS NOT NULL THEN RETURN v_txn; END IF;");
    expect(replay).toBeGreaterThan(-1);
    expect(replay).toBeLessThan(body.indexOf("INSERT INTO inventory_lot_draws"));
  });

  it("transfer_stock writes no draw: the stock stays in the house", () => {
    expect(lastFunction("transfer_stock")).not.toMatch(/inventory_lot_draws/);
  });

  it("the draws are append-only: a trigger refuses UPDATE, DELETE and TRUNCATE", () => {
    const guard = lastFunction("inventory_lot_draws_append_only");
    expect(guard).toMatch(/inventory_lot_draws is append-only/);
    expect(sql).toMatch(
      /CREATE TRIGGER trg_inventory_lot_draws_append_only\s+BEFORE UPDATE OR DELETE ON public\.inventory_lot_draws\s+FOR EACH ROW EXECUTE FUNCTION public\.inventory_lot_draws_append_only\(\)/,
    );
    expect(sql).toMatch(
      /BEFORE TRUNCATE ON public\.inventory_lot_draws\s+FOR EACH STATEMENT/,
    );
    expect(sql).not.toMatch(
      /GRANT[^;]*\b(UPDATE|DELETE|ALL)\b[^;]*ON (TABLE )?public\.inventory_lot_draws/i,
    );
  });

  it("the draws have RLS on and no client grant", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.inventory_lot_draws ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON public\.inventory_lot_draws FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(sql).not.toMatch(
      /GRANT[^;]*ON (TABLE )?public\.inventory_lot_draws TO[^;]*\b(anon|authenticated)\b/i,
    );
  });
});
