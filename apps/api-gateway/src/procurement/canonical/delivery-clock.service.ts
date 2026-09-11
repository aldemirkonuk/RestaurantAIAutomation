import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { ReadResult } from "./canonical-document.service";

/**
 * DeliveryClockService — the escalation ladder as durable rows (ADR 0103 D9/A10).
 *
 * WHY ROWS AND NOT TIMERS. A10, verbatim: "D9's timers are `due_at` rows worked
 * by an idempotent poller that catches up after a missed tick (a deploy, a
 * crash); never in-process timers — the scale pass named this as the place the
 * absence-as-health fault would return." An in-process `setTimeout` that a
 * deploy ate reports a Turkish 7-day response window as "not due" for ever, and
 * nothing anywhere says a deadline was missed.
 *
 * A MISSING RULE IS A BLOCKING ROW, NOT A MISSING ROW (D4, A8). `vendor_terms`
 * deliberately carries no Turkish response-window or invoice-issuance row —
 * whether a delivery at the restaurant's own premises has a 7-day window at all
 * is a question for a YMM, and the founder chose to keep it open. So when the
 * rule is absent, its `days` is NULL, its `basis` is `unknown`, or the date the
 * basis needs is not on the record, this writes a timer in `blocked_unknown`
 * with a NULL `due_at`: visible on the delivery, counted in reporting, and
 * incapable of firing. Writing no row would have rendered as "no deadline",
 * which is exactly the failure D4 names.
 *
 * THE LADDER, AND WHERE ITS TWO FLOORS COME FROM.
 *
 *   half      50 % of the window — re-notify the owner (D9 clause 1).
 *   escalate  80 % of the window, but NEVER LATER THAN:
 *               · 48 hours before expiry (D9 clause 1's floor — a short clock
 *                 must not compress a human's reaction time to hours), and
 *               · for the PAYMENT clock, 10 days before expiry, because D8 asks
 *                 for "US alcohol day ~20 of 30 — EFT debits in 10 days with a
 *                 line still disputed". That floor is about money that cannot be
 *                 recalled once the wholesaler initiates the debit (AB 2991),
 *                 not about reaction time, which is why it is separate and
 *                 larger.
 *             For the Turkish 7-day response window this lands on day 5 —
 *             D8's "day 5 of 7, silence accepts" and D9's floor agreeing.
 *   fire      the clock expires: the delivery moves to LAPSED with what the law
 *             NOW DEEMS recorded in words, and inventory does not move.
 *
 * IDEMPOTENT BY CONSTRUCTION. One timer per (delivery, document, clock) — a
 * unique index — and one `*_at` stamp per rung. A catch-up run after a missed
 * tick re-reads the same rows and skips every rung it has already climbed, so a
 * poller that has not run for three days sends one notification per rung, not
 * three.
 */

/** ADR 0103 D9 clause 1 — escalation never lands later than this before expiry. */
const ESCALATE_FLOOR_MS = 48 * 60 * 60 * 1000;
/** ADR 0103 D8 — the EFT warning, for the payment clock only. */
const PAYMENT_ESCALATE_FLOOR_MS = 10 * 24 * 60 * 60 * 1000;

export type Clock =
  | "door_correction"
  | "response_window"
  | "invoice_issuance"
  | "objection_window"
  | "payment";

interface TermsRow {
  id: string;
  restaurant_id: string | null;
  provider_id: string | null;
  days: number | null;
  basis: string;
  signed_ticket_is_final: boolean;
}

interface TimerRow {
  id: string;
  restaurant_id: string;
  delivery_id: string;
  document_id: string | null;
  clock: string;
  basis: string;
  basis_at: string | null;
  due_at: string | null;
  state: string;
  notified_half_at: string | null;
  escalated_at: string | null;
}

/** What the law deems when a clock runs out. Words, never a claim of agreement. */
export function lapseDeeming(
  clock: string,
  jurisdiction: string | null,
): string {
  if (clock === "response_window" && jurisdiction === "TR")
    return (
      "Turkish practice deems this e-İrsaliye accepted IN FULL: the response " +
      "window closed with no kabul / kısmi kabul / red sent, and silence accepts. " +
      "Mudavym records what the law deems — it does not record that this " +
      "restaurant agreed, because nobody here did."
    );
  if (clock === "objection_window" && jurisdiction === "TR")
    return (
      "TTK 21/2 deems this invoice accepted: eight days passed with no objection " +
      "raised. That is what the law now presumes, not what anyone here decided."
    );
  if (clock === "payment")
    return (
      "The payment clock ran out. Under BPC 25509 / AB 2991 a Californian " +
      "wholesaler's EFT debits on schedule whether or not the dispute is settled, " +
      "so the money may already have left with a line still open."
    );
  if (clock === "door_correction")
    return (
      "The door-correction window closed with no correction recorded. Anything " +
      "wrong with this delivery now costs more to argue than it did at the door."
    );
  return `The ${clock.replace(/_/g, " ")} expired with no human action. What the law deems here is not recorded, because no rule for it is on file.`;
}

@Injectable()
export class DeliveryClockService {
  private readonly logger = new Logger(DeliveryClockService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The `vendor_terms` row that governs one clock, most specific first.
   *
   * `{ok:true, value:null}` means the reads SUCCEEDED and no rule exists — which
   * the caller turns into a blocking timer, never into "no deadline". A read
   * that FAILED comes back `{ok:false}` and is never confused with the first.
   */
  async termsFor(input: {
    restaurantId: string;
    providerId: string | null;
    jurisdiction: string | null;
    beverageClass?: string;
    documentType: string;
    clock: Clock;
  }): Promise<ReadResult<TermsRow | null>> {
    // No jurisdiction is not "no rule": it is a rule we cannot look up, and D8
    // makes an unknown jurisdiction block. The caller writes blocked_unknown.
    if (!input.jurisdiction) return { ok: true, value: null };

    const read = await this.db
      .getClient()
      .from("vendor_terms")
      .select(
        "id, restaurant_id, provider_id, days, basis, signed_ticket_is_final",
      )
      .eq("jurisdiction", input.jurisdiction)
      .eq("document_type", input.documentType)
      .eq("clock", input.clock)
      .in("beverage_class", [input.beverageClass ?? "any", "any"]);

    if (read.error)
      return {
        ok: false,
        error: `vendor_terms read failed for ${input.clock}/${input.documentType}: ${read.error.message}`,
      };

    const rows = (read.data ?? []) as unknown as TermsRow[];
    const scoped = rows.filter(
      (r) =>
        (r.restaurant_id === null || r.restaurant_id === input.restaurantId) &&
        (r.provider_id === null || r.provider_id === input.providerId),
    );
    if (!scoped.length) return { ok: true, value: null };

    // Precedence: tenant+vendor > tenant > vendor > platform. Written as a score
    // rather than four queries so a new scope cannot silently change the order.
    const score = (r: TermsRow) =>
      (r.restaurant_id ? 2 : 0) + (r.provider_id ? 1 : 0);
    scoped.sort((a, b) => score(b) - score(a));
    return { ok: true, value: scoped[0] };
  }

  /** Is the signed door ticket final for this vendor? (ADR 0103 D3 rule B.) */
  async signedTicketIsFinal(input: {
    restaurantId: string;
    providerId: string | null;
    jurisdiction: string | null;
  }): Promise<ReadResult<boolean>> {
    const terms = await this.termsFor({
      ...input,
      documentType: "invoice",
      clock: "payment",
    });
    if (!terms.ok) return terms;
    return { ok: true, value: terms.value?.signed_ticket_is_final === true };
  }

  /**
   * Write (or leave alone) one timer. ON CONFLICT DO NOTHING by way of the
   * unique index: a clock already scheduled is never rescheduled, because the
   * rungs it has climbed live on the row.
   */
  async schedule(input: {
    restaurantId: string;
    deliveryId: string;
    documentId?: string | null;
    clock: Clock;
    documentType: string;
    providerId: string | null;
    jurisdiction: string | null;
    beverageClass?: string;
    /** The date the clock counts from, per the rule's own basis. */
    basisAt: {
      dispatch?: string | null;
      delivery?: string | null;
      issue?: string | null;
    };
  }): Promise<ReadResult<{ state: string; dueAt: string | null }>> {
    const terms = await this.termsFor({
      restaurantId: input.restaurantId,
      providerId: input.providerId,
      jurisdiction: input.jurisdiction,
      beverageClass: input.beverageClass,
      documentType: input.documentType,
      clock: input.clock,
    });
    if (!terms.ok) return terms;

    const rule = terms.value;
    const basis = rule?.basis ?? "unknown";
    const basisAt =
      basis === "dispatch_date"
        ? (input.basisAt.dispatch ?? null)
        : basis === "delivery_date"
          ? (input.basisAt.delivery ?? null)
          : basis === "document_issue_date"
            ? (input.basisAt.issue ?? null)
            : null;

    /**
     * FOUR WAYS TO BE UNKNOWN, ONE ANSWER. No rule row; a rule with no number;
     * a rule whose basis the research could not close (A8); a basis whose date
     * is not on the record. Every one of them blocks and asks. None of them
     * renders as "no deadline".
     */
    const computable =
      rule != null &&
      typeof rule.days === "number" &&
      basis !== "unknown" &&
      basisAt != null;

    const dueAt = computable
      ? new Date(
          new Date(basisAt as string).getTime() +
            (rule as TermsRow).days! * 86_400_000,
        ).toISOString()
      : null;

    const insert = await this.db
      .getClient()
      .from("delivery_timers")
      .insert({
        restaurant_id: input.restaurantId,
        delivery_id: input.deliveryId,
        document_id: input.documentId ?? null,
        clock: input.clock,
        terms_id: rule?.id ?? null,
        basis,
        basis_at: basisAt,
        due_at: dueAt,
        state: computable ? "open" : "blocked_unknown",
      })
      .select("state, due_at")
      .single();

    if (insert.error) {
      // 23505 = this clock is already scheduled. That is the idempotency, not a
      // failure: rescheduling would reset the rungs already climbed.
      if (
        insert.error.message.includes("duplicate key") ||
        (insert.error as { code?: string }).code === "23505"
      )
        return {
          ok: true,
          value: { state: computable ? "open" : "blocked_unknown", dueAt },
        };
      return {
        ok: false,
        error: `delivery_timers insert failed for ${input.clock}: ${insert.error.message}`,
      };
    }

    // `error: null` AND `data: null` should be impossible through `.single()`,
    // which raises PGRST116 when no row comes back. Handled anyway: reporting a
    // timer we never received would be a fabricated success, and a TypeError
    // here would surface as a 500 with no mention of the clock.
    if (!insert.data)
      return {
        ok: false,
        error: `delivery_timers insert for ${input.clock} on delivery ${input.deliveryId} returned no row and no error`,
      };

    return {
      ok: true,
      value: {
        state: (insert.data as { state: string }).state,
        dueAt: (insert.data as { due_at: string | null }).due_at,
      },
    };
  }

  /** Stop the clocks on a delivery that reached an end (agreed, verified, rejected). */
  async cancelFor(deliveryId: string): Promise<void> {
    const { error } = await this.db
      .getClient()
      .from("delivery_timers")
      .update({ state: "cancelled", updated_at: new Date().toISOString() })
      .eq("delivery_id", deliveryId)
      .in("state", ["open", "notified_half", "escalated", "blocked_unknown"]);
    if (error)
      this.logger.warn(
        `delivery_timers cancel failed for delivery ${deliveryId}: ${error.message}`,
      );
  }

  /** The rungs one timer should have climbed by `now`. Pure, so it is testable. */
  rungsFor(
    timer: Pick<TimerRow, "clock" | "basis_at" | "due_at">,
    now: Date,
  ): { half: boolean; escalate: boolean; fire: boolean } {
    if (!timer.due_at || !timer.basis_at)
      return { half: false, escalate: false, fire: false };
    const start = new Date(timer.basis_at).getTime();
    const due = new Date(timer.due_at).getTime();
    const t = now.getTime();
    const window = due - start;
    if (!Number.isFinite(window) || window <= 0)
      return { half: false, escalate: false, fire: t >= due };

    const halfAt = start + window * 0.5;
    const floor =
      timer.clock === "payment" ? PAYMENT_ESCALATE_FLOOR_MS : ESCALATE_FLOOR_MS;
    // 80 % of the window, or the floor, whichever comes FIRST. A 7-day window
    // escalates on day 5; a 30-day payment clock on day 20.
    const escalateAt = Math.min(start + window * 0.8, due - floor);
    return {
      half: t >= halfAt,
      escalate: t >= escalateAt,
      fire: t >= due,
    };
  }

  /**
   * The poller. Public so a test can drive it with an explicit `now` instead of
   * waiting a week, and so a catch-up can be triggered by hand after an outage.
   *
   * Returns what it DID, per rung, so a caller (and the test) can assert on the
   * work rather than on the absence of an exception.
   */
  async runDue(now: Date = new Date()): Promise<
    ReadResult<{
      examined: number;
      notifiedHalf: number;
      escalated: number;
      lapsed: number;
      blocked: number;
    }>
  > {
    const read = await this.db
      .getClient()
      .from("delivery_timers")
      .select(
        "id, restaurant_id, delivery_id, document_id, clock, basis, basis_at, due_at, state, notified_half_at, escalated_at",
      )
      .in("state", ["open", "notified_half", "escalated"])
      .order("due_at", { ascending: true })
      .limit(500);

    // A FAILED READ IS NOT AN EMPTY QUEUE. Reporting "0 timers due" on a broken
    // query is precisely how a legal deadline passes with a green dashboard.
    if (read.error)
      return {
        ok: false,
        error: `delivery_timers read failed: ${read.error.message}`,
      };

    const blockedRead = await this.db
      .getClient()
      .from("delivery_timers")
      .select("id")
      .eq("state", "blocked_unknown");
    if (blockedRead.error)
      return {
        ok: false,
        error: `delivery_timers blocked read failed: ${blockedRead.error.message}`,
      };

    const timers = (read.data ?? []) as unknown as TimerRow[];
    let notifiedHalf = 0;
    let escalated = 0;
    let lapsed = 0;

    for (const timer of timers) {
      const rungs = this.rungsFor(timer, now);
      try {
        if (rungs.fire) {
          if (await this.fire(timer)) lapsed += 1;
          continue;
        }
        if (rungs.escalate && !timer.escalated_at) {
          await this.climb(timer, "escalated");
          escalated += 1;
          continue;
        }
        if (rungs.half && !timer.notified_half_at) {
          await this.climb(timer, "notified_half");
          notifiedHalf += 1;
        }
      } catch (e) {
        // One bad timer must not stop the queue — the next run picks it up
        // because nothing was stamped.
        this.logger.error(
          `delivery timer ${timer.id} (${timer.clock}) failed: ${(e as Error)?.message}`,
        );
      }
    }

    return {
      ok: true,
      value: {
        examined: timers.length,
        notifiedHalf,
        escalated,
        lapsed,
        blocked: (blockedRead.data ?? []).length,
      },
    };
  }

  /** Hourly. The rungs are days apart, so this is a catch-up, not a heartbeat. */
  @Cron(CronExpression.EVERY_HOUR, { name: "delivery-clock-poller" })
  async pollHourly(): Promise<void> {
    const res = await this.runDue();
    if (!res.ok) this.logger.error(res.error);
    else if (res.value.lapsed || res.value.escalated || res.value.notifiedHalf)
      this.logger.log(
        `delivery clocks: ${res.value.examined} examined, ${res.value.notifiedHalf} re-notified, ${res.value.escalated} escalated, ${res.value.lapsed} lapsed, ${res.value.blocked} blocked on an unknown rule`,
      );
  }

  private async climb(
    timer: TimerRow,
    rung: "notified_half" | "escalated",
  ): Promise<void> {
    const at = new Date().toISOString();
    const stamp =
      rung === "notified_half"
        ? { state: rung, notified_half_at: at, updated_at: at }
        : { state: rung, escalated_at: at, updated_at: at };

    // STAMP FIRST, THEN NOTIFY. If the notification fails, the rung is still
    // climbed and the next run does not send it again; the alternative is an
    // hourly repeat of the same warning, which teaches people to ignore it.
    const { error } = await this.db
      .getClient()
      .from("delivery_timers")
      .update(stamp)
      .eq("id", timer.id);
    if (error)
      throw new Error(
        `could not stamp ${rung} on timer ${timer.id}: ${error.message}`,
      );

    const owners = await this.ownersOf(timer.delivery_id);
    const days = timer.due_at
      ? Math.max(
          0,
          Math.round(
            (new Date(timer.due_at).getTime() - Date.now()) / 86_400_000,
          ),
        )
      : null;

    await this.notifications.persistForRestaurant(
      timer.restaurant_id,
      {
        type: "delivery_clock",
        title:
          rung === "escalated"
            ? `${this.clockName(timer.clock)} closes in ${days ?? "?"} day(s)`
            : `${this.clockName(timer.clock)} is half over`,
        message: this.clockSentence(timer, days, rung),
        priority: rung === "escalated" ? "high" : "medium",
        actionUrl: `/deliveries/${timer.delivery_id}`,
        actionLabel: "Open the delivery",
        groupKey: `delivery-clock:${timer.id}:${rung}`,
        metadata: {
          deliveryId: timer.delivery_id,
          documentId: timer.document_id,
          clock: timer.clock,
          dueAt: timer.due_at,
          rung,
        },
      },
      {
        // At 50 % the owner; at 80 % the deputy and the venue owner as well
        // (D9 clause 2 — a closed venue must not lapse silently).
        ...(rung === "notified_half" && owners.owner
          ? { onlyUserIds: [owners.owner] }
          : {}),
        dedupeWithinMinutes: 60 * 12,
      },
    );
  }

  /** Move the delivery to LAPSED and record what the law deems. */
  private async fire(timer: TimerRow): Promise<boolean> {
    const at = new Date().toISOString();

    const read = await this.db
      .getClient()
      .from("deliveries")
      .select("id, state, jurisdiction")
      .eq("id", timer.delivery_id)
      .maybeSingle();
    if (read.error)
      throw new Error(
        `deliveries read failed for timer ${timer.id}: ${read.error.message}`,
      );
    const delivery = read.data as {
      state: string;
      jurisdiction: string | null;
    } | null;
    if (!delivery) {
      await this.db
        .getClient()
        .from("delivery_timers")
        .update({ state: "cancelled", updated_at: at })
        .eq("id", timer.id);
      return false;
    }

    // A delivery that already reached an end does not lapse. The timer is
    // cancelled rather than fired, and nothing is claimed about the law.
    const settled = [
      "AGREED",
      "VERIFIED",
      "INVOICE_FILED",
      "CANCELLED",
      "REJECTED",
      "LAPSED",
      "LAPSED_AMENDED",
    ];
    if (settled.includes(delivery.state)) {
      await this.db
        .getClient()
        .from("delivery_timers")
        .update({ state: "cancelled", updated_at: at })
        .eq("id", timer.id);
      return false;
    }

    const deemed = lapseDeeming(timer.clock, delivery.jurisdiction);
    const upd = await this.db
      .getClient()
      .from("deliveries")
      .update({
        state: "LAPSED",
        lapsed_at: at,
        lapse_deemed: deemed,
        updated_at: at,
      })
      .eq("id", timer.delivery_id);
    if (upd.error)
      throw new Error(
        `could not lapse delivery ${timer.delivery_id}: ${upd.error.message}`,
      );

    await this.db
      .getClient()
      .from("delivery_timers")
      .update({ state: "fired", fired_at: at, updated_at: at })
      .eq("id", timer.id);

    await this.notifications.persistForRestaurant(
      timer.restaurant_id,
      {
        type: "delivery_lapsed",
        title: `A delivery lapsed: ${this.clockName(timer.clock)} expired`,
        // INVENTORY DID NOT MOVE, and the sentence says so — D9 clause 4.
        message: `${deemed} Nothing was posted to inventory or cost: a lapse records what the law deems, never that anyone here agreed. A late credit memo or corrected invoice still attaches to this delivery.`,
        priority: "high",
        actionUrl: `/deliveries/${timer.delivery_id}`,
        actionLabel: "Open the delivery",
        groupKey: `delivery-lapsed:${timer.delivery_id}:${timer.clock}`,
        metadata: {
          deliveryId: timer.delivery_id,
          clock: timer.clock,
          deemed,
        },
      },
      { dedupeWithinMinutes: 60 * 24 },
    );
    return true;
  }

  private async ownersOf(
    deliveryId: string,
  ): Promise<{ owner: string | null; deputy: string | null }> {
    const { data, error } = await this.db
      .getClient()
      .from("deliveries")
      .select("owner_user_id, deputy_user_id")
      .eq("id", deliveryId)
      .maybeSingle();
    if (error || !data) return { owner: null, deputy: null };
    const row = data as {
      owner_user_id: string | null;
      deputy_user_id: string | null;
    };
    return { owner: row.owner_user_id, deputy: row.deputy_user_id };
  }

  private clockName(clock: string): string {
    switch (clock) {
      case "response_window":
        return "The e-İrsaliye response window";
      case "objection_window":
        return "The invoice objection window";
      case "payment":
        return "The payment clock";
      case "invoice_issuance":
        return "The invoice issuance window";
      default:
        return "The door-correction window";
    }
  }

  private clockSentence(
    timer: TimerRow,
    days: number | null,
    rung: string,
  ): string {
    const left = days == null ? "an unrecorded number of" : `${days}`;
    if (timer.clock === "response_window")
      return `${left} day(s) left to answer this delivery note. Silence accepts it in full — no answer is read by law as accepting every line.`;
    if (timer.clock === "objection_window")
      return `${left} day(s) left to object to this invoice. After that TTK 21/2 deems it accepted.`;
    if (timer.clock === "payment")
      return `${left} day(s) until this invoice is paid. Where the wholesaler initiates the debit it leaves on schedule whether or not a line is still disputed — settle it before then, not after.`;
    return `${left} day(s) left on this ${this.clockName(timer.clock).toLowerCase()} (${rung}).`;
  }
}
