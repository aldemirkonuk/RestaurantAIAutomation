import { allowanceForTier, windowStartIso } from "./spend-tiers";
describe("spend tiers", () => {
  it("core is a depleting credit, not a daily reset", () => {
    const a = allowanceForTier("core");
    expect(a.limitUsd).toBe(5); expect(a.mode).toBe("credit");
    expect(windowStartIso("credit")).toBeNull();          // sums ALL TIME
  });
  it("plus and pro are daily ceilings that reset", () => {
    expect(allowanceForTier("plus")).toMatchObject({ limitUsd: 5, mode: "daily" });
    expect(allowanceForTier("pro")).toMatchObject({ limitUsd: 10, mode: "daily" });
    expect(windowStartIso("daily")).toMatch(/T00:00:00\.000Z$/);
  });
  it("live default 'pilot' and unknown tiers resolve to core, never the largest", () => {
    for (const t of ["pilot", "free", "enterprise", "", null, undefined, "PRO "]) {
      const a = allowanceForTier(t as any);
      if (String(t).trim().toLowerCase() === "pro") { expect(a.limitUsd).toBe(10); continue; }
      expect(a.mode).toBe("credit"); expect(a.limitUsd).toBe(5);
    }
  });
  it("is case- and whitespace-insensitive", () => {
    expect(allowanceForTier("  Plus ")).toMatchObject({ mode: "daily", limitUsd: 5 });
  });
});
