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

function webCurrencyCodes(): string[] {
  const source = readFileSync(WEB_CURRENCY_FILE, "utf8");

  // The table is `const CURRENCY_NAMES: Readonly<Record<string, string>> = {…}`.
  // Anchored on the declaration and closed on the first line that is a bare
  // `}`, so a later object in the file cannot leak codes in.
  const start = source.indexOf("const CURRENCY_NAMES");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  const table = source.slice(start, end);

  const codes = new Set<string>();
  for (const m of table.matchAll(/\b([A-Z]{3}):\s*'/g)) codes.add(m[1]);
  return [...codes].sort();
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
    expect(webCurrencyCodes().length).toBeGreaterThan(90);
    expect(ISO_4217_CODES.length).toBe(96);
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
