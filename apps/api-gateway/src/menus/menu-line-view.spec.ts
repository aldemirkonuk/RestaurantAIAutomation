import { isKitchenLine, lineForViewer, seesRawLine, KITCHEN_HINTS, MEMBER_LINE_KEYS } from "./menu-line-view";
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

  it("the gateway's kitchen hints are the web's nine", () => {
    expect(KITCHEN_HINTS).toEqual(["food", "kitchen", "dish", "starter", "dessert", "entree", "entrée", "pasta", "salad"]);
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
