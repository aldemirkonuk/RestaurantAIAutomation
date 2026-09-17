import { readFileSync } from "fs";
import { join } from "path";
import {
  DEFRA_ATTRIBUTION,
  DefraRow,
  DefraShapeError,
  defraDate,
  parseCsv,
  parseDefra,
} from "./parse-defra";

/**
 * Defra's wholesale produce series, against a fixture of 59 REAL rows cut from
 * the 17,594-row edition fetched 2026-09-05
 * (sha256 ab56ded3a4bc3f65fd49e438fc6b43d7a0a9f22f2595afd1c2049941cc258c3d):
 * the 55 rows of the newest date, 3 rows of the previous edition, and the one
 * row in the whole file publishing a price of 0. Values untouched.
 */
function fixture(): DefraRow[] {
  const path = join(
    __dirname,
    "__fixtures__",
    "defra-wholesale-fruit-veg-2026-09-01.sample.csv",
  );
  return parseCsv(readFileSync(path, "utf-8")) as DefraRow[];
}

const FETCHED = "1970-01-01T00:00:00Z";

describe("parseDefra", () => {
  it("admits the 55 rows of the newest edition and refuses the other 4", () => {
    const run = parseDefra(fixture(), FETCHED);
    expect(run.rowsRead).toBe(59);
    expect(run.issuedAt).toBe("2026-08-31");
    expect(run.sightings).toHaveLength(55);
    expect(run.refusals).toHaveLength(4);
  });

  it("files the zero price as a price defect, not as an old row", () => {
    const run = parseDefra(fixture(), FETCHED);
    const byReason = run.refusals.reduce<Record<string, number>>((acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1;
      return acc;
    }, {});
    // The gladioli row publishes a price of exactly 0. A zero is not a price at
    // any date, so calling it "old" would name the wrong defect.
    expect(byReason).toEqual({ no_price: 1, row_older_than_file: 3 });
    expect(run.refusals.find((r) => r.reason === "no_price")!.detail).toContain(
      "gladioli",
    );
  });

  it("states GBP, the England-and-Wales key, and the unit the price is per", () => {
    const run = parseDefra(fixture(), FETCHED);
    const apples = run.sightings.find(
      (s) => s.externalIds.variety === "bramleys_seedling",
    )!;
    expect(apples.price).toBe(1.37);
    expect(apples.currency).toBe("GBP");
    expect(apples.priceUnit).toBe("per kg");
    expect(apples.state).toBe("GB-EAW");
    expect(apples.issuer).toBe(
      "Department for Environment, Food & Rural Affairs",
    );
    expect(apples.issuedAt).toBe("2026-08-31");
    expect(apples.productName).toBe("apples, bramleys seedling");
  });

  it("carries the OGL attribution the licence requires, on every row", () => {
    const run = parseDefra(fixture(), FETCHED);
    expect(run.sightings.every((s) => s.attribution === DEFRA_ATTRIBUTION)).toBe(
      true,
    );
    expect(DEFRA_ATTRIBUTION).toContain("Open Government Licence v3.0");
  });

  it("states no container size rather than inventing one", () => {
    // The price is per kg/head/stem. There is no bottle, so there is no volume:
    // NULL, never 0 (a 0 would be a size the issuer never published).
    const run = parseDefra(fixture(), FETCHED);
    expect(run.sightings.every((s) => s.sizeValue === null)).toBe(true);
    expect(run.sightings.every((s) => s.sizeUnit === null)).toBe(true);
    expect(run.sightings.every((s) => s.pack === null)).toBe(true);
  });

  it("keys source_ref on the series page, not on the edition URL", () => {
    // The edition URL carries a content hash and changes every fortnight; if it
    // were the key, no posting could ever dedup against its own history.
    const run = parseDefra(fixture(), FETCHED);
    expect(run.sightings[0].sourceRef).toContain(
      "/statistical-data-sets/wholesale-fruit-and-vegetable-prices-weekly-average#",
    );
    expect(run.sightings[0].sourceUrl).toContain("fruitvegprices-");
  });

  it("refuses a duplicate item on the same date", () => {
    const rows = fixture();
    const run = parseDefra([...rows, { ...rows[0] }], FETCHED);
    expect(run.sightings).toHaveLength(55);
    expect(
      run.refusals.filter((r) => r.reason === "duplicate_item"),
    ).toHaveLength(1);
  });

  it("refuses an unreadable date rather than guessing one", () => {
    const run = parseDefra(
      [
        {
          category: "fruit",
          item: "x",
          variety: "x",
          date: "2026-08-31",
          price: "1",
          unit: "kg",
        },
      ],
      FETCHED,
    );
    expect(run.sightings).toHaveLength(0);
    expect(run.refusals[0].reason).toBe("no_date");
  });

  it("refuses a blank unit — a price per nothing is not a price", () => {
    const run = parseDefra(
      [
        {
          category: "fruit",
          item: "x",
          variety: "x",
          date: "31/08/2026",
          price: "1",
          unit: "  ",
        },
      ],
      FETCHED,
    );
    expect(run.refusals[0].reason).toBe("no_unit");
  });

  it("refuses a changed shape rather than parsing the wrong columns", () => {
    expect(() => parseDefra([], FETCHED)).toThrow(DefraShapeError);
    expect(() => parseDefra([{ item: "x" } as DefraRow], FETCHED)).toThrow(
      DefraShapeError,
    );
  });
});

describe("defraDate", () => {
  it("reads dd/mm/yyyy and refuses anything else", () => {
    expect(defraDate("31/08/2026")).toBe("2026-08-31");
    expect(defraDate("5/7/2024")).toBe("2024-07-05");
    expect(defraDate("2026-08-31")).toBeNull();
    expect(defraDate("31/13/2026")).toBeNull();
    expect(defraDate("")).toBeNull();
    expect(defraDate(null)).toBeNull();
  });
});

describe("parseCsv", () => {
  it("keeps a comma inside a quoted field with the field", () => {
    // Defra's file has no quoted values today. A naive split would corrupt a
    // product name the day one appears, and a corrupted name on a real price is
    // worse than a refusal.
    expect(parseCsv('a,b\n"x,y",2\n')).toEqual([{ a: "x,y", b: "2" }]);
  });

  it("survives CRLF, a trailing newline and a UTF-8 BOM on the header", () => {
    expect(parseCsv("\uFEFFa,b\r\n1,2\r\n\r\n")).toEqual([{ a: "1", b: "2" }]);
  });
});
