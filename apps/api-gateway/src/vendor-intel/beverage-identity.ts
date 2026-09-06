import { normalizeIdentityText, wineDisplayLabel } from "./wine-identity";

/**
 * What a bottle IS, as a key several sources can agree on — the pure half.
 *
 * WHOSE QUESTION THIS ANSWERS
 * ---------------------------
 * ADR 0117 Q28: "which pages should the sweep read?" The sweep builder's own
 * answer was that the identity join is "the largest and only one that makes an
 * index line answer *what does this bottle cost elsewhere*", and the founder,
 * asked, said: *"Do the SOTA and best for scalability thinking there might be
 * more in future"* (2026-09-05). This file is the key that join turns on.
 *
 * WHY THE KEY IS FOUR PARTS AND NOT A NAME
 * ----------------------------------------
 * Two standards say the same thing from opposite directions, both read on
 * 2026-09-05:
 *
 *  - **GS1, GTIN Management Standard 1.1 (Ratified Sep 2023)**, fetched from
 *    https://ref.gs1.org/standards/gtin-management/ (381,277 bytes):
 *    section 2.3 *"Any change (increase or decrease) to the legally-required
 *    declared net content that is printed on the pack, requires assignment of
 *    a new GTIN"*; section 2.8 *"A change to the number of trade items in a
 *    case ... requires assignment of a new GTIN"*. So size and pack are part
 *    of what a trade item IS, not modifiers on it.
 *  - **Liv-ex's LWIN** decomposes a bottle into exactly wine + vintage + pack
 *    + size (LWIN-7 / -11 / -16 / -18). Its database is CC BY 4.0
 *    (https://www.liv-ex.com/lwin/lwin-creative-commons/, read 2026-09-05).
 *
 * ADR 0119 Q7 asked whether format should be part of the comparison key rather
 * than a scale factor, because `normalizeUnitPrice`
 * (`analytics/engine/vendor-price-consensus.ts:132`) currently reduces a
 * 12 x 375 case and a 6 x 750 case to the same per-750 number — volumetrically
 * right, commercially wrong. Both standards answer it: they are two trade
 * items. This key answers it by construction.
 *
 * WHY THIS IS NOT A FIFTH NORMALISER
 * ----------------------------------
 * The repo already holds four implementations of "is this the same drink":
 *   1. `public.wine_signature_hash()` + `wine_normalize_text()` (SQL) — master
 *      library dedup, producer|name|vintage|type|grape|country|region, empties
 *      DROPPED;
 *   2. `public.beverage_identity_key()` (PL/pgSQL, mirrored in
 *      `scripts/eval_merge_policies.py`) — the beverages residual-token key;
 *   3. `buildWineIdentity()` (this directory's `wine-identity.ts`) — the
 *      fixed-position producer|name|vintage key the price register uses;
 *   4. `normaliseName()` / `sameProduct()` (`bottle-size.ts`) — the page
 *      identity gate.
 * None of them carries size or pack, and none of them can, because each is
 * keyed to a table whose size column is a default (measured: 750 on all 4,226
 * `master_wine_library` rows). So this file does NOT add a fifth text
 * normaliser: it IMPORTS `normalizeIdentityText` from (3) and adds only the
 * two axes none of them has. If that import ever has to be forked, the reason
 * belongs here, in this comment.
 */

/** The four parts, before normalisation. */
export interface IdentityInput {
  producer?: string | null;
  name?: string | null;
  /** A year, `"nv"`, or null/undefined meaning the source said nothing. */
  vintage?: number | string | null;
  /** Millilitres per bottle. Null/undefined means unstated — never 750. */
  sizeMl?: number | null;
  /** Bottles per trade item. Null/undefined means unstated — never 1. */
  pack?: number | null;
}

/** The four parts after normalisation, exactly as the register stores them. */
export interface IdentityParts {
  producerNormalised: string;
  nameNormalised: string;
  /** `"nv"` | `"unstated"` | a four-digit year. */
  vintageText: string;
  sizeMl: number | null;
  pack: number | null;
}

export interface IdentityRefusal {
  ok: false;
  reason:
    | "no_name"
    | "no_producer"
    | "size_not_positive"
    | "pack_not_positive"
    | "vintage_not_a_year";
  note: string;
}

export type IdentityReading = ({ ok: true } & IdentityParts) | IdentityRefusal;

/**
 * The widest and the narrowest bottle this register will accept.
 *
 * Borrowed deliberately from `bottle-size.ts` (`MIN_BOTTLE_ML` 20,
 * `MAX_BOTTLE_ML` 30_000) rather than re-argued: the two files are reading the
 * same physical object and a second pair of bounds would be a second answer.
 */
export const MIN_IDENTITY_SIZE_ML = 20;
export const MAX_IDENTITY_SIZE_ML = 30_000;

/** A vintage this register will read as a year rather than as noise. */
const MIN_VINTAGE = 1800;
const MAX_VINTAGE = 2100;

/**
 * Read the four parts, or refuse.
 *
 * THE THREE-VALUED VINTAGE. `"nv"` is an assertion that this bottle carries no
 * vintage — true of most spirits and much Champagne, and a real, different
 * bottle from a vintage-dated one. `"unstated"` is the source's silence. They
 * are different keys on purpose: collapsing them turns "we did not read it"
 * into "the bottle does not have one", which is this repo's standing fault in
 * one line.
 */
export function readIdentity(input: IdentityInput): IdentityReading {
  const producerNormalised = normalizeIdentityText(
    typeof input.producer === "string" ? input.producer : null,
  );
  const nameNormalised = normalizeIdentityText(
    typeof input.name === "string" ? input.name : null,
  );

  if (!nameNormalised) {
    return {
      ok: false,
      reason: "no_name",
      note: "An identity with no name would collect every unnamed bottle in the estate into one key.",
    };
  }
  if (!producerNormalised) {
    return {
      ok: false,
      reason: "no_producer",
      note: "The candidate generator blocks on the producer; an identity without one can never be proposed against anything, and would sit in the register unmatchable.",
    };
  }

  let vintageText: string;
  const rawVintage = input.vintage;
  if (rawVintage === null || rawVintage === undefined || rawVintage === "") {
    vintageText = "unstated";
  } else {
    const s = String(rawVintage).trim().toLowerCase();
    if (s === "nv" || s === "non-vintage" || s === "non vintage") {
      vintageText = "nv";
    } else if (s === "unstated" || s === "unknown") {
      vintageText = "unstated";
    } else if (/^\d{4}$/.test(s)) {
      const y = Number(s);
      if (y < MIN_VINTAGE || y > MAX_VINTAGE) {
        return {
          ok: false,
          reason: "vintage_not_a_year",
          note: `"${s}" is four digits but not a year this register will read as one (${MIN_VINTAGE}-${MAX_VINTAGE}). A lot code read as a vintage is a wrong bottle, not a missing field.`,
        };
      }
      vintageText = s;
    } else {
      return {
        ok: false,
        reason: "vintage_not_a_year",
        note: `"${s}" is neither a four-digit year nor "nv". Nothing here guesses which it meant.`,
      };
    }
  }

  let sizeMl: number | null = null;
  if (input.sizeMl !== null && input.sizeMl !== undefined) {
    const n = Number(input.sizeMl);
    if (
      !Number.isFinite(n) ||
      n < MIN_IDENTITY_SIZE_ML ||
      n > MAX_IDENTITY_SIZE_ML
    ) {
      return {
        ok: false,
        reason: "size_not_positive",
        note: `A stated size of ${String(input.sizeMl)} ml is outside ${MIN_IDENTITY_SIZE_ML}-${MAX_IDENTITY_SIZE_ML}. Iowa publishes 11 rows at bottle_volume_ml = 0; a zero here would become a division nobody can defend.`,
      };
    }
    sizeMl = Math.round(n);
  }

  let pack: number | null = null;
  if (input.pack !== null && input.pack !== undefined) {
    const n = Number(input.pack);
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
      return {
        ok: false,
        reason: "pack_not_positive",
        note: `A stated pack of ${String(input.pack)} is not a whole number of bottles.`,
      };
    }
    pack = n;
  }

  return { ok: true, producerNormalised, nameNormalised, vintageText, sizeMl, pack };
}

/**
 * The comparison key.
 *
 * MUST stay byte-identical to the `identity_key` GENERATED column in
 * `supabase/migrations/20260905140000_a_bottle_has_one_identity.sql`. The
 * migration's own `DO $$` block asserts one worked example against this format
 * so a drift fails at apply time rather than at read time, and
 * `beverage-identity.spec.ts` asserts the same string from this side.
 *
 * `size?` and `pack?` rather than an empty segment: an unstated part must be
 * VISIBLE in the key. An empty segment would make "750 ml, pack unstated" and
 * "size unstated, pack 750" indistinguishable to a person reading a log line,
 * which is the only place this key is ever read by a person.
 */
export function buildIdentityKey(parts: IdentityParts): string {
  return [
    parts.producerNormalised,
    parts.nameNormalised,
    parts.vintageText,
    parts.sizeMl === null ? "size?" : String(parts.sizeMl),
    parts.pack === null ? "pack?" : String(parts.pack),
  ].join("|");
}

/** How a person should see this identity. */
export function identityDisplayLabel(
  input: IdentityInput,
  parts: IdentityParts,
): string {
  const base =
    wineDisplayLabel({
      producer: input.producer ?? null,
      name: input.name ?? null,
      vintage: parts.vintageText === "nv" || parts.vintageText === "unstated"
        ? null
        : parts.vintageText,
    }) ?? parts.nameNormalised;

  const format: string[] = [];
  if (parts.sizeMl !== null) format.push(`${parts.sizeMl}ml`);
  if (parts.pack !== null && parts.pack > 1) format.push(`x${parts.pack}`);
  return format.length ? `${base} (${format.join(" ")})` : base;
}

// ---------------------------------------------------------------------------
// GTIN
// ---------------------------------------------------------------------------

export interface GtinReading {
  ok: true;
  /** The 14-digit form, zero-padded. GS1's own canonical storage form. */
  gtin14: string;
  /** 8 / 12 / 13 / 14 — what the source actually printed. */
  sourceLength: 8 | 12 | 13 | 14;
}
export interface GtinRefusal {
  ok: false;
  reason: "empty" | "not_digits" | "bad_length" | "check_digit";
  note: string;
}

/**
 * Normalise a barcode to GTIN-14, verifying the check digit.
 *
 * WHY THE CHECK DIGIT IS VERIFIED AND NOT JUST STORED. A GTIN's last digit is
 * a modulo-10 check over the others; it exists so a mis-keyed or mis-scanned
 * code is caught at entry. Storing an unverified code would put a key in the
 * register that can never match anything and cannot be told apart from a code
 * nobody has yet seen — the register would say "no price found elsewhere" for
 * a typo, which is the wrong sentence.
 *
 * AND IT EARNS ITS KEEP, MEASURED. Run over the live Iowa file of 2026-09-05:
 * all 13,762 `upc` values pass this check — and the same file's `scc` column
 * has 10,201 values of which **540 fail it**, across only **8 distinct values**
 * (one, `10083664874139`, is published on 6,923 different products). So the
 * check digit is exactly what separates the column Iowa maintains from the
 * column it does not. Note the other half of the same measurement: being
 * well-formed is not being unique. All 13,762 UPCs are valid and 1,736 of the
 * 9,118 distinct ones still name more than one product.
 *
 * WHY GTIN-14 IS THE STORAGE FORM. GS1 identifies each level of a trade item
 * hierarchy separately — *"Each item at the different levels is given a GTIN.
 * Trade Item Information is sent for every GTIN, since they have different
 * attributes"* (GS1 Sweden, fetched 2026-09-05,
 * https://gs1.se/en/support/what-are-trade-item-hierarchies-and-trade-item-levels-2/)
 * — and the 14-digit form is the one that can hold a case as well as a bottle.
 * Padding a UPC-A to 14 makes "the same code printed on the bottle" one string
 * rather than three, so a Iowa `upc` and a case `scc` compare without a join
 * rule per length.
 */
export function normaliseGtin(raw: string | null | undefined): GtinReading | GtinRefusal {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, reason: "empty", note: "No code given." };
  if (!/^\d+$/.test(s)) {
    return {
      ok: false,
      reason: "not_digits",
      note: `"${s}" is not all digits. A GTIN is digits only; anything else is a SKU and belongs in a source-local namespace.`,
    };
  }
  const len = s.length;
  if (len !== 8 && len !== 12 && len !== 13 && len !== 14) {
    return {
      ok: false,
      reason: "bad_length",
      note: `A GTIN is 8, 12, 13 or 14 digits; this is ${len}.`,
    };
  }
  const gtin14 = s.padStart(14, "0");
  if (!gtinCheckDigitValid(gtin14)) {
    return {
      ok: false,
      reason: "check_digit",
      note: `"${s}" fails its own GS1 check digit, so it is a mis-typed or mis-read code. It is refused rather than stored as a key that can never match.`,
    };
  }
  return { ok: true, gtin14, sourceLength: len as 8 | 12 | 13 | 14 };
}

/** Modulo-10 over the first 13 digits, weights 3 and 1 alternating from the right. */
export function gtinCheckDigitValid(gtin14: string): boolean {
  if (!/^\d{14}$/.test(gtin14)) return false;
  const digits = gtin14.split("").map(Number);
  const check = digits[13];
  let sum = 0;
  // Position 12 (0-indexed) is the rightmost payload digit and weighs 3.
  for (let i = 12; i >= 0; i -= 1) {
    const weight = (12 - i) % 2 === 0 ? 3 : 1;
    sum += digits[i] * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

// ---------------------------------------------------------------------------
// LWIN
// ---------------------------------------------------------------------------

export interface LwinReading {
  ok: true;
  form: 7 | 11 | 16 | 18;
  /** The wine itself — producer and brand/vineyard. */
  lwin7: string;
  /** Present on 11/16/18. `null` when the form does not carry one. */
  vintageText: string | null;
  /** Present on 18 only. */
  pack: number | null;
  /** Present on 16 and 18. Millilitres, five digits in the code. */
  sizeMl: number | null;
}
export interface LwinRefusal {
  ok: false;
  reason: "empty" | "not_digits" | "bad_length" | "implausible_part";
  note: string;
}

/**
 * Read an LWIN into the same four parts this register keys on.
 *
 * THE FORMS. LWIN-7 is the wine (six digits plus a check digit). The longer
 * forms append vintage, then pack, then bottle size in millilitres zero-padded
 * to five: LWIN-11 = 7 + vintage(4); LWIN-16 = 7 + vintage(4) + size(5);
 * LWIN-18 = 7 + vintage(4) + pack(2) + size(5).
 *
 * WHERE THAT COMES FROM, AND WHAT IS NOT PROVEN. Liv-ex's own LWIN page
 * (https://www.liv-ex.com/lwin/, fetched 2026-09-05, 147,184 bytes) states the
 * licence and the size of the database and does NOT publish the digit
 * structure; the "common language for fine wine" post that used to carry it
 * now 301s to that page. The decomposition above is therefore recorded from
 * SECONDARY sources read the same day (Wikipedia's Liv-ex article; the
 * Wine-Searcher LWIN integration coverage) and is flagged as unverified
 * against a Liv-ex document. Nothing in this repo mints an LWIN — the code is
 * only ever read from a source that already carries one — so the cost of the
 * structure being wrong is a refused read, not a wrong price.
 *
 * THE CHECK DIGIT IS NOT VERIFIED. Liv-ex does not publish the algorithm, and
 * a check we invented would reject valid codes. `normaliseGtin` verifies its
 * check digit because GS1 publishes that one; this one is stored as read, and
 * this comment is why the two differ.
 */
export function parseLwin(raw: string | null | undefined): LwinReading | LwinRefusal {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, reason: "empty", note: "No code given." };
  if (!/^\d+$/.test(s)) {
    return { ok: false, reason: "not_digits", note: `"${s}" is not all digits.` };
  }
  const len = s.length;
  if (len !== 7 && len !== 11 && len !== 16 && len !== 18) {
    return {
      ok: false,
      reason: "bad_length",
      note: `An LWIN is 7, 11, 16 or 18 digits; this is ${len}.`,
    };
  }
  const lwin7 = s.slice(0, 7);
  if (len === 7) {
    return { ok: true, form: 7, lwin7, vintageText: null, pack: null, sizeMl: null };
  }

  const vintageDigits = s.slice(7, 11);
  const year = Number(vintageDigits);
  // Liv-ex uses a sentinel for non-vintage wines and does not publish which
  // value it is, so an out-of-range group is read as "unstated", never as a
  // year and never as an assertion of "nv".
  const vintageText =
    year >= MIN_VINTAGE && year <= MAX_VINTAGE ? vintageDigits : "unstated";

  if (len === 11) {
    return { ok: true, form: 11, lwin7, vintageText, pack: null, sizeMl: null };
  }
  if (len === 16) {
    const sizeMl = Number(s.slice(11, 16));
    if (sizeMl < MIN_IDENTITY_SIZE_ML || sizeMl > MAX_IDENTITY_SIZE_ML) {
      return {
        ok: false,
        reason: "implausible_part",
        note: `The size group of "${s}" reads ${sizeMl} ml, outside ${MIN_IDENTITY_SIZE_ML}-${MAX_IDENTITY_SIZE_ML}.`,
      };
    }
    return { ok: true, form: 16, lwin7, vintageText, pack: null, sizeMl };
  }

  const pack = Number(s.slice(11, 13));
  const sizeMl = Number(s.slice(13, 18));
  if (pack < 1) {
    return {
      ok: false,
      reason: "implausible_part",
      note: `The pack group of "${s}" reads ${pack}, which is not a number of bottles.`,
    };
  }
  if (sizeMl < MIN_IDENTITY_SIZE_ML || sizeMl > MAX_IDENTITY_SIZE_ML) {
    return {
      ok: false,
      reason: "implausible_part",
      note: `The size group of "${s}" reads ${sizeMl} ml, outside ${MIN_IDENTITY_SIZE_ML}-${MAX_IDENTITY_SIZE_ML}.`,
    };
  }
  return { ok: true, form: 18, lwin7, vintageText, pack, sizeMl };
}

/**
 * The attribution a row derived from the LWIN database must carry.
 *
 * Liv-ex publishes the database under CC BY 4.0
 * (https://www.liv-ex.com/lwin/lwin-creative-commons/, read 2026-09-05:
 * *"You must give appropriate credit, provide a link to the license, and
 * indicate if changes were made"*). Iowa's CC BY 4.0 attribution is carried on
 * the row in the sibling register for the same reason; this is the same rule,
 * not a new one.
 */
export const LWIN_ATTRIBUTION =
  "Wine identification data from the LWIN database, Liv-ex Ltd, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified: mapped to Mudavym beverage identities.";
