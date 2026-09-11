import { readFileSync } from "fs";
import { resolve } from "path";
import {
  ISO_4217_CODES,
  currencyCode,
  isIso4217,
  notACurrencyBecause,
} from "./iso-4217";

/**
 * THE MIRROR. The gateway's currency list is a COPY of the web's, and this is
 * what stops the copy from becoming a second, quietly different, table.
 *
 * It reads `apps/web/src/lib/currency.ts` AS TEXT rather than importing it: the
 * two apps are separate builds, the gateway's tsconfig does not reach into
 * `apps/web`, and an import would make the gateway's compile depend on the
 * browser bundle. Text is also the stricter check — it fails on a code that was
 * added to the file, whether or not the web's own build would have used it.
 *
 * The same shape `scripts/check_web_reads_gateway_dto_keys.py` uses in the
 * other direction for DTO keys, and for the same reason: a duplicated fact is
 * only safe when a machine fails on the divergence.
 */
const WEB_CURRENCY_FILE = resolve(
  __dirname,
  "../../../../apps/web/src/lib/currency.ts",
);

/** One row of the web's table: the code, its name and its minor-unit count. */
interface WebCurrencyRow {
  code: string;
  name: string;
  minor: number;
}

function webCurrencyRows(): WebCurrencyRow[] {
  const source = readFileSync(WEB_CURRENCY_FILE, "utf8");

  // The table is
  // `const CURRENCIES: Readonly<Record<string, CurrencyRow>> = {…}`.
  // Anchored on the declaration and closed on the first line that is a bare
  // `}`, so a later object in the file cannot leak codes in.
  const start = source.indexOf("const CURRENCIES");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  const table = source.slice(start, end);

  const rows: WebCurrencyRow[] = [];
  for (const m of table.matchAll(
    /\b([A-Z]{3}):\s*\{\s*name:\s*'([^']+)',\s*minor:\s*(\d)\s*\}/g,
  ))
    rows.push({ code: m[1], name: m[2], minor: Number(m[3]) });
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

function webCurrencyCodes(): string[] {
  return webCurrencyRows().map((r) => r.code);
}

describe("the gateway's currency list mirrors the web's, exactly", () => {
  it("holds the same codes as apps/web/src/lib/currency.ts, in both directions", () => {
    const web = webCurrencyCodes();
    const gateway = [...ISO_4217_CODES].sort();

    // Named both ways so a failure SAYS which side gained or lost a code
    // rather than printing two ninety-line arrays and leaving a reader to
    // diff them by eye.
    const onlyInWeb = web.filter((c) => !ISO_4217_CODES.includes(c));
    const onlyInGateway = gateway.filter((c) => !web.includes(c));
    expect({ onlyInWeb, onlyInGateway }).toEqual({
      onlyInWeb: [],
      onlyInGateway: [],
    });
    expect(gateway).toEqual(web);
  });

  it("reads a real table, not an empty match", () => {
    // A regex that silently matched nothing would make the assertion above
    // pass against an empty set on both sides the day the web file is
    // reformatted. The count is asserted so the mirror cannot go green by
    // finding nothing.
    //
    // 157 is ISO 4217 list A1's active codes MINUS the 22 that are not money a
    // vendor bills in (metals, test, bond units, units of account, funds) —
    // the arithmetic behind the founder's "about 180", batch 67. Updated from
    // a run, never by hand.
    expect(webCurrencyCodes().length).toBeGreaterThan(150);
    expect(ISO_4217_CODES.length).toBe(157);
  });

  it("carries a name and a minor-unit count for every code, so money prints right", () => {
    // The gateway does not need these — a screen does, and the screen's table
    // is this one. A row added here with no name, or with the default two
    // decimals on a currency that has none, prints a wrong AMOUNT rather than
    // a wrong label: 1200 JPY as `1,200.00`, a 1.500 BHD line as `1.50`.
    const rows = webCurrencyRows();
    expect(rows.map((r) => r.code)).toEqual([...ISO_4217_CODES].sort());
    expect(rows.filter((r) => r.name.trim() === "")).toEqual([]);
    expect([...new Set(rows.map((r) => r.minor))].sort()).toEqual([0, 2, 3]);

    // The seven three-decimal currencies and a sample of the zero-decimal ones,
    // spot-checked against the published standard rather than against the file
    // that would be wrong.
    const minor = new Map(rows.map((r) => [r.code, r.minor]));
    for (const code of ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"])
      expect(`${code}=${minor.get(code)}`).toBe(`${code}=3`);
    for (const code of ["JPY", "KRW", "VND", "CLP", "ISK", "XOF", "XAF", "XPF"])
      expect(`${code}=${minor.get(code)}`).toBe(`${code}=0`);
    for (const code of ["USD", "TRY", "HKD", "MOP", "XCD"])
      expect(`${code}=${minor.get(code)}`).toBe(`${code}=2`);
  });

  it("holds no funds, metal, test or unit-of-account code", () => {
    // The 22 codes ISO publishes in A1 that are not money a vendor can bill in.
    // Listed rather than described, because "we excluded the special ones" is
    // not something a later reader can check.
    const NOT_MONEY = [
      "XAU", "XAG", "XPT", "XPD", // metals
      "XTS", "XXX", // test, and "no currency"
      "XBA", "XBB", "XBC", "XBD", // bond market units
      "XDR", "XSU", "XUA", // units of account
      "BOV", "CHE", "CHW", "CLF", "COU", "MXV", "USN", "UYI", "UYW", // funds
    ];
    expect(NOT_MONEY.length).toBe(22);
    expect(NOT_MONEY.filter((c) => isIso4217(c))).toEqual([]);
  });

  it("holds no WITHDRAWN currency, so old paper is held rather than read as live money", () => {
    for (const gone of ["HRK", "CUC", "SLL", "ZWL", "MRO", "STD", "VEF", "BYR"])
      expect(`${gone}:${isIso4217(gone)}`).toBe(`${gone}:false`);
    // ...and their live replacements ARE here.
    for (const live of ["SLE", "ZWG", "MRU", "STN", "VES", "BYN", "EUR"])
      expect(`${live}:${isIso4217(live)}`).toBe(`${live}:true`);
  });

  it("is sorted and free of duplicates, so a diff that adds one is one line", () => {
    expect([...ISO_4217_CODES]).toEqual([...ISO_4217_CODES].sort());
    expect(new Set(ISO_4217_CODES).size).toBe(ISO_4217_CODES.length);
  });
});

describe("isIso4217 — membership, not shape", () => {
  it("admits a real code", () => {
    expect(isIso4217("TRY")).toBe(true);
    expect(isIso4217("EUR")).toBe(true);
    expect(isIso4217("USD")).toBe(true);
  });

  it("REFUSES a well-formed code that is not a currency", () => {
    // The whole reason this file exists. `/^[A-Z]{3}$/` said yes to every one
    // of these, and the first was filed as money against a live document.
    expect(isIso4217("ZZZ")).toBe(false);
    expect(isIso4217("XTS")).toBe(false);
    expect(isIso4217("XTT")).toBe(false);
    expect(isIso4217("ABC")).toBe(false);
  });

  it("ADMITS the currencies the 96-code list refused", () => {
    // Founder, 2026-09-06 batch 67: "A Hong Kong or Macau vendor's invoice
    // files instead of being held." These three were the named cost of the
    // narrow list — HKD and MOP have no country row in `lib/countries.ts`, and
    // XOF is one currency across eight countries, so a per-country table can
    // never reach it. The pair with the test above is the point: widening the
    // list did not weaken the refusal.
    expect(isIso4217("HKD")).toBe(true);
    expect(isIso4217("MOP")).toBe(true);
    expect(isIso4217("XOF")).toBe(true);
    expect(isIso4217("ZZZ")).toBe(false);
    expect(isIso4217("XTS")).toBe(false);
  });

  it("refuses the wrong shape and the wrong type", () => {
    expect(isIso4217("TL")).toBe(false);
    expect(isIso4217("$")).toBe(false);
    expect(isIso4217("US Dollars")).toBe(false);
    expect(isIso4217("")).toBe(false);
    expect(isIso4217(null)).toBe(false);
    expect(isIso4217(undefined)).toBe(false);
    expect(isIso4217(978)).toBe(false);
  });

  it("folds case and whitespace, and nothing else", () => {
    expect(isIso4217(" try ")).toBe(true);
    expect(isIso4217("eur")).toBe(true);
    expect(isIso4217("t r y")).toBe(false);
  });
});

describe("currencyCode — the normalised code, or nothing", () => {
  it("returns the code in capitals", () => {
    expect(currencyCode(" try ")).toBe("TRY");
  });

  it("returns null for a well-formed non-currency", () => {
    expect(currencyCode("ZZZ")).toBeNull();
    expect(currencyCode("XTS")).toBeNull();
  });

  it("returns null for junk", () => {
    expect(currencyCode("$")).toBeNull();
    expect(currencyCode(null)).toBeNull();
    expect(currencyCode({})).toBeNull();
  });
});

describe("notACurrencyBecause — the refusal names what it refused", () => {
  it("names a well-formed fake code and says it is not a currency", () => {
    const s = notACurrencyBecause("ZZZ");
    expect(s).toContain("ZZZ is not a currency");
    // The person is told which way the fault could run: their input, or our
    // list. A refusal that only blames the caller hides a missing code.
    expect(s).toContain("apps/web/src/lib/currency.ts");
  });

  it("distinguishes the wrong shape from a fake code", () => {
    expect(notACurrencyBecause("TL")).toContain("exactly");
    expect(notACurrencyBecause("TL")).toContain('"TL"');
    expect(notACurrencyBecause("ZZZ")).not.toContain("exactly three letters");
  });

  it("says nothing was sent when nothing was", () => {
    expect(notACurrencyBecause("")).toContain("No currency was sent");
    expect(notACurrencyBecause(null)).toContain("No currency was sent");
  });
});
