/**
 * ADR 0104 D15 — the seller's printed tax identity, normalised.
 *
 * D15 resolves a document's vendor BY IDENTITY and by nothing else. This file
 * is the identity half: it turns the glyphs a document prints (BT-31 / BT-32)
 * into one canonical string, or it REFUSES.
 *
 * WHY A REFUSAL IS A FIRST-CLASS ANSWER HERE.
 * The whole of D15's "100% by construction" rests on the claim that two equal
 * normalised values name the same legal person. A normaliser that "does its
 * best" with a string it could not parse breaks exactly that claim — and it
 * breaks it silently, by producing a value that will happily match some other
 * vendor's. So every function here returns either a fully-validated identity or
 * a reason in words, and there is deliberately no lossy middle.
 *
 * THE FOUR PITFALLS THIS FILE IS BUILT AROUND (adversarial pass, 2026-09-11):
 *
 *  1. TR VKN (10 digits) and TR TCKN (11 digits) are BOTH legal seller
 *     identifiers and a sole trader prints the second. Length alone picks the
 *     scheme; both carry a checksum and both are checked, so a transcription
 *     slip becomes `malformed` (no resolution) rather than a confident match on
 *     a number nobody owns.
 *  2. An EU VAT id carries its country IN the string (`DE811569869`), a TR VKN
 *     and a US EIN do not. A two-letter prefix is honoured only when it is a
 *     REAL country prefix; otherwise the country comes from the document.
 *     Without a country the value is refused — `1234567890` on its own is not
 *     an identity, it is ten digits.
 *  3. An EIN is printed `12-3456789` and a VAT id `DE 811 569 869`. Separators
 *     are stripped; the digits are NEVER parsed as a number, because
 *     `Number("0123456789")` loses the leading zero and two different vendors
 *     then collide on one key.
 *  4. Case. `toUpperCase()` is locale-independent in JS for the Latin letters a
 *     VAT prefix can contain, but the fold is applied to the STRIPPED string so
 *     no separator can carry a combining mark into the key.
 */

/** The scheme a printed identity was recognised as. */
export type TaxIdScheme =
  | "TR_VKN"
  | "TR_TCKN"
  | "US_EIN"
  | "EU_VAT"
  | "OPAQUE";

export interface TaxIdentity {
  /** Exactly what the document printed, kept for the log and the sentence. */
  printed: string;
  /** ISO-3166 alpha-2, from the id's own prefix or from the document. */
  country: string;
  scheme: TaxIdScheme;
  /** The identifier with no country prefix and no separators. */
  value: string;
  /**
   * What the unique index holds and what two documents are compared on:
   * `<COUNTRY>:<VALUE>`. The country is part of the key on purpose — a Turkish
   * VKN and a Greek VAT id may be the same ten digits and are not the same
   * legal person.
   */
  normalized: string;
}

export type TaxIdentityResult =
  | { ok: true; identity: TaxIdentity }
  /** `reason` is a sentence a bookkeeper can act on. Never a code. */
  | { ok: false; reason: string };

/**
 * The country codes that legitimately appear as a VAT-id PREFIX. EU-27 plus the
 * three that kept the shape after leaving or never joining. `EL` is Greece's
 * VAT prefix (the ISO code is `GR`) and both are accepted; `XI` is Northern
 * Ireland under the Windsor Framework.
 */
const VAT_PREFIXES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "EL", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI",
  "ES", "SE", "GB", "XI", "NO", "CH",
]);

/** Greece prints `EL`; everything downstream should see one country. */
const PREFIX_TO_COUNTRY: Record<string, string> = { EL: "GR" };

/**
 * Per-country VAT-id lengths, counted AFTER the prefix is removed. A country
 * absent from this table is validated by the generic rule below rather than
 * guessed at — an unknown-but-plausible identity is still exact-matchable, and
 * being exact is the only property D15 rule 1 needs.
 */
const VAT_LENGTHS: Record<string, number[]> = {
  AT: [9], BE: [10], BG: [9, 10], HR: [11], CY: [9], CZ: [8, 9, 10],
  DK: [8], EE: [9], FI: [8], FR: [11], DE: [9], GR: [9], HU: [8],
  IE: [8, 9], IT: [11], LV: [11], LT: [9, 12], LU: [8], MT: [8],
  NL: [12], PL: [10], PT: [9], RO: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  SK: [10], SI: [8], ES: [9], SE: [12], GB: [9, 12], XI: [9, 12],
  NO: [9, 12], CH: [9, 12],
};

/**
 * The label a document prints IN the same field as the number — `VKN: …`,
 * `Vergi No …`, `EIN 12-3456789`, `USt-IdNr. DE…`. Stripping these is
 * deterministic, not a guess: each token is a fixed word, matched only at the
 * start and only when something remains after it.
 *
 * `NO` is deliberately ABSENT although "No." is the commonest label of all — it
 * is also Norway's VAT prefix, and a rule that cannot tell `No: 1234567890`
 * from a Norwegian identifier must not choose. It stays unstripped, is then
 * read as a Norwegian prefix, fails Norway's length rule and comes back
 * `unresolved`. That is the safe direction and it is asserted by a test.
 */
const LABELS = [
  "VERGIKIMLIKNO",
  "VERGIKIMLIK",
  "VERGINO",
  "USTIDNR",
  "TAXID",
  "VATID",
  "VATNO",
  "FEIN",
  "TCKN",
  "VKN",
  "VAT",
  "TAX",
  "EIN",
  "TIN",
  "UID",
  "VD",
];

/** Letters and digits only, upper-cased, with any printed label removed. */
function strip(raw: string): string {
  let s = raw.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  // At most two passes: a document prints "VERGİ NO VKN 123…" and no more.
  for (let pass = 0; pass < 2; pass++) {
    const hit = LABELS.find((l) => s.startsWith(l) && s.length > l.length);
    if (!hit) break;
    s = s.slice(hit.length);
  }
  return s;
}

/**
 * The Turkish VKN check digit (Vergi Kimlik Numarası, 10 digits).
 *
 * Implemented rather than skipped because it is what makes rule 1's "100% by
 * construction" true for the tenant this is being built for: a VKN read one
 * digit wrong fails here and produces `unresolved`, where without the check it
 * would produce a confident non-match and — under rule 2 — a NEW PROVIDER for a
 * vendor already on file. A created row is the expensive mistake
 * (`deleting-fabricated-production-rows`), so the cheap check runs.
 */
export function isValidVkn(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const d = digits.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const tmp = (d[i] + (9 - i)) % 10;
    if (tmp === 0) {
      sum += 0;
      continue;
    }
    const p = (tmp * Math.pow(2, 9 - i)) % 9;
    sum += p === 0 ? 9 : p;
  }
  return (10 - (sum % 10)) % 10 === d[9];
}

/** The Turkish national id (TCKN, 11 digits) — a sole trader's seller id. */
export function isValidTckn(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const d = digits.split("").map(Number);
  if (d[0] === 0) return false;
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  if ((odd * 7 - even + 10) % 10 !== d[9]) return false;
  const first10 = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return first10 % 10 === d[10];
}

/**
 * Normalise a printed seller tax id.
 *
 * `countryHint` is the document's own country — its jurisdiction, or the
 * country printed in the seller's address. It is used ONLY when the identity
 * carries no country prefix of its own; a prefix always wins, because a French
 * vendor invoicing from a German VAT registration prints the German one.
 */
export function normalizeTaxId(
  raw: string | null | undefined,
  countryHint?: string | null,
): TaxIdentityResult {
  if (raw == null || String(raw).trim() === "")
    return { ok: false, reason: "no tax identity is printed on this document" };

  const printed = String(raw).trim();
  const stripped = strip(printed);
  if (stripped === "")
    return {
      ok: false,
      reason: `the printed tax identity "${printed}" contains no letters or digits`,
    };

  // ---- country -----------------------------------------------------------
  let country: string | null = null;
  let value = stripped;
  const head = stripped.slice(0, 2);
  if (VAT_PREFIXES.has(head) && stripped.length > 2) {
    country = PREFIX_TO_COUNTRY[head] ?? head;
    value = stripped.slice(2);
  } else {
    const hint = (countryHint ?? "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(hint)) country = PREFIX_TO_COUNTRY[hint] ?? hint;
  }

  if (!country)
    return {
      ok: false,
      reason:
        `the tax identity "${printed}" carries no country prefix and the ` +
        `document states no country, so it cannot be told apart from the same ` +
        `digits issued elsewhere`,
    };

  // ---- scheme and validity ----------------------------------------------
  if (country === "TR") {
    if (!/^\d+$/.test(value))
      return {
        ok: false,
        reason: `a Turkish tax identity is all digits; "${printed}" is not`,
      };
    if (value.length === 10) {
      if (!isValidVkn(value))
        return {
          ok: false,
          reason: `"${printed}" is ten digits but fails the VKN check digit, so it is not a valid Turkish tax number`,
        };
      return { ok: true, identity: id(printed, country, "TR_VKN", value) };
    }
    if (value.length === 11) {
      if (!isValidTckn(value))
        return {
          ok: false,
          reason: `"${printed}" is eleven digits but fails the TCKN check digit, so it is not a valid Turkish identity number`,
        };
      return { ok: true, identity: id(printed, country, "TR_TCKN", value) };
    }
    return {
      ok: false,
      reason: `a Turkish tax identity is 10 digits (VKN) or 11 (TCKN); "${printed}" is ${value.length}`,
    };
  }

  if (country === "US") {
    if (!/^\d{9}$/.test(value))
      return {
        ok: false,
        reason: `a US EIN is nine digits; "${printed}" is not`,
      };
    return { ok: true, identity: id(printed, country, "US_EIN", value) };
  }

  if (VAT_PREFIXES.has(country) || VAT_PREFIXES.has(head)) {
    const lengths = VAT_LENGTHS[country];
    if (lengths && !lengths.includes(value.length))
      return {
        ok: false,
        reason: `a ${country} VAT identifier is ${lengths.join(" or ")} characters; "${printed}" is ${value.length}`,
      };
    if (!/^[A-Z0-9]{2,14}$/.test(value))
      return {
        ok: false,
        reason: `"${printed}" is not a readable ${country} VAT identifier`,
      };
    return { ok: true, identity: id(printed, country, "EU_VAT", value) };
  }

  // A country we have no rule for. The value is still exact-matchable, which is
  // all rule 1 needs; it is simply not CHECKED, and it is labelled so.
  if (!/^[A-Z0-9]{4,20}$/.test(value))
    return {
      ok: false,
      reason: `"${printed}" is too short or too irregular to be a tax identity`,
    };
  return { ok: true, identity: id(printed, country, "OPAQUE", value) };
}

function id(
  printed: string,
  country: string,
  scheme: TaxIdScheme,
  value: string,
): TaxIdentity {
  return { printed, country, scheme, value, normalized: `${country}:${value}` };
}
