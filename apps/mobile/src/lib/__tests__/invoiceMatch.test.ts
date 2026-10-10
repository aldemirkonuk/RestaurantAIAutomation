import { agreedCurrency, computeMatch, differentMoney, money } from "../invoiceMatch";

/**
 * F-341 on the phone: the receiving preview compared an agreed and a billed
 * price as bare numbers whatever money each was in, and printed both under "$".
 * The gateway now holds a cross-money price as `currency_differs`; this mirror
 * must say the same and must never ask for an override reason it cannot use.
 */
const base = {
  orderedQty: 12,
  invoiceQty: 12,
  acceptedQty: 12,
};

describe("invoiceMatch money (F-341)", () => {
  it("says each price in its own money, never a bare dollar sign", () => {
    expect(money(22, "EUR")).toBe("€22.00");
    expect(money(22, "usd")).toBe("$22.00");
    expect(money(22, null)).toBe("22.00 (currency not recorded)");
  });

  it("never compares 22 EUR against 22 TRY as a match", () => {
    const r = computeMatch({
      ...base,
      poUnitPrice: 22,
      poCurrency: "EUR",
      invoiceUnitPrice: 22,
      invoiceCurrency: "TRY",
    });
    expect(r.verdict).toBe("currency_differs");
    expect(r.priceVerified).toBe(false);
    expect(r.requiresOverride).toBe(false);
    expect(r.summary).toContain("The price was not compared");
    expect(r.summary).toContain("€22.00");
  });

  it("never asks for an override on 22 EUR against 770 TRY", () => {
    const r = computeMatch({
      ...base,
      poUnitPrice: 22,
      poCurrency: "EUR",
      invoiceUnitPrice: 770,
      invoiceCurrency: "TRY",
      priceOverrideReason: "",
    });
    expect(r.verdict).toBe("currency_differs");
    expect(r.requiresOverride).toBe(false);
  });

  it("keeps the quantity verdict first and carries the sentence along", () => {
    const r = computeMatch({
      ...base,
      acceptedQty: 10,
      poUnitPrice: 22,
      poCurrency: "EUR",
      invoiceUnitPrice: 770,
      invoiceCurrency: "TRY",
    });
    expect(r.verdict).toBe("qty_short");
    expect(r.summary).toContain("The price was not compared");
  });

  it("still compares the same money, and an unstated one, as before", () => {
    const same = computeMatch({
      ...base,
      poUnitPrice: 22,
      poCurrency: "EUR",
      invoiceUnitPrice: 24,
      invoiceCurrency: "eur",
    });
    expect(same.verdict).toBe("price_variance");
    expect(same.requiresOverride).toBe(true);
    expect(same.summary).toContain("€24.00");

    const unstated = computeMatch({
      ...base,
      poUnitPrice: 22,
      invoiceUnitPrice: 22,
      invoiceCurrency: "TRY",
    });
    expect(unstated.verdict).toBe("matched");
    expect(unstated.priceVerified).toBe(true);
  });
});

describe("agreedCurrency (F-800)", () => {
  // The gateway compares against the agreement line's money first and the
  // order's second; the phone must pick the same one or it holds a price the
  // server compares (or compares one the server holds).
  it("takes the agreement line's money over the order's", () => {
    const order = { agreedCurrency: "EUR", currency: "TRY" };
    expect(agreedCurrency(order)).toBe("EUR");
    expect(differentMoney(agreedCurrency(order), "EUR")).toBe(false);
    expect(differentMoney(agreedCurrency(order), "TRY")).toBe(true);
  });
  it("falls back to the order's money when the line names none or was not read", () => {
    expect(agreedCurrency({ agreedCurrency: null, currency: "TRY" })).toBe("TRY");
    expect(agreedCurrency({ currency: "TRY" })).toBe("TRY");
  });
  it("is null when neither names one, never a guessed money", () => {
    expect(agreedCurrency({ agreedCurrency: null, currency: null })).toBeNull();
    expect(agreedCurrency(undefined)).toBeNull();
  });
});
