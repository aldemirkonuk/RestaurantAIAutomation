/**
 * r36 menu audit N1: the photo reader names the money each line is printed
 * in, so the gateway can tell a euro price from the house's own
 * (menus/menu-money.ts on #1543). It never infers money, and a menu printing
 * two monies gives the second column in also_priced.
 */
import { ScanParserService, WINE_EXTRACTION_PROMPT } from "./scan-parser.service";

function readerReplying(text: string) {
  const call = jest.fn().mockResolvedValue({ content: [{ text }], stop_reason: "end_turn" });
  const s: any = new ScanParserService({ get: () => "fixture-key" } as any, { call } as any, { record: jest.fn() } as any);
  return { s, call };
}

describe("the menu photo reader names the money a line is printed in", () => {
  it("asks for currency and also_priced on every line", () => {
    expect(WINE_EXTRACTION_PROMPT).toContain(
      "{ name, producer, category, vintage, region, grape_variety, by_glass_price, bottle_price, currency, also_priced }",
    );
  });

  it("asks for the money as printed, beside the price or once for the menu, and never inferred", () => {
    expect(WINE_EXTRACTION_PROMPT).toContain(
      "currency is the money mark or code the prices you gave are printed with, exactly as printed",
    );
    expect(WINE_EXTRACTION_PROMPT).toContain("printed beside the price or once for the whole menu or section");
    expect(WINE_EXTRACTION_PROMPT).toContain("Omit currency when the menu prints no money mark or code at all");
    expect(WINE_EXTRACTION_PROMPT).toContain("never infer it from the country, the language or the price's size");
  });

  it("puts a second money's prices in also_priced, with a worked example, and keeps prices numbers", () => {
    expect(WINE_EXTRACTION_PROMPT).toContain(
      "each other money's prices in also_priced as a list of { currency, by_glass_price, bottle_price }",
    );
    expect(WINE_EXTRACTION_PROMPT).toContain(
      '{"name":"Chianti","currency":"₺","bottle_price":450,"also_priced":[{"currency":"€","bottle_price":12}]}',
    );
    expect(WINE_EXTRACTION_PROMPT).toContain("A price is always a number, never a string with its mark.");
  });

  it("keeps the dish clause and the drink vocabulary it already had", () => {
    expect(WINE_EXTRACTION_PROMPT).toContain('its category is exactly "food", whatever its section is called');
    expect(WINE_EXTRACTION_PROMPT).toMatch(/For a drink, category MUST be exactly one of: /);
  });

  it("returns each line's money and second column as read", async () => {
    const { s, call } = readerReplying(
      JSON.stringify([
        { name: "Chianti", category: "red", currency: "₺", bottle_price: 450, also_priced: [{ currency: "€", bottle_price: 12 }] },
        { name: "Efes", category: "beer", by_glass_price: 90 },
      ]),
    );
    const read = await s.parseOne("img", "image/png", false, "house", true);
    expect(call.mock.calls[0][0].body.messages[0].content[1]).toEqual({ type: "text", text: WINE_EXTRACTION_PROMPT });
    expect(read.items[0]).toMatchObject({ currency: "₺", bottle_price: 450, also_priced: [{ currency: "€", bottle_price: 12 }] });
    expect(read.items[1].currency).toBeUndefined();
  });
});
