import { filterProposals, uxProposalVerdict } from "./ux-proposal-grounding";

const p = (over: Record<string, unknown> = {}) => ({
  kind: "copy",
  targetKey: "orders.submit",
  title: "t",
  ...over,
});

describe("filterProposals", () => {
  it("keeps a well-formed proposal with an allowed kind", () => {
    expect(filterProposals([p()]).kept).toHaveLength(1);
  });

  it("drops a kind the prompt never allowed", () => {
    // The prompt has always said copy|default|surface|affordance|layout; the
    // parser took any string and wrote it into ux_proposals.kind.
    const f = filterProposals([p({ kind: "workflow" })]);
    expect(f.kept).toHaveLength(0);
    expect(f.droppedKinds).toEqual(["workflow"]);
  });

  it("still drops incomplete rows, as before", () => {
    const f = filterProposals([p({ title: undefined }), p({ targetKey: "" })]);
    expect(f.kept).toHaveLength(0);
    expect(f.droppedIncomplete).toBe(2);
    expect(f.droppedKinds).toHaveLength(0);
  });

  it("separates the two drop reasons", () => {
    const f = filterProposals([p({ kind: "vibes" }), p({ title: undefined })]);
    expect(f.droppedKinds).toEqual(["vibes"]);
    expect(f.droppedIncomplete).toBe(1);
  });

  it("accepts every kind the prompt lists", () => {
    const kinds = ["copy", "default", "surface", "affordance", "layout"];
    expect(filterProposals(kinds.map((k) => p({ kind: k }))).kept).toHaveLength(
      5,
    );
  });
});

describe("uxProposalVerdict", () => {
  it("calls non-JSON a failure", () => {
    expect(
      uxProposalVerdict({ parsed: false, filter: null, rawCount: 0 }).outcome,
    ).toBe("failure");
  });

  it("calls zero survivors a failure — the call produced no artifact", () => {
    const filter = filterProposals([p({ kind: "workflow" })]);
    expect(
      uxProposalVerdict({ parsed: true, filter, rawCount: 1 }).outcome,
    ).toBe("failure");
  });

  it("calls a partial drop partial", () => {
    const filter = filterProposals([p(), p({ kind: "workflow" })]);
    const v = uxProposalVerdict({ parsed: true, filter, rawCount: 2 });
    expect(v.outcome).toBe("partial");
    expect(v.evidence).toMatchObject({ dropped_invalid_kind: ["workflow"] });
  });

  it("calls a clean response a success", () => {
    const filter = filterProposals([p(), p({ kind: "layout" })]);
    expect(
      uxProposalVerdict({ parsed: true, filter, rawCount: 2 }).outcome,
    ).toBe("success");
  });
});
