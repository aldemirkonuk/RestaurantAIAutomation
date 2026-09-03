import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { CommunicationsService } from "./communications.service";
import { DatabaseService } from "../database/database.service";
import { GmailService } from "./gmail.service";
import type { EmailResult } from "./gmail.service";
import { RecipientResolverService } from "./recipient-resolver.service";
import type {
  NotificationChannel,
  RecipientRole,
  ResolvedRecipients,
} from "./recipient-resolver.service";
import { ScheduledTenantsService } from "./scheduled-tenants.service";
import type { ScheduledTenant } from "./scheduled-tenants.service";
// ORDER_ARRIVED_STATUSES went with the payment-due reminder — it was that job's
// only consumer here. See the tombstone below and ADR 0077.
import { ORDER_IN_FLIGHT_STATUSES } from "../procurement/order-status";
import {
  RECURRING_REMINDER_FLAG,
  describeRecurringOrder,
  recurringRemindersEnabled,
} from "./recurring-order-reminder";
import { interpretRead, interpretWrite } from "./scheduled-db";
import type { ReadEnvelope, ReadOutcome, WriteEnvelope } from "./scheduled-db";

/**
 * Pure function — exported for direct use in tests without NestJS DI.
 * Determines the next fire date from a 5-part cron expression.
 */
export function computeNextFireAt(
  cronExpr: string,
  from: Date = new Date(),
): Date {
  const next = new Date(from);
  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error("non-standard cron");

    const [minute, hour, dom, , dow] = parts;

    // Monthly: specific day of month (e.g. "0 9 1 * *")
    if (dom !== "*" && dow === "*") {
      next.setMonth(next.getMonth() + 1);
      return next;
    }

    // Weekly: specific day of week (e.g. "0 9 * * 1")
    if (dom === "*" && dow !== "*") {
      next.setDate(next.getDate() + 7);
      return next;
    }

    // Minute step (e.g. "*/30 * * * *")
    const minuteMatch = minute.match(/^\*\/(\d+)$/);
    if (minuteMatch && hour === "*") {
      next.setMinutes(next.getMinutes() + parseInt(minuteMatch[1], 10));
      return next;
    }

    // Fixed hour = daily
    if (hour !== "*") {
      next.setDate(next.getDate() + 1);
      return next;
    }

    next.setDate(next.getDate() + 1);
  } catch {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * OD-87 / ADR 0022 — every job in this file runs once per tenant.
 *
 * Each cron used to gate on a single `DEFAULT_RESTAURANT_ID` env var, so every
 * restaurant except that one silently received no email, SMS or notification.
 * The jobs now iterate `ScheduledTenantsService.runPerTenant`, which enumerates
 * the opted-in restaurants, isolates one tenant's failure from the rest, and
 * logs a {succeeded, failed} summary per run.
 *
 * MANAGER_EMAIL / MANAGER_PHONE remain, because they still describe exactly one
 * restaurant: the legacy default. They are never applied to any other tenant —
 * see `recipientsFor`.
 */
@Injectable()
export class ScheduledTasksService implements OnModuleInit {
  private readonly logger = new Logger(ScheduledTasksService.name);
  private managerPhone: string | null = null;
  private managerEmails: string[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly communicationsService: CommunicationsService,
    private readonly databaseService: DatabaseService,
    private readonly gmailService: GmailService,
    private readonly recipientResolver: RecipientResolverService,
    private readonly tenants: ScheduledTenantsService,
  ) {}

  async onModuleInit() {
    this.managerPhone = this.configService.get<string>("MANAGER_PHONE") || null;
    const emailConfig = this.configService.get<string>("MANAGER_EMAIL") || "";
    this.managerEmails = emailConfig
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e);

    this.logger.log("Scheduled tasks service initialized");
    this.logger.log(`Manager Emails: ${this.managerEmails.join(", ")}`);
    this.logger.log(`Manager Phone: ${this.managerPhone || "Not configured"}`);
  }

  /**
   * Recipients for one tenant — the single place where "who gets this" is
   * decided, so the legacy carve-out exists once instead of in nine jobs.
   *
   * `legacyEnv` marks the two jobs that historically read MANAGER_EMAIL /
   * MANAGER_PHONE directly rather than going through the resolver (the daily SMS
   * summary and the weekly email report). For the legacy tenant those jobs keep
   * reading exactly those env vars, so that restaurant's recipient list does not
   * move by a single address as part of a multi-tenancy fix. Every other tenant
   * — and every other job — resolves against its own members, with the env
   * fallback disabled so nothing can spill across the tenant boundary.
   */
  private async recipientsFor(
    tenant: ScheduledTenant,
    opts: {
      roles: RecipientRole[];
      channels: NotificationChannel[];
      legacyEnv?: boolean;
    },
  ): Promise<ResolvedRecipients> {
    if (tenant.isLegacyDefault && opts.legacyEnv) {
      return {
        emails: opts.channels.includes("email") ? this.managerEmails : [],
        phones:
          opts.channels.includes("sms") && this.managerPhone
            ? [this.managerPhone]
            : [],
      };
    }

    return this.recipientResolver.resolveRecipients({
      restaurantId: tenant.id,
      roles: opts.roles,
      channels: opts.channels,
      allowDefaultFallback: tenant.isLegacyDefault,
    });
  }

  /**
   * Phase 4 — nightly tenant-isolation assertion (runs every day at 3:15 AM).
   * Calls the tenant_isolation_report() SQL function and logs a WARNING when any orphaned-row
   * count is non-zero, so cross-tenant leakage / misattribution surfaces before a human notices.
   * Best-effort: never throws, never blocks other crons.
   */
  @Cron("15 3 * * *", {
    name: "tenant-isolation-check",
    timeZone: "America/New_York",
  })
  async checkTenantIsolation() {
    try {
      const { data, error } = await this.databaseService.supabase.rpc(
        "tenant_isolation_report",
      );
      if (error) {
        this.logger.warn(
          `Tenant isolation check unavailable: ${error.message}`,
        );
        return;
      }
      const report = (data ?? {}) as Record<string, number | string>;
      const orphaned =
        Number(report.prospects_orphaned ?? 0) +
        Number(report.inbound_addr_orphaned ?? 0);
      if (orphaned > 0) {
        this.logger.error(
          `TENANT_ISOLATION_VIOLATION ${JSON.stringify(report)}`,
        );
      } else {
        this.logger.log(`Tenant isolation OK ${JSON.stringify(report)}`);
      }
    } catch (e: any) {
      this.logger.warn(`Tenant isolation check failed: ${e?.message}`);
    }
  }

  /**
   * Daily SMS Summary - Runs every day at 9:00 AM
   */
  @Cron("0 9 * * *", {
    name: "daily-sms-summary",
    timeZone: "America/New_York",
  })
  async sendDailySMSSummary() {
    await this.tenants.runPerTenant("daily-sms-summary", async (tenant) => {
      const { phones } = await this.recipientsFor(tenant, {
        roles: ["manager"],
        channels: ["sms"],
        legacyEnv: true,
      });
      if (phones.length === 0) {
        this.logger.log(
          `Daily SMS summary skipped for ${tenant.name}: no phone recipients`,
        );
        return;
      }

      const summaryData = await this.getDailySummaryData(tenant.id);

      for (const phone of phones) {
        await this.communicationsService.sendDailySummary({
          recipientPhone: phone,
          restaurantName: tenant.name,
          lowStockCount: summaryData.lowStockCount,
          pendingOrders: summaryData.pendingOrders,
        });
      }
    });
  }

  /**
   * Weekly Email Report - Runs every Monday at 8:00 AM
   */
  @Cron("0 8 * * 1", {
    name: "weekly-email-report",
    timeZone: "America/New_York",
  })
  async sendWeeklyEmailReport() {
    await this.tenants.runPerTenant("weekly-email-report", async (tenant) => {
      const reportsMode = await this.getEffectiveCategoryMode(
        tenant.id,
        "reports",
      );
      if (!reportsMode.enabled) {
        this.logger.log(
          `Weekly report skipped for ${tenant.name}: reports notifications off`,
        );
        return;
      }

      const reportData = await this.getWeeklyReportData(tenant.id);

      if (reportsMode.email) {
        const { emails } = await this.recipientsFor(tenant, {
          roles: ["manager"],
          channels: ["email"],
          legacyEnv: true,
        });
        if (emails.length > 0) {
          await this.communicationsService.sendWeeklyReport({
            recipientEmails: emails,
            restaurantId: tenant.id,
            reportData,
          });
        } else {
          this.logger.log(
            `Weekly report email skipped for ${tenant.name}: no email recipients`,
          );
        }
      }

      await this.persistRestaurantNotification(tenant.id, {
        type: "report",
        title: "📊 Weekly report ready",
        message: `${reportData.lowStockCount} low-stock · ${reportData.totalBottles} bottles on hand. Tap to view the full weekly report.`,
        actionUrl: "/reports?type=weekly",
        actionLabel: "View Report",
        groupKey: `weekly_report:${new Date().toISOString().slice(0, 10)}`,
        metadata: {
          lowStockCount: reportData.lowStockCount,
          totalBottles: reportData.totalBottles,
        },
      });
    });
  }

  /**
   * @deprecated Superseded by `LowStockAlertsService` (notifications module),
   * which batches all low-stock wines into ONE digest email + one grouped inbox
   * notification instead of looping one email per wine. The `@Cron` schedule was
   * removed so the two paths don't double-send; the method is kept for manual
   * back-compat only.
   */
  async sendMiddayLowStockReport() {
    await this.tenants.runPerTenant(
      "midday-low-stock-report",
      async (tenant) => {
        const recipients = await this.recipientsFor(tenant, {
          roles: ["manager"],
          channels: ["email", "sms"],
          legacyEnv: true,
        });
        if (recipients.emails.length === 0) {
          this.logger.log(
            `Midday low stock report skipped for ${tenant.name}: no email recipients`,
          );
          return;
        }

        const lowStockItems = await this.getLowStockItems(tenant.id);
        if (lowStockItems.length === 0) return;

        for (const item of lowStockItems) {
          await this.communicationsService.sendLowStockAlert(
            {
              wineName: item.wineName,
              wineId: item.wineId,
              currentStock: item.currentStock,
              threshold: item.threshold,
              restaurantId: tenant.id,
            },
            {
              emails: recipients.emails,
              phones: recipients.phones.length ? recipients.phones : undefined,
            },
          );
        }

        this.logger.log(
          `Midday low stock report for ${tenant.name}: alerted on ${lowStockItems.length} items.`,
        );
      },
    );
  }

  /**
   * Critical low-stock email alerts — hourly cron removed (was noisy).
   * Use midday report (sendMiddayLowStockReport) or trigger manually when needed.
   */
  async checkLowStockAlerts() {
    await this.tenants.runPerTenant("low-stock-alerts", async (tenant) => {
      const recipients = await this.recipientsFor(tenant, {
        roles: ["manager"],
        channels: ["email", "sms"],
        legacyEnv: true,
      });
      if (recipients.emails.length === 0) {
        this.logger.log(
          `Low stock check skipped for ${tenant.name}: no email recipients`,
        );
        return;
      }

      const inventory = await this.databaseService.getRestaurantInventory(
        tenant.id,
      );
      if (!inventory?.length) return;

      const lowStockItems = await this.getLowStockItems(tenant.id);

      for (const item of lowStockItems) {
        // Only alert for critical items (50% below threshold)
        if (item.currentStock <= item.threshold * 0.5) {
          await this.communicationsService.sendLowStockAlert(
            {
              wineName: item.wineName,
              wineId: item.wineId,
              currentStock: item.currentStock,
              threshold: item.threshold,
              restaurantId: tenant.id,
            },
            {
              emails: recipients.emails,
              phones: recipients.phones.length ? recipients.phones : undefined,
            },
          );
        }
      }
    });
  }

  // ==========================================================================
  // NEW CRON JOBS: Recurring Orders, Delivery ETA, Payment Due, Audit, Events
  // ==========================================================================

  /**
   * Recurring Order Reminder — runs daily at 08:00 America/New_York.
   *
   * Tells a tenant that a row in `recurring_orders` comes due in two days.
   *
   * WHY THIS READS `recurring_orders` AND NOT A `procurement_orders` STATUS
   * ----------------------------------------------------------------------
   * It used to filter `procurement_orders` on `status = 'RECURRING'`. There is
   * no RECURRING member of `ProcurementOrderStatus` and there never has been,
   * so the query matched zero rows and this reminder has never sent a single
   * email since it was written.
   *
   * The repoint is not a guess between candidate statuses. The query's three
   * OTHER fields were already `recurring_orders` fields and had been all along:
   * `next_order_date` is a `recurring_orders` column and exists on no other
   * table; `recurrence_frequency` is a Postgres ENUM TYPE, whose column on that
   * table is plainly `frequency`; and `target_price_per_bottle` exists in no
   * table in the schema at all. `procurement_orders` carries none of the three.
   * The job was always addressing `recurring_orders` — it was pointed at the
   * wrong table, and the dead status was the symptom rather than the disease.
   * See ADR 0061.
   *
   * OFF BY DEFAULT — this path emails real tenants. The whole job is gated on
   * RECURRING_ORDER_REMINDERS_ENABLED and returns before it reads, resolves a
   * recipient or sends anything while that is unset. The ADR records what must
   * be true before it is flipped; flipping it is the founder's call.
   */
  @Cron("0 8 * * *", {
    name: "recurring-order-reminder",
    timeZone: "America/New_York",
  })
  async sendRecurringOrderReminders() {
    if (!this.recurringRemindersArmed()) {
      this.logger.log(
        `recurring-order-reminder skipped — ${RECURRING_REMINDER_FLAG} is not set. ` +
          "This job is off by default and sends nothing until it is armed.",
      );
      return;
    }

    await this.tenants.runPerTenant(
      "recurring-order-reminder",
      async (tenant) => {
        const ordersMode = await this.getEffectiveCategoryMode(
          tenant.id,
          "orders",
        );
        if (!ordersMode.enabled) return;

        const client = this.databaseService.getClient();
        const twoDaysFromNow = new Date();
        twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
        const twoDaysStr = twoDaysFromNow.toISOString().split("T")[0];

        // Schedules coming due within two days, for this tenant only.
        const read = this.readRows<any>(
          "recurring-order-reminder",
          "recurring_orders",
          await client
            .from("recurring_orders")
            .select("*")
            .eq("restaurant_id", tenant.id)
            .eq("active", true)
            .lte("next_order_date", twoDaysStr)
            .order("next_order_date", { ascending: true }),
        );
        if (!read.ok) return;
        const schedules = read.rows;
        if (schedules.length === 0) return;

        const recipients = await this.recipientsFor(tenant, {
          roles: ["manager"],
          channels: ["email"],
        });

        const labels: string[] = [];
        for (const row of schedules) {
          const described = describeRecurringOrder(row);
          if (!described.sendable) {
            // Fail closed and say so. A row we cannot name or price is not
            // downgraded into a vaguer email — it is not emailed at all, and
            // the gap is named in the log rather than inferred from silence.
            this.logger.warn(
              `recurring-order-reminder: schedule ${row.id ?? "?"} not describable ` +
                `(missing ${described.missing.join(", ")}); no email sent for it.`,
            );
            if (described.label) labels.push(described.label);
            continue;
          }
          labels.push(described.label);

          if (!ordersMode.email || recipients.emails.length === 0) continue;
          await this.gmailService.sendRecurringOrderReminder({
            to: recipients.emails,
            restaurantName: tenant.name,
            orderName: described.label,
            providerName: described.providerName,
            scheduledDate: described.scheduledDate,
            items: [
              {
                name: described.label,
                quantity: described.quantity,
                unitPrice: described.unitPrice,
              },
            ],
            totalAmount: described.totalAmount,
            frequency: described.frequency,
          });
        }

        await this.persistRestaurantNotification(tenant.id, {
          type: "order_pending",
          title: `🔁 ${schedules.length} recurring order${schedules.length === 1 ? "" : "s"} due soon`,
          message:
            labels.length > 0
              ? labels.slice(0, 5).join(", ")
              : `Due by ${twoDaysStr}`,
          actionUrl: "/orders?tab=recurring",
          actionLabel: "Review Orders",
          groupKey: `recurring_order:${twoDaysStr}`,
          metadata: { count: schedules.length },
        });
      },
    );
  }

  /**
   * Read the arming flag. ConfigService first, `process.env` second — the same
   * order `GmailService` already uses, so a Railway-set variable and a
   * `.env`-set one behave identically.
   */
  private recurringRemindersArmed(): boolean {
    return recurringRemindersEnabled(
      this.configService.get<string>(RECURRING_REMINDER_FLAG) ??
        process.env[RECURRING_REMINDER_FLAG],
    );
  }

  /**
   * Delivery ETA Notification - Runs daily at 5:00 PM
   * Checks for deliveries arriving tomorrow
   */
  @Cron("0 17 * * *", {
    name: "delivery-eta-notification",
    timeZone: "America/New_York",
  })
  async sendDeliveryETANotifications() {
    await this.tenants.runPerTenant(
      "delivery-eta-notification",
      async (tenant) => {
        const ordersMode = await this.getEffectiveCategoryMode(
          tenant.id,
          "orders",
        );
        if (!ordersMode.enabled) return;

        const client = this.databaseService.getClient();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split("T")[0];

        // Query orders with delivery expected tomorrow
        const read = this.readRows<any>(
          "delivery-eta-notification",
          "procurement_orders",
          await client
            .from("procurement_orders")
            .select("*, providers(name)")
            .eq("restaurant_id", tenant.id)
            .in("status", ORDER_IN_FLIGHT_STATUSES)
            .lte("expected_delivery_date", tomorrowStr + "T23:59:59")
            .gte("expected_delivery_date", tomorrowStr + "T00:00:00"),
        );
        if (!read.ok) return;
        const deliveries = read.rows;
        if (deliveries.length === 0) return;

        const recipients = await this.recipientsFor(tenant, {
          roles: ["manager", "staff"],
          channels: ["email"],
        });

        for (const delivery of deliveries) {
          if (!ordersMode.email || recipients.emails.length === 0) continue;
          await this.gmailService.sendDeliveryETANotification({
            to: recipients.emails,
            restaurantName: tenant.name,
            orderId:
              delivery.order_number || delivery.id?.substring(0, 8) || "N/A",
            providerName: delivery.providers?.name || "Unknown Provider",
            expectedDate: delivery.expected_delivery_date || tomorrowStr,
            items: [
              {
                name: delivery.wine_name || "Wine",
                quantity: delivery.quantity || 0,
              },
            ],
            totalItems: delivery.quantity || 0,
          });
        }

        await this.persistRestaurantNotification(tenant.id, {
          type: "delivery_scheduled",
          title: `📦 ${deliveries.length} deliver${deliveries.length === 1 ? "y" : "ies"} arriving tomorrow`,
          message: deliveries
            .map((d) => d.wine_name || "Wine")
            .slice(0, 5)
            .join(", "),
          actionUrl: "/orders",
          actionLabel: "View Orders",
          groupKey: `delivery_eta:${tomorrowStr}`,
          metadata: { count: deliveries.length },
        });
      },
    );
  }

  /**
   * There is no payment-due reminder, and this note is where it was.
   *
   * `sendPaymentDueReminders()` queried `procurement_orders` with a three-clause
   * window on `payment_due_date`. No table in the schema declares that column —
   * not this one, not any — so PostgREST answered 42703, the whole query failed,
   * and `if (!invoices || invoices.length === 0) return;` read that as "nothing
   * is due". The cron ran at 09:00 every day of its life and sent zero emails.
   *
   * It was deleted rather than repaired because the column was not the only
   * thing missing. The same job read `payment_terms`,
   * `final_price_per_bottle` and `negotiated_price_per_bottle` off
   * `procurement_orders`, which has none of them — so the amount would have
   * rendered $0.00 — and linked to `/orders?status=invoiced`, a status
   * `ProcurementOrderStatus` does not contain. No table anywhere carries a paid
   * state, so nothing could have told a due invoice from a settled one. This was
   * a stub for an accounts-payable module that was never built, not a feature
   * with a typo in it.
   *
   * See ADR 0077 for what building it would actually require. The delivery half
   * survives and is covered by tests — `paymentDueTemplate`,
   * `GmailService.sendPaymentDueReminder`, the `payment_due` notification type
   * and its icon in `Notifications.tsx` — so AP starts from a working mailer.
   */

  /**
   * Inventory Audit Reminder - Runs every Monday at 7:00 AM
   */
  @Cron("0 7 * * 1", {
    name: "inventory-audit-reminder",
    timeZone: "America/New_York",
  })
  async sendInventoryAuditReminder() {
    await this.tenants.runPerTenant(
      "inventory-audit-reminder",
      async (tenant) => {
        const recipients = await this.recipientsFor(tenant, {
          roles: ["manager", "staff"],
          channels: ["email"],
        });
        if (recipients.emails.length === 0) return;

        // Get inventory summary
        const inventory = await this.databaseService.getRestaurantInventory(
          tenant.id,
        );
        const lowStockItems = await this.databaseService.getLowStockItems(
          tenant.id,
        );

        const totalBottles =
          inventory?.reduce((sum, item) => sum + (item.stock_live || 0), 0) ||
          0;
        const totalValue = this.valueInventory(inventory);

        const scheduledDate = new Date();
        // Schedule audit for the upcoming Wednesday
        scheduledDate.setDate(scheduledDate.getDate() + 2);

        await this.gmailService.sendInventoryAuditReminder({
          to: recipients.emails,
          restaurantName: tenant.name,
          scheduledDate,
          scheduledTime: "10:00 AM",
          totalBottles,
          totalValue,
          discrepancyCount: lowStockItems?.length || 0,
          focusAreas:
            lowStockItems?.slice(0, 3).map((item) => ({
              area: item.wine_name || "Unknown Wine",
              reason: `Current stock (${item.stock_live || 0}) is below threshold (${item.threshold_min || 10})`,
            })) || [],
          notes: "Please count all bottles and compare with system records.",
        });
      },
    );
  }

  /**
   * Event Preparation Check - Runs daily at 8:00 AM
   * Checks for events happening in 2 days
   */
  @Cron("0 8 * * *", {
    name: "event-prep-check",
    timeZone: "America/New_York",
  })
  async sendEventPrepReminders() {
    await this.tenants.runPerTenant("event-prep-check", async (tenant) => {
      const client = this.databaseService.getClient();
      const twoDaysFromNow = new Date();
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      const targetDate = twoDaysFromNow.toISOString().split("T")[0];

      // Query calendar events happening in 2 days
      const read = this.readRows<any>(
        "event-prep-check",
        "calendar_events",
        await client
          .from("calendar_events")
          .select("*")
          .eq("restaurant_id", tenant.id)
          .gte("event_date", targetDate + "T00:00:00")
          .lte("event_date", targetDate + "T23:59:59"),
      );
      if (!read.ok) return;
      const events = read.rows;
      if (events.length === 0) return;

      const recipients = await this.recipientsFor(tenant, {
        roles: ["manager", "staff"],
        channels: ["email"],
      });
      if (recipients.emails.length === 0) return;

      for (const event of events) {
        await this.gmailService.sendEventPrepReminder({
          to: recipients.emails,
          restaurantName: tenant.name,
          eventName: event.title || event.name || "Upcoming Event",
          eventDate: event.event_date || targetDate,
          eventTime: event.event_time,
          guestCount: event.guest_count,
          eventType: event.event_type || "special_event",
          organizer: event.organizer,
          specialRequests: event.special_requests || event.notes,
        });
      }
    });
  }

  /**
   * Custom Reminders Check - Runs every 15 minutes.
   * Fires any custom reminders that are due:
   *   1. Sends a Gmail email to recipients.
   *   2. Writes a `notifications` DB row so the alert appears in the in-app inbox.
   *   3. Advances next_fire_at based on the cron expression (not a crude +7 days).
   */
  @Cron("*/15 * * * *", {
    name: "custom-reminders-check",
  })
  async processCustomReminders() {
    await this.tenants.runPerTenant(
      "custom-reminders-check",
      async (tenant) => {
        const client = this.databaseService.getClient();
        const now = new Date();

        // Scoped to this tenant. The query used to run ONCE, unfiltered, and then
        // gate every reminder it found on `DEFAULT_RESTAURANT_ID`'s inventory and
        // fall back to `DEFAULT_RESTAURANT_ID`'s manager email — so a second
        // restaurant's reminder was decided by the first restaurant's stock and
        // mailed to the first restaurant's manager. `custom_reminders` is empty in
        // production (verified 2026-08-26), so nothing has been misdelivered yet.
        const read = this.readRows<any>(
          "custom-reminders-check",
          "custom_reminders",
          await client
            .from("custom_reminders")
            .select("*")
            .eq("restaurant_id", tenant.id)
            .eq("is_active", true)
            .lte("next_fire_at", now.toISOString())
            .order("next_fire_at", { ascending: true })
            .limit(20),
        );
        if (!read.ok) return;
        const reminders = read.rows;
        if (reminders.length === 0) return;

        for (const reminder of reminders) {
          const invTypes = new Set([
            "low_stock",
            "inventory",
            "inventory_audit",
          ]);
          if (
            invTypes.has(String(reminder.reminder_type || "").toLowerCase())
          ) {
            const inventoryRows =
              await this.databaseService.getRestaurantInventory(tenant.id);
            if (!inventoryRows?.length) {
              this.logger.log(
                `Custom reminder "${reminder.title}" (${reminder.id}) skipped: no inventory rows (${reminder.reminder_type})`,
              );
              if (reminder.is_recurring && reminder.schedule_cron) {
                const nextFire = this.computeNextFireAt(
                  reminder.schedule_cron,
                  now,
                );
                this.wrote(
                  "custom-reminders-check",
                  "custom_reminders",
                  `the advance of reminder ${reminder.id} to ${nextFire.toISOString()} — ` +
                    "it stays due, so the 15-minute cron will send it again",
                  await client
                    .from("custom_reminders")
                    .update({
                      last_fired_at: now.toISOString(),
                      next_fire_at: nextFire.toISOString(),
                    })
                    .eq("id", reminder.id),
                );
              } else {
                this.wrote(
                  "custom-reminders-check",
                  "custom_reminders",
                  `the deactivation of one-off reminder ${reminder.id} — ` +
                    "it stays active and due, so it will be sent again",
                  await client
                    .from("custom_reminders")
                    .update({
                      last_fired_at: now.toISOString(),
                      is_active: false,
                    })
                    .eq("id", reminder.id),
                );
              }
              continue;
            }
          }

          // Resolve email recipients
          let emails: string[] = reminder.recipient_emails || [];
          if (emails.length === 0 && reminder.recipient_roles?.length > 0) {
            const recipients = await this.recipientsFor(tenant, {
              roles: reminder.recipient_roles,
              channels: ["email"],
            });
            emails = recipients.emails;
          }
          if (emails.length === 0 && tenant.isLegacyDefault) {
            // Only the legacy tenant may fall back to the global env address —
            // for anyone else that address belongs to a different restaurant.
            emails = this.managerEmails;
          }

          // 1. Send email (skip when no recipients — avoids Gmail errors / surprise fallback)
          let emailResult: EmailResult = { success: false };
          if (emails.length > 0) {
            emailResult = await this.gmailService.sendCustomReminder({
              to: emails,
              restaurantName: tenant.name,
              title: reminder.title,
              description: reminder.description || "",
              reminderType: reminder.reminder_type || "custom",
              scheduledDate: reminder.next_fire_at,
              priority: reminder.metadata?.priority || "medium",
              actionItems: reminder.metadata?.action_items || [],
              isRecurring: reminder.is_recurring,
              recurrencePattern: reminder.schedule_cron,
            });
          } else {
            this.logger.log(
              `Custom reminder "${reminder.title}" (${reminder.id}): no email recipients — in-app notification only`,
            );
          }

          // 2. Write a notifications row (so it appears in the in-app inbox)
          const notifUserId = reminder.created_by || null;
          if (notifUserId) {
            // No try/catch around the database error: supabase-js RETURNS it.
            // The outer try still guards genuine exceptions (a dead socket).
            {
              const inserted = await client.from("notifications").insert({
                user_id: notifUserId,
                recipient_id: notifUserId,
                notification_type: "custom_reminder",
                channels: ["in_app"],
                restaurant_id: tenant.id,
                type: "custom_reminder",
                title: reminder.title,
                message: reminder.description || reminder.title,
                priority: reminder.metadata?.priority || "medium",
                status: "unread",
                action_url: "/notifications",
                action_label: "View Reminder",
                metadata: {
                  reminder_id: reminder.id,
                  reminder_type: reminder.reminder_type,
                  email_sent: emailResult.success,
                  email_message_id: emailResult.messageId,
                },
                created_at: now.toISOString(),
              });
              this.wrote(
                "custom-reminders-check",
                "notifications",
                `the in-app notification for reminder ${reminder.id} ` +
                  `("${reminder.title}") addressed to user ${notifUserId}`,
                inserted,
              );
            }
          }

          // 3. Advance or deactivate
          if (reminder.is_recurring && reminder.schedule_cron) {
            const nextFire = this.computeNextFireAt(
              reminder.schedule_cron,
              now,
            );
            this.wrote(
              "custom-reminders-check",
              "custom_reminders",
              `the advance of reminder ${reminder.id} to ${nextFire.toISOString()} — ` +
                "it stays due, so the 15-minute cron will send it again",
              await client
                .from("custom_reminders")
                .update({
                  last_fired_at: now.toISOString(),
                  next_fire_at: nextFire.toISOString(),
                })
                .eq("id", reminder.id),
            );
          } else {
            this.wrote(
              "custom-reminders-check",
              "custom_reminders",
              `the deactivation of one-off reminder ${reminder.id} — ` +
                "it stays active and due, so it will be sent again",
              await client
                .from("custom_reminders")
                .update({ last_fired_at: now.toISOString(), is_active: false })
                .eq("id", reminder.id),
            );
          }
        }

        this.logger.log(
          `Processed ${reminders.length} custom reminders for ${tenant.name}`,
        );
      },
    );
  }

  /**
   * Compute the next fire time for a recurring reminder by parsing the cron expression.
   *
   * Supported patterns (covers the common Outlook-like frequencies):
   *   - Every N minutes: * /N * * * *  → advance by N minutes
   *   - Hourly:          0 * * * *      → advance by 1 hour
   *   - Daily at HH:MM:  MM HH * * *   → advance by 1 day
   *   - Weekly (any dow): MM HH * * N  → advance by 7 days
   *   - Monthly (dom N): MM HH N * *  → advance by ~30 days (next same DOM)
   *
   * Falls back to +1 day when the expression cannot be parsed.
   */
  computeNextFireAt(cronExpr: string, from: Date = new Date()): Date {
    const next = new Date(from);
    try {
      const parts = cronExpr.trim().split(/\s+/);
      if (parts.length !== 5) throw new Error("non-standard cron");

      const [minute, hour, dom, month, dow] = parts;

      // Monthly: specific day of month (e.g. "0 9 1 * *" = 1st of month at 9am)
      if (dom !== "*" && dow === "*") {
        next.setMonth(next.getMonth() + 1);
        return next;
      }

      // Weekly: specific day of week (e.g. "0 9 * * 1" = every Monday)
      if (dom === "*" && dow !== "*") {
        next.setDate(next.getDate() + 7);
        return next;
      }

      // Hourly step (e.g. "*/30 * * * *" = every 30 minutes)
      const minuteMatch = minute.match(/^\*\/(\d+)$/);
      if (minuteMatch && hour === "*") {
        next.setMinutes(next.getMinutes() + parseInt(minuteMatch[1], 10));
        return next;
      }

      // Fixed hour, any minute = daily
      if (hour !== "*") {
        next.setDate(next.getDate() + 1);
        return next;
      }

      // Default: daily
      next.setDate(next.getDate() + 1);
    } catch {
      // Fallback: +1 day
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  /**
   * Every scheduled read goes through here, so that "the query failed" can
   * never again arrive at a caller looking like "there was nothing to send".
   *
   * Logs at ERROR, not WARN. A scheduled job that cannot read is not degraded,
   * it is not running — and the three crons this file has lost each looked
   * perfectly healthy from the outside for months.
   */
  private readRows<T>(
    job: string,
    table: string,
    envelope: ReadEnvelope<T> | null | undefined,
  ): ReadOutcome<T> {
    const outcome = interpretRead<T>(job, table, envelope);
    if (!outcome.ok) this.logger.error(outcome.reason);
    return outcome;
  }

  /**
   * Every scheduled write goes through here.
   *
   * The `try/catch` these calls used to sit inside was inert: supabase-js
   * RETURNS `{ error }` for a database error rather than throwing, so there was
   * nothing for the catch to catch, and a failed insert looked exactly like a
   * successful one. `what` names the rows that did not land, because a row that
   * was never written cannot be found by querying for it afterwards — the log
   * line is the only trace it was supposed to exist.
   */
  private wrote(
    job: string,
    table: string,
    what: string,
    envelope: WriteEnvelope | null | undefined,
  ): boolean {
    const outcome = interpretWrite(job, table, what, envelope);
    if (!outcome.ok) this.logger.error(outcome.reason);
    return outcome.ok;
  }

  // ==========================================================================
  // MANUAL TRIGGER METHODS (for testing)
  // ==========================================================================

  async triggerRecurringOrderReminders(): Promise<void> {
    await this.sendRecurringOrderReminders();
  }

  async triggerDeliveryETANotifications(): Promise<void> {
    await this.sendDeliveryETANotifications();
  }

  async triggerInventoryAuditReminder(): Promise<void> {
    await this.sendInventoryAuditReminder();
  }

  async triggerEventPrepReminders(): Promise<void> {
    await this.sendEventPrepReminders();
  }

  /**
   * Daily summary figures for one restaurant.
   *
   * ADR 0020 — this used to swallow a database failure and return a fixture
   * (5 low-stock, 3 pending orders, 1 delivery), which was then SMSed to the
   * manager as fact. The same fabrication was removed from the weekly email
   * under OD-85; the SMS path was missed.
   *
   * WHERE THE THROW COMES FROM (ADR 0084 — the comment used to say "it now
   * throws" without saying that, and a reader checking the body found no
   * `throw` and reasonably concluded the fix had never landed). There is no
   * `throw` here and there should not be: both reads throw for us.
   * `DatabaseService.getLowStockItems` and `.getProcurementOrders` each end
   * `if (error) throw error`, so a failed query propagates out of this method
   * and `runPerTenant` counts the tenant `failed`. The `|| 0`s below are
   * reached only on a SUCCESSFUL read that returned no rows, where zero is the
   * measured answer.
   *
   * `deliveriesToday` is gone (ADR 0084). It was the literal `0` that the
   * removed fixture's `1` had been replaced with, carrying the comment "Would
   * need to query deliveries table", and `SmsService.sendDailySummary` printed
   * it to the manager beside two real figures as though it were a third.
   */
  private async getDailySummaryData(restaurantId: string): Promise<{
    lowStockCount: number;
    pendingOrders: number;
  }> {
    const lowStockItems =
      await this.databaseService.getLowStockItems(restaurantId);
    const pendingOrders = await this.databaseService.getProcurementOrders(
      restaurantId,
      "pending",
    );

    return {
      lowStockCount: lowStockItems?.length || 0,
      pendingOrders: pendingOrders?.length || 0,
    };
  }

  /**
   * Value on-hand stock at what it actually cost.
   *
   * Both the weekly report and the Monday audit reminder used to mail the
   * bottle count multiplied by an invented flat $50, which made a cellar of
   * house red and a cellar of grand cru report the same figure. Rows with no price on
   * file contribute bottles but no value, so the total UNDERSTATES a partially
   * priced inventory. That is a different and far safer error than a made-up
   * unit price, and it moves toward the truth as costs get recorded.
   */
  private valueInventory(
    inventory: Array<Record<string, any>> | null | undefined,
  ): number {
    return (
      inventory?.reduce((sum, item) => {
        const unit =
          item.last_purchase_price ??
          item.custom_price ??
          item.negotiated_price;
        if (unit == null) return sum;
        const price = Number(unit);
        if (!Number.isFinite(price)) return sum;
        return sum + price * (item.stock_live || 0);
      }, 0) || 0
    );
  }

  /**
   * Real top sellers for the last 7 days, from `wine_consumption_log`.
   *
   * Only lines that recorded a `total_revenue` are counted — into BOTH `sold`
   * and `revenue`. The email prints the two side by side, so they have to
   * describe the same set of sales: five bottles next to $90 of revenue reads
   * as three bottles given away. A wine with no priced line at all does not
   * appear, and if nothing is priced the whole section disappears (the template
   * drops it on an empty array).
   *
   * Never throws: a failure here must not cost the manager the rest of the
   * report, and an empty list is the honest answer to "we could not read it".
   */
  private async getWeeklyTopSellers(
    restaurantId: string,
  ): Promise<Array<{ name: string; sold: number; revenue: number }>> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data, error } = await this.databaseService
        .getClient()
        .from("wine_consumption_log")
        .select("wine_name, quantity, total_revenue")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", sevenDaysAgo.toISOString());
      if (error) throw new Error(error.message);

      const byWine = new Map<string, { sold: number; revenue: number }>();
      for (const row of data || []) {
        if (row.total_revenue == null) continue;
        const revenue = Number(row.total_revenue);
        if (!Number.isFinite(revenue)) continue;
        const name = row.wine_name || "Unnamed wine";
        const acc = byWine.get(name) || { sold: 0, revenue: 0 };
        acc.sold += Number(row.quantity) || 0;
        acc.revenue += revenue;
        byWine.set(name, acc);
      }

      return Array.from(byWine.entries())
        .map(([name, v]) => ({ name, sold: v.sold, revenue: v.revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
    } catch (error: any) {
      this.logger.warn(
        `Weekly top sellers unavailable (section omitted): ${error?.message}`,
      );
      return [];
    }
  }

  /**
   * Get weekly report data from database.
   *
   * ADR 0020 — every figure below is read, never assumed. This method used to
   * hard-code a top-sellers table and value inventory at a flat $50/bottle, and
   * both went out over email under the restaurant's own name where the reader
   * had no way to tell them from measured numbers. When the data is missing the
   * section is now ABSENT: the template omits Top Sellers and the low-stock
   * table on an empty array, which is a truthful email.
   */
  private async getWeeklyReportData(restaurantId: string): Promise<{
    totalBottles: number;
    lowStockCount: number;
    totalValue: number;
    topSellers: Array<{ name: string; sold: number; revenue: number }>;
    lowStockItems: Array<{ name: string; current: number; threshold: number }>;
    conversationSummaries: Array<{
      provider: string;
      summary: string;
      status: string;
      messageCount: number;
    }>;
  }> {
    /** Nothing measured, nothing claimed. */
    const nothingToReport = {
      totalBottles: 0,
      lowStockCount: 0,
      totalValue: 0,
      topSellers: [],
      lowStockItems: [],
      conversationSummaries: [],
    };

    try {
      const inventory =
        await this.databaseService.getRestaurantInventory(restaurantId);
      const lowStockItems =
        await this.databaseService.getLowStockItems(restaurantId);

      const totalBottles =
        inventory?.reduce((sum, item) => sum + (item.stock_live || 0), 0) || 0;

      const totalValue = this.valueInventory(inventory);

      const [topSellers, conversationSummaries] = await Promise.all([
        this.getWeeklyTopSellers(restaurantId),
        this.getRecentConversationSummaries(restaurantId),
      ]);

      return {
        totalBottles,
        lowStockCount: lowStockItems?.length || 0,
        totalValue,
        topSellers,
        lowStockItems:
          lowStockItems?.slice(0, 5).map((item) => ({
            name: item.wine_name || "Unknown Wine",
            current: item.stock_live || 0,
            threshold: item.threshold_min || 10,
          })) || [],
        conversationSummaries,
      };
    } catch (error: any) {
      // Previously this fell through to a fixture (1,247 bottles, $42,850,
      // three named wines) and mailed it. A blank report is a worse email and
      // a true one.
      this.logger.error(
        `Weekly report data unavailable — sending an empty report rather than ` +
          `placeholder figures: ${error?.message}`,
      );
      return nothingToReport;
    }
  }

  /**
   * Fetch recent conversation summaries for the weekly report.
   * Groups by provider and includes the latest message summary.
   *
   * ADR 0084 — this select named `message_body` and `subject`. The table has
   * neither: `procurement_conversations` stores the body in `message_text`
   * (`text NOT NULL`) and the subject inside `email_headers` (`jsonb`).
   * Measured against production 2026-09-02, not inferred from migrations.
   *
   * They are the SAME TWO PHANTOM NAMES that ADR 0065 removed from the write
   * side four hours earlier. The write side was fixed; the read side was
   * missed, because `check_order_capture_contract.py` Contract E parses
   * `.insert|update|upsert` payloads and nothing in the tree parses a select
   * list. So PostgREST answered 42703 on every weekly report, the line below
   * read that as "no vendor conversations", and the Vendor Communication
   * Summary has never once appeared in a manager's weekly email — over 27 real
   * conversation rows. Class **O** in [[absence-reported-as-health]]: nothing
   * was corrupted, a section was simply never there, and nothing said so.
   *
   * The error branch is now separate from the empty branch. Conflating them is
   * what made this invisible for as long as it was: one `return []` served
   * "the query failed" and "there is nothing to report", and only one of those
   * two is a fact about the restaurant.
   */
  private async getRecentConversationSummaries(restaurantId: string): Promise<
    Array<{
      provider: string;
      summary: string;
      status: string;
      messageCount: number;
    }>
  > {
    try {
      const client = this.databaseService.getClient();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // `message_body` and `subject` are not columns of this table. It carries
      // `message_text` (NOT NULL) and keeps the subject inside the `email_headers`
      // jsonb. ADR 0065 repaired the WRITE half of exactly this pair and left the
      // read here naming the same two phantoms, so every weekly report has been
      // summarising an empty list.
      //
      // `message_text` is selected as well (ADR 0084). ADR 0073 dropped
      // `message_body` outright on the grounds that nothing below read it,
      // which was true — and left `latestSubject` as `email_headers.subject
      // ?? ""`, so the 14 of production's 27 rows that carry no subject print
      // `Latest: "" (general)`. The body is the only other thing the row has
      // to say, so it supplies the fallback below.
      const read = this.readRows<any>(
        "weekly-email-report",
        "procurement_conversations",
        await client
          .from("procurement_conversations")
          .select(
            "id, provider_id, direction, channel, detected_intent, detected_sentiment, delivery_status, message_text, email_headers, created_at",
          )
          .eq("restaurant_id", restaurantId)
          .gte("created_at", sevenDaysAgo.toISOString())
          .order("created_at", { ascending: false })
          .limit(50),
      );
      // A failed read is NOT an empty week. It is logged by readRows and returns
      // the same [] the caller already handled, but the two are no longer
      // indistinguishable in the log.
      if (!read.ok) return [];
      const conversations = read.rows;
      if (conversations.length === 0) {
        this.logger.log(
          `No vendor conversations in the last 7 days for restaurant ${restaurantId} — ` +
            `section omitted (the read SUCCEEDED and found nothing).`,
        );
        return [];
      }

      // Group by provider_id and summarize
      const byProvider = new Map<string, typeof conversations>();
      for (const convo of conversations) {
        const pid = convo.provider_id || "unknown";
        if (!byProvider.has(pid)) {
          byProvider.set(pid, []);
        }
        byProvider.get(pid)!.push(convo);
      }

      // Fetch provider names
      const providerIds = Array.from(byProvider.keys()).filter(
        (id) => id !== "unknown",
      );
      const providerNames = new Map<string, string>();
      if (providerIds.length > 0) {
        const read = this.readRows<any>(
          "weekly-email-report",
          "providers",
          await client
            .from("providers")
            .select("id, name")
            .in("id", providerIds),
        );
        // A failed provider lookup must not silently become "Unknown Provider"
        // for every row: the read is logged, and names stay unresolved rather
        // than being invented (ADR 0020).
        if (read.ok) {
          for (const p of read.rows) {
            providerNames.set(p.id, p.name);
          }
        }
      }

      const summaries: Array<{
        provider: string;
        summary: string;
        status: string;
        messageCount: number;
      }> = [];
      for (const [providerId, convos] of byProvider) {
        const providerName =
          providerNames.get(providerId) || "Unknown Provider";
        const messageCount = convos.length;
        const latestConvo = convos[0]; // Already sorted descending

        // Build a short summary from the latest conversation.
        //
        // The subject lives in `email_headers.subject` — the lowercase RFC-822
        // key set the live inbound path writes (`rabbitmq-bridge.service.ts`
        // `handleInboundEmail`) and the shape ADR 0065 adopted for outbound.
        const headers = (latestConvo.email_headers ?? {}) as Record<
          string,
          unknown
        >;
        const rawSubject = headers.subject;
        const latestSubject =
          typeof rawSubject === "string" && rawSubject.trim().length > 0
            ? rawSubject.trim()
            : null;

        // Measured on production 2026-09-02: 13 of 27 rows carry a non-empty
        // `email_headers.subject` (all 10 inbound, 3 outbound). A subjectless
        // row is the COMMON case, not the edge, so `message_text` — the NOT
        // NULL body — supplies a short preview rather than `Latest: ""`, which
        // reads as a message with an empty subject rather than a row that
        // never had one. Truncated with an ellipsis so nobody mistakes the
        // preview for a complete subject line.
        const body =
          typeof latestConvo.message_text === "string"
            ? latestConvo.message_text.replace(/\s+/g, " ").trim()
            : "";
        const preview =
          body.length > 60 ? `${body.slice(0, 60).trimEnd()}…` : body;

        const latestDescriptor = latestSubject
          ? `"${latestSubject}"`
          : preview || "(no subject or body recorded)";

        const latestIntent = latestConvo.detected_intent || "general";
        const latestStatus = latestConvo.delivery_status || "active";

        summaries.push({
          provider: providerName,
          summary: `${messageCount} messages this week. Latest: ${latestDescriptor} (${latestIntent})`,
          status: latestStatus,
          messageCount,
        });
      }

      return summaries;
    } catch (err: any) {
      this.logger.warn(
        `Failed to fetch conversation summaries: ${err?.message}`,
      );
      return [];
    }
  }

  /**
   * Get low stock items from database
   */
  private async getLowStockItems(restaurantId: string): Promise<
    Array<{
      wineId: string;
      wineName: string;
      currentStock: number;
      threshold: number;
    }>
  > {
    try {
      const items = await this.databaseService.getLowStockItems(restaurantId);

      return (items || []).map((item) => ({
        wineId: item.id,
        wineName: item.wine_name || "Unknown Wine",
        currentStock: item.stock_live || 0,
        threshold: item.threshold_min || 10,
      }));
    } catch (error) {
      this.logger.warn(
        `Failed to get low stock items for restaurant ${restaurantId}`,
      );
      return [];
    }
  }

  /**
   * Manually trigger daily summary (for testing)
   */
  async triggerDailySummary(): Promise<void> {
    await this.sendDailySMSSummary();
  }

  /**
   * Manually trigger weekly report (for testing)
   */
  async triggerWeeklyReport(): Promise<void> {
    await this.sendWeeklyEmailReport();
  }

  /**
   * Persist a restaurant-scoped notification row for every member so a
   * cron-generated signal (delivery, payment, recurring order, report) also
   * shows up in the in-app Notifications page — not just the email. No
   * WebSocket push here (the scheduler has no gateway); the inbox poll picks it
   * up. Best-effort: never throws.
   */
  private async persistRestaurantNotification(
    restaurantId: string,
    payload: {
      type: string;
      title: string;
      message: string;
      priority?: string;
      actionUrl?: string;
      actionLabel?: string;
      metadata?: Record<string, any>;
      groupKey?: string;
    },
  ): Promise<void> {
    try {
      const userIds =
        await this.databaseService.getRestaurantMemberIds(restaurantId);
      if (!userIds.length) return;
      const now = new Date().toISOString();
      const rows = userIds.map((userId) => ({
        user_id: userId,
        recipient_id: userId,
        notification_type: payload.type,
        channels: ["in_app"],
        restaurant_id: restaurantId,
        type: payload.type,
        title: payload.title.slice(0, 500),
        message: payload.message,
        priority: payload.priority ?? "medium",
        status: "unread",
        action_url: payload.actionUrl ?? null,
        action_label: payload.actionLabel ?? null,
        group_key: payload.groupKey ?? null,
        metadata: payload.metadata ?? {},
        created_at: now,
      }));
      const inserted = await this.databaseService
        .getClient()
        .from("notifications")
        .insert(rows);
      // The count and the type are named because this is a BULK insert: one
      // failure loses the signal for every member of the restaurant at once,
      // and the inbox has no way to show a row that was never written.
      this.wrote(
        "persistRestaurantNotification",
        "notifications",
        `${rows.length} in-app notification row(s) of type "${payload.type}" ` +
          `for restaurant ${restaurantId} ("${payload.title}")`,
        inserted,
      );
    } catch (e: any) {
      // Still reached for a genuine exception; a DB error never gets here.
      this.logger.error(
        `persistRestaurantNotification threw for restaurant ${restaurantId} ` +
          `(type "${payload.type}"): ${e?.message}. No notification row was written.`,
      );
    }
  }

  /**
   * Effective orders/reports delivery mode for a restaurant, from members'
   * `notification_preferences` (OR semantics; defaults to on when unset so
   * behaviour never silently regresses). `enabled` gates the whole signal;
   * `email` gates whether the email goes out (in-app still fires when enabled).
   */
  private async getEffectiveCategoryMode(
    restaurantId: string,
    category: "orders" | "reports",
  ): Promise<{ enabled: boolean; email: boolean }> {
    try {
      const col = category === "orders" ? "orders_mode" : "reports_mode";
      const userIds =
        await this.databaseService.getRestaurantMemberIds(restaurantId);
      if (userIds.length === 0) return { enabled: true, email: true };
      const read = this.readRows<any>(
        "notification-preferences",
        "notification_preferences",
        await this.databaseService
          .getClient()
          .from("notification_preferences")
          .select(col)
          .in("user_id", userIds),
      );
      // Unreadable preferences fall back to on — the historical behaviour, kept
      // deliberately so a preferences outage cannot silence every notification —
      // but the failure is now logged instead of being indistinguishable from
      // "nobody has set a preference".
      if (!read.ok) return { enabled: true, email: true };
      const data = read.rows;
      if (data.length === 0) return { enabled: true, email: true };
      const modes = data.map((r: any) => r[col] || "both");
      return {
        enabled: modes.some((m: string) => m !== "off"),
        email: modes.some((m: string) => m === "both"),
      };
    } catch {
      return { enabled: true, email: true };
    }
  }
}
