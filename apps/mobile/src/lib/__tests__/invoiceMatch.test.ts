/**
 * The receiving preview prints money in its own currency and never claims a
 * price match across two currencies. It used to print "$" for every invoice
 * (a TRY invoice read "$12.00"), and called a TRY 10.00 bill "the stated
 * prices match" against an order agreed at EUR 10.00.
 *
 * `invoiceMatch` imports the design tokens for its verdict colours; they are
 * plain values, so this suite needs no renderer.
 */
jest.mock("@/design/tokens", () => ({ color: new Proxy({}, { get: () => "#000" }) }));

import { computeMatch, currencyCode, money, sameMoney } from "@/lib/invoiceMatch";

describe("money says its own currency", () => {
  it("prints the stated code, never a dollar sign it was not given", () => {
    expect(money(12, "TRY")).toBe("TRY 12.00");
    expect(money(12, "eur")).toBe("EUR 12.00");
    expect(money(12, "USD")).toBe("USD 12.00");
    for (const c of ["TRY", "EUR", null, undefined, ""]) {
      expect(money(3.5, c)).not.toMatch(/\$/);
    }
  });

  it("an unstated currency is said, not borrowed", () => {
    expect(money(12, null)).toBe("12.00 (currency not stated)");
    expect(money(12, undefined)).toBe("12.00 (currency not stated)");
    expect(money(12, "$")).toBe("12.00 (currency not stated)");
    expect(currencyCode(" try ")).toBe("TRY");
    expect(currencyCode("lira")).toBeNull();
  });

  it("two prices sit side by side only in one currency, or when one is unstated", () => {
    expect(sameMoney("TRY", "TRY")).toBe(true);
    expect(sameMoney("TRY", null)).toBe(true);
    expect(sameMoney("TRY", "EUR")).toBe(false);
  });
});

describe("the match preview never compares two currencies as one", () => {
  const base = { orderedQty: 12, invoiceQty: 12, acceptedQty: 12 };

  it("equal figures in the same currency are a verified price", () => {
    const r = computeMatch({
      ...base,
      poUnitPrice: 10,
      invoiceUnitPrice: 10,
      poCurrency: "TRY",
      invoiceCurrency: "TRY",
    });
    expect(r.verdict).toBe("matched");
    expect(r.priceVerified).toBe(true);
    expect(r.summary).toMatch(/the stated prices match/);
  });

  it("equal figures in two currencies are not a verified price", () => {
    const r = computeMatch({
      ...base,
      poUnitPrice: 10,
      invoiceUnitPrice: 10,
      poCurrency: "EUR",
      invoiceCurrency: "TRY",
    });
    expect(r.priceVerified).toBe(false);
    expect(r.summary).not.toMatch(/prices match/);
    expect(r.summary).toMatch(/invoice is in TRY and the order in EUR/);
  });

  it("different figures still need a reason in any currency, as the server demands", () => {
    // The gateway's computeMatch compares the figures and refuses the receipt
    // (422) without an override reason; the preview must ask for one too.
    const r = computeMatch({
      ...base,
      poUnitPrice: 10,
      invoiceUnitPrice: 12,
      poCurrency: "EUR",
      invoiceCurrency: "TRY",
    });
    expect(r.requiresOverride).toBe(true);
    expect(r.verdict).toBe("price_variance");
    expect(r.summary).toBe(
      "Billed TRY 12.00 against an agreed EUR 10.00 per bottle. The server will check the agreement and currency.",
    );
  });

  it("an order with no stated currency says so rather than taking the invoice's", () => {
    const r = computeMatch({
      ...base,
      poUnitPrice: 10,
      invoiceUnitPrice: 12,
      poCurrency: null,
      invoiceCurrency: "TRY",
    });
    expect(r.summary).toContain("agreed 10.00 (currency not stated)");
    expect(r.summary).toContain("Billed TRY 12.00");
  });
});
