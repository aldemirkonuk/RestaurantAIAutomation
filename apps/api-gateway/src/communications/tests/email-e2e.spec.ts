/**
 * E2E Email Tests
 * Sends REAL emails for all 11 templates to aldemirkonuk2004@gmail.com
 * Uses real-time Supabase data when available, falls back to realistic sample data.
 *
 * Run with: npx jest --config jest.config.js --testPathPattern email-e2e --runInBand
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { GmailService, EmailResult } from "../gmail.service";
import { DatabaseService } from "../../database/database.service";

const TEST_EMAIL = "aldemirkonuk2004@gmail.com";
const RESTAURANT_NAME = "WineOps Restaurant";

describe("Email Templates E2E", () => {
  let gmailService: GmailService;
  let databaseService: DatabaseService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: [".env", ".env.local"],
        }),
      ],
      providers: [GmailService, DatabaseService],
    }).compile();

    gmailService = module.get<GmailService>(GmailService);
    databaseService = module.get<DatabaseService>(DatabaseService);

    await module.init();
  }, 30000);

  afterAll(async () => {
    await module?.close();
  });

  // Helper: get real low-stock items or fallback
  async function getLowStockData() {
    try {
      const client = databaseService.getClient();
      const { data } = await client
        .from("restaurant_inventory")
        .select("id, wine_name, stock_live, threshold_min, provider_id")
        .lt("stock_live", 10)
        .order("stock_live", { ascending: true })
        .limit(5);
      if (data && data.length > 0) return data;
    } catch {
      /* optional seed data for e2e */
    }
    return null;
  }

  // Helper: get real inventory data or fallback
  async function getInventoryData() {
    try {
      const client = databaseService.getClient();
      const { data } = await client
        .from("restaurant_inventory")
        .select("id, wine_name, stock_live, threshold_min")
        .order("stock_live", { ascending: true })
        .limit(20);
      if (data && data.length > 0) return data;
    } catch {
      /* optional seed data for e2e */
    }
    return null;
  }

  // ========================================================================
  // 1. LOW STOCK ALERT
  // ========================================================================
  it("should send Low Stock Alert email", async () => {
    const realData = await getLowStockData();
    const wine = realData?.[0];

    const result: EmailResult = await gmailService.sendLowStockAlert({
      to: [TEST_EMAIL],
      wineName: wine?.wine_name || "Chateau Margaux 2015",
      currentStock: wine?.stock_live ?? 2,
      threshold: wine?.threshold_min ?? 12,
      avgDailySales: 1.5,
      recommendedQty: 24,
      preferredSupplier: "Premium Wine Distributors",
      estimatedDelivery: "February 14, 2026",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[1/11] Low Stock Alert sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 2. DAILY SUMMARY
  // ========================================================================
  it("should send Daily Summary email", async () => {
    const lowStock = await getLowStockData();
    const lowStockCount = lowStock?.length ?? 5;

    const result: EmailResult = await gmailService.sendDailySummaryEmail({
      to: [TEST_EMAIL],
      restaurantName: RESTAURANT_NAME,
      date: new Date(),
      metrics: {
        lowStockCount,
        pendingOrders: 3,
        deliveriesToday: 1,
        totalInventoryValue: 42850,
      },
      alerts: [
        {
          type: "low_stock",
          title: "Low Stock Warning",
          message: `${lowStockCount} wines are below threshold`,
        },
        {
          type: "delivery",
          title: "Delivery Today",
          message: "Premium Wine Distributors delivery expected by 2 PM",
        },
      ],
      actionItems: [
        {
          priority: "high",
          description: "Review and approve pending order from Vineyard Imports",
        },
        {
          priority: "medium",
          description: "Schedule physical inventory count for Friday",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[2/11] Daily Summary sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 3. WEEKLY REPORT
  // ========================================================================
  it("should send Weekly Report email", async () => {
    const inventory = await getInventoryData();
    const totalBottles =
      inventory?.reduce((sum, item) => sum + (item.stock_live || 0), 0) ?? 1247;
    const lowStockItems =
      inventory?.filter((i) => (i.stock_live || 0) < (i.threshold_min || 10)) ??
      [];

    const result: EmailResult = await gmailService.sendWeeklyReport({
      to: [TEST_EMAIL],
      restaurantName: RESTAURANT_NAME,
      reportPeriod: {
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        end: new Date(),
      },
      metrics: {
        totalBottles,
        lowStockCount: lowStockItems.length || 12,
        totalValue: totalBottles * 50,
        ordersPlaced: 4,
        deliveriesReceived: 3,
      },
      topSellers: [
        { name: "Chateau Margaux 2015", sold: 15, revenue: 4500 },
        { name: "Opus One 2019", sold: 12, revenue: 3540 },
        { name: "Dom Perignon 2012", sold: 10, revenue: 2500 },
      ],
      lowStockItems:
        lowStockItems.length > 0
          ? lowStockItems.slice(0, 5).map((i) => ({
              name: i.wine_name || "Unknown",
              current: i.stock_live || 0,
              threshold: i.threshold_min || 10,
            }))
          : [
              { name: "Chateau Margaux 2015", current: 2, threshold: 12 },
              { name: "Opus One 2019", current: 5, threshold: 8 },
            ],
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[3/11] Weekly Report sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 4. ORDER APPROVAL
  // ========================================================================
  it("should send Order Approval email", async () => {
    const result: EmailResult = await gmailService.sendOrderApprovalEmail({
      to: [TEST_EMAIL],
      orderId: "ORD-2026-0042",
      providerName: "Premium Wine Distributors",
      items: [
        { name: "Chateau Margaux 2015", quantity: 12, unitPrice: 285 },
        { name: "Opus One 2019", quantity: 6, unitPrice: 295 },
        { name: "Dom Perignon 2012", quantity: 6, unitPrice: 250 },
      ],
      totalAmount: 6990,
      requestedBy: "AI Procurement Agent",
      requestedAt: new Date(),
      urgency: "high",
      notes:
        "Chateau Margaux is critically low. Recommended by AI based on sales velocity.",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[4/11] Order Approval sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 5. DELIVERY NOTIFICATION
  // ========================================================================
  it("should send Delivery Notification email", async () => {
    const result: EmailResult =
      await gmailService.sendDeliveryNotificationEmail({
        to: [TEST_EMAIL],
        orderId: "ORD-2026-0039",
        providerName: "Vineyard Imports Co.",
        deliveryDate: new Date(),
        items: [
          { name: "Barolo 2018", quantity: 12, received: 12 },
          { name: "Brunello di Montalcino 2017", quantity: 6, received: 5 },
          { name: "Amarone 2019", quantity: 6, received: 6 },
        ],
        status: "partial",
        trackingNumber: "VIC-2026-78432",
        notes: "1 bottle of Brunello missing from shipment. Provider notified.",
      });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(
      `[5/11] Delivery Notification sent. MessageID: ${result.messageId}`,
    );
  }, 15000);

  // ========================================================================
  // 6. RECURRING ORDER REMINDER (NEW)
  // ========================================================================
  it("should send Recurring Order Reminder email", async () => {
    const result: EmailResult = await gmailService.sendRecurringOrderReminder({
      to: [TEST_EMAIL],
      restaurantName: RESTAURANT_NAME,
      orderName: "Monthly House Wine Restock",
      providerName: "Turkish Wine Co.",
      scheduledDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      items: [
        { name: "Sevilen Reserve 2020", quantity: 24, unitPrice: 18 },
        { name: "Kavaklidere Angora White", quantity: 12, unitPrice: 12 },
        { name: "Doluca Karma Red", quantity: 12, unitPrice: 15 },
      ],
      totalAmount: 756,
      frequency: "monthly",
      lastOrderDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      notes: "Consider increasing Sevilen order - sales up 20% this month.",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(
      `[6/11] Recurring Order Reminder sent. MessageID: ${result.messageId}`,
    );
  }, 15000);

  // ========================================================================
  // 7. DELIVERY ETA (NEW)
  // ========================================================================
  it("should send Delivery ETA email", async () => {
    const result: EmailResult = await gmailService.sendDeliveryETANotification({
      to: [TEST_EMAIL],
      restaurantName: RESTAURANT_NAME,
      orderId: "ORD-2026-0044",
      providerName: "Premium Wine Distributors",
      expectedDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      expectedTimeWindow: "10:00 AM - 12:00 PM",
      items: [
        { name: "Chateau Margaux 2015", quantity: 12 },
        { name: "Opus One 2019", quantity: 6 },
        { name: "Dom Perignon 2012", quantity: 6 },
      ],
      totalItems: 24,
      trackingNumber: "PWD-2026-55123",
      driverName: "Carlos M.",
      driverPhone: "+1 (555) 123-4567",
      specialInstructions: "Use back entrance. Ring bell twice.",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[7/11] Delivery ETA sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 8. PAYMENT DUE (NEW)
  // ========================================================================
  it("should send Payment Due Reminder email", async () => {
    const result: EmailResult = await gmailService.sendPaymentDueReminder({
      to: [TEST_EMAIL],
      restaurantName: RESTAURANT_NAME,
      invoiceNumber: "INV-2026-PWD-0891",
      providerName: "Premium Wine Distributors",
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      amount: 6990,
      items: [
        { name: "Chateau Margaux 2015 (x12)", quantity: 12, amount: 3420 },
        { name: "Opus One 2019 (x6)", quantity: 6, amount: 1770 },
        { name: "Dom Perignon 2012 (x6)", quantity: 6, amount: 1500 },
      ],
      paymentTerms: "Net 30",
      daysUntilDue: 2,
      paymentMethod: "Bank Transfer",
      notes: "Early payment discount of 2% available if paid within 10 days.",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[8/11] Payment Due sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 9. INVENTORY AUDIT (NEW)
  // ========================================================================
  it("should send Inventory Audit Reminder email", async () => {
    const inventory = await getInventoryData();
    const totalBottles =
      inventory?.reduce((sum, item) => sum + (item.stock_live || 0), 0) ?? 1247;

    const result: EmailResult = await gmailService.sendInventoryAuditReminder({
      to: [TEST_EMAIL],
      restaurantName: RESTAURANT_NAME,
      scheduledDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      scheduledTime: "10:00 AM",
      lastAuditDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      daysSinceLastAudit: 14,
      totalBottles,
      totalValue: totalBottles * 50,
      discrepancyCount: 3,
      focusAreas: [
        {
          area: "Main Bar Storage",
          reason: "High traffic area with frequent discrepancies",
        },
        {
          area: "Wine Cellar - Rack B",
          reason: "Chateau Margaux count mismatch reported last week",
        },
      ],
      assignedStaff: ["Alex M.", "Sarah K.", "Jordan T."],
      notes: "Focus on high-value wines and recently delivered items.",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[9/11] Inventory Audit sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 10. EVENT PREPARATION (NEW)
  // ========================================================================
  it("should send Event Prep Reminder email", async () => {
    const result: EmailResult = await gmailService.sendEventPrepReminder({
      to: [TEST_EMAIL],
      restaurantName: RESTAURANT_NAME,
      eventName: "Valentine's Day Wine Tasting",
      eventDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      eventTime: "7:00 PM - 10:00 PM",
      guestCount: 45,
      eventType: "wine_tasting",
      wineRequirements: [
        {
          name: "Chateau Margaux 2015",
          quantityNeeded: 6,
          currentStock: 2,
          shortfall: 4,
        },
        {
          name: "Dom Perignon 2012",
          quantityNeeded: 8,
          currentStock: 10,
          shortfall: 0,
        },
        {
          name: "Barolo 2018",
          quantityNeeded: 4,
          currentStock: 4,
          shortfall: 0,
        },
        {
          name: "Sancerre 2021",
          quantityNeeded: 6,
          currentStock: 3,
          shortfall: 3,
        },
      ],
      totalBottlesNeeded: 24,
      estimatedCost: 4200,
      organizer: "Chef Marco",
      specialRequests:
        "All reds need to be decanted 1 hour before service. Prepare tasting notes cards.",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[10/11] Event Prep sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 11. CUSTOM REMINDER (NEW)
  // ========================================================================
  it("should send Custom Reminder email", async () => {
    const result: EmailResult = await gmailService.sendCustomReminder({
      to: [TEST_EMAIL],
      restaurantName: RESTAURANT_NAME,
      title: "Wine Storage Temperature Check",
      description:
        "Monthly reminder to verify all wine storage units are maintaining proper temperature ranges. Red wines: 55-65°F, White wines: 45-55°F, Sparkling: 40-50°F.",
      reminderType: "maintenance",
      scheduledDate: new Date(),
      scheduledTime: "9:00 AM",
      createdBy: "System Admin",
      priority: "high",
      actionItems: [
        "Check main cellar thermostat (target: 58°F)",
        "Verify backup cooling unit is operational",
        "Record temperature readings for all 4 storage zones",
        "Report any anomalies to management immediately",
      ],
      isRecurring: true,
      recurrencePattern: "Monthly on the 1st",
      notes:
        "Last check found Zone 3 running 2 degrees warm. Verify repair was completed.",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[11/11] Custom Reminder sent. MessageID: ${result.messageId}`);
  }, 15000);
});
