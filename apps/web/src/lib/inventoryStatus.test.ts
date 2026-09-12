import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { classifyStock, isBelowPar } from "./inventoryStatus";

/**
 * `datasets/sim/fixtures/below-par-cases.json` is the same file
 * `apps/api-gateway/src/common/stock-status.spec.ts` runs. Two implementations
 * in two languages, one table of answers.
 *
 * This exists because the POS lens found three answers to "how many wines are
 * below par?" on one screen in one second — chip 9, API 7, summary
 * criticalCount 0, alert service calling a wine at 2/5 critical. Nothing
 * structural stopped them diverging; a shared fixture does.
 */

// src/lib -> src -> web -> apps -> <repo root>
const FIXTURE_PATH = resolve(
  __dirname,
  "../../../../datasets/sim/fixtures/below-par-cases.json",
);

interface Fixture {
  _contract: { below_par_bands: string[] };
  cases: Array<{
    name: string;
    stock: number | null;
    par: number | null;
    band: string;
    below_par: boolean;
  }>;
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

describe("inventoryStatus — the same below-par definition as the gateway", () => {
  it("loads the fixture both sides run", () => {
    expect(fixture.cases.length).toBeGreaterThan(8);
  });

  for (const c of fixture.cases) {
    it(`${c.name}: ${c.stock} / ${c.par} -> ${c.band}`, () => {
      expect(classifyStock(c.stock, c.par).key).toBe(c.band);
      expect(isBelowPar(c.stock, c.par)).toBe(c.below_par);
    });
  }

  it("never renders an unknown stock as critical", () => {
    expect(classifyStock(null, 6).key).toBe("unknown");
    expect(classifyStock(undefined, 6).label).toBe("Unknown");
  });

  it("treats a par of zero as no par, not as a par of one", () => {
    // The old classifier did `threshold > 0 ? threshold : 1`, inventing a par
    // of 1 for every wine with none — so a wine with no par and no bottles
    // rendered "Critical" against a number nobody had set.
    expect(classifyStock(4, 0).key).toBe("unknown");
    expect(classifyStock(0, 0).key).toBe("unknown");
  });
});
