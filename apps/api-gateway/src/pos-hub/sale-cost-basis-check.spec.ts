import { readdirSync, readFileSync } from "fs";
import { join } from "path";

// A cost basis the code can write must be one the table accepts: a refused
// insert is only logged, so the sale silently leaves the demand series.
const DIR = join(__dirname, "../../../../supabase/migrations");

function currentCheckList(): string[] {
  const files = readdirSync(DIR)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .sort();
  let list: string[] = [];
  for (const f of files) {
    const sql = readFileSync(join(DIR, f), "utf8");
    const m = sql.match(
      /ADD CONSTRAINT wine_consumption_log_cost_basis_check\s+CHECK \(cost_basis IS NULL OR cost_basis IN\s*\(([^)]*)\)\)/,
    );
    if (m) list = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  return list;
}

describe("wine_consumption_log.cost_basis accepts every SaleCostBasis", () => {
  const src = readFileSync(join(__dirname, "sale-cost.ts"), "utf8");
  const union = src.match(/export type SaleCostBasis =([^;]*);/);
  const bases = [...(union?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);

  it("reads the union from sale-cost.ts", () => {
    expect(bases).toContain("agreed_lot_wac");
  });

  it("the latest CHECK lists every basis the union names", () => {
    const allowed = currentCheckList();
    expect(allowed.length).toBeGreaterThan(0);
    for (const b of bases) expect(allowed).toContain(b);
  });
});
