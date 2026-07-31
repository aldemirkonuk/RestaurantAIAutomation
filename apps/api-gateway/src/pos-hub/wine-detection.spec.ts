import {
  WINE_WORDS,
  WINE_CATEGORY_WORDS,
  WINE_STYLE_CATEGORY_WORDS,
  NON_WINE_CATEGORY_WORDS,
  classifyWineCategory,
  looksLikeWineName,
  detectWine,
} from "./pos-hub.service";

/**
 * These lists are mirrored into two Python runtimes, and
 * scripts/test_simulate.py asserts the copies match token for token. What that
 * cannot assert is that the matchers BEHAVE the same, so the cases below are
 * deliberately the same cases the Python side pins.
 */
describe("wine detection — the name backstop", () => {
  it("resolves New World varietal labelling", () => {
    expect(looksLikeWineName("Sonoma Pinot Noir")).toBe(true);
    expect(looksLikeWineName("Napa Cabernet Sauvignon")).toBe(true);
  });

  it("resolves Old World appellation and producer labelling", () => {
    // Every one of these was a measured miss against the real crawled bistro
    // list when WINE_WORDS held grapes but no appellations.
    for (const name of [
      "Edmondo Sarti Barbaresco",
      "Pace Arneis Roero",
      "Dettori Vermentino",
      "Moschioni Friulano",
      "San-Lurins Malvasia Istriana Skin Fermented",
      "Cantine Nostre Barbera",
      "Gran Passaia Super Tuscan",
      "Billecart-Salmon Blanc de Blanc",
      "Domaine Carneros Blanc de Noirs",
      "Tenuta Orestiadi Nero d’Avola", // curly apostrophe, as the menu has it
      "Tenuta Orestiadi Nero d'Avola",
      "Benanti Etna Bianco",
      "Baldovino Cerasuolo d'Abruzzo",
      "Chicago Winery Petite Sirah",
      "House White",
      "Assyrtiko (Santorini)",
      "Xinomavro (Naoussa)",
      "Corton Grand Cru",
      "Vina Tondonia Reserva",
    ]) {
      expect([name, looksLikeWineName(name)]).toEqual([name, true]);
    }
  });

  it("matches on word boundaries, so short tokens stay safe", () => {
    // Each contains a wine token as a substring. The substring version of this
    // scan read the first three as wine.
    expect(looksLikeWineName("Cavatelli Bolognese")).toBe(false); // cava
    expect(looksLikeWineName("Vietnamese Coffee")).toBe(false); // etna
    expect(looksLikeWineName("Rosemary Focaccia")).toBe(false); // rose
    expect(looksLikeWineName("Crudo of the Day")).toBe(false); // cru
    expect(looksLikeWineName("Portobello Fries")).toBe(false); // port
    expect(looksLikeWineName("Chateaubriand for Two")).toBe(false); // chateau
    // ...and the tokens themselves still resolve as whole words.
    expect(looksLikeWineName("Raventos Cava Brut")).toBe(true);
    expect(looksLikeWineName("Benanti Etna Rosso")).toBe(true);
    expect(looksLikeWineName("Domaine Ott Rose")).toBe(true);
    expect(looksLikeWineName("Corton Grand Cru")).toBe(true);
  });

  it("never reads food as wine", () => {
    // A food false positive inflates depletion for wine that was never poured,
    // which is worse than a miss: a miss is recoverable from a mapping row.
    for (const name of [
      "Pecorino Romano",
      "Shaved Pecorino",
      "Cacio e Pepe",
      "Pizza Bianca",
      "Queso Blanco",
      "Cavolo Nero",
      "Chicken Marsala",
      "Dolci",
      "Salsa Verde",
      "Sparkling Water",
      "House Blend Coffee",
      "Red Snapper",
      "White Bean Soup",
      "White Truffle Risotto",
      "Coq au Vin",
      "Grana Padano",
      "Gin-Cured Salmon",
    ]) {
      expect([name, looksLikeWineName(name)]).toEqual([name, false]);
    }
  });
});

describe("wine detection — the category signal", () => {
  it("resolves wine no name scan can reach", () => {
    for (const name of ["Conterno 2016", "Caymus", "Opus One", "Giato"]) {
      expect(looksLikeWineName(name)).toBe(false);
      expect(detectWine(name, "Wine")).toBe(true);
      expect(detectWine(name, "Wine by the Glass")).toBe(true);
    }
  });

  it("lets a wine heading beat a non-wine family", () => {
    expect(classifyWineCategory("Dessert Wine")).toBe("wine");
    expect(classifyWineCategory("Wine & Cheese")).toBe("wine");
    expect(classifyWineCategory("Dessert")).toBe("not_wine");
    expect(classifyWineCategory("Cheese")).toBe("not_wine");
  });

  it("lets a non-wine family beat a mere style word", () => {
    // Otherwise a Sparkling Water heading reads as sparkling wine.
    expect(classifyWineCategory("Sparkling Water")).toBe("not_wine");
    expect(classifyWineCategory("Sparkling")).toBe("wine");
    expect(classifyWineCategory("Champagne & Sparkling")).toBe("wine");
  });

  it("falls through on an unrecognised heading rather than vetoing", () => {
    // Real POS menus file the wine list under headings we have not seen.
    // Calling those 'not wine' is the undercount this path exists to avoid.
    for (const category of [
      "Beverages",
      "Drinks",
      "Bar",
      "",
      null,
      undefined,
    ]) {
      expect(classifyWineCategory(category)).toBe("unknown");
      expect(detectWine("Estate Chardonnay 2021", category)).toBe(true);
      expect(detectWine("Cheese Board", category)).toBe(false);
    }
  });

  it("stops the name scan on a recognised non-wine family", () => {
    for (const category of ["Beer & Cider", "Coffee", "Pasta", "Desserts"]) {
      expect(detectWine("Barolo Braised Short Rib", category)).toBe(false);
    }
  });
});

describe("wine detection — list hygiene", () => {
  it("keeps every token lowercase, trimmed, and unique", () => {
    for (const words of [
      WINE_WORDS,
      WINE_CATEGORY_WORDS,
      WINE_STYLE_CATEGORY_WORDS,
      NON_WINE_CATEGORY_WORDS,
    ]) {
      // Matching lowercases the input, so an uppercase token is dead weight.
      expect(words.filter((w) => w !== w.toLowerCase().trim() || !w)).toEqual(
        [],
      );
      expect(new Set(words).size).toBe(words.length);
    }
  });

  it("keeps food words off the name list", () => {
    // Documented exclusions. Each is a real grape or wine term that is more
    // often a food word, so it is left to the category and to pos_item_mappings.
    for (const excluded of [
      "pecorino",
      "bianco",
      "blanco",
      "dolce",
      "nero",
      "marsala",
      "sparkling",
      "verde",
      "blend",
    ]) {
      expect(WINE_WORDS).not.toContain(excluded);
    }
  });
});
