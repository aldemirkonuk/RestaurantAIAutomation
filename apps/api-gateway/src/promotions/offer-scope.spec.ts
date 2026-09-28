import {
  coarseCategoryOf,
  indexMenu,
  indexShelf,
  menuCoverage,
  scopeOffer,
  type CurrentMenuLine,
  type ShelfRow,
} from "./offer-scope";

/**
 * The house-first ladder's pure half (founder item 36; research-filters.md,
 * adversarial pass). These cases pin the corrections that overturned the
 * first synthesis: any-row vintage matching (F4), the matched menu line
 * named (F3), drink-only coverage (F9), and a "running low" that speaks only
 * for counted stock (F6).
 */

const shelfRow = (over: Partial<ShelfRow>): ShelfRow => ({
  name: "Kalecik Karası",
  productKey: "mw-1",
  active: true,
  kind: "wine",
  stockLive: 0,
  thresholdMin: 3,
  lastCountedAt: null,
  ...over,
});

const menuLine = (over: Partial<CurrentMenuLine>): CurrentMenuLine => ({
  id: "line-1",
  menuId: "menu-1",
  name: "Kalecik Karası",
  category: "Reds",
  wineLibraryId: "mw-1",
  ...over,
});

const scope = (wines: string[], shelf: ShelfRow[], menu: CurrentMenuLine[]) =>
  scopeOffer(wines, indexShelf(shelf), indexMenu(menu));

describe("scopeOffer — the narrowest rung an offer belongs to", () => {
  it("is 'menu' when an offered wine's shelf row is on a current menu line, and names that line", () => {
    const t = scope(["Kalecik Karası"], [shelfRow({})], [menuLine({ name: "Kalecik Karası (glass)" })]);
    expect(t.scope).toBe("menu");
    expect(t.menuMatches).toEqual([{ wine: "Kalecik Karası", menuLineId: "line-1", menuLine: "Kalecik Karası (glass)" }]);
    expect(t.winesOnMenu).toBe(1);
    expect(t.wines).toBe(1);
  });

  it("folds the name the way the grader does (case, diacritics, dotless i)", () => {
    const t = scope(["KALECİK KARASI"], [shelfRow({})], [menuLine({})]);
    expect(t.scope).toBe("menu");
  });

  it("is 'stock' when the wine is on an active shelf row but on no current menu line", () => {
    const t = scope(["Kalecik Karası"], [shelfRow({})], []);
    expect(t.scope).toBe("stock");
    expect(t.menuMatches).toEqual([]);
  });

  it("is 'other' when the only shelf row of that name is inactive or deleted", () => {
    expect(scope(["Kalecik Karası"], [shelfRow({ active: false })], []).scope).toBe("other");
  });

  it("is 'other' for an offer naming no wine at all, and its category is 'not_classified'", () => {
    const t = scope([], [shelfRow({})], [menuLine({})]);
    expect(t.scope).toBe("other");
    expect(t.wines).toBe(0);
    expect(t.categories).toEqual(["not_classified"]);
  });

  it("two vintages sharing one name: on the menu whichever row sorts first (F4, any-row, not the first hit)", () => {
    const v2019 = shelfRow({ productKey: "mw-2019" });
    const v2020 = shelfRow({ productKey: "mw-2020" });
    const onMenu = [menuLine({ wineLibraryId: "mw-2020" })];
    expect(scope(["Kalecik Karası"], [v2019, v2020], onMenu).scope).toBe("menu");
    expect(scope(["Kalecik Karası"], [v2020, v2019], onMenu).scope).toBe("menu");
  });

  it("names the same menu line whatever order the candidate lines came in", () => {
    const shelf = [shelfRow({ productKey: "a" }), shelfRow({ productKey: "b" })];
    const lines = [menuLine({ id: "l-b", name: "Zinfandel list", wineLibraryId: "b" }), menuLine({ id: "l-a", name: "Kalecik", wineLibraryId: "a" })];
    const one = scope(["Kalecik Karası"], shelf, lines).menuMatches[0].menuLineId;
    const two = scope(["Kalecik Karası"], [...shelf].reverse(), [...lines].reverse()).menuMatches[0].menuLineId;
    expect(one).toBe("l-a");
    expect(two).toBe("l-a");
  });

  it("a bundle is on the menu if ANY bottle is, tagged n of m", () => {
    const shelf = [
      shelfRow({ name: "Kalecik Karası", productKey: "mw-1" }),
      shelfRow({ name: "Öküzgözü", productKey: "mw-2" }),
      shelfRow({ name: "Narince", productKey: "mw-3" }),
    ];
    const t = scope(["Kalecik Karası", "Öküzgözü", "Narince"], shelf, [menuLine({ wineLibraryId: "mw-2", name: "Öküzgözü" })]);
    expect(t.scope).toBe("menu");
    expect(t.winesOnMenu).toBe(1);
    expect(t.wines).toBe(3);
  });

  it("a duplicate wine name in the mail is one wine, not two", () => {
    expect(scope(["Narince", " Narince "], [shelfRow({ name: "Narince" })], []).wines).toBe(1);
  });
});

describe("scopeOffer — coarse categories, from the library's own classifier", () => {
  it("folds beverage_kind into five words a buyer uses", () => {
    expect(coarseCategoryOf("wine")).toBe("wine");
    expect(coarseCategoryOf("beer")).toBe("beer");
    expect(coarseCategoryOf("spirit")).toBe("spirits");
    expect(coarseCategoryOf("non_alcoholic")).toBe("soft_drinks");
    expect(coarseCategoryOf("sake")).toBe("other_drinks");
    expect(coarseCategoryOf("cider")).toBe("other_drinks");
    expect(coarseCategoryOf("cocktail")).toBe("other_drinks");
    expect(coarseCategoryOf("unknown")).toBe("not_classified");
    expect(coarseCategoryOf(null)).toBe("not_classified");
  });

  it("an offer spanning two kinds carries both, in the fixed order", () => {
    const shelf = [shelfRow({ name: "Efes", kind: "beer" }), shelfRow({ name: "Narince", kind: "wine", productKey: "mw-9" })];
    expect(scope(["Efes", "Narince"], shelf, []).categories).toEqual(["wine", "beer"]);
  });
});

describe("scopeOffer — running low speaks only for counted stock (F6)", () => {
  it("never calls an uncounted row low, even at the 0-vs-3 default", () => {
    const t = scope(["Kalecik Karası"], [shelfRow({ stockLive: 0, thresholdMin: 3, lastCountedAt: null })], []);
    expect(t.runningLow).toEqual([]);
  });

  it("calls a counted row below par low, with its count date", () => {
    const t = scope(["Kalecik Karası"], [shelfRow({ stockLive: 1, thresholdMin: 6, lastCountedAt: "2026-09-20T10:00:00Z" })], []);
    expect(t.runningLow).toEqual([{ wine: "Kalecik Karası", stockLive: 1, thresholdMin: 6, countedAt: "2026-09-20T10:00:00Z" }]);
  });

  it("a counted row at or above par is not low", () => {
    expect(scope(["Kalecik Karası"], [shelfRow({ stockLive: 6, thresholdMin: 6, lastCountedAt: "2026-09-20" })], []).runningLow).toEqual([]);
  });

  it("one uncounted vintage makes the wine 'not known', never low", () => {
    const shelf = [
      shelfRow({ productKey: "a", stockLive: 0, thresholdMin: 6, lastCountedAt: "2026-09-20" }),
      shelfRow({ productKey: "b", stockLive: 0, thresholdMin: 3, lastCountedAt: null }),
    ];
    expect(scope(["Kalecik Karası"], shelf, []).runningLow).toEqual([]);
  });

  it("an inactive row does not speak for the wine", () => {
    const shelf = [
      shelfRow({ productKey: "a", stockLive: 1, thresholdMin: 6, lastCountedAt: "2026-09-20" }),
      shelfRow({ productKey: "b", active: false, stockLive: 99, thresholdMin: 3, lastCountedAt: null }),
    ];
    expect(scope(["Kalecik Karası"], shelf, []).runningLow).toHaveLength(1);
  });

  it("sums every counted vintage and dates the claim by the OLDEST count", () => {
    const shelf = [
      shelfRow({ productKey: "a", stockLive: 1, thresholdMin: 6, lastCountedAt: "2026-09-20" }),
      shelfRow({ productKey: "b", stockLive: 2, thresholdMin: 6, lastCountedAt: "2026-09-01" }),
    ];
    expect(scope(["Kalecik Karası"], shelf, []).runningLow[0]).toEqual({
      wine: "Kalecik Karası",
      stockLive: 3,
      thresholdMin: 12,
      countedAt: "2026-09-01",
    });
  });
});

describe("menuCoverage — drink lines only, and the word is 'linked' (F9)", () => {
  it("excludes a food line from the coverage, reporting it apart", () => {
    const c = menuCoverage([
      menuLine({ id: "w1", category: "Reds", wineLibraryId: "mw-1" }),
      menuLine({ id: "w2", category: "Whites", name: "House white", wineLibraryId: null }),
      menuLine({ id: "f1", category: "Mains", name: "Burger", wineLibraryId: null }),
    ]);
    expect(c).toEqual({ lines: 3, drinkLines: 2, linked: 1, notLinked: 1, otherLines: 1 });
  });

  it("does not count a cocktail line as an unlinked drink — a mixed drink is never a vendor's bottle", () => {
    const c = menuCoverage([menuLine({ id: "c1", category: "Cocktails", name: "Negroni", wineLibraryId: null })]);
    expect(c.drinkLines).toBe(0);
    expect(c.otherLines).toBe(1);
  });

  it("a line with a library wine is a drink line whatever its section says", () => {
    const c = menuCoverage([menuLine({ category: "Our selection", name: "Chef's pick", wineLibraryId: "mw-7" })]);
    expect(c).toEqual({ lines: 1, drinkLines: 1, linked: 1, notLinked: 0, otherLines: 0 });
  });

  it("an empty menu is zeros, not a failure", () => {
    expect(menuCoverage([])).toEqual({ lines: 0, drinkLines: 0, linked: 0, notLinked: 0, otherLines: 0 });
  });
});
