import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

/**
 * A USED-UP LOT IS KEPT (R6 of PR #589; slug a_used_up_lot_is_kept). Pins the
 * LAST definition of each object in replay order, so a later migration that
 * brings a DELETE back goes red. CI runs no SQL; see the PR for the SQL proof.
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

/** The last `CREATE [OR REPLACE] VIEW public.<name> AS` statement. */
function lastView(name: string): string {
  const start = sql.lastIndexOf(`VIEW public.${name} AS`);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(";", start) + 1);
}

const DELETES_A_LOT = /DELETE\s+FROM\s+(public\.)?inventory_lots/i;
const HOLDS_STOCK = "WHERE ((qty > 0) OR (open_bottle_ml > 0))";

describe("a used-up lot is kept, never deleted", () => {
  it("apply_stock_movement sets a lot drawn to zero to qty 0 instead of deleting it", () => {
    const body = lastFunction("apply_stock_movement");
    expect(body).not.toMatch(DELETES_A_LOT);
    expect(body).toMatch(
      /UPDATE inventory_lots SET qty = 0, updated_at = now\(\) WHERE id = v_lot\.id/,
    );
  });

  it("transfer_stock moves a whole lot by changing its location, not by delete and copy", () => {
    const body = lastFunction("transfer_stock");
    expect(body).not.toMatch(DELETES_A_LOT);
    expect(body).toMatch(
      /UPDATE inventory_lots SET location_id = p_to_location_id/,
    );
  });

  it("one trigger marks a lot that holds nothing as depleted, for every writer", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS depleted_at timestamptz/);
    const mark = lastFunction("mark_used_up_lot");
    expect(mark).toMatch(/NEW\.qty = 0 AND NEW\.open_bottle_ml = 0/);
    expect(mark).toMatch(/NEW\.status := 'depleted'/);
    expect(sql).toMatch(
      /BEFORE INSERT OR UPDATE OF qty, open_bottle_ml ON public\.inventory_lots\s+FOR EACH ROW EXECUTE FUNCTION public\.mark_used_up_lot\(\)/,
    );
  });

  it.each(["inventory_lot_rollup", "inventory_location_breakdown"])(
    "%s counts only lots that hold stock",
    (view) => {
      expect(lastView(view)).toContain(HOLDS_STOCK);
    },
  );
});
