/**
 * TÜİK's SDMX-CSV, against the RECORDED BYTES.
 *
 * `__fixtures__/tuik-tt01-cpi-food-2026-09-05.sample.csv` is the WHOLE response
 * the parent's one-off key check received on 2026-09-05 — HTTP 200, 891 bytes,
 * sha256 `5760a5fa…72a2d9`, unreduced. Nothing here goes outbound.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import {
  DEGISIM_MEANING,
  KEY_DIMENSIONS,
  buildKey,
  parseTuikSdmx,
} from "./parse-tuik-sdmx";
import { admitRun } from "./commodity-admission";
import { sdmxUrlFor } from "./commodity-fetch.service";
import { SERIES } from "./commodity.registry";

const TT01_BYTES = readFileSync(
  join(__dirname, "__fixtures__", "tuik-tt01-cpi-food-2026-09-05.sample.csv"),
);
const TT01 = TT01_BYTES.toString("utf8");
const TT09 = readFileSync(
  join(__dirname, "__fixtures__", "tuik-tt09-beverage-subclasses-2026-09-05.sample.csv"),
  "utf8",
);

const E01 = SERIES["tuik.tufe_tt01.food_and_non_alcoholic_beverages"];
const E09 = SERIES["tuik.tufe_tt09.beverage_subclasses"];
const AT = "2026-09-05T22:20:00.000Z";
const opts01 = {
  seriesKey: E01.seriesKey,
  fetchedAt: AT,
  expectDegisim: E01.sdmx!.degisim,
  expectCoicop: E01.sdmx!.coicop,
};

describe("the fixture is the bytes that were actually received", () => {
  it("hashes to the sha256 the key check recorded", () => {
    // The whole point of a recorded fixture: if this file is ever edited, this
    // test says so rather than the parser silently being proved against
    // something nobody fetched.
    expect(createHash("sha256").update(TT01_BYTES).digest("hex")).toBe(
      "5760a5fa969a27ea8d88000f593abf3d75d70491bad7308e6692dd139072a2d9",
    );
    expect(TT01_BYTES.length).toBe(891);
  });
});

describe("THE TEN-DIMENSION KEY ORDER, pinned against the recorded header", () => {
  it("is the payload's own order, not the service's /structure", () => {
    // The Data Explorer's /structure call advertises SIX dimensions; the payload
    // has TEN. The four extra are OZEL_KAPSAM_TUFE, YAYIM_DONEMI, COICOP_1999
    // and a DEGISIM the structure omits. A key built from /structure is a wrong
    // key that still looks right, so the constant is pinned against real bytes.
    const header = TT01.split(/\r?\n/)[0].split(",");
    expect(header[0]).toBe("DATAFLOW");
    expect(header.slice(1, 11)).toEqual([...KEY_DIMENSIONS]);
    expect(KEY_DIMENSIONS).toHaveLength(10);
  });

  it("builds the exact key the 200 was received for", () => {
    expect(buildKey(E01.sdmx!.key)).toBe("TR.M.2.1._Z.2025.2026_01._Z.01.F_TFE");
  });

  it("builds the URL with the period bound that keeps the read small", () => {
    // 891 bytes against 455,666 for the same key unbounded.
    expect(sdmxUrlFor(E01)).toBe(
      "https://nsiws.tuik.gov.tr/rest/data/TR,DF_TUFE_SDMX_TT01,1.0/TR.M.2.1._Z.2025.2026_01._Z.01.F_TFE?format=SDMX-CSV&startPeriod=2026-01",
    );
  });

  it("names what each DEGISIM means, because the payload never does", () => {
    expect(DEGISIM_MEANING["1"]).toBe("index level");
    expect(DEGISIM_MEANING["2"]).toBe("monthly percentage change");
    expect(DEGISIM_MEANING["4"]).toBe("annual percentage change");
  });
});

describe("parseTuikSdmx, on TT01", () => {
  it("reads all eight months and refuses none", () => {
    const run = parseTuikSdmx(TT01, opts01);
    expect(run.rowsRead).toBe(8);
    expect(run.observations).toHaveLength(8);
    expect(run.refusals).toEqual([]);
  });

  it("reads the issuer's own August 2026 value, 134.31", () => {
    const aug = parseTuikSdmx(TT01, opts01).observations.find(
      (o) => o.periodStart === "2026-08-01",
    );
    expect(aug?.value).toBe(134.31);
    expect(aug?.periodGrain).toBe("month");
  });

  it("reads the BASE back out of the file rather than assuming it", () => {
    // TÜİK rebased this series off 2003=100 within the last year and publishes
    // both. The base is what the admission gate compares.
    expect(parseTuikSdmx(TT01, opts01).basePeriod).toBe("2025=100");
  });

  it("dates every row by OUR read, because the payload states no publication date", () => {
    // YAYIM_DONEMI is the release ROUND (2026_01), not the day of publication.
    // Reading it as one would invent a date the issuer never gave.
    const run = parseTuikSdmx(TT01, opts01);
    expect(run.issuerReleaseDate).toBeNull();
    expect(run.observations.every((o) => o.issuedAtBasis === "fetch_date")).toBe(true);
    expect(run.observations.every((o) => o.issuedAt === AT)).toBe(true);
  });

  it("keys the dedup ref by the series, the code and the period, never the instant", () => {
    const a = parseTuikSdmx(TT01, opts01);
    const b = parseTuikSdmx(TT01, { ...opts01, fetchedAt: "2026-09-06T09:00:00.000Z" });
    expect(a.observations.map((o) => o.sourceRef)).toEqual(
      b.observations.map((o) => o.sourceRef),
    );
    expect(a.observations[0].sourceRef).toMatch(/:01:2026-01$/);
  });
});

describe("THE UNIT IS DEGISIM, AND A WRONG ONE IS REFUSED BY NAME", () => {
  it("refuses a monthly-percentage row in a register of index levels", () => {
    // UNIT_MEASURE is empty on every row of this payload, so nothing in the
    // file would have said a 0.22 and a 134.31 are different kinds of number.
    const percent = TT01.replace(
      "TR,M,2,1,_Z,2025,2026_01,_Z,01,F_TFE,2026-08,134.31",
      "TR,M,2,2,_Z,2025,2026_01,_Z,01,F_TFE,2026-08,0.22",
    );
    expect(percent).not.toBe(TT01);
    const run = parseTuikSdmx(percent, opts01);
    expect(run.observations.find((o) => o.periodStart === "2026-08-01")).toBeUndefined();
    const refusal = run.refusals.find((r) => r.reason === "wrong_degisim")!;
    expect(refusal.detail).toMatch(/monthly percentage change/);
    expect(refusal.detail).toMatch(/UNIT_MEASURE is empty on every row/);
  });

  it("refuses a COICOP code this series did not ask for", () => {
    // TÜİK's keyless route has been measured silently ignoring a filter and
    // returning fourteen codes for one.
    const other = TT01.replace(
      "_Z,01,F_TFE,2026-08",
      "_Z,07,F_TFE,2026-08",
    );
    const run = parseTuikSdmx(other, opts01);
    expect(run.refusals.map((r) => r.reason)).toContain("unexpected_coicop");
    expect(run.observations).toHaveLength(7);
  });

  it("refuses a file that mixes two bases in one response", () => {
    const mixed = TT01.replace(
      "TR,M,2,1,_Z,2025,2026_01,_Z,01,F_TFE,2026-08",
      "TR,M,2,1,_Z,2003,2026_01,_Z,01,F_TFE,2026-08",
    );
    const run = parseTuikSdmx(mixed, opts01);
    expect(run.refusals.map((r) => r.reason)).toContain("mixed_base");
  });

  it("refuses a payload whose columns are not the ones it was written against", () => {
    // SDMX-CSV may reorder its columns, and a positional parser reads OBS_VALUE
    // out of whichever column happens to be there.
    const run = parseTuikSdmx("A,B,C\n1,2,3", opts01);
    expect(run.observations).toEqual([]);
    expect(run.refusals[0].reason).toBe("unknown_columns");
    expect(run.refusals[0].detail).toMatch(/positional parser/);
  });

  it("tells an empty response apart from a series that published nothing", () => {
    expect(parseTuikSdmx("", opts01).refusals[0].reason).toBe("unreadable_payload");
    const header = TT01.split(/\r?\n/)[0];
    expect(parseTuikSdmx(header, opts01).refusals[0].reason).toBe("no_observations");
  });
});

describe("admitRun, on the TÜİK series", () => {
  it("admits the fixture inside the cadence bound", () => {
    const run = parseTuikSdmx(TT01, opts01);
    const v = admitRun(E01, run, new Date("2026-09-05T00:00:00Z"));
    expect(v.admitted).toBe(true);
    expect(v.ageDays).toBe(35); // 2026-08-01 to 2026-09-05
  });

  it("REFUSES the older base, which TÜİK still publishes", () => {
    const rebased = TT01.replace(/,2025,2026_01,/g, ",2003,2026_01,");
    const run = parseTuikSdmx(rebased, opts01);
    expect(run.basePeriod).toBe("2003=100");
    const v = admitRun(E01, run, new Date("2026-09-05T00:00:00Z"));
    expect(v.admitted).toBe(false);
    expect(v.reason).toBe("base_changed");
  });

  it("refuses a run whose newest observation is a whole cycle behind", () => {
    const run = parseTuikSdmx(TT01, opts01);
    expect(admitRun(E01, run, new Date("2026-11-01T00:00:00Z")).reason).toBe("stale");
  });
});

describe("TT09: the codes stay codes", () => {
  it("reads all three beverage subclasses and names none of them", () => {
    const run = parseTuikSdmx(TT09, {
      seriesKey: E09.seriesKey,
      fetchedAt: AT,
      expectDegisim: E09.sdmx!.degisim,
      expectCoicop: E09.sdmx!.coicop,
    });
    expect(run.refusals).toEqual([]);
    expect(run.observations.length).toBeGreaterThan(0);
    const aug = run.observations.filter((o) => o.periodStart === "2026-08-01");
    expect(aug.map((o) => o.value).sort((a, b) => a - b)).toEqual([126.5, 128.89, 140.2]);
    // The source ref carries the CODE, and the code is all anybody has.
    expect(run.observations.some((o) => o.sourceRef.includes(":02130:"))).toBe(true);
  });

  it("says in the register that the labels are unread, and names nothing", () => {
    // The founder's words for this entry were "codes unnamed for now". Guessing
    // that 02130 is wine would be inventing a fact about a series a house might
    // act on.
    expect(E09.silent?.kind).toBe("codelist_unread");
    expect(E09.silent?.reason).toMatch(/have never been read/);

    // Checked on the fields that could ever be RENDERED AS A LABEL, not on the
    // whole entry: the `silent` reason deliberately contains the word "wine",
    // in the sentence that refuses to guess it -- "guessing which subclass is
    // wine would be inventing a fact". A blunter check would have forced that
    // sentence out, and the sentence is the clearest statement of the rule.
    const labelFields = [
      E09.seriesTitle,
      E09.display.category,
      E09.display.shortIssuer,
      E09.display.extent,
      ...E09.sdmx!.coicop,
    ]
      .join(" ")
      .toLowerCase();
    for (const word of ["wine", "beer", "spirit", "şarap", "bira", "rakı", "alkol"]) {
      expect(labelFields).not.toContain(word);
    }
    // And the codes really are codes: five digits, nothing else.
    for (const code of E09.sdmx!.coicop) expect(code).toMatch(/^\d{5}$/);
  });

  it("is read at a LOWER cadence, and the reason is the measured payload size", () => {
    expect(E09.fetchIntervalDays).toBe(28);
    expect(E09.requestBudgetPerDay).toBe(2);
    expect(E09.cadence).toMatch(/7,532,768 bytes/);
    // TT01 is 891 bytes and declares no interval: it reads every sweep.
    expect(E01.fetchIntervalDays).toBeUndefined();
  });
});
