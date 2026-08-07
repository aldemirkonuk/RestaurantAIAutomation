import {
  buildWineIdentity,
  hashWineIdentity,
  normalizeIdentityText,
  wineDisplayLabel,
} from "./wine-identity";

describe("normalizeIdentityText", () => {
  it("strips diacritics so accented and unaccented spellings agree", () => {
    expect(normalizeIdentityText("Château Margaux")).toBe(
      normalizeIdentityText("Chateau Margaux"),
    );
  });

  it("treats punctuation as a word break, not as deletion", () => {
    expect(normalizeIdentityText("Blanc-de-Blancs")).toBe(
      normalizeIdentityText("Blanc de Blancs"),
    );
  });

  it("collapses runs of whitespace", () => {
    expect(normalizeIdentityText("  Domaine   Carneros \n")).toBe(
      "domaine carneros",
    );
  });

  it("returns empty for null and undefined rather than the string 'null'", () => {
    expect(normalizeIdentityText(null)).toBe("");
    expect(normalizeIdentityText(undefined)).toBe("");
  });
});

describe("buildWineIdentity", () => {
  it("keeps three fixed positions even when a field is missing", () => {
    // The whole point: a missing producer must not let the name slide into
    // the producer slot, which is how the library signature loses.
    expect(buildWineIdentity({ name: "Chablis", vintage: 2019 })).toBe(
      "|chablis|2019",
    );
  });

  it("uses 'nv' for a missing vintage, which is a real answer not a gap", () => {
    expect(buildWineIdentity({ producer: "Krug", name: "Grande Cuvee" })).toBe(
      "krug|grande cuvee|nv",
    );
  });

  it("distinguishes NV from a vintage-dated bottling of the same cuvee", () => {
    const nv = buildWineIdentity({ producer: "Krug", name: "Grande Cuvee" });
    const dated = buildWineIdentity({
      producer: "Krug",
      name: "Grande Cuvee",
      vintage: 2008,
    });
    expect(nv).not.toBe(dated);
  });

  it("accepts a vintage given as a string, as scrapers produce", () => {
    expect(
      buildWineIdentity({ producer: "Krug", name: "Vintage", vintage: "2008" }),
    ).toBe(
      buildWineIdentity({ producer: "Krug", name: "Vintage", vintage: 2008 }),
    );
  });
});

describe("hashWineIdentity", () => {
  it("matches the same bottle written three ways by three sources", () => {
    const scraped = hashWineIdentity({
      producer: "Schramsberg Vineyards",
      name: "Blanc de Blancs",
      vintage: 2019,
    });
    const priceList = hashWineIdentity({
      producer: "SCHRAMSBERG VINEYARDS",
      name: "BLANC DE BLANCS,",
      vintage: "2019",
    });
    const typedByHand = hashWineIdentity({
      producer: "  schramsberg   vineyards ",
      name: "Blanc-de-Blancs",
      vintage: 2019,
    });

    expect(scraped).not.toBeNull();
    expect(priceList).toBe(scraped);
    expect(typedByHand).toBe(scraped);
  });

  it("separates different vintages of one wine", () => {
    const a = hashWineIdentity({ producer: "X", name: "Y", vintage: 2019 });
    const b = hashWineIdentity({ producer: "X", name: "Y", vintage: 2020 });
    expect(a).not.toBe(b);
  });

  it("returns null with no name, so unnamed rows are not pooled", () => {
    // A hash of "||2019" would gather every unnamed 2019 observation from
    // every vendor into one confident, meaningless ladder.
    expect(hashWineIdentity({ producer: "X", vintage: 2019 })).toBeNull();
    expect(hashWineIdentity({ name: "   ", vintage: 2019 })).toBeNull();
  });

  it("is stable across calls, since stored rows must stay findable", () => {
    const input = { producer: "Krug", name: "Grande Cuvee" };
    expect(hashWineIdentity(input)).toBe(hashWineIdentity(input));
  });
});

describe("wineDisplayLabel", () => {
  it("does not repeat a producer and vintage the name already carries", () => {
    // The real row that produced "Schramsberg Vineyards 2021 Schramsberg Blanc
    // de Noir North Coast 2021" on the page.
    expect(
      wineDisplayLabel({
        producer: "Schramsberg Vineyards",
        name: "2021 Schramsberg Blanc de Noir North Coast",
        vintage: 2021,
      }),
    ).toBe("2021 Schramsberg Blanc de Noir North Coast");
  });

  it("adds both when the name carries neither", () => {
    expect(
      wineDisplayLabel({
        producer: "Domaine Carneros",
        name: "Brut Rose",
        vintage: 2019,
      }),
    ).toBe("Domaine Carneros Brut Rose 2019");
  });

  it("suppresses an accented producer that the name spells without accents", () => {
    expect(
      wineDisplayLabel({
        producer: "Château Margaux",
        name: "Chateau Margaux Grand Vin",
        vintage: 2015,
      }),
    ).toBe("Chateau Margaux Grand Vin 2015");
  });

  it("keeps the vintage when the name only contains it as part of a longer number", () => {
    // A word-boundary match, not a substring one: "Lot 20195" is not a vintage.
    expect(
      wineDisplayLabel({
        producer: "X",
        name: "Cuvee Lot 20195",
        vintage: 2019,
      }),
    ).toBe("X Cuvee Lot 20195 2019");
  });

  it("omits a vintage nobody recorded rather than printing NV", () => {
    // 'nv' is the right answer for the hash key and the wrong one on screen.
    expect(wineDisplayLabel({ producer: "Krug", name: "Grande Cuvee" })).toBe(
      "Krug Grande Cuvee",
    );
  });

  it("returns null when there is nothing to show", () => {
    expect(wineDisplayLabel({})).toBeNull();
  });
});
