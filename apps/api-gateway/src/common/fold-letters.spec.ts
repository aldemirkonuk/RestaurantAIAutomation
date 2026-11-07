import * as fs from "fs";
import * as path from "path";

import { normalizeIdentityText } from "../vendor-intel/wine-identity";
import { normalizeSignatureText } from "../wines/wine-signature";
import {
  UNDECOMPOSABLE_LETTERS,
  foldUndecomposableLetters,
} from "./fold-letters";

const REPO = path.join(__dirname, "../../../..");
const MIGRATIONS = path.join(REPO, "supabase/migrations");

/**
 * The body of the LATEST migration's definition of public.<fn>, so a later
 * redefinition from an older body (one without the fold) fails here.
 */
function latestBody(fn: string): { file: string; body: string } {
  const head = `CREATE OR REPLACE FUNCTION public.${fn}(`;
  const file = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      fs.readFileSync(path.join(MIGRATIONS, f), "utf8").includes(head),
    )
    .pop();
  if (!file) throw new Error(`no migration defines public.${fn}`);
  const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
  const start = sql.lastIndexOf(head);
  const tag = /AS\s+(\$[a-z_]*\$)/i.exec(sql.slice(start));
  if (!tag) throw new Error(`no body for public.${fn} in ${file}`);
  const open = start + tag.index + tag[0].length;
  const close = sql.indexOf(tag[1], open);
  return { file, body: sql.slice(open, close) };
}

const sqlLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

describe("foldUndecomposableLetters", () => {
  it("folds Turkish dotless ı to i and leaves every other letter alone", () => {
    expect(foldUndecomposableLetters("Kavaklıdere")).toBe("Kavaklidere");
    expect(foldUndecomposableLetters("KARASI ıı")).toBe("KARASI ii");
    expect(foldUndecomposableLetters("Château Ökü")).toBe("Château Ökü");
    expect(foldUndecomposableLetters("")).toBe("");
  });

  it.each(
    UNDECOMPOSABLE_LETTERS.flatMap(([l, f]) => [
      ["normalizeSignatureText", normalizeSignatureText, l, f] as const,
      ["normalizeIdentityText", normalizeIdentityText, l, f] as const,
    ]),
  )("%s applies the table", (_name, normalize, letter, fold) => {
    expect(normalize(`x${letter}y`)).toBe(`x${fold}y`);
    expect(normalize(`X${letter.toUpperCase()}Y`)).toBe(
      normalize(`x${letter}y`),
    );
  });
});

describe("the SQL twin public.fold_undecomposable_letters", () => {
  it("folds exactly the TypeScript table, with translate()", () => {
    const { body } = latestBody("fold_undecomposable_letters");
    const from = UNDECOMPOSABLE_LETTERS.map(([l]) => l).join("");
    const to = UNDECOMPOSABLE_LETTERS.map(([, f]) => f).join("");
    expect(body).toContain(
      `translate(value, ${sqlLiteral(from)}, ${sqlLiteral(to)})`,
    );
  });

  // Each name normaliser that keys a product must call the shared fold in
  // its latest definition. A redefinition from an older body would drop it
  // silently and split "Kavaklıdere" from "KAVAKLIDERE" again.
  it.each(["wine_normalize_text", "beverage_normalize_text"])(
    "is called by the latest public.%s",
    (fn) => {
      const { body } = latestBody(fn);
      expect(body).toMatch(/public\.fold_undecomposable_letters\(/);
      // ...after the diacritic strip and before lower(), as in TypeScript:
      // lower( fold( regexp_replace( normalize(...) ...
      expect(body).toMatch(
        /lower\(\s*(--[^\n]*\n\s*)*public\.fold_undecomposable_letters\(\s*regexp_replace\(\s*normalize\(/,
      );
    },
  );
});

describe("the Python mirrors", () => {
  // Python cannot import this table. These files each keep a copy; their
  // behaviour is tested by scripts/test_fold_letters_mirrors.py (and
  // scripts/test_synth_identity.py), and their copy is pinned here.
  const MIRRORS = [
    "scripts/synth/identity.py",
    "scripts/load_enriched_wines.py",
    "scripts/eval_merge_policies.py",
  ];

  it.each(MIRRORS)("%s folds every letter in the table", (file) => {
    const src = fs.readFileSync(path.join(REPO, file), "utf8");
    for (const [letter, fold] of UNDECOMPOSABLE_LETTERS) {
      const code = letter.charCodeAt(0).toString(16).padStart(4, "0");
      expect(src).toContain(`"\\u${code}": "${fold}"`);
    }
  });
});
