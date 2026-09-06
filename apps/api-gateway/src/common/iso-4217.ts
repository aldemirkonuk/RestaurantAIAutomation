/**
 * Which three-letter codes are actually CURRENCIES, for the whole gateway.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS: "ZZZ" WAS ACCEPTED AS MONEY
 * ---------------------------------------------------------------------------
 * Every currency gate in this gateway checked `/^[A-Z]{3}$/` and called it "ISO
 * 4217". That regex says a string is three capitals. It does not say the string
 * names a currency. Measured against `356ffdfa` on 2026-09-06:
 *
 *   filingCurrency({ fileStated: "ZZZ", houseStated: "TRY", fileField: "CUR02" })
 *     => { kind: "file", code: "ZZZ", from: "the document's own CUR02" }
 *   seenCodes({ code: "ZZZ", asPrinted: "ZZZ", where: "x" }) => ["ZZZ"]
 *
 * An invoice's whole total was therefore filed under a denomination that does
 * not exist, silently, with no hold and no warning — through the exact gate the
 * currency rules were built to be. The migration's own in-file probe wrote
 * `XTS` and `XTT` (ISO's reserved TEST codes) past the table's CHECK for the
 * same reason. Shape is not membership, and a check that cannot tell them apart
 * reports the absence of a currency as the presence of one — the
 * [[absence-reported-as-health]] fault aimed at money.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE CODES COME FROM, AND WHY THEY ARE COPIED
 * ---------------------------------------------------------------------------
 * The web already holds the list: `apps/web/src/lib/currency.ts` is what the
 * sign-up currency step, the house-currency control and the agreement sheet
 * offer, and its `CURRENCY_NAMES` is one row per code the product will show a
 * person. The gateway CANNOT import it — the two apps are separate builds with
 * no shared package between them, and the web must not import the gateway
 * either — so the set is COPIED here.
 *
 * A copy is a second thing to keep true, and three files in this repo argued in
 * writing that copying it would be worse than not checking membership at all
 * (`settings/house-currency.service.ts` rule 2, `settings/dto/house-currency
 * .dto.ts`, `auth/dto/register-restaurant.dto.ts`). Those comments have been
 * corrected, because the argument had a hole: a list that cannot drift is not a
 * second table. `iso-4217.spec.ts` reads `apps/web/src/lib/currency.ts` AS TEXT
 * and fails if the two sets differ by one code in either direction — the same
 * mirror `scripts/check_web_reads_gateway_dto_keys.py` enforces for DTO keys.
 * Adding a currency is one edit in the web table and one here, and the suite is
 * red until both are made.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS LIST IS NOT
 * ---------------------------------------------------------------------------
 * It is NOT all of ISO 4217. ISO publishes roughly 180 active codes; this holds
 * 96 — one per country in `apps/web/src/lib/countries.ts` that has a currency.
 * The CFA francs (XOF, XAF), the East Caribbean dollar (XCD), the Hong Kong
 * dollar (HKD) and around eighty others are absent, and an invoice denominated
 * in one of them has its money HELD with a sentence naming the code rather than
 * filed. That is a real cost and it is deliberate: a held invoice says so on
 * the screen and is cleared by one manager action, while a code nobody can
 * check is filed as real money and is never noticed. Adding a code is a
 * one-line edit to the country table with a source. It is filed as a founder
 * question rather than smoothed over.
 *
 * NOTHING HERE CONVERTS ANYTHING. There is no exchange rate in this system and
 * this file does not introduce one; it answers exactly one question, which is
 * whether a string names a currency.
 */

/**
 * Every code this gateway will accept as money.
 *
 * Sorted, 96 entries, copied 2026-09-06 from `CURRENCY_NAMES` in
 * `apps/web/src/lib/currency.ts` (itself derived from `lib/countries.ts`, ISO
 * 4217 list A1 as published by SIX Financial Information for ISO). Kept sorted
 * so a diff that adds one is one line.
 */
export const ISO_4217_CODES: readonly string[] = [
  "AED", "AFN", "ALL", "AMD", "AOA", "ARS", "AUD", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BND", "BOB", "BRL",
  "BWP", "BYN", "BZD", "CAD", "CHF", "CLP", "CNY", "COP",
  "CRC", "CUP", "CZK", "DKK", "DOP", "DZD", "EGP", "ETB",
  "EUR", "FJD", "GBP", "GEL", "GHS", "GTQ", "HNL", "HUF",
  "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD",
  "JPY", "KES", "KHR", "KRW", "KWD", "KZT", "LBP", "LKR",
  "LYD", "MAD", "MDL", "MKD", "MNT", "MXN", "MYR", "NGN",
  "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PHP",
  "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "SAR",
  "SEK", "SGD", "THB", "TND", "TRY", "TWD", "TZS", "UAH",
  "UGX", "USD", "UYU", "UZS", "VES", "VND", "ZAR", "ZMW",
];

/** O(1) membership. Built once; never mutated. */
const MEMBERS: ReadonlySet<string> = new Set(ISO_4217_CODES);

/** The shape a code has to have before membership is even asked. */
const ALPHA3 = /^[A-Z]{3}$/;

/**
 * Does this string NAME a currency?
 *
 * Trims and folds case first, so `" try "` and `"TRY"` answer the same. That
 * folding is the only normalisation performed anywhere in this file: `"$"`,
 * `"US Dollars"` and `"usd "` are three ways of nearly saying a currency and
 * none of them becomes one here.
 */
export function isIso4217(code: unknown): boolean {
  if (typeof code !== "string") return false;
  return MEMBERS.has(code.trim().toUpperCase());
}

/**
 * The code, normalised — or `null` when the value does not name a currency.
 *
 * The one function most callers want: it collapses "not a string", "not three
 * letters" and "three letters that are not a currency" into the single answer
 * every writer needs, which is that there is nothing here to record.
 * A caller that has to TELL somebody why uses `notACurrencyBecause` beside it.
 */
export function currencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return MEMBERS.has(code) ? code : null;
}

/**
 * Why a value is not a currency, naming the value.
 *
 * A refusal that does not repeat what it refused makes a person guess which of
 * the fields they filled in was wrong. The three cases get three sentences
 * because a person acts on them differently: nothing was sent, the wrong SHAPE
 * was sent, or a well-formed code this gateway does not hold was sent — and
 * only the third one might mean the LIST is wrong rather than the input.
 *
 * The caller appends the consequence ("nothing was recorded", "the money was
 * refused"), because that differs per route and a shared sentence that guessed
 * it would be wrong somewhere.
 */
export function notACurrencyBecause(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "")
    return "No currency was sent. An ISO 4217 alpha-3 code in capitals is what names money here — TRY, EUR, GBP.";

  const raw = value.trim();
  const code = raw.toUpperCase();
  if (!ALPHA3.test(code))
    return (
      `${JSON.stringify(raw)} is not a currency: an ISO 4217 code is exactly ` +
      `three letters, and "$", "usd" and "US Dollars" are three ways of nearly ` +
      `saying one. Send the three-letter code — TRY, EUR, GBP.`
    );

  return (
    `${code} is not a currency: it is three letters, but no currency is ` +
    `published under that code, so nothing can be denominated in it. This ` +
    `gateway holds ${ISO_4217_CODES.length} codes, mirrored from the list the ` +
    `product's own currency picker offers (apps/web/src/lib/currency.ts). If ` +
    `${code} is a real currency this house trades in, it is missing from that ` +
    `list and adding it is a one-line change — say so rather than working ` +
    `around it.`
  );
}
