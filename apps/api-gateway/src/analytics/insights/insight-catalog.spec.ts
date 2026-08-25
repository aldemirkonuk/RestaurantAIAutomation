import {
  INSIGHT_CANDIDATES,
  availableCandidates,
  candidatesByCategory,
} from "./insight-catalog";
import { verbalize } from "./insight-verbalizer";

describe("insight catalog", () => {
  it("enumerates at least 200 candidate types", () => {
    expect(INSIGHT_CANDIDATES.length).toBeGreaterThanOrEqual(200);
  });

  it("has unique keys", () => {
    const keys = new Set(INSIGHT_CANDIDATES.map((c) => c.key));
    expect(keys.size).toBe(INSIGHT_CANDIDATES.length);
  });

  it("covers every category", () => {
    const cats = candidatesByCategory();
    for (const c of [
      "sales",
      "purchasing",
      "inventory",
      "efficiency",
      "tables",
      "staff",
      "basket",
      "risk",
      "forecast",
      "goals",
    ]) {
      expect(cats[c] ?? 0).toBeGreaterThan(0);
    }
  });

  it("availability filtering prunes check-dependent candidates", () => {
    const withoutChecks = availableCandidates(
      new Set(["consumption", "orders", "inventory"]),
    );
    const withChecks = availableCandidates(
      new Set(["consumption", "orders", "inventory", "checks", "tables"]),
    );
    expect(withChecks.length).toBeGreaterThan(withoutChecks.length);
    expect(withoutChecks.every((c) => !c.requires.includes("checks"))).toBe(
      true,
    );
    // consumption-only candidates still exist without POS
    expect(withoutChecks.length).toBeGreaterThan(20);
  });
});

describe("insight verbalizer", () => {
  it("renders the canonical baseline sentence", () => {
    const s = verbalize("baseline", {
      entity: "Tuesday",
      measureLabel: "sales",
      unit: "currency",
      value: 880,
      baseline: 1000,
      deltaPct: -0.12,
      direction: "below",
    });
    expect(s).toContain("Tuesday sales");
    expect(s).toContain("12% lower");
  });

  it("renders peer sentence with attribution", () => {
    const s = verbalize("peer", {
      entity: "Table 4",
      measureLabel: "average check",
      unit: "currency",
      value: 210,
      rank: 1,
      peerCount: 12,
      deltaPct: 0.31,
      attributeReading: "Likely helped by being closest to the bar.",
    });
    expect(s).toContain("Table 4 ranks #1 of 12");
    expect(s).toContain("31% above");
    expect(s).toContain("closest to the bar");
  });

  it("renders basket sentence", () => {
    const s = verbalize("basket", {
      measureLabel: "orders",
      unit: "count",
      pairA: "Ribeye",
      pairB: "Malbec",
      lift: 3.1,
    });
    expect(s).toContain("3.1×");
  });

  it("returns null on insufficient evidence", () => {
    expect(
      verbalize("baseline", { measureLabel: "sales", unit: "currency" }),
    ).toBeNull();
    expect(
      verbalize("unknown_template", { measureLabel: "x", unit: "count" }),
    ).toBeNull();
  });
});
