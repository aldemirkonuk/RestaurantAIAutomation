import { readFileSync } from "fs";
import { resolve } from "path";
import { classifyStock, isBelowPar, isCritical } from "./stock-status";

/**
 * `datasets/sim/fixtures/below-par-cases.json` is the same file
 * `apps/web/src/lib/inventoryStatus.test.ts` runs. Two implementations in two
 * languages, one table of answers — the lockstep the operating-hours pair uses,
 * and the only thing that would have caught the three-way disagreement the POS
 * lens found, because a comment plainly did not.
 */

// src/common -> src -> api-gateway -> apps -> <repo root>
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

describe("stock-status — the shared below-par definition", () => {
  it("loads the fixture both sides run", () => {
    expect(fixture.cases.length).toBeGreaterThan(8);
  });

  for (const c of fixture.cases) {
    it(`${c.name}: ${c.stock} / ${c.par} -> ${c.band}`, () => {
      expect(classifyStock(c.stock, c.par)).toBe(c.band);
      expect(isBelowPar(c.stock, c.par)).toBe(c.below_par);
    });
  }

  it("agrees with the fixture's own list of which bands are below par", () => {
    for (const c of fixture.cases) {
      const expected = fixture._contract.below_par_bands.includes(c.band);
      expect(isBelowPar(c.stock, c.par)).toBe(expected);
    }
  });

  it("never calls an unknown stock critical — a failed read is not an empty shelf", () => {
    expect(isCritical(null, 6)).toBe(false);
    expect(isCritical(undefined, 6)).toBe(false);
    expect(classifyStock(null, 6)).toBe("unknown");
  });

  it("treats a par of zero as no par, not as a par of nothing", () => {
    // The old web classifier substituted `threshold > 0 ? threshold : 1`, which
    // silently invented a par of 1 for every wine with none — so a wine with no
    // par and 0 bottles rendered "Critical" against a number nobody set.
    expect(classifyStock(4, 0)).toBe("unknown");
    expect(classifyStock(0, 0)).toBe("unknown");
    expect(isBelowPar(0, 0)).toBe(false);
  });
});
