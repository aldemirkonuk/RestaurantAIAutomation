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

import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { ProcurementService, asUuid } from "./procurement.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { resolveOrderUnits } from "./order-units";

/**
 * The five schedule shapes `recurring_orders_frequency_check` accepts.
 *
 * The DB and this file used to disagree in both directions: the CHECK allowed
 * `daily` and this type did not, while this type allowed `quarterly` and the
 * CHECK rejected it. `calculateNextOrderDate` then had a `default:` arm that
 * silently returned +1 month, so a `daily` schedule — offered by the DB and by
 * `RecurringOrders.tsx` — would have re-ordered MONTHLY without a word.
 * `20260901180000_recurring_orders_shape.sql` widens the CHECK to the union and
 * the default arm is gone; an unknown frequency is now refused.
 */
export const RECURRING_FREQUENCIES = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export interface RecurringOrderTemplate {
  id?: string;
  restaurant_id: string;
  inventory_id: string;
  provider_id: string;
  quantity: number;
  /** One of ORDER_UNIT_TYPES. Omitted means bottles. */
  unit_type?: string;
  /** Bottles in one purchase unit. Required for case/pack/split_case. */
  bottles_per_unit?: number;
  target_price?: number;
  frequency: RecurringFrequency;
  frequency_day?: number; // For weekly: 0-6 (Mon-Sun), for monthly: 1-28
  /** Defaults to false. */
  auto_approve?: boolean;
  next_order_date: string; // ISO date string YYYY-MM-DD
  /** Defaults to true. */
  active?: boolean;
  created_by?: string;
  notes?: string;
}

/**
 * One `recurring_orders` row, as the table actually is.
 *
 * WHAT THIS INTERFACE USED TO CLAIM
 *
 * `inventory_id`, `provider_id`, `wine_name`, `target_price`, `created_by`,
 * `notes`, `last_executed_at` and `execution_count` — eight fields, none of
 * which the table had. `createRecurringOrder` inserted seven of them and
 * omitted `unit_type`, which is NOT NULL with no default, so every create has
 * failed since the endpoint was written. Production held 0 rows on 2026-09-01,
 * which is the symptom rather than a coincidence.
 *
 * `20260901180000_recurring_orders_shape.sql` adds six of the eight. The other
 * two are gone from this interface rather than added to the table:
 *
 *   wine_name         is `restaurant_inventory.wine_name`, reachable through
 *                     `inventory_id` and embedded below. A stored copy goes
 *                     stale the first time a wine is renamed.
 *   last_executed_at  is `last_order_date`, which the table already had and
 *                     `RecurringOrders.tsx` already renders.
 *
 * `wine_id` and `preferred_providers` are on the table and are NOT on this
 * interface: nothing has ever written either, and neither can reach
 * `createOrder` (a varchar(50) with no key, and an array of vendor names against
 * a `uuid NOT NULL` column). They are tombstoned in the migration rather than
 * dropped, because `RecurringOrders.tsx:133` calls `.join()` on the array
 * unguarded and would throw the moment a real row existed.
 */
interface RecurringOrderRow {
  id: string;
  restaurant_id: string;
  inventory_id: string;
  provider_id: string;
  quantity: number;
  /**
   * One of the seven ORDER_UNIT_TYPES. NOT NULL: a schedule that does not say
   * what it counts in cannot be materialised, and this column was previously
   * never written at all.
   */
  unit_type: string;
  /**
   * Bottles in one purchase unit. Added alongside the order-line capture fix —
   * without it a schedule that says "5 cases weekly" cannot be materialised at
   * all, because `createOrder` refuses a case order that does not state its pack
   * size rather than guessing 12 (or, as it used to, silently ordering 5).
   */
  bottles_per_unit: number | null;
  target_price: number | null;
  frequency: string;
  frequency_day: number | null;
  auto_approve: boolean;
  next_order_date: string;
  last_order_date: string | null;
  active: boolean;
  created_by: string | null;
  notes: string | null;
  execution_count: number;
  created_at: string;
  updated_at: string;
  /**
   * NOT a column. Lifted by `projectRow` out of the embedded
   * `restaurant_inventory` row, so every consumer still reads `wine_name` while
   * the table keeps exactly one copy of the name.
   */
  wine_name: string | null;
}

/**
 * Every column of `recurring_orders` this service reads, plus the one embed.
 *
 * A literal rather than `*` so that a column removed from the table breaks this
 * query loudly instead of arriving as `undefined` — which is precisely how the
 * eight phantom fields survived unnoticed for as long as they did.
 */
const RECURRING_SELECT =
  "id, restaurant_id, inventory_id, provider_id, quantity, unit_type, " +
  "bottles_per_unit, target_price, frequency, frequency_day, auto_approve, " +
  "next_order_date, last_order_date, active, created_by, notes, " +
  "execution_count, created_at, updated_at, inventory:inventory_id(wine_name)";

/**
 * The response shape callers get: the row, plus `wine_name` lifted out of the
 * embed to the top level.
 *
 * `apps/web/src/pages/RecurringOrders.tsx` renders `order.wine_name` as the
 * card heading. Projecting it here keeps that working without giving the table
 * a second, staleable copy of a name it can already reach.
 */
function projectRow(row: any): any {
  if (!row) return row;
  const { inventory, ...rest } = row;
  const embedded = Array.isArray(inventory) ? inventory[0] : inventory;
  return { ...rest, wine_name: embedded?.wine_name ?? null };
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
    // Resolve the units before writing anything. A schedule whose "5 cases"
    // cannot be turned into a bottle count is un-materialisable: every morning
    // at 8 the cron would call `createOrder`, be refused, log, and move on
    // forever. Refusing at create time is the same refusal, once, where the
    // person who can fix it is still looking at the form.
    const units = resolveOrderUnits({
      quantity: template.quantity,
      unitType: template.unit_type,
      bottlesPerUnit: template.bottles_per_unit,
    });
    if (!units.ok) {
      throw new BadRequestException({
        reason: units.reason,
        message: units.message,
      });
    }

    if (!RECURRING_FREQUENCIES.includes(template.frequency)) {
      throw new BadRequestException({
        reason: "unknown_frequency",
        message:
          `Frequency "${String(template.frequency)}" is not one this schedule can run. ` +
          `Use one of: ${RECURRING_FREQUENCIES.join(", ")}.`,
      });
    }

    const { data, error } = await this.databaseService.supabase
      .from("recurring_orders")
      .insert({
        restaurant_id: restaurantId,
        inventory_id: template.inventory_id,
        provider_id: template.provider_id,
        quantity: template.quantity,
        // NOT NULL, and previously never written at all — which is one of the
        // two reasons no schedule has ever been created successfully.
        unit_type: units.unitType,
        bottles_per_unit: units.bottlesPerUnit,
        target_price: template.target_price || null,
        frequency: template.frequency,
        frequency_day: template.frequency_day ?? null,
        auto_approve: template.auto_approve ?? false,
        next_order_date: template.next_order_date,
        active: template.active ?? true,
        // `created_by` has an FK to public.users(user_id). The controller's old
        // `body.userId || "system"` default would raise 22P02 on a non-uuid, so
        // a non-uuid actor becomes NULL — the same rule `createOrder` applies.
        created_by: asUuid(userId),
        notes: template.notes || null,
      })
      .select(RECURRING_SELECT)
      .single();

    if (error) {
      this.logger.error(`Failed to create recurring order: ${error.message}`);
      throw error;
    }

    const row = projectRow(data);

    this.logger.log(
      `Recurring order created: ${row.id} (${template.frequency})`,
    );

    // Pre-create calendar events for the next 12 months
    try {
      await this.preCreateCalendarEvents(row);
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
            recurring_order_id: row.id,
            wine_name: row.wine_name || "Unknown",
            quantity: template.quantity,
            frequency: template.frequency,
            frequency_day: template.frequency_day,
            next_order_date: template.next_order_date,
            message: `New recurring order for ${row.wine_name || "wine"} (${template.quantity} ${template.frequency}) requires approval`,
          },
        );
      } catch (pubErr) {
        this.logger.warn(
          `Failed to publish approval_needed event: ${pubErr?.message}`,
        );
      }
    }

    return row;
  }

  async listRecurringOrders(restaurantId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("recurring_orders")
      .select(RECURRING_SELECT)
      .eq("restaurant_id", restaurantId)
      .order("next_order_date", { ascending: true });

    if (error) {
      this.logger.error(`Failed to list recurring orders: ${error.message}`);
      throw error;
    }

    return (data || []).map(projectRow);
  }

  async getRecurringOrder(restaurantId: string, id: string) {
    const { data, error } = await this.databaseService.supabase
      .from("recurring_orders")
      .select(RECURRING_SELECT)
      .eq("restaurant_id", restaurantId)
      .eq("id", id)
      .single();

    if (error) {
      this.logger.error(
        `Failed to get recurring order ${id}: ${error.message}`,
      );
      throw error;
    }

    return projectRow(data);
  }

  /**
   * Columns an update may touch.
   *
   * An allow-list, not a `{...updates}` spread. The spread sent whatever the
   * request body held straight into the UPDATE, so `RecurringOrders.tsx:182`'s
   * `{ manager_override_price }` — a field this table has never had — failed
   * the whole statement with a 42703, and a body naming `restaurant_id` would
   * have moved a schedule between tenants. Anything not listed is dropped
   * rather than attempted.
   */
  private static readonly UPDATABLE = [
    "inventory_id",
    "provider_id",
    "quantity",
    "unit_type",
    "bottles_per_unit",
    "target_price",
    "frequency",
    "frequency_day",
    "auto_approve",
    "next_order_date",
    "active",
    "notes",
  ] as const;

  async updateRecurringOrder(
    restaurantId: string,
    id: string,
    updates: Partial<RecurringOrderTemplate> & { active?: boolean },
  ) {
    const patch: Record<string, any> = {};
    for (const key of RecurringOrdersService.UPDATABLE) {
      if (updates[key as keyof typeof updates] !== undefined) {
        patch[key] = updates[key as keyof typeof updates];
      }
    }

    if (patch.frequency && !RECURRING_FREQUENCIES.includes(patch.frequency)) {
      throw new BadRequestException({
        reason: "unknown_frequency",
        message:
          `Frequency "${String(patch.frequency)}" is not one this schedule can run. ` +
          `Use one of: ${RECURRING_FREQUENCIES.join(", ")}.`,
      });
    }

    // Units are re-resolved whenever any of the three inputs moves.
    //
    // A CHANGED unit does not inherit the stored pack size. `resolveOrderUnits`
    // cannot catch that on its own — 1 is a perfectly valid pack size — so a
    // bottle schedule switched to "case" would keep bottles_per_unit = 1 and
    // book a twelfth of the delivery, silently, which is the exact failure the
    // rest of this arithmetic exists to prevent. Dropping the inherited value
    // turns it into the refusal `createOrder` already gives a case order with no
    // pack size.
    if (
      patch.quantity !== undefined ||
      patch.unit_type !== undefined ||
      patch.bottles_per_unit !== undefined
    ) {
      const current = await this.getRecurringOrder(restaurantId, id);
      const unitChanged =
        patch.unit_type !== undefined && patch.unit_type !== current.unit_type;
      const units = resolveOrderUnits({
        quantity: patch.quantity ?? current.quantity,
        unitType: patch.unit_type ?? current.unit_type,
        bottlesPerUnit:
          patch.bottles_per_unit ??
          (unitChanged ? undefined : current.bottles_per_unit),
      });
      if (!units.ok) {
        throw new BadRequestException({
          reason: units.reason,
          message: units.message,
        });
      }
      patch.unit_type = units.unitType;
      patch.bottles_per_unit = units.bottlesPerUnit;
    }

    const { data, error } = await this.databaseService.supabase
      .from("recurring_orders")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("restaurant_id", restaurantId)
      .eq("id", id)
      .select(RECURRING_SELECT)
      .single();

    if (error) {
      this.logger.error(
        `Failed to update recurring order ${id}: ${error.message}`,
      );
      throw error;
    }

    return projectRow(data);
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
        .select(RECURRING_SELECT)
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

      for (const recurringOrder of dueOrders.map(
        projectRow,
      ) as RecurringOrderRow[]) {
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
          .select(RECURRING_SELECT)
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

      for (const order of upcomingOrders.map(
        projectRow,
      ) as RecurringOrderRow[]) {
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
              // The unit is the schedule's own, not the word "bottles". A
              // reminder that says "5 bottles" for a five-CASE schedule is the
              // unit bug wearing a notification.
              message: `Recurring order for ${order.wine_name || "wine"} (${order.quantity} ${order.unit_type}${order.quantity === 1 ? "" : "s"}) is due in 2 days`,
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

    // The schedule's own note reaches the buyer rather than being stored and
    // never read — `notes` had no reader at all before this line.
    const managerNotes = [
      recurringOrder.notes?.trim() || null,
      `Auto-created from recurring order (${recurringOrder.frequency})`,
    ]
      .filter(Boolean)
      .join(" — ");

    // 1. Create procurement order
    const order = await this.procurementService.createOrder(
      recurringOrder.restaurant_id,
      userId,
      {
        // Before `20260901180000_recurring_orders_shape.sql` these two columns
        // did not exist, so both arrived as `undefined` and every
        // materialisation handed `createOrder` an undefined for a `uuid NOT
        // NULL`. The cron has never produced an order.
        inventoryId: recurringOrder.inventory_id,
        providerId: recurringOrder.provider_id,
        quantity: recurringOrder.quantity,
        // `recurring_orders.unit_type` was never carried across, so a schedule
        // for five CASES every Monday materialised as five BOTTLES — the same
        // unit wound as `createOrder`'s old `bottles_total = quantity`, one
        // layer up.
        unitType: recurringOrder.unit_type ?? undefined,
        bottlesPerUnit: recurringOrder.bottles_per_unit ?? undefined,
        quotedPrice: recurringOrder.target_price || undefined,
        finalPrice: recurringOrder.target_price || undefined,
        isEmergency: false,
        managerNotes,
      },
      { source: "recurring", recurringOrderId: recurringOrder.id },
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

    // 5. Update recurring order with next date and execution count.
    //
    // `last_order_date`, not `last_executed_at`. The latter was never a column;
    // the former already was, is the same fact, and is the one
    // `RecurringOrders.tsx` renders. It is a DATE, so the time is dropped
    // deliberately — nothing reads a time and a second column for it would be
    // the same duplication this change is removing.
    await this.databaseService.supabase
      .from("recurring_orders")
      .update({
        next_order_date: nextDate,
        last_order_date: new Date().toISOString().split("T")[0],
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

    // A twelve-month window at DAILY is 365 calendar rows for one schedule.
    // Before `daily` was implemented it fell through to +1 month and produced
    // 12, so this ceiling is new debt created by fixing that — stated rather
    // than discovered later as "why does the calendar have 4,000 events".
    // Sixty is a quarter of daily orders, which is further ahead than any
    // restaurant plans a wine delivery.
    const MAX_EVENTS = 60;

    const events: any[] = [];
    let currentDate = recurringOrder.next_order_date;
    const frequency = recurringOrder.frequency;
    const frequencyDay = recurringOrder.frequency_day ?? undefined;

    // Generate all future dates within the window
    // eslint-disable-next-line no-constant-condition -- break when dates exceed endDate
    while (true) {
      if (events.length >= MAX_EVENTS) break;
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

  /**
   * When this schedule next comes due.
   *
   * There is no `default:` arm any more, and that is the point. The old one
   * returned +1 month for anything it did not recognise — including `daily`,
   * which both the database CHECK and `RecurringOrders.tsx`'s dropdown offered.
   * A schedule the operator set to run every day would have run once a month,
   * and nothing anywhere would have said so. An unknown frequency now throws;
   * `executeDueRecurringOrders` catches per row, so one bad schedule is logged
   * and skipped rather than silently mis-timed or taking the whole cron down.
   */
  private calculateNextOrderDate(
    currentDate: string,
    frequency: string,
    frequencyDay?: number,
  ): string {
    // Calendar arithmetic on Y/M/D, deliberately never on a Date built from the
    // ISO string.
    //
    // `new Date("2026-09-01")` is UTC midnight, and every getter/setter below is
    // LOCAL. West of Greenwich that instant is 2026-08-31, so `setMonth(+1)`
    // asked for 31 September, which JavaScript rolls forward — a monthly
    // schedule set for the 1st came back as the 2nd, and only in negative-offset
    // timezones. Railway runs UTC and a developer's laptop usually does not,
    // which is the worst possible shape for a scheduling bug: correct in
    // production, wrong in every test anyone writes locally, and vice versa the
    // day the region changes.
    const [y0, m0, d0] = currentDate
      .split("-")
      .map((part) => Number.parseInt(part, 10));
    if (!y0 || !m0 || !d0) {
      throw new BadRequestException({
        reason: "bad_next_order_date",
        message: `next_order_date "${currentDate}" is not a YYYY-MM-DD calendar date.`,
      });
    }

    const iso = (y: number, m: number, d: number) =>
      `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    /** Add whole days, carrying across months and years. */
    const addDays = (y: number, m: number, d: number, n: number) => {
      // Date.UTC is safe here because both ends are read back in UTC.
      const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
      return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()] as const;
    };

    /** Add whole months, CLAMPING the day. 31 January + 1 month is 28/29 Feb. */
    const addMonths = (y: number, m: number, d: number, n: number) => {
      const total = (y * 12 + (m - 1) + n) | 0;
      const ny = Math.floor(total / 12);
      const nm = (total % 12) + 1;
      return [ny, nm, Math.min(d, this.daysInMonth(ny, nm))] as const;
    };

    /** JS day-of-week for a calendar date, read in UTC to match addDays. */
    const dow = (y: number, m: number, d: number) =>
      new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    /** Snap forward to `frequencyDay`, expressed 0=Mon..6=Sun. */
    const snapToWeekday = (y: number, m: number, d: number) => {
      if (frequencyDay === undefined || frequencyDay < 0 || frequencyDay > 6) {
        return [y, m, d] as const;
      }
      const targetJsDay = frequencyDay === 6 ? 0 : frequencyDay + 1;
      const diff = (targetJsDay - dow(y, m, d) + 7) % 7;
      return diff === 0 ? ([y, m, d] as const) : addDays(y, m, d, diff);
    };

    /** Snap to `frequencyDay` as a day of the month, 1-28. */
    const snapToMonthDay = (y: number, m: number, d: number) => {
      if (frequencyDay === undefined || frequencyDay < 1 || frequencyDay > 28) {
        return [y, m, d] as const;
      }
      return [y, m, Math.min(frequencyDay, this.daysInMonth(y, m))] as const;
    };

    switch (frequency) {
      case "daily":
        return iso(...addDays(y0, m0, d0, 1));
      case "weekly":
        return iso(...snapToWeekday(...addDays(y0, m0, d0, 7)));
      case "biweekly":
        return iso(...snapToWeekday(...addDays(y0, m0, d0, 14)));
      case "monthly":
        return iso(...snapToMonthDay(...addMonths(y0, m0, d0, 1)));
      case "quarterly":
        return iso(...snapToMonthDay(...addMonths(y0, m0, d0, 3)));
      default:
        throw new BadRequestException({
          reason: "unknown_frequency",
          message:
            `Frequency "${frequency}" is not one this schedule can run. ` +
            `Use one of: ${RECURRING_FREQUENCIES.join(", ")}. ` +
            `Refusing rather than defaulting to monthly — a daily schedule that ` +
            `quietly runs monthly is a wrong answer nobody can see.`,
        });
    }
  }

  /** Days in a 1-indexed month. */
  private daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
}
