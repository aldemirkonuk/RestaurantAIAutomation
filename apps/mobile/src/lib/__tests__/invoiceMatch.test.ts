import { computeMatch, invoicePriceUnits } from "../invoiceMatch";

/*
 * PRICE AS PRINTED — founder, 2026-10-02, RECEIPTS-W56 (F-103). The phone keys
 * the number on the invoice and says what it is per; the gateway converts it
 * once. This mirror must compare the way the gateway does (in the printed
 * unit, to the cent) or the phone and the server disagree about one receipt.
 */
// 24 bottles agreed at $44.00 the case of 24 = $1.8333 a bottle.
const base = {
  orderedQty: 24,
  poUnitPrice: 44 / 24,
  invoiceQty: 24,
  acceptedQty: 24,
};

it("matches a case price that names its unit and lands its cost per bottle", () => {
  const r = computeMatch({
    ...base,
    invoiceUnitPrice: 44,
    invoicePriceUom: "case",
    invoicePricePackSize: 24,
  });
  expect(r.verdict).toBe("matched");
  expect(r.priceVerified).toBe(true);
  expect(r.effectiveUnitCost).toBeCloseTo(44 / 24, 10);
});

it("reads the same 44 with no unit as per bottle — a variance that names both units", () => {
  const r = computeMatch({ ...base, invoiceUnitPrice: 44 });
  expect(r.verdict).toBe("price_variance");
  expect(r.summary).toBe(
    "Billed 44.00 a bottle against a stated 1.83 a bottle. The server will check the agreement and currency.",
  );
});

it("compares in the printed unit: ten cents under a case is a variance, though both read $1.83 a bottle", () => {
  const r = computeMatch({
    ...base,
    invoiceUnitPrice: 43.9,
    invoicePriceUom: "case",
    invoicePricePackSize: 24,
  });
  expect(r.verdict).toBe("price_variance");
  expect(r.summary).toBe(
    "Billed 43.90 a case of 24 against a stated 44.00 a case of 24 (1.83 a bottle). The server will check the agreement and currency.",
  );
});

it("starts the pick at the order line's unit, offers per bottle, and gives a keg line none", () => {
  expect(invoicePriceUnits({ priceUom: "case", pricePackSize: 24 })).toEqual({
    options: [
      { uom: "bottle", packSize: 1 },
      { uom: "case", packSize: 24 },
    ],
    initial: { uom: "case", packSize: 24 },
  });
  expect(invoicePriceUnits({ priceUom: null, pricePackSize: null })?.initial).toEqual({
    uom: "bottle",
    packSize: 1,
  });
  expect(invoicePriceUnits({ priceUom: "keg", pricePackSize: 1 })).toBeNull();
});
