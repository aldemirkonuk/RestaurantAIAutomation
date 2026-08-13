import { Test } from "@nestjs/testing";
import { createHash } from "crypto";
import { DatabaseService } from "../database/database.service";
import { WineSubmissionsService } from "./wine-submissions.service";

/**
 * The normalizer and the signature exist in two places — here and in Postgres
 * (public.wine_normalize_text / public.wine_signature_hash) — because the
 * columns they key are written by TypeScript and read by SQL. When the two
 * drifted, matching failed silently: a wine simply never found its library
 * row, and the import created a duplicate instead of erroring.
 *
 * These tests pin the TypeScript half against fixtures whose SQL results were
 * captured from the live database, so drift on either side fails here rather
 * than showing up as a mysteriously unmatchable wine months later.
 */
describe("WineSubmissionsService normalization contract", () => {
  let service: WineSubmissionsService;
  // The two private methods under test are the contract; reaching them
  // directly is the point, since going through resolveOrCreateLibraryWine
  // would test Supabase rather than the normalizer.
  const normalize = (v: string | null) => (service as any).normalizeText(v);
  const signature = (p: Record<string, unknown>) =>
    (service as any).buildSignature(p);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WineSubmissionsService,
        { provide: DatabaseService, useValue: { supabase: {} } },
      ],
    }).compile();
    service = moduleRef.get(WineSubmissionsService);
  });

  describe("normalizeText", () => {
    // Expected values produced by public.wine_normalize_text() on the live
    // database. Any change to either implementation breaks one of these.
    const cases: Array<[string, string]> = [
      ["Château Léoville-Barton", "chateau leoville barton"],
      ["Domaine de la Mandelière", "domaine de la mandeliere"],
      ["2022 Olivier Leflaive “Les Sétilles” Bourgogne", "2022 olivier leflaive les setilles bourgogne"],
      ["Fekete Pince Somló", "fekete pince somlo"],
      ["2022 Majestik Sultaniye Denizli TÜRKİYE", "2022 majestik sultaniye denizli turkiye"],
      ["NERO D’AVOLA", "nero d avola"],
      ["Comte Henry d'Assay Argile à Silex", "comte henry d assay argile a silex"],
      // The case that exposed the drift, and the reason this file exists.
      // U+00B7 MIDDLE DOT is a Diacritic to JS but was missing from the first
      // SQL class, so Catalan "Xarel·lo" normalized to "xarello" here and
      // "xarel lo" in Postgres — one silently unmatchable wine. Both sides
      // now delete it.
      ["Xarel·lo", "xarello"],
      ["", ""],
    ];

    it.each(cases)("normalizes %j", (input, expected) => {
      expect(normalize(input)).toBe(expected);
    });

    it("treats null and undefined as empty", () => {
      expect(normalize(null)).toBe("");
      expect(normalize(undefined as any)).toBe("");
    });

    it("collapses runs of punctuation to a single space", () => {
      expect(normalize("Blanc -- de___Blancs")).toBe("blanc de blancs");
    });
  });

  describe("buildSignature", () => {
    it("omits primary_type entirely", () => {
      // The bug this guards: submitWine() passed primaryType and
      // resolveOrCreateLibraryWine() did not, so the same bottle hashed two
      // different ways depending on which path created it, and the two could
      // never match each other.
      const withType = signature({
        name: "Merlot",
        producer: "Duckhorn",
        vintage: 2019,
        primaryType: "red",
      });
      const withoutType = signature({
        name: "Merlot",
        producer: "Duckhorn",
        vintage: 2019,
      });
      expect(withType).toBe(withoutType);
      expect(withType.split("|")).toHaveLength(6);
    });

    it("reserves a slot for every field so a missing one cannot shift", () => {
      // "no producer, named Chablis" must not collide with "producer
      // Chablis, no name".
      const a = signature({ name: "Chablis", producer: null, vintage: 2019 });
      const b = signature({ name: "", producer: "Chablis", vintage: 2019 });
      expect(a).not.toBe(b);
    });

    it("uses NV for a missing vintage, not an empty segment", () => {
      expect(signature({ name: "Krug", producer: "Krug" })).toContain("|NV|");
    });

    it("matches the hash Postgres computes for the same wine", () => {
      // Captured from:
      //   SELECT wine_signature_hash('Louis Roederer',
      //     '2015 Louis Roederer Cristal Champagne', 2015, 'France',
      //     'Champagne', NULL);
      const hash = createHash("sha256")
        .update(
          signature({
            producer: "Louis Roederer",
            name: "2015 Louis Roederer Cristal Champagne",
            vintage: 2015,
            country: "France",
            region: "Champagne",
            grapeVariety: null,
          }),
        )
        .digest("hex");
      expect(hash).toBe(EXPECTED_CRISTAL_HASH);
    });
  });
});

/** Captured from the live database — see the test that uses it. */
const EXPECTED_CRISTAL_HASH =
  "da01ebb089a30f45b7e24e1cda543ca341c0af65bb79a94ab4e3a7dfdec1e227";
