/**
 * The FAO parser, against the RECORDED FIXTURE.
 *
 * `__fixtures__/fao-food-price-index-2026-09-05.sample.csv` is a reduction of
 * bytes fetched on 2026-09-05 (HTTP 200, 48,006 bytes, sha256
 * `746104cf…c62f`) — the 3 header lines and the blank line verbatim plus the
 * last 40 monthly rows. `__fixtures__/COMMODITY-PROVENANCE.md` states the
 * reduction and this file's own hash.
 *
 * Nothing here goes outbound.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { parseFao } from "./parse-fao";
import { admitRun } from "./commodity-admission";
import { SERIES } from "./commodity.registry";

const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "fao-food-price-index-2026-09-05.sample.csv"),
  "utf8",
);
const ENTRY = SERIES["fao.food_price_index.all"];
const FETCHED_AT = "2026-09-05T12:00:00.000Z";
const opts = { seriesKey: ENTRY.seriesKey, fetchedAt: FETCHED_AT };

describe("parseFao, against the recorded fixture", () => {
  it("reads every monthly row and refuses none of them", () => {
    const run = parseFao(FIXTURE, opts);
    expect(run.rowsRead).toBe(40);
    expect(run.observations).toHaveLength(40);
    expect(run.refusals).toEqual([]);
  });

  it("reads the issuer's own August 2026 value, 133.3", () => {
    const run = parseFao(FIXTURE, opts);
    const august = run.observations.find((o) => o.periodStart === "2026-08-01");
    expect(august?.value).toBe(133.3);
    expect(august?.periodGrain).toBe("month");
  });

  it("reads the base period back OUT of the file rather than assuming it", () => {
    // This is the value the admission gate compares against the registry's
    // declared base. Assuming it would make the whole rebasing check vacuous.
    expect(parseFao(FIXTURE, opts).basePeriod).toBe("2014-2016=100");
  });

  it("reports that the file states NO publication date, and dates every row by our read", () => {
    // Measured: there is no release date, no revision date and no "generated
    // on" line anywhere in these bytes. Stamping our read date and calling it
    // the issuer's is the one move that manufactures provenance in the exact
    // place a reader looks for it.
    const run = parseFao(FIXTURE, opts);
    expect(run.issuerReleaseDate).toBeNull();
    expect(run.observations.every((o) => o.issuedAtBasis === "fetch_date")).toBe(true);
    expect(run.observations.every((o) => o.issuedAt === FETCHED_AT)).toBe(true);
  });

  it("keys the dedup ref by the FILE and the PERIOD, never by the fetch instant", () => {
    // A source ref carrying the instant would make every re-read a new row and
    // the unique index would never dedup anything.
    const a = parseFao(FIXTURE, opts);
    const b = parseFao(FIXTURE, { ...opts, fetchedAt: "2026-09-06T09:00:00.000Z" });
    expect(a.observations.map((o) => o.sourceRef)).toEqual(
      b.observations.map((o) => o.sourceRef),
    );
    expect(a.observations.map((o) => o.contentHash)).toEqual(
      b.observations.map((o) => o.contentHash),
    );
  });

  it("hashes a CHANGED value differently, so a revision becomes its own row", () => {
    const changed = FIXTURE.replace("2026-08,133.3,", "2026-08,133.9,");
    expect(changed).not.toBe(FIXTURE);
    const before = parseFao(FIXTURE, opts).observations.at(-1)!;
    const after = parseFao(changed, opts).observations.at(-1)!;
    expect(after.value).toBe(133.9);
    expect(after.contentHash).not.toBe(before.contentHash);
  });

  it("refuses an empty cell rather than reading it as a zero", () => {
    // `Number("")` is 0. An index of zero on a 100 base is not a small error on
    // a baseline median, it is a divide-by-a-lie.
    const holed = FIXTURE.replace("2026-08,133.3,", "2026-08,,");
    const run = parseFao(holed, opts);
    expect(run.observations.find((o) => o.periodStart === "2026-08-01")).toBeUndefined();
    expect(run.refusals.map((r) => r.reason)).toContain("no_value");
  });
});

describe("admitRun, on the FAO series", () => {
  it("admits the fixture on a day the newest observation is inside the cadence bound", () => {
    const run = parseFao(FIXTURE, opts);
    const verdict = admitRun(ENTRY, run, new Date("2026-09-05T00:00:00Z"));
    expect(verdict.admitted).toBe(true);
    // 2026-08-01 to 2026-09-05, aged from the OBSERVATION'S OWN PERIOD.
    expect(verdict.ageDays).toBe(35);
  });

  it("refuses the same file once its newest observation is a whole cycle behind", () => {
    const run = parseFao(FIXTURE, opts);
    const verdict = admitRun(ENTRY, run, new Date("2026-10-15T00:00:00Z"));
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toBe("stale");
    expect(verdict.detail).toMatch(/a 200 OK is not freshness/);
  });

  it("REFUSES A REBASING, which staleness alone cannot catch", () => {
    // FAO serves a SECOND live CSV path returning HTTP 200, well-formed, on
    // base 2002-2004=100, whose last row is Mar-18. THOSE BYTES WERE NOT
    // FETCHED BY THIS TASK and no fixture of them exists here, so this case is
    // built by altering the recorded file's own base line — which is the part
    // the gate reads. The age of that other file is a separate gate's job.
    const rebased = FIXTURE.replace("2014-2016=100,", "2002-2004=100,");
    expect(rebased).not.toBe(FIXTURE);
    const run = parseFao(rebased, opts);
    expect(run.basePeriod).toBe("2002-2004=100");
    const verdict = admitRun(ENTRY, run, new Date("2026-09-05T00:00:00Z"));
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toBe("base_changed");
    expect(verdict.detail).toMatch(/A base change is a NEW SERIES/);
  });

  it("refuses a file that states no base at all", () => {
    const noBase = FIXTURE.replace(/^2014-2016=100,.*$/m, ",,,,,");
    const run = parseFao(noBase, opts);
    expect(run.basePeriod).toBeNull();
    expect(admitRun(ENTRY, run, new Date("2026-09-05T00:00:00Z")).reason).toBe(
      "no_base_stated",
    );
  });
});
