/**
 * wine_consumption_log_cost_basis_check: the newest migration to set it lists every word.
 *
 * WHY. Several PRs each drop and re-add this CHECK (agreed_lot_wac, the restate
 * word, the pour words). A migration is numbered at merge, so whichever merges
 * last owns the final list, and a list that leaves a word out makes every sale
 * costed on it fail its wine_consumption_log insert with check_violation (the
 * POS hub only logs that, so the sale goes missing from the demand series).
 * Each of those migrations therefore carries the whole set, and this spec fails
 * when the newest-sorting one does not.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const REPO = join(__dirname, "../../../..");
const NAMED_BASES = [
  "invoice_lot_wac",
  "invoice_lot_wac_partial",
  "agreed_lot_wac",
  "last_purchase_price",
  "invoice_restated",
  "pour_lot_wac",
  "pour_lot_wac_partial",
];

/** The words a migration's ADD CONSTRAINT ... IN (...) names, or null if it does not add this CHECK. */
function basisWords(sql: string): string[] | null {
  const m = /ADD CONSTRAINT wine_consumption_log_cost_basis_check\s+CHECK\s*\(([\s\S]*?)\)\s*;/i.exec(sql);
  if (!m) return null;
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

/** Which required words the newest-sorting migration adding the CHECK leaves out. */
function missingFromNewest(files: { name: string; sql: string }[], required: string[]): string[] {
  const adding = files
    .filter((f) => basisWords(f.sql) !== null)
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const newest = adding[adding.length - 1];
  if (!newest) return required;
  const have = new Set(basisWords(newest.sql));
  return required.filter((w) => !have.has(w));
}

function saleCostBasisWords(): string[] {
  const src = readFileSync(join(__dirname, "sale-cost.ts"), "utf8");
  const m = /export type SaleCostBasis =([\s\S]*?);/.exec(src);
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
}

describe("wine_consumption_log_cost_basis_check", () => {
  it("the newest migration that sets it lists every cost basis word", () => {
    const dir = join(REPO, "supabase/migrations");
    const files = readdirSync(dir)
      .filter((n) => n.endsWith(".sql"))
      .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
    const required = [...new Set([...NAMED_BASES, ...saleCostBasisWords()])];
    expect(saleCostBasisWords().length).toBeGreaterThan(0);
    expect(missingFromNewest(files, required)).toEqual([]);
  });

  it("names a word the newest list leaves out (the merge-order failure)", () => {
    const list = (words: string[]) =>
      `ALTER TABLE t ADD CONSTRAINT wine_consumption_log_cost_basis_check\n CHECK (cost_basis IS NULL OR cost_basis IN (${words
        .map((w) => `'${w}'`)
        .join(", ")}));`;
    const wide = list(NAMED_BASES);
    const narrow = list(NAMED_BASES.filter((w) => w !== "agreed_lot_wac"));
    expect(
      missingFromNewest(
        [
          { name: "20271220100000_a.sql", sql: narrow },
          { name: "20271222100000_b.sql", sql: wide },
        ],
        NAMED_BASES,
      ),
    ).toEqual([]);
    expect(
      missingFromNewest(
        [
          { name: "20271222100000_b.sql", sql: wide },
          { name: "20271230000000_c.sql", sql: narrow },
        ],
        NAMED_BASES,
      ),
    ).toEqual(["agreed_lot_wac"]);
  });
});
