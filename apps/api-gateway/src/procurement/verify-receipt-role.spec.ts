/**
 * F-802: verify-receipt writes the lots' landed cost from the invoice price and
 * accepts a price difference on an override reason. That money is an owner's or
 * a manager's act, as the delivery verify already is; the count stays open to
 * staff.
 */
import { HttpException, HttpStatus } from "@nestjs/common";
import { ProcurementController } from "./procurement.controller";
import type { ProcurementService } from "./procurement.service";

const ORDER = "11111111-1111-4111-8111-111111111111";

function harness() {
  const verifyReceipt = jest.fn().mockResolvedValue({ id: ORDER });
  const controller = new ProcurementController({ verifyReceipt } as unknown as ProcurementService);
  return { controller, verifyReceipt };
}

const as = (role: string | null) => ({ userId: "u-1", restaurantId: "rest-1", role });

async function outcome(p: Promise<unknown>) {
  return p.then(
    (value) => ({ value, error: undefined as unknown }),
    (error: unknown) => ({ value: undefined, error }),
  );
}

describe("POST /procurement/orders/:id/verify-receipt — who may put money on a receipt", () => {
  it("lets staff record the count", async () => {
    const { controller, verifyReceipt } = harness();
    const body = { acceptedQuantityInCountedUom: 12, rejectedQuantityInCountedUom: 0 } as any;
    await expect(controller.verifyReceipt(ORDER, body, as("staff"))).resolves.toEqual({ id: ORDER });
    expect(verifyReceipt).toHaveBeenCalledWith("rest-1", ORDER, "u-1", body);
  });

  it("lets staff send the legacy one-tap 'counts match'", async () => {
    const { controller, verifyReceipt } = harness();
    await controller.verifyReceipt(ORDER, { adjustments: [] } as any, as("staff"));
    expect(verifyReceipt).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an invoice price", { acceptedQuantityInCountedUom: 12, invoiceQuantityInInvoiceUom: 12, invoiceUnitPrice: 9.5, invoiceCurrency: "USD" }],
    ["a price override", { acceptedQuantityInCountedUom: 12, priceOverrideReason: "vendor raised the price" }],
    ["freight charges", { acceptedQuantityInCountedUom: 12, allocatedCharges: 4 }],
  ])("refuses staff %s with a 403 and writes nothing", async (_label, body) => {
    const { controller, verifyReceipt } = harness();
    const { error } = await outcome(controller.verifyReceipt(ORDER, body as any, as("staff")));
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(String((error as HttpException).message)).toMatch(/owner's or a manager's/);
    expect(verifyReceipt).not.toHaveBeenCalled();
  });

  it("refuses a session that holds no role at this house", async () => {
    const { controller, verifyReceipt } = harness();
    const { error } = await outcome(
      controller.verifyReceipt(ORDER, { invoiceUnitPrice: 9.5, invoiceCurrency: "USD" } as any, as(null)),
    );
    expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(verifyReceipt).not.toHaveBeenCalled();
  });

  it.each(["manager", "owner"])("lets a %s put the price and the override on the receipt", async (role) => {
    const { controller, verifyReceipt } = harness();
    const body = {
      acceptedQuantityInCountedUom: 12,
      invoiceQuantityInInvoiceUom: 12,
      invoiceUnitPrice: 9.5,
      invoiceCurrency: "USD",
      priceOverrideReason: "vendor raised the price",
      allocatedCharges: 4,
    } as any;
    await expect(controller.verifyReceipt(ORDER, body, as(role))).resolves.toEqual({ id: ORDER });
    expect(verifyReceipt).toHaveBeenCalledWith("rest-1", ORDER, "u-1", body);
  });
});
