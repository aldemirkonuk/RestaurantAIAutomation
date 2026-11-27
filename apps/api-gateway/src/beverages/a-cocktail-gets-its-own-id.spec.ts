/**
 * A cocktail can be created: `public.cocktails.id` has a default (F-150).
 *
 * THE DEFECT: 20260817090000_cocktails.sql declares `id uuid PRIMARY KEY` with
 * no default, and `createCocktail` inserts no id, so on a database built from
 * the migrations every "Add a cocktail" and every "Copy" died with a NOT NULL
 * violation (HTTP 500). The fix (61bf0a10c) was on no branch that reaches main.
 *
 * This is a static check over the migration corpus and the service source,
 * the same way the repo's other schema specs are. The live behaviour (insert
 * without an id fails before, succeeds after) is proved in PGlite by
 * p4-scratch/sw-walk/r107/cocktail-id-pglite.mjs.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const MIGRATIONS = join(__dirname, "../../../../supabase/migrations");
const CREATED = "20260817090000";

const sql = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8");
const versions = () => readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();

describe("a cocktail gets its own id", () => {
  it("createCocktail sends no id, so the column must supply one", () => {
    const src = readFileSync(join(__dirname, "beverages.service.ts"), "utf8");
    const body = src.slice(src.indexOf("async createCocktail"), src.indexOf("async createCocktail") + 1500);
    expect(body).toContain('.from("cocktails")');
    expect(body).not.toMatch(/\bid:\s/);
  });

  it("a migration after the table's creation sets DEFAULT gen_random_uuid() on cocktails.id", () => {
    const later = versions().filter((f) => f.slice(0, 14) > CREATED);
    const sets = later.filter((f) =>
      /ALTER\s+TABLE\s+(?:public\.)?cocktails\s+ALTER\s+COLUMN\s+id\s+SET\s+DEFAULT\s+gen_random_uuid\(\)/i.test(
        sql(f).replace(/--[^\n]*/g, ""),
      ),
    );
    expect(sets.length).toBeGreaterThan(0);
  });

  it("the creating migration alone does not (this is the gap the spec closes)", () => {
    const created = versions().find((f) => f.startsWith(CREATED));
    expect(created).toBeDefined();
    const table = /CREATE TABLE IF NOT EXISTS public\.cocktails \(([\s\S]*?)\n\);/.exec(sql(created as string));
    expect(table).not.toBeNull();
    expect((table as RegExpExecArray)[1]).toMatch(/^\s*id\s+uuid PRIMARY KEY,/m);
  });

  it("no two migrations share a version (CLAUDE.md 5b)", () => {
    const v = versions().map((f) => f.slice(0, 14));
    expect(v.length - new Set(v).size).toBe(0);
  });
});
