import { holdsHouseMoney, withoutReceiptMoney } from "../receiptMoney";

describe("holdsHouseMoney (F-806, mirrors the gateway's money row)", () => {
  it("owner, manager and admin hold the house's money, in any case", () => {
    expect(holdsHouseMoney("owner")).toBe(true);
    expect(holdsHouseMoney(" Manager ")).toBe(true);
    expect(holdsHouseMoney("admin")).toBe(true);
  });
  it("staff, an unknown role and no role do not", () => {
    expect(holdsHouseMoney("staff")).toBe(false);
    expect(holdsHouseMoney("sommelier")).toBe(false);
    expect(holdsHouseMoney(undefined)).toBe(false);
    expect(holdsHouseMoney(null)).toBe(false);
  });
});

describe("withoutReceiptMoney", () => {
  const path = "/procurement/orders/o1/verify-receipt";
  it("takes the price, currency, override and charges out and keeps the count", () => {
    expect(
      withoutReceiptMoney(path, {
        countedUom: "bottle",
        acceptedQuantityInCountedUom: 11,
        rejectedQuantityInCountedUom: 1,
        rejectedReason: "broken",
        invoiceQuantityInInvoiceUom: 12,
        invoiceUnitPrice: 9.5,
        invoiceCurrency: "USD",
        priceOverrideReason: "rep said so",
        allocatedCharges: 4,
        note: "late truck",
      }),
    ).toEqual({
      countedUom: "bottle",
      acceptedQuantityInCountedUom: 11,
      rejectedQuantityInCountedUom: 1,
      rejectedReason: "broken",
      invoiceQuantityInInvoiceUom: 12,
      note: "late truck",
    });
  });
  it("is null for a body with no money or another path", () => {
    expect(
      withoutReceiptMoney(path, { acceptedQuantityInCountedUom: 3 }),
    ).toBeNull();
    expect(
      withoutReceiptMoney("/procurement/orders/o1/receive", {
        invoiceUnitPrice: 2,
      }),
    ).toBeNull();
  });
});
