import { isSafePathSegment, isSafeRelativePath } from "./safe-path";

describe("isSafePathSegment", () => {
  it.each(["agents", "wine-matcher", "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "a_b.c~d"])(
    "allows the identifier %s",
    (s) => expect(isSafePathSegment(s)).toBe(true),
  );

  it.each([
    // The live escape: Express decodes route params, so this arrives already decoded.
    ["../../agents/execute", "decoded traversal"],
    ["..%2f..%2fagents", "still-encoded traversal"],
    ["..", "bare parent"],
    [".", "bare current"],
    ["a/b", "embedded slash — this is a SEGMENT, not a path"],
    ["a\\b", "backslash"],
    ["http://evil.com", "absolute URL"],
    ["", "empty"],
    ["a b", "space"],
    ["a?b=1", "query separator"],
    ["a#f", "fragment"],
  ])("rejects %s (%s)", (s) => expect(isSafePathSegment(s)).toBe(false));

  it("rejects non-strings and over-long values", () => {
    expect(isSafePathSegment(undefined)).toBe(false);
    expect(isSafePathSegment(null)).toBe(false);
    expect(isSafePathSegment(42)).toBe(false);
    expect(isSafePathSegment("a".repeat(257))).toBe(false);
  });
});

describe("isSafeRelativePath", () => {
  it.each(["queue", "invite/redeem", "contributors/3f2504e0-4f89/revoke"])(
    "allows %s",
    (s) => expect(isSafeRelativePath(s)).toBe(true),
  );

  it.each([
    ["a/../../../agents/execute", "traversal through segments"],
    ["/queue", "leading slash"],
    ["queue/", "trailing slash"],
    ["a//b", "doubled slash"],
    ["//evil.com/x", "scheme-relative"],
  ])("rejects %s (%s)", (s) => expect(isSafeRelativePath(s)).toBe(false));
});
