import {
  ANSWER_KINDS,
  classesOfFields,
  DATA_CLASSES,
  FIELD_CLASS,
  policyFor,
  policyRoleFor,
  policySha,
  ROLE_POLICY,
  ROLE_POLICY_FALLBACK,
  rolesSeeing,
} from "./reading-data-classes";
import { READING_CATALOGUE, shownFields } from "./reading-catalogue";
import { RecordingSession, ReadingFailure } from "./recording-session";

// Founder, 2026-09-21, the option "Rules in code, label rows": what a person
// may see is a rule in a table, never a model behaviour. These tests hold the
// TABLE to the properties the gate depends on; reading-catalogue.spec.ts holds
// the derived per-Reading matrix; bound-ask.service.spec.ts holds the dispatch.

describe("FIELD_CLASS: every tag is a real class and every tag is shown by some Reading", () => {
  it("each tag names one of the five classes", () => {
    for (const [field, cls] of Object.entries(FIELD_CLASS)) {
      expect(field).toMatch(/^[a-z_]+\.([a-z_]+|\*)$/);
      expect(DATA_CLASSES).toContain(cls);
    }
  });

  it("no tag describes a field nothing shows -- a stale tag would read as a decision still in force", () => {
    const shown = new Set(READING_CATALOGUE.flatMap(r => shownFields(r)));
    expect(Object.keys(FIELD_CLASS).filter(f => !shown.has(f))).toEqual([]);
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
