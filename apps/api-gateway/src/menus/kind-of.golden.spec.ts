import {
  classifyHeading,
  isKitchenLine,
  kindOf,
  kindVerdict,
  type MenuKindGuess,
} from "./menu-line-view";

/**
 * ADR 0340 rule 15, lane 5a: the heading golden set. Every printed heading
 * below is read by `kindOf` with no line, and must come back as the kind
 * written beside it, in English, Turkish, French, Italian, Spanish and
 * German, plus an adversarial list (headings that mix kinds, false friends
 * across languages, and words that name a colour or a place, not a drink).
 * A pure spec: no model call, no database.
 *
 * `unknown` is a real answer here: a heading no rule knows ("Specials",
 * "Chef's selection") is never a drink by default. Restoring drink-by-default
 * fails every `unknown` row (the lane's mutation).
 */

type Row = [heading: string, kind: MenuKindGuess];

const D = "drinks" as const;
const F = "food" as const;
const S = "desserts" as const;
const U = "unknown" as const;

const ENGLISH: Row[] = [
  ["Wines", D],
  ["Wine List", D],
  ["Red Wines", D],
  ["White Wines", D],
  ["Rosé Wines", D],
  ["Sparkling Wines", D],
  ["Sparkling", D],
  ["Champagne", D],
  ["Champagne & Sparkling", D],
  ["Dessert Wines", D],
  ["Fortified Wines", D],
  ["Port & Sherry", D],
  ["Wines by the Glass", D],
  ["By the Glass", D],
  ["By the Bottle", D],
  ["Half Bottles", D],
  ["Reds", D],
  ["Whites", D],
  ["Rosé", D],
  ["Orange Wines", D],
  ["Bubbles", D],
  ["Beer", D],
  ["Beers", D],
  ["Draft Beer", D],
  ["Draught", D],
  ["Bottled Beers", D],
  ["Craft Beers", D],
  ["Ciders", D],
  ["Sake", D],
  ["Cocktails", D],
  ["Signature Cocktails", D],
  ["Classic Cocktails", D],
  ["Mocktails", D],
  ["Spirits", D],
  ["Whisky", D],
  ["Whiskey", D],
  ["Bourbon", D],
  ["Scotch Whisky", D],
  ["Gin", D],
  ["Gin & Tonic", D],
  ["Vodka", D],
  ["Rum", D],
  ["Tequila & Mezcal", D],
  ["Cognac & Brandy", D],
  ["Liqueurs", D],
  ["Aperitifs", D],
  ["Digestifs", D],
  ["After Dinner", D],
  ["After Dinner Drinks", D],
  ["Soft Drinks", D],
  ["Non-Alcoholic", D],
  ["Zero Proof", D],
  ["Juices", D],
  ["Fresh Juices", D],
  ["Smoothies", D],
  ["Hot Drinks", D],
  ["Coffee", D],
  ["Coffee & Tea", D],
  ["Teas", D],
  ["Thé", D],
  ["Water", D],
  ["Drinks", D],
  ["Beverages", D],
  ["Bar", D],
  ["Food", F],
  ["Starters", F],
  ["Appetizers", F],
  ["Appetisers", F],
  ["Small Plates", F],
  ["To Share", F],
  ["Sharing Plates", F],
  ["Mains", F],
  ["Main Courses", F],
  ["Entrées", F],
  ["Entrees", F],
  ["Sides", F],
  ["Side Dishes", F],
  ["Salads", F],
  ["Soups", F],
  ["Soup & Salad", F],
  ["Pasta", F],
  ["Pizza", F],
  ["Burgers", F],
  ["Sandwiches", F],
  ["Wraps", F],
  ["Breakfast", F],
  ["Brunch", F],
  ["Lunch", F],
  ["Dinner", F],
  ["From the Grill", F],
  ["Seafood", F],
  ["Fish", F],
  ["Steaks", F],
  ["Chicken", F],
  ["Vegetarian", F],
  ["Vegan", F],
  ["Kids", F],
  ["Snacks", F],
  ["Bar Snacks", F],
  ["Raw Bar", F],
  ["Oysters", F],
  ["Sushi", F],
  ["Noodles", F],
  ["Tacos", F],
  ["Bowls", F],
  ["Charcuterie", F],
  ["Fish & Chips", F],
  ["Platters", F],
  ["Desserts", S],
  ["Sweets", S],
  ["Puddings", S],
  ["Cakes", S],
  ["Pastries", S],
  ["Ice Cream", S],
  ["Gelato", S],
  ["Sorbets", S],
];

const TURKISH: Row[] = [
  ["Şaraplar", D],
  ["Şarap Listesi", D],
  ["Kırmızı Şaraplar", D],
  ["Beyaz Şaraplar", D],
  ["Roze Şaraplar", D],
  ["Köpüklü Şaraplar", D],
  ["Tatlı Şaraplar", D],
  ["Kadehle Şaraplar", D],
  ["Kadeh", D],
  ["Balık Şarapları", D],
  ["Şarabımız", D],
  ["Kırmızı", D],
  ["Beyaz", D],
  ["Roze", D],
  ["Pembe", D],
  ["Köpüklü", D],
  ["Rakı", D],
  ["Rakılar", D],
  ["Bira", D],
  ["Biralar", D],
  ["Fıçı Bira", D],
  ["Viski", D],
  ["Viskiler", D],
  ["Kokteyl", D],
  ["Kokteyller", D],
  ["Alkolsüz", D],
  ["Alkolsüz İçecekler", D],
  ["İçecekler", D],
  ["Soğuk İçecekler", D],
  ["Sıcak İçecekler", D],
  ["Meşrubatlar", D],
  ["Kahveler", D],
  ["Türk Kahvesi", D],
  ["Çaylar", D],
  ["Su", D],
  ["Sular", D],
  ["Meyve Suları", D],
  ["Likörler", D],
  ["Votka", D],
  ["Cin", D],
  ["Konyak", D],
  ["Tekila", D],
  ["KIRMIZI ŞARAPLAR", D],
  ["İÇECEKLER", D],
  ["Yemekler", F],
  ["Başlangıçlar", F],
  ["Mezeler", F],
  ["Soğuk Mezeler", F],
  ["Sıcak Mezeler", F],
  ["Ara Sıcaklar", F],
  ["Ana Yemekler", F],
  ["Salatalar", F],
  ["Çorbalar", F],
  ["Izgaralar", F],
  ["IZGARA", F],
  ["Kebaplar", F],
  ["Pideler", F],
  ["Lahmacun", F],
  ["Kahvaltı", F],
  ["Makarnalar", F],
  ["Pizzalar", F],
  ["Burgerler", F],
  ["Tostlar", F],
  ["Sandviçler", F],
  ["Dürümler", F],
  ["Balıklar", F],
  ["Deniz Ürünleri", F],
  ["Etler", F],
  ["Et", F],
  ["Kırmızı Et", F],
  ["Beyaz Et", F],
  ["Et Yemekleri", F],
  ["Tavuk", F],
  ["Köfte", F],
  ["Zeytinyağlılar", F],
  ["Mantı", F],
  ["Börekler", F],
  ["Aperatifler", F],
  ["Atıştırmalıklar", F],
  ["Mutfak", F],
  ["Tatlılar", S],
  ["Tatlı", S],
  ["TATLILAR", S],
  ["Pastalar", S],
  ["Dondurmalar", S],
  ["Baklava", S],
];

const FRENCH: Row[] = [
  ["Vins", D],
  ["Carte des vins", D],
  ["Vins rouges", D],
  ["Vins blancs", D],
  ["Vins rosés", D],
  ["Rouges", D],
  ["Blancs", D],
  ["Rosés", D],
  ["Rouges et Rosés", D],
  ["Champagnes", D],
  ["Bulles", D],
  ["Crémant", D],
  ["Vins au verre", D],
  ["Au verre", D],
  ["À la bouteille", D],
  ["Vins de dessert", D],
  ["Bières", D],
  ["Bières pression", D],
  ["Cidres", D],
  ["Apéritifs", D],
  ["Digestifs", D],
  ["Spiritueux", D],
  ["Cocktails", D],
  ["Boissons", D],
  ["Boissons chaudes", D],
  ["Boissons fraîches", D],
  ["Cafés", D],
  ["Thés et infusions", D],
  ["Eaux minérales", D],
  ["Jus de fruits", D],
  ["Softs", D],
  ["Sans alcool", D],
  ["Entrées", F],
  ["Plats", F],
  ["Plats principaux", F],
  ["Hors d'oeuvre", F],
  ["Poissons", F],
  ["Viandes", F],
  ["Salades", F],
  ["Soupes", F],
  ["Potages", F],
  ["Garnitures", F],
  ["Accompagnements", F],
  ["À partager", F],
  ["Fromages", F],
  ["Menu enfant", F],
  ["Tartines", F],
  ["Poissons et viandes", F],
  ["Desserts", S],
  ["Douceurs", S],
  ["Pâtisseries", S],
  ["Glaces", S],
  ["Glaces et sorbets", S],
];

const ITALIAN: Row[] = [
  ["Vini", D],
  ["Carta dei vini", D],
  ["Vini rossi", D],
  ["Vini bianchi", D],
  ["Vini rosati", D],
  ["Rossi", D],
  ["Bianchi", D],
  ["Rosati", D],
  ["Bollicine", D],
  ["Spumanti", D],
  ["Prosecco", D],
  ["Vini al calice", D],
  ["Al calice", D],
  ["Vini dolci", D],
  ["Birre", D],
  ["Birre alla spina", D],
  ["Bevande", D],
  ["Bibite", D],
  ["Analcolici", D],
  ["Acque", D],
  ["Caffetteria", D],
  ["Caffè e tè", D],
  ["Tisane", D],
  ["Liquori", D],
  ["Amari", D],
  ["Grappe", D],
  ["Distillati", D],
  ["Aperitivi", D],
  ["Cocktail", D],
  ["Antipasti", F],
  ["Primi", F],
  ["Primi piatti", F],
  ["Secondi", F],
  ["Secondi piatti", F],
  ["Primi e Secondi", F],
  ["Contorni", F],
  ["Insalate", F],
  ["Zuppe", F],
  ["Pizze", F],
  ["Pizza", F],
  ["Pasta", F],
  ["Risotti", F],
  ["Pesce", F],
  ["Carne", F],
  ["Carne e pesce", F],
  ["Formaggi", F],
  ["Taglieri", F],
  ["Piatti del giorno", F],
  ["Dolci", S],
  ["Gelati", S],
  ["Torte", S],
  ["Dolci e gelati", S],
];

const SPANISH: Row[] = [
  ["Vinos", D],
  ["Carta de vinos", D],
  ["Vinos tintos", D],
  ["Vinos blancos", D],
  ["Vinos rosados", D],
  ["Tintos", D],
  ["Blancos", D],
  ["Rosados", D],
  ["Espumosos", D],
  ["Cavas", D],
  ["Vinos por copa", D],
  ["Por copa", D],
  ["Vinos dulces", D],
  ["Cervezas", D],
  ["Cerveza", D],
  ["Sidras", D],
  ["Bebidas", D],
  ["Refrescos", D],
  ["Zumos", D],
  ["Licores", D],
  ["Cócteles", D],
  ["Cafés e infusiones", D],
  ["Sin alcohol", D],
  ["Aguas", D],
  ["Destilados", D],
  ["Vermut", D],
  ["Entrantes", F],
  ["Tapas", F],
  ["Raciones", F],
  ["Primeros", F],
  ["Segundos", F],
  ["Platos principales", F],
  ["Principales", F],
  ["Ensaladas", F],
  ["Sopas", F],
  ["Carnes", F],
  ["Pescados", F],
  ["Mariscos", F],
  ["Carnes y pescados", F],
  ["Arroces", F],
  ["Paellas", F],
  ["Quesos", F],
  ["Montaditos", F],
  ["Bocadillos", F],
  ["Guarniciones", F],
  ["Huevos", F],
  ["Postres", S],
  ["Helados", S],
  ["Dulces", S],
];

const GERMAN: Row[] = [
  ["Weine", D],
  ["Weinkarte", D],
  ["Rotweine", D],
  ["Weißweine", D],
  ["Weissweine", D],
  ["Roséweine", D],
  ["Schaumweine", D],
  ["Sekt", D],
  ["Offene Weine", D],
  ["Dessertweine", D],
  ["Süßweine", D],
  ["Bier", D],
  ["Biere", D],
  ["Fassbier", D],
  ["Flaschenbiere", D],
  ["Bier vom Fass", D],
  ["Getränke", D],
  ["Heißgetränke", D],
  ["Kaltgetränke", D],
  ["Alkoholfreie Getränke", D],
  ["Spirituosen", D],
  ["Schnäpse", D],
  ["Liköre", D],
  ["Kaffee", D],
  ["Kaffee und Tee", D],
  ["Säfte", D],
  ["Aperitifs", D],
  ["Digestifs", D],
  ["Longdrinks", D],
  ["Vorspeisen", F],
  ["Hauptspeisen", F],
  ["Hauptgerichte", F],
  ["Beilagen", F],
  ["Salate", F],
  ["Suppen", F],
  ["Fleisch", F],
  ["Fisch", F],
  ["Fleischgerichte", F],
  ["Fischgerichte", F],
  ["Vom Grill", F],
  ["Käse", F],
  ["Speisen", F],
  ["Kleine Gerichte", F],
  ["Brotzeit", F],
  ["Flammkuchen", F],
  ["Schnitzel", F],
  ["Vegetarisch", F],
  ["Kinderkarte", F],
  ["Nachspeisen", S],
  ["Nachtisch", S],
  ["Süßspeisen", S],
  ["Kuchen", S],
  ["Eisbecher", S],
];

/**
 * Adversarial headings: mixed kinds in one heading, false friends, a
 * colour beside a food, a place, a house's own words. Each answer is what
 * the rules can honestly say; where they cannot, `unknown`, which a review
 * shows as Unsure rather than guesses.
 */
const ADVERSARIAL: Row[] = [
  // Two kinds in one heading: the rules do not pick one.
  ["Beer & Burgers", U],
  ["Wine & Cheese", U],
  ["Cheese & Desserts", U],
  ["Coffee & Cake", U],
  ["Tea & Sandwiches", U],
  ["Cocktails & Bites", D],
  ["Wine and Tapas", U],
  ["Şarap ve Peynir", U],
  ["Bira Mezeleri", U],
  // A wine word wins inside one heading: these are wines.
  ["Dessert Wines", D],
  ["Balık Şarapları", D],
  ["Vins de dessert", D],
  ["Vini da dessert", D],
  ["Fish Wines", D],
  ["Tatlı Şarap", D],
  // A colour beside a food is the food.
  ["Kırmızı Et", F],
  ["Beyaz Et", F],
  ["Red Velvet Cake", S],
  ["White Fish", F],
  ["Orange Chicken", F],
  ["Arroz blanco", F],
  ["Pescado blanco", F],
  // False friends across languages.
  ["Pasta", F],
  ["Pastalar", S],
  ["Aperatifler", F],
  ["Apéritifs", D],
  ["Entrées", F],
  ["Café", D],
  ["Kahvaltı", F],
  ["Tatlı Beyaz", D],
  ["Rouges et Rosés", D],
  ["Et", F],
  // Turkish capitals: "I" is "ı" and "İ" is "i" only the Turkish way.
  ["IZGARALAR", F],
  ["İÇECEKLER", D],
  ["KIRMIZI", D],
  // "Schweine" is pork, not wine.
  ["Schweinebraten", U],
  // No rule knows these: unknown, never a drink by default.
  ["Specials", U],
  ["Today's Specials", U],
  ["Chef's Selection", U],
  ["Seasonal", U],
  ["Menu", U],
  ["House Favourites", U],
  ["Turkey", U],
  ["Napa Valley", U],
  ["Bordeaux", U],
  ["Toscana", U],
  ["Rioja", U],
  ["Surf & Turf", U],
  ["Lagniappe", U],
  ["Dessert Menu", U],
  ["", U],
];

const ALL: Array<[string, Row[]]> = [
  ["English", ENGLISH],
  ["Turkish", TURKISH],
  ["French", FRENCH],
  ["Italian", ITALIAN],
  ["Spanish", SPANISH],
  ["German", GERMAN],
  ["adversarial", ADVERSARIAL],
];

describe("the heading golden set (ADR 0340 rule 15, lane 5a)", () => {
  it("holds about 400 headings across six languages and the adversarial list", () => {
    const total = ALL.reduce((n, [, rows]) => n + rows.length, 0);
    expect(total).toBeGreaterThanOrEqual(400);
    for (const [, rows] of ALL) expect(rows.length).toBeGreaterThanOrEqual(40);
  });

  for (const [language, rows] of ALL) {
    it(`reads every ${language} heading as its kind`, () => {
      const misses = rows
        .map(([h, want]) => [h, want, kindOf(h)] as const)
        .filter(([, want, got]) => want !== got)
        .map(
          ([h, want, got]) => `${JSON.stringify(h)}: want ${want}, got ${got}`,
        );
      expect(misses).toEqual([]);
    });
  }

  it("never reads a heading no rule knows as a drink", () => {
    const unknowns = ALL.flatMap(([, rows]) => rows).filter(([, k]) => k === U);
    expect(unknowns.length).toBeGreaterThanOrEqual(20);
    for (const [h] of unknowns) expect(kindOf(h)).toBe("unknown");
  });
});

describe("section-level resolution", () => {
  it("lets the nearest heading that decides win, from the section up", () => {
    expect(kindOf(["Wines", "Red", "Turkey"])).toBe("drinks");
    expect(kindOf(["Food", "Specials"])).toBe("food");
    expect(kindOf(["Desserts", "Dessert wines"])).toBe("drinks");
    expect(kindOf(["Drinks", "Bar Snacks"])).toBe("food");
    expect(classifyHeading(["Food", "Specials"]).by).toBe("parent");
    expect(classifyHeading(["Specials"]).by).toBe("none");
  });

  it("reads 'Dessert' (singular) by the line's shape (§F14), and as a blind spot", () => {
    expect(kindOf("Dessert")).toBe("unknown");
    expect(kindOf("Dessert", { bottle_price: 48, category: "dessert" })).toBe(
      "drinks",
    );
    expect(kindOf("Dessert", { price: 9 })).toBe("desserts");
    expect(kindOf(["Wines", "Dessert"])).toBe("drinks");
    expect(classifyHeading("Dessert", { price: 9 })).toEqual({
      kind: "desserts",
      by: "shape",
      blindSpot: true,
    });
  });

  it("flags a cheese course (§F16) and 'Dessert' Unsure even when model and rules agree", () => {
    for (const h of [
      "Cheese",
      "Fromages",
      "Formaggi",
      "Quesos",
      "Käse",
      "Peynirler",
    ]) {
      expect(kindOf(h)).toBe("food");
      expect(kindVerdict({ heading: h, modelKind: "food" })).toMatchObject({
        unsure: true,
        reasons: ["blind_spot"],
      });
    }
    expect(
      kindVerdict({
        heading: "Dessert",
        line: { price: 9 },
        modelKind: "desserts",
      }).reasons,
    ).toEqual(["blind_spot"]);
  });
});

describe("the legacy rule is not moved by the new words (ADR 0340 rule 7)", () => {
  it("isKitchenLine still reads a heading only its own lists know as a drink", () => {
    // kindOf knows these as food; the legacy kitchen test never did, so a
    // stored line under them stays where it was.
    for (const h of [
      "Antipasti",
      "Vorspeisen",
      "Entrantes",
      "Plats principaux",
    ]) {
      expect(kindOf(h)).toBe("food");
      expect(isKitchenLine(h, "")).toBe(false);
    }
  });
});
