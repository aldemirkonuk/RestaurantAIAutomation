import { CommunicationsService } from "./communications.service";
import {
  counterOfferTemplate,
  orderInquiryTemplate,
  weeklyReportTemplate as legacyWeeklyReport,
} from "./email-templates-legacy";

/**
 * The texts and mails print each figure in its own money. Before this every
 * one hardcoded a dollar sign (or formatted USD), so a lira house read dollars
 * in its weekly report and the mail it sends a vendor.
 *
 * The rule (2026-11-12): the record's currency; for the house's own books the
 * house's; none known, the bare figure. Never a dollar sign by default.
 */

describe("the weekly report mail (communications.service)", () => {
  const htmlFor = (currency?: string | null) =>
    (CommunicationsService.prototype as any).generateWeeklyReportHtml.call(
      {},
      {
        totalBottles: 120,
        lowStockCount: 2,
        totalValue: 12345.6,
        topSellers: [{ name: "Malbec", sold: 9, revenue: 1240.5 }],
        lowStockItems: [],
        ...(currency === undefined ? {} : { currency }),
      },
    ) as string;

  it("TRY: revenue and total value in lira, no dollar sign", () => {
    const h = htmlFor("TRY");
    expect(h).toContain("₺1,240.50");
    expect(h).toContain("₺12,346");
    expect(h).not.toContain("$");
  });

  it("no currency: bare figures", () => {
    for (const c of [null, undefined]) {
      const h = htmlFor(c);
      expect(h).toContain(">1,240.50<");
      expect(h).toContain(">12,346<");
      expect(h).not.toContain("$");
    }
  });

  it("USD: dollars", () => {
    expect(htmlFor("USD")).toContain("$1,240.50");
  });
});

describe("the legacy mail templates read the currency off their data", () => {
  it("legacy weekly report: revenue cells", () => {
    const wk = (currency: string | null) =>
      legacyWeeklyReport({
        topSellers: [{ name: "Malbec", sold: 9, revenue: 1240.5 }],
        totalRevenue: 5000,
        currency,
      });
    expect(wk("TRY")).toContain("₺1,240.50");
    expect(wk("TRY")).not.toContain("$");
    expect(wk(null)).toContain("1,240.50");
    expect(wk(null)).not.toContain("$");
  });

  it("the vendor inquiry and counter offer: the figures the vendor reads", () => {
    const inquiry = (currency: string | null) =>
      orderInquiryTemplate({
        orderNumber: "ORD-1",
        wineName: "Malbec",
        quantity: 6,
        targetPrice: 200.25,
        managerName: "M",
        restaurantName: "House",
        providerName: "Vendor",
        currency,
      });
    const counter = (currency: string | null) =>
      counterOfferTemplate({
        orderNumber: "ORD-1",
        wineName: "Malbec",
        quantity: 6,
        originalPrice: 210,
        counterPrice: 200,
        managerName: "M",
        restaurantName: "House",
        providerName: "Vendor",
        currency,
      } as any);
    expect(inquiry("TRY")).toContain("₺200.25/bottle");
    expect(inquiry("TRY")).not.toContain("$");
    expect(inquiry(null)).toContain("200.25/bottle");
    expect(inquiry(null)).not.toContain("$");
    expect(counter("EUR")).toContain("€200.00/bottle");
    expect(counter("EUR")).toContain("€1,200.00");
    expect(counter(null)).not.toContain("$");
  });
});
