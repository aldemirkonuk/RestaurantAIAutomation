/**
 * order-recurrence.service — setting, pausing and ending a recurrence on an
 * order, and the daily generator that mints the next one.
 *
 * The founder, 2026-09-05: "Build recurrence on the order." ADR 0125's addendum
 * carries the design; this file carries the writes.
 *
 * ===========================================================================
 * THE ONE RULE THAT SHAPES EVERYTHING ELSE
 * ===========================================================================
 * A RECURRENCE NEVER APPROVES ANYTHING. Every child this file mints is born
 * PENDING, exactly as a hand-placed order is, and a person seals it with the
 * ADR 0116 gate and the ADR 0125 `approve` act. `approveOrder` is not imported
 * here and is not called from here; `order-recurrence.spec.ts` asserts that the
 * generator's whole run touches no status but the PENDING `createOrder` writes.
 *
 * This is a deliberate divergence from the sibling `recurring_orders` path,
 * which carries an `auto_approve` column and calls
 * `procurementService.approveOrder(restaurantId, order.id, userId)` directly
 * (`recurring-orders.service.ts:888`) with no challenge argument — so an
 * `auto_approve` schedule spends money with no seal and no threshold check.
 * That is filed in `.planning/v3.0-TECH-DEBT.md`; it is not repaired here
 * because it is a different subsystem's decision.
 *
 * ===========================================================================
 * WHY THE GENERATOR CANNOT JUST CALL createOrder AND WALK AWAY
 * ===========================================================================
 * `createOrder` carries a dedup merge (`procurement.service.ts:723-800`): a new
 * order for the same restaurant + inventory + provider whose predecessor is not
 * yet in a terminal state does NOT become a second order — it UPDATES the
 * existing one's quantity, price and notes and returns it.
 *
 * That is right for a re-quote and catastrophic for a recurrence. The parent of
 * a weekly rule is, by construction, the same restaurant + inventory + provider,
 * and it sits in APPROVED — which is not one of `createOrder`'s seven terminal
 * statuses. So without an exemption, every due occurrence would have silently
 * OVERWRITTEN its own parent, the child would never exist, the recurrence
 * columns would never be written, the unique index would never fire, and this
 * service would have counted `created: 1` for it. Absence reported as health,
 * with the parent order as collateral.
 *
 * `provenance.recurrence` is therefore an exemption from the merge as well as
 * the carrier of the lineage columns, and it is a SERVICE argument rather than a
 * DTO field for the reason `provenance` already is: a client must not be able to
 * claim an order is a recurrence child in order to escape the dedup guard.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { CreateOrderDto } from "./dto/procurement.dto";
import { ProcurementService, asUuid } from "./procurement.service";
import {
  OrderRecurrenceStatus,
  isDueOn,
  nextOccurrenceOn,
  planRecurrence,
  readRecurrenceFrequency,
  readRecurrenceStatus,
} from "./order-recurrence";

/**
 * Every recurrence column, written out rather than `*`.
 *
 * A literal for the same reason `RECURRING_SELECT` is one: a column removed
 * from the table breaks this query loudly instead of arriving as `undefined`,
 * which is how eight phantom fields survived unnoticed on the sibling table for
 * as long as they did.
 */
export const RECURRENCE_SELECT =
  "id, order_number, restaurant_id, inventory_id, provider_id, quantity, " +
  "unit_type, bottles_total, quoted_price, negotiated_price, final_price, " +
  "total_cost, status, approved_at, manager_notes, expected_delivery_date, " +
  "recurrence_frequency, recurrence_anchor_day, recurrence_anchored_on, " +
  "recurrence_next_due_on, recurrence_status, recurrence_status_by, " +
  "recurrence_status_at, recurrence_parent_order_id, recurrence_occurrence_on";

/** One recurring order's row, as the table actually is after the migration. */
export interface RecurrenceRow {
  id: string;
  order_number: string;
  restaurant_id: string;
  inventory_id: string;
  provider_id: string;
  quantity: number;
  unit_type: string | null;
  bottles_total: number | null;
  final_price: string | number | null;
  status: string;
  approved_at: string | null;
  manager_notes: string | null;
  recurrence_frequency: string | null;
  recurrence_anchor_day: number | null;
  recurrence_anchored_on: string | null;
  recurrence_next_due_on: string | null;
  recurrence_status: string | null;
  /**
   * Who last moved this recurrence between active / paused / ended. Doubles as
   * the actor the generator raises a child AS — see `mintOccurrence`. NULL when
   * that person's `public.users` row was deleted (the FK is ON DELETE SET NULL),
   * and a NULL actor is passed through to `createOrder`'s `asUuid`, which writes
   * `created_by = NULL` rather than inventing a "system" that is not a uuid.
   */
  recurrence_status_by: string | null;
  recurrence_status_at: string | null;
  recurrence_parent_order_id: string | null;
  recurrence_occurrence_on: string | null;
}

/**
 * What ONE generator run actually did. Every due series lands in exactly one
 * bucket, and the run is logged whether or not it made anything.
 *
 * ADR 0086's shape and `ReminderSweepOutcome`'s: a sweep that returns `void`
 * cannot distinguish "nothing was due" from "the read failed and an unknown
 * number of orders were not placed". Those are the two answers an operator most
 * needs told apart, and silence is the same for both.
 */
export interface RecurrenceRunOutcome {
  /** The day the run was made for, YYYY-MM-DD. */
  runFor: string;
  /** Active series whose next date is today or earlier. */
  due: number;
  /** Children actually minted, each born PENDING. */
  created: number;
  /**
   * A child for this parent and this occurrence ALREADY existed — the unique
   * index refused the second insert. Not a failure: it is the guarantee working,
   * and it is counted separately so a run of collisions cannot read as a run of
   * successes.
   */
  collided: number;
  /** The series could not be minted. The parent is NOT advanced. */
  failed: number;
  /**
   * The stored next date disagreed with what `nextOccurrenceOn` derives, so the
   * series was left alone rather than minted against a date nothing produced.
   */
  drifted: number;
  /** The query itself failed. `due` is not a count of anything. */
  queryFailed: boolean;
  /** Why, when it failed. Never swallowed. */
  error: string | null;
}

/** The act names filed in `system_audit_log`. One register, three verbs. */
export const RECURRENCE_ACTS = {
  SET: "order_recurrence_set",
  PAUSED: "order_recurrence_paused",
  RESUMED: "order_recurrence_resumed",
  ENDED: "order_recurrence_ended",
} as const;

@Injectable()
export class OrderRecurrenceService {
  private readonly logger = new Logger(OrderRecurrenceService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly procurementService: ProcurementService,
  ) {}

  /** Today in UTC, YYYY-MM-DD. Overridable so the tests do not need a clock. */
  private today(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
  }

  // =========================================================================
  // SETTING A RECURRENCE
  // =========================================================================

  /**
   * Put a recurrence rule on an order.
   *
   * REFUSED ON AN ORDER NOBODY HAS SEALED. The test is `approved_at IS NOT
   * NULL`, and it is the whole rule in one sentence: a recurrence repeats an
   * agreement, and an agreement is a thing a person approved. Setting one on a
   * PENDING order would let a single unsealed draft mint an unbounded series of
   * orders — every child would still need its own seal, so no money moves, but
   * the Recurring station would fill with series nobody ever agreed to, and the
   * gate would be answering the same question every week instead of once.
   *
   * NOT refused on a delivered or completed order. "We took delivery of this
   * last Tuesday, do it again every Tuesday" is the commonest way a standing
   * order actually begins, and an order that has been received is the strongest
   * evidence the agreement is real.
   *
   * NOT SEALED. See `pauseRecurrence` for the argument; it applies here in the
   * same direction. This write commits no money — every child it will ever
   * produce is born PENDING and stops at the ADR 0116 gate.
   */
  async setRecurrence(
    restaurantId: string,
    orderId: string,
    userId: string,
    input: {
      frequency: unknown;
      anchorDay?: number | null;
      startsOn?: unknown;
    },
  ): Promise<RecurrenceRow> {
    const order = await this.readOrder(restaurantId, orderId);

    if (order.recurrence_parent_order_id) {
      throw new BadRequestException({
        reason: "child_cannot_recur",
        message:
          `Order ${order.order_number} is itself one occurrence of a recurring order, ` +
          `so it cannot carry a rule of its own — that would be two series minting ` +
          `against the same wine. Set the rule on the order it came from.`,
      });
    }

    if (!order.approved_at) {
      throw new BadRequestException({
        reason: "not_approved",
        message:
          `Order ${order.order_number} has not been approved, so there is no agreement to repeat. ` +
          `Approve it once — the hold, the seal — and the recurrence can be set on it afterwards. ` +
          `Every occurrence after that is approved the same way.`,
      });
    }

    // `startsOn` defaults to today, never to the order's own approval date: an
    // order approved three weeks ago would start a series three weeks overdue,
    // and the generator would read that as work to catch up on.
    const plan = planRecurrence({
      frequency: input.frequency,
      anchorDay: input.anchorDay,
      startsOn: input.startsOn ?? this.today(),
    });
    if (!plan.ok) {
      throw new BadRequestException({
        reason: plan.reason,
        message: plan.message,
      });
    }

    const now = new Date().toISOString();
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update({
        recurrence_frequency: plan.value.frequency,
        recurrence_anchor_day: plan.value.anchorDay,
        recurrence_anchored_on: plan.value.anchoredOn,
        recurrence_next_due_on: plan.value.nextDueOn,
        recurrence_status: "active",
        recurrence_status_by: asUuid(userId),
        recurrence_status_at: now,
      })
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .select(RECURRENCE_SELECT)
      .single();

    if (error) {
      this.logger.error(
        `Could not set a recurrence on order ${orderId}: ${error.message}`,
      );
      throw error;
    }

    await this.fileRecurrenceAudit({
      restaurantId,
      orderId,
      actorUserId: userId,
      action: RECURRENCE_ACTS.SET,
      from: order.recurrence_status,
      to: "active",
      detail: {
        frequency: plan.value.frequency,
        anchorDay: plan.value.anchorDay,
        anchoredOn: plan.value.anchoredOn,
        nextDueOn: plan.value.nextDueOn,
      },
    });

    return data as unknown as RecurrenceRow;
  }

  // =========================================================================
  // PAUSING, RESUMING, ENDING
  // =========================================================================

  /**
   * Move a recurrence between active / paused / ended, recording who and when.
   *
   * WHY THIS IS NOT SEALED, AND WHAT WOULD CHANGE THAT
   * --------------------------------------------------
   * The seal (ADR 0116, ADR 0125) guards two things: an act that SPENDS money,
   * and an act that DESTROYS the record of money already spent. Ending a
   * recurrence does neither. It removes a source of future PENDING drafts, each
   * of which would have stopped at the approval gate anyway; the money is spent
   * at the seal on each child, and that seal is untouched. Pausing is the same
   * act, reversibly.
   *
   * A seal here would be ceremony with nothing behind it, and ADR 0125 already
   * says what that costs: "a control that refuses for invisible reasons teaches
   * operators to mash it until it works". So: a plain write, and an audit row
   * naming the person and the minute — which is the part that was actually
   * missing, because `recurring_orders.active` is a boolean with no actor and no
   * timestamp, and nothing anywhere records who switched a schedule off.
   *
   * What would change this: making a recurrence AUTO-APPROVE its children. Then
   * ending one would stop money, starting one would commit it, and both ends
   * would need the seal. That is exactly why this build does not auto-approve,
   * and the two decisions are the same decision.
   */
  private async moveRecurrenceTo(
    restaurantId: string,
    orderId: string,
    userId: string,
    to: OrderRecurrenceStatus,
    action: string,
  ): Promise<RecurrenceRow> {
    const order = await this.readOrder(restaurantId, orderId);
    const from = readRecurrenceStatus(order.recurrence_status);

    if (!from) {
      throw new BadRequestException({
        reason: "not_recurring",
        message:
          `Order ${order.order_number} does not repeat, so there is no recurrence to ` +
          `${to === "ended" ? "end" : to === "paused" ? "pause" : "resume"}.`,
      });
    }
    if (from === "ended") {
      throw new BadRequestException({
        reason: "already_ended",
        message:
          `The recurrence on order ${order.order_number} was ended on ` +
          `${order.recurrence_status_at ?? "a date this row does not record"} and an ended ` +
          `series is not restarted — a second life for the same rule would make one ` +
          `standing order look like two. Set a new recurrence on a current order instead.`,
      });
    }
    if (from === to) {
      throw new BadRequestException({
        reason: "already_there",
        message: `The recurrence on order ${order.order_number} is already ${to}.`,
      });
    }

    const frequency = readRecurrenceFrequency(order.recurrence_frequency);
    if (!frequency) {
      throw new BadRequestException({
        reason: "unreadable_rule",
        message:
          `Order ${order.order_number} says it repeats "${String(order.recurrence_frequency)}", ` +
          `which is not a rule this house can run, so it cannot be resumed. Nothing was changed.`,
      });
    }

    /*
     * RESUMING A SERIES WHOSE DATE HAS PASSED.
     *
     * A rule paused in March and resumed in September has a `next_due_on` six
     * months old. Left alone, the generator would read it as overdue and mint
     * one child per run until it caught up — six months of orders, one a day,
     * for wine nobody asked for. So a resume rolls the date FORWARD to the next
     * occurrence at or after today, and the audit row records both dates.
     */
    const patch: Record<string, unknown> = {
      recurrence_status: to,
      recurrence_status_by: asUuid(userId),
      recurrence_status_at: new Date().toISOString(),
    };
    let rolledTo: string | null = null;
    if (to === "active") {
      const today = this.today();
      let cursor = order.recurrence_next_due_on ?? today;
      let guard = 0;
      while (isDueOn(cursor, today) && cursor !== today) {
        const next = nextOccurrenceOn(
          cursor,
          frequency,
          order.recurrence_anchor_day,
        );
        if (!next.ok) {
          throw new BadRequestException({
            reason: next.reason,
            message: next.message,
          });
        }
        cursor = next.value;
        // A daily rule paused for a decade is 3,650 steps. The ceiling is a
        // refusal rather than a silent stop: a series this far behind is a
        // decision, not an arithmetic problem.
        if (++guard > 4000) {
          throw new BadRequestException({
            reason: "resume_too_far_behind",
            message:
              `The recurrence on order ${order.order_number} is more than 4,000 occurrences ` +
              `behind, which is further than this house will roll a paused series forward. ` +
              `End it and set a new recurrence on a current order.`,
          });
        }
      }
      if (cursor !== order.recurrence_next_due_on) rolledTo = cursor;
      patch.recurrence_next_due_on = cursor;
    }

    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update(patch)
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .select(RECURRENCE_SELECT)
      .single();

    if (error) {
      this.logger.error(
        `Could not move the recurrence on order ${orderId} to ${to}: ${error.message}`,
      );
      throw error;
    }

    await this.fileRecurrenceAudit({
      restaurantId,
      orderId,
      actorUserId: userId,
      action,
      from,
      to,
      detail: {
        nextDueOnWas: order.recurrence_next_due_on,
        nextDueOnIs: (data as unknown as RecurrenceRow).recurrence_next_due_on,
        rolledForward: rolledTo !== null,
      },
    });

    return data as unknown as RecurrenceRow;
  }

  pauseRecurrence(restaurantId: string, orderId: string, userId: string) {
    return this.moveRecurrenceTo(
      restaurantId,
      orderId,
      userId,
      "paused",
      RECURRENCE_ACTS.PAUSED,
    );
  }

  resumeRecurrence(restaurantId: string, orderId: string, userId: string) {
    return this.moveRecurrenceTo(
      restaurantId,
      orderId,
      userId,
      "active",
      RECURRENCE_ACTS.RESUMED,
    );
  }

  endRecurrence(restaurantId: string, orderId: string, userId: string) {
    return this.moveRecurrenceTo(
      restaurantId,
      orderId,
      userId,
      "ended",
      RECURRENCE_ACTS.ENDED,
    );
  }

  // =========================================================================
  // THE GENERATOR
  // =========================================================================

  /**
   * Daily at 08:15 — mint one child for every series that is due.
   *
   * THE CADENCE IS THE HOUSE'S EXISTING ONE, OFFSET BY A QUARTER HOUR.
   * `RecurringOrdersService.executeDueRecurringOrders` runs `0 8 * * *` and
   * `sendRecurringOrderReminders` runs `0 6 * * *`; a restaurant's buying day
   * starts in the morning and this is that morning. It is 08:15 and not 08:00
   * so that the two order-minting crons do not contend for the same connection
   * pool in the same minute — and so that a log line at 08:15 is unambiguously
   * this one.
   *
   * ONE CHILD PER RUN PER SERIES, even for a series that is weeks overdue. A
   * cron that did not run for a fortnight has a fortnight of missed Tuesdays,
   * and minting all of them at once would put fourteen orders in front of a
   * manager who wanted one. Catching up one step per day is visible, refusable,
   * and cannot surprise anybody.
   */
  @Cron("15 8 * * *")
  async generateDueRecurrences(
    now: Date = new Date(),
  ): Promise<RecurrenceRunOutcome> {
    const runFor = this.today(now);
    const out: RecurrenceRunOutcome = {
      runFor,
      due: 0,
      created: 0,
      collided: 0,
      failed: 0,
      drifted: 0,
      queryFailed: false,
      error: null,
    };

    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .select(RECURRENCE_SELECT)
      .eq("recurrence_status", "active")
      .lte("recurrence_next_due_on", runFor);

    if (error) {
      // LOUD, and countable. A failed read is not "nothing was due" — it is an
      // unknown number of standing orders that were not raised. supabase-js
      // resolves `{ data, error }` and never throws, so nothing above this line
      // would have noticed.
      out.queryFailed = true;
      out.error = error.message;
      this.logger.error(
        `The recurrence generator could not read its own input for ${runFor}: ` +
          `${error.message}. Zero orders were minted, and the number that SHOULD ` +
          `have been is unknown.`,
      );
      this.recordRun(out);
      return out;
    }

    const rows = (data ?? []) as unknown as RecurrenceRow[];
    out.due = rows.length;

    for (const row of rows) {
      try {
        const verdict = await this.mintOccurrence(row, runFor);
        out[verdict] += 1;
      } catch (err: any) {
        out.failed += 1;
        this.logger.error(
          `Recurring order ${row.order_number} was due on ` +
            `${row.recurrence_next_due_on} and was not raised: ${err?.message}. ` +
            `Its next date was NOT advanced, so the next run will try again.`,
        );
      }
    }

    this.recordRun(out);
    return out;
  }

  /**
   * The run's own record, written whether or not it did anything.
   *
   * A run that minted nothing because nothing was due, and a run that minted
   * nothing because every insert collided, and a run that minted nothing
   * because the query failed, are three different facts. Logging only the first
   * shape ("no recurring orders due") is how a broken generator looks healthy
   * for a month.
   */
  private recordRun(out: RecurrenceRunOutcome): void {
    const line =
      `Recurrence generator ${out.runFor}: due=${out.due} created=${out.created} ` +
      `collided=${out.collided} drifted=${out.drifted} failed=${out.failed} ` +
      `queryFailed=${out.queryFailed}`;
    if (out.queryFailed || out.failed > 0 || out.drifted > 0) {
      this.logger.error(line + (out.error ? ` — ${out.error}` : ""));
    } else {
      this.logger.log(line);
    }
  }

  /**
   * Mint ONE occurrence of one series, then advance the parent.
   *
   * ORDER OF OPERATIONS, AND WHY IT IS THIS WAY ROUND. The child is written
   * first and the parent advanced second. The reverse — advance, then mint —
   * loses an occurrence entirely if the mint fails, and nothing would ever say
   * so. This way a failure leaves the series still due, so the next run retries
   * it, and the unique index is what stops a retry that actually succeeded from
   * minting twice.
   */
  private async mintOccurrence(
    row: RecurrenceRow,
    runFor: string,
  ): Promise<"created" | "collided" | "failed" | "drifted"> {
    const frequency = readRecurrenceFrequency(row.recurrence_frequency);
    const occurrenceOn = row.recurrence_next_due_on;

    if (!frequency || !occurrenceOn) {
      this.logger.error(
        `Order ${row.order_number} is an active recurrence whose rule reads ` +
          `"${String(row.recurrence_frequency)}" and whose next date reads ` +
          `"${String(occurrenceOn)}". One of those is not something this house can ` +
          `run, so nothing was minted and nothing was advanced.`,
      );
      return "drifted";
    }

    // The advance is derived BEFORE the write, so a rule whose arithmetic
    // cannot continue never mints a child it could not follow up.
    const advanced = nextOccurrenceOn(
      occurrenceOn,
      frequency,
      row.recurrence_anchor_day,
    );
    if (!advanced.ok) {
      this.logger.error(
        `Order ${row.order_number} is due on ${occurrenceOn} but the date after it ` +
          `cannot be worked out: ${advanced.message}. Nothing was minted.`,
      );
      return "drifted";
    }

    const line = await this.readParentLine(row);

    /*
     * THE PRICE IS RE-READ, NOT FROZEN, AND THIS SAYS WHICH.
     *
     * Every figure below comes from the PARENT ORDER AND ITS LINE AS THEY READ
     * AT THIS MOMENT — `final_price`, the price's own unit, the pack size, the
     * allowance, the deposit, the freight. Not from a copy taken when the rule
     * was set.
     *
     * The alternative — freezing the agreement at set-time — was rejected for a
     * reason with teeth: a vendor's price moves, somebody edits the parent order
     * to the new one, and a frozen recurrence keeps raising orders at last
     * quarter's price. The buyer approves them, because the number on the screen
     * is the number the seal covers, and the house pays a price nobody agreed to
     * this month.
     *
     * Re-reading has its own cost and it is stated rather than hidden: a change
     * to the parent order silently changes every future child. That is why the
     * child's manager note names the parent AND the date the price was read off
     * it, so an approver can see what they are repeating and when it was last
     * true. Each child is still sealed by a person at the number in front of
     * them, which is the control that actually stops a wrong price.
     */
    const priceReadAt = new Date().toISOString();
    const managerNotes = [
      row.manager_notes?.trim() || null,
      `Recurs ${frequency} from order ${row.order_number}; occurrence ${occurrenceOn}; ` +
        `price read from that order on ${priceReadAt.slice(0, 10)}.`,
    ]
      .filter(Boolean)
      .join(" — ");

    try {
      await this.procurementService.createOrder(
        row.restaurant_id,
        // The person who set the recurrence is not the person who will approve
        // this child, and `created_by` records who RAISED it. The rule's owner
        // is the truthful answer: nothing else raised this order. An empty
        // string when that user row is gone — `asUuid` turns it into NULL, which
        // reads correctly as "raised by a rule whose owner is no longer here",
        // and never into the string "system", which is not a uuid and would
        // raise 22P02 against the `created_by` foreign key.
        row.recurrence_status_by ?? "",
        {
          inventoryId: row.inventory_id,
          providerId: row.provider_id,
          quantity: row.quantity,
          unitType: row.unit_type ?? undefined,
          bottlesPerUnit: this.packSizeOf(row),
          quotedPrice: undefined,
          finalPrice: numberOrUndefined(row.final_price),
          priceUom: line?.price_uom ?? undefined,
          pricePackSize: line?.price_pack_size ?? undefined,
          allowance: numberOrUndefined(line?.allowance),
          deposit: numberOrUndefined(line?.deposit),
          freight: numberOrUndefined(line?.freight),
          isEmergency: false,
          managerNotes,
        } satisfies CreateOrderDto,
        {
          source: "recurring",
          recurrence: {
            parentOrderId: row.id,
            occurrenceOn,
          },
        },
      );
    } catch (err: any) {
      // 23505 is the unique index refusing a second child for one occurrence.
      // That is the guarantee working, not a failure — and the parent is still
      // advanced below, because the occurrence genuinely has an order.
      if (isUniqueViolation(err)) {
        this.logger.warn(
          `Order ${row.order_number} already has a child for ${occurrenceOn}; ` +
            `the second insert was refused by the index, which is what it is for. ` +
            `The series is advanced to ${advanced.value}.`,
        );
        await this.advanceParent(row, advanced.value);
        return "collided";
      }
      throw err;
    }

    await this.advanceParent(row, advanced.value);
    return "created";
  }

  /**
   * Move the parent's next date on by exactly one occurrence.
   *
   * Conditional on the date NOT having moved since it was read: `.eq` on
   * `recurrence_next_due_on` makes the update a compare-and-set, so two runs
   * overlapping cannot advance the same series twice.
   */
  private async advanceParent(
    row: RecurrenceRow,
    to: string,
  ): Promise<void> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update({ recurrence_next_due_on: to })
      .eq("id", row.id)
      .eq("recurrence_next_due_on", row.recurrence_next_due_on)
      .select("id");

    if (error) {
      this.logger.error(
        `Order ${row.order_number} was raised for ${row.recurrence_next_due_on} but ` +
          `its series was not advanced to ${to}: ${error.message}. The next run will ` +
          `see the same date, and the unique index will refuse a second order for it.`,
      );
      return;
    }
    if (!data || data.length === 0) {
      this.logger.warn(
        `Order ${row.order_number}'s next date moved while this run was minting ` +
          `${row.recurrence_next_due_on}; another run advanced it. Nothing was ` +
          `overwritten, which is what the conditional update is for.`,
      );
    }
  }

  /** The parent's order line, or null. A read error is said, never swallowed. */
  private async readParentLine(row: RecurrenceRow): Promise<{
    price_uom: string | null;
    price_pack_size: number | null;
    allowance: string | number | null;
    deposit: string | number | null;
    freight: string | number | null;
    bottles_per_unit: number | null;
  } | null> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_order_items")
      .select(
        "price_uom, price_pack_size, allowance, deposit, freight, bottles_per_unit",
      )
      .eq("order_id", row.id)
      .order("line_no", { ascending: true })
      .limit(1);

    if (error) {
      // Reported, and the mint continues WITHOUT the line's figures rather than
      // with assumed ones. A recurrence that quietly drops a deposit is a
      // recurrence that under-orders money every week.
      this.logger.error(
        `The agreement line for order ${row.order_number} could not be read: ` +
          `${error.message}. The occurrence is raised from the order header alone, ` +
          `so its price unit and its fees are NOT carried across.`,
      );
      return null;
    }
    return (data?.[0] as any) ?? null;
  }

  /**
   * Bottles in one purchase unit, back-derived from the header.
   *
   * `bottles_total / quantity`, the same arithmetic the receiving door uses.
   * Returns undefined rather than 1 when it cannot be worked out: `createOrder`
   * refuses a case order with no pack size, and that refusal is the correct
   * outcome — guessing 1 books a twelfth of the delivery.
   */
  private packSizeOf(row: RecurrenceRow): number | undefined {
    if (!row.bottles_total || !row.quantity || row.quantity <= 0) {
      return undefined;
    }
    const derived = row.bottles_total / row.quantity;
    return Number.isInteger(derived) && derived >= 1 ? derived : undefined;
  }

  // =========================================================================
  // READS AND PAPER
  // =========================================================================

  private async readOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<RecurrenceRow> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .select(RECURRENCE_SELECT)
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Could not read order ${orderId} for a recurrence change: ${error.message}`,
      );
      throw error;
    }
    if (!data) {
      throw new NotFoundException(
        "No order with that id belongs to this restaurant, so there was no recurrence to change.",
      );
    }
    return data as unknown as RecurrenceRow;
  }

  /**
   * File the change in `system_audit_log`. Never throws.
   *
   * The row's shape is `recordOrderCancelled`'s, because they are events in one
   * register and a reader should not have to learn two schemas to read the life
   * of one order.
   */
  private async fileRecurrenceAudit(record: {
    restaurantId: string;
    orderId: string;
    actorUserId: string;
    action: string;
    from: string | null;
    to: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    const reason = `Recurrence ${record.from ?? "not set"} -> ${record.to}`;
    try {
      const { error } = await this.databaseService.supabase
        .from("system_audit_log")
        .insert({
          actor_type: "user",
          actor_id: record.actorUserId,
          action: record.action,
          entity_type: "procurement_order",
          entity_id: record.orderId,
          changes: {
            register: "orders",
            subject: record.orderId,
            from: record.from,
            to: record.to,
            act: record.action,
            sealed: false,
            detail: record.detail,
          },
          restaurant_id: record.restaurantId,
          reason,
        });
      if (error) {
        this.logger.error(
          `${record.action} happened but the audit row failed to write: ${error.message}. ` +
            `Order ${record.orderId}'s recurrence IS ${record.to} and the log does not say so.`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `${record.action} happened but the audit row threw: ${err?.message}. ` +
          `Order ${record.orderId}'s recurrence IS ${record.to} and the log does not say so.`,
      );
    }
  }
}

/** PostgREST/Postgres unique violation, by code rather than by message text. */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === "23505" || code === 23505;
}

/** numeric comes back from PostgREST as a string. Never a 0 for an unknown. */
function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}
