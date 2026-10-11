import * as fs from "fs";
import * as path from "path";

import {
  DRINK_SECTIONS,
  DRINK_WORDS,
  FOOD_NOUNS,
  isKitchenLine,
  lineForViewer,
  menuCategoryOf,
  seesRawLine,
  KITCHEN_HINTS,
  MEMBER_LINE_KEYS,
  SECTION_HINTS,
  WINE_WORDS,
} from "./menu-line-view";
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

  // F-1173: one vocabulary, the web's, read out of its file rather than restated.
  it("the gateway's kitchen hints, drink sections and wine words are the web's", () => {
    const web = fs.readFileSync(
      path.resolve(__dirname, "../../../web/src/lib/firstProof.ts"),
      "utf8",
    );
    const list = (name: string) => {
      const m = web.match(
        new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`),
      );
      if (!m)
        throw new Error(
          `firstProof.ts has no ${name} list; this guard is blind`,
        );
      return [...m[1].matchAll(/'([^']*)'/g)].map((q) => q[1]);
    };
    expect(KITCHEN_HINTS).toEqual(list("KITCHEN"));
    expect(DRINK_SECTIONS).toEqual(list("VOCABULARY"));
    expect(WINE_WORDS).toEqual(list("WINE_WORDS"));
    expect(DRINK_WORDS).toEqual(list("DRINK_WORDS"));
    expect(SECTION_HINTS).toEqual(list("SECTION_HINTS"));
    expect(FOOD_NOUNS).toEqual(list("FOOD_NOUNS"));
  });

  // F-1272: a CSV's Tür/Kategori cell is kept in Turkish, and the raw line is
  // the whole row, so 'Tatlı' (sweet) in it once made a wine a kitchen line.
  it("knows Turkish drink sections, and 'tatlı' in a row marks no food (F-1272)", () => {
    for (const section of [
      "Kırmızı",
      "Beyaz",
      "Roze",
      "Pembe",
      "Köpüklü",
      "Tatlı şarap",
      "Rakı",
      "Bira",
      "Viski",
      "Şarap",
      "KIRMIZI",
    ]) {
      expect(isKitchenLine(section, `X,${section},2020,450,meze ile`)).toBe(
        false,
      );
    }
    expect(
      isKitchenLine("Kırmızı", "Yakut,Kırmızı,Kavaklıdere,yarı tatlı,300"),
    ).toBe(false);
    expect(isKitchenLine(null, "Moscato,yarı tatlı,2022,380")).toBe(false);
    // Only a section heading says dessert in the plural.
    expect(isKitchenLine(null, "Late harvest,2019,pairs with desserts")).toBe(
      false,
    );
    expect(isKitchenLine("Tatlılar", "Künefe,180")).toBe(true);
    expect(isKitchenLine("TATLILAR", null)).toBe(true);
    expect(isKitchenLine("Desserts", null)).toBe(true);
  });

  // F-1293: the library's classifier reads English words only.
  it("menuCategoryOf: a Turkish drink section as the kind it names", () => {
    expect(menuCategoryOf("Rakı")).toBe("spirit");
    expect(menuCategoryOf("RAKI")).toBe("spirit");
    expect(menuCategoryOf("Biralar")).toBe("beer");
    expect(menuCategoryOf("Viski")).toBe("whiskey");
    expect(menuCategoryOf("Kokteyl")).toBe("cocktail");
    expect(menuCategoryOf("Alkolsüz içecekler")).toBe("non-alcoholic");
    expect(menuCategoryOf("Kırmızı şaraplar")).toBe("red");
    expect(menuCategoryOf("Beyaz")).toBe("white");
    expect(menuCategoryOf("Köpüklü")).toBe("sparkling");
    expect(menuCategoryOf("Roze")).toBe("rose");
    expect(menuCategoryOf("Pembe")).toBe("rose");
    expect(menuCategoryOf("Tatlı şarap")).toBe("dessert");
    // A vocabulary member as it is; anything else as written.
    expect(menuCategoryOf("WHITE")).toBe("white");
    expect(menuCategoryOf("non-alcoholic")).toBe("non-alcoholic");
    expect(menuCategoryOf("Şarap")).toBe("Şarap");
    expect(menuCategoryOf("Reds by the glass")).toBe("Reds by the glass");
    expect(menuCategoryOf(undefined)).toBeUndefined();
  });

  // F-1317: "Kırmızı Et" is red meat and "Tatlı" the dessert section; a drink
  // word wins only when the section names no food.
  it("a food noun in the section beats a drink word (F-1317)", () => {
    for (const section of [
      "Kırmızı Et",
      "Beyaz Et",
      "Kırmızı Et Yemekleri",
      "Tatlı",
      "TATLI",
    ]) {
      expect(isKitchenLine(section, `X,${section},450`)).toBe(true);
    }
    for (const section of ["Kırmızı Şarap", "Tatlı Şarap", "Rakı"]) {
      expect(isKitchenLine(section, `X,${section},2020,450`)).toBe(false);
    }
  });

  it("a known drink section wins: a dessert wine is a drink (F-1173)", () => {
    expect(
      isKitchenLine(
        "dessert",
        "Muscat de Beaumes-de-Venise,Durban,2020,dessert,14",
      ),
    ).toBe(false);
    expect(isKitchenLine("Dessert wines", "Tokaji Aszú 5 puttonyos")).toBe(
      false,
    );
    expect(
      isKitchenLine("white", "Assyrtiko,Sigalas,,white,12,,great with food"),
    ).toBe(false);
    expect(isKitchenLine("Desserts", null)).toBe(true);
  });

  it("matches whole words, never a substring (F-1173)", () => {
    expect(isKitchenLine(null, "Radish Imports Rosé 2022")).toBe(false);
    expect(isKitchenLine(null, "Saladin Reserve 2018")).toBe(false);
    expect(isKitchenLine("Small plates", null)).toBe(true);
    expect(isKitchenLine("Mains", null)).toBe(true);
    expect(isKitchenLine("Appetizers", null)).toBe(true);
  });

  it("knows Turkish kitchen sections, in either lower-casing (F-1173)", () => {
    for (const section of [
      "Mezeler",
      "Ara Sıcaklar",
      "Ana Yemekler",
      "TATLILAR",
      "Salatalar",
      "IZGARA",
      "Çorbalar",
    ]) {
      expect(isKitchenLine(section, null)).toBe(true);
    }
    expect(isKitchenLine("Kırmızı şaraplar", "Yakut 2019")).toBe(false);
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
