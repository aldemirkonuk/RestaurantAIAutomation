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
 * `WineSubmissionsService.normalizeText` / `buildSignature` / `signatureHashFor`
 * are still the public surface the rest of the app calls; they now delegate
 * here rather than owning a copy. That indirection is deliberate — the SQL
 * parity spec pins those method names, and menus.service.ts and wines.service.ts
 * already call through them.
 *
 * The algorithm below is NOT a new one
 * ------------------------------------
 * It is the contract `master_wine_library` is already keyed on, mirrored by
 * `public.wine_normalize_text()` and `public.wine_signature_hash()` and pinned
 * against live-database fixtures in `wine-submissions.service.spec.ts`.
 * Changing any of the constants here invalidates every stored hash and
 * desynchronises the SQL half — do not "improve" them without migrating both
 * sides and recapturing those fixtures.
 *
 * Why this is NOT vendor-intel's `hashWineIdentity`
 * -------------------------------------------------
 * That one is deliberately narrower — producer|name|vintage only — because a
 * vendor page states those three and almost never states appellation or grape.
 * See the comment at the top of `../vendor-intel/wine-identity.ts`. The two
 * answer different questions and are kept apart on purpose.
 */

/**
 * Diacritics to delete rather than turn into a space.
 *
 * This is deliberately an explicit class and not `\p{Diacritic}`, because
 * the same rule has to run in Postgres (public.wine_normalize_text) to key
 * the same columns, and Postgres regex has no Unicode property classes.
 * When the two drifted, one library row diverged: Catalan "Xarel·lo"
 * normalized to "xarello" here and "xarel lo" there, because U+00B7 is a
 * Diacritic to JS but was not in the SQL class.
 *
 * `\p{Diacritic}` covers 659 codepoints this omits, all of them Hebrew,
 * Arabic, Indic, Thai, Tibetan, Burmese or CJK. Deleting versus spacing only
 * changes the outcome when the character sits BETWEEN Latin alphanumerics —
 * a run of non-Latin text collapses to spaces either way — so the Latin and
 * Greek subset below is the part that can actually alter a wine name.
 *
 * Parity with the SQL function is asserted in the spec, not assumed.
 *
 * Spelled as `\u`-escaped alternatives rather than one character class. The
 * literal marks rendered as gibberish — they attach to the `[` and to the
 * range hyphens — and two adjacent combining-mark ranges also trip ESLint's
 * no-misleading-character-class. Every alternative matches exactly one
 * character, so the match set is identical to the class it replaces; the
 * order below is the order it had.
 */
const DIACRITICS = new RegExp(
  [
    "[\\u0300-\\u036F]", // combining diacritical marks
    "[\\u1AB0-\\u1AFF]", // combining diacritical marks extended
    "[\\u1DC0-\\u1DFF]", // combining diacritical marks supplement
    "[\\uFE20-\\uFE2F]", // combining half marks
    "[\\u005E\\u0060\\u00A8\\u00AF\\u00B4\\u00B7\\u00B8]", // ^ ` ¨ ¯ ´ · ¸
    "[\\u02B0-\\u02FF]", // spacing modifier letters
    "[\\u0374\\u0375\\u037A\\u0384\\u0385]", // Greek numeral signs and accents
  ].join("|"),
  "g",
);

/**
 * Trade abbreviations a menu prints, expanded to the word they stand for.
 *
 * Measured before this existed: of 27 library producers beginning with an
 * abbreviable trade word, rewritten the way a menu prints them, ZERO reached
 * the auto-link floor. "Dom. Faiveley" produced no candidate at all against
 * "Domaine Faiveley"; "Ten. di Arceno" scored 62 against "Tenuta di Arceno".
 * Every one of them silently created a duplicate.
 *
 * Trigram similarity is the wrong instrument for a prefix truncation --
 * "dom" and "domaine" share two trigrams out of five however exactly the
 * rest of the name agrees. Lowering the producer gate far enough to reach 62
 * would admit "chateau musar" vs "chateau de bligny" at 0.571 and every
 * other shared-trade-word false positive. So the fix belongs here: these are
 * the same word, and the normalizer should say so.
 *
 * The trailing period is required on every pattern. Bare "dom" is not an
 * abbreviation -- Dom Perignon is a wine, and expanding it would invent a
 * producer that does not exist. Multi-token patterns come first so
 * "az. agr." expands as a unit rather than "az." matching alone.
 *
 * Mirrored exactly by public.wine_normalize_text; the spec fails on drift.
 */
const ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\baz\.\s*agr\.\s*/g, "azienda agricola "],
  [/\bdom\.\s*/g, "domaine "],
  [/\bch\.\s*/g, "chateau "],
  [/\bcht\.\s*/g, "chateau "],
  [/\bbod\.\s*/g, "bodegas "],
  [/\bwgt\.\s*/g, "weingut "],
  [/\bten\.\s*/g, "tenuta "],
  [/\bfatt\.\s*/g, "fattoria "],
  [/\bcant\.\s*/g, "cantina "],
  [/\bmarch\.\s*/g, "marchesi "],
  [/\bste\.\s*/g, "sainte "],
  [/\bst\.\s*/g, "saint "],
  [/\bmt\.\s*/g, "monte "],
];

/**
 * Fold a source string down to comparable letters and digits.
 *
 * NFD + diacritic strip so "Château" and "Chateau" agree. Punctuation becomes a
 * space rather than being deleted so "Blanc de Blancs" and "Blanc-de-Blancs"
 * agree. Trade abbreviations expand before the punctuation pass, because the
 * period they end on is the thing that identifies them as abbreviations.
 *
 * Writes master_wine_library.normalized_name / normalized_producer and the
 * other normalized_* columns, and is mirrored by public.wine_normalize_text().
 */
export function normalizeSignatureText(value?: string | null): string {
  if (!value) return "";
  let s = value.normalize("NFD").replace(DIACRITICS, "").toLowerCase();
  for (const [pattern, expansion] of ABBREVIATIONS) {
    s = s.replace(pattern, expansion);
  }
  return s.replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Render a vintage to its canonical segment.
 *
 * "NV" — non-vintage — is a real, common answer for Champagne and most
 * sparkling, and it is a different bottle from a vintage-dated one. An empty
 * segment would mean "we do not know", which is not the same claim.
 *
 * Coercing through `String(...).trim()` closes two ways the same bottle used
 * to hash twice: a payload carrying the string "2019" versus the number 2019
 * (both of which CreateWineSubmissionDto permits), and a human who typed "NV"
 * into the vintage field rather than leaving it blank. The spelling stays
 * uppercase because that is what public.wine_signature_hash() emits for a NULL
 * vintage and what every stored hash was computed with.
 */
function normalizeVintage(value?: string | number | null): string {
  if (value === null || value === undefined) return "NV";
  const text = String(value).trim();
  if (text === "" || text.toUpperCase() === "NV") return "NV";
  return text;
}

export interface WineSignatureInput {
  name?: string | null;
  producer?: string | null;
  vintage?: string | number | null;
  /**
   * Read off payloads and written to normalized_primary_type /
   * normalized_appellation, but deliberately NOT part of the key — see
   * SIGNATURE_FIELDS.
   */
  primaryType?: string | null;
  grapeVariety?: string | null;
  country?: string | null;
  region?: string | null;
  appellation?: string | null;
}

/**
 * Field order of the key. Changing this invalidates every stored hash and
 * desynchronises public.wine_signature_hash().
 *
 * primary_type and appellation are absent on purpose. primary_type used to
 * occupy a slot and that silently split the key space in two: submitWine()
 * passed a value for it and resolveOrCreateLibraryWine() did not, so the same
 * bottle hashed two different ways depending on which door it came through.
 * Both are derived classifications rather than identity attributes — a menu
 * prints neither — so leaving them out is what makes the paths agree.
 */
const SIGNATURE_FIELDS = [
  "producer",
  "name",
  "vintage",
  "country",
  "region",
  "grapeVariety",
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
 * Hash of the key.
 *
 * Total on purpose: this is the function `resolveOrCreateLibraryWine` and the
 * menu importer call, where the caller has already established that it holds a
 * wine and needs a key for it. Callers reading an untrusted payload want
 * `wineSignatureHashOrNull` instead.
 */
export function hashWineSignature(input: WineSignatureInput): string {
  return createHash("sha256").update(buildWineSignature(input)).digest("hex");
}

/**
 * Hash of the key, or null when there is not enough to identify anything.
 *
 * Requiring a name is the floor. Every other field is a qualifier; a row keyed
 * on `producer||NV|||` claims that "everything this producer makes, undated"
 * is one bottle, and because the column is UNIQUE the second such wine would be
 * rejected outright. Null means "not comparable" — callers must store null
 * rather than a hash of nothing, and must not use it as a lookup key.
 */
export function wineSignatureHashOrNull(
  input: WineSignatureInput,
): string | null {
  if (!normalizeSignatureText(input.name)) return null;
  return hashWineSignature(input);
}

/**
 * Prefix that separates a venue-scoped key from a shared-library one.
 *
 * Provably disjoint from any shared key rather than merely unlikely to
 * collide: a shared key's first segment is `normalizeSignatureText(producer)`,
 * whose output alphabet is `[a-z0-9 ]` only, so it can never contain a colon.
 * Mirrored by `public.wine_provisional_signature_hash`.
 */
export const PROVISIONAL_SIGNATURE_PREFIX = "venue:";

/**
 * Is this identity specific enough to join the SHARED library?
 *
 * Locked by the founder on 2026-09-05 (ADR 0130): a name plus EITHER a
 * producer, OR a vintage and a region. Anything less is a menu section rather
 * than a bottle, and belongs to the venue that wrote it.
 *
 * Why a name alone is not enough, measured rather than assumed. On the schema
 * built from all 100 migrations, the Antalya venue's draft `"House White
 * Wine"` — no producer, no vintage, no region — scored 90 against `HOUSE
 * WHITE`, a row the Sim Meyhouse load created (United States / California /
 * 2023):
 *
 *     match_library_wine('House White Wine', NULL, NULL, NULL, NULL, NULL)
 *       -> HOUSE WHITE, confidence 90, name_sim 1, producer_sim 1
 *
 * `producer_sim` is 1 because the scorer reads two ABSENT producers as a
 * perfect producer match. So the only thing separating two unrelated venues
 * was a 10-point vintage penalty, and 90 clears AUTO_LINK_CONFIDENCE (85).
 *
 * This is deliberately NOT the floor `wineSignatureHashOrNull` applies. That
 * one answers "is this comparable at all", is the key the submissions pipeline
 * has always stored, and lowering or raising it would silently re-key existing
 * rows. This answers a different question — "may this join OTHER PEOPLE'S
 * data" — and only the resolver asks it.
 *
 * Mirrored by `public.wine_identity_is_specific()` and by
 * `wine_identity_is_specific()` in `scripts/synth/identity.py`; all three are
 * pinned against each other by
 * `datasets/sim/fixtures/wine-identity-vectors.json`.
 */
export function isSpecificWineIdentity(input: WineSignatureInput): boolean {
  if (!normalizeSignatureText(input.name)) return false;
  if (normalizeSignatureText(input.producer)) return true;
  return (
    parsedVintageOrNull(input.vintage) !== null &&
    normalizeSignatureText(input.region) !== ""
  );
}

/**
 * The vintage as the DATABASE will see it.
 *
 * `public.wine_identity_is_specific` takes an `integer`, and every caller
 * reaches it through the same `parseInt(...) || null` the resolver applies
 * before the RPC. Reproducing that here rather than reusing
 * `normalizeVintage` is what keeps the two sides answering the same question:
 * `normalizeVintage("MMXV")` renders a segment, but Postgres receives NULL.
 */
export function parsedVintageOrNull(
  value?: string | number | null,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return parseInt(value, 10) || null;
}

/**
 * The identity of one venue's own provisional wine.
 *
 * The same six-field key as `hashWineSignature`, behind a `venue:<id>|`
 * segment. Two venues that both print "House White Wine" therefore occupy two
 * rows under `idx_master_wine_library_signature_hash` instead of colliding on
 * one, while the SAME venue rescanning its own menu still lands on its own row
 * rather than spawning a duplicate.
 *
 * Mirrored by `public.wine_provisional_signature_hash`, which the
 * `trg_sync_signature_hash` trigger applies to any row carrying
 * `provisional_for_restaurant_id`. The hash is recomputed in the database on
 * every write, so this function's output is a lookup key, never the stored
 * value's only author.
 */
export function hashProvisionalWineSignature(
  restaurantId: string,
  input: WineSignatureInput,
): string {
  return createHash("sha256")
    .update(
      `${PROVISIONAL_SIGNATURE_PREFIX}${restaurantId}|${buildWineSignature(input)}`,
    )
    .digest("hex");
}

/**
 * Read a signature input off a submission payload of unknown shape.
 *
 * `master_wine_library_submissions.payload` is untyped JSONB written by four
 * different producers that never agreed on a spelling: the NestJS DTO uses
 * camelCase (`primaryType`), the menu-scan pipeline writes snake_case with the
 * name under `wine_name`, and older rows nest classification fields under a
 * `classification` object. Both TypeScript services previously open-coded a
 * partial subset of those fallbacks — and `processPendingSubmissions` simply
 * cast the row to `CreateWineSubmissionDto` and read `payload.name`, which is
 * `undefined` for every scan-pipeline row — so which fields a payload
 * contributed to its own signature depended on which service happened to read
 * it.
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
