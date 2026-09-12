/**
 * The calibration proposes and never writes, and the hash is what makes
 * "shown before the act" enforceable rather than describable.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  BUDGETS,
  CADENCE_NOT_ON_OFFER,
  DEFAULT_BUDGET,
  hashProposal,
  isRefusal,
  proposeAllBudgets,
  proposeCalibration,
} from "./commodity-calibration";
import { THRESHOLD_HISTORY_FLOOR } from "./commodity-alert";
import { parseFao } from "./parse-fao";

const POINTS = parseFao(
  readFileSync(
    join(__dirname, "__fixtures__", "fao-food-price-index-2026-09-05.sample.csv"),
    "utf8",
  ),
  { seriesKey: "fao.food_price_index.all", fetchedAt: "2026-09-05T12:00:00.000Z" },
)
  .observations.sort((a, b) => a.periodStart.localeCompare(b.periodStart))
  .map((o) => ({ periodStart: o.periodStart, value: o.value }));

describe("the calibration cannot write, structurally", () => {
  it("imports no database, no Nest and no clock", () => {
    // The founder's Q3 answer: "the calibration job only PROPOSES numbers and
    // writes nothing to the series". The guarantee is that there is nothing
    // here to write with.
    const src = readFileSync(join(__dirname, "commodity-calibration.ts"), "utf8");
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l))
      .join("\n");
    expect(imports).not.toMatch(/DatabaseService|@nestjs|supabase/);
    // `.from(` is PostgREST's entry point and every write in this codebase goes
    // through one. Checked instead of `.update(`, which `createHash().update()`
    // also matches -- a guard that fires on the hashing would be deleted.
    expect(src).not.toMatch(/\.from\(/);
  });
});

describe("a proposal, or a refusal that says why", () => {
  it("proposes at every budget on a real 40-observation history", () => {
    const all = proposeAllBudgets("fao.food_price_index.all", "month", POINTS);
    expect(all.map((a) => a.firesPerYear)).toEqual([...BUDGETS]);
    for (const a of all) expect(isRefusal(a.outcome)).toBe(false);
  });

  it("refuses a short history BY NAME rather than proposing a weak number", () => {
    const out = proposeCalibration(
      "fao.food_price_index.all",
      "month",
      POINTS.slice(-(THRESHOLD_HISTORY_FLOOR - 1)),
      2,
    );
    expect(isRefusal(out)).toBe(true);
    if (isRefusal(out)) {
      expect(out.reason).toBe("too_short_a_history");
      expect(out.detail).toMatch(/the rule cannot fire for this series/);
    }
  });

  it("refuses a grain it has no observations-a-year figure for", () => {
    const out = proposeCalibration("x", "fortnight", POINTS, 2);
    expect(isRefusal(out)).toBe(true);
    if (isRefusal(out)) expect(out.reason).toBe("unknown_grain");
  });

  it("refuses an empty history as a register with nothing in it, not a flat market", () => {
    const out = proposeCalibration("x", "month", [], 2);
    expect(isRefusal(out)).toBe(true);
    if (isRefusal(out)) {
      expect(out.reason).toBe("no_observations");
      expect(out.detail).toMatch(/not a series that never moves/);
    }
  });

  it("refuses a perfectly flat series rather than proposing a zero", () => {
    const flat = POINTS.map((p) => ({ ...p, value: 100 }));
    const out = proposeCalibration("x", "month", flat, 2);
    expect(isRefusal(out)).toBe(true);
    if (isRefusal(out)) expect(out.reason).toBe("flat_series");
  });
});

describe("the sentence the admin reads before the act", () => {
  it("states the budget, the percentage it produced, and the window it was read off", () => {
    const out = proposeCalibration("fao.food_price_index.all", "month", POINTS, 2);
    expect(isRefusal(out)).toBe(false);
    if (isRefusal(out)) return;
    expect(out.sentence).toMatch(/about 2 times a year/);
    expect(out.sentence).toMatch(/above its 12-observation median/);
    expect(out.sentence).toMatch(/between 2023-05-01 and 2026-08-01/);
    // The one accuracy claim it must NOT make. "for THIS house" was added
    // 2026-09-06 with the quant pass: the sentence now DOES carry a measured
    // hit rate for the SERIES (65.8 % over 440 FAO months), so the disclaimer
    // had to become specific about what is still unmeasured — this house's own
    // invoice — rather than reading as a denial of the number beside it.
    expect(out.sentence).toMatch(/How often it will be RIGHT for THIS house is not stated/);
  });

  it("says 'once' rather than '1 times'", () => {
    const out = proposeCalibration("x", "month", POINTS, 1);
    if (isRefusal(out)) throw new Error("expected a proposal");
    expect(out.sentence).toMatch(/about once a year/);
  });
});

describe("the hash is what makes 'shown before the act' enforceable", () => {
  it("is stable across two runs over the same numbers", () => {
    const a = proposeCalibration("k", "month", POINTS, 2);
    const b = proposeCalibration("k", "month", POINTS, 2);
    if (isRefusal(a) || isRefusal(b)) throw new Error("expected proposals");
    expect(a.proposalHash).toBe(b.proposalHash);
  });

  it("changes when the SERIES changes, so one series' hash cannot arm another", () => {
    const a = proposeCalibration("series-one", "month", POINTS, 2);
    const b = proposeCalibration("series-two", "month", POINTS, 2);
    if (isRefusal(a) || isRefusal(b)) throw new Error("expected proposals");
    expect(a.proposalHash).not.toBe(b.proposalHash);
  });

  it("changes when the BUDGET changes, so a 'four a year' hash cannot arm 'once'", () => {
    const a = proposeCalibration("k", "month", POINTS, 4);
    const b = proposeCalibration("k", "month", POINTS, 1);
    if (isRefusal(a) || isRefusal(b)) throw new Error("expected proposals");
    expect(a.proposalHash).not.toBe(b.proposalHash);
  });

  it("changes when ONE MORE OBSERVATION lands — which is the whole point", () => {
    // A threshold that moved between the showing and the act must not be
    // armable on the old hash. This is the same refusal `arguments_changed`
    // gives an order edited after approval.
    const moved = [
      ...POINTS,
      { periodStart: "2026-09-01", value: POINTS[POINTS.length - 1].value * 1.4 },
    ];
    const before = proposeCalibration("k", "month", POINTS, 2);
    const after = proposeCalibration("k", "month", moved, 2);
    if (isRefusal(before) || isRefusal(after)) throw new Error("expected proposals");
    expect(after.proposalHash).not.toBe(before.proposalHash);
  });

  it("hashes at the precision the COLUMN stores, so a round trip cannot break it", () => {
    // NUMERIC(6,4). Without the fixed precision, the number written and the
    // number read back would hash differently and every second arming would be
    // refused for a reason nobody could see.
    const core = {
      seriesKey: "k",
      firesPerYear: 2,
      riseThreshold: 0.08500000000000001,
      stepGuard: 0.078,
      windowFrom: "1990-01-01",
      windowTo: "2026-08-01",
      windowNObs: 427,
    };
    expect(hashProposal(core)).toBe(hashProposal({ ...core, riseThreshold: 0.085 }));
  });
});

describe("the default budget is the founder's, and the rejected ones say why", () => {
  it("proposes twice a year as the default and marks only that one", () => {
    // The founder, 2026-09-05 batch 59, answering the plan's §12 Q5:
    // "Twice a year, and the house types its carrying cost."
    expect(DEFAULT_BUDGET).toBe(2);
    const all = proposeAllBudgets("fao.food_price_index.all", "month", POINTS);
    const flagged = all.filter((a) => a.isDefault);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].firesPerYear).toBe(2);
  });

  it("carries the rejected budgets' reasons, not just the chosen one", () => {
    // The rejected alternative is the half of a decision that gets lost first.
    const all = proposeAllBudgets("fao.food_price_index.all", "month", POINTS);
    for (const a of all) expect(a.rationale.length).toBeGreaterThan(40);
    expect(all.find((a) => a.firesPerYear === 4)?.rationale).toMatch(
      /Rejected as the default/,
    );
    expect(all.find((a) => a.firesPerYear === 1)?.rationale).toMatch(
      /Rejected as the default/,
    );
    expect(all.find((a) => a.firesPerYear === 2)?.rationale).toMatch(
      /The default \(the founder/,
    );
  });

  it("names the budgets that are NOT on offer, rather than leaving them absent", () => {
    // The founder asked for weekly or fortnightly. An option that was asked
    // for and is missing must be explained, or the absence reads as a choice.
    expect(CADENCE_NOT_ON_OFFER).toMatch(/Weekly and fortnightly are not offered/);
    expect(CADENCE_NOT_ON_OFFER).toMatch(/publish monthly/);
  });

  it("the default flag is NOT in the hash, so re-wording cannot refuse an arming", () => {
    const out = proposeCalibration("fao.food_price_index.all", "month", POINTS, 2);
    expect(isRefusal(out)).toBe(false);
    if (isRefusal(out)) return;
    expect(out.isDefaultBudget).toBe(true);
    // The hash covers the NUMBERS on the screen and nothing else.
    expect(out.proposalHash).toBe(
      hashProposal({
        seriesKey: out.seriesKey,
        firesPerYear: out.firesPerYear,
        riseThreshold: out.riseThreshold,
        stepGuard: out.stepGuard,
        windowFrom: out.windowFrom,
        windowTo: out.windowTo,
        windowNObs: out.windowNObs,
      }),
    );
  });

  it("the sentence says a budget is the proposed one only when it is", () => {
    const two = proposeCalibration("fao.food_price_index.all", "month", POINTS, 2);
    const four = proposeCalibration("fao.food_price_index.all", "month", POINTS, 4);
    if (isRefusal(two) || isRefusal(four)) throw new Error("refused");
    expect(two.sentence).toMatch(/This is the budget Mudavym proposes/);
    expect(four.sentence).not.toMatch(/This is the budget Mudavym proposes/);
    expect(four.sentence).toMatch(/Rejected as the default/);
  });
});
