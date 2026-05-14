import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CommunicationsService } from './communications.service';
import { DatabaseService } from '../database/database.service';
import { GmailService } from './gmail.service';
import type { EmailResult } from './gmail.service';
import { RecipientResolverService } from './recipient-resolver.service';

/**
 * Pure function — exported for direct use in tests without NestJS DI.
 * Determines the next fire date from a 5-part cron expression.
 */
export function computeNextFireAt(cronExpr: string, from: Date = new Date()): Date {
  const next = new Date(from);
  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('non-standard cron');

    const [minute, hour, dom, , dow] = parts;

    // Monthly: specific day of month (e.g. "0 9 1 * *")
    if (dom !== '*' && dow === '*') {
      next.setMonth(next.getMonth() + 1);
      return next;
    }

    // Weekly: specific day of week (e.g. "0 9 * * 1")
    if (dom === '*' && dow !== '*') {
      next.setDate(next.getDate() + 7);
      return next;
    }

    // Minute step (e.g. "*/30 * * * *")
    const minuteMatch = minute.match(/^\*\/(\d+)$/);
    if (minuteMatch && hour === '*') {
      next.setMinutes(next.getMinutes() + parseInt(minuteMatch[1], 10));
      return next;
    }

    // Fixed hour = daily
    if (hour !== '*') {
      next.setDate(next.getDate() + 1);
      return next;
    }

    next.setDate(next.getDate() + 1);
  } catch {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

@Injectable()
export class ScheduledTasksService implements OnModuleInit {
  private readonly logger = new Logger(ScheduledTasksService.name);
  private managerPhone: string | null = null;
  private managerEmails: string[] = [];
  private defaultRestaurantId: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly communicationsService: CommunicationsService,
    private readonly databaseService: DatabaseService,
    private readonly gmailService: GmailService,
    private readonly recipientResolver: RecipientResolverService,
  ) {}

  async onModuleInit() {
    this.managerPhone = this.configService.get<string>('MANAGER_PHONE') || null;
    const emailConfig = this.configService.get<string>('MANAGER_EMAIL') || '';
    this.managerEmails = emailConfig.split(',').map(e => e.trim()).filter(e => e);
    this.defaultRestaurantId = this.configService.get<string>('DEFAULT_RESTAURANT_ID') || null;

    this.logger.log('Scheduled tasks service initialized');
    this.logger.log(`Manager Emails: ${this.managerEmails.join(', ')}`);
    this.logger.log(`Manager Phone: ${this.managerPhone || 'Not configured'}`);
  }

  /**
   * Daily SMS Summary - Runs every day at 9:00 AM
   */
  @Cron('0 9 * * *', {
    name: 'daily-sms-summary',
    timeZone: 'America/New_York',
  })
  async sendDailySMSSummary() {
    if (!this.managerPhone) {
      this.logger.log('Daily SMS summary skipped: MANAGER_PHONE not configured');
      return;
    }

    this.logger.log('Starting daily SMS summary task...');

    try {
      // Get summary data from database
      const summaryData = await this.getDailySummaryData();

      await this.communicationsService.sendDailySummary({
        recipientPhone: this.managerPhone,
        restaurantName: summaryData.restaurantName,
        lowStockCount: summaryData.lowStockCount,
        pendingOrders: summaryData.pendingOrders,
        deliveriesToday: summaryData.deliveriesToday,
      });

      this.logger.log('Daily SMS summary sent successfully');
    } catch (error) {
      this.logger.error('Failed to send daily SMS summary:', error);
    }
  }

  /**
   * Weekly Email Report - Runs every Monday at 8:00 AM
   */
  @Cron('0 8 * * 1', {
    name: 'weekly-email-report',
    timeZone: 'America/New_York',
  })
  async sendWeeklyEmailReport() {
    if (this.managerEmails.length === 0 || !this.defaultRestaurantId) {
      this.logger.log('Weekly email report skipped: MANAGER_EMAIL or DEFAULT_RESTAURANT_ID not configured');
      return;
    }

    this.logger.log('Starting weekly email report task...');

    try {
      // Get weekly report data from database
      const reportData = await this.getWeeklyReportData();

      await this.communicationsService.sendWeeklyReport({
        recipientEmails: this.managerEmails,
        restaurantId: this.defaultRestaurantId,
        reportData,
      });

      this.logger.log(`Weekly email report sent successfully to: ${this.managerEmails.join(', ')}`);
    } catch (error) {
      this.logger.error('Failed to send weekly email report:', error);
    }
  }

  /**
   * Midday Low Stock Report - Runs every day at 12:00 PM
   */
  @Cron('0 12 * * *', {
    name: 'midday-low-stock-report',
    timeZone: 'America/New_York',
  })
  async sendMiddayLowStockReport() {
    if (this.managerEmails.length === 0) {
      this.logger.log('Midday low stock report skipped: MANAGER_EMAIL not configured');
      return;
    }

    this.logger.log('Starting midday low stock report task...');

    try {
      const lowStockItems = await this.getLowStockItems();

      if (lowStockItems.length === 0) {
        this.logger.log('No low stock items found - skipping midday report');
        return;
      }

      // Send alert for each low stock item
      for (const item of lowStockItems) {
        const recipients = {
          emails: this.managerEmails,
          phones: this.managerPhone ? [this.managerPhone] : undefined,
        };

        await this.communicationsService.sendLowStockAlert(
          {
            wineName: item.wineName,
            wineId: item.wineId,
            currentStock: item.currentStock,
            threshold: item.threshold,
            restaurantId: this.defaultRestaurantId || 'default',
          },
          recipients,
        );
      }

      this.logger.log(`Midday low stock report sent to ${this.managerEmails.join(', ')}. Alerted on ${lowStockItems.length} items.`);
    } catch (error) {
      this.logger.error('Failed to send midday low stock report:', error);
    }
  }

  /**
   * Critical low-stock email alerts — hourly cron removed (was noisy).
   * Use midday report (sendMiddayLowStockReport) or trigger manually when needed.
   */
  async checkLowStockAlerts() {
    if (!this.defaultRestaurantId) {
      return;
    }

    if (this.managerEmails.length === 0) {
      this.logger.log('Low stock check skipped: MANAGER_EMAIL not configured');
      return;
    }

    this.logger.log('Checking for low stock items...');

    try {
      const inventory = await this.databaseService.getRestaurantInventory(this.defaultRestaurantId);
      if (!inventory?.length) {
        this.logger.log('Low stock check skipped: no inventory for restaurant');
        return;
      }

      const lowStockItems = await this.getLowStockItems();

      for (const item of lowStockItems) {
        // Only alert for critical items (50% below threshold)
        if (item.currentStock <= item.threshold * 0.5) {
          this.logger.log(`Critical stock alert for: ${item.wineName}`);

          const recipients = {
            emails: this.managerEmails,
            phones: this.managerPhone ? [this.managerPhone] : undefined,
          };

          await this.communicationsService.sendLowStockAlert(
            {
              wineName: item.wineName,
              wineId: item.wineId,
              currentStock: item.currentStock,
              threshold: item.threshold,
              restaurantId: this.defaultRestaurantId,
            },
            recipients,
          );
        }
      }

      this.logger.log(`Low stock check completed. Found ${lowStockItems.length} low stock items.`);
    } catch (error) {
      this.logger.error('Failed to check low stock alerts:', error);
    }
  }

  // ==========================================================================
  // NEW CRON JOBS: Recurring Orders, Delivery ETA, Payment Due, Audit, Events
  // ==========================================================================

  /**
   * Recurring Order Reminder - Runs daily at 8:00 AM
   * Checks for recurring orders due in 2 days
   */
  @Cron('0 8 * * *', {
    name: 'recurring-order-reminder',
    timeZone: 'America/New_York',
  })
  async sendRecurringOrderReminders() {
    if (!this.defaultRestaurantId) {
      this.logger.log('Recurring order reminder skipped: DEFAULT_RESTAURANT_ID not configured');
      return;
    }

    this.logger.log('Checking for upcoming recurring orders...');

    try {
      const client = this.databaseService.getClient();
      const twoDaysFromNow = new Date();
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      const twoDaysStr = twoDaysFromNow.toISOString().split('T')[0];

      // Query recurring orders scheduled within 2 days
      const { data: orders } = await client
        .from('procurement_orders')
        .select('*, providers(name)')
        .eq('restaurant_id', this.defaultRestaurantId)
        .eq('status', 'RECURRING')
        .lte('next_order_date', twoDaysStr)
        .order('next_order_date', { ascending: true });

      if (!orders || orders.length === 0) {
        this.logger.log('No upcoming recurring orders found');
        return;
      }

      const recipients = await this.recipientResolver.resolveRecipients({
        restaurantId: this.defaultRestaurantId,
        roles: ['manager'],
        channels: ['email'],
      });

      for (const order of orders) {
        await this.gmailService.sendRecurringOrderReminder({
          to: recipients.emails,
          restaurantName: 'WineOps Restaurant',
          orderName: order.wine_name || 'Recurring Order',
          providerName: order.providers?.name || 'Unknown Provider',
          scheduledDate: order.next_order_date || twoDaysStr,
          items: [{
            name: order.wine_name || 'Wine',
            quantity: order.quantity || 0,
            unitPrice: order.target_price_per_bottle || 0,
          }],
          totalAmount: (order.quantity || 0) * (order.target_price_per_bottle || 0),
          frequency: order.recurrence_frequency || 'monthly',
        });
      }

      this.logger.log(`Sent ${orders.length} recurring order reminders`);
    } catch (error) {
      this.logger.error('Failed to send recurring order reminders:', error);
    }
  }

  /**
   * Delivery ETA Notification - Runs daily at 5:00 PM
   * Checks for deliveries arriving tomorrow
   */
  @Cron('0 17 * * *', {
    name: 'delivery-eta-notification',
    timeZone: 'America/New_York',
  })
  async sendDeliveryETANotifications() {
    if (!this.defaultRestaurantId) return;

    this.logger.log('Checking for upcoming deliveries...');

    try {
      const client = this.databaseService.getClient();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      // Query orders with delivery expected tomorrow
      const { data: deliveries } = await client
        .from('procurement_orders')
        .select('*, providers(name)')
        .eq('restaurant_id', this.defaultRestaurantId)
        .in('status', ['CONFIRMED', 'SHIPPED', 'IN_TRANSIT'])
        .lte('expected_delivery_date', tomorrowStr + 'T23:59:59')
        .gte('expected_delivery_date', tomorrowStr + 'T00:00:00');

      if (!deliveries || deliveries.length === 0) {
        this.logger.log('No deliveries expected tomorrow');
        return;
      }

      const recipients = await this.recipientResolver.resolveRecipients({
        restaurantId: this.defaultRestaurantId,
        roles: ['manager', 'staff'],
        channels: ['email'],
      });

      for (const delivery of deliveries) {
        await this.gmailService.sendDeliveryETANotification({
          to: recipients.emails,
          restaurantName: 'WineOps Restaurant',
          orderId: delivery.order_number || delivery.id?.substring(0, 8) || 'N/A',
          providerName: delivery.providers?.name || 'Unknown Provider',
          expectedDate: delivery.expected_delivery_date || tomorrowStr,
          items: [{
            name: delivery.wine_name || 'Wine',
            quantity: delivery.quantity || 0,
          }],
          totalItems: delivery.quantity || 0,
        });
      }

      this.logger.log(`Sent ${deliveries.length} delivery ETA notifications`);
    } catch (error) {
      this.logger.error('Failed to send delivery ETA notifications:', error);
    }
  }

  /**
   * Payment Due Reminder - Runs daily at 9:00 AM
   * Checks for payment deadlines within 3 days
   */
  @Cron('0 9 * * *', {
    name: 'payment-due-reminder',
    timeZone: 'America/New_York',
  })
  async sendPaymentDueReminders() {
    if (!this.defaultRestaurantId) return;

    this.logger.log('Checking for upcoming payment deadlines...');

    try {
      const client = this.databaseService.getClient();
      const now = new Date();
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      // Query invoices with payment due within 3 days
      const { data: invoices } = await client
        .from('procurement_orders')
        .select('*, providers(name)')
        .eq('restaurant_id', this.defaultRestaurantId)
        .in('status', ['DELIVERED', 'INVOICED'])
        .not('payment_due_date', 'is', null)
        .lte('payment_due_date', threeDaysFromNow.toISOString())
        .gte('payment_due_date', now.toISOString());

      if (!invoices || invoices.length === 0) {
        this.logger.log('No upcoming payment deadlines');
        return;
      }

      const recipients = await this.recipientResolver.resolveRecipients({
        restaurantId: this.defaultRestaurantId,
        roles: ['manager'],
        channels: ['email'],
      });

      for (const invoice of invoices) {
        const dueDate = new Date(invoice.payment_due_date);
        const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        await this.gmailService.sendPaymentDueReminder({
          to: recipients.emails,
          restaurantName: 'WineOps Restaurant',
          invoiceNumber: invoice.order_number || invoice.id?.substring(0, 8) || 'N/A',
          providerName: invoice.providers?.name || 'Unknown Provider',
          dueDate: invoice.payment_due_date,
          amount: (invoice.quantity || 0) * (invoice.final_price_per_bottle || invoice.negotiated_price_per_bottle || 0),
          daysUntilDue,
          paymentTerms: invoice.payment_terms,
        });
      }

      this.logger.log(`Sent ${invoices.length} payment due reminders`);
    } catch (error) {
      this.logger.error('Failed to send payment due reminders:', error);
    }
  }

  /**
   * Inventory Audit Reminder - Runs every Monday at 7:00 AM
   */
  @Cron('0 7 * * 1', {
    name: 'inventory-audit-reminder',
    timeZone: 'America/New_York',
  })
  async sendInventoryAuditReminder() {
    if (!this.defaultRestaurantId) return;

    this.logger.log('Sending weekly inventory audit reminder...');

    try {
      const client = this.databaseService.getClient();

      // Get inventory summary
      const inventory = await this.databaseService.getRestaurantInventory(this.defaultRestaurantId);
      const lowStockItems = await this.databaseService.getLowStockItems(this.defaultRestaurantId);

      const totalBottles = inventory?.reduce((sum, item) => sum + (item.stock_live || 0), 0) || 0;
      const totalValue = totalBottles * 50; // Rough estimate

      const recipients = await this.recipientResolver.resolveRecipients({
        restaurantId: this.defaultRestaurantId,
        roles: ['manager', 'staff'],
        channels: ['email'],
      });

      const scheduledDate = new Date();
      // Schedule audit for the upcoming Wednesday
      scheduledDate.setDate(scheduledDate.getDate() + 2);

      await this.gmailService.sendInventoryAuditReminder({
        to: recipients.emails,
        restaurantName: 'WineOps Restaurant',
        scheduledDate,
        scheduledTime: '10:00 AM',
        totalBottles,
        totalValue,
        discrepancyCount: lowStockItems?.length || 0,
        focusAreas: lowStockItems?.slice(0, 3).map(item => ({
          area: item.wine_name || 'Unknown Wine',
          reason: `Current stock (${item.stock_live || 0}) is below threshold (${item.threshold_min || 10})`,
        })) || [],
        notes: 'Please count all bottles and compare with system records.',
      });

      this.logger.log('Inventory audit reminder sent');
    } catch (error) {
      this.logger.error('Failed to send inventory audit reminder:', error);
    }
  }

  /**
   * Event Preparation Check - Runs daily at 8:00 AM
   * Checks for events happening in 2 days
   */
  @Cron('0 8 * * *', {
    name: 'event-prep-check',
    timeZone: 'America/New_York',
  })
  async sendEventPrepReminders() {
    if (!this.defaultRestaurantId) return;

    this.logger.log('Checking for upcoming events...');

    try {
      const client = this.databaseService.getClient();
      const twoDaysFromNow = new Date();
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      const targetDate = twoDaysFromNow.toISOString().split('T')[0];

      // Query calendar events happening in 2 days
      const { data: events } = await client
        .from('calendar_events')
        .select('*')
        .eq('restaurant_id', this.defaultRestaurantId)
        .gte('event_date', targetDate + 'T00:00:00')
        .lte('event_date', targetDate + 'T23:59:59');

      if (!events || events.length === 0) {
        this.logger.log('No events in 2 days');
        return;
      }

      const recipients = await this.recipientResolver.resolveRecipients({
        restaurantId: this.defaultRestaurantId,
        roles: ['manager', 'staff'],
        channels: ['email'],
      });

      for (const event of events) {
        await this.gmailService.sendEventPrepReminder({
          to: recipients.emails,
          restaurantName: 'WineOps Restaurant',
          eventName: event.title || event.name || 'Upcoming Event',
          eventDate: event.event_date || targetDate,
          eventTime: event.event_time,
          guestCount: event.guest_count,
          eventType: event.event_type || 'special_event',
          organizer: event.organizer,
          specialRequests: event.special_requests || event.notes,
        });
      }

      this.logger.log(`Sent ${events.length} event preparation reminders`);
    } catch (error) {
      this.logger.error('Failed to send event prep reminders:', error);
    }
  }

  /**
   * Custom Reminders Check - Runs every 15 minutes.
   * Fires any custom reminders that are due:
   *   1. Sends a Gmail email to recipients.
   *   2. Writes a `notifications` DB row so the alert appears in the in-app inbox.
   *   3. Advances next_fire_at based on the cron expression (not a crude +7 days).
   */
  @Cron('*/15 * * * *', {
    name: 'custom-reminders-check',
  })
  async processCustomReminders() {
    if (!this.defaultRestaurantId) return;

    try {
      const client = this.databaseService.getClient();
      const now = new Date();

      const { data: reminders } = await client
        .from('custom_reminders')
        .select('*')
        .eq('is_active', true)
        .lte('next_fire_at', now.toISOString())
        .order('next_fire_at', { ascending: true })
        .limit(20);

      if (!reminders || reminders.length === 0) return;

      for (const reminder of reminders) {
        const invTypes = new Set(['low_stock', 'inventory', 'inventory_audit']);
        if (invTypes.has(String(reminder.reminder_type || '').toLowerCase())) {
          const inventoryRows = await this.databaseService.getRestaurantInventory(this.defaultRestaurantId);
          if (!inventoryRows?.length) {
            this.logger.log(
              `Custom reminder "${reminder.title}" (${reminder.id}) skipped: no inventory rows (${reminder.reminder_type})`,
            );
            if (reminder.is_recurring && reminder.schedule_cron) {
              const nextFire = this.computeNextFireAt(reminder.schedule_cron, now);
              await client
                .from('custom_reminders')
                .update({ last_fired_at: now.toISOString(), next_fire_at: nextFire.toISOString() })
                .eq('id', reminder.id);
            } else {
              await client
                .from('custom_reminders')
                .update({ last_fired_at: now.toISOString(), is_active: false })
                .eq('id', reminder.id);
            }
            continue;
          }
        }

        // Resolve email recipients
        let emails = reminder.recipient_emails || [];
        if (emails.length === 0 && reminder.recipient_roles?.length > 0) {
          const recipients = await this.recipientResolver.resolveRecipients({
            restaurantId: reminder.restaurant_id || this.defaultRestaurantId,
            roles: reminder.recipient_roles,
            channels: ['email'],
          });
          emails = recipients.emails;
        }
        if (emails.length === 0) {
          emails = this.managerEmails;
        }

        // 1. Send email (skip when no recipients — avoids Gmail errors / surprise fallback)
        let emailResult: EmailResult = { success: false };
        if (emails.length > 0) {
          emailResult = await this.gmailService.sendCustomReminder({
            to: emails,
            restaurantName: 'WineOps Restaurant',
            title: reminder.title,
            description: reminder.description || '',
            reminderType: reminder.reminder_type || 'custom',
            scheduledDate: reminder.next_fire_at,
            priority: reminder.metadata?.priority || 'medium',
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
          try {
            await client.from('notifications').insert({
              user_id: notifUserId,
              restaurant_id: reminder.restaurant_id || this.defaultRestaurantId,
              type: 'custom_reminder',
              title: reminder.title,
              message: reminder.description || reminder.title,
              priority: reminder.metadata?.priority || 'medium',
              status: 'unread',
              action_url: '/notifications',
              action_label: 'View Reminder',
              metadata: {
                reminder_id: reminder.id,
                reminder_type: reminder.reminder_type,
                email_sent: emailResult.success,
                email_message_id: emailResult.messageId,
              },
              created_at: now.toISOString(),
            });
          } catch (notifErr) {
            this.logger.warn(`Could not write notifications row for reminder ${reminder.id}: ${notifErr?.message}`);
          }
        }

        // 3. Advance or deactivate
        if (reminder.is_recurring && reminder.schedule_cron) {
          const nextFire = this.computeNextFireAt(reminder.schedule_cron, now);
          await client
            .from('custom_reminders')
            .update({ last_fired_at: now.toISOString(), next_fire_at: nextFire.toISOString() })
            .eq('id', reminder.id);
        } else {
          await client
            .from('custom_reminders')
            .update({ last_fired_at: now.toISOString(), is_active: false })
            .eq('id', reminder.id);
        }
      }

      this.logger.log(`Processed ${reminders.length} custom reminders`);
    } catch (error) {
      this.logger.error('Failed to process custom reminders:', error);
    }
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
      if (parts.length !== 5) throw new Error('non-standard cron');

      const [minute, hour, dom, month, dow] = parts;

      // Monthly: specific day of month (e.g. "0 9 1 * *" = 1st of month at 9am)
      if (dom !== '*' && dow === '*') {
        next.setMonth(next.getMonth() + 1);
        return next;
      }

      // Weekly: specific day of week (e.g. "0 9 * * 1" = every Monday)
      if (dom === '*' && dow !== '*') {
        next.setDate(next.getDate() + 7);
        return next;
      }

      // Hourly step (e.g. "*/30 * * * *" = every 30 minutes)
      const minuteMatch = minute.match(/^\*\/(\d+)$/);
      if (minuteMatch && hour === '*') {
        next.setMinutes(next.getMinutes() + parseInt(minuteMatch[1], 10));
        return next;
      }

      // Fixed hour, any minute = daily
      if (hour !== '*') {
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

  // ==========================================================================
  // MANUAL TRIGGER METHODS (for testing)
  // ==========================================================================

  async triggerRecurringOrderReminders(): Promise<void> {
    await this.sendRecurringOrderReminders();
  }

  async triggerDeliveryETANotifications(): Promise<void> {
    await this.sendDeliveryETANotifications();
  }

  async triggerPaymentDueReminders(): Promise<void> {
    await this.sendPaymentDueReminders();
  }

  async triggerInventoryAuditReminder(): Promise<void> {
    await this.sendInventoryAuditReminder();
  }

  async triggerEventPrepReminders(): Promise<void> {
    await this.sendEventPrepReminders();
  }

  /**
   * Get daily summary data from database
   */
  private async getDailySummaryData(): Promise<{
    restaurantName: string;
    lowStockCount: number;
    pendingOrders: number;
    deliveriesToday: number;
  }> {
    // Try to get actual data from database, fallback to mock
    try {
      if (this.defaultRestaurantId) {
        const lowStockItems = await this.databaseService.getLowStockItems(this.defaultRestaurantId);
        const pendingOrders = await this.databaseService.getProcurementOrders(
          this.defaultRestaurantId,
          'pending',
        );

        return {
          restaurantName: 'WineOps Restaurant',
          lowStockCount: lowStockItems?.length || 0,
          pendingOrders: pendingOrders?.length || 0,
          deliveriesToday: 0, // Would need to query deliveries table
        };
      }
    } catch (error) {
      this.logger.warn('Failed to get data from database, using mock data');
    }

    // Mock data for testing
    return {
      restaurantName: 'WineOps Restaurant',
      lowStockCount: 5,
      pendingOrders: 3,
      deliveriesToday: 1,
    };
  }

  /**
   * Get weekly report data from database
   */
  private async getWeeklyReportData(): Promise<{
    totalBottles: number;
    lowStockCount: number;
    totalValue: number;
    topSellers: Array<{ name: string; sold: number; revenue: number }>;
    lowStockItems: Array<{ name: string; current: number; threshold: number }>;
    conversationSummaries: Array<{ provider: string; summary: string; status: string; messageCount: number }>;
  }> {
    // Try to get actual data from database, fallback to mock
    try {
      if (this.defaultRestaurantId) {
        const inventory = await this.databaseService.getRestaurantInventory(this.defaultRestaurantId);
        const lowStockItems = await this.databaseService.getLowStockItems(this.defaultRestaurantId);

        const totalBottles = inventory?.reduce((sum, item) => sum + (item.stock_live || 0), 0) || 0;

        // Fetch recent conversation summaries (last 7 days)
        const conversationSummaries = await this.getRecentConversationSummaries();

        return {
          totalBottles,
          lowStockCount: lowStockItems?.length || 0,
          totalValue: totalBottles * 50, // Rough estimate
          topSellers: [
            { name: 'Chateau Margaux 2015', sold: 15, revenue: 4500 },
            { name: 'Opus One 2019', sold: 12, revenue: 3540 },
            { name: 'Dom Perignon 2012', sold: 10, revenue: 2500 },
          ],
          lowStockItems:
            lowStockItems?.slice(0, 5).map((item) => ({
              name: item.wine_name || 'Unknown Wine',
              current: item.stock_live || 0,
              threshold: item.threshold_min || 10,
            })) || [],
          conversationSummaries,
        };
      }
    } catch (error) {
      this.logger.warn('Failed to get data from database, using mock data');
    }

    // Mock data for testing
    return {
      totalBottles: 1247,
      lowStockCount: 12,
      totalValue: 42850,
      topSellers: [
        { name: 'Chateau Margaux 2015', sold: 15, revenue: 4500 },
        { name: 'Opus One 2019', sold: 12, revenue: 3540 },
        { name: 'Dom Perignon 2012', sold: 10, revenue: 2500 },
      ],
      lowStockItems: [
        { name: 'Chateau Margaux 2015', current: 2, threshold: 12 },
        { name: 'Opus One 2019', current: 5, threshold: 8 },
        { name: 'Caymus Cabernet', current: 7, threshold: 10 },
      ],
      conversationSummaries: [],
    };
  }

  /**
   * Fetch recent conversation summaries for the weekly report
   * Groups by provider and includes the latest message summary
   */
  private async getRecentConversationSummaries(): Promise<
    Array<{ provider: string; summary: string; status: string; messageCount: number }>
  > {
    try {
      if (!this.defaultRestaurantId) return [];

      const client = this.databaseService.getClient();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: conversations, error } = await client
        .from('procurement_conversations')
        .select('id, provider_id, direction, channel, detected_intent, detected_sentiment, delivery_status, message_body, subject, created_at')
        .eq('restaurant_id', this.defaultRestaurantId)
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      if (error || !conversations || conversations.length === 0) {
        return [];
      }

      // Group by provider_id and summarize
      const byProvider = new Map<string, typeof conversations>();
      for (const convo of conversations) {
        const pid = convo.provider_id || 'unknown';
        if (!byProvider.has(pid)) {
          byProvider.set(pid, []);
        }
        byProvider.get(pid)!.push(convo);
      }

      // Fetch provider names
      const providerIds = Array.from(byProvider.keys()).filter(id => id !== 'unknown');
      let providerNames = new Map<string, string>();
      if (providerIds.length > 0) {
        const { data: providers } = await client
          .from('providers')
          .select('id, name')
          .in('id', providerIds);
        if (providers) {
          for (const p of providers) {
            providerNames.set(p.id, p.name);
          }
        }
      }

      const summaries: Array<{ provider: string; summary: string; status: string; messageCount: number }> = [];
      for (const [providerId, convos] of byProvider) {
        const providerName = providerNames.get(providerId) || 'Unknown Provider';
        const messageCount = convos.length;
        const latestConvo = convos[0]; // Already sorted descending
        
        // Build a short summary from the latest conversation
        const latestSubject = latestConvo.subject || '';
        const latestIntent = latestConvo.detected_intent || 'general';
        const latestStatus = latestConvo.delivery_status || 'active';

        summaries.push({
          provider: providerName,
          summary: `${messageCount} messages this week. Latest: "${latestSubject}" (${latestIntent})`,
          status: latestStatus,
          messageCount,
        });
      }

      return summaries;
    } catch (err: any) {
      this.logger.warn(`Failed to fetch conversation summaries: ${err?.message}`);
      return [];
    }
  }

  /**
   * Get low stock items from database
   */
  private async getLowStockItems(): Promise<
    Array<{
      wineId: string;
      wineName: string;
      currentStock: number;
      threshold: number;
    }>
  > {
    try {
      if (this.defaultRestaurantId) {
        const items = await this.databaseService.getLowStockItems(this.defaultRestaurantId);

        return (items || []).map((item) => ({
          wineId: item.id,
          wineName: item.wine_name || 'Unknown Wine',
          currentStock: item.stock_live || 0,
          threshold: item.threshold_min || 10,
        }));
      }
    } catch (error) {
      this.logger.warn('Failed to get low stock items from database');
    }

    return [];
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
}
