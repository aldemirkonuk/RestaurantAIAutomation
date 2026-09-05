/**
 * The USDA shell-egg parser — tested against the FIXTURE CONTRACT, because no
 * bytes of this report exist here and none may be fetched.
 *
 * `__fixtures__/USDA-SHELL-EGG-CONTRACT.md` states what the human download must
 * contain; the samples below are built from the format the plan recorded from
 * three one-off research reads (`commodity-signals-plan.md` §1, §2a) and are
 * **labelled as constructed, never as recorded**. The day a real download lands
 * these tests are re-pointed at it and the parser does not change.
 *
 * The figures used are the ones the plan measured on the 2026-09-04 report:
 * graded loose, white, Large — weighted average **35.28**, change **-0.86**,
 * year ago **215.53**.
 */

import { parseUsdaShellEgg, weightedAverageFrom } from "./parse-usda-shell-egg";
import { admitRun } from "./commodity-admission";
import { SERIES } from "./commodity.registry";

const ENTRY = SERIES["usda_ams.shell_egg_index.national"];
const OPTS = { seriesKey: ENTRY.seriesKey, fetchedAt: "2026-09-05T12:00:00.000Z" };

/**
 * CONSTRUCTED FROM THE RECORDED FORMAT. Not a recording. Every string in the
 * header and every figure on the target row is one the plan measured.
 */
const CONTRACT_SAMPLE = [
  "USDA Agricultural Marketing Service",
  "Livestock, Poultry & Grain Market News",
  "Daily National Shell Egg Index Report (5-day rolling average)",
  "Fri Sep 4, 2026",
  "Report for: 09/04/2026",
  "Caged 30-Dozen Cases / Cents Per Dozen / FOB",
  "",
  "Class          Color   Size          Volume   Price Range     Wtd Avg   Change   Last Reported   Year Ago",
  "Graded Loose   White   Extra Large   1,102    36.00-39.00     37.94     -0.90    38.84           219.11",
  "Graded Loose   White   Large         2,431    34.50-36.00     35.28     -0.86    36.14           215.53",
  "Graded Loose   White   Medium        988      27.00-29.50     28.11     -0.55    28.66           191.02",
].join("\n");

describe("the weighted average is the right column", () => {
  it("takes the figure after the range, not the largest number on the line", () => {
    // On the 2026-09-04 report the year-ago column reads 215.53 against a
    // weighted average of 35.28 -- a six-fold error that would look entirely
    // plausible on a screen.
    const row =
      "Graded Loose   White   Large         2,431    34.50-36.00     35.28     -0.86    36.14           215.53";
    expect(weightedAverageFrom(row)).toBe(35.28);
  });

  it("returns null on a row with no decimal at all", () => {
    expect(weightedAverageFrom("Graded Loose White Large 2,431")).toBeNull();
  });

  it("does NOT read the signed change column as the right half of a range", () => {
    // The defect this replaced: a range pattern tolerating whitespace read
    // "35.28     -0.86" as a range, threw both away, and returned the
    // last-reported figure. A range prints tight; the change prints signed.
    const row =
      "Graded Loose   White   Large         2,431    34.50-36.00     35.28     -0.86    36.14           215.53";
    expect(weightedAverageFrom(row)).not.toBe(36.14);
    expect(weightedAverageFrom(row)).not.toBe(215.53);
    expect(weightedAverageFrom(row)).not.toBe(34.5);
  });

  it("returns null when the row carries no range token, rather than guessing a column", () => {
    expect(
      weightedAverageFrom("Graded Loose White Large 2,431 35.28 -0.86 36.14"),
    ).toBeNull();
  });
});

describe("the parser admits the contract sample", () => {
  it("reads the issuer's own date, unit and value", () => {
    const run = parseUsdaShellEgg(CONTRACT_SAMPLE, OPTS);
    expect(run.refusals).toEqual([]);
    expect(run.observations).toHaveLength(1);
    const o = run.observations[0];
    expect(o.value).toBe(35.28);
    expect(o.periodStart).toBe("2026-09-04");
    expect(o.periodGrain).toBe("day");
    // The one series in phase 0 that earns `issuer_stated` off the face of a
    // report rather than out of a JSON field.
    expect(o.issuedAtBasis).toBe("issuer_stated");
  });

  it("picks the Large row and not Extra Large", () => {
    const run = parseUsdaShellEgg(CONTRACT_SAMPLE, OPTS);
    expect(run.observations[0].value).toBe(35.28);
    expect(run.rowsRead).toBe(1);
  });

  it("states no base period, because a price has none", () => {
    expect(parseUsdaShellEgg(CONTRACT_SAMPLE, OPTS).basePeriod).toBeNull();
  });
});

describe("the three things it refuses the whole payload for", () => {
  it("refuses an undated report — a daily index without its date is the signal missing", () => {
    const undated = CONTRACT_SAMPLE.replace("Report for: 09/04/2026", "Report for: ");
    const run = parseUsdaShellEgg(undated, OPTS);
    expect(run.observations).toEqual([]);
    expect(run.refusals.map((r) => r.reason)).toContain("no_report_date");
  });

  it("refuses a report that does not state its unit", () => {
    const unitless = CONTRACT_SAMPLE.replace("Cents Per Dozen", "Per Dozen");
    const run = parseUsdaShellEgg(unitless, OPTS);
    expect(run.observations).toEqual([]);
    expect(run.refusals.map((r) => r.reason)).toContain("unit_not_stated");
  });

  it("refuses a report that does not state its trade level", () => {
    // Wholesale and retail differed by 6.3x on the day this was measured.
    const noFob = CONTRACT_SAMPLE.replace(" / FOB", "");
    const run = parseUsdaShellEgg(noFob, OPTS);
    expect(run.observations).toEqual([]);
    expect(run.refusals.map((r) => r.reason)).toContain("trade_level_not_stated");
  });
});

describe("layout changes are named, never resolved by guessing", () => {
  it("refuses TWO rows that both read as the series", () => {
    const doubled =
      CONTRACT_SAMPLE +
      "\nGraded Loose   White   Large         900      40.00-41.00     40.50     +5.22    35.28           220.00";
    const run = parseUsdaShellEgg(doubled, OPTS);
    expect(run.refusals.map((r) => r.reason)).toContain("ambiguous_row");
    expect(run.observations).toHaveLength(1);
  });

  it("says a missing row is an unrecognised layout, not a quiet market", () => {
    const noRow = CONTRACT_SAMPLE.split("\n")
      .filter((l) => !/\bLarge\b/.test(l) || /Extra Large/.test(l))
      .join("\n");
    const run = parseUsdaShellEgg(noRow, OPTS);
    expect(run.refusals.map((r) => r.reason)).toContain("row_not_found");
    expect(run.refusals[0].detail).toMatch(/not a day the market was quiet/);
  });
});

describe("the admission gate, on a daily price series", () => {
  it("admits a report read the day after it was issued", () => {
    const run = parseUsdaShellEgg(CONTRACT_SAMPLE, OPTS);
    const v = admitRun(
      { ...ENTRY, admission: "fetch", withheld: null },
      run,
      new Date("2026-09-05T00:00:00Z"),
    );
    expect(v.admitted).toBe(true);
    expect(v.ageDays).toBe(1);
  });

  it("refuses one a week old, because this series is DAILY", () => {
    const run = parseUsdaShellEgg(CONTRACT_SAMPLE, OPTS);
    const v = admitRun(
      { ...ENTRY, admission: "fetch", withheld: null },
      run,
      new Date("2026-09-12T00:00:00Z"),
    );
    expect(v.admitted).toBe(false);
    expect(v.reason).toBe("stale");
  });

  it("refuses it outright while the series is upload_only — which it IS today", () => {
    const run = parseUsdaShellEgg(CONTRACT_SAMPLE, OPTS);
    const v = admitRun(ENTRY, run, new Date("2026-09-05T00:00:00Z"));
    expect(v.admitted).toBe(false);
    expect(v.reason).toBe("upload_only");
    expect(v.detail).toMatch(/403/);
  });
});

describe("the series says out loud that it has never seen real bytes", () => {
  it("is flagged awaiting the human download", () => {
    // The founder's Q1 answer: a one-off human read, logged. Until it happens
    // nothing anywhere may report this series as working.
    expect(ENTRY.awaitingHumanDownload).toBe(true);
    expect(ENTRY.admission).toBe("upload_only");
  });
});
