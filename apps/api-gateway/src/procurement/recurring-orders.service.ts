/**
 * Recurring Orders Service
 * ========================
 * Manages recurring order templates and auto-executes them based on schedule.
 *
 * Features:
 * - CRUD for recurring order templates
 * - Daily cron job (8 AM) to check and execute due recurring orders
 * - Auto-creates procurement order + calendar event + notifications
 * - Publishes events to RabbitMQ for bridge propagation
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { ProcurementService } from "./procurement.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { ProcurementOrderStatus } from "./dto/procurement.dto";

export interface RecurringOrderTemplate {
  id?: string;
  restaurant_id: string;
  inventory_id: string;
  provider_id: string;
  wine_name?: string;
  quantity: number;
  target_price?: number;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly";
  frequency_day?: number; // For weekly: 0-6 (Mon-Sun), for monthly: 1-28
  auto_approve: boolean;
  next_order_date: string; // ISO date string YYYY-MM-DD
  active: boolean;
  created_by?: string;
  notes?: string;
}

interface RecurringOrderRow {
  id: string;
  restaurant_id: string;
  inventory_id: string;
  provider_id: string;
  wine_name: string | null;
  quantity: number;
  target_price: number | null;
  frequency: string;
  frequency_day: number | null;
  auto_approve: boolean;
  next_order_date: string;
  active: boolean;
  created_by: string | null;
  notes: string | null;
  last_executed_at: string | null;
  execution_count: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class RecurringOrdersService {
  private readonly logger = new Logger(RecurringOrdersService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly procurementService: ProcurementService,
    private readonly orchestratorService: OrchestratorService,
  ) {}

  // ===========================================================================
  // CRUD OPERATIONS
  // ===========================================================================

  async createRecurringOrder(
    restaurantId: string,
    userId: string,
    template: Omit<RecurringOrderTemplate, "id" | "restaurant_id">,
  ) {
    const { data, error } = await this.databaseService.supabase
      .from("recurring_orders")
      .insert({
        restaurant_id: restaurantId,
        inventory_id: template.inventory_id,
        provider_id: template.provider_id,
        wine_name: template.wine_name || null,
        quantity: template.quantity,
        target_price: template.target_price || null,
        frequency: template.frequency,
        frequency_day: template.frequency_day ?? null,
        auto_approve: template.auto_approve ?? false,
        next_order_date: template.next_order_date,
        active: template.active ?? true,
        created_by: userId,
        notes: template.notes || null,
        execution_count: 0,
      })
      .select("*")
      .single();

    if (error) {
      this.logger.error(`Failed to create recurring order: ${error.message}`);
      throw error;
    }

    this.logger.log(
      `Recurring order created: ${data.id} (${template.frequency})`,
    );

    // Pre-create calendar events for the next 12 months
    try {
      await this.preCreateCalendarEvents(data);
    } catch (calErr) {
      this.logger.warn(
        `Failed to pre-create calendar events: ${calErr?.message}`,
      );
    }

    // Publish approval_needed event if auto_approve is false
    if (!template.auto_approve) {
      try {
        await this.orchestratorService.publishEvent(
          "recurring.events",
          "recurring.order.approval_needed",
          {
            restaurant_id: restaurantId,
            recurring_order_id: data.id,
            wine_name: template.wine_name || "Unknown",
            quantity: template.quantity,
            frequency: template.frequency,
            frequency_day: template.frequency_day,
            next_order_date: template.next_order_date,
            message: `New recurring order for ${template.wine_name || "wine"} (${template.quantity} ${template.frequency}) requires approval`,
          },
        );
      } catch (pubErr) {
        this.logger.warn(
          `Failed to publish approval_needed event: ${pubErr?.message}`,
        );
      }
    }

    return data;
  }

  async listRecurringOrders(restaurantId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("recurring_orders")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("next_order_date", { ascending: true });

    if (error) {
      this.logger.error(`Failed to list recurring orders: ${error.message}`);
      throw error;
    }

    return data || [];
  }

  async getRecurringOrder(restaurantId: string, id: string) {
    const { data, error } = await this.databaseService.supabase
      .from("recurring_orders")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("id", id)
      .single();

    if (error) {
      this.logger.error(
        `Failed to get recurring order ${id}: ${error.message}`,
      );
      throw error;
    }

    return data;
  }

  async updateRecurringOrder(
    restaurantId: string,
    id: string,
    updates: Partial<RecurringOrderTemplate>,
  ) {
    const { data, error } = await this.databaseService.supabase
      .from("recurring_orders")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("restaurant_id", restaurantId)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      this.logger.error(
        `Failed to update recurring order ${id}: ${error.message}`,
      );
      throw error;
    }

    return data;
  }

  async deleteRecurringOrder(restaurantId: string, id: string) {
    const { error } = await this.databaseService.supabase
      .from("recurring_orders")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("restaurant_id", restaurantId)
      .eq("id", id);

    if (error) {
      this.logger.error(
        `Failed to deactivate recurring order ${id}: ${error.message}`,
      );
      throw error;
    }

    return { success: true };
  }

  // ===========================================================================
  // CRON JOBS
  // ===========================================================================

  /**
   * Daily at 8:00 AM - Check and execute due recurring orders
   */
  @Cron("0 8 * * *")
  async executeDueRecurringOrders(): Promise<void> {
    this.logger.log("Running recurring order check...");
    const today = new Date().toISOString().split("T")[0];

    try {
      // Find all active recurring orders due today or earlier
      const { data: dueOrders, error } = await this.databaseService.supabase
        .from("recurring_orders")
        .select("*")
        .eq("active", true)
        .lte("next_order_date", today);

      if (error) {
        this.logger.error(
          `Failed to query due recurring orders: ${error.message}`,
        );
        return;
      }

      if (!dueOrders || dueOrders.length === 0) {
        this.logger.log("No recurring orders due today");
        return;
      }

      this.logger.log(
        `Found ${dueOrders.length} recurring orders due for execution`,
      );

      for (const recurringOrder of dueOrders as RecurringOrderRow[]) {
        try {
          await this.executeRecurringOrder(recurringOrder);
        } catch (err) {
          this.logger.error(
            `Failed to execute recurring order ${recurringOrder.id}: ${err?.message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Recurring order cron failed: ${err?.message}`);
    }
  }

  /**
   * Daily at 6:00 AM - Send reminders for orders due in 2 days
   */
  @Cron("0 6 * * *")
  async sendRecurringOrderReminders(): Promise<void> {
    this.logger.log("Checking for upcoming recurring order reminders...");

    const twoDaysFromNow = new Date();
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
    const reminderDate = twoDaysFromNow.toISOString().split("T")[0];

    try {
      const { data: upcomingOrders, error } =
        await this.databaseService.supabase
          .from("recurring_orders")
          .select("*")
          .eq("active", true)
          .eq("next_order_date", reminderDate);

      if (error) {
        this.logger.warn(
          `Failed to query upcoming recurring orders: ${error.message}`,
        );
        return;
      }

      if (!upcomingOrders || upcomingOrders.length === 0) {
        this.logger.log("No recurring orders due in 2 days");
        return;
      }

      for (const order of upcomingOrders as RecurringOrderRow[]) {
        try {
          await this.orchestratorService.publishEvent(
            "recurring.events",
            "recurring.order.reminder",
            {
              restaurant_id: order.restaurant_id,
              recurring_order_id: order.id,
              wine_name: order.wine_name || "Unknown",
              quantity: order.quantity,
              next_order_date: order.next_order_date,
              days_until: 2,
              message: `Recurring order for ${order.wine_name || "wine"} (${order.quantity} bottles) is due in 2 days`,
            },
          );
          this.logger.log(`Reminder sent for recurring order ${order.id}`);
        } catch (err) {
          this.logger.warn(
            `Failed to send reminder for ${order.id}: ${err?.message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Recurring order reminder cron failed: ${err?.message}`,
      );
    }
  }

  // ===========================================================================
  // EXECUTION LOGIC
  // ===========================================================================

  private async executeRecurringOrder(
    recurringOrder: RecurringOrderRow,
  ): Promise<void> {
    this.logger.log(
      `Executing recurring order ${recurringOrder.id}: ` +
        `${recurringOrder.wine_name} x${recurringOrder.quantity}`,
    );

    const userId = recurringOrder.created_by || "system";

    // 1. Create procurement order
    const order = await this.procurementService.createOrder(
      recurringOrder.restaurant_id,
      userId,
      {
        inventoryId: recurringOrder.inventory_id,
        providerId: recurringOrder.provider_id,
        quantity: recurringOrder.quantity,
        quotedPrice: recurringOrder.target_price || undefined,
        finalPrice: recurringOrder.target_price || undefined,
        isEmergency: false,
        managerNotes: `Auto-created from recurring order (${recurringOrder.frequency})`,
      },
    );

    // 2. Auto-approve if configured, otherwise notify for approval
    if (recurringOrder.auto_approve) {
      await this.procurementService.approveOrder(
        recurringOrder.restaurant_id,
        order.id,
        userId,
      );
      this.logger.log(`Recurring order ${order.id} auto-approved`);
    } else {
      try {
        await this.orchestratorService.publishEvent(
          "recurring.events",
          "recurring.order.approval_needed",
          {
            restaurant_id: recurringOrder.restaurant_id,
            recurring_order_id: recurringOrder.id,
            order_id: order.id,
            order_number: order.orderNumber,
            wine_name: recurringOrder.wine_name,
            quantity: recurringOrder.quantity,
            message: `Recurring order ${order.orderNumber} for ${recurringOrder.wine_name || "wine"} requires your approval`,
          },
        );
      } catch (pubErr) {
        this.logger.warn(
          `Failed to publish approval_needed event: ${pubErr?.message}`,
        );
      }
    }

    // 3. Update pre-created calendar event to COMPLETED + create delivery event
    try {
      // Mark the order calendar event as completed
      const { data: existingEvents } = await this.databaseService.supabase
        .from("calendar_events")
        .select("id")
        .eq("restaurant_id", recurringOrder.restaurant_id)
        .eq("event_date", recurringOrder.next_order_date)
        .eq("status", "SCHEDULED")
        .like("tags", `%${recurringOrder.id}%`)
        .limit(1);

      if (existingEvents && existingEvents.length > 0) {
        await this.databaseService.supabase
          .from("calendar_events")
          .update({
            status: "COMPLETED",
            tags: JSON.stringify({
              recurring_order_id: recurringOrder.id,
              order_id: order.id,
              is_recurring: true,
              executed: true,
            }),
          })
          .eq("id", existingEvents[0].id);
      }

      // Create a delivery calendar event (+7 days)
      const expectedDelivery = new Date();
      expectedDelivery.setDate(expectedDelivery.getDate() + 7);

      await this.databaseService.supabase.from("calendar_events").insert({
        restaurant_id: recurringOrder.restaurant_id,
        title: `Recurring Delivery: ${recurringOrder.wine_name || order.orderNumber}`,
        description: `Recurring order ${order.orderNumber} - ${recurringOrder.quantity} bottles`,
        event_type: "delivery",
        event_date: expectedDelivery.toISOString().split("T")[0],
        event_time: "10:00",
        all_day: false,
        status: "SCHEDULED",
        priority: "MEDIUM",
        tags: JSON.stringify({
          order_id: order.id,
          recurring_order_id: recurringOrder.id,
          provider_id: recurringOrder.provider_id,
          is_recurring: true,
        }),
        reminder_enabled: true,
        reminder_days_before: 1,
      });
    } catch (calErr) {
      this.logger.warn(
        `Calendar event update failed for recurring order: ${calErr?.message}`,
      );
    }

    // 4. Calculate next order date (respecting frequency_day)
    const nextDate = this.calculateNextOrderDate(
      recurringOrder.next_order_date,
      recurringOrder.frequency,
      recurringOrder.frequency_day ?? undefined,
    );

    // 5. Update recurring order with next date and execution count
    await this.databaseService.supabase
      .from("recurring_orders")
      .update({
        next_order_date: nextDate,
        last_executed_at: new Date().toISOString(),
        execution_count: (recurringOrder.execution_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", recurringOrder.id);

    // 6. Publish events to RabbitMQ
    try {
      await this.orchestratorService.publishEvent(
        "recurring.events",
        "recurring.order.executed",
        {
          restaurant_id: recurringOrder.restaurant_id,
          recurring_order_id: recurringOrder.id,
          order_id: order.id,
          order_number: order.orderNumber,
          wine_name: recurringOrder.wine_name,
          quantity: recurringOrder.quantity,
          auto_approved: recurringOrder.auto_approve,
          next_order_date: nextDate,
        },
      );
    } catch (pubErr) {
      this.logger.warn(
        `Failed to publish recurring order event: ${pubErr?.message}`,
      );
    }

    this.logger.log(
      `Recurring order ${recurringOrder.id} executed successfully. ` +
        `New order: ${order.id}, next due: ${nextDate}`,
    );
  }

  /**
   * Pre-create calendar events for all future recurrences (up to 12 months).
   * Tags each event with recurring_order_id + is_recurring for later status updates.
   */
  private async preCreateCalendarEvents(recurringOrder: any): Promise<void> {
    const maxMonths = 12;
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + maxMonths);

    const events: any[] = [];
    let currentDate = recurringOrder.next_order_date;
    const frequency = recurringOrder.frequency;
    const frequencyDay = recurringOrder.frequency_day ?? undefined;

    // Generate all future dates within the window
    // eslint-disable-next-line no-constant-condition -- break when dates exceed endDate
    while (true) {
      const dateObj = new Date(currentDate);
      if (dateObj > endDate) break;

      events.push({
        restaurant_id: recurringOrder.restaurant_id,
        title: `Recurring Order: ${recurringOrder.wine_name || "Wine"} (${recurringOrder.quantity} units)`,
        description: `Auto-scheduled recurring order - ${frequency}`,
        event_type: "order",
        event_date: currentDate,
        event_time: "08:00",
        all_day: false,
        status: "SCHEDULED",
        priority: "MEDIUM",
        tags: JSON.stringify({
          recurring_order_id: recurringOrder.id,
          is_recurring: true,
          frequency,
          frequency_day: frequencyDay,
        }),
        reminder_enabled: true,
        reminder_days_before: 2,
      });

      currentDate = this.calculateNextOrderDate(
        currentDate,
        frequency,
        frequencyDay,
      );
    }

    if (events.length === 0) return;

    const { error } = await this.databaseService.supabase
      .from("calendar_events")
      .insert(events);

    if (error) {
      this.logger.warn(
        `Failed to bulk-insert calendar events: ${error.message}`,
      );
    } else {
      this.logger.log(
        `Pre-created ${events.length} calendar events for recurring order ${recurringOrder.id}`,
      );
    }
  }

  private calculateNextOrderDate(
    currentDate: string,
    frequency: string,
    frequencyDay?: number,
  ): string {
    const date = new Date(currentDate);

    switch (frequency) {
      case "weekly": {
        date.setDate(date.getDate() + 7);
        // Snap to target day-of-week if specified (0=Mon..6=Sun)
        if (
          frequencyDay !== undefined &&
          frequencyDay >= 0 &&
          frequencyDay <= 6
        ) {
          const targetJsDay = frequencyDay === 6 ? 0 : frequencyDay + 1; // Convert Mon=0..Sun=6 to JS Sun=0..Sat=6
          const currentJsDay = date.getDay();
          const diff = (targetJsDay - currentJsDay + 7) % 7;
          if (diff !== 0) date.setDate(date.getDate() + diff);
        }
        break;
      }
      case "biweekly": {
        date.setDate(date.getDate() + 14);
        if (
          frequencyDay !== undefined &&
          frequencyDay >= 0 &&
          frequencyDay <= 6
        ) {
          const targetJsDay = frequencyDay === 6 ? 0 : frequencyDay + 1;
          const currentJsDay = date.getDay();
          const diff = (targetJsDay - currentJsDay + 7) % 7;
          if (diff !== 0) date.setDate(date.getDate() + diff);
        }
        break;
      }
      case "monthly": {
        date.setMonth(date.getMonth() + 1);
        // Snap to target day-of-month if specified (1-28)
        if (
          frequencyDay !== undefined &&
          frequencyDay >= 1 &&
          frequencyDay <= 28
        ) {
          date.setDate(
            Math.min(
              frequencyDay,
              this.daysInMonth(date.getFullYear(), date.getMonth()),
            ),
          );
        }
        break;
      }
      case "quarterly": {
        date.setMonth(date.getMonth() + 3);
        if (
          frequencyDay !== undefined &&
          frequencyDay >= 1 &&
          frequencyDay <= 28
        ) {
          date.setDate(
            Math.min(
              frequencyDay,
              this.daysInMonth(date.getFullYear(), date.getMonth()),
            ),
          );
        }
        break;
      }
      default:
        date.setMonth(date.getMonth() + 1);
    }

    return date.toISOString().split("T")[0];
  }

  private daysInMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
  }
}
