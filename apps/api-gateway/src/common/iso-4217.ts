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
 * offer, and its `CURRENCIES` is one row per code the product will show a
 * person — with the name and the MINOR-UNIT count its formatter needs, which is
 * the half a gateway does not care about and a screen cannot print without.
 * The gateway CANNOT import it — the two apps are separate builds with no
 * shared package between them — so the set is COPIED here. (This sentence used
 * to add "and the web must not import the gateway either". Since 2026-09-11 one
 * production web file does: `ReceivingWorkspace.tsx` imports the receiving
 * refusal's shared sentence from `procurement/price-currency.ts`, which imports
 * this file, so the web build resolves both. It builds because Vercel builds the
 * web from the monorepo root, and it stays current only because
 * `scripts/vercel_should_build.sh` and `turbo.json` name both files as inputs of
 * the web build.)
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
 * That mirror is the reason widening this list did not have to widen the risk:
 * the founder's *"the mirror spec keeping them equal"* is the load-bearing
 * clause of batch 67, not a nicety. A 157-code list nobody checks against the
 * screen's own table is exactly the second table the old comments feared.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS LIST IS, AND WHAT IT LEAVES OUT (founder, 2026-09-06 batch 67)
 * ---------------------------------------------------------------------------
 * It held 96 codes for one day — one per country in `apps/web/src/lib/
 * countries.ts` that has a currency — and that was the wrong list. An invoice in
 * XOF, HKD, MOP, XCD or around sixty other real currencies had its money HELD
 * with a sentence naming the code, rather than filed. The founder's call:
 * *"The full active ISO 4217 list, in both tables ... A Hong Kong or Macau
 * vendor's invoice files instead of being held."*
 *
 * So this is now ISO 4217 list A1 in full — every ACTIVE currency, national and
 * supranational (XOF and XAF, the two CFA francs; XCD; XPF; XCG) — minus the
 * 22 codes in A1 that are not money a vendor can bill in:
 *
 *   precious metals    XAU XAG XPT XPD          (a gram of gold is not a price)
 *   test / no currency XTS XXX                  (XTS is RESERVED for testing;
 *                                                the migration's own probe once
 *                                                wrote it past a CHECK)
 *   bond market units  XBA XBB XBC XBD
 *   units of account   XDR XSU XUA              (IMF, SUCRE, ADB — settlement
 *                                                units between institutions)
 *   funds codes        BOV CHE CHW CLF COU
 *                      MXV USN UYI UYW          (index-linked accounting units;
 *                                                CLF and UYW carry FOUR minor
 *                                                units, which is itself a sign
 *                                                they are not shelf prices)
 *
 * 157 + those 22 is the ~180 the founder named. A code left out here is left
 * out because nothing is ever INVOICED in it; a currency left out would be a
 * defect, and adding one is a two-line change (here and the web table) that the
 * mirror spec forces you to make on both sides at once.
 *
 * WITHDRAWN CODES ARE REFUSED, BY DECISION. HRK (euro, 2023), CUC (2021), SLL
 * (superseded by SLE), ZWL (superseded by ZWG), MRO, STD, VEF and the other
 * retired codes are absent, so paper old enough to name one is HELD rather than
 * filed. This began as a builder's judgement on 2026-09-06 and is now the
 * founder's own call: asked on 2026-09-11 (batch 69) to confirm the policy, he
 * answered *"Keep as built; a held old code is a bug report, not a list
 * entry"*. So a held invoice naming a withdrawn code is a defect to look into --
 * the paper, the vendor, the extraction -- and never a reason to add the code
 * back here: a list that grows every time old paper arrives is a list that
 * never shrinks. ANG is the one transitional code kept — XCG replaced it for
 * Curacao and Sint Maarten, and invoices predating the changeover still say ANG
 * — and VED and VES are both listed because ISO lists both.
 *
 * NOTHING HERE CONVERTS ANYTHING. There is no exchange rate in this system and
 * this file does not introduce one; it answers exactly one question, which is
 * whether a string names a currency.
 */

/**
 * Every code this gateway will accept as money.
 *
 * Sorted, 157 entries, mirrored 2026-09-06 against `CURRENCIES` in
 * `apps/web/src/lib/currency.ts` (ISO 4217 list A1 as published by SIX
 * Financial Information for ISO, active codes only). Kept sorted so a diff that
 * adds one is one line.
 */
export const ISO_4217_CODES: readonly string[] = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD",
  "AWG", "AZN", "BAM", "BBD", "BDT", "BGN", "BHD", "BIF",
  "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN",
  "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC",
  "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP",
  "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS",
  "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG",
  "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD",
  "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW",
  "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL",
  "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP",
  "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD",
  "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN",
  "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD",
  "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD",
  "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP",
  "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD",
  "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VED",
  "VES", "VND", "VUV", "WST", "XAF", "XCD", "XCG", "XOF",
  "XPF", "YER", "ZAR", "ZMW", "ZWG",
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
    `${code} is not a currency: it is three letters, but no ACTIVE currency is ` +
    `published under that code, so nothing can be denominated in it. This ` +
    `gateway holds all ${ISO_4217_CODES.length} active ISO 4217 currencies, ` +
    `mirrored from the list the product's own currency picker offers ` +
    `(apps/web/src/lib/currency.ts) — so a code refused here is a withdrawn ` +
    `currency (HRK, CUC, ZWL), a non-currency code (XAU, XDR, a funds code) or ` +
    `a typo. If ${code} is real money this house is billed in, it is missing ` +
    `from that list and adding it is a one-line change — say so rather than ` +
    `working around it.`
  );
}

/**
 * The currencies whose minor unit is not two — ISO 4217's own counts, the same
 * ones `apps/web/src/lib/currency.ts` carries per row (`minor`). The mirror spec
 * reads that table and fails on a one-code difference, as it does for the codes.
 *
 * Needed here for one job (F-452): ROUNDING money before it is written. A flat
 * `Math.round(x * 100) / 100` turned a 1.255 BHD agreement into 1.26, which is
 * a different amount from the invoice, and kept two places on yen that have none.
 */
const MINOR_0: ReadonlySet<string> = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const MINOR_3: ReadonlySet<string> = new Set([
  "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
]);

/** How many decimal places this money HAS, or `null` for a code this gateway does not hold. */
export function currencyMinorUnits(code: unknown): 0 | 2 | 3 | null {
  const c = currencyCode(code);
  if (c === null) return null;
  return MINOR_0.has(c) ? 0 : MINOR_3.has(c) ? 3 : 2;
}

/**
 * An amount rounded to its currency's own minor unit — three places for a
 * dinar, none for yen or dong, two otherwise.
 *
 * A missing or unknown currency rounds to two, which is exactly what every
 * writer did before this existed, so an order that names no currency keeps the
 * figure it always had. The arithmetic for two places is the old one, byte for
 * byte (`10 ** 2 === 100`).
 */
export function roundMoney(
  amount: number,
  currency: unknown,
  /**
   * Never fewer places than this. A UNIT price is not an amount anyone pays:
   * 1,000 yen a case is 83.33 a bottle, and rounding that to the yen's zero
   * places would lose a third of a yen on every bottle of the series. Pass 2
   * for a unit price; an amount (a total, a fee) passes nothing.
   */
  minDigits = 0,
): number {
  const scale = 10 ** Math.max(currencyMinorUnits(currency) ?? 2, minDigits);
  return Math.round(amount * scale) / scale;
}
