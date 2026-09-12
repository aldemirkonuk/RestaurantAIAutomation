import { menuScanVerdict } from "./menu-scan-verdict";

/**
 * The property under test is the one the verdict exists for: an unreadable
 * response and an empty menu page must NOT produce the same row. Before P3.0
 * both recorded `success`, because HTTP returned 200 in each case.
 */
describe("menuScanVerdict", () => {
  const base = { itemCount: 0, truncated: false, responseChars: 400 };

  it("calls an unreadable response a failure", () => {
    expect(
      menuScanVerdict({ ...base, parseStatus: "unparseable" }).outcome,
    ).toBe("failure");
  });

  it("calls the wrong shape a failure, not an empty menu", () => {
    expect(
      menuScanVerdict({ ...base, parseStatus: "parsed_not_array" }).outcome,
    ).toBe("failure");
  });

  it("does NOT call an empty list a failure — a menu page can have no wines", () => {
    const v = menuScanVerdict({ ...base, parseStatus: "parsed_array" });
    expect(v.outcome).toBeNull();
    expect(v.evidence?.untestable).toBe("model_returned_an_empty_list");
  });

  it("separates the two zero-item cases, which is the whole point", () => {
    const unreadable = menuScanVerdict({ ...base, parseStatus: "unparseable" });
    const emptyMenu = menuScanVerdict({ ...base, parseStatus: "parsed_array" });
    expect(unreadable.outcome).not.toEqual(emptyMenu.outcome);
  });

  it("calls truncation partial — the caller re-splits the PDF off that signal", () => {
    expect(
      menuScanVerdict({
        ...base,
        parseStatus: "salvaged",
        itemCount: 40,
        truncated: true,
      }).outcome,
    ).toBe("partial");
  });

  it("calls salvage partial even when the stop reason was not max_tokens", () => {
    expect(
      menuScanVerdict({ ...base, parseStatus: "salvaged", itemCount: 12 })
        .outcome,
    ).toBe("partial");
  });

  it("calls a clean parse with wines a success", () => {
    expect(
      menuScanVerdict({ ...base, parseStatus: "parsed_array", itemCount: 76 })
        .outcome,
    ).toBe("success");
  });

  it("prefers truncation over salvage when both are true", () => {
    // They co-occur constantly; `max_tokens` is the more specific statement and
    // both land on `partial`, so the evidence is what has to keep them apart.
    const v = menuScanVerdict({
      ...base,
      parseStatus: "salvaged",
      itemCount: 9,
      truncated: true,
    });
    expect(v.outcome).toBe("partial");
    expect(v.evidence).toMatchObject({
      truncated: true,
      parse_status: "salvaged",
    });
  });
});
