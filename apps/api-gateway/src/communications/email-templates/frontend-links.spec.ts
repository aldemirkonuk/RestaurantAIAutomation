import { deliveryETATemplate } from "./delivery-eta.template";
import { dailySummaryTemplate } from "./daily-summary.template";
import { customReminderTemplate } from "./custom-reminder.template";
import { eventPrepTemplate } from "./event-prep.template";
import { lowStockAlertTemplate } from "./low-stock-alert.template";
import { inventoryAuditTemplate } from "./inventory-audit.template";
import { paymentDueTemplate } from "./payment-due.template";
import { weeklyReportTemplate } from "./weekly-report.template";
import { recurringOrderReminderTemplate } from "./recurring-order.template";
import {
  orderApprovalTemplate,
  deliveryNotificationTemplate,
} from "./order-notification.template";
import { onboardingEmailTemplate } from "./onboarding.template";
import { lowStockDigestTemplate } from "./low-stock-digest.template";
import { canonicalOrigin } from "./template-config";

/**
 * Before this file, no gateway test covered any of the ten
 * "#" -> real-href CTA fixes, or the new `frontendUrl()` helper — reverting
 * any of them would keep CI green. This renders every producer once per
 * `FRONTEND_URL` shape actually seen in this codebase (unset, a single
 * origin, and a comma-separated allow-list such as production's) and asserts the
 * one property that matters: the button always lands on a real, absolute,
 * canonical-origin URL — never `"#"`, never a literal comma, never the
 * non-route `/dashboard`.
 *
 * `onboardingEmailTemplate` (gmail.service.ts's onboarding mail) is included
 * too: it does not read `FRONTEND_URL` itself, but `sendOnboardingEmail`'s
 * `frontendBaseUrl` param is fed by the very `canonicalOrigin()` this spec
 * exercises (auth.service.ts), so it gets the same three scenarios.
 */

const FRONTEND_URL_SCENARIOS: Record<string, string | undefined> = {
  unset: undefined,
  "single origin": "https://mudavym.com",
  "a comma-separated allow-list such as production's":
    "https://mudavym.com,https://www.mudavym.com",
};

function extractHref(html: string): string {
  const match = html.match(/href="([^"]+)"/);
  if (!match) throw new Error("no href found in rendered template");
  return match[1];
}

function assertHonestCtaUrl(url: string) {
  expect(url).toMatch(/^https:\/\//);
  expect(url).not.toBe("#");
  expect(url).not.toContain("#");
  // The one shape a raw, un-canonicalized FRONTEND_URL read would have
  // produced: the whole comma-separated allow-list glued into one URL
  // (`https://mudavym.com,https://www.mudavym.com/orders/<id>`).
  expect(url).not.toContain(",");
  expect(url).not.toContain("/dashboard");
}

describe.each(Object.entries(FRONTEND_URL_SCENARIOS))(
  "FRONTEND_URL = %s",
  (_label, value) => {
    const prevValue = process.env.FRONTEND_URL;

    beforeEach(() => {
      if (value === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = value;
    });

    afterAll(() => {
      if (prevValue === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = prevValue;
    });

    it("delivery-eta CTA", () => {
      const html = deliveryETATemplate({
        restaurantName: "Sim Meyhouse",
        orderId: "ord-1",
        providerName: "Anadolu",
        expectedDate: "2026-09-20",
        items: [{ name: "Barolo", quantity: 6 }],
        totalItems: 6,
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("delivery-eta links the order's row id, never its number (review of #424)", () => {
      const uuid = "3f1c2a9e-8b7d-4c6e-9a10-5d2b7e4f8c21";
      const html = deliveryETATemplate({
        restaurantName: "Sim Meyhouse",
        orderId: "ORD-2026-1234",
        orderUuid: uuid,
        providerName: "Anadolu",
        expectedDate: "2026-09-20",
        items: [{ name: "Barolo", quantity: 6 }],
        totalItems: 6,
      });
      const href = extractHref(html);
      assertHonestCtaUrl(href);
      // OrdersNext resolves /orders/:id by r.id (the UUID); a number or a
      // prefix lands on its not-found banner.
      expect(href.endsWith(`/orders/${uuid}`)).toBe(true);
      expect(href).not.toContain("ORD-2026-1234");
      // The words a person reads still carry the number.
      expect(html).toContain("Order #ORD-2026-1234");

      const noId = deliveryETATemplate({
        restaurantName: "Sim Meyhouse",
        orderId: "N/A",
        providerName: "Anadolu",
        expectedDate: "2026-09-20",
        items: [],
        totalItems: 0,
      });
      expect(extractHref(noId).endsWith("/orders")).toBe(true);
    });

    it("daily-summary CTA", () => {
      const html = dailySummaryTemplate({
        restaurantName: "Sim Meyhouse",
        date: "2026-09-20",
        metrics: { lowStockCount: 1, pendingOrders: 2, deliveriesToday: 1 },
        alerts: [],
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("custom-reminder CTA", () => {
      const html = customReminderTemplate({
        restaurantName: "Sim Meyhouse",
        title: "Renew license",
        description: "Liquor license renewal is due.",
        reminderType: "license_renewal",
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("event-prep CTA", () => {
      const html = eventPrepTemplate({
        restaurantName: "Sim Meyhouse",
        eventName: "Tasting night",
        eventDate: "2026-09-25",
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("low-stock-alert CTA", () => {
      const html = lowStockAlertTemplate({
        wineName: "Barolo Riserva",
        currentStock: 2,
        threshold: 6,
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("inventory-audit CTA", () => {
      const html = inventoryAuditTemplate({
        restaurantName: "Sim Meyhouse",
        scheduledDate: "2026-09-22",
        totalBottles: 500,
        totalValue: 42000,
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("payment-due CTA", () => {
      const html = paymentDueTemplate({
        restaurantName: "Sim Meyhouse",
        invoiceNumber: "INV-1",
        providerName: "Anadolu",
        dueDate: "2026-09-30",
        amount: 1240.5,
        daysUntilDue: 7,
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("weekly-report CTA", () => {
      const html = weeklyReportTemplate({
        restaurantName: "Sim Meyhouse",
        reportPeriod: { start: "2026-09-08", end: "2026-09-14" },
        metrics: { totalBottles: 500, lowStockCount: 3, totalValue: 42000 },
        topSellers: [],
        lowStockItems: [],
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("recurring-order CTA", () => {
      const html = recurringOrderReminderTemplate({
        restaurantName: "Sim Meyhouse",
        orderName: "Weekly Anadolu order",
        providerName: "Anadolu",
        scheduledDate: "2026-09-21",
        items: [{ name: "Barolo", quantity: 6, unitPrice: 40 }],
        totalAmount: 240,
        frequency: "weekly",
      });
      const url = extractHref(html);
      assertHonestCtaUrl(url);
      // The station param this link deep-links into — OrdersNext.tsx reads
      // both `station` and its `tab` alias.
      expect(url).toContain("station=recurring");
    });

    it("order-notification: order-approval CTA", () => {
      const html = orderApprovalTemplate({
        orderId: "ord-1",
        providerName: "Anadolu",
        items: [{ name: "Barolo", quantity: 6, unitPrice: 40 }],
        totalAmount: 240,
        requestedBy: "AI Agent",
        requestedAt: "2026-09-20T10:00:00Z",
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("order-notification: delivery-notification CTA", () => {
      const html = deliveryNotificationTemplate({
        orderId: "ord-1",
        providerName: "Anadolu",
        deliveryDate: "2026-09-20",
        items: [{ name: "Barolo", quantity: 6 }],
        status: "delivered",
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("onboarding email's three URLs (gmail.service.ts sendOnboardingEmail)", () => {
      const base =
        canonicalOrigin(process.env.FRONTEND_URL) || "https://mudavym.com";
      const html = onboardingEmailTemplate({
        ownerName: "Ada",
        restaurantName: "Sim Meyhouse",
        restaurantCity: "Istanbul",
        dashboardUrl: `${base}/`,
        settingsUrl: `${base}/settings`,
        inviteUrl: `${base}/settings?tab=team`,
      });
      // Three URLs, not one CTA button -- check each explicitly rather than
      // relying on extractHref's "first href" shortcut.
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs.length).toBeGreaterThanOrEqual(3);
      for (const url of hrefs) assertHonestCtaUrl(url);
      expect(html).not.toContain("/dashboard");
    });
  },
);

/**
 * `lowStockDigestTemplate`'s `inventoryUrl` is caller-supplied (unlike the
 * other templates above, which read `FRONTEND_URL` themselves) — but
 * previously, an absent one fell back to the literal `"#"` dead CTA
 * instead of `frontendUrl()`, the same helper every sibling template already
 * routes through. Covered separately because it does not fit the per-caller
 * `FRONTEND_URL` matrix above: the caller (`low-stock-alerts.service.ts`)
 * never actually leaves `inventoryUrl` unset in production, so this is the
 * template's own defensive fallback, not a live-caller scenario.
 */
describe.each(Object.entries(FRONTEND_URL_SCENARIOS))(
  "lowStockDigestTemplate — FRONTEND_URL = %s",
  (_label, value) => {
    const prevValue = process.env.FRONTEND_URL;

    beforeEach(() => {
      if (value === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = value;
    });

    afterAll(() => {
      if (prevValue === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = prevValue;
    });

    it("falls back to frontendUrl() when the caller passes no inventoryUrl — never the dead '#'", () => {
      const html = lowStockDigestTemplate({
        wines: [
          { wineName: "Barolo", currentStock: 2, threshold: 6, severity: "low" },
        ],
        mode: "digest",
      });
      assertHonestCtaUrl(extractHref(html));
    });

    it("uses the caller's inventoryUrl as-is when one is passed", () => {
      const html = lowStockDigestTemplate({
        wines: [
          { wineName: "Barolo", currentStock: 2, threshold: 6, severity: "low" },
        ],
        mode: "digest",
        inventoryUrl: "https://mudavym.com/inventory?filter=low-stock",
      });
      expect(extractHref(html)).toBe(
        "https://mudavym.com/inventory?filter=low-stock",
      );
    });
  },
);
