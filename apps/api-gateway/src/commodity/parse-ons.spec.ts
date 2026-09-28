/**
 * The ONS parser, against the RECORDED FIXTURE.
 *
 * `__fixtures__/ons-d7bu-2026-09-05.sample.json` is a reduction of bytes
 * fetched on 2026-09-05 (HTTP 200, 125,504 bytes, sha256 `e8fba154…f1b`):
 * `description`, `type` and `uri` verbatim, `months` cut to the last 40.
 * `__fixtures__/COMMODITY-PROVENANCE.md` states the reduction.
 *
 * Nothing here goes outbound.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { onsBaseFromTitle, onsMonthToPeriodStart, parseOns } from "./parse-ons";
import { admitRun } from "./commodity-admission";
import { SERIES } from "./commodity.registry";

const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "ons-d7bu-2026-09-05.sample.json"),
  "utf8",
);
const ENTRY = SERIES["ons.d7bu.cpi_food_and_non_alcoholic_beverages"];
const FETCHED_AT = "2026-09-05T12:00:00.000Z";
const opts = { seriesKey: ENTRY.seriesKey, fetchedAt: FETCHED_AT };

describe("the ONS month spelling", () => {
  it("places every month ONS actually spells", () => {
    expect(onsMonthToPeriodStart("2026 JUL")).toBe("2026-07-01");
    expect(onsMonthToPeriodStart("1988 JAN")).toBe("1988-01-01");
    expect(onsMonthToPeriodStart("2026 DEC")).toBe("2026-12-01");
  });

  it("returns null rather than a guess for anything else", () => {
    // A quarter or a year is a real ONS row shape and it is NOT a month. A
    // parser that placed "2026 Q3" at some month would write an observation for
    // a period the issuer never published.
    expect(onsMonthToPeriodStart("2026 Q3")).toBeNull();
    expect(onsMonthToPeriodStart("2026")).toBeNull();
    expect(onsMonthToPeriodStart("2026 XXX")).toBeNull();
    expect(onsMonthToPeriodStart(undefined)).toBeNull();
  });
});

describe("the base period comes out of the TITLE", () => {
  it("reads it, because ONS states it nowhere else", () => {
    // `unit` is the generic "Index, base year = 100" on every ONS index series
    // and names no year at all, so a rebasing shows only in the title.
    expect(
      onsBaseFromTitle("CPI INDEX 01 : FOOD AND NON-ALCOHOLIC BEVERAGES 2015=100"),
    ).toBe("2015=100");
    expect(onsBaseFromTitle("something with no base")).toBeNull();
  });
});

describe("parseOns, against the recorded fixture", () => {
  it("reads all 40 months and refuses none", () => {
    const run = parseOns(FIXTURE, opts);
    expect(run.rowsRead).toBe(40);
    expect(run.observations).toHaveLength(40);
    expect(run.refusals).toEqual([]);
  });

  it("reads the issuer's own July 2026 value, 144.0", () => {
    const july = parseOns(FIXTURE, opts).observations.find(
      (o) => o.periodStart === "2026-07-01",
    );
    expect(july?.value).toBe(144);
  });

  it("dates every observation by the ISSUER, because ONS stamps one on each", () => {
    // This is the measured difference from FAO, which stamps none. It is what
    // earns this series the word "issued" on the screen.
    const run = parseOns(FIXTURE, opts);
    expect(run.issuerReleaseDate).toBe("2026-08-18T23:00:00.000Z");
    expect(run.observations.every((o) => o.issuedAtBasis === "issuer_stated")).toBe(true);
    const july = run.observations.find((o) => o.periodStart === "2026-07-01");
    expect(july?.issuedAt).toBe("2026-08-18T23:00:00.000Z");
    expect(july?.fetchedAt).toBe(FETCHED_AT);
  });

  it("falls back to `fetch_date` for a row the issuer dated nowhere", () => {
    // A row with neither its own updateDate nor a series releaseDate is undated
    // by the issuer, and says so rather than borrowing "issued" from the rows
    // beside it.
    const doc = JSON.parse(FIXTURE) as Record<string, unknown>;
    const description = doc.description as Record<string, unknown>;
    delete description.releaseDate;
    const months = doc.months as Array<Record<string, unknown>>;
    delete months[months.length - 1].updateDate;
    const run = parseOns(JSON.stringify(doc), opts);
    const last = run.observations.at(-1)!;
    expect(last.issuedAtBasis).toBe("fetch_date");
    expect(last.issuedAt).toBe(FETCHED_AT);
  });

  it("tells an unreadable body apart from a series that published nothing", () => {
    const broken = parseOns("<html>not json</html>", opts);
    expect(broken.refusals[0].reason).toBe("unreadable_payload");
    expect(broken.observations).toEqual([]);

    const emptied = parseOns(
      JSON.stringify({ description: { title: "X 2015=100" }, months: [] }),
      opts,
    );
    expect(emptied.refusals.map((r) => r.reason)).toContain("no_observations");
  });
});

describe("admitRun, on the ONS series", () => {
  it("admits the fixture inside the cadence bound", () => {
    const run = parseOns(FIXTURE, opts);
    const verdict = admitRun(ENTRY, run, new Date("2026-09-05T00:00:00Z"));
    expect(verdict.admitted).toBe(true);
    expect(verdict.ageDays).toBe(66); // 2026-07-01 to 2026-09-05
  });

  it("REFUSES A DISCONTINUED SERIES even though its releaseDate is fresh", () => {
    // The measured trap, on this exact host: four ONS RPI average-price series
    // return HTTP 200 with releaseDate 2026-08-18 and nextRelease 16 September
    // while every last observation is 2025 JAN. A gate that trusted the
    // release date would admit them forever.
    const doc = JSON.parse(FIXTURE) as Record<string, unknown>;
    doc.months = [
      {
        date: "2025 JAN",
        value: "140.0",
        updateDate: "2025-02-19T00:00:00.000Z",
      },
    ];
    const run = parseOns(JSON.stringify(doc), opts);
    // The issuer's own release date is still fresh, and is still read.
    expect(run.issuerReleaseDate).toBe("2026-08-18T23:00:00.000Z");
    const verdict = admitRun(ENTRY, run, new Date("2026-09-05T00:00:00Z"));
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toBe("stale");
    expect(verdict.ageDays).toBe(612); // 2025-01-01 to 2026-09-05
  });

  it("refuses a rebasing announced only in the title", () => {
    const doc = JSON.parse(FIXTURE) as Record<string, unknown>;
    (doc.description as Record<string, unknown>).title =
      "CPI INDEX 01 : FOOD AND NON-ALCOHOLIC BEVERAGES 2020=100";
    const run = parseOns(JSON.stringify(doc), opts);
    expect(run.basePeriod).toBe("2020=100");
    expect(admitRun(ENTRY, run, new Date("2026-09-05T00:00:00Z")).reason).toBe(
      "base_changed",
    );
  });
});
