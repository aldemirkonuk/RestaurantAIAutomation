import {
  buildWineSignature,
  hashWineSignature,
  normalizeSignatureText,
  wineSignatureHashOrNull,
  wineSignatureInputFromPayload,
  WineSignatureInput,
} from "./wine-signature";
import { hashWineIdentity } from "../vendor-intel/wine-identity";

/**
 * This file covers the module's own contract: positional slots, the vintage
 * segment, the null floor, and the payload reader.
 *
 * The *values* the algorithm produces are pinned elsewhere, in
 * wine-submissions.service.spec.ts, against fixtures captured from
 * public.wine_normalize_text() and public.wine_signature_hash() on the live
 * database. That split is deliberate: this file may be edited freely, that one
 * fails the moment the TypeScript and SQL halves drift.
 */

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
  });

  it("expands the trade abbreviations a menu prints", () => {
    // Before these expanded, ZERO of 27 library producers beginning with an
    // abbreviable trade word auto-linked when probed the way a menu prints
    // them. "St. Emilion" is the case that shows the period is what makes an
    // abbreviation: the bare word is left alone below.
    expect(normalizeSignatureText("St. Emilion")).toBe("saint emilion");
    expect(normalizeSignatureText("Dom. Mandeliere")).toBe(
      "domaine mandeliere",
    );
  });

  it("leaves a bare trade word alone", () => {
    // Dom Pérignon is a wine, not a Domaine.
    expect(normalizeSignatureText("Dom Perignon")).toBe("dom perignon");
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
    // The regression guard for WinesService's old `.filter(Boolean)`: six
    // fields means six segments, always.
    expect(buildWineSignature({ name: "Chablis" })).toBe("|chablis|NV|||");
    expect(buildWineSignature({ name: "Chablis" }).split("|")).toHaveLength(6);
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
        grapeVariety: "Chardonnay",
        country: "France",
        region: "Burgundy",
      }),
    ).toBe(
      "domaine leflaive|puligny montrachet|2019|france|burgundy|chardonnay",
    );
  });

  it("omits primary_type and appellation from the key", () => {
    // Both are derived classifications rather than identity attributes, and a
    // menu prints neither. primary_type occupying a slot is what split the key
    // space in two: submitWine() passed it and resolveOrCreateLibraryWine() did
    // not, so the same bottle hashed differently per entry point. Adding either
    // back here silently invalidates every stored hash and desynchronises
    // public.wine_signature_hash().
    const base: WineSignatureInput = {
      producer: "Bouchard",
      name: "Chardonnay",
      vintage: 2020,
    };
    expect(buildWineSignature({ ...base, primaryType: "white" })).toBe(
      buildWineSignature(base),
    );
    expect(buildWineSignature({ ...base, appellation: "Meursault" })).toBe(
      buildWineSignature({ ...base, appellation: "Chablis" }),
    );
  });

  it("treats a string vintage and a numeric vintage as the same bottle", () => {
    // CreateWineSubmissionDto permits both spellings.
    expect(buildWineSignature({ name: "Krug", vintage: "2019" })).toBe(
      buildWineSignature({ name: "Krug", vintage: 2019 }),
    );
    expect(buildWineSignature({ name: "Krug", vintage: " 2019 " })).toBe(
      buildWineSignature({ name: "Krug", vintage: 2019 }),
    );
  });

  it("renders a missing vintage as the uppercase NV Postgres emits", () => {
    expect(buildWineSignature({ name: "Krug", vintage: null })).toContain(
      "|NV|",
    );
    expect(buildWineSignature({ name: "Krug", vintage: undefined })).toBe(
      buildWineSignature({ name: "Krug", vintage: "" }),
    );
    // "NV" typed by a human is the same claim as an absent vintage, in either
    // case.
    expect(buildWineSignature({ name: "Krug", vintage: "nv" })).toBe(
      buildWineSignature({ name: "Krug", vintage: null }),
    );
  });

  it("distinguishes a non-vintage bottle from a vintage-dated one", () => {
    expect(buildWineSignature({ name: "Krug", vintage: null })).not.toBe(
      buildWineSignature({ name: "Krug", vintage: 2019 }),
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

  it("stays distinct from vendor-intel's narrower cross-vendor key", () => {
    // Deliberately different keys for different questions — see the comment at
    // the top of vendor-intel/wine-identity.ts. If these ever collide, one of
    // the two has silently adopted the other's field set.
    const wine = { producer: "Krug", name: "Grande Cuvée", vintage: 2019 };
    expect(hashWineSignature(wine)).not.toBe(hashWineIdentity(wine));
  });
});

describe("wineSignatureHashOrNull", () => {
  it("returns null when there is no name to identify the wine by", () => {
    // A UNIQUE index over "everything this producer makes, undated" would
    // reject the producer's second wine outright.
    expect(
      wineSignatureHashOrNull({ producer: "Krug", vintage: 2019 }),
    ).toBeNull();
    expect(wineSignatureHashOrNull({ name: "   " })).toBeNull();
    expect(wineSignatureHashOrNull({})).toBeNull();
  });

  it("agrees with the total variant whenever a name is present", () => {
    const wine = { producer: "Krug", name: "Grande Cuvée", vintage: 2019 };
    expect(wineSignatureHashOrNull(wine)).toBe(hashWineSignature(wine));
  });

  it("agrees across the spellings the two services used to read differently", () => {
    // WinesService read snake_case with a `classification` fallback;
    // WineSubmissionsService cast the row to the camelCase DTO. Same bottle
    // either way.
    const camel = {
      name: "Grande Cuvée",
      producer: "Krug",
      vintage: 2019,
      primaryType: "sparkling",
      grapeVariety: "Champagne blend",
      country: "France",
      region: "Champagne",
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
      },
    };
    expect(
      wineSignatureHashOrNull(wineSignatureInputFromPayload(camel)),
    ).toBe(wineSignatureHashOrNull(wineSignatureInputFromPayload(snake)));
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
    expect(
      wineSignatureHashOrNull(wineSignatureInputFromPayload({})),
    ).toBeNull();
  });

  it("accepts wine_type as a primary_type spelling", () => {
    // The /wine-research path in scan_routes.py writes this key. It does not
    // reach the signature — see the primary_type test above — but it does reach
    // master_wine_library.normalized_primary_type.
    expect(
      wineSignatureInputFromPayload({ name: "Chablis", wine_type: "white" })
        .primaryType,
    ).toBe("white");
  });
});
