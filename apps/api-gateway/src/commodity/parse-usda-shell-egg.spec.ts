/**
 * The shell-egg parser, against the BYTES A PERSON BROUGHT BACK.
 *
 * `__fixtures__/usda-ams-2843-2026-09-04.report-detail-weighted.tsv` is the
 * *Report Detail Weighted* view of USDA AMS report 2843 for 2026-09-04 — all 23
 * rows, header verbatim, 9,115 bytes, sha256 `0371c7c7…23d49c` — read on
 * 2026-09-05 by the parent through the app's Browser pane on the founder's
 * batch-57 rule: **a one-off human read, logged**. No fetcher, script or job
 * touched the host, and nothing here goes outbound.
 *
 * These tests were previously written against a CONSTRUCTED sample of the PDF's
 * face text. They are now against the real file, and the constructed one is
 * gone: a fixture nobody fetched is not evidence.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import {
  CENTS_PER_DOZEN,
  NATIONAL_CAGED_LARGE,
  neighbouringFigures,
  parseUsdaShellEgg,
  type EggRowSelector,
} from "./parse-usda-shell-egg";
import { admitRun } from "./commodity-admission";
import { SERIES } from "./commodity.registry";

const BYTES = readFileSync(
  join(__dirname, "__fixtures__", "usda-ams-2843-2026-09-04.report-detail-weighted.tsv"),
);
const TSV = BYTES.toString("utf8");
const ENTRY = SERIES["usda_ams.shell_egg_index.national"];
const OPTS = { seriesKey: ENTRY.seriesKey, fetchedAt: "2026-09-05T22:40:20.000Z" };

describe("the fixture is the bytes the person brought back", () => {
  it("hashes to the sha256 the provenance file records", () => {
    // If this file is ever edited, this test says so rather than the parser
    // silently being proved against something nobody read.
    expect(createHash("sha256").update(BYTES).digest("hex")).toBe(
      "0371c7c7e617683adb37d6ab22e0c6245e6784055c0657181d83d43df423d49c",
    );
    expect(BYTES.length).toBe(9115);
  });

  it("carries the header and all 23 rows the page said it had", () => {
    const lines = TSV.split(/\r?\n/).filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(24);
    expect(lines[0].split("\t")).toContain("Wtd Avg Price");
  });
});

describe("the facts arrive as COLUMNS, not as the PDF's face text", () => {
  it("finds the date, the unit and the freight on the row itself", () => {
    const header = TSV.split(/\r?\n/)[0].split("\t");
    for (const column of [
      "Report Date",
      "Price Unit",
      "Freight",
      "Egg Type",
      "Environment",
      "Color",
      "Class",
      "Origin",
    ]) {
      expect(header).toContain(column);
    }
    // And the unit really is per row rather than in prose above the table.
    const rows = TSV.split(/\r?\n/).slice(1).filter((l) => l.trim() !== "");
    const unitAt = header.indexOf("Price Unit");
    expect(rows.every((r) => r.split("\t")[unitAt].trim() === CENTS_PER_DOZEN)).toBe(true);
  });
});

describe("THE SIX-PART SELECTION, and why five parts is a bug", () => {
  it("reads the series the plan recorded: Caged, National, FOB, 35.28", () => {
    const run = parseUsdaShellEgg(TSV, OPTS);
    expect(run.refusals).toEqual([]);
    expect(run.observations).toHaveLength(1);
    const o = run.observations[0];
    expect(o.value).toBe(35.28);
    expect(o.periodStart).toBe("2026-09-04");
    expect(o.periodGrain).toBe("day");
    expect(o.issuedAtBasis).toBe("issuer_stated");
    expect(o.sourceRef).toContain("Caged/National/FOB");
  });

  it("agrees with the plan's neighbouring figures, which are NOT written as observations", () => {
    // 35.28 - 36.14 = -0.86, the plan's recorded change. `Previous` and
    // `Last Year` are the issuer restating other dates; writing them as
    // observations would post one number twice under two periods.
    const n = neighbouringFigures(TSV);
    expect(n.previous).toBe(36.14);
    expect(n.lastYear).toBe(215.53);
    expect(n.volume).toBe(33234);
    expect(Number((35.28 - 36.14).toFixed(2))).toBe(-0.86);
  });

  it("THREE rows are white and Large, at three different prices", () => {
    // This is the fact the contract did not foresee and that makes five parts a
    // bug. Selecting on "white Large" alone would take whichever came first,
    // and a Cage-Free California DELIVERED price is a different market: 50.46
    // against the series' 35.28, a 43 percent error that looks entirely
    // ordinary on a screen.
    const header = TSV.split(/\r?\n/)[0].split("\t");
    const at = (n: string) => header.indexOf(n);
    const whiteLarge = TSV.split(/\r?\n/)
      .slice(1)
      .filter((l) => l.trim() !== "")
      .map((l) => l.split("\t"))
      .filter(
        (r) =>
          r[at("Egg Type")].trim() === "Graded Loose" &&
          r[at("Color")].trim() === "White" &&
          r[at("Class")].trim() === "Large",
      );
    expect(whiteLarge).toHaveLength(3);
    expect(whiteLarge.map((r) => r[at("Wtd Avg Price")].trim()).sort()).toEqual([
      "28.67",
      "35.28",
      "50.46",
    ]);
  });

  it("each SIX-part description picks exactly one of those three, and a different one", () => {
    const variants: Array<[Partial<EggRowSelector>, number]> = [
      [{}, 35.28], // Caged / National / FOB - the series
      [{ environment: "Cage-Free" }, 28.67], // Cage-Free / National / FOB
      [{ environment: "Cage-Free", origin: "California", freight: "Delivered" }, 50.46],
    ];
    for (const [over, expected] of variants) {
      const run = parseUsdaShellEgg(TSV, {
        ...OPTS,
        select: { ...NATIONAL_CAGED_LARGE, ...over },
      });
      expect(run.refusals).toEqual([]);
      expect(run.observations).toHaveLength(1);
      expect(run.observations[0].value).toBe(expected);
    }
  });

  it("refuses by name when the description matches more than one row", () => {
    // Built by widening the file rather than the selector: a second row that is
    // the same six-part market is a report whose shape changed under us.
    const lines = TSV.split(/\r?\n/).filter((l) => l.trim() !== "");
    const header = lines[0].split("\t");
    const target = lines
      .slice(1)
      .find((l) => l.split("\t")[header.indexOf("Wtd Avg Price")].trim() === "35.28")!;
    const doubled = [...lines, target].join("\n");
    const run = parseUsdaShellEgg(doubled, OPTS);
    expect(run.observations).toEqual([]);
    expect(run.refusals[0].reason).toBe("ambiguous_row");
    expect(run.refusals[0].detail).toMatch(/2 rows are Graded Loose \/ Caged \/ White \/ Large/);
    expect(run.refusals[0].detail).toMatch(/one market's price under another's name/);
  });

  it("refuses by name when the description matches none", () => {
    const run = parseUsdaShellEgg(TSV, {
      ...OPTS,
      select: { ...NATIONAL_CAGED_LARGE, class: "Peewee" },
    });
    expect(run.refusals[0].reason).toBe("row_not_found");
    expect(run.refusals[0].detail).toMatch(/never "a day the market was quiet"/);
  });
});

describe("an empty price is a market that did not report, never a zero", () => {
  it("refuses one of the six rows this file leaves blank", () => {
    // Measured: six of the 23 rows carry an empty Wtd Avg Price. `Number("")`
    // is 0, which would post a price of zero cents a dozen.
    const run = parseUsdaShellEgg(TSV, {
      ...OPTS,
      select: { ...NATIONAL_CAGED_LARGE, color: "Brown" },
    });
    expect(run.observations).toEqual([]);
    expect(run.refusals[0].reason).toBe("no_value");
    expect(run.refusals[0].detail).toMatch(/did not report on this date - it is not a price of zero/);
  });
});

describe("the columns are resolved by NAME, and the unit is checked per row", () => {
  it("refuses a payload whose column set is not the one it was written against", () => {
    const run = parseUsdaShellEgg("A\tB\n1\t2", OPTS);
    expect(run.observations).toEqual([]);
    expect(run.refusals[0].reason).toBe("unknown_columns");
    expect(run.refusals[0].detail).toMatch(/column ORDER is not a promise/);
  });

  it("survives a reordered header, because nothing here is positional", () => {
    const lines = TSV.split(/\r?\n/).filter((l) => l.trim() !== "");
    const header = lines[0].split("\t");
    const order = header.map((_, i) => i).reverse();
    const flip = (l: string) => order.map((i) => l.split("\t")[i]).join("\t");
    const reversed = lines.map(flip).join("\n");
    const run = parseUsdaShellEgg(reversed, OPTS);
    expect(run.observations[0]?.value).toBe(35.28);
  });

  it("refuses a row whose stated unit is not this series' unit", () => {
    const dollars = TSV.replace(/Cents Per Dozen/g, "Dollars Per Dozen");
    const run = parseUsdaShellEgg(dollars, OPTS);
    expect(run.observations).toEqual([]);
    expect(run.refusals[0].reason).toBe("unit_not_stated");
    expect(run.refusals[0].detail).toMatch(/off by a hundred/);
  });

  it("refuses an unreadable report date", () => {
    const undated = TSV.replace(/^09\/04\/2026/gm, "Sep 4");
    const run = parseUsdaShellEgg(undated, OPTS);
    expect(run.refusals[0].reason).toBe("no_report_date");
    expect(run.refusals[0].detail).toMatch(/five-day rolling average/);
  });

  it("refuses a header with no rows as a read that returned nothing", () => {
    const header = TSV.split(/\r?\n/)[0];
    expect(parseUsdaShellEgg(header, OPTS).refusals[0].reason).toBe("unreadable_payload");
  });
});

describe("the admission gate, on a daily price series", () => {
  it("admits the report read the day after it was issued", () => {
    const run = parseUsdaShellEgg(TSV, OPTS);
    const v = admitRun(
      { ...ENTRY, admission: "fetch", withheld: null },
      run,
      new Date("2026-09-05T00:00:00Z"),
    );
    expect(v.admitted).toBe(true);
    expect(v.ageDays).toBe(1);
  });

  it("refuses one a week old, because this series is DAILY", () => {
    const run = parseUsdaShellEgg(TSV, OPTS);
    const v = admitRun(
      { ...ENTRY, admission: "fetch", withheld: null },
      run,
      new Date("2026-09-12T00:00:00Z"),
    );
    expect(v.reason).toBe("stale");
  });

  it("refuses it outright while the series is upload_only — which it STILL IS", () => {
    // The human read was a ONE-OFF. A daily series read by hand once is not a
    // daily series, and nothing may point a fetcher at a host whose robots.txt
    // returns 403.
    const run = parseUsdaShellEgg(TSV, OPTS);
    const v = admitRun(ENTRY, run, new Date("2026-09-05T00:00:00Z"));
    expect(v.admitted).toBe(false);
    expect(v.reason).toBe("upload_only");
    expect(v.detail).toMatch(/403/);
  });
});

describe("the series has now seen real bytes, and says what that did and did not change", () => {
  it("no longer awaits the human download", () => {
    expect(ENTRY.awaitingHumanDownload).toBe(false);
  });

  it("stays upload_only, and the registry says the read was a one-off", () => {
    expect(ENTRY.admission).toBe("upload_only");
    expect(ENTRY.withheld?.reason).toMatch(/403/);
    expect(ENTRY.withheld?.reason).toMatch(/one-off/i);
  });
});
