import * as fs from "fs";
import * as path from "path";

import { DRINK_WORD_KINDS, FOOD_NOUNS } from "./menu-line-view";

/**
 * F-1314: library rows stored before F-1293 under a Turkish section are
 * refiled by a migration that reads the section with the import's own words.
 * The SQL cannot import menu-line-view.ts, so this reads its two word lists
 * out of the migration and holds them equal to the import's: a word added to
 * one side and not the other would file the same heading two ways.
 */
const MIGRATION = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20270105400000_a_drink_stored_under_a_turkish_section_is_refiled_by_its_kind.sql",
);

function block(sql: string, name: string): string {
  const start = sql.indexOf(`${name}(`);
  if (start < 0) throw new Error(`${name} not found in the migration`);
  const values = sql.indexOf("VALUES", start);
  const end = sql.indexOf("\n  ),", values);
  return sql.slice(values, end);
}

describe("the refile migration reads Turkish sections as the import does (F-1314)", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");

  it("maps each drink word to the same kind as DRINK_WORD_KINDS", () => {
    const pairs = [
      ...block(sql, "drink_word_kinds").matchAll(/\('([^']+)', '([^']+)'\)/g),
    ].map((m) => [m[1], m[2]]);
    expect(pairs).toEqual(DRINK_WORD_KINDS.map(([w, k]) => [w, k]));
  });

  it("leaves a section that names food alone, by the same FOOD_NOUNS", () => {
    const nouns = [...block(sql, "food_nouns").matchAll(/\('([^']+)'\)/g)].map(
      (m) => m[1],
    );
    expect(nouns).toEqual([...FOOD_NOUNS]);
  });
});
