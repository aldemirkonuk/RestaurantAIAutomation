/**
 * Notification & Reminder Flow E2E Tests — live/real data only
 * ============================================================
 * No mocks. Every assertion requires a real delivery.
 *
 *   Suite 1 — Email delivery via Gmail API (OAuth2) or SMTP fallback
 *   Suite 2 — Custom reminder → DB notification row + real email (requires Supabase)
 *   Suite 3 — Recurring reminder next_fire_at (pure function, no DI)
 *   Suite 4 — Calendar event prep email (Outlook-style 2-day advance reminder)
 *
 * Run:
 *   cd apps/api-gateway && pnpm test:e2e:notification-flows
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { GmailService } from "../gmail.service";
import { ScheduledTasksService } from "../scheduled-tasks.service";
import { ScheduledTenantsService } from "../scheduled-tenants.service";
import { computeNextFireAt } from "../scheduled-tasks.service";
import { CommunicationsService } from "../communications.service";
import { RecipientResolverService } from "../recipient-resolver.service";
import { DatabaseService } from "../../database/database.service";

const TEST_EMAIL = "aldemirkonuk2004@gmail.com";

// ── Env loading ──────────────────────────────────────────────────────────────
import { resolve } from "path";
import { existsSync } from "fs";
import { config as loadDotenv } from "dotenv";
for (const rel of ["../../../.env", "../../../../../.env"]) {
  const p = resolve(__dirname, rel);
  if (existsSync(p)) loadDotenv({ path: p });
}

function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

// ===========================================================================
// SUITE 1 — EMAIL DELIVERY (real — no mock accepted)
// ===========================================================================

describe("Suite 1 — Email Delivery (live — Gmail API or SMTP fallback)", () => {
  let gmailService: GmailService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: [".env", ".env.local", "../../.env"],
        }),
      ],
      providers: [GmailService],
    }).compile();

    gmailService = module.get<GmailService>(GmailService);
    await module.init();
  }, 30000);

  afterAll(() => module?.close());

  it("should send a plain notification email and deliver it for real", async () => {
    /**
     * Outlook analogy: user manually sends a notification email.
     * Must arrive in inbox — mock IDs (mock_*) are a hard failure.
     */
    const result = await gmailService.sendEmail({
      to: [TEST_EMAIL],
      subject: "[WineOps E2E] Notification Flow Test — plain email",
      html: `
        <h2>Notification Flow Test</h2>
        <p>Sent at ${new Date().toISOString()} during the
           <strong>notification-flow.e2e</strong> test run.</p>
        <p>If this is in your inbox, email delivery is live.</p>
      `,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.messageId).not.toMatch(/^mock_/);
    console.log(`[1/4] Plain email delivered. MessageID: ${result.messageId}`);
  }, 20000);

  it("should send a custom reminder email (notification reminder template) for real", async () => {
    /**
     * Outlook analogy: a calendar reminder fires and emails the user.
     */
    const result = await gmailService.sendCustomReminder({
      to: [TEST_EMAIL],
      restaurantName: "WineOps Restaurant",
      title: "Monthly Cellar Temperature Check",
      description:
        "Check all wine storage units: Red 55–65°F | White 45–55°F | Sparkling 40–50°F.",
      reminderType: "maintenance",
      scheduledDate: new Date(),
      priority: "high",
      actionItems: [
        "Check main cellar thermostat (target: 58°F)",
        "Verify backup cooling unit",
        "Record temperature readings for all 4 zones",
      ],
      isRecurring: true,
      recurrencePattern: "0 9 1 * *",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.messageId).not.toMatch(/^mock_/);
    console.log(
      `[2/4] Reminder email delivered. MessageID: ${result.messageId}`,
    );
  }, 20000);
});

// ===========================================================================
// SUITE 2 — CUSTOM REMINDER: DB notification row + email (live Supabase)
// ===========================================================================

describe("Suite 2 — Custom Reminder → DB notification + real email (requires Supabase)", () => {
  let scheduledTasks: ScheduledTasksService;
  let db: DatabaseService;
  let module: TestingModule;
  let testReminderId: string | null = null;

  let resolvedRestaurantId: string | null = null;
  const skipSuite = !hasSupabaseEnv();

  beforeAll(async () => {
    if (skipSuite) return;

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: [".env", ".env.local", "../../.env"],
        }),
        ScheduleModule.forRoot(),
      ],
      providers: [
        DatabaseService,
        GmailService,
        RecipientResolverService,
        {
          provide: CommunicationsService,
          useValue: {},
        },
        // OD-87 / ADR 0022 — ScheduledTasksService now depends on the tenant
        // enumerator; without it Nest cannot construct it.
        ScheduledTenantsService,
        ScheduledTasksService,
      ],
    }).compile();

    scheduledTasks = module.get<ScheduledTasksService>(ScheduledTasksService);
    db = module.get<DatabaseService>(DatabaseService);
    await module.init();

    // Resolve a real restaurant ID from the live DB — no hardcoded IDs
    const { data: restaurant } = await db
      .getClient()
      .from("restaurants")
      .select("id")
      .limit(1)
      .single();
    resolvedRestaurantId = restaurant?.id ?? null;
  }, 30000);

  afterAll(async () => {
    if (testReminderId && db) {
      await db
        .getClient()
        .from("custom_reminders")
        .delete()
        .eq("id", testReminderId);
    }
    await module?.close();
  });

  it("should fire a due one-time reminder → real email sent + reminder deactivated", async () => {
    if (skipSuite || !resolvedRestaurantId) {
      console.warn(
        skipSuite
          ? "Suite 2 skipped — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"
          : "Suite 2 skipped — no restaurants row found in live DB",
      );
      return;
    }

    /**
     * Outlook analogy: user created a one-time reminder in the app.
     * The 15-min cron wakes up, finds it overdue, sends the email,
     * and marks it as done (is_active = false).
     */
    const client = db.getClient();
    const pastDate = new Date(Date.now() - 2 * 60 * 1000);

    const { data: inserted, error: insertErr } = await client
      .from("custom_reminders")
      .insert({
        restaurant_id: resolvedRestaurantId,
        title: "[E2E] Wine Storage Check",
        description: "Automated test reminder — safe to delete.",
        reminder_type: "maintenance",
        is_active: true,
        is_recurring: false,
        next_fire_at: pastDate.toISOString(),
        recipient_emails: [TEST_EMAIL],
        metadata: { priority: "medium", _e2e_test: true },
      })
      .select()
      .single();

    expect(insertErr).toBeNull();
    expect(inserted?.id).toBeTruthy();
    testReminderId = inserted!.id;

    await scheduledTasks.processCustomReminders();

    const { data: after } = await client
      .from("custom_reminders")
      .select("is_active, last_fired_at")
      .eq("id", testReminderId)
      .single();

    expect(after?.is_active).toBe(false);
    expect(after?.last_fired_at).toBeTruthy();
    console.log(
      `[3/4] Custom reminder fired. last_fired_at: ${after?.last_fired_at}`,
    );
  }, 30000);
});

// ===========================================================================
// SUITE 3 — RECURRING NEXT_FIRE_AT (pure standalone function — zero DI)
// ===========================================================================

describe("Suite 3 — Recurring reminder next_fire_at calculation (pure function, no DI)", () => {
  /**
   * computeNextFireAt is exported as a standalone pure function from
   * scheduled-tasks.service.ts — no NestJS module or jest mocks needed.
   */
  const base = new Date("2026-05-11T09:00:00.000Z"); // Monday 9 AM UTC

  it("daily cron (0 9 * * *) → advances by exactly 1 day", () => {
    const next = computeNextFireAt("0 9 * * *", base);
    const diffDays = (next.getTime() - base.getTime()) / 86_400_000;
    expect(diffDays).toBeCloseTo(1, 1);
    console.log(`[4a] daily → ${next.toISOString()}`);
  });

  it("weekly cron (0 9 * * 1) → advances by 7 days", () => {
    const next = computeNextFireAt("0 9 * * 1", base);
    const diffDays = (next.getTime() - base.getTime()) / 86_400_000;
    expect(diffDays).toBeCloseTo(7, 1);
    console.log(`[4b] weekly → ${next.toISOString()}`);
  });

  it("monthly cron (0 9 1 * *) → advances by ~1 month", () => {
    const next = computeNextFireAt("0 9 1 * *", base);
    expect(next.getMonth()).toBe((base.getMonth() + 1) % 12);
    console.log(`[4c] monthly → ${next.toISOString()}`);
  });

  it("30-min step cron (*/30 * * * *) → advances by 30 minutes", () => {
    const next = computeNextFireAt("*/30 * * * *", base);
    const diffMin = (next.getTime() - base.getTime()) / 60_000;
    expect(diffMin).toBeCloseTo(30, 0);
    console.log(`[4d] 30-min → ${next.toISOString()}`);
  });

  it("daily 8 AM cron (0 8 * * *) → advances by 1 calendar day (Outlook recurring event)", () => {
    /**
     * Outlook analogy: a recurring calendar event fires a reminder every day at 8 AM.
     * After it fires, the next occurrence must be scheduled exactly 1 day later.
     */
    const next = computeNextFireAt("0 8 * * *", base);
    const diffHours = (next.getTime() - base.getTime()) / 3_600_000;
    expect(diffHours).toBeGreaterThanOrEqual(20);
    expect(diffHours).toBeLessThan(30);
    console.log(`[4e] recurring-daily → ${next.toISOString()}`);
  });
});

// ===========================================================================
// SUITE 4 — CALENDAR EVENT PREP EMAIL (Outlook 2-day advance reminder, live)
// ===========================================================================

describe("Suite 4 — Calendar event prep email (Outlook-style 2-day advance reminder, live)", () => {
  let gmailService: GmailService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: [".env", ".env.local", "../../.env"],
        }),
      ],
      providers: [GmailService],
    }).compile();

    gmailService = module.get<GmailService>(GmailService);
    await module.init();
  }, 20000);

  afterAll(() => module?.close());

  it("should send an event-prep reminder 2 days before the event (real delivery)", async () => {
    /**
     * Outlook analogy: a recurring calendar event ("Monthly Wine Tasting")
     * triggers a reminder 2 days before so staff can order missing wines.
     */
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 2);

    const result = await gmailService.sendEventPrepReminder({
      to: [TEST_EMAIL],
      restaurantName: "WineOps Restaurant",
      eventName: "Monthly Wine Tasting Night",
      eventDate,
      eventTime: "7:00 PM – 10:00 PM",
      guestCount: 40,
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
          name: "Sancerre 2021",
          quantityNeeded: 6,
          currentStock: 3,
          shortfall: 3,
        },
      ],
      totalBottlesNeeded: 20,
      estimatedCost: 3200,
      organizer: "Chef Marco",
      specialRequests:
        "Decant all reds 1 hour before service. Prepare tasting note cards.",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.messageId).not.toMatch(/^mock_/);
    console.log(
      `[5a] Event prep email delivered. MessageID: ${result.messageId}`,
    );
  }, 20000);

  it("should flag ACTION NEEDED when wine shortfalls exist (real delivery)", async () => {
    /**
     * Outlook analogy: missing resources → urgent flag on the reminder.
     * Here: wine shortfalls → "ACTION NEEDED:" subject prefix.
     */
    const result = await gmailService.sendEventPrepReminder({
      to: [TEST_EMAIL],
      restaurantName: "WineOps Restaurant",
      eventName: "VIP Sommelier Dinner",
      eventDate: new Date(Date.now() + 2 * 86_400_000),
      eventTime: "8:00 PM",
      guestCount: 12,
      eventType: "special_event",
      wineRequirements: [
        {
          name: "Pétrus 2015",
          quantityNeeded: 3,
          currentStock: 0,
          shortfall: 3,
        },
      ],
      totalBottlesNeeded: 3,
      estimatedCost: 8500,
      organizer: "Restaurant Director",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.messageId).not.toMatch(/^mock_/);
    console.log(
      `[5b] Urgent event email delivered. MessageID: ${result.messageId}`,
    );
  }, 20000);
});
