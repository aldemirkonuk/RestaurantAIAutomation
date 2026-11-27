import { keepDescription, keepPrintedMarks, markIsPrinted, splitMarks } from "./printed-marks";
import { CsvParserService } from "./csv-parser.service";
import { EDITABLE_MENU_ITEM_FIELDS } from "../dto/review-menu-item.dto";

/**
 * r108 menu-g10: a line keeps only the marks the menu PRINTS. A mark is kept
 * when its token is on the line's own raw text, never from the dish's name.
 */
describe("keepPrintedMarks -- only what the line's text prints", () => {
  it("a reply's ['V'] is kept when the line prints V", () =>
    expect(keepPrintedMarks(["V"], "Mercimek (V) 120")).toEqual(["V"]));

  it("a mark the line's text does not carry is dropped (invented from the name)", () =>
    expect(keepPrintedMarks(["V", "GF"], "Garden salad 90")).toBeNull());

  it("a line with no raw text keeps no mark at all", () => {
    expect(keepPrintedMarks(["V"], null)).toBeNull();
    expect(keepPrintedMarks(["V"], undefined)).toBeNull();
  });

  it("a one-letter mark inside a word is not printed: V is not in 'Vino' or 'Velouté'", () => {
    expect(markIsPrinted("V", "Vino rosso, Velouté")).toBe(false);
    expect(markIsPrinted("V", "Château Lafite Cuvée IV")).toBe(false);
    expect(markIsPrinted("V", "Velouté [V]")).toBe(true);
  });

  it("words and symbols are found as printed, case aside", () => {
    expect(keepPrintedMarks(["contains nuts", "🌶"], "Muhammara 🌶 CONTAINS NUTS")).toEqual(["contains nuts", "🌶"]);
  });

  it("marks are trimmed and de-duplicated", () => expect(keepPrintedMarks([" V ", "v", "GF"], "Dolma V GF")).toEqual(["V", "GF"]));

  it("a mark longer than 40 characters is not a mark", () =>
    expect(keepPrintedMarks(["x".repeat(41)], `${"x".repeat(41)}`)).toBeNull());

  it("13 printed marks are refused whole, never cut to twelve", () => {
    const marks = Array.from({ length: 13 }, (_, i) => `M${i}`);
    expect(keepPrintedMarks(marks, marks.join(" "))).toBeNull();
    expect(keepPrintedMarks(marks.slice(0, 12), marks.join(" "))).toHaveLength(12);
  });

  it("a non-array reply keeps nothing", () => expect(keepPrintedMarks({ V: true }, "V")).toBeNull());
});

describe("splitMarks and keepDescription", () => {
  it("splits on , ; | /", () => expect(splitMarks("V, GF; VG | N/DF")).toEqual(["V", "GF", "VG", "N", "DF"]));
  it("a description is trimmed, its spaces folded, and capped at 1000", () => {
    expect(keepDescription("  Red   lentil\n lemon ")).toBe("Red lentil lemon");
    expect(keepDescription("")).toBeNull();
    expect(keepDescription(7)).toBeNull();
    expect(keepDescription("a".repeat(1200))!.length).toBe(1000);
  });
});

describe("the CSV reader reads Description and Notes", () => {
  const csv = new CsvParserService();
  it.each(["Description", "Açıklama"])("a %s column is the line's description", (h) =>
    expect(csv.parse(`name,${h}\nSoave,Crisp and dry\n`)[0].description).toBe("Crisp and dry"));
  it.each(["Dietary", "Allergens", "Marks"])("a %s column is read as the line's marks, split", (h) =>
    expect(csv.parse(`name,${h}\nSoave,"V, GF"\n`)[0].printed_marks).toEqual(["V", "GF"]));
  it.each(["Notes", "Note", "Notlar", "Not"])(
    "a %s column is never read as marks: it holds cost and supplier notes",
    (h) =>
      expect(
        csv.parse(`name,${h}\nSoave,"Supplier Kavaklidere; cost 210 TL / reorder at 6"\n`)[0].printed_marks,
      ).toBeUndefined());
  it("a marks cell keeps only legend-shaped tokens (no digit, three words at most)", () =>
    expect(
      csv.parse('name,Dietary\nSoave,"GF, cost 210 TL, contains nuts, a very long sentence about the cellar"\n')[0].printed_marks,
    ).toEqual(["GF", "contains nuts"]));
});

describe("PATCH items/:id", () => {
  it("accepts a description; marks are not typed in", () => {
    expect(EDITABLE_MENU_ITEM_FIELDS).toContain("description");
    expect(EDITABLE_MENU_ITEM_FIELDS as readonly string[]).not.toContain("printed_marks");
  });
});
