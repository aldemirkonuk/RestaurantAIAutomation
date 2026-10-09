import { MobileService } from "./mobile.service";

/**
 * F-349 — a delivery discrepancy is not a delivery to check.
 *
 * verifyReceipt files its discrepancy notice as `invoice_received`, the same
 * type as the "verify this delivery" task. The feed turned both into a
 * `receipt_verification` card, whose main button is "Counts match" — and that
 * tap posted `verify-receipt {adjustments: []}`, completing an order a match
 * had just left PARTIALLY_RECEIVED with a backorder or an invoice owed.
 */
function feedOf(notifications: Record<string, any>[]) {
  const service = new MobileService(
    {} as any,
    { listPendingOrders: async () => [] } as any,
    { getPendingConversations: async () => [] } as any,
    { getUnreadNotifications: async () => notifications } as any,
    {} as any,
  );
  return service.getFeed("user-1", "house-1");
}

const createdAt = "2026-10-08T12:00:00Z";

describe("mobile feed — a delivery discrepancy is its own card (F-349)", () => {
  it("files the discrepancy notice as receipt_discrepancy, never receipt_verification", async () => {
    const feed = await feedOf([
      {
        id: "n-disc",
        type: "invoice_received",
        title: "Delivery discrepancy: Barolo",
        message: "Short by 2 bottles.",
        createdAt,
        metadata: { orderId: "o-1", matchStatus: "short_shipped", backorderQty: 2 },
      },
    ]);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      kind: "receipt_discrepancy",
      orderId: "o-1",
      notificationId: "n-disc",
      priority: "critical",
    });
    expect(feed.counts.receiptVerifications).toBe(0);
  });

  it("keeps the verify-this-delivery task a receipt_verification card", async () => {
    const feed = await feedOf([
      {
        id: "n-verify",
        type: "invoice_received",
        title: "Verify delivery: Barolo",
        message: "10 bottles stocked in.",
        createdAt,
        metadata: { orderId: "o-1", quantity: 10 },
      },
    ]);
    expect(feed.items[0]).toMatchObject({ kind: "receipt_verification", orderId: "o-1" });
    expect(feed.counts.receiptVerifications).toBe(1);
  });
});
