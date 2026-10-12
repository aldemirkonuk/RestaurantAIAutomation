import { readFileSync } from "fs";
import { resolve } from "path";
import {
  COST_TAX_BASES,
  HOUSE_TAX_BASES,
  TAX_RATE_KEY_KINDS,
  asCostTaxBasis,
  asHouseTaxBasis,
  asTaxRateKeyKind,
} from "./tax-basis";

// src/common -> src -> api-gateway -> apps -> <repo root>
const MIGRATION = resolve(
  __dirname,
  "../../../../supabase/migrations/20270110000000_house_tax_basis_and_rates.sql",
);

const sql = readFileSync(MIGRATION, "utf8");

/** The quoted values of the `CHECK (<column> IN (...))` that names `column`. */
function checkList(column: string): string[] {
  const re = new RegExp(`(?<![a-z_])${column} IN \\(([^)]*)\\)`, "g");
  const lists = [...sql.matchAll(re)].map((m) =>
    [...m[1].matchAll(/'([a-z_]+)'/g)].map((v) => v[1]),
  );
  expect(lists.length).toBeGreaterThan(0);
  // Every CHECK on the column says the same thing.
  for (const l of lists) expect(l).toEqual(lists[0]);
  return lists[0];
}

describe("tax-basis vocabularies match their migration", () => {
  it("the house basis is the four states of restaurants.tax_basis and pos_checks.tax_basis", () => {
    expect(checkList("tax_basis")).toEqual([...HOUSE_TAX_BASES]);
  });

  it("a cost basis is the two states of each cost column", () => {
    expect(checkList("price_tax_basis")).toEqual([...COST_TAX_BASES]);
    expect(checkList("unit_cost_tax_basis")).toEqual([...COST_TAX_BASES]);
    expect(checkList("last_purchase_price_tax_basis")).toEqual([
      ...COST_TAX_BASES,
    ]);
  });

  it("a rate key is one of the three kinds of house_tax_rates.key_kind", () => {
    expect(checkList("key_kind")).toEqual([...TAX_RATE_KEY_KINDS]);
  });

  it("only 'unset' is a default; no answer is ever defaulted", () => {
    expect(sql).toMatch(/tax_basis TEXT NOT NULL DEFAULT 'unset'/);
    expect(sql).not.toMatch(/DEFAULT 'prices_(include|exclude)_tax'/);
    expect(sql).not.toMatch(/DEFAULT '(includes|excludes)_tax'/);
  });
});

describe("reading a basis never guesses one", () => {
  it("reads each known value as itself", () => {
    for (const b of HOUSE_TAX_BASES) expect(asHouseTaxBasis(b)).toBe(b);
    for (const b of COST_TAX_BASES) expect(asCostTaxBasis(b)).toBe(b);
    for (const k of TAX_RATE_KEY_KINDS) expect(asTaxRateKeyKind(k)).toBe(k);
  });

  it.each([null, undefined, "", "UNSET", "kdv_dahil", 1, {}])(
    "reads %p as not stated, never as unset or a basis",
    (v) => {
      expect(asHouseTaxBasis(v)).toBeNull();
      expect(asCostTaxBasis(v)).toBeNull();
      expect(asTaxRateKeyKind(v)).toBeNull();
    },
  );
});
