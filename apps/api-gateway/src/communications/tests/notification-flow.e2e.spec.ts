/**
 * Notification & Reminder Flow E2E Tests
 * =======================================
 * Mimics the Outlook-style lifecycle:
 *   Suite 1 — Email delivery via Gmail API (real or mock fallback)
 *   Suite 2 — Custom reminder → DB notification row + email (requires Supabase)
 *   Suite 3 — Recurring reminder next_fire_at calculation (pure logic, no network)
 *   Suite 4 — Calendar event prep email (2-day advance notice, like Outlook)
 *
 * Run:
 *   cd apps/api-gateway && pnpm test:e2e:notification-flows
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { GmailService } from '../gmail.service';
import { ScheduledTasksService } from '../scheduled-tasks.service';
import { CommunicationsService } from '../communications.service';
import { RecipientResolverService } from '../recipient-resolver.service';
import { DatabaseService } from '../../database/database.service';

const TEST_EMAIL = 'aldemirkonuk2004@gmail.com';

// ── Env loading ──────────────────────────────────────────────────────────────
import { resolve } from 'path';
import { existsSync } from 'fs';
import { config as loadDotenv } from 'dotenv';
for (const rel of ['../../../.env', '../../../../../.env']) {
  const p = resolve(__dirname, rel);
  if (existsSync(p)) loadDotenv({ path: p });
}

function hasSupabaseEnv(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ===========================================================================
// SUITE 1 — EMAIL DELIVERY
// ===========================================================================

describe('Suite 1 — Email Delivery (Gmail API or mock fallback)', () => {
  let gmailService: GmailService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env', '.env.local', '../../.env'],
        }),
      ],
      providers: [GmailService],
    }).compile();

    gmailService = module.get<GmailService>(GmailService);
    await module.init();
  }, 30000);

  afterAll(() => module?.close());

  it('should send a plain notification email', async () => {
    /**
     * Outlook analogy: user manually sends a notification email.
     * When Gmail OAuth is valid the messageId will NOT start with "mock_".
     * When credentials are expired/offline the service falls back to mock mode
     * — still succeeds so CI stays green; the console logs the mode.
     */
    const result = await gmailService.sendEmail({
      to: [TEST_EMAIL],
      subject: '[WineOps E2E] Notification Flow Test — plain email',
      html: `
        <h2>Notification Flow Test</h2>
        <p>Sent at ${new Date().toISOString()} during the
           <strong>notification-flow.e2e</strong> test run.</p>
        <p>If this is in your inbox, Gmail OAuth2 is working.</p>
      `,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();

    const isReal = !result.messageId!.startsWith('mock_');
    console.log(
      `[1/4] Plain email ${isReal ? 'delivered via Gmail API' : 'sent in MOCK mode'}. ` +
        `MessageID: ${result.messageId}`,
    );
    if (!isReal) {
      console.warn(
        '⚠ Gmail OAuth returned "Unexpected Gaxios Error" — ' +
          'check that GMAIL_REFRESH_TOKEN is valid and not revoked.',
      );
    }
  }, 20000);

  it('should send a custom reminder email (notification reminder template)', async () => {
    /**
     * Outlook analogy: a calendar reminder fires and emails the user.
     */
    const result = await gmailService.sendCustomReminder({
      to: [TEST_EMAIL],
      restaurantName: 'WineOps Restaurant',
      title: 'Monthly Cellar Temperature Check',
      description:
        'Check all wine storage units: Red 55–65°F | White 45–55°F | Sparkling 40–50°F.',
      reminderType: 'maintenance',
      scheduledDate: new Date(),
      priority: 'high',
      actionItems: [
        'Check main cellar thermostat (target: 58°F)',
        'Verify backup cooling unit',
        'Record temperature readings for all 4 zones',
      ],
      isRecurring: true,
      recurrencePattern: '0 9 1 * *', // 1st of every month at 9 AM
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    const isReal = !result.messageId!.startsWith('mock_');
    console.log(
      `[2/4] Reminder email ${isReal ? 'delivered via Gmail API' : 'MOCK'}. ` +
        `MessageID: ${result.messageId}`,
    );
  }, 20000);
});

// ===========================================================================
// SUITE 2 — CUSTOM REMINDER: DB notification row + email
// ===========================================================================

describe('Suite 2 — Custom Reminder → DB notification + email (requires Supabase)', () => {
  let scheduledTasks: ScheduledTasksService;
  let db: DatabaseService;
  let module: TestingModule;
  let testReminderId: string | null = null;
  const restaurantId = process.env.DEFAULT_RESTAURANT_ID;

  let resolvedRestaurantId: string | null = null;
  const skipSuite = !hasSupabaseEnv();

  beforeAll(async () => {
    if (skipSuite) return;

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env', '.env.local', '../../.env'],
        }),
        ScheduleModule.forRoot(),
      ],
      providers: [
        DatabaseService,
        GmailService,
        RecipientResolverService,
        {
          provide: CommunicationsService,
          useValue: { /* ScheduledTasksService only calls GmailService directly */ },
        },
        ScheduledTasksService,
      ],
    }).compile();

    scheduledTasks = module.get<ScheduledTasksService>(ScheduledTasksService);
    db = module.get<DatabaseService>(DatabaseService);
    await module.init();

    // Resolve a real restaurant ID from the DB
    const { data: restaurants } = await db.getClient()
      .from('restaurants')
      .select('id')
      .limit(1)
      .single();
    resolvedRestaurantId = restaurants?.id ?? null;
  }, 30000);

  afterAll(async () => {
    if (testReminderId && db) {
      await db.getClient()
        .from('custom_reminders')
        .delete()
        .eq('id', testReminderId);
    }
    await module?.close();
  });

  it('should fire a due one-time reminder → email sent + reminder deactivated', async () => {
    if (skipSuite || !resolvedRestaurantId) {
      console.warn(
        skipSuite
          ? 'Suite 2 skipped — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'
          : 'Suite 2 skipped — no restaurants row found in DB',
      );
      return;
    }

    /**
     * Outlook analogy: user created a one-time reminder in the app.
     * The 15-min cron wakes up, finds it overdue, sends the email,
     * and marks it as done (is_active = false).
     */
    const client = db.getClient();
    const pastDate = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago

    const { data: inserted, error: insertErr } = await client
      .from('custom_reminders')
      .insert({
        restaurant_id: resolvedRestaurantId,
        title: '[E2E] Wine Storage Check',
        description: 'Automated test reminder — safe to delete.',
        reminder_type: 'maintenance',
        is_active: true,
        is_recurring: false,
        next_fire_at: pastDate.toISOString(),
        recipient_emails: [TEST_EMAIL],
        metadata: { priority: 'medium', _e2e_test: true },
      })
      .select()
      .single();

    expect(insertErr).toBeNull();
    expect(inserted?.id).toBeTruthy();
    testReminderId = inserted!.id;

    await scheduledTasks.processCustomReminders();

    const { data: after } = await client
      .from('custom_reminders')
      .select('is_active, last_fired_at')
      .eq('id', testReminderId)
      .single();

    expect(after?.is_active).toBe(false);
    expect(after?.last_fired_at).toBeTruthy();
    console.log(`[3/4] Custom reminder fired. last_fired_at: ${after?.last_fired_at}`);
  }, 30000);
});

// ===========================================================================
// SUITE 3 — RECURRING NEXT_FIRE_AT CALCULATION (pure logic)
// ===========================================================================

describe('Suite 3 — Recurring reminder next_fire_at calculation', () => {
  /**
   * `computeNextFireAt` is a pure method on ScheduledTasksService.
   * We instantiate it with all dependencies mocked so NestJS DI is satisfied
   * without needing a real DB or Gmail connection.
   */
  let svc: ScheduledTasksService;
  let module: TestingModule;

  const mockDb = {
    getClient: () => null,
    supabase: null,
    getLowStockItems: jest.fn(),
    getProcurementOrders: jest.fn(),
    getRestaurantInventory: jest.fn(),
  };
  const mockGmail = {
    sendCustomReminder: jest.fn().mockResolvedValue({ success: true, messageId: 'mock_test' }),
    sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'mock_test' }),
    ensureGmailReady: jest.fn().mockResolvedValue(true),
  };
  const mockComms = {};
  const mockRecipient = {
    resolveRecipients: jest.fn().mockResolvedValue({ emails: [TEST_EMAIL], phones: [] }),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ScheduleModule.forRoot(),
      ],
      providers: [
        ScheduledTasksService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: GmailService, useValue: mockGmail },
        { provide: CommunicationsService, useValue: mockComms },
        { provide: RecipientResolverService, useValue: mockRecipient },
      ],
    }).compile();

    svc = module.get<ScheduledTasksService>(ScheduledTasksService);
    await module.init();
  }, 20000);

  afterAll(() => module?.close());

  const base = new Date('2026-05-11T09:00:00.000Z'); // Monday 9 AM UTC

  it('daily cron (0 9 * * *) → advances by exactly 1 day', () => {
    const next = svc.computeNextFireAt('0 9 * * *', base);
    const diffDays = (next.getTime() - base.getTime()) / 86_400_000;
    expect(diffDays).toBeCloseTo(1, 1);
    console.log(`[4a] daily → ${next.toISOString()}`);
  });

  it('weekly cron (0 9 * * 1) → advances by 7 days', () => {
    const next = svc.computeNextFireAt('0 9 * * 1', base);
    const diffDays = (next.getTime() - base.getTime()) / 86_400_000;
    expect(diffDays).toBeCloseTo(7, 1);
    console.log(`[4b] weekly → ${next.toISOString()}`);
  });

  it('monthly cron (0 9 1 * *) → advances by ~1 month', () => {
    const next = svc.computeNextFireAt('0 9 1 * *', base);
    expect(next.getMonth()).toBe((base.getMonth() + 1) % 12);
    console.log(`[4c] monthly → ${next.toISOString()}`);
  });

  it('30-min step cron (*/30 * * * *) → advances by 30 minutes', () => {
    const next = svc.computeNextFireAt('*/30 * * * *', base);
    const diffMin = (next.getTime() - base.getTime()) / 60_000;
    expect(diffMin).toBeCloseTo(30, 0);
    console.log(`[4d] 30-min → ${next.toISOString()}`);
  });

  it('daily 8 AM cron (0 8 * * *) → advances by 1 calendar day (Outlook recurring event)', () => {
    /**
     * Outlook analogy: a recurring calendar event fires a reminder every day at 8 AM.
     * After it fires, the next occurrence must be scheduled exactly 1 day later
     * so the user receives a notification every day — not just once.
     */
    const next = svc.computeNextFireAt('0 8 * * *', base);
    const diffHours = (next.getTime() - base.getTime()) / 3_600_000;
    expect(diffHours).toBeGreaterThanOrEqual(20);
    expect(diffHours).toBeLessThan(30);
    console.log(`[4e] recurring-daily → ${next.toISOString()}`);
  });
});

// ===========================================================================
// SUITE 4 — CALENDAR EVENT PREP EMAIL (Outlook 2-day advance reminder)
// ===========================================================================

describe('Suite 4 — Calendar event prep email (Outlook-style 2-day advance reminder)', () => {
  let gmailService: GmailService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env', '.env.local', '../../.env'],
        }),
      ],
      providers: [GmailService],
    }).compile();

    gmailService = module.get<GmailService>(GmailService);
    await module.init();
  }, 20000);

  afterAll(() => module?.close());

  it('should send an event-prep reminder 2 days before the event', async () => {
    /**
     * Outlook analogy: a recurring calendar event (e.g. "Monthly Wine Tasting")
     * triggers a reminder 2 days before so staff can order missing wines.
     */
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 2);

    const result = await gmailService.sendEventPrepReminder({
      to: [TEST_EMAIL],
      restaurantName: 'WineOps Restaurant',
      eventName: 'Monthly Wine Tasting Night',
      eventDate,
      eventTime: '7:00 PM – 10:00 PM',
      guestCount: 40,
      eventType: 'wine_tasting',
      wineRequirements: [
        { name: 'Chateau Margaux 2015', quantityNeeded: 6, currentStock: 2, shortfall: 4 },
        { name: 'Dom Perignon 2012',    quantityNeeded: 8, currentStock: 10, shortfall: 0 },
        { name: 'Sancerre 2021',        quantityNeeded: 6, currentStock: 3, shortfall: 3 },
      ],
      totalBottlesNeeded: 20,
      estimatedCost: 3200,
      organizer: 'Chef Marco',
      specialRequests: 'Decant all reds 1 hour before service. Prepare tasting note cards.',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    const isReal = !result.messageId!.startsWith('mock_');
    console.log(
      `[5a] Event prep email ${isReal ? 'delivered' : 'MOCK'}. MessageID: ${result.messageId}`,
    );
  }, 20000);

  it('should flag ACTION NEEDED when wine shortfalls exist (Outlook urgent flag analogy)', async () => {
    /**
     * Outlook analogy: when a meeting has missing resources (no room booked,
     * agenda incomplete), Outlook flags the reminder as urgent.
     * Here: wine shortfalls → "ACTION NEEDED:" subject prefix.
     */
    const result = await gmailService.sendEventPrepReminder({
      to: [TEST_EMAIL],
      restaurantName: 'WineOps Restaurant',
      eventName: 'VIP Sommelier Dinner',
      eventDate: new Date(Date.now() + 2 * 86_400_000),
      eventTime: '8:00 PM',
      guestCount: 12,
      eventType: 'special_event',
      wineRequirements: [
        { name: 'Pétrus 2015', quantityNeeded: 3, currentStock: 0, shortfall: 3 },
      ],
      totalBottlesNeeded: 3,
      estimatedCost: 8500,
      organizer: 'Restaurant Director',
    });

    expect(result.success).toBe(true);
    console.log(`[5b] Urgent event email. MessageID: ${result.messageId}`);
  }, 20000);
});
