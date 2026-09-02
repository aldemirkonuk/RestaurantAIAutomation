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
   * `restaurant_inventory` row — falling through to `master_wine_library.name`,
   * which is where 53 of production's 72 inventory rows actually keep it — so
   * every consumer still reads `wine_name` while the table keeps exactly one
   * copy of the name.
   *
   * NULL is a real answer and callers must handle it. See
   * `describeScheduleSubject`.
   */
  wine_name: string | null;
  /** NOT a column. Lifted out of the `providers` embed. NULL is a real answer. */
  provider_name: string | null;
}

/**
 * Every column of `recurring_orders` this service reads, plus the embeds.
 *
 * A literal rather than `*` so that a column removed from the table breaks this
 * query loudly instead of arriving as `undefined` — which is precisely how the
 * eight phantom fields survived unnoticed for as long as they did.
 *
 * TWO HOPS TO THE NAME, NOT ONE, AND THE SECOND ONE IS THE COMMON CASE.
 *
 * `restaurant_inventory.wine_name` is NULLABLE (baseline:`restaurant_inventory`
 * declares `wine_name character varying(500)` with no NOT NULL). Measured in
 * production on 2026-09-02: **53 of 72 inventory rows have a NULL wine_name**,
 * and all 53 carry a `master_wine_id` whose `master_wine_library.name` — a NOT
 * NULL column — holds the real one. So a single-hop embed resolves the name for
 * 19 of 72 rows and returns null for 74% of the catalogue. That is not an edge
 * case to guard, it is the majority path, and it is what turned the reminder
 * below into a machine for mailing the word "Unknown".
 *
 * `provider:provider_id(name)` is here for the same reason one layer over: the
 * reminder's consumer renders a provider list, and with the key absent it
 * substitutes the literal string "Default provider"
 * (`notification_agent.py:1772`). Sending the true one removes that fabrication
 * at the source without touching the agent.
 */
const RECURRING_SELECT =
  "id, restaurant_id, inventory_id, provider_id, quantity, unit_type, " +
  "bottles_per_unit, target_price, frequency, frequency_day, auto_approve, " +
  "next_order_date, last_order_date, active, created_by, notes, " +
  "execution_count, created_at, updated_at, " +
  "inventory:inventory_id(wine_name, master_wine_library(name)), " +
  "provider:provider_id(name)";

/** First non-blank string, or null. Never a placeholder. */
function firstNonBlank(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

/** PostgREST returns a to-one embed as an object, or as a 1-element array. */
function one(embed: any): any {
  return Array.isArray(embed) ? (embed[0] ?? null) : (embed ?? null);
}

/**
 * The response shape callers get: the row, plus `wine_name` and
 * `provider_name` lifted out of the embeds to the top level.
 *
 * `apps/web/src/pages/RecurringOrders.tsx` renders `order.wine_name` as the
 * card heading. Projecting it here keeps that working without giving the table
 * a second, staleable copy of a name it can already reach.
 *
 * `wine_name` stays NULL when neither hop has a name. It is never "Unknown",
 * never "Wine", never an em dash. A null here is a fact the callers below are
 * required to handle; a placeholder is a lie they cannot detect.
 */
function projectRow(row: any): any {
  if (!row) return row;
  const { inventory, provider, ...rest } = row;
  const inv = one(inventory);
  const master = one(inv?.master_wine_library);
  return {
    ...rest,
    wine_name: firstNonBlank(inv?.wine_name, master?.name),
    provider_name: firstNonBlank(provider?.name),
  };
}

/**
 * The vocabulary `calendar_events` actually speaks.
 *
 * MEASURED, NOT ASSUMED. Production on 2026-09-02 holds 19 rows with exactly
 * three distinct `status` values — `pending` (16), `active` (2), `completed`
 * (1) — all lowercase. The column default is `'pending'`. `CalendarEventStatus`
 * (calendar/dto/calendar.dto.ts:36-42) enumerates pending, approved, dismissed,
 * completed, cancelled; `CalendarEventSource` (:61-67) enumerates manual,
 * ai_detected, system_generated, order, communications.
 *
 * This file wrote `"SCHEDULED"` and `"COMPLETED"`, and filtered on
 * `.eq("status", "SCHEDULED")`. `SCHEDULED` is not a member of that enum in any
 * casing and has never existed in that table; `COMPLETED` is the wrong case for
 * the `completed` that does. There is no CHECK constraint on the column, so
 * every one of those writes was accepted silently and every read matched
 * nothing.
 *
 * `scheduled` is deliberately NOT invented here. Nothing else uses it, and
 * `pending` is both the column default and what 16 of the 19 real rows say —
 * a not-yet-happened event.
 */
const CALENDAR_STATUS = {
  /** Written, not yet materialised. Column default; 16 of 19 production rows. */
  PENDING: "pending",
  /** The schedule fired and the order exists. */
  COMPLETED: "completed",
} as const;

/**
 * `source` is `character varying(50) NOT NULL` with **no default**. Every write
 * from this file omitted it, so even without the phantom columns the insert
 * would have failed 23502. `system_generated` is the right member: a cron wrote
 * it. (`order` exists in the enum but means "created by the order flow", which
 * is procurement.service.ts's site, not this one.)
 */
const CALENDAR_SOURCE_SYSTEM = "system_generated";

/**
 * How to name this schedule in outbound content, without inventing anything.
 *
 * Returns the wine's real name when either hop has one. When neither does, it
 * returns the schedule's own uuid — which is TRUE, is the primary key the
 * notification's own action buttons already carry (`recurring_order_id` is in
 * every payload below, and `notification_agent.py` renders Confirm / Edit /
 * Cancel against it), and is therefore something the recipient can act on.
 *
 * This is the one place this file deliberately diverges from ADR 0061, which
 * refuses to send at all when a field is missing. 0061 is right for its own
 * template because that subject line also needs a PROVIDER and a PRICE, and
 * neither has a truthful substitute. An identity does: the row's id is not a
 * placeholder standing in for an unknown, it is the thing itself. Sending
 * nothing for a schedule that is genuinely due two days from now trades a
 * fabricated reminder for an absent one, and an absent reminder is the failure
 * this whole path exists to prevent.
 *
 * `resolved` is returned alongside so callers can count how often the fallback
 * fires instead of discovering it in a screenshot.
 */
export function describeScheduleSubject(row: {
  id: string;
  wine_name?: string | null;
}): { label: string; resolved: boolean } {
  const name = firstNonBlank(row.wine_name);
  if (name) return { label: name, resolved: true };
  // "schedule <uuid>", not "recurring order <uuid>": every template that
  // interpolates this already says "Recurring order for {wine_name}", and the
  // doubled phrase reads as a bug even when the value is correct.
  return { label: `schedule ${row.id}`, resolved: false };
}

/**
 * The gate PR #227 / ADR 0061 introduced for the OTHER recurring-order
 * reminder, applied to this one as well.
 *
 * TWO CRONS, ONE CONCEPT. `ScheduledTasksService.sendRecurringOrderReminders()`
 * (08:00, email) and this service's `sendRecurringOrderReminders()` (06:00,
 * RabbitMQ → NotificationAgent → push + email) both read `recurring_orders` for
 * schedules due within two days and both tell the same person the same thing.
 * Gating one and not the other is not a smaller change, it is a worse one: it
 * leaves the UNREVIEWED path live and the reviewed, fail-closed path dark.
 *
 * Allow-list, not deny-list, and checked before any query: `"true"` and `"1"`
 * arm it, everything else — `"yes"`, `"on"`, `""`, a typo, unset — reads as
 * off. A typo that silently arms a mailer is unrecoverable; a typo that
 * silences it is not.
 *
 * DEFINED LOCALLY rather than imported from
 * `communications/recurring-order-reminder.ts`, because that module lives on an
 * unmerged branch (PR #227) and this branch must build against `main`. When
 * #227 lands, the two should collapse onto one exported constant — the
 * duplicate is recorded here rather than left to be discovered.
 */
export const RECURRING_REMINDER_FLAG = "RECURRING_ORDER_REMINDERS_ENABLED";

export function recurringRemindersArmed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env[RECURRING_REMINDER_FLAG] ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

/** What one calendar write attempt actually did. Never inferred from silence. */
export interface CalendarWriteOutcome {
  requested: number;
  written: number;
  error: string | null;
}

/** What one reminder sweep actually did. Every row lands in exactly one bucket. */
export interface ReminderSweepOutcome {
  armed: boolean;
  scanned: number;
  sent: number;
  /** Sent, but named by schedule id because no wine name was reachable. */
  sentUnnamed: number;
  /** Publish threw. The recipient got nothing and nobody would have known. */
  failed: number;
  /** The query itself failed. `scanned` is not a count of anything. */
  queryFailed: boolean;
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

    // Pre-create calendar events for the next 12 months.
    //
    // NOT allowed to fail the create, and NOT allowed to read as success.
    // Throwing here would 500 a request whose schedule row is already
    // committed, and the client's retry would create a SECOND schedule — a
    // duplicate standing order is a strictly worse outcome than a missing diary
    // entry. So the outcome is attached to the response and logged at error
    // level instead of being swallowed into a warn nobody reads.
    const calendar = await this.preCreateCalendarEvents(row);
    if (calendar.error || calendar.written < calendar.requested) {
      this.logger.error(
        `Recurring order ${row.id} was created but its calendar was not: ` +
          `${calendar.written}/${calendar.requested} events written` +
          (calendar.error ? ` — ${calendar.error}` : ""),
      );
    }

    // Publish approval_needed event if auto_approve is false
    if (!template.auto_approve) {
      const subject = describeScheduleSubject(row);
      try {
        await this.orchestratorService.publishEvent(
          "recurring.events",
          "recurring.order.approval_needed",
          {
            restaurant_id: restaurantId,
            recurring_order_id: row.id,
            // The name, or null. `notification_agent.py` puts this in the
            // notification TITLE; "Unknown" there is not a degraded subject
            // line, it is a confidently wrong one (ADR 0020 / 0051).
            wine_name: row.wine_name,
            quantity: template.quantity,
            unit_type: row.unit_type,
            preferred_providers: row.provider_name ? [row.provider_name] : [],
            frequency: template.frequency,
            frequency_day: template.frequency_day,
            next_order_date: template.next_order_date,
            message: `New recurring order for ${subject.label} (${template.quantity} ${template.frequency}) requires approval`,
          },
        );
      } catch (pubErr) {
        this.logger.error(
          `Failed to publish approval_needed event for ${row.id}: ${pubErr?.message}`,
        );
      }
    }

    return { ...row, calendar };
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
   * Daily at 6:00 AM — remind about schedules due in 2 days.
   *
   * WHAT THIS USED TO SEND
   *
   * `wine_name: order.wine_name || "Unknown"`, straight into
   * `notification_agent.py`'s `recurring_order_reminder` template, whose TITLE
   * is `"Recurring Order Reminder: {wine_name}"` and whose body opens `"Your
   * {frequency} recurring order for {wine_name} is coming up"`. Both channels
   * are live: `push` and `email` (notification_agent.py:171), and the
   * `recurring.events` exchange was declared under ADR 0039 Track A3, so this
   * is not an inert path.
   *
   * The name was resolved through a single-hop embed, and 53 of production's 72
   * inventory rows carry a NULL `wine_name` (measured 2026-09-02). So the
   * majority outcome was an email and a push notification titled "Recurring
   * Order Reminder: Unknown" — a fabricated value in outbound content, which
   * ADR 0051 forbids. Three more came from the CONSUMER's own defaults, which
   * this producer activated by omitting the keys: `frequency` → "scheduled",
   * `unit_type` → "bottles", `preferred_providers` → "Default provider"
   * (notification_agent.py:1766-1772). All three are now sent truthfully.
   *
   * Returns a tally rather than void. Nest ignores it; the tests do not, and
   * neither does anyone asking "did this actually do anything" — which, of the
   * four ways this method could previously do nothing, was answerable for zero
   * of them.
   */
  @Cron("0 6 * * *")
  async sendRecurringOrderReminders(): Promise<ReminderSweepOutcome> {
    const out: ReminderSweepOutcome = {
      armed: false,
      scanned: 0,
      sent: 0,
      sentUnnamed: 0,
      failed: 0,
      queryFailed: false,
    };

    // The gate, before any query, any read, any recipient. See
    // RECURRING_REMINDER_FLAG above for why this cron shares ADR 0061's flag.
    if (!recurringRemindersArmed()) {
      this.logger.log(
        `Recurring order reminders are not armed (${RECURRING_REMINDER_FLAG} is not "true"/"1"); skipping.`,
      );
      return out;
    }
    out.armed = true;

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
        // LOUD, and countable. A failed query is not "no reminders due" — it
        // is an unknown number of people who were not told. Supabase returns
        // `{data, error}` rather than throwing, so nothing above this line
        // would ever have noticed.
        out.queryFailed = true;
        this.logger.error(
          `Recurring order reminder sweep could not read its own input: ` +
            `${error.message}. Zero reminders sent, and the number that SHOULD ` +
            `have been sent is unknown.`,
        );
        return out;
      }

      const rows = (upcomingOrders || []).map(
        projectRow,
      ) as RecurringOrderRow[];
      out.scanned = rows.length;

      if (rows.length === 0) {
        this.logger.log("No recurring orders due in 2 days");
        return out;
      }

      for (const order of rows) {
        // Never "Unknown". Either the wine's real name — from
        // restaurant_inventory, or from master_wine_library one hop further,
        // which is where three quarters of them actually live — or the
        // schedule's own id, which is true and is what the notification's
        // Confirm / Edit / Cancel buttons already key on.
        const subject = describeScheduleSubject(order);
        if (!subject.resolved) {
          out.sentUnnamed += 1;
          this.logger.warn(
            `Recurring order ${order.id} has no reachable wine name ` +
              `(inventory_id=${order.inventory_id}); the reminder names the ` +
              `schedule instead. This should be zero: inventory_id is NOT NULL ` +
              `with an ON DELETE CASCADE, so the wine row must exist.`,
          );
        }
        try {
          await this.orchestratorService.publishEvent(
            "recurring.events",
            "recurring.order.reminder",
            {
              restaurant_id: order.restaurant_id,
              recurring_order_id: order.id,
              wine_name: subject.label,
              quantity: order.quantity,
              // Sent, not omitted. An absent key here is what made the consumer
              // substitute "bottles", "scheduled" and "Default provider".
              unit_type: order.unit_type,
              frequency: order.frequency,
              preferred_providers: order.provider_name
                ? [order.provider_name]
                : [],
              next_order_date: order.next_order_date,
              days_until: 2,
              // The unit is the schedule's own, not the word "bottles". A
              // reminder that says "5 bottles" for a five-CASE schedule is the
              // unit bug wearing a notification.
              message: `Recurring order for ${subject.label} (${order.quantity} ${order.unit_type}${order.quantity === 1 ? "" : "s"}) is due in 2 days`,
            },
          );
          out.sent += 1;
          this.logger.log(`Reminder sent for recurring order ${order.id}`);
        } catch (err) {
          out.failed += 1;
          this.logger.error(
            `Failed to send reminder for ${order.id}: ${err?.message}`,
          );
        }
      }

      if (out.failed > 0) {
        this.logger.error(
          `Recurring order reminders: ${out.failed} of ${out.scanned} were not delivered.`,
        );
      }
      return out;
    } catch (err) {
      out.queryFailed = true;
      this.logger.error(
        `Recurring order reminder cron failed: ${err?.message}`,
      );
      return out;
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
        `${describeScheduleSubject(recurringOrder).label} ` +
        `x${recurringOrder.quantity} ${recurringOrder.unit_type}`,
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
      const subject = describeScheduleSubject(recurringOrder);
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
            unit_type: recurringOrder.unit_type,
            preferred_providers: recurringOrder.provider_name
              ? [recurringOrder.provider_name]
              : [],
            message: `Recurring order ${order.orderNumber} for ${subject.label} requires your approval`,
          },
        );
      } catch (pubErr) {
        // LOUD. This is the only thing that tells a human an order is sitting
        // unapproved; losing it silently means the order never ships and
        // nobody knows why.
        this.logger.error(
          `Order ${order.orderNumber} needs approval but the notification was ` +
            `not published: ${pubErr?.message}`,
        );
      }
    }

    // 3. Complete the pre-created calendar event + create the delivery event.
    //
    // WHY THIS BLOCK STILL DOES NOT THROW, AND WHAT CHANGED INSTEAD
    //
    // An order has been created above, and possibly auto-approved. Step 5 —
    // advancing `next_order_date` — has not run yet. Throwing here would leave
    // the order placed and the schedule still due, so tomorrow's 08:00 cron
    // would place the SAME ORDER AGAIN. A missing diary entry is recoverable; a
    // duplicate purchase order is not. So the calendar stays non-fatal.
    //
    // What it no longer does is read as success. Every one of the four ways
    // this block could fail was previously invisible: the lookup's `error` was
    // destructured away entirely, the update's and the insert's were never
    // requested at all, and Supabase returns `{data, error}` rather than
    // throwing — so the wrapping try/catch was inert for every database error
    // it appeared to cover.
    try {
      // The keyed lookup. Was `.like("tags", '%<uuid>%')` — a leading-wildcard
      // substring scan, against a column this table does not have, filtered on
      // a status value it has never held. It could not match, and could not
      // have used an index if it had.
      const { data: existingEvents, error: lookupError } =
        await this.databaseService.supabase
          .from("calendar_events")
          .select("id")
          .eq("restaurant_id", recurringOrder.restaurant_id)
          .eq("recurring_order_id", recurringOrder.id)
          .eq("event_date", recurringOrder.next_order_date)
          .eq("status", CALENDAR_STATUS.PENDING)
          .limit(1);

      if (lookupError) {
        this.logger.error(
          `Could not look up the calendar event for recurring order ` +
            `${recurringOrder.id} on ${recurringOrder.next_order_date}: ` +
            `${lookupError.message}. Order ${order.orderNumber} was still placed.`,
        );
      } else if (!existingEvents || existingEvents.length === 0) {
        // Distinct from an error, and distinct from success. A pre-created
        // event should exist for this date; none does. Silence here is what let
        // an empty calendar look like a working one for as long as it did.
        this.logger.warn(
          `No pending calendar event to complete for recurring order ` +
            `${recurringOrder.id} on ${recurringOrder.next_order_date} — the ` +
            `pre-create either never ran or never landed. Order ` +
            `${order.orderNumber} was still placed.`,
        );
      } else {
        const { error: updateError } = await this.databaseService.supabase
          .from("calendar_events")
          .update({
            status: CALENDAR_STATUS.COMPLETED,
            // The link the `tags` blob was pretending to be. `order_id` is a
            // real uuid column with an FK to procurement_orders.
            order_id: order.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingEvents[0].id);
        if (updateError) {
          this.logger.error(
            `Calendar event ${existingEvents[0].id} could not be marked ` +
              `completed for order ${order.orderNumber}: ${updateError.message}`,
          );
        }
      }

      // Create a delivery calendar event (+7 days)
      const expectedDelivery = new Date();
      expectedDelivery.setDate(expectedDelivery.getDate() + 7);
      const subject = describeScheduleSubject(recurringOrder);

      const { error: insertError } = await this.databaseService.supabase
        .from("calendar_events")
        .insert({
          restaurant_id: recurringOrder.restaurant_id,
          title: `Recurring Delivery: ${subject.resolved ? subject.label : order.orderNumber}`,
          // The unit is the schedule's own. "5 bottles" for a five-case
          // schedule is the same unit bug one layer up, in prose.
          description:
            `Recurring order ${order.orderNumber} — ${recurringOrder.quantity} ` +
            `${recurringOrder.unit_type}${recurringOrder.quantity === 1 ? "" : "s"}`,
          event_type: "delivery",
          event_date: expectedDelivery.toISOString().split("T")[0],
          event_time: "10:00",
          all_day: false,
          // NOT NULL with no default; omitted by every previous write here.
          source: CALENDAR_SOURCE_SYSTEM,
          status: CALENDAR_STATUS.PENDING,
          // Three real uuid columns, replacing a JSON string in a column that
          // does not exist.
          order_id: order.id,
          provider_id: recurringOrder.provider_id,
          recurring_order_id: recurringOrder.id,
          is_recurring: true,
          reminder_enabled: true,
          reminder_days_before: 1,
        });

      if (insertError) {
        this.logger.error(
          `Delivery calendar event for order ${order.orderNumber} was not ` +
            `written: ${insertError.message}. The order exists; the calendar ` +
            `does not show it.`,
        );
      }
    } catch (calErr) {
      this.logger.error(
        `Calendar event update failed for recurring order ${recurringOrder.id}: ${calErr?.message}`,
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
          // `recurring_order_executed`'s template titles itself
          // "Order Placed: {wine_name}" and lists {unit_type} and
          // {provider_name}. Omitting the last two made the consumer print
          // "bottles" for a case order and nothing for the vendor.
          wine_name: describeScheduleSubject(recurringOrder).label,
          quantity: recurringOrder.quantity,
          unit_type: recurringOrder.unit_type,
          provider_name: recurringOrder.provider_name,
          auto_approved: recurringOrder.auto_approve,
          next_order_date: nextDate,
        },
      );
    } catch (pubErr) {
      this.logger.error(
        `Order ${order.orderNumber} was placed but its "executed" event was ` +
          `not published: ${pubErr?.message}`,
      );
    }

    this.logger.log(
      `Recurring order ${recurringOrder.id} executed successfully. ` +
        `New order: ${order.id}, next due: ${nextDate}`,
    );
  }

  /**
   * Pre-create calendar events for all future recurrences (up to 12 months).
   *
   * Each event carries `recurring_order_id` — a real uuid column with an FK and
   * a partial index (ADR 0068) — so `executeRecurringOrder` can find its own
   * occurrence with one index probe. The previous version serialised the id
   * into a `tags` JSON string and searched for it with `LIKE '%uuid%'`; neither
   * `tags` nor `priority` is a column of this table, so every insert here
   * failed with PGRST204 and the read could never have matched.
   *
   * Returns what it actually wrote. `void` was the problem: the insert's error
   * was logged at warn and discarded, so a caller could not distinguish "60
   * events created" from "none, and the calendar is empty forever".
   */
  private async preCreateCalendarEvents(
    recurringOrder: any,
  ): Promise<CalendarWriteOutcome> {
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
    // The wine's real name, from either hop — or the schedule's own id. Never
    // the literal "Wine", which is what this title used to fall back to and
    // which is indistinguishable from a wine actually called Wine.
    const subject = describeScheduleSubject(recurringOrder);

    // Generate all future dates within the window.
    //
    // `calculateNextOrderDate` THROWS on an unknown frequency or a malformed
    // date. Caught here rather than in the caller, so that a schedule which
    // committed successfully cannot be reported as a failed create — the
    // outcome says the calendar did not happen, which is the true statement.
    try {
      // eslint-disable-next-line no-constant-condition -- break when dates exceed endDate
      while (true) {
        if (events.length >= MAX_EVENTS) break;
        const dateObj = new Date(currentDate);
        if (dateObj > endDate) break;

        events.push({
          restaurant_id: recurringOrder.restaurant_id,
          // `(N units)` was wrong for every schedule that is not counted in
          // units. The schedule's own unit_type is NOT NULL and right here.
          title:
            `Recurring Order: ${subject.label} (${recurringOrder.quantity} ` +
            `${recurringOrder.unit_type}${recurringOrder.quantity === 1 ? "" : "s"})`,
          description: `Auto-scheduled recurring order — ${frequency}`,
          event_type: "order",
          event_date: currentDate,
          event_time: "08:00",
          all_day: false,
          // `source` is varchar(50) NOT NULL with NO DEFAULT. Omitting it was a
          // second, independent reason every one of these inserts failed.
          source: CALENDAR_SOURCE_SYSTEM,
          // `pending`, the column default and 16 of the 19 real rows — not the
          // invented `SCHEDULED`, which this table has never held in any casing.
          status: CALENDAR_STATUS.PENDING,
          // The link, as a column. No `order_id` yet: no order exists until the
          // 08:00 cron materialises this occurrence.
          recurring_order_id: recurringOrder.id,
          provider_id: recurringOrder.provider_id,
          is_recurring: true,
          reminder_enabled: true,
          reminder_days_before: 2,
        });

        currentDate = this.calculateNextOrderDate(
          currentDate,
          frequency,
          frequencyDay,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Could not lay out the calendar for recurring order ` +
          `${recurringOrder.id}: ${err?.message}. The schedule exists; its ` +
          `calendar does not.`,
      );
      return {
        requested: events.length,
        written: 0,
        error: err?.message ?? String(err),
      };
    }

    if (events.length === 0) {
      return { requested: 0, written: 0, error: null };
    }

    const { error } = await this.databaseService.supabase
      .from("calendar_events")
      .insert(events);

    if (error) {
      // Reported to the caller, not just to the log. This is a bulk insert:
      // PostgREST rejects the whole statement, so the failure is all-or-nothing
      // and `written` is genuinely 0.
      this.logger.error(
        `Failed to bulk-insert ${events.length} calendar events for recurring ` +
          `order ${recurringOrder.id}: ${error.message}`,
      );
      return { requested: events.length, written: 0, error: error.message };
    }

    this.logger.log(
      `Pre-created ${events.length} calendar events for recurring order ${recurringOrder.id}`,
    );
    return { requested: events.length, written: events.length, error: null };
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
