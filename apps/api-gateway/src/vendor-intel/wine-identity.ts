import { createHash } from "crypto";

/**
 * Cross-source identity for a bottle.
 *
 * The problem this solves
 * ----------------------
 * A vendor's web page says "Schramsberg Blanc de Blancs 2019". Another vendor's
 * price list says "SCHRAMSBERG BLANC DE BLANC, 2019". A rep's WhatsApp says
 * "Schramsberg BdB '19". These are one bottle and three strings. Until they
 * hash to the same key, the price ladder cannot rank them against each other,
 * and /vendor-prices shows one vendor per product forever.
 *
 * Why this is NOT wines.service's buildSignature
 * ----------------------------------------------
 * That signature exists to DEDUPLICATE the master library, where every field is
 * known: it joins producer, name, vintage, type, grape, country, region and
 * appellation, dropping the empty ones. That is correct for its job and useless
 * for this one — a vendor page states a producer, a name and a vintage, and
 * almost never states appellation or grape. Because the library signature drops
 * empty parts rather than reserving their position, a scraped
 * `producer|name|vintage` can never equal a library
 * `producer|name|vintage|type|grape|country|region`, no matter how well the
 * scrape parsed.
 *
 * So this is a deliberately *narrower* key: the three attributes every source
 * states, in fixed positions. It matches across sources at the cost of
 * conflating two wines that differ only in a field a vendor page never prints —
 * which for a producer/name/vintage triple is a good trade, since that triple
 * is how the wine is actually sold.
 *
 * Do not "unify" the two. They answer different questions, and collapsing them
 * would break master-library dedup (too coarse) or vendor matching (too fine).
 * They are kept apart on purpose; this comment is the reason.
 */

/**
 * Fold a source string down to comparable letters and digits.
 *
 * NFD + diacritic strip so "Château" and "Chateau" agree — vendor sites are
 * split roughly evenly on whether they bother with the accent. Punctuation
 * becomes a space rather than being deleted so "Blanc de Blancs" and
 * "Blanc-de-Blancs" agree while "StEmilion" does not silently become a word
 * that never existed.
 */
export function normalizeIdentityText(value?: string | null): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface WineIdentity {
  producer?: string | null;
  name?: string | null;
  vintage?: number | string | null;
}

/**
 * The pre-hash key, exposed so a mismatch is debuggable.
 *
 * Positions are fixed and empty fields are kept as empty segments. Dropping
 * them — as the library signature does — is exactly what makes that signature
 * unusable here: it lets a missing producer shift the name into the producer
 * slot, so "unknown producer, Chablis 2019" collides with "Chablis, no name".
 */
export function buildWineIdentity(input: WineIdentity): string {
  const producer = normalizeIdentityText(
    typeof input.producer === "string" ? input.producer : null,
  );
  const name = normalizeIdentityText(
    typeof input.name === "string" ? input.name : null,
  );
  // Non-vintage is a real, common answer for Champagne and most sparkling, and
  // it is a different bottle from a vintage-dated one. "nv" is that answer;
  // an empty string would mean "we do not know", which is not the same.
  const vintage =
    input.vintage === null || input.vintage === undefined || input.vintage === ""
      ? "nv"
      : String(input.vintage).trim().toLowerCase();

  return `${producer}|${name}|${vintage}`;
}

/**
 * Hash of the identity, or null when there is not enough to identify anything.
 *
 * Requiring a name is the floor. A row keyed on `||2019` would collect every
 * unnamed 2019 observation from every vendor into one ladder — a confident,
 * completely meaningless comparison. Null means "not comparable", and the
 * caller must store null rather than a hash of nothing.
 */
export function hashWineIdentity(input: WineIdentity): string | null {
  const key = buildWineIdentity(input);
  const name = normalizeIdentityText(
    typeof input.name === "string" ? input.name : null,
  );
  if (!name) return null;
  return createHash("sha256").update(key).digest("hex");
}
