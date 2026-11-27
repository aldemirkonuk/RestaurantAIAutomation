/**
 * r110 menu-g1: a mixed page reads its dishes as kitchen lines.
 *
 * The reader returns `kind`; a dish becomes a kitchen line whose category
 * reads as a kitchen line on every later read (menu_items stores no flag), its
 * one price in bottle_price, and a dish and a drink of one name stay two lines.
 */
import { ScanParserService, WINE_EXTRACTION_PROMPT, readDishesOf } from "./scan-parser.service";
import { isKitchenLine } from "../menu-line-view";

function readerReplying(...texts: string[]) {
  const call = jest.fn();
  for (const text of texts) call.mockResolvedValueOnce({ content: [{ text }], stop_reason: "end_turn" });
  const s: any = new ScanParserService(
    { get: () => "fixture-key" } as any,
    { call } as any,
    { record: jest.fn() } as any,
  );
  return { s, call };
}

const MIXED = JSON.stringify([
  { kind: "drink", name: "Merlot", producer: "Duckhorn", category: "red", vintage: "2019", bottle_price: 120 },
  { kind: "drink", name: "Ayran", category: "soft drink", by_glass_price: 40 },
  { kind: "dish", name: "Mercimek çorbası", category: "food", section: "Çorbalar", bottle_price: 180 },
  { kind: "dish", name: "Adana kebap", category: "food", section: "Mains", bottle_price: "420,50", description: "Acılı" },
  { kind: "dish", name: "Künefe", category: "food", section: "Desserts", producer: "x", vintage: "2020", bottle_price: 150 },
]);

describe("a mixed page reads its dishes as kitchen lines", () => {
  it("asks for kind and a dish's section, keeping the drink rules and examples", () => {
    expect(WINE_EXTRACTION_PROMPT).toContain("{ kind, name, producer, category, section,");
    expect(WINE_EXTRACTION_PROMPT).toContain('kind is "dish" for a dish and "drink" for a drink.');
    expect(WINE_EXTRACTION_PROMPT).toContain(
      '{"kind":"dish","name":"Mercimek çorbası","category":"food","section":"Çorbalar","bottle_price":180}',
    );
    expect(WINE_EXTRACTION_PROMPT).toContain('{"name":"Pale Ale","producer":"Sierra Nevada","category":"beer","by_glass_price":9}');
    expect(WINE_EXTRACTION_PROMPT).toContain("For a drink, category MUST be exactly one of:");
  });

  it("returns all five lines; the three dishes are kitchen lines with their price as read", async () => {
    const { s } = readerReplying(MIXED);
    const items = await s.parse(Buffer.from("not a pdf").toString("base64"), "house");
    expect(items.map((i: any) => i.name)).toEqual(["Merlot", "Ayran", "Mercimek çorbası", "Adana kebap", "Künefe"]);
    const dishes = items.slice(2);
    expect(dishes.map((i: any) => i.kitchen_line)).toEqual([true, true, true]);
    expect(items.slice(0, 2).map((i: any) => i.kitchen_line)).toEqual([undefined, undefined]);
    // A section that reads as a kitchen one is kept; one that does not is "food".
    expect(dishes.map((i: any) => i.category)).toEqual(["food", "Mains", "Desserts"]);
    expect(dishes.map((i: any) => i.bottle_price)).toEqual([180, 420.5, 150]);
    expect(dishes[1].description).toBe("Acılı");
    // A dish keeps no drink-only field.
    expect(dishes[2]).not.toHaveProperty("producer");
    expect(dishes[2]).not.toHaveProperty("vintage");
    expect(items[0]).toMatchObject({ producer: "Duckhorn", vintage: "2019", category: "red" });
  });

  it("every read dish is still a kitchen line when read back from its stored fields", () => {
    const [soup, mains, dessert] = readDishesOf(JSON.parse(MIXED).slice(2));
    for (const d of [soup, mains, dessert])
      expect(isKitchenLine(d.category, d.raw_text ?? null, d as any)).toBe(true);
  });

  it("a dish price that does not read is left off, never 0", () => {
    const [d] = readDishesOf([{ kind: "dish", name: "Pilav", section: "Sides", bottle_price: "12 / 45" as any }]);
    expect(d.kitchen_line).toBe(true);
    expect(d).not.toHaveProperty("bottle_price");
  });

  it("keeps a drink and a dish of one name across a chunk seam, and still drops a repeated drink", () => {
    const { s } = readerReplying();
    const merged = s.dedupe([
      { kind: "drink", name: "Limonata", bottle_price: 60 },
      { kind: "dish", name: "Limonata", bottle_price: 90 },
      { name: "Limonata", bottle_price: 60 },
    ]);
    expect(merged.map((i: any) => [i.kind, i.bottle_price])).toEqual([
      ["drink", 60],
      ["dish", 90],
    ]);
  });
});
