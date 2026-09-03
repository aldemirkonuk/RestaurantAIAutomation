import { checkGrounding, consultantVerdict } from "./consultant-grounding";

const claim = (refs: unknown, confidence = 0.8) => ({
  claim: "c",
  confidence,
  evidence_refs: refs,
});

const CATEGORIES = [
  "financial",
  "risk",
  "inventoryScience",
  "templateInsights",
];

describe("checkGrounding", () => {
  it("keeps a claim citing a supplied category", () => {
    const g = checkGrounding(
      [claim(["risk.vendorConcentration.hhi"])],
      CATEGORIES,
    );
    expect(g.claims).toHaveLength(1);
    expect(g.dropped).toHaveLength(0);
  });

  it("reads the root through both path syntaxes", () => {
    const g = checkGrounding(
      [claim(["templateInsights[2].sentence"]), claim(["financial.cogs"])],
      CATEGORIES,
    );
    expect(g.claims).toHaveLength(2);
  });

  it("drops a claim citing evidence that was never supplied", () => {
    // The motivating case: a POS-shaped citation on a restaurant with no POS
    // data reached the owner looking exactly as authoritative as a real one.
    const g = checkGrounding([claim(["pos.tables.turnover"])], CATEGORIES);
    expect(g.claims).toHaveLength(0);
    expect(g.dropped).toHaveLength(1);
    expect(g.unknownRoots).toContain("pos");
  });

  it("keeps a claim that cites one real category among invented ones", () => {
    const g = checkGrounding(
      [claim(["pos.tables.turnover", "risk.vendorConcentration.hhi"])],
      CATEGORIES,
    );
    expect(g.claims).toHaveLength(1);
    expect(g.unknownRoots).toContain("pos");
  });

  it("drops a claim with no refs at all", () => {
    expect(checkGrounding([claim(undefined)], CATEGORIES).dropped).toHaveLength(
      1,
    );
  });

  it("exempts the thin-evidence answer the prompt explicitly asks for", () => {
    // HARD RULE 6 tells the model to return ONE low-confidence claim whose
    // refs name what was MISSING. Those cannot resolve by construction, and
    // punishing them would delete the honest answer while looking like a
    // working guardrail.
    const g = checkGrounding([claim(["pos", "labour"], 0.2)], CATEGORIES);
    expect(g.thinEvidenceExempt).toBe(true);
    expect(g.claims).toHaveLength(1);
    expect(g.dropped).toHaveLength(0);
  });

  it("does NOT exempt a single confident ungrounded claim", () => {
    const g = checkGrounding([claim(["pos.tables"], 0.9)], CATEGORIES);
    expect(g.thinEvidenceExempt).toBe(false);
    expect(g.dropped).toHaveLength(1);
  });
});

describe("consultantVerdict", () => {
  const g = (kept: number, dropped: number) =>
    consultantVerdict({
      refused: false,
      parsed: true,
      grounding: {
        claims: new Array(kept).fill({}),
        dropped: new Array(dropped).fill({ claim: "x", refs: [] }),
        thinEvidenceExempt: false,
        unknownRoots: dropped ? ["pos"] : [],
      },
    });

  it("calls a refusal a failure", () => {
    expect(
      consultantVerdict({ refused: true, parsed: false, grounding: null })
        .outcome,
    ).toBe("failure");
  });

  it("calls non-JSON a failure", () => {
    expect(
      consultantVerdict({ refused: false, parsed: false, grounding: null })
        .outcome,
    ).toBe("failure");
  });

  it("calls an all-ungrounded response a failure, not a shape problem", () => {
    expect(g(0, 3).outcome).toBe("failure");
  });

  it("calls a partly-ungrounded response partial", () => {
    expect(g(4, 1).outcome).toBe("partial");
  });

  it("calls a count outside the requested 3-8 partial", () => {
    expect(g(2, 0).outcome).toBe("partial");
    expect(g(9, 0).outcome).toBe("partial");
  });

  it("calls a fully grounded, correctly sized response a success", () => {
    expect(g(5, 0).outcome).toBe("success");
  });
});
