import { readFileSync } from "fs";
import { join } from "path";
import {
  LWIN_REQUIRED_COLUMNS,
  identityFromLwin,
  readLwinFile,
  searchLwin,
  splitCsvLine,
} from "./lwin-file";
import { readIdentity } from "./beverage-identity";

/**
 * The LWIN reader — ADR 0124 Q4, the founder 2026-09-05: **"LWIN search + hand
 * nominations."** *"Two ways in; nothing invented."*
 *
 * THE FIXTURE IS SYNTHETIC AND SAYS SO. Not one real LWIN row is committed in
 * this repo: the database is Liv-ex's, free under CC BY 4.0, and is served
 * through a form rather than a URL (probed 2026-09-05 — the LWIN page carries
 * no .csv/.xlsx/.zip link and three guessed paths returned 404). Inventing rows
 * that claimed to be Liv-ex's would be a falsehood wearing a fixture's clothes.
 * What is asserted here is the READER: its shape, and every refusal.
 */

const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "lwin-database.synthetic.csv"),
  "utf8",
);

describe("splitCsvLine", () => {
  it("keeps a quoted comma inside its field", () => {
    expect(splitCsvLine('a,"b, still b",c')).toEqual(["a", "b, still b", "c"]);
  });
  it("unescapes a doubled quote", () => {
    expect(splitCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });
});

describe("readLwinFile", () => {
  it("reads the rows and counts every refusal by reason", () => {
    const r = readLwinFile(FIXTURE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Five good rows in the fixture; three deliberately broken ones.
    expect(r.rows).toHaveLength(5);
    expect(r.refusals).toEqual({
      lwin_not_seven_digits: 1,
      no_display_name: 1,
      no_producer: 1,
    });
  });

  it("keeps a quoted field with a comma intact", () => {
    const r = readLwinFile(FIXTURE);
    if (!r.ok) throw new Error("expected a reading");
    const row = r.rows.find((x) => x.lwin === "9900007")!;
    expect(row.displayName).toBe('Probe Estate "Special", Late Release');
  });

  it("REFUSES a file whose shape it does not recognise, by name", () => {
    const r = readLwinFile("SOME,OTHER,HEADER\n1,2,3");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing_columns");
    expect(r.missing).toEqual([...LWIN_REQUIRED_COLUMNS]);
    expect(r.note).toContain("refused rather than parsed into empty strings");
  });

  it("refuses an empty file", () => {
    const r = readLwinFile("   \n\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty_file");
  });

  it("says an all-refused file is about the FILE, not about the wine", () => {
    const r = readLwinFile(
      "LWIN,DISPLAY_NAME,PRODUCER_NAME\nnotacode,Name,Producer",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_rows");
    expect(r.note).toContain("about the file, not about the wine");
  });

  it("ignores comment lines so a recorded file can carry its provenance", () => {
    const r = readLwinFile(FIXTURE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rowsRead).toBe(8);
  });
});

describe("searchLwin", () => {
  const rows = (() => {
    const r = readLwinFile(FIXTURE);
    if (!r.ok) throw new Error("fixture unreadable");
    return r.rows;
  })();

  it("requires EVERY word of the query to appear, in any order", () => {
    expect(searchLwin(rows, "grande maison").map((h) => h.lwin)).toEqual([
      "9900003",
    ]);
  });

  it("finds nothing when one word does not appear, rather than the best of a bad lot", () => {
    expect(searchLwin(rows, "probe estate burgundy")).toHaveLength(0);
  });

  it("puts the plainest name first among equal matches", () => {
    const hits = searchLwin(rows, "probe estate");
    expect(hits[0].displayName).toBe("Probe Estate Grand Vin");
    expect(hits.length).toBeGreaterThan(1);
  });

  it("returns nothing for an empty query instead of the whole file", () => {
    expect(searchLwin(rows, "   ")).toHaveLength(0);
  });

  it("matches a year as a WORD, never as a vintage filter", () => {
    // The file carries no vintage per row: an LWIN-7 is the wine. A query with
    // a year must therefore find nothing here rather than silently succeed.
    expect(searchLwin(rows, "probe estate 2015")).toHaveLength(0);
  });
});

describe("identityFromLwin", () => {
  const row = {
    lwin: "9900001",
    displayName: "Probe Estate Grand Vin",
    producer: "Probe Estate",
    region: null,
    country: null,
    colour: null,
    status: null,
    raw: {},
  };

  it("takes the wine from the file and the FORMAT from the house", () => {
    const input = identityFromLwin(row, { vintage: 2015, sizeMl: 1500, pack: 1 });
    const read = readIdentity(input);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.producerNormalised).toBe("probe estate");
    expect(read.vintageText).toBe("2015");
    expect(read.sizeMl).toBe(1500);
  });

  it("invents no vintage, no size and no pack when the house states none", () => {
    const read = readIdentity(identityFromLwin(row));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.vintageText).toBe("unstated");
    expect(read.sizeMl).toBeNull();
    expect(read.pack).toBeNull();
  });
});
