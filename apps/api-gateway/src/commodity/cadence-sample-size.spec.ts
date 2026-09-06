/**
 * The sample-size arithmetic, and the shell-egg file it was forced by.
 *
 * Every number this suite asserts is a number that appears in the plan's 9g
 * ("The egg series on one report") or in `p4-scratch/p4bo-egg-backtest.md`, so
 * a figure in a document cannot drift away from the code that produced it.
 *
 * The fixture is the one report a person read on 2026-09-05 through the app's
 * Browser pane — `__fixtures__/usda-ams-2843-2026-09-04.report-detail-weighted.tsv`,
 * 9,115 bytes, sha256 `0371c7c7…23d49c`. Nothing here goes outbound, and the
 * three prices used below are read out of those bytes rather than typed, so an
 * edit to the fixture fails this suite instead of quietly changing a claim.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import {
  breakEvenCarryPerPeriod,
  breakEvenMove,
  firesForStandardError,
  isSampleSizeRefusal,
  observationsToTestCadence,
  spendFloorForReading,
} from "./cadence-sample-size";

const BYTES = readFileSync(
  join(__dirname, "__fixtures__", "usda-ams-2843-2026-09-04.report-detail-weighted.tsv"),
);
const LINES = BYTES.toString("utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim() !== "");
const HEADER = LINES[0].split("\t").map((h) => h.trim());
const ROWS = LINES.slice(1).map((l) => l.split("\t").map((c) => c.trim()));
const col = (name: string) => HEADER.indexOf(name);
const cell = (row: string[], name: string) => row[col(name)];
const price = (row: string[], name: string): number | null => {
  const raw = cell(row, name);
  if (raw === undefined || raw.trim() === "") return null;
  const v = Number(raw.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
};

/** The six-part tuple the register selects on. */
const SERIES_ROW = ROWS.filter(
  (r) =>
    cell(r, "Egg Type") === "Graded Loose" &&
    cell(r, "Environment") === "Caged" &&
    cell(r, "Color") === "White" &&
    cell(r, "Class") === "Large" &&
    cell(r, "Origin") === "National" &&
    cell(r, "Freight") === "FOB",
)[0];

/** The one row in the file that rose from its own Previous: cage-free national FOB. */
const BEST_RISER = ROWS.filter(
  (r) =>
    cell(r, "Egg Type") === "Graded Loose" &&
    cell(r, "Environment") === "Cage-Free" &&
    cell(r, "Color") === "White" &&
    cell(r, "Class") === "Large" &&
    cell(r, "Origin") === "National" &&
    cell(r, "Freight") === "FOB",
)[0];

const moveVs = (row: string[], other: string): number => {
  const now = price(row, "Wtd Avg Price");
  const then = price(row, other);
  if (now === null || then === null || then <= 0) throw new Error("no move");
  return now / then - 1;
};

describe("the bytes these numbers come from", () => {
  it("is the recorded report, unedited", () => {
    expect(createHash("sha256").update(BYTES).digest("hex")).toBe(
      "0371c7c7e617683adb37d6ab22e0c6245e6784055c0657181d83d43df423d49c",
    );
    expect(BYTES.length).toBe(9115);
    expect(ROWS.length).toBe(23);
  });

  it("holds 47 price cells and no more - that is the entire money history", () => {
    let cells = 0;
    for (const r of ROWS) {
      for (const c of ["Wtd Avg Price", "Wtd Avg Price Previous", "Wtd Avg Price Last Year"]) {
        if (price(r, c) !== null) cells += 1;
      }
    }
    expect(cells).toBe(47);
    // Eight of the 23 rows carry no current price. Six of the NINETEEN graded
    // loose rows do, which is the count the provenance note states.
    expect(ROWS.filter((r) => price(r, "Wtd Avg Price") === null).length).toBe(8);
    expect(
      ROWS.filter(
        (r) => cell(r, "Egg Type") === "Graded Loose" && price(r, "Wtd Avg Price") === null,
      ).length,
    ).toBe(6);
  });

  it("puts the series row at 35.28 against a previous of 36.14 and a year ago of 215.53", () => {
    expect(price(SERIES_ROW, "Wtd Avg Price")).toBe(35.28);
    expect(price(SERIES_ROW, "Wtd Avg Price Previous")).toBe(36.14);
    expect(price(SERIES_ROW, "Wtd Avg Price Last Year")).toBe(215.53);
    expect(moveVs(SERIES_ROW, "Wtd Avg Price Previous")).toBeCloseTo(-0.023796, 6);
    expect(moveVs(SERIES_ROW, "Wtd Avg Price Last Year")).toBeCloseTo(-0.836310, 6);
  });
});

describe("breakEvenCarryPerPeriod", () => {
  it("refuses the series row's own move rather than returning a negative carrying cost", () => {
    const r = breakEvenCarryPerPeriod(moveVs(SERIES_ROW, "Wtd Avg Price Previous"), 1);
    expect(isSampleSizeRefusal(r)).toBe(true);
    if (isSampleSizeRefusal(r)) {
      expect(r.reason).toBe("not_a_rise");
      expect(r.detail).toContain("carrying cost of zero");
    }
  });

  it("refuses the year-on-year move too - it is a 83.6 percent fall", () => {
    const r = breakEvenCarryPerPeriod(moveVs(SERIES_ROW, "Wtd Avg Price Last Year"), 1);
    expect(isSampleSizeRefusal(r) && r.reason).toBe("not_a_rise");
  });

  it("gives 10.2692 percent a period on the one row in the file that rose", () => {
    const gross = moveVs(BEST_RISER, "Wtd Avg Price Previous");
    expect(gross).toBeCloseTo(0.102692, 6);
    const r = breakEvenCarryPerPeriod(gross, 1);
    expect(isSampleSizeRefusal(r)).toBe(false);
    if (!isSampleSizeRefusal(r)) expect(r.carryPerPeriod).toBeCloseTo(0.102692, 6);
  });

  it("divides by the TRIANGULAR factor, so three periods of cover is a sixth and not a third", () => {
    const r = breakEvenCarryPerPeriod(0.06, 3);
    expect(isSampleSizeRefusal(r)).toBe(false);
    // 0.06 / 6 = 0.01. The linear mistake would give 0.02 and double the
    // carrying cost a house could afford.
    if (!isSampleSizeRefusal(r)) expect(r.carryPerPeriod).toBeCloseTo(0.01, 12);
  });

  it("refuses a horizon below one period", () => {
    const r = breakEvenCarryPerPeriod(0.05, 0);
    expect(isSampleSizeRefusal(r) && r.reason).toBe("unusable_parameter");
  });
});

describe("breakEvenMove", () => {
  it("adds the reading to the carry: 0.92 percent a week on a 1,000 line at 0.5 percent a month", () => {
    const r = breakEvenMove({
      attentionPerFire: 8,
      periodSpend: 1000,
      carryPerPeriod: (0.5 / 100) * (12 / 52),
      horizon: 1,
    });
    expect(isSampleSizeRefusal(r)).toBe(false);
    if (!isSampleSizeRefusal(r)) expect(r.move).toBeCloseTo(0.0091538, 7);
  });

  it("is 4.1 percent on a 200 line, which almost nothing in this file beats", () => {
    const r = breakEvenMove({
      attentionPerFire: 8,
      periodSpend: 200,
      carryPerPeriod: (0.5 / 100) * (12 / 52),
      horizon: 1,
    });
    if (isSampleSizeRefusal(r)) throw new Error("refused");
    expect(r.move).toBeCloseTo(0.0411538, 7);
    const beaten = ROWS.filter((row) => {
      const now = price(row, "Wtd Avg Price");
      const then = price(row, "Wtd Avg Price Previous");
      return now !== null && then !== null && then > 0 && now / then - 1 > r.move;
    });
    expect(beaten.length).toBe(1);
  });

  it("refuses a spend of zero rather than dividing by it", () => {
    const r = breakEvenMove({
      attentionPerFire: 8,
      periodSpend: 0,
      carryPerPeriod: 0.001,
      horizon: 1,
    });
    expect(isSampleSizeRefusal(r) && r.reason).toBe("unusable_parameter");
  });
});

describe("spendFloorForReading", () => {
  it("is 77.90 a period at the best move in the file and a carrying cost of zero", () => {
    const r = spendFloorForReading(8, moveVs(BEST_RISER, "Wtd Avg Price Previous"));
    expect(isSampleSizeRefusal(r)).toBe(false);
    if (!isSampleSizeRefusal(r)) expect(r.periodSpend).toBeCloseTo(77.9026, 4);
  });

  it("refuses when the net is a fall - no spend is large enough, and that is not a small-item verdict", () => {
    const r = spendFloorForReading(8, moveVs(SERIES_ROW, "Wtd Avg Price Previous"));
    expect(isSampleSizeRefusal(r) && r.reason).toBe("not_a_rise");
  });
});

describe("firesForStandardError", () => {
  it("wants 133 fires for the standard error the FAO pass achieved", () => {
    const r = firesForStandardError(0.667, 0.041);
    expect(isSampleSizeRefusal(r)).toBe(false);
    if (!isSampleSizeRefusal(r)) expect(r.fires).toBe(133);
  });

  it("wants 89 for five points and 30 for the weakest bar anyone would defend", () => {
    const five = firesForStandardError(0.667, 0.05);
    const weak = firesForStandardError(0.667, 0.087);
    if (isSampleSizeRefusal(five) || isSampleSizeRefusal(weak)) throw new Error("refused");
    expect(five.fires).toBe(89);
    expect(weak.fires).toBe(30);
  });

  it("refuses a hit rate of 1", () => {
    expect(isSampleSizeRefusal(firesForStandardError(1, 0.05))).toBe(true);
  });
});

describe("observationsToTestCadence", () => {
  const weekly = { firesNeeded: 135, observationsPerYear: 52, historyFloor: 36, horizon: 1 };

  it("refuses a weekly cadence on a weekly recording, and says why", () => {
    const r = observationsToTestCadence({ ...weekly, firesPerYear: 52 });
    expect(isSampleSizeRefusal(r)).toBe(true);
    if (isSampleSizeRefusal(r)) {
      expect(r.reason).toBe("cadence_not_slower_than_the_series");
      expect(r.detail).toContain("smallest move the series ever made");
    }
  });

  it("costs 307 weekly reports and 5.9 years to test the fortnightly cadence", () => {
    const r = observationsToTestCadence({ ...weekly, firesPerYear: 26 });
    if (isSampleSizeRefusal(r)) throw new Error("refused");
    expect(r.evaluableNeeded).toBe(270);
    expect(r.observationsNeeded).toBe(307);
    expect(r.years).toBeCloseTo(5.9, 1);
  });

  it("costs 3,547 weekly reports and 68 years to test the cadence the founder already chose", () => {
    const r = observationsToTestCadence({ ...weekly, firesPerYear: 2 });
    if (isSampleSizeRefusal(r)) throw new Error("refused");
    expect(r.observationsNeeded).toBe(3547);
    expect(r.years).toBeCloseTo(68.2, 1);
  });

  it("recording five times as often buys five times the downloads and the SAME wall clock", () => {
    const week = observationsToTestCadence({ ...weekly, firesPerYear: 4 });
    const day = observationsToTestCadence({
      firesNeeded: 135,
      firesPerYear: 4,
      observationsPerYear: 250,
      historyFloor: 36,
      horizon: 5,
    });
    if (isSampleSizeRefusal(week) || isSampleSizeRefusal(day)) throw new Error("refused");
    expect(week.evaluableNeeded).toBe(1755);
    expect(day.evaluableNeeded).toBe(8438);
    expect(day.evaluableNeeded / 250 - week.evaluableNeeded / 52).toBeCloseTo(0, 1);
  });

  it("refuses a horizon of zero rather than scoring a fire against itself", () => {
    const r = observationsToTestCadence({ ...weekly, firesPerYear: 2, horizon: 0 });
    expect(isSampleSizeRefusal(r) && r.reason).toBe("unusable_parameter");
  });
});
