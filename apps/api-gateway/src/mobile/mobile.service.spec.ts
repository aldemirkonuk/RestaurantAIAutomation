import { MobileService } from "./mobile.service";

/**
 * F-341: the mobile feed's order card printed "$1,240" for every house. The
 * amount is now in the house's own money (`restaurants.currency`), and with
 * no symbol when none is recorded.
 */
function serviceFor(currency: string | null) {
  const rows: Record<string, any[]> = {
    providers: [{ id: "p1", name: "Acme Wines" }],
    restaurants: [{ currency }],
  };
  const supabase = {
    from: (table: string) => {
      const b: any = {};
      for (const m of ["select", "eq", "in", "limit"]) b[m] = () => b;
      b.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(
          resolve,
          reject,
        );
      return b;
    },
  };
  return new MobileService(
    { supabase } as any,
    {
      listPendingOrders: async () => [
        {
          id: "o1",
          orderNumber: "PO-1",
          wineName: "Barolo",
          providerId: "p1",
          quantity: 2,
          unitType: "case",
          totalCost: 1240,
          requestedAt: "2026-10-08T10:00:00.000Z",
        },
      ],
    } as any,
    { getPendingConversations: async () => [] } as any,
    { getUnreadNotifications: async () => [] } as any,
  );
}

describe("MobileService feed — an order's amount in the house's money", () => {
  it("prints a pound house's order in pounds", async () => {
    const feed = await serviceFor("GBP").getFeed("u1", "r1");
    expect(feed.items[0].subtitle).toBe("2 cases · Acme Wines · £1,240");
  });

  it("prints a house with no recorded currency with no symbol, never a dollar", async () => {
    const feed = await serviceFor(null).getFeed("u1", "r1");
    expect(feed.items[0].subtitle).toBe("2 cases · Acme Wines · 1,240");
  });
});

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
        metadata: {
          orderId: "o-1",
          matchStatus: "short_shipped",
          backorderQty: 2,
        },
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
    expect(feed.items[0]).toMatchObject({
      kind: "receipt_verification",
      orderId: "o-1",
    });
    expect(feed.counts.receiptVerifications).toBe(1);
  });
});

describe("mobile feed — a receipt notice with no order is not a delivery to check (F-372)", () => {
  it("files an invoice_received notice with no orderId as an informational alert", async () => {
    const feed = await feedOf([
      {
        id: "n-orphan",
        type: "invoice_received",
        title: "Invoice received",
        message: "An invoice arrived from your vendor.",
        createdAt,
        metadata: {},
      },
    ]);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      kind: "alert",
      orderId: null,
      notificationId: "n-orphan",
    });
    expect(feed.counts.receiptVerifications).toBe(0);
  });
});
