import * as fs from "node:fs";
import * as path from "node:path";
import {
  ORDER_TRANSITIONS,
  orderStatusVocabulary,
  orderTransitionEdges,
  renderOrderTransitionSqlArrays,
} from "./order-transitions";
import { ProcurementOrderStatus } from "./dto/procurement.dto";

/**
 * ONE definition of the transition table, in two languages.
 *
 * ADR 0125 Q2, founder 2026-09-05: *"Enforce the table as a database trigger"* —
 * with the standing condition that the TypeScript table and the SQL table must
 * be one definition, generated or asserted equal, so they cannot drift.
 *
 * They CAN drift, easily and silently: the trigger is enforced in production
 * where no TypeScript runs, and an edge added to the .ts to unblock a build
 * would leave the database still refusing it — the worst kind of divergence,
 * because the service would report a legal move and the write would fail
 * underneath it with a different sentence.
 *
 * So the migration's two ARRAY literals are RENDERED here and matched character
 * for character. `scripts/check_order_transition_sql.py` does the same
 * comparison from the other side (parsing both files independently, in Python)
 * so a change to the renderer itself cannot make both halves agree on the wrong
 * thing.
 */

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, "supabase", "migrations"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate supabase/migrations/ above ${__dirname}. This test cannot ` +
      "verify a contract it cannot read; failing rather than passing vacuously.",
  );
}

const MIGRATION = path.join(
  repoRoot(),
  "supabase",
  "migrations",
  "20260905230000_an_order_changes_state_by_the_table.sql",
);

describe("the migration carries the TypeScript table, not a copy of it", () => {
  it("has a migration to compare against at all", () => {
    // A missing file must FAIL, never skip: "the guard could not run" and "the
    // guard passed" are the two things this house never lets look alike.
    expect(fs.existsSync(MIGRATION)).toBe(true);
  });

  const sql = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, "utf8") : "";

  it("carries the rendered EDGE list verbatim", () => {
    const { edges } = renderOrderTransitionSqlArrays();
    expect(edges.split("\n").length).toBeGreaterThan(10);
    expect(sql).toContain(edges);
  });

  it("carries the rendered VOCABULARY verbatim", () => {
    const { vocabulary } = renderOrderTransitionSqlArrays();
    expect(sql).toContain(vocabulary);
  });

  it("names every edge exactly once in the SQL, and no others", () => {
    // The independent direction: parse the SQL back out and compare SETS, so a
    // stray hand-added edge somewhere else in the file is caught even though
    // `toContain` above would still pass.
    const found = [...sql.matchAll(/'([A-Z_]+>[A-Z_]+)'/g)].map((m) => m[1]);
    expect([...found].sort()).toEqual(orderTransitionEdges());
    expect(new Set(found).size).toBe(found.length);
  });

  it("names every status member in the SQL vocabulary", () => {
    const block = /vocabulary text\[\] := ARRAY\[([\s\S]*?)\];/.exec(sql);
    expect(block).toBeTruthy();
    const found = [...block![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(found).toEqual(orderStatusVocabulary());
    expect(found).toEqual([...Object.values(ProcurementOrderStatus)].sort());
  });

  it("fires only on a status change, and only BEFORE the write", () => {
    // `OF status` is what keeps a notes-only UPDATE out of the trigger, and
    // BEFORE is what makes the refusal stop the write rather than follow it.
    expect(sql).toMatch(
      /BEFORE UPDATE OF status ON public\.procurement_orders/,
    );
  });

  it("returns early on a same-state write, and says why it must", () => {
    // The one deliberate asymmetry with the TypeScript. If this early return is
    // ever removed, editing the notes on a cancelled order starts failing in
    // production and nothing in TypeScript would show it.
    expect(sql).toMatch(/IF v_to IS NOT DISTINCT FROM v_from THEN\s*\n\s*RETURN NEW;/);
  });
});

describe("the renderer is the source, and it is not empty", () => {
  it("renders one edge per member of every list in the table", () => {
    const expected = Object.values(ProcurementOrderStatus).reduce(
      (n, s) => n + ORDER_TRANSITIONS[s].length,
      0,
    );
    expect(orderTransitionEdges()).toHaveLength(expected);
    expect(expected).toBeGreaterThan(20);
  });

  it("renders edges in a stable order, so a regeneration is not a diff", () => {
    expect(orderTransitionEdges()).toEqual([...orderTransitionEdges()].sort());
  });
});
