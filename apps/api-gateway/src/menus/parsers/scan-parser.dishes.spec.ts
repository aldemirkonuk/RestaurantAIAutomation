/**
 * r28 onboarding audit, gap 1: the photo reader reads dishes too.
 *
 * The prompt said "a restaurant beverage menu ... Extract EVERY drink", so a
 * food restaurant's photo came back with nothing it could use, while a typed
 * or CSV dish was kept. A dish now comes back with category "food", the word
 * the typed line sends and a kitchen hint, so it takes every other dish's path:
 * kept on the menu, set aside from the drinks, never sent to the library.
 */
import { ScanParserService, WINE_EXTRACTION_PROMPT } from "./scan-parser.service";
import { isKitchenLine } from "../menu-line-view";
import { MENU_CATEGORY_VOCABULARY } from "../wine-extract-item.interface";

function readerReplying(text: string) {
  const call = jest.fn().mockResolvedValue({ content: [{ text }], stop_reason: "end_turn" });
  const s: any = new ScanParserService(
    { get: () => "fixture-key" } as any,
    { call } as any,
    { record: jest.fn() } as any,
  );
  return { s, call };
}

describe("the menu photo reader reads the dishes too", () => {
  it("asks for every dish as well as every drink", () => {
    expect(WINE_EXTRACTION_PROMPT).toMatch(/^You are analyzing a restaurant menu image\./);
    expect(WINE_EXTRACTION_PROMPT).not.toMatch(/beverage menu/);
    expect(WINE_EXTRACTION_PROMPT).toContain("and EVERY dish listed as well");
  });

  it('gives a dish category "food", one price in bottle_price, and no drink fields', () => {
    expect(WINE_EXTRACTION_PROMPT).toContain('its category is exactly "food", whatever its section is called');
    expect(WINE_EXTRACTION_PROMPT).toContain("its one price in bottle_price");
    expect(WINE_EXTRACTION_PROMPT).toContain(
      "omit producer, vintage, region, grape_variety and by_glass_price for it",
    );
    expect(WINE_EXTRACTION_PROMPT).toContain("A dessert wine, port or sherry is a drink, not a dish.");
  });

  it("keeps the drink vocabulary closed, for drinks, and does not add food to it", () => {
    expect(WINE_EXTRACTION_PROMPT).toContain(
      `For a drink, category MUST be exactly one of: ${MENU_CATEGORY_VOCABULARY.join(", ")}.`,
    );
    expect(MENU_CATEGORY_VOCABULARY as readonly string[]).not.toContain("food");
  });

  it("sends that prompt with the photo", async () => {
    const { s, call } = readerReplying("[]");
    await s.parseOne("img", "image/png", false, "house", true);
    const content = call.mock.calls[0][0].body.messages[0].content;
    expect(content[1]).toEqual({ type: "text", text: WINE_EXTRACTION_PROMPT });
  });

  it("returns the dishes it reads, and each one is a kitchen line while the wine is not", async () => {
    const { s } = readerReplying(
      JSON.stringify([
        { name: "Tiramisu", category: "food", bottle_price: 9 },
        { name: "Adana kebab", category: "food", bottle_price: 420 },
        { name: "Merlot", producer: "Duckhorn", category: "red", vintage: "2019", bottle_price: 120 },
      ]),
    );
    const read = await s.parseOne("img", "image/png", false, "house", true);
    expect(read.items.map((i: any) => i.name)).toEqual(["Tiramisu", "Adana kebab", "Merlot"]);
    expect(read.items.map((i: any) => isKitchenLine(i.category, i.raw_text, i))).toEqual([true, true, false]);
  });
});
