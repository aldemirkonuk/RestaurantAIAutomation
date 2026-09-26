import {
  alterTableColumnClauses,
  blankSqlComments,
} from "./migration-alter-clauses";

const cols = (sql: string) =>
  alterTableColumnClauses(sql).map((c) => `${c.op} ${c.table}.${c.column}`);

describe("alterTableColumnClauses — the migration reader three specs share", () => {
  it("[REVERT-FAILS] reads every clause of a multi-column statement", () => {
    expect(
      cols(
        "ALTER TABLE public.t ADD COLUMN a text, ADD COLUMN IF NOT EXISTS b int, DROP COLUMN IF EXISTS c;",
      ),
    ).toEqual(["ADD t.a", "ADD t.b", "DROP t.c"]);
  });

  it("[REVERT-FAILS] a `;` inside a -- comment does not end the statement", () => {
    const sql = [
      "ALTER TABLE public.t",
      "  -- Set once; never advanced.",
      "  ADD COLUMN IF NOT EXISTS a date,",
      "  /* nested /* block; */ still comment; */",
      "  ADD COLUMN b date;",
    ].join("\n");
    expect(cols(sql)).toEqual(["ADD t.a", "ADD t.b"]);
  });

  it("[REVERT-FAILS] a commented-out rollback is not a live DROP", () => {
    const sql = [
      "ALTER TABLE public.t ADD COLUMN kind text;",
      "-- Rollback:",
      "-- ALTER TABLE public.t",
      "--   DROP COLUMN kind;",
      "/* ALTER TABLE public.t DROP COLUMN kind; */",
    ].join("\n");
    expect(cols(sql)).toEqual(["ADD t.kind"]);
  });

  it("[REVERT-FAILS] prose in a comment is not a clause", () => {
    expect(
      cols(
        "-- ALTER TABLE t ADD COLUMN x is sub-second at this size;\nSELECT 1;",
      ),
    ).toEqual([]);
  });

  it("[REVERT-FAILS] a `;` inside a string literal does not end the statement", () => {
    expect(
      cols(
        "ALTER TABLE t ADD COLUMN a text DEFAULT 'x; y -- not a comment', ADD COLUMN b text;",
      ),
    ).toEqual(["ADD t.a", "ADD t.b"]);
  });

  it("[REVERT-FAILS] a schema-qualified non-public table is not read as a table named after its schema", () => {
    expect(cols("ALTER TABLE auth.users ADD COLUMN x text;")).toEqual([]);
  });

  it("keeps clause order, so a DROP then re-ADD leaves the column present", () => {
    expect(
      cols("ALTER TABLE t DROP COLUMN a; ALTER TABLE t ADD COLUMN a text;"),
    ).toEqual(["DROP t.a", "ADD t.a"]);
  });

  it("reads an ALTER TABLE inside a DO block (dollar quotes are scanned as SQL)", () => {
    expect(
      cols("DO $$ BEGIN ALTER TABLE t ADD COLUMN a text; END $$;"),
    ).toEqual(["ADD t.a"]);
  });

  it("blanking preserves line count, strings and quoted identifiers", () => {
    const sql = "a -- x\n'--not' \"--id\" /* y\nz */ b";
    const out = blankSqlComments(sql);
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toContain("'--not'");
    expect(out).toContain('"--id"');
    expect(out).not.toMatch(/x|y|z/);
    expect(out.trim().endsWith("b")).toBe(true);
  });
});
