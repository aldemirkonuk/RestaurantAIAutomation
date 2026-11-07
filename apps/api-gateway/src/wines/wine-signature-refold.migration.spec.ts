import * as fs from "fs";
import * as path from "path";

/**
 * The dotless-ı refold must never merge two wines (QA round 5, #785).
 *
 * The behaviour is proven in PGlite 0.5.8 over every migration before it
 * (p4-scratch/pglite-probe/f785-wave3-refold-proof.mjs: 29 checks, and a
 * second run changes nothing). This pins the lines that proof depends on, so
 * an edit that drops one fails here rather than on the UNIQUE index in
 * production.
 */
const SQL = fs.readFileSync(
  path.join(
    __dirname,
    "../../../../supabase/migrations/20270405100000_wine_signatures_refold_dotless_i.sql",
  ),
  "utf8",
);
const code = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("wine_signatures_refold_dotless_i", () => {
  it("skips a row whose folded hash another row already holds, before writing", () => {
    const skip = code.indexOf("CONTINUE WHEN v_holder IS NOT NULL;");
    const write = code.indexOf("UPDATE public.master_wine_library");
    expect(skip).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(skip);
    expect(code).toMatch(
      /WHERE m\.signature_hash = r\.correct_hash AND m\.id <> r\.id/,
    );
  });

  it("moves a roster copy only where its venue does not already hold the new hash", () => {
    expect(code).toMatch(
      /UPDATE public\.restaurant_wine_roster w\s+SET signature_hash = r\.correct_hash\s+WHERE w\.signature_hash = r\.stored_hash\s+AND NOT EXISTS \(\s*SELECT 1 FROM public\.restaurant_wine_roster x\s+WHERE x\.restaurant_id = w\.restaurant_id\s+AND x\.signature_hash = r\.correct_hash\)/,
    );
  });

  it("records every held-back pair, once", () => {
    const inserts = code.match(
      /INSERT INTO public\.wine_signature_refold_review[\s\S]*?;/g,
    );
    expect(inserts).toHaveLength(2);
    for (const ins of inserts ?? []) {
      expect(ins).toContain(
        "ON CONFLICT ON CONSTRAINT wine_signature_refold_review_once DO NOTHING",
      );
    }
    expect(code).toMatch(
      /CONSTRAINT wine_signature_refold_review_once\s+UNIQUE \(table_name, row_id, folded_hash\)/,
    );
  });

  it("touches only live drifting rows with an ı, and merges nothing", () => {
    expect(code).toContain("FROM public.v_signature_drift d");
    expect(code).toContain("d.stored_hash IS NOT NULL");
    expect(code).toMatch(/LIKE '%ı%'/);
    // The table COMMENT names merge_library_wines as the way to resolve a
    // pair; the migration itself must never call it.
    expect(code).not.toMatch(
      /(PERFORM|SELECT)\s+(public\.)?merge_library_wines\(|DELETE FROM|SET signature_hash = NULL/,
    );
  });

  it("keeps the review table to the service role", () => {
    expect(code).toContain(
      "ALTER TABLE public.wine_signature_refold_review ENABLE ROW LEVEL SECURITY;",
    );
    expect(code).toContain(
      "REVOKE ALL ON public.wine_signature_refold_review FROM anon, authenticated;",
    );
    expect(code).toMatch(
      /FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/,
    );
  });
});
