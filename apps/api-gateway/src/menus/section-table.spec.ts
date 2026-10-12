import {
  menusSplitByKind,
  seamKeyOf,
  sectionPathOf,
  splitByKind,
} from "./section-table";
import type { WineExtractItem } from "./wine-extract-item.interface";
import type { MenuKindGuess } from "./menu-line-view";

/**
 * ADR 0340 rules 13-15 (lane 5b): the split of one read by kind, the seam
 * key of a split PDF, and the flag the split ships behind.
 */
const line = (
  name: string,
  path: string[] | null,
  more: Partial<WineExtractItem> = {},
): WineExtractItem => ({
  name,
  ...(path ? { section: { path } } : {}),
  ...more,
});

describe("MENUS_SPLIT_BY_KIND", () => {
  it("is on only when it says exactly true", () => {
    expect(menusSplitByKind({})).toBe(false);
    expect(menusSplitByKind({ MENUS_SPLIT_BY_KIND: "" })).toBe(false);
    expect(menusSplitByKind({ MENUS_SPLIT_BY_KIND: "1" })).toBe(false);
    expect(menusSplitByKind({ MENUS_SPLIT_BY_KIND: "TRUE" })).toBe(false);
    expect(menusSplitByKind({ MENUS_SPLIT_BY_KIND: "true" })).toBe(true);
  });
});

describe("the seam key of a split read (rule 14)", () => {
  it("names in any script stay apart: the old [a-z0-9] fold made them one empty key", () => {
    expect(seamKeyOf(line("Ξινόμαυρο", null))).not.toBe(
      seamKeyOf(line("Ασύρτικο", null)),
    );
    expect(seamKeyOf(line("Ξινόμαυρο", null))).not.toBe("||");
  });

  it("holds the section path and never a price", () => {
    const red = line("House", ["Wines", "Red"], { bottle_price: 30 });
    expect(seamKeyOf(red)).toBe(
      seamKeyOf(line("HOUSE", ["wines ", "RED"], { bottle_price: 45 })),
    );
    expect(seamKeyOf(red)).not.toBe(
      seamKeyOf(line("House", ["Wines", "White"])),
    );
  });

  it("a line with no section keeps the old key", () => {
    expect(
      seamKeyOf(
        line("Merlot", null, { producer: "Duckhorn", vintage: "2019" }),
      ),
    ).toBe("duckhorn|merlot|2019");
  });
});

describe("a line's section path", () => {
  it("is cut to three levels, and with no heading is its category", () => {
    expect(sectionPathOf(line("x", ["A", "B", "C", "D"]))).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(sectionPathOf(line("x", null, { category: " red " }))).toEqual([
      "red",
    ]);
    expect(sectionPathOf(line("x", [" ", ""]))).toEqual([]);
  });
});

describe("the split by kind (rules 13 and 15)", () => {
  const kinds = (
    items: WineExtractItem[],
    opinion: Map<string, MenuKindGuess> | null = null,
  ) =>
    splitByKind(items, opinion).map((s) => [
      s.kind,
      s.items.map((i) => i.name),
    ]);

  it("a draft per kind, Drinks first; 'Dessert wines' under Wines stays a drink", () => {
    expect(
      kinds([
        line("Tiramisu", ["Desserts"], {
          price: 9,
          line_kind_suggested: "dish",
        }),
        line("Sauternes", ["Wines", "Dessert wines"], {
          bottle_price: 80,
          category: "dessert",
        }),
        line("Lamb", ["Mains"], { price: 30, line_kind_suggested: "dish" }),
      ]),
    ).toEqual([
      ["beverage", ["Sauternes"]],
      ["food", ["Lamb"]],
      ["desserts", ["Tiramisu"]],
    ]);
  });

  it("a dish keeps its one price in price, and no drink price or category", () => {
    const [food] = splitByKind(
      [line("Lamb", ["Mains"], { bottle_price: 30, category: "red" })],
      null,
    );
    expect(food.items[0]).toMatchObject({
      line_kind: "dish",
      price: 30,
      kind_flag: null,
    });
    expect(food.items[0].bottle_price).toBeUndefined();
    expect(food.items[0].category).toBeUndefined();
  });

  it("a 'dish' with a glass and a bottle price is Unsure, and says why", () => {
    const [food] = splitByKind(
      [line("Odd", ["Mains"], { by_glass_price: 9, bottle_price: 30 })],
      null,
    );
    expect(food.items[0].line_kind).toBeNull();
    expect(food.items[0].kind_flag).toMatch(/shape_contradicts_heading/);
  });

  it("a heading no rule knows is Unsure: its lines are never stored as drinks, and an Unsure line keeps its one price where a flat read does", () => {
    const [slice] = splitByKind(
      [line("Mystery", ["Zzqx"], { price: 12, line_kind_suggested: "dish" })],
      null,
    );
    expect(slice.kind).toBe("food");
    expect(slice.sections[0]).toMatchObject({
      suggestedKind: "unknown",
      suggestedBy: "none",
    });
    expect(slice.sections[0].unsure).toContain("rules_unknown");
    expect(slice.items[0]).toMatchObject({ line_kind: null, bottle_price: 12 });
    expect(slice.items[0].price).toBeUndefined();
  });

  it("the read's own kind places a section the rules cannot; the second opinion disagreeing makes it Unsure", () => {
    const items = [
      line("Pide", ["Zzqx"], { price: 12, line_kind_suggested: "dish" }),
    ];
    items[0].section!.kind_suggested = "food";
    const [placed] = splitByKind(items, null);
    expect(placed.sections[0]).toMatchObject({
      suggestedKind: "food",
      suggestedBy: "read",
    });
    const [disputed] = splitByKind(
      items,
      new Map([["Zzqx", "drinks" as MenuKindGuess]]),
    );
    expect(disputed.sections[0].unsure).toContain("model_disagrees");
    expect(disputed.items[0].line_kind).toBeNull();
  });

  it("the second opinion places a section nothing else did", () => {
    const [slice] = splitByKind(
      [line("Pide", ["Zzqx"], { price: 12 })],
      new Map([["Zzqx", "food" as MenuKindGuess]]),
    );
    expect(slice).toMatchObject({ kind: "food" });
    expect(slice.sections[0].suggestedBy).toBe("second_opinion");
  });

  it("a line with no heading and no category is placed alone and is Unsure", () => {
    const slices = splitByKind([line("Lone", null, { bottle_price: 9 })], null);
    expect(slices.map((s) => s.kind)).toEqual(["beverage"]);
    expect(slices[0].sections).toEqual([]);
    expect(slices[0].items[0].line_kind).toBeNull();
  });
});
