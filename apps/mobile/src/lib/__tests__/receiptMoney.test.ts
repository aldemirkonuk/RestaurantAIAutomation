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
  it("takes the price, currency, override, charges and billed quantity out and keeps the count (F-1180)", () => {
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
      note: "late truck",
    });
  });
  it("takes a billed quantity on its own out, as the gateway counts it as money (F-1180)", () => {
    expect(
      withoutReceiptMoney(path, {
        acceptedQuantityInCountedUom: 12,
        invoiceQuantityInInvoiceUom: 12,
      }),
    ).toEqual({ acceptedQuantityInCountedUom: 12 });
    expect(
      withoutReceiptMoney(path, {
        acceptedQuantityInCountedUom: 12,
        invoiceQuantity: 12,
      }),
    ).toEqual({ acceptedQuantityInCountedUom: 12 });
  });
  it("keeps the billed quantity when only a manager's price was refused (F-949)", () => {
    expect(
      withoutReceiptMoney(
        path,
        {
          acceptedQuantityInCountedUom: 12,
          invoiceQuantityInInvoiceUom: 12,
          invoiceUnitPrice: 9.5,
          invoiceCurrency: "USD",
        },
        { billedIsMoney: false },
      ),
    ).toEqual({
      acceptedQuantityInCountedUom: 12,
      invoiceQuantityInInvoiceUom: 12,
    });
    expect(
      withoutReceiptMoney(
        path,
        { acceptedQuantityInCountedUom: 12, invoiceQuantityInInvoiceUom: 12 },
        { billedIsMoney: false },
      ),
    ).toBeNull();
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
