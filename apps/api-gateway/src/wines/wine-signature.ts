import { createHash } from "crypto";

/**
 * The master-library dedup key: one wine, one hash, one place it is defined.
 *
 * What this is for
 * ----------------
 * `master_wine_library.signature_hash` carries a UNIQUE index
 * (`idx_master_wine_library_signature_hash`, partial on NOT NULL). It is the
 * question "have we already got this bottle?" — asked before a submission is
 * promoted into the canonical library, and asked again by
 * `resolveOrCreateLibraryWine` before a menu import creates a provisional row.
 * Two callers asking that question must ask it the same way, or the index
 * enforces uniqueness over a key that means different things per writer.
 *
 * Why it lives here rather than in a service
 * ------------------------------------------
 * It used to be a private method on both `WinesService` and
 * `WineSubmissionsService`, and the two had drifted: different field order,
 * different treatment of empty fields, different spelling of "no vintage",
 * different diacritic regexes. The same bottle therefore hashed two ways
 * depending on which entry point it arrived through, and the `.eq(
 * "signature_hash", …)` dedup lookup silently missed across paths. A shared
 * module is the only shape that makes that class of drift impossible.
 *
 * Why this is NOT vendor-intel's `hashWineIdentity`
 * -------------------------------------------------
 * That one is deliberately narrower — producer|name|vintage only — because a
 * vendor page states those three and almost never states appellation or grape.
 * See the comment at the top of `../vendor-intel/wine-identity.ts`. The two
 * answer different questions and are kept apart on purpose: this key must
 * distinguish two Chardonnays that differ only in appellation, and that one
 * must match a scraped listing that names no appellation at all.
 */

/**
 * Fold a source string down to comparable letters and digits.
 *
 * Identical folding to `normalizeIdentityText` in vendor-intel — the same
 * spelling variations show up in both problems, so the same answer is right in
 * both. It is duplicated rather than imported because the two modules are
 * deliberately independent (see above); sharing the normalizer would be the
 * first step toward sharing the key, which is the thing we do not want.
 *
 * NFD + diacritic strip so "Château" and "Chateau" agree. Punctuation becomes a
 * space rather than being deleted so "Blanc de Blancs" and "Blanc-de-Blancs"
 * agree while "StEmilion" does not silently become a word that never existed.
 */
export function normalizeSignatureText(value?: string | null): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Render a vintage to its canonical segment.
 *
 * The old `WineSubmissionsService` version interpolated the raw value, so a
 * payload carrying the string "2019" and one carrying the number 2019 — both
 * of which the DTO permits — produced different hashes for the same bottle.
 * Coercing to a trimmed string closes that.
 *
 * Non-vintage is a real, common answer for Champagne and most sparkling, and it
 * is a different bottle from a vintage-dated one. "nv" is that answer; an empty
 * segment would mean "we do not know", which is not the same claim.
 */
function normalizeVintage(value?: string | number | null): string {
  if (value === null || value === undefined || value === "") return "nv";
  const text = String(value).trim();
  return text === "" ? "nv" : text.toLowerCase();
}

export interface WineSignatureInput {
  name?: string | null;
  producer?: string | null;
  vintage?: string | number | null;
  primaryType?: string | null;
  grapeVariety?: string | null;
  country?: string | null;
  region?: string | null;
  appellation?: string | null;
}

/** Field order of the key. Changing this invalidates every stored hash. */
const SIGNATURE_FIELDS = [
  "producer",
  "name",
  "vintage",
  "primaryType",
  "grapeVariety",
  "country",
  "region",
  "appellation",
] as const;

/**
 * The pre-hash key, exposed so a mismatch is debuggable.
 *
 * Empty fields are kept as empty segments. The old `WinesService` version ran
 * `.filter(Boolean)` and dropped them, which is a positional bug rather than a
 * space saving: with the empties gone, a wine with no producer renders its name
 * in the producer slot, so `{name: "Chablis", region: "Burgundy"}` and
 * `{producer: "Chablis", country: "Burgundy"}` collapse to the same key. Fixed
 * positions cost a few bytes and remove the whole failure mode.
 */
export function buildWineSignature(input: WineSignatureInput): string {
  return SIGNATURE_FIELDS.map((field) =>
    field === "vintage"
      ? normalizeVintage(input.vintage)
      : normalizeSignatureText(input[field] as string | null | undefined),
  ).join("|");
}

/**
 * Hash of the key, or null when there is not enough to identify anything.
 *
 * Requiring a name is the floor. Every other field is a qualifier; a row keyed
 * on `producer||nv|||||` claims that "everything this producer makes, undated"
 * is one bottle, and because the column is UNIQUE the second such wine would be
 * rejected outright. Null means "not comparable" — callers must store null
 * rather than a hash of nothing, and must not use it as a lookup key.
 */
export function hashWineSignature(input: WineSignatureInput): string | null {
  if (!normalizeSignatureText(input.name)) return null;
  return createHash("sha256").update(buildWineSignature(input)).digest("hex");
}

/**
 * Read a signature input off a submission payload of unknown shape.
 *
 * `master_wine_library_submissions.payload` is untyped JSONB written by four
 * different producers that never agreed on a spelling: the NestJS DTO uses
 * camelCase (`primaryType`), the menu-scan pipeline writes snake_case with the
 * name under `wine_name`, and older rows nest classification fields under a
 * `classification` object. Both TypeScript services previously open-coded a
 * partial subset of those fallbacks, so which fields a payload contributed to
 * its own signature depended on which service happened to read it.
 *
 * Accepting every spelling in one place is what makes the key a property of the
 * wine rather than of the writer.
 */
export function wineSignatureInputFromPayload(
  payload: Record<string, any> | null | undefined,
): WineSignatureInput {
  const p = payload ?? {};
  const c = p.classification ?? {};
  // Empty string counts as absent at every step, not just at the top level:
  // the scan pipeline writes "" for a field it looked for and did not find, and
  // that must fall through to the `classification` copy rather than pinning the
  // segment empty.
  const present = (value: unknown) =>
    value !== undefined && value !== null && value !== "";
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      if (present(p[key])) return p[key];
      if (present(c[key])) return c[key];
    }
    return null;
  };

  return {
    name: pick("name", "wine_name", "wineName"),
    producer: pick("producer"),
    vintage: pick("vintage"),
    primaryType: pick("primaryType", "primary_type", "wine_type", "wineType"),
    grapeVariety: pick("grapeVariety", "grape_variety"),
    country: pick("country"),
    region: pick("region"),
    appellation: pick("appellation"),
  };
}
