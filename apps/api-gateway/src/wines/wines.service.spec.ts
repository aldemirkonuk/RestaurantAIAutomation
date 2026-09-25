import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { WinesService } from "./wines.service";

/**
 * `master_wine_library.beverage_kind` was computed by trigger from August
 * (20260817060000) and dropped by `mapWine` before it reached the browser, so
 * the cellar could not COUNT the beers in a library that had already classified
 * them — the three unwired registers showed no number at all for that one
 * reason. These tests pin the field onto the wire.
 *
 * The `undefined` case is not a formality. `undefined` means "this query did
 * not select the column"; `"unknown"` means "the classifier looked and could
 * not tell". A consumer that cannot tell those apart renders "no beer" over a
 * query that never asked — which is the same class of error the classification
 * columns were introduced to split apart in the first place
 * (20260817060000, the comment on classification_status).
 */
describe("WinesService.mapWine — beverage_kind on the wire", () => {
  let service: WinesService;
  const map = (row: Record<string, unknown>) => (service as any).mapWine(row);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WinesService,
        { provide: DatabaseService, useValue: { supabase: {} } },
      ],
    }).compile();
    service = moduleRef.get(WinesService);
  });

  it("carries beverage_kind and classification_status from a select('*') row", () => {
    const out = map({
      id: "w1",
      name: "Efes Pilsen",
      producer: "Anadolu Efes",
      vintage: null,
      price_reference: null,
      primary_type: null,
      grape_variety: null,
      country: "Türkiye",
      region: null,
      appellation: null,
      beverage_kind: "beer",
      classification_status: "classified",
    });
    expect(out.beverageKind).toBe("beer");
    expect(out.classificationStatus).toBe("classified");
  });

  it("passes 'unknown' through as itself — it is a verdict, not an absence", () => {
    const out = map({
      id: "w2",
      name: "Something",
      producer: "Someone",
      vintage: null,
      price_reference: null,
      primary_type: null,
      grape_variety: null,
      country: null,
      region: null,
      appellation: null,
      beverage_kind: "unknown",
      classification_status: "unclassified",
    });
    expect(out.beverageKind).toBe("unknown");
  });

  it("leaves the field undefined when the query never selected the column", () => {
    const out = map({
      id: "w3",
      name: "Chablis",
      producer: "Dauvissat",
      vintage: 2020,
      price_reference: 90,
      primary_type: "white",
      grape_variety: "Chardonnay",
      country: "France",
      region: "Burgundy",
      appellation: "Chablis",
    });
    expect(out.beverageKind).toBeUndefined();
    expect("beverageKind" in out).toBe(true);
  });

  it("does not disturb the provenance block it sits beside", () => {
    const out = map({
      id: "w4",
      name: "Barolo",
      producer: "Vietti",
      vintage: 2018,
      price_reference: 0,
      primary_type: "red",
      grape_variety: "Nebbiolo",
      country: "Italy",
      region: "Piedmont",
      appellation: "Barolo",
      beverage_kind: "wine",
      library_tier: 2,
      data_enrichment: { knowledge: "inferred" },
    });
    expect(out.beverageKind).toBe("wine");
    expect(out.provenance.knowledge).toBe("inferred");
    // The 0-sentinel is untouched by this change and still arrives as 0.
    expect(out.price).toBe(0);
  });
});

/**
 * ADR 0160 sec110 Owed #4/#11 — "the wine's own detail". `wine_structure`,
 * `primary_aromas`, `serving_temp_celsius`, `glass_type`,
 * `decanting_recommended` and `aging_potential_years` arrive on every
 * `select("*")` (verified live 2026-09-19, prod exzueerziesmczwlhomd) and
 * were dropped the same way `beverage_kind` was before the fix above — same
 * class of defect, same fix shape.
 */
describe("WinesService.mapWine — the wine's own detail on the wire", () => {
  let service: WinesService;
  const map = (row: Record<string, unknown>) => (service as any).mapWine(row);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WinesService,
        { provide: DatabaseService, useValue: { supabase: {} } },
      ],
    }).compile();
    service = moduleRef.get(WinesService);
  });

  it("carries body/acidity/tannins/sweetness off wine_structure, and the four handling fields, from a select('*') row", () => {
    const out = map({
      id: "w1",
      name: "Château Lassègue",
      producer: "Château Lassègue",
      vintage: 2018,
      price_reference: 55,
      primary_type: "red",
      grape_variety: "Merlot",
      country: "France",
      region: "Saint-Émilion",
      appellation: null,
      wine_structure: { body: "medium-full", acidity: "medium-high", tannins: "medium-high", sweetness: "dry" },
      primary_aromas: ["dark cherry", "plum", "blackcurrant"],
      serving_temp_celsius: 18,
      glass_type: "Bordeaux",
      decanting_recommended: true,
      aging_potential_years: 20,
    });
    expect(out.structure).toEqual({
      body: "medium-full",
      acidity: "medium-high",
      tannins: "medium-high",
      sweetness: "dry",
      primaryAromas: ["dark cherry", "plum", "blackcurrant"],
      servingTempCelsius: 18,
      glassType: "Bordeaux",
      decantingRecommended: true,
      agingPotentialYears: 20,
    });
  });

  it("leaves the field undefined when the query never selected any of these columns — never an empty structure", () => {
    const out = map({
      id: "w2",
      name: "Chablis",
      producer: "Dauvissat",
      vintage: 2020,
      price_reference: 90,
      primary_type: "white",
      grape_variety: "Chardonnay",
      country: "France",
      region: "Burgundy",
      appellation: "Chablis",
    });
    expect(out.structure).toBeUndefined();
    expect("structure" in out).toBe(false);
  });

  it("carries a partial read (decanting_recommended: false) rather than folding it into 'unselected'", () => {
    // `false` and `undefined` must never collapse to the same branch — a
    // row that recorded "no decanting" is a real, present answer.
    const out = map({
      id: "w3",
      name: "Cortese",
      producer: "Someone",
      vintage: null,
      price_reference: null,
      primary_type: "white",
      grape_variety: "Cortese",
      country: "Italy",
      region: null,
      appellation: null,
      decanting_recommended: false,
    });
    expect(out.structure).toBeDefined();
    expect(out.structure.decantingRecommended).toBe(false);
    expect(out.structure.body).toBeUndefined();
  });
});
