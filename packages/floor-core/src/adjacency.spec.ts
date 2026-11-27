import { ADJ_ACROSS, ADJ_ALONG, areAdjacent, formsAdjacentGroup, inferMergeOrientation } from "./adjacency";

const t = (id: string, posX: number | null, posY: number | null, sectionId: string | null = "s1") => ({
  id,
  posX,
  posY,
  sectionId,
});

describe("areAdjacent (the checker's 8-neighbour rule)", () => {
  it("admits cardinal and diagonal neighbours within ADJ_ALONG", () => {
    expect(areAdjacent(t("a", 10, 10), t("b", 10 + ADJ_ALONG, 10))).toBe(true);
    expect(areAdjacent(t("a", 10, 10), t("b", 10, 10 + ADJ_ALONG))).toBe(true);
    expect(areAdjacent(t("a", 10, 10), t("b", 20, 20))).toBe(true);
  });

  it("refuses a table past ADJ_ALONG on either axis", () => {
    expect(areAdjacent(t("a", 10, 10), t("b", 10 + ADJ_ALONG + 0.5, 10))).toBe(false);
    expect(areAdjacent(t("a", 10, 10), t("b", 12, 40))).toBe(false);
  });

  it("refuses another section, no section, the same table and the same spot", () => {
    expect(areAdjacent(t("a", 10, 10), t("b", 12, 10, "s2"))).toBe(false);
    expect(areAdjacent(t("a", 10, 10, null), t("b", 12, 10, null))).toBe(false);
    expect(areAdjacent(t("a", 10, 10), t("a", 12, 10))).toBe(false);
    expect(areAdjacent(t("a", 10, 10), t("b", 10, 10))).toBe(false);
  });

  it("a table in the tray (no place) is next to nothing", () => {
    expect(areAdjacent(t("a", null, 10), t("b", 12, 10))).toBe(false);
    expect(areAdjacent(t("a", 10, 10), t("b", 12, null))).toBe(false);
  });
});

describe("formsAdjacentGroup", () => {
  it("is a chain of neighbours, not every pair", () => {
    expect(formsAdjacentGroup([t("a", 10, 10), t("b", 24, 10), t("c", 38, 10)])).toBe(true);
  });

  it("refuses a group with a stray member, and fewer than two", () => {
    expect(formsAdjacentGroup([t("a", 10, 10), t("b", 24, 10), t("c", 80, 80)])).toBe(false);
    expect(formsAdjacentGroup([t("a", 10, 10)])).toBe(false);
  });
});

describe("inferMergeOrientation", () => {
  it("names the larger axis, or diagonal when both pass ADJ_ACROSS", () => {
    expect(inferMergeOrientation(t("a", 10, 10), t("b", 24, 12))).toBe("horizontal");
    expect(inferMergeOrientation(t("a", 10, 10), t("b", 12, 24))).toBe("vertical");
    expect(inferMergeOrientation(t("a", 10, 10), t("b", 22, 22))).toBe("diagonal");
  });

  it("is null without a place, never guessed", () => {
    expect(inferMergeOrientation(t("a", null, null), t("b", 12, 24))).toBeNull();
  });
});

describe("edges", () => {
  it("a place that is not a finite number is next to nothing", () => {
    expect(areAdjacent(t("a", NaN, 10), t("b", 12, 10))).toBe(false);
    expect(areAdjacent(t("a", 10, Infinity), t("b", 12, 10))).toBe(false);
    expect(inferMergeOrientation(t("a", NaN, 10), t("b", 12, 10))).toBeNull();
  });

  it("diagonal starts past ADJ_ACROSS on both axes, not at it", () => {
    expect(inferMergeOrientation(t("a", 0, 0), t("b", ADJ_ACROSS, ADJ_ACROSS))).toBe("horizontal");
    expect(inferMergeOrientation(t("a", 0, 0), t("b", ADJ_ACROSS + 0.5, ADJ_ACROSS + 0.5))).toBe("diagonal");
  });

  it("a group naming one table twice is not a group of neighbours", () => {
    expect(formsAdjacentGroup([t("a", 10, 10), t("a", 10, 10)])).toBe(false);
    // A repeat reached through a real neighbour is still refused.
    expect(formsAdjacentGroup([t("a", 10, 10), t("b", 20, 10), t("a", 10, 10)])).toBe(false);
    // A table with no id, or an empty one, cannot be told apart from a repeat.
    expect(formsAdjacentGroup([t("a", 10, 10), { ...t("b", 20, 10), id: undefined }])).toBe(false);
    expect(formsAdjacentGroup([t("a", 10, 10), t("", 20, 10)])).toBe(false);
  });
});
