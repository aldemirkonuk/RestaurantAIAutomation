import { flagReasonOf, isKitchenLine, lineForViewer, seesRawLine, KITCHEN_HINTS, MEMBER_LINE_KEYS } from "./menu-line-view";
import { MenusController, MenuVersionsController } from "./menus.controller";
import { ROLE_POLICY } from "../ask-readings/reading-data-classes";

/**
 * menu-line-view.ts: what one menu line read says to the person reading it
 * (ADR 0309 option 1c, amended after the audit of #655 at 220e3747d). The
 * service-level cases, on rows built by the real CSV reader, are in
 * menus.service.spec.ts ("a line's raw line is a holder's").
 */
describe("menu-line-view", () => {
  it("isKitchenLine: a hint in the section, in the raw line, or in neither", () => {
    expect(isKitchenLine("Starters", null)).toBe(true);
    expect(isKitchenLine(null, "Tiramisu,,,,12,3.10,Metro,74%,Dessert")).toBe(true);
    expect(isKitchenLine("red", "Barolo,Vietti,2019,red,120")).toBe(false);
    expect(isKitchenLine(undefined, undefined)).toBe(false);
    expect(isKitchenLine(42, { pasta: true })).toBe(false);
  });

  it("a known drink section wins: a dessert wine stays a drink, whatever its raw line says (QA M18)", () => {
    expect(isKitchenLine("dessert", "Sauternes, Ch. Suduiraut, 2015, 90")).toBe(false);
    expect(isKitchenLine("Dessert ", "Tokaji Aszú, great with dessert")).toBe(false);
    expect(isKitchenLine("red", "Chianti, great with pasta")).toBe(false);
    expect(isKitchenLine("sparkling", "Dish Imports, Cava, 40")).toBe(false);
    expect(isKitchenLine("wine", "Salad days rosé")).toBe(false);
    // With no known section the hints still decide, as whole words, plurals too.
    expect(isKitchenLine(null, "Desserts: Tiramisu 12")).toBe(true);
    expect(isKitchenLine("Pastas", null)).toBe(true);
    expect(isKitchenLine("Entrées", null)).toBe(true);
    expect(isKitchenLine(null, "Pastaio Rosso, 2020, 38")).toBe(false);
    // Browser walk 2026-11-12: a dish section the house names its own way.
    expect(isKitchenLine("Mains", "Grilled Octopus,,,Mains,,24")).toBe(true);
    expect(isKitchenLine("Main Courses", null)).toBe(true);
    expect(isKitchenLine("Appetizers", null)).toBe(true);
    expect(isKitchenLine("Sides", null)).toBe(true);
    expect(isKitchenLine("Small plates", null)).toBe(true);
    expect(isKitchenLine("Meze", null)).toBe(true);
    // ...but a drink that only shares a word with a course stays a drink.
    expect(isKitchenLine("Cocktails", "Side Car, cognac, 14")).toBe(false);
    expect(isKitchenLine(null, "Main Street Cabernet, 2019, 48")).toBe(false);
    expect(isKitchenLine(null, "Grillo, Sicily, 2022, 36")).toBe(false);
    expect(isKitchenLine(null, "Dishwasher-safe carafe")).toBe(false);
  });

  it("'dessert' is a course unless the line shows it is a wine: Tiramisu goes to the kitchen", () => {
    expect(isKitchenLine("dessert", "Tiramisu 9")).toBe(true);
    expect(isKitchenLine("dessert", null, { name: "Crème brûlée", bottle_price: 11 })).toBe(true);
    expect(isKitchenLine("Dessert", "Panna cotta, 8", { name: "Panna cotta", producer: "  " })).toBe(true);
    // A drink field, a dessert-wine word, a year or a pour size makes it a drink.
    expect(isKitchenLine("dessert", null, { name: "Ch. d'Yquem", vintage: "2015" })).toBe(false);
    expect(isKitchenLine("dessert", null, { name: "Cuvée Marie", producer: "Ch. Rieussec" })).toBe(false);
    expect(isKitchenLine("dessert", "Moscato d'Asti 9")).toBe(false);
    expect(isKitchenLine("dessert", null, { name: "Late Harvest Riesling" })).toBe(false);
    expect(isKitchenLine("dessert", "Royal Tokaji 5 Puttonyos 50cl 70")).toBe(false);
    expect(isKitchenLine("dessert", "10yr Tawny, by the glass 8")).toBe(false);
    // Only 'dessert' is weighed: another drink section stays a drink with no evidence at all.
    expect(isKitchenLine("red", "House 9")).toBe(false);
  });

  it("lineForViewer weighs a dessert line by its own fields", () => {
    expect(lineForViewer({ name: "Tiramisu", category: "dessert", raw_extracted_text: "Tiramisu 9" }, { rawLine: false }).kitchen_line).toBe(true);
    expect(lineForViewer({ name: "Sauternes", category: "dessert", vintage: "2016" }, { rawLine: false }).kitchen_line).toBe(false);
  });

  it("the gateway's kitchen hints are the web's nine", () => {
    expect(KITCHEN_HINTS).toEqual(["food", "kitchen", "dish", "starter", "dessert", "entree", "entrée", "pasta", "salad", "mains", "main course", "appetizer", "appetiser", "sides", "soup", "meze", "mezze", "grill", "small plate", "snack", "tapas", "pizza", "burger", "sandwich"]);
  });

  it("seesRawLine follows ROLE_POLICY: a role that sees money AND suppliers", () => {
    for (const role of Object.keys(ROLE_POLICY)) {
      const sees = ROLE_POLICY[role as keyof typeof ROLE_POLICY].sees as readonly string[];
      expect(seesRawLine(role)).toBe(sees.includes("money") && sees.includes("suppliers"));
    }
    expect(seesRawLine("owner")).toBe(true);
    expect(seesRawLine("manager")).toBe(true);
    expect(seesRawLine("admin")).toBe(true);
    expect(seesRawLine("staff")).toBe(false);
    expect(seesRawLine(null)).toBe(false);
    expect(seesRawLine(undefined)).toBe(false);
    expect(seesRawLine("bartender")).toBe(false);
  });

  it("lineForViewer omits a withheld raw line (never a null) and marks only a line that keeps one", () => {
    const kept = { id: "a", name: "Barolo", category: "red", raw_extracted_text: "Barolo,38.50", menu_id: "m", restaurant_id: "r" };
    const none = { id: "b", name: "Soave", category: "white", raw_extracted_text: null };
    const empty = { id: "c", name: "Gavi", category: "white", raw_extracted_text: "" };

    const staffKept = lineForViewer(kept, { rawLine: false });
    expect(staffKept).toEqual({ id: "a", name: "Barolo", category: "red", kitchen_line: false, raw_line_withheld: true });
    expect("raw_extracted_text" in staffKept).toBe(false);
    // Keys outside the allowlist never pass, whoever reads.
    expect("menu_id" in staffKept || "restaurant_id" in staffKept).toBe(false);
    expect(lineForViewer(none, { rawLine: false })).toEqual({ id: "b", name: "Soave", category: "white", kitchen_line: false });
    expect(lineForViewer(empty, { rawLine: false })).toEqual({ id: "c", name: "Gavi", category: "white", kitchen_line: false });

    expect(lineForViewer(kept, { rawLine: true })).toEqual({
      id: "a",
      name: "Barolo",
      category: "red",
      kitchen_line: false,
      raw_extracted_text: "Barolo,38.50",
    });
    expect(lineForViewer(none, { rawLine: true })).toEqual({
      id: "b",
      name: "Soave",
      category: "white",
      kitchen_line: false,
      raw_extracted_text: null,
    });
  });

  it("the allowlist does not name the raw line", () => {
    expect(MEMBER_LINE_KEYS as readonly string[]).not.toContain("raw_extracted_text");
  });
});

describe("the menu read routes pass the viewer's view", () => {
  it("GET /menus/:restaurantId sends no raw line to anyone, owner included", async () => {
    const getMenu = jest.fn(async () => ({}));
    const c = new MenusController({ getMenu } as any, {} as any);
    await c.getMenu("rest-1");
    expect(getMenu).toHaveBeenCalledWith("rest-1", { rawLine: false });
  });

  it.each([
    ["owner", true],
    ["manager", true],
    ["admin", true],
    ["staff", false],
    [null, false],
    ["bartender", false],
  ])("GET /menu-versions/:menuId for %p passes rawLine %p", async (role, rawLine) => {
    const getVersion = jest.fn(async () => ({}));
    const c = new MenuVersionsController({ getVersion } as any, {} as any);
    await c.one("rest-1", role as string | null, "11111111-1111-4111-8111-111111111111");
    expect(getVersion).toHaveBeenCalledWith("rest-1", "11111111-1111-4111-8111-111111111111", { rawLine });
  });
});

describe("why a line is flagged (onboarding walk 2026-11-12)", () => {
  it("reads the gateway's own notes into a closed reason, never sending the note", () => {
    expect(flagReasonOf("flagged", "Manager corrected category")).toEqual({ reason: "corrected", field: "category" });
    expect(flagReasonOf("flagged", "Manager corrected bottle_price")).toEqual({ reason: "corrected", field: "bottle_price" });
    expect(flagReasonOf("flagged", "Manually added during review")).toEqual({ reason: "added_by_hand", field: null });
    expect(flagReasonOf("flagged", "Free tier: exceeds 25 item limit")).toEqual({ reason: "past_free_limit", field: null });
    // A field outside the editable list, or any other note, is not trusted as a correction.
    expect(flagReasonOf("flagged", "Manager corrected cost_price")).toEqual({ reason: "unknown", field: null });
    expect(flagReasonOf("flagged", null)).toEqual({ reason: "unknown", field: null });
    expect(flagReasonOf("approved", "Manager corrected category")).toBeNull();
  });

  it("lineForViewer says the reason to every member and drops review_notes", () => {
    const row = { id: "a", name: "Soave", category: "white", status: "flagged", review_notes: "Manager corrected category" };
    for (const rawLine of [false, true]) {
      const out = lineForViewer(row, { rawLine });
      expect(out.flag_reason).toBe("corrected");
      expect(out.flag_field).toBe("category");
      expect("review_notes" in out).toBe(false);
    }
    const ok = lineForViewer({ id: "b", name: "Gavi", status: "approved", review_notes: null }, { rawLine: false });
    expect(ok.flag_reason).toBeNull();
    expect(ok.flag_field).toBeNull();
    expect(MEMBER_LINE_KEYS as readonly string[]).not.toContain("review_notes");
  });
});
