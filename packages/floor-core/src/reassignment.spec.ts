/**
 * @wineops/floor-core — the reassignment proposal (founder pick 4).
 *
 * Every spec here imports the real code. The checker's own scripts copied the
 * logic into the test file (`scripts/test-attribution.mjs:8`), so they could
 * pass while the app drifted; that is not repeated.
 */
import {
  proposeReassignment,
  type ReassignCandidate,
  type ReassignTable,
} from "./index";

// ---------------------------------------------------------------------------
// The reassignment proposal (founder pick 4), new in the port
// ---------------------------------------------------------------------------

describe("proposeReassignment", () => {
  const table = (tableId: string, label: string, sectionId: string | null, seated = false): ReassignTable => ({
    tableId,
    label,
    sectionId,
    seated,
  });
  const waiter = (waiterId: string, sectionIds: string[], load: number): ReassignCandidate => ({
    waiterId,
    sectionIds,
    load,
  });

  it("gives a table to the lightest waiter in its section", () => {
    const out = proposeReassignment({
      tables: [table("t1", "1", "A", true)],
      candidates: [waiter("w2", ["A"], 3), waiter("w3", ["A"], 1), waiter("w4", ["B"], 0)],
      fromWaiterId: "w1",
    });
    expect(out).toEqual([{ tableId: "t1", toWaiterId: "w3", reason: "lightest_in_section" }]);
  });

  it("breaks ties on waiter id and counts each table it gives", () => {
    const out = proposeReassignment({
      tables: [table("t1", "1", "A"), table("t2", "2", "A")],
      candidates: [waiter("w3", ["A"], 1), waiter("w2", ["A"], 1)],
      fromWaiterId: "w1",
    });
    expect(out.map((p) => p.toWaiterId)).toEqual(["w2", "w3"]);
  });

  it("places seated tables first, then labels in numeric order", () => {
    const out = proposeReassignment({
      tables: [table("x10", "10", "A"), table("x2", "2", "A"), table("x9", "9", "A", true)],
      candidates: [waiter("w2", ["A"], 0)],
      fromWaiterId: "w1",
    });
    expect(out.map((p) => p.tableId)).toEqual(["x9", "x2", "x10"]);
  });

  it("never proposes the waiter leaving, and says when nobody works the section", () => {
    const out = proposeReassignment({
      tables: [table("t1", "1", "A")],
      candidates: [waiter("w1", ["A"], 0), waiter("w2", ["B"], 0)],
      fromWaiterId: "w1",
    });
    expect(out).toEqual([{ tableId: "t1", toWaiterId: null, reason: "no_one_in_section" }]);
  });

  it("offers a table with no section to the lightest waiter on the list", () => {
    const out = proposeReassignment({
      tables: [table("t1", "1", null)],
      candidates: [waiter("w2", ["A"], 2), waiter("w3", ["B"], 1)],
      fromWaiterId: "w1",
    });
    expect(out).toEqual([{ tableId: "t1", toWaiterId: "w3", reason: "lightest_on_shift" }]);
  });

  it("is deterministic: input order does not change the proposal, and inputs are not mutated", () => {
    const tables = [table("t2", "2", "A"), table("t1", "1", "A"), table("t3", "3", "A", true)];
    const candidates = [waiter("w2", ["A"], 0), waiter("w3", ["A"], 0), waiter("w4", ["A"], 1)];
    const a = proposeReassignment({ tables, candidates, fromWaiterId: "w1" });
    const b = proposeReassignment({
      tables: [...tables].reverse(),
      candidates: [...candidates].reverse(),
      fromWaiterId: "w1",
    });
    expect(b).toEqual(a);
    expect(a.map((p) => [p.tableId, p.toWaiterId])).toEqual([
      ["t3", "w2"],
      ["t1", "w3"],
      ["t2", "w2"],
    ]);
    expect(tables.map((t) => t.tableId)).toEqual(["t2", "t1", "t3"]);
    expect(candidates.map((c) => c.load)).toEqual([0, 0, 1]);
  });
});

// ---------------------------------------------------------------------------
// OD-259: the readings the pick does not name
// ---------------------------------------------------------------------------

describe("a waiter listed twice is one candidate", () => {
  it("works every section their rows name, whatever the order", () => {
    const tables: ReassignTable[] = [{ tableId: "t1", label: "1", sectionId: "B", seated: true }];
    const rows: ReassignCandidate[] = [
      { waiterId: "w2", sectionIds: ["A"], load: 0 },
      { waiterId: "w2", sectionIds: ["B"], load: 0 },
    ];
    const want = [{ tableId: "t1", toWaiterId: "w2", reason: "lightest_in_section" }];
    expect(proposeReassignment({ tables, candidates: rows, fromWaiterId: "w1" })).toEqual(want);
    expect(proposeReassignment({ tables, candidates: [...rows].reverse(), fromWaiterId: "w1" })).toEqual(want);
  });

  it("carries the largest load listed, so row order cannot change who is lightest", () => {
    const tables: ReassignTable[] = [{ tableId: "t1", label: "1", sectionId: "A", seated: true }];
    const rows: ReassignCandidate[] = [
      { waiterId: "w2", sectionIds: ["A"], load: 0 },
      { waiterId: "w2", sectionIds: ["B"], load: 5 },
      { waiterId: "w3", sectionIds: ["A"], load: 2 },
    ];
    const a = proposeReassignment({ tables, candidates: rows, fromWaiterId: "w1" });
    const b = proposeReassignment({ tables, candidates: [...rows].reverse(), fromWaiterId: "w1" });
    expect(a).toEqual(b);
    expect(a[0].toWaiterId).toBe("w3");
  });
});

describe("OD-259: a load that is not a finite number reads as the heaviest", () => {
  it.each([NaN, Infinity, -Infinity])("load %p loses to any finite load, whatever the order", (bad) => {
    const tables: ReassignTable[] = [{ tableId: "t1", label: "1", sectionId: "A", seated: true }];
    const rows: ReassignCandidate[] = [
      { waiterId: "w2", sectionIds: ["A"], load: bad },
      { waiterId: "w3", sectionIds: ["A"], load: 9 },
    ];
    expect(proposeReassignment({ tables, candidates: rows, fromWaiterId: "w1" })[0].toWaiterId).toBe("w3");
    expect(proposeReassignment({ tables, candidates: [...rows].reverse(), fromWaiterId: "w1" })[0].toWaiterId).toBe("w3");
  });

  it("still proposes the only waiter in the section", () => {
    const tables: ReassignTable[] = [{ tableId: "t1", label: "1", sectionId: "A", seated: true }];
    const rows: ReassignCandidate[] = [{ waiterId: "w2", sectionIds: ["A"], load: NaN }];
    expect(proposeReassignment({ tables, candidates: rows, fromWaiterId: "w1" })).toEqual([
      { tableId: "t1", toWaiterId: "w2", reason: "lightest_in_section" },
    ]);
  });
});

describe("OD-259: sectionless tables, empty sections and repeated tables", () => {
  const t = (tableId: string, sectionId: string | null): ReassignTable => ({ tableId, label: tableId, sectionId, seated: false });

  it("a sectionless table with nobody listed says nobody is on shift, not nobody in its section", () => {
    expect(proposeReassignment({ tables: [t("t1", null)], candidates: [], fromWaiterId: "w1" })).toEqual([
      { tableId: "t1", toWaiterId: null, reason: "no_one_on_shift" },
    ]);
  });

  it('reads an empty-string section as no section, as the checker did', () => {
    const out = proposeReassignment({
      tables: [t("t1", "")],
      candidates: [{ waiterId: "w2", sectionIds: ["A"], load: 0 }],
      fromWaiterId: "w1",
    });
    expect(out).toEqual([{ tableId: "t1", toWaiterId: "w2", reason: "lightest_on_shift" }]);
  });

  it("proposes a table listed twice once", () => {
    const out = proposeReassignment({
      tables: [t("t1", "A"), t("t1", "A")],
      candidates: [{ waiterId: "w2", sectionIds: ["A"], load: 0 }],
      fromWaiterId: "w1",
    });
    expect(out.map((p) => p.tableId)).toEqual(["t1"]);
  });

  it("gives a sectionless table to a waiter who works no section", () => {
    const out = proposeReassignment({
      tables: [t("t1", null)],
      candidates: [{ waiterId: "w2", sectionIds: [], load: 0 }],
      fromWaiterId: "w1",
    });
    expect(out).toEqual([{ tableId: "t1", toWaiterId: "w2", reason: "lightest_on_shift" }]);
  });

  it("keeps the seated row when one table is listed twice with different rows", () => {
    const out = proposeReassignment({
      tables: [t("t1", "B"), { ...t("t1", "A"), seated: true }],
      candidates: [
        { waiterId: "w2", sectionIds: ["A"], load: 0 },
        { waiterId: "w3", sectionIds: ["B"], load: 0 },
      ],
      fromWaiterId: "w1",
    });
    expect(out).toEqual([{ tableId: "t1", toWaiterId: "w2", reason: "lightest_in_section" }]);
  });

  it("does not let input order pick between two rows for one table", () => {
    const candidates = [
      { waiterId: "w2", sectionIds: ["A"], load: 0 },
      { waiterId: "w3", sectionIds: ["B"], load: 0 },
    ];
    const rows = [t("t1", "B"), t("t1", "A"), t("t1", null)];
    const forward = proposeReassignment({ tables: rows, candidates, fromWaiterId: "w1" });
    const backward = proposeReassignment({ tables: [...rows].reverse(), candidates, fromWaiterId: "w1" });
    expect(forward).toEqual([{ tableId: "t1", toWaiterId: "w2", reason: "lightest_in_section" }]);
    expect(backward).toEqual(forward);
  });

  it("piles every table onto the lowest id when no eligible load is readable", () => {
    const out = proposeReassignment({
      tables: [t("t1", null), t("t2", null)],
      candidates: [
        { waiterId: "w3", sectionIds: [], load: NaN },
        { waiterId: "w2", sectionIds: [], load: Infinity },
      ],
      fromWaiterId: "w1",
    });
    expect(out.map((p) => p.toWaiterId)).toEqual(["w2", "w2"]);
  });

  it("never proposes the waiter who is leaving, even when listed under every section", () => {
    const out = proposeReassignment({
      tables: [t("t1", "A"), t("t2", null)],
      candidates: [{ waiterId: "w1", sectionIds: ["A"], load: 0 }],
      fromWaiterId: "w1",
    });
    expect(out.map((p) => p.toWaiterId)).toEqual([null, null]);
  });
});
