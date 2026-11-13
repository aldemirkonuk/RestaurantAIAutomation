import { formatCurrency } from "./template-config";
import { orderApprovalTemplate as orderApprovalMail } from "./order-notification.template";
import { paymentDueTemplate } from "./payment-due.template";
import { dailySummaryTemplate } from "./daily-summary.template";
import { eventPrepTemplate } from "./event-prep.template";
import { inventoryAuditTemplate } from "./inventory-audit.template";
import { recurringOrderReminderTemplate } from "./recurring-order.template";
import { managerReviewTemplate } from "./vendor-action.template";
import { weeklyReportTemplate } from "./weekly-report.template";

/**
 * The texts and mails print each figure in its own money. Before this every
 * one hardcoded a dollar sign (or formatted USD), so a lira house read dollars
 * in its weekly report and the mail it sends a vendor.
 *
 * The rule (2026-11-12): the record's currency; for the house's own books the
 * house's; none known, the bare figure. Never a dollar sign by default.
 */

describe("formatCurrency (both template sets) says the amount in its own money", () => {
  it("TRY: lira; null: bare; USD: dollars", () => {
    expect(formatCurrency(1240.5, "TRY")).toBe("₺1,240.50");
    expect(formatCurrency(1240.5, null)).toBe("1,240.50");
    expect(formatCurrency(1240.5, "USD")).toBe("$1,240.50");
  });
});

describe("the mail templates read the currency off their data", () => {
  const approval = (currency?: string | null) =>
    orderApprovalMail({
      orderId: "ORD-1",
      providerName: "Vendor",
      items: [{ name: "Malbec", quantity: 6, unitPrice: 200.25 }],
      totalAmount: 1201.5,
      requestedBy: "Manager",
      requestedAt: "2026-11-12T10:00:00Z",
      ...(currency === undefined ? {} : { currency }),
    } as any);

  it("order approval: TRY lira, null bare, USD dollars", () => {
    const tr = approval("TRY");
    expect(tr).toContain("₺1,201.50");
    expect(tr).toContain("₺200.25");
    expect(tr).not.toContain("$");
    const bare = approval(null);
    expect(bare).toContain("1,201.50");
    expect(bare).not.toMatch(/[$₺]/);
    expect(approval(undefined)).not.toContain("$");
    expect(approval("USD")).toContain("$1,201.50");
  });

  it("payment due: the amount and its preheader", () => {
    const due = (currency: string | null) =>
      paymentDueTemplate({
        restaurantName: "House",
        invoiceNumber: "INV-9",
        providerName: "Vendor",
        dueDate: "2026-12-01",
        amount: 840,
        daysUntilDue: 5,
        currency,
      } as any);
    expect(due("TRY")).toContain("₺840.00");
    expect(due("TRY")).not.toContain("$");
    expect(due(null)).toContain("840.00");
    expect(due(null)).not.toContain("$");
  });
});

describe("every other template that prints an amount reads the currency off its data", () => {
  const D = "2026-11-12T10:00:00Z";
  const cases: Array<[string, (c: string | null) => string]> = [
    [
      "daily summary",
      (currency) =>
        dailySummaryTemplate({
          restaurantName: "House",
          date: D,
          metrics: {
            lowStockCount: 1,
            pendingOrders: 1,
            deliveriesToday: 1,
            totalInventoryValue: 1234.5,
          },
          alerts: [],
          currency,
        }),
    ],
    [
      "event prep",
      (currency) =>
        eventPrepTemplate({
          restaurantName: "House",
          eventName: "Tasting",
          eventDate: D,
          estimatedCost: 1234.5,
          currency,
        }),
    ],
    [
      "inventory audit",
      (currency) =>
        inventoryAuditTemplate({
          restaurantName: "House",
          scheduledDate: D,
          totalBottles: 100,
          totalValue: 1234.5,
          currency,
        }),
    ],
    [
      "recurring order",
      (currency) =>
        recurringOrderReminderTemplate({
          restaurantName: "House",
          orderName: "Weekly",
          providerName: "Vendor",
          scheduledDate: D,
          items: [{ name: "Malbec", quantity: 1, unitPrice: 1234.5 }],
          totalAmount: 1234.5,
          frequency: "weekly",
          currency,
        }),
    ],
    [
      "manager review",
      (currency) =>
        managerReviewTemplate({
          orderId: "ORD-1",
          conversationId: "c-1",
          providerName: "Vendor",
          wineName: "Malbec",
          quantity: 6,
          pricePerBottle: 1234.5,
          totalAmount: 1234.5,
          aiDraftedMessage: "Hello",
          currency,
        }),
    ],
    [
      "weekly report",
      (currency) =>
        weeklyReportTemplate({
          restaurantName: "House",
          reportPeriod: { start: D, end: D },
          metrics: { totalBottles: 100, lowStockCount: 1, totalValue: 1234.5 },
          topSellers: [{ name: "Malbec", sold: 3, revenue: 1234.5 }],
          lowStockItems: [],
          currency,
        }),
    ],
  ];

  it.each(cases)("%s: TRY lira, null bare, never a dollar sign", (_n, render) => {
    const tr = render("TRY");
    expect(tr).toContain("₺1,234.50");
    expect(tr).not.toContain("$");
    const bare = render(null);
    expect(bare).toContain("1,234.50");
    expect(bare).not.toMatch(/[$₺]/);
  });
});
