import { parseYieldVerdict } from "./parse-yield-verdict";
import { ExtractionResult } from "./vendor-page-extraction";

const result = (over: Partial<ExtractionResult> = {}): ExtractionResult => ({
  items: [],
  rejected: [],
  warnings: [],
  parseStatus: "ok",
  rowCount: 0,
  yieldCollapsed: false,
  ...over,
});

describe("parseYieldVerdict", () => {
  it("calls a non-JSON response a failure", () => {
    expect(
      parseYieldVerdict(result({ parseStatus: "invalid_json" })).outcome,
    ).toBe("failure");
  });

  it("calls a response with no item array a failure", () => {
    expect(
      parseYieldVerdict(result({ parseStatus: "no_item_array" })).outcome,
    ).toBe("failure");
  });

  it("calls a collapsed yield partial — the parser is broken, not the catalogue small", () => {
    const v = parseYieldVerdict(
      result({
        rowCount: 100,
        items: new Array(20).fill({}) as any,
        rejected: new Array(80).fill({}) as any,
        yieldCollapsed: true,
      }),
    );
    expect(v.outcome).toBe("partial");
    expect(v.evidence).toMatchObject({ row_count: 100, rejected: 80 });
  });

  it("does NOT call a cleanly-parsed empty page a failure", () => {
    // An empty catalogue page and an unreadable one are indistinguishable at
    // zero rows. Guessing here would train people to ignore the flag.
    const v = parseYieldVerdict(result({ rowCount: 0 }));
    expect(v.outcome).toBeNull();
    expect(v.evidence?.untestable).toBe("zero_rows_parsed_cleanly");
  });

  it("calls a healthy extraction a success", () => {
    expect(
      parseYieldVerdict(
        result({ rowCount: 10, items: new Array(9).fill({}) as any }),
      ).outcome,
    ).toBe("success");
  });

  it("separates an unreadable page from an empty one", () => {
    expect(
      parseYieldVerdict(result({ parseStatus: "invalid_json" })).outcome,
    ).not.toEqual(parseYieldVerdict(result({ rowCount: 0 })).outcome);
  });
});
