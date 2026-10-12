import * as fs from "fs";
import * as path from "path";

import {
  confirmedDrinkCategory,
  DRINK_SECTIONS,
  DRINK_WORDS,
  effectiveDrinkCategory,
  FOOD_NOUNS,
  houseKindOf,
  isKitchenLine,
  lineForViewer,
  lineIsDrink,
  NON_DRINK_MENU_KINDS,
  readKitchenInventoryIds,
  readMenuSectionCategories,
  type SectionCategory,
  menuCategoryOf,
  seesRawLine,
  KITCHEN_HINTS,
  MEAT_SECTIONS,
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
    expect(MEAT_SECTIONS).toEqual(list("MEAT_SECTIONS"));
    // ADR 0340 rule 7: the menu kinds whose undecided line is no drink.
    const kinds = web.match(/const NON_DRINK_MENU_KINDS = \[([^\]]*)\]/);
    if (!kinds)
      throw new Error(
        "firstProof.ts has no NON_DRINK_MENU_KINDS; this guard is blind",
      );
    expect(NON_DRINK_MENU_KINDS).toEqual(
      [...kinds[1].matchAll(/'([^']*)'/g)].map((q) => q[1]),
    );
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

  // F-1392: 'et' is also French "and", and a wine for fish is still a wine.
  it("a wine word beats a food noun, and 'et' is meat only as the heading (F-1392)", () => {
    for (const section of [
      "Rouges et Rosés",
      "Champagne et Crémant",
      "Vins Blancs",
      "Balık Şarapları",
      "Et yanına kırmızı şaraplar",
    ]) {
      expect(isKitchenLine(section, "Château Margaux 2015")).toBe(false);
    }
    for (const section of ["Kırmızı Et", "Beyaz Et", "Et", "ET", "Etler"]) {
      expect(isKitchenLine(section, `X,${section},450`)).toBe(true);
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

  // F-1386: the kept file is the whole sheet, so it goes where the raw line goes.
  it.each([
    ["owner", true],
    ["manager", true],
    ["admin", true],
    ["staff", false],
    [null, false],
    ["bartender", false],
  ])(
    "GET /menu-versions/:menuId/source for %p is sent the link: %p",
    async (role, sent) => {
      const sourceUrl = jest.fn(async () => ({
        url: "https://signed",
        expiresIn: 300,
      }));
      const c = new MenuVersionsController({ sourceUrl } as any, {} as any);
      const call = c.source(
        "rest-1",
        role as string | null,
        "11111111-1111-4111-8111-111111111111",
      );
      if (sent) {
        await expect(call).resolves.toEqual({
          url: "https://signed",
          expiresIn: 300,
        });
        expect(sourceUrl).toHaveBeenCalledWith(
          "rest-1",
          "11111111-1111-4111-8111-111111111111",
        );
      } else {
        await expect(call).rejects.toMatchObject({
          status: 403,
          message:
            "The menu's kept file is for an owner or a manager, because a file can carry costs and suppliers.",
        });
        expect(sourceUrl).not.toHaveBeenCalled();
      }
    },
  );
});

/**
 * ADR 0340 lane 3a (rules 7 and 8): a line is a drink only when its stored
 * kind says so, or, with none, when the legacy rule proves it on a menu that
 * is not Food or Desserts. Its category is always a vocabulary token.
 */
describe("menu-line-view — a line is a drink only when stored or proven (ADR 0340 rules 7, 8)", () => {
  const legacy = [
    { category: "red", raw: "Barolo,Vietti,2019,red,120" },
    { category: "Starters", raw: null },
    { category: null, raw: "Tiramisu,,,,12,3.10,Metro,74%,Dessert" },
    { category: null, raw: "House pour 9" },
    { category: "Kırmızı Et", raw: "Kuzu şiş" },
    { category: "Rakı", raw: "Yeni Rakı 70cl" },
  ];

  it("lineIsDrink: a stored kind decides, whatever the section or the menu", () => {
    for (const menuKind of ["beverage", "food", "desserts", null]) {
      expect(
        lineIsDrink({ line_kind: "drink", category: "Starters" }, menuKind),
      ).toBe(true);
      expect(
        lineIsDrink({ line_kind: "dish", category: "red" }, menuKind),
      ).toBe(false);
    }
  });

  it("lineIsDrink: an undecided line on a Food or Desserts menu is not a drink", () => {
    for (const menuKind of ["food", "desserts"]) {
      for (const l of legacy) expect(lineIsDrink(l, menuKind)).toBe(false);
    }
  });

  it("lineIsDrink: an undecided line anywhere else keeps today's rule exactly", () => {
    for (const menuKind of [
      "beverage",
      "full",
      "bar",
      "events",
      null,
      undefined,
    ]) {
      for (const l of legacy)
        expect(lineIsDrink(l, menuKind)).toBe(
          !isKitchenLine(l.category, l.raw),
        );
    }
  });

  it("kitchen_line is NOT lineIsDrink on the line's own menu kind", () => {
    const row = {
      id: "a",
      name: "Barolo",
      category: "red",
      line_kind: null,
      raw_extracted_text: "Barolo 120",
    };
    expect(lineForViewer(row, { rawLine: false }).kitchen_line).toBe(false);
    expect(
      lineForViewer(row, { rawLine: false }, "beverage").kitchen_line,
    ).toBe(false);
    expect(lineForViewer(row, { rawLine: false }, "food").kitchen_line).toBe(
      true,
    );
    expect(
      lineForViewer(
        { ...row, line_kind: "drink" },
        { rawLine: false },
        "desserts",
      ).kitchen_line,
    ).toBe(false);
    expect(
      lineForViewer(
        { ...row, line_kind: "dish" },
        { rawLine: false },
        "beverage",
      ).kitchen_line,
    ).toBe(true);
    // The parity the legacy rule keeps: every legacy line on a Drinks menu.
    for (const l of legacy)
      expect(
        lineForViewer(
          { id: "x", category: l.category, raw_extracted_text: l.raw },
          { rawLine: false },
          "beverage",
        ).kitchen_line,
      ).toBe(isKitchenLine(l.category, l.raw));
  });

  const sections = new Map<string, SectionCategory>([
    ["wines", { parent_id: null, drink_category: null, confirmed_at: null }],
    [
      "red",
      {
        parent_id: "wines",
        drink_category: "red",
        confirmed_at: "2026-10-12T10:00:00Z",
      },
    ],
    ["turkey", { parent_id: "red", drink_category: null, confirmed_at: null }],
    ["bar", { parent_id: null, drink_category: "spirit", confirmed_at: null }],
    [
      "loop-a",
      { parent_id: "loop-b", drink_category: null, confirmed_at: null },
    ],
    [
      "loop-b",
      { parent_id: "loop-a", drink_category: null, confirmed_at: null },
    ],
  ]);

  it("effectiveDrinkCategory: the line, then its sections walking up, then the token its category names", () => {
    expect(
      effectiveDrinkCategory(
        { drink_category: "beer", section_id: "red", category: "Şarap" },
        sections,
      ),
    ).toBe("beer");
    expect(
      effectiveDrinkCategory(
        { section_id: "turkey", category: "Şarap" },
        sections,
      ),
    ).toBe("red");
    expect(
      effectiveDrinkCategory({ section_id: "bar", category: "red" }, sections),
    ).toBe("spirit");
    expect(
      effectiveDrinkCategory(
        { section_id: "wines", category: "white" },
        sections,
      ),
    ).toBe("white");
    // F-1293 stays: a Turkish drink section goes as the token it names.
    expect(effectiveDrinkCategory({ category: "Rakı" })).toBe("spirit");
    expect(effectiveDrinkCategory({ category: "Kırmızı şarap" })).toBe("red");
    // A cycle, a missing section and a non-token line category end the walk.
    expect(
      effectiveDrinkCategory(
        { section_id: "loop-a", category: "beer" },
        sections,
      ),
    ).toBe("beer");
    expect(
      effectiveDrinkCategory(
        { section_id: "gone", drink_category: "Bourbon", category: "red" },
        sections,
      ),
    ).toBe("red");
  });

  it("effectiveDrinkCategory never returns heading text: a heading with no token is null", () => {
    for (const heading of [
      "Şarap",
      "Bourbon & Rye",
      "Wines",
      "wine",
      "Starters",
      "",
      "  ",
      undefined,
      null,
      7,
    ]) {
      expect(
        effectiveDrinkCategory({ category: heading as any }, sections),
      ).toBeNull();
    }
    expect(
      effectiveDrinkCategory(
        { section_id: "wines", category: "Wines" },
        sections,
      ),
    ).toBeNull();
  });

  it("confirmedDrinkCategory: the line's own, or the nearest categorised section's only when it was confirmed", () => {
    expect(
      confirmedDrinkCategory(
        { drink_category: "beer", section_id: "bar" },
        sections,
      ),
    ).toBe("beer");
    expect(confirmedDrinkCategory({ section_id: "turkey" }, sections)).toBe(
      "red",
    );
    expect(confirmedDrinkCategory({ section_id: "red" }, sections)).toBe("red");
    // Back-filled or inherited, never tapped: not a confirmation.
    expect(confirmedDrinkCategory({ section_id: "bar" }, sections)).toBeNull();
    // A token read out of the line's category is not a confirmation.
    expect(confirmedDrinkCategory({ category: "red" }, sections)).toBeNull();
    expect(
      confirmedDrinkCategory(
        { section_id: "loop-a", category: "red" },
        sections,
      ),
    ).toBeNull();
  });

  it("houseKindOf files every wine style as wine and every other token as its own house kind", () => {
    for (const t of [
      "red",
      "white",
      "rose",
      "sparkling",
      "orange",
      "dessert",
      "fortified",
    ] as const)
      expect(houseKindOf(t)).toBe("wine");
    expect(houseKindOf("beer")).toBe("beer");
    expect(houseKindOf("cider")).toBe("cider");
    expect(houseKindOf("sake")).toBe("sake");
    expect(houseKindOf("cocktail")).toBe("cocktail");
    expect(houseKindOf("spirit")).toBe("spirit");
    expect(houseKindOf("whiskey")).toBe("whiskey");
    expect(houseKindOf("soft drink")).toBe("soft_drink");
    expect(houseKindOf("non-alcoholic")).toBe("non_alcoholic");
  });

  /** A filtering fake for the two readers here. */
  const client = (
    tables: Record<string, Array<Record<string, unknown>>>,
    fails: Record<string, string> = {},
  ) =>
    ({
      from: (table: string) => {
        const keep: Array<(r: Record<string, unknown>) => boolean> = [];
        const q: any = {
          select: () => q,
          eq: (c: string, v: unknown) => (keep.push((r) => r[c] === v), q),
          neq: (c: string, v: unknown) => (keep.push((r) => r[c] !== v), q),
          not: (c: string, _op: string, _v: unknown) => (
            keep.push((r) => r[c] != null),
            q
          ),
          gt: (c: string, v: unknown) => (
            keep.push((r) => String(r[c]) > String(v)),
            q
          ),
          order: () => q,
          limit: () => q,
          then: (resolve: any) =>
            resolve(
              fails[table]
                ? { data: null, error: { message: fails[table] } }
                : {
                    data: (tables[table] ?? []).filter((r) =>
                      keep.every((k) => k(r)),
                    ),
                    error: null,
                  },
            ),
        };
        return q;
      },
    }) as any;

  it("readKitchenInventoryIds judges each line on its own menu's kind and its stored kind", async () => {
    const db = client({
      restaurant_menus: [
        { id: "m-drinks", restaurant_id: "rest-1", menu_type: "beverage" },
        { id: "m-food", restaurant_id: "rest-1", menu_type: "food" },
      ],
      menu_items: [
        // Legacy line on Drinks, kitchen by the old rule.
        {
          id: "1",
          restaurant_id: "rest-1",
          menu_id: "m-drinks",
          inventory_item_id: "inv-starter",
          category: "Starters",
          status: "approved",
        },
        // Legacy wine on Drinks.
        {
          id: "2",
          restaurant_id: "rest-1",
          menu_id: "m-drinks",
          inventory_item_id: "inv-red",
          category: "red",
          status: "approved",
        },
        // An undecided line on Food that names a wine section.
        {
          id: "3",
          restaurant_id: "rest-1",
          menu_id: "m-food",
          inventory_item_id: "inv-food-red",
          category: "red",
          status: "approved",
        },
        // A stored dish under a drink section.
        {
          id: "4",
          restaurant_id: "rest-1",
          menu_id: "m-drinks",
          inventory_item_id: "inv-dish",
          category: "red",
          line_kind: "dish",
          status: "approved",
        },
        // A stored drink under a kitchen heading.
        {
          id: "5",
          restaurant_id: "rest-1",
          menu_id: "m-drinks",
          inventory_item_id: "inv-drink",
          category: "Starters",
          line_kind: "drink",
          status: "approved",
        },
      ],
    });
    const { ids, error } = await readKitchenInventoryIds(db, "rest-1");
    expect(error).toBeNull();
    expect([...ids].sort()).toEqual([
      "inv-dish",
      "inv-food-red",
      "inv-starter",
    ]);
  });

  it("readKitchenInventoryIds says a failed menus read, never an empty set", async () => {
    const r = await readKitchenInventoryIds(
      client({}, { restaurant_menus: "timeout" }),
      "rest-1",
    );
    expect(r).toEqual({ ids: new Set(), error: "timeout" });
  });

  it("readMenuSectionCategories reads one menu's sections of this house and says a failed read", async () => {
    const db = client({
      menu_sections: [
        {
          id: "s1",
          restaurant_id: "rest-1",
          menu_id: "m1",
          parent_id: null,
          drink_category: "red",
          confirmed_at: "2026-10-12T10:00:00Z",
        },
        {
          id: "s2",
          restaurant_id: "rest-1",
          menu_id: "m1",
          parent_id: "s1",
          drink_category: null,
          confirmed_at: null,
        },
        {
          id: "s3",
          restaurant_id: "rest-1",
          menu_id: "m2",
          parent_id: null,
          drink_category: "beer",
          confirmed_at: null,
        },
        {
          id: "s4",
          restaurant_id: "rest-2",
          menu_id: "m1",
          parent_id: null,
          drink_category: "beer",
          confirmed_at: null,
        },
      ],
    });
    const r = await readMenuSectionCategories(db, "rest-1", "m1");
    expect(r.error).toBeNull();
    expect([...r.sections.entries()]).toEqual([
      [
        "s1",
        {
          parent_id: null,
          drink_category: "red",
          confirmed_at: "2026-10-12T10:00:00Z",
        },
      ],
      ["s2", { parent_id: "s1", drink_category: null, confirmed_at: null }],
    ]);
    const f = await readMenuSectionCategories(
      client({}, { menu_sections: "denied" }),
      "rest-1",
      "m1",
    );
    expect(f.error).toBe("denied");
    expect(f.sections.size).toBe(0);
  });
});
