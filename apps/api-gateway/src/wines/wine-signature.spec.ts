import {
  buildWineSignature,
  hashWineSignature,
  normalizeSignatureText,
  wineSignatureInputFromPayload,
  WineSignatureInput,
} from "./wine-signature";
import { hashWineIdentity } from "../vendor-intel/wine-identity";

describe("normalizeSignatureText", () => {
  it("strips diacritics so accented and unaccented spellings agree", () => {
    expect(normalizeSignatureText("Château Margaux")).toBe(
      normalizeSignatureText("Chateau Margaux"),
    );
  });

  it("treats punctuation as a word break, not as deletion", () => {
    expect(normalizeSignatureText("Blanc-de-Blancs")).toBe(
      normalizeSignatureText("Blanc de Blancs"),
    );
    expect(normalizeSignatureText("St. Emilion")).toBe("st emilion");
  });

  it("collapses runs of whitespace and trims", () => {
    expect(normalizeSignatureText("  Domaine   Carneros \n")).toBe(
      "domaine carneros",
    );
  });

  it("returns empty for null and undefined rather than the string 'null'", () => {
    expect(normalizeSignatureText(null)).toBe("");
    expect(normalizeSignatureText(undefined)).toBe("");
  });
});

describe("buildWineSignature", () => {
  it("keeps every position even when fields are missing", () => {
    // The regression guard for WinesService's old `.filter(Boolean)`: eight
    // fields means eight segments, always.
    expect(buildWineSignature({ name: "Chablis" })).toBe("|chablis|nv|||||");
    expect(buildWineSignature({ name: "Chablis" }).split("|")).toHaveLength(8);
  });

  it("does not let a missing producer slide the name into the producer slot", () => {
    // Under the old drop-empties key both of these rendered "chablis|burgundy"
    // and deduped into one row.
    const noProducer = buildWineSignature({
      name: "Chablis",
      region: "Burgundy",
    });
    const noName = buildWineSignature({
      producer: "Chablis",
      country: "Burgundy",
    });
    expect(noProducer).not.toBe(noName);
  });

  it("places fields in the documented order", () => {
    expect(
      buildWineSignature({
        producer: "Domaine Leflaive",
        name: "Puligny-Montrachet",
        vintage: 2019,
        primaryType: "white",
        grapeVariety: "Chardonnay",
        country: "France",
        region: "Burgundy",
        appellation: "Puligny-Montrachet",
      }),
    ).toBe(
      "domaine leflaive|puligny montrachet|2019|white|chardonnay|france|burgundy|puligny montrachet",
    );
  });

  it("treats a string vintage and a numeric vintage as the same bottle", () => {
    // WineSubmissionsService interpolated the raw value, so "2019" and 2019 —
    // both permitted by CreateWineSubmissionDto — hashed differently.
    expect(buildWineSignature({ name: "Krug", vintage: "2019" })).toBe(
      buildWineSignature({ name: "Krug", vintage: 2019 }),
    );
  });

  it("renders a missing vintage as 'nv' in lowercase", () => {
    expect(buildWineSignature({ name: "Krug", vintage: null })).toContain(
      "|nv|",
    );
    expect(buildWineSignature({ name: "Krug", vintage: undefined })).toBe(
      buildWineSignature({ name: "Krug", vintage: "" }),
    );
    // "NV" typed by a human is the same claim as an absent vintage.
    expect(buildWineSignature({ name: "Krug", vintage: "NV" })).toBe(
      buildWineSignature({ name: "Krug", vintage: null }),
    );
  });

  it("distinguishes a non-vintage bottle from a vintage-dated one", () => {
    expect(buildWineSignature({ name: "Krug", vintage: null })).not.toBe(
      buildWineSignature({ name: "Krug", vintage: 2019 }),
    );
  });

  it("distinguishes two wines differing only in appellation", () => {
    // The field WineSubmissionsService omitted entirely.
    const base: WineSignatureInput = {
      producer: "Bouchard",
      name: "Chardonnay",
      vintage: 2020,
    };
    expect(buildWineSignature({ ...base, appellation: "Meursault" })).not.toBe(
      buildWineSignature({ ...base, appellation: "Chablis" }),
    );
  });
});

describe("hashWineSignature", () => {
  it("is a sha256 hex digest", () => {
    expect(hashWineSignature({ name: "Krug" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls", () => {
    const input = { producer: "Krug", name: "Grande Cuvée", vintage: 2019 };
    expect(hashWineSignature(input)).toBe(hashWineSignature(input));
  });

  it("returns null when there is no name to identify the wine by", () => {
    // A UNIQUE index over "everything this producer makes, undated" would
    // reject the producer's second wine outright.
    expect(hashWineSignature({ producer: "Krug", vintage: 2019 })).toBeNull();
    expect(hashWineSignature({ name: "   " })).toBeNull();
    expect(hashWineSignature({})).toBeNull();
  });

  it("agrees across the spellings the two services used to read differently", () => {
    // WinesService read snake_case with a `classification` fallback;
    // WineSubmissionsService read camelCase. Same bottle either way.
    const camel = {
      name: "Grande Cuvée",
      producer: "Krug",
      vintage: 2019,
      primaryType: "sparkling",
      grapeVariety: "Champagne blend",
      country: "France",
      region: "Champagne",
      appellation: "Champagne",
    };
    const snake = {
      wine_name: "Grande Cuvée",
      producer: "Krug",
      vintage: 2019,
      classification: {
        primary_type: "sparkling",
        grape_variety: "Champagne blend",
        country: "France",
        region: "Champagne",
        appellation: "Champagne",
      },
    };
    expect(hashWineSignature(wineSignatureInputFromPayload(camel))).toBe(
      hashWineSignature(wineSignatureInputFromPayload(snake)),
    );
  });

  it("stays distinct from vendor-intel's narrower cross-vendor key", () => {
    // Deliberately different keys for different questions — see the comment at
    // the top of vendor-intel/wine-identity.ts. If these ever collide, one of
    // the two has silently adopted the other's field set.
    const wine = { producer: "Krug", name: "Grande Cuvée", vintage: 2019 };
    expect(hashWineSignature(wine)).not.toBe(hashWineIdentity(wine));
  });
});

describe("wineSignatureInputFromPayload", () => {
  it("reads the menu-scan pipeline's wine_name", () => {
    expect(wineSignatureInputFromPayload({ wine_name: "Prosecco" }).name).toBe(
      "Prosecco",
    );
  });

  it("prefers a top-level field over the nested classification copy", () => {
    const input = wineSignatureInputFromPayload({
      name: "Chablis",
      region: "Burgundy",
      classification: { region: "Loire" },
    });
    expect(input.region).toBe("Burgundy");
  });

  it("falls back to classification when the top-level field is absent", () => {
    const input = wineSignatureInputFromPayload({
      name: "Chablis",
      classification: { region: "Loire" },
    });
    expect(input.region).toBe("Loire");
  });

  it("treats an empty-string field as absent so it can fall back", () => {
    const input = wineSignatureInputFromPayload({
      name: "Chablis",
      region: "",
      classification: { region: "Loire" },
    });
    expect(input.region).toBe("Loire");
  });

  it("survives a null or empty payload", () => {
    expect(wineSignatureInputFromPayload(null).name).toBeNull();
    expect(wineSignatureInputFromPayload(undefined).name).toBeNull();
    expect(hashWineSignature(wineSignatureInputFromPayload({}))).toBeNull();
  });

  it("accepts wine_type as a primary_type spelling", () => {
    // The /wine-research path in scan_routes.py writes this key.
    expect(
      wineSignatureInputFromPayload({ name: "Chablis", wine_type: "white" })
        .primaryType,
    ).toBe("white");
  });
});
