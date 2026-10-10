import { tableAttributeReading, verbalize } from "./insight-verbalizer";

/**
 * Regression guard for the floor-geometry gloss.
 *
 * These cases come from the first run of real POS checks through the hub: the
 * generator found r = +0.90 between seat count and average check and rendered
 * "farther-to-seat count tables average lower checks" on the peer sentence
 * while the correlation sentence in the SAME run said seat count "goes with
 * higher average check". The gloss now derives its direction from the sign of
 * r, the way every other template does.
 */
describe("tableAttributeReading", () => {
  it("reads a positive correlation as HIGHER checks", () => {
    const s = tableAttributeReading("distance to kitchen", 0.9);
    expect(s).toContain("higher checks");
    expect(s).not.toContain("lower checks");
    expect(s).toContain("(r=0.90)");
  });

  it("reads a negative correlation as LOWER checks", () => {
    const s = tableAttributeReading("distance to kitchen", -0.9);
    expect(s).toContain("lower checks");
    expect(s).not.toContain("higher checks");
  });

  it("never describes a non-distance attribute as a distance", () => {
    const s = tableAttributeReading("seat count", 0.9);
    expect(s).not.toMatch(/farther|closer|distance/);
    expect(s).toBe(
      "Across your floor, tables with more seats average higher checks (r=0.90).",
    );
  });

  it("agrees with the correlation template about the same r", () => {
    for (const r of [0.9, 0.42, -0.42, -0.9]) {
      const gloss = tableAttributeReading("seat count", r);
      const sentence = verbalize("correlation", {
        measureLabel: "average check",
        unit: "currency",
        r,
        attribute: "seat count",
      }) as string;
      const glossSaysHigher = gloss.includes("higher checks");
      const templateSaysHigher = sentence.includes("higher average check");
      expect(glossSaysHigher).toBe(templateSaysHigher);
    }
  });
});

/**
 * F-132: a concentration sentence called every spread "worth watching" —
 * an index of 262, well under the usual 1,500 line, included — and named
 * "your top 1 vendors".
 */
describe("concentration sentences", () => {
  const ev = (topCount: number, hhi: number, entity = "vendors") =>
    verbalize("concentration", {
      entity,
      measureLabel: "purchasing spend",
      unit: "currency",
      topShare: 0.2,
      topCount,
      hhi,
    });

  it("says a spread-out book is not concentrated, and names one vendor in the singular", () => {
    expect(ev(1, 0.0262)).toBe(
      "Your top vendor holds 20% of purchasing spend (HHI 262) — well spread, not concentrated.",
    );
  });

  it("says worth watching only from the 1,500 line up", () => {
    expect(ev(3, 0.18, "wines")).toBe(
      "Your top 3 wines hold 20% of purchasing spend (HHI 1800) — moderately concentrated, worth watching.",
    );
    expect(ev(1, 0.3)).toMatch(/highly concentrated, worth watching\.$/);
  });
});
