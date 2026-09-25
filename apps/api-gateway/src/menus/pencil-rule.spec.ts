import { itemNeedsPencil } from "./pencil-rule";

describe("itemNeedsPencil", () => {
  it("keeps the unmatched fallback", () => {
    expect(itemNeedsPencil({ matched: false, category: "beer" })).toBe(true);
  });

  it("pencils a matched line with no extractor category", () => {
    expect(itemNeedsPencil({ matched: true, category: null })).toBe(true);
    expect(itemNeedsPencil({ matched: true, category: "unknown" })).toBe(true);
  });

  it("does not invent certainty — known category + match is ink", () => {
    expect(itemNeedsPencil({ matched: true, category: "beer" })).toBe(false);
  });
});
