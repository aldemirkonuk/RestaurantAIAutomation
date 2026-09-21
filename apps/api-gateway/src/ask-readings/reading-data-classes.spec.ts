import {
  ANSWER_KINDS,
  classesOfFields,
  countClassOf,
  DATA_CLASSES,
  FIELD_CLASS,
  policyFor,
  policyRoleFor,
  policySha,
  ROLE_POLICY,
  ROLE_POLICY_FALLBACK,
  rolesSeeing,
  withholdTraceCounts,
} from "./reading-data-classes";
import { Finding } from "./reading.types";
import { READING_CATALOGUE, shownFields } from "./reading-catalogue";
import { RecordingSession, ReadingFailure } from "./recording-session";

// Founder, 2026-09-21, the option "Rules in code, label rows": what a person
// may see is a rule in a table, never a model behaviour. These tests hold the
// TABLE to the properties the gate depends on; reading-catalogue.spec.ts holds
// the derived per-Reading matrix; bound-ask.service.spec.ts holds the dispatch.

describe("FIELD_CLASS: every tag is a real class and every tag is shown by some Reading", () => {
  it("each tag names one of the classes (a row view is `relation@view.column`)", () => {
    for (const [field, cls] of Object.entries(FIELD_CLASS)) {
      expect(field).toMatch(/^[a-z_]+(@[a-z_]+)?\.([a-z_]+|\*)$/);
      expect(DATA_CLASSES).toContain(cls);
    }
  });

  it("no tag describes a field nothing shows -- a stale tag would read as a decision still in force", () => {
    const shown = new Set(READING_CATALOGUE.flatMap(r => shownFields(r)));
    // A relation some Reading reads is counted in the trace, so its `.*` tag is live.
    const counted = new Set(READING_CATALOGUE.flatMap(r => r.shelves.map(rel => `${rel}.*`)));
    expect(Object.keys(FIELD_CLASS).filter(f => !shown.has(f) && !counted.has(f))).toEqual([]);
  });

  it("every relation a Reading reads carries a row-count class, so its trace count has an owner", () => {
    for (const r of READING_CATALOGUE) for (const rel of r.shelves) expect(countClassOf(rel)).not.toBeNull();
  });

  it("an untagged field is an error, never 'no class'", () => {
    expect(() => classesOfFields(["restaurant_inventory.stock_live", "pos_checks.revenue"])).toThrow("untagged_shown_field:pos_checks.revenue");
  });
});

describe("ROLE_POLICY: one table, and the fallback row is the least privileged", () => {
  it("every row names only real classes, real answer kinds and a share between 0 and 1", () => {
    for (const row of Object.values(ROLE_POLICY)) {
      for (const c of row.sees) expect(DATA_CLASSES).toContain(c);
      for (const a of row.answers) expect(ANSWER_KINDS).toContain(a);
      expect(row.dailyAskBudgetShare).toBeGreaterThanOrEqual(0);
      expect(row.dailyAskBudgetShare).toBeLessThanOrEqual(1);
    }
  });

  it("the row an unknown role reads sees, answers and spends no more than any other row", () => {
    const fallback = ROLE_POLICY[ROLE_POLICY_FALLBACK];
    for (const row of Object.values(ROLE_POLICY)) {
      expect(fallback.sees.every(c => row.sees.includes(c))).toBe(true);
      expect(fallback.answers.every(a => row.answers.includes(a))).toBe(true);
      expect(fallback.dailyAskBudgetShare).toBeLessThanOrEqual(row.dailyAskBudgetShare);
    }
  });

  it("role resolution: case-insensitive, admin reads the owner row, anything else reads the fallback", () => {
    expect(policyRoleFor("Manager")).toBe("manager");
    expect(policyRoleFor("ADMIN")).toBe("owner");
    expect(policyRoleFor("chef")).toBe(ROLE_POLICY_FALLBACK);
    expect(policyRoleFor(null)).toBe(ROLE_POLICY_FALLBACK);
    expect(policyRoleFor(undefined)).toBe(ROLE_POLICY_FALLBACK);
    expect(policyFor("owner")).toBe(ROLE_POLICY.owner);
  });

  it("rolesSeeing: a class set staff do not see leaves owner and manager", () => {
    expect(rolesSeeing(["stock"])).toEqual(["owner", "manager", "staff"]);
    expect(rolesSeeing(["stock", "money"])).toEqual(["owner", "manager"]);
  });

  // Founder, 2026-09-21, round 6, his pick verbatim: "Yes, own-work only";
  // the meaning he approved, verbatim: "Staff can ask about stock, receiving
  // and today's deliveries. Money, supplier prices and people data are
  // refused with a one-line reason."
  it("round 6: staff see exactly stock, receiving and today's deliveries -- not money, suppliers, sales or people", () => {
    expect([...ROLE_POLICY.staff.sees].sort()).toEqual(["receiving", "stock", "todays_deliveries"]);
    for (const refused of ["money", "suppliers", "sales", "people"] as const) expect(ROLE_POLICY.staff.sees).not.toContain(refused);
    expect(ROLE_POLICY.staff.answers).toEqual(["reading", "model_knowledge"]);
    expect(ROLE_POLICY.staff.dailyAskBudgetShare).toBe(1); // no per-role cap; the house allowance bounds it
    for (const role of ["owner", "manager"] as const) expect([...ROLE_POLICY[role].sees].sort()).toEqual([...DATA_CLASSES].sort());
  });

  it("policySha is computed from the table's content: one changed share changes it", () => {
    const changed = { ...ROLE_POLICY, staff: { ...ROLE_POLICY.staff, dailyAskBudgetShare: 0.5 } };
    expect(policySha()).toMatch(/^[0-9a-f]{64}$/);
    expect(policySha(changed)).not.toBe(policySha());
    expect(policySha({ ...ROLE_POLICY })).toBe(policySha());
  });
});

describe("RecordingSession: a cell may be minted only from a field its Reading declares", () => {
  const books = {
    from(table: string) {
      const rows = table === "pos_checks"
        ? [{ id: "c1", restaurant_id: "h", covers: 2, revenue: 900 }]
        : [];
      const q: any = {
        select: () => q, eq: () => q, order: () => q, range: () => q,
        then: (resolve: any, reject: any) => Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve, reject),
      };
      return q;
    },
  };

  it("a declared field mints; an undeclared column of the same relation is refused undeclared_field", async () => {
    const s = new RecordingSession(books, () => new Date("2026-09-21T00:00:00Z"), new Set(["pos_checks.covers", "pos_checks.*"]));
    const e = await s.read(c => c.from("pos_checks").select("id,restaurant_id,covers,revenue", { count: "exact" }), () => true);
    const row = s.rows(e)[0];
    expect(s.field(e, row, "covers", "Covers").value).toBe(2);
    expect(s.count(e, "n", "Checks").value).toBe(1);
    expect(() => s.field(e, row, "revenue", "Revenue")).toThrow(ReadingFailure);
    try { s.field(e, row, "revenue", "Revenue"); } catch (error) { expect((error as ReadingFailure).reason).toBe("undeclared_field"); }
    expect(() => s.sum(e, "revenue", "r", "Revenue", "TRY")).toThrow(ReadingFailure);
  });

  it("a session given no declared fields mints nothing at all (fail closed)", async () => {
    const s = new RecordingSession(books);
    const e = await s.read(c => c.from("pos_checks").select("id", { count: "exact" }), () => true);
    expect(() => s.count(e, "n", "Checks")).toThrow(ReadingFailure);
  });

  it("a count needs the relation's row-count tag, not just one of its columns", async () => {
    const s = new RecordingSession(books, undefined, new Set(["pos_checks.covers"]));
    const e = await s.read(c => c.from("pos_checks").select("id", { count: "exact" }), () => true);
    expect(() => s.count(e, "n", "Checks")).toThrow(ReadingFailure);
  });
});

// Founder, 2026-09-21, round 6, his pick verbatim: "Hide by data type". A
// Finding's source trace shows a table's row count only to a role that may
// read that table's class; otherwise the count is withheld and says so.
describe("withholdTraceCounts: the trace hides by data type", () => {
  const trace = (relation: string, n: number) => ({ relation, operation: "select" as const, outcome: n ? "rows" as const : "empty" as const,
    rowsScanned: n, matchedRows: n, asOf: "2026-09-21T00:00:00.000Z" });
  const finding = (entries: Finding["trace"]): Finding => ({ kind: "finding", readingId: "orders.lines", readingVersion: 1, args: {}, outcome: "read",
    reason: null, asOf: "2026-09-21T00:00:00.000Z", sourcesQueried: entries.map(e => e.relation), failedSources: [],
    rowsScanned: entries.reduce((n, e) => n + (e.rowsScanned as number), 0), trace: entries, rows: [], fingerprint: "f" });
  const orderLines = () => finding([trace("procurement_orders", 41), trace("procurement_order_items", 2)]);

  it("staff: the order book's count is withheld and says so, never 0; the lines' own count stays", () => {
    const seen = withholdTraceCounts(orderLines(), ROLE_POLICY.staff);
    expect(seen.trace[0]).toEqual({ relation: "procurement_orders", operation: "select", outcome: "withheld",
      rowsScanned: "withheld_for_your_role", matchedRows: "withheld_for_your_role", asOf: "2026-09-21T00:00:00.000Z" });
    expect(seen.trace[1]).toMatchObject({ relation: "procurement_order_items", rowsScanned: 2, matchedRows: 2 });
    // The total would let the hidden count be subtracted out.
    expect(seen.rowsScanned).toBe("withheld_for_your_role");
    expect(JSON.stringify(seen)).not.toContain("41");
  });

  it("manager: every count is shown, and the Finding is returned unchanged", () => {
    const original = orderLines();
    expect(withholdTraceCounts(original, ROLE_POLICY.manager)).toBe(original);
    expect(original.trace[0]).toMatchObject({ rowsScanned: 41, matchedRows: 41 });
  });

  // [2026-09-21, round 6 last call] A read writes one trace entry per 500-row
  // page, so a withheld relation's entry count would still be a count.
  it("a withheld relation read in pages leaves one entry; a shown one keeps every page", () => {
    const paged = finding([trace("procurement_orders", 500), trace("procurement_orders", 500), trace("procurement_orders", 41),
      trace("procurement_order_items", 500), trace("procurement_order_items", 2)]);
    const seen = withholdTraceCounts(paged, ROLE_POLICY.staff);
    expect(seen.trace.map(t => [t.relation, t.outcome])).toEqual([["procurement_orders", "withheld"],
      ["procurement_order_items", "rows"], ["procurement_order_items", "rows"]]);
    expect(withholdTraceCounts(paged, ROLE_POLICY.manager).trace).toHaveLength(5);
  });

  it("an empty read is withheld too -- 'empty' is a count of zero", () => {
    const seen = withholdTraceCounts(finding([trace("procurement_orders", 0)]), ROLE_POLICY.staff);
    expect(seen.trace[0].outcome).toBe("withheld");
  });

  it("a failed read carries no count and stays as it is; the total stays null", () => {
    const failed = finding([{ relation: "procurement_orders", operation: "select", outcome: "failed", rowsScanned: null, matchedRows: null,
      asOf: "2026-09-21T00:00:00.000Z", failureCode: "XX001" }]);
    failed.rowsScanned = null;
    expect(withholdTraceCounts(failed, ROLE_POLICY.staff)).toBe(failed);
  });

  it("a relation with no count tag is withheld from every role, owner included (fail closed)", () => {
    expect(countClassOf("secret_ledger")).toBeNull();
    const seen = withholdTraceCounts(finding([trace("secret_ledger", 3)]), ROLE_POLICY.owner);
    expect(seen.trace[0].rowsScanned).toBe("withheld_for_your_role");
  });
});
