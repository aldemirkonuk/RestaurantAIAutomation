import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../notifications.service";
import {
  isWithinQuietHours,
  type QuietHours,
} from "../../calendar/reminder-window";
import {
  PRODUCER_CLOCK,
  SYSTEM_CLOCK,
  type ProducerClock,
} from "./producer-clock";

/**
 * The one place a notification producer is allowed to speak from.
 *
 * WHY IT EXISTS
 * -------------
 * Five producers landed on 2026-09-03 (goal reached, delivery at the door,
 * invoice certified, the day's sale record, a market price signal). Every one
 * is a SWEEP over rows that do not change when it reads them, so every one has
 * the same three-part problem: it must not speak twice about the same event, it
 * must not speak outside its tenant, and it must not wake a person at 3am.
 *
 * Solving that once, here, is the point. A producer below only decides WHAT
 * happened; `emit()` decides whether it may be said, to whom, and records that
 * it was.
 *
 * THE IDEMPOTENCY IS AN INDEX, NOT A MEMORY
 * -----------------------------------------
 * `NotificationsService.persistForRestaurant` already offers a soft dedupe:
 * pass `groupKey` and `dedupeWithinMinutes` and it SELECTs for a matching row
 * before it INSERTs (notifications.service.ts:648-663). Three producers use it
 * today — the low-stock digest (low-stock-alerts.service.ts:389,403) and the
 * two receipt paths (procurement.service.ts:1753,1762 / :2371,2382). It is a
 * read-then-write with nothing between the two halves, so two gateway
 * instances sweeping one tenant on the same tick both read "no row" and both
 * insert; and it is windowed, so a signal older than the window repeats.
 *
 * This service claims first, into `notification_producer_claims`, whose UNIQUE
 * `(restaurant_id, producer, dedupe_key, user_id)` index makes a double claim
 * impossible rather than unlikely. Only a won claim may be written. That is the
 * shape `calendar_reminder_dispatches` proved (ADR 0109); this generalises it so
 * five producers share one ledger instead of five tables.
 *
 * THE CLAIM IS PER PERSON, AND THAT IS WHAT MAKES QUIET HOURS SAFE
 * ---------------------------------------------------------------
 * A member inside their quiet window is DEFERRED, not dropped: no claim is
 * taken for them, so the next sweep after the window closes serves them. With a
 * per-event claim the first tick would mark the event finished for the whole
 * house and the sleeping member would never receive it. The cost is that the
 * inbox row's `created_at` is the delivery time, not the event time — which is
 * why every producer carries `occurredAt` in the metadata and says the real
 * time in words. The founder asked for "time of event" by name.
 *
 * WHOSE CLOCK
 * -----------
 * The restaurant's, from `ScheduledTenant.timezone`
 * (scheduled-tenants.service.ts:18), read through `isWithinQuietHours` — the
 * chooser that already exists in `calendar/reminder-window.ts`. It is imported
 * rather than re-derived: a second copy of a half-open-interval rule is a
 * second answer to "is this person asleep", and the two would drift.
 */

/** One tenant's members, split by whether they may be written to now. */
export interface ProducerAudience {
  /** Members outside their quiet window — claimable on this tick. */
  ready: string[];
  /** Members inside it — deliberately unclaimed, so a later sweep serves them. */
  deferred: string[];
}

/** A claim row this sweep actually won. */
export interface WonClaim {
  id: string;
  userId: string;
}

/** What one producer did to one tenant on one sweep. */
export interface ProducerTally {
  considered: number;
  emitted: number;
  deferredQuietHours: number;
  alreadyClaimed: number;
  failed: number;
  truncated: boolean;
  /** The producer's own sentence for a legitimate no-op. Never a bare zero. */
  withheldReason: string | null;
}

export function emptyTally(): ProducerTally {
  return {
    considered: 0,
    emitted: 0,
    deferredQuietHours: 0,
    alreadyClaimed: 0,
    failed: 0,
    truncated: false,
    withheldReason: null,
  };
}

/** What a producer hands `emit()`. It decides nothing about delivery. */
export interface ProducerEvent {
  /** Stable across sweeps. See the migration header for the five in use. */
  dedupeKey: string;
  /** When the thing actually happened — never `now` unless it just did. */
  occurredAt: Date;
  payload: {
    type: string;
    title: string;
    message: string;
    priority?: "low" | "medium" | "high" | "critical";
    actionUrl?: string;
    actionLabel?: string;
    metadata?: Record<string, any>;
  };
}

export type EmitOutcome =
  | "written"
  | "already_claimed"
  | "no_audience"
  | "failed";

export interface EmitContext {
  restaurantId: string;
  producer: string;
  audience: ProducerAudience;
  tally: ProducerTally;
  /**
   * The instant this sweep is operating at.
   *
   * Load-bearing, not decoration: `claimed_at` is stamped from it and
   * `claimedKeysSince` derives its window from the same value in the caller, so
   * the two compare like with like. Omitting it falls back to the injected
   * clock, which is what the wall clock was doing before — correct in
   * production, and the reason a spec could measure the calendar instead of the
   * code (see `producer-clock.ts`).
   */
  now?: Date;
}

interface MemberPreference {
  quietHours: QuietHours;
}

const QUIET_OFF: QuietHours = { enabled: false, start: "22:00", end: "08:00" };

@Injectable()
export class ProducerLedgerService {
  private readonly logger = new Logger(ProducerLedgerService.name);

  private readonly clock: ProducerClock;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly notifications: NotificationsService,
    // Optional so the seven producers' specs, which construct this service
    // directly with two arguments, keep compiling and keep their behaviour.
    @Optional() @Inject(PRODUCER_CLOCK) clock?: ProducerClock,
  ) {
    this.clock = clock ?? SYSTEM_CLOCK;
  }

  // ==========================================================================
  // WHO MAY BE WRITTEN TO
  // ==========================================================================

  /**
   * Split this restaurant's members into awake and asleep, on the restaurant's
   * wall clock.
   *
   * A member with no `notification_preferences` row gets the defaults
   * `NotificationsService.getPreferences` returns for a missing row (quiet hours
   * off) — a documented default, not an invented one.
   *
   * A read failure THROWS. Failing open would wake everyone; failing closed
   * would silently suppress every producer for the tenant, and a suppressed
   * producer is indistinguishable from a quiet house. `runPerTenant` records
   * the throw as `SCHEDULED_JOB_TENANT_FAILED` and the next tick tries again.
   */
  async audienceFor(
    restaurantId: string,
    timeZone: string,
    now: Date,
  ): Promise<ProducerAudience> {
    const memberIds =
      await this.databaseService.getRestaurantMemberIds(restaurantId);
    if (memberIds.length === 0) return { ready: [], deferred: [] };

    const prefs = await this.readPreferences(restaurantId, memberIds);
    const ready: string[] = [];
    const deferred: string[] = [];
    for (const userId of memberIds) {
      const quiet = prefs.get(userId)?.quietHours ?? QUIET_OFF;
      if (isWithinQuietHours(now, timeZone, quiet)) deferred.push(userId);
      else ready.push(userId);
    }
    return { ready, deferred };
  }

  private async readPreferences(
    restaurantId: string,
    userIds: string[],
  ): Promise<Map<string, MemberPreference>> {
    const client = this.databaseService.getClient();
    const out = new Map<string, MemberPreference>();

    const { data, error } = await client
      .from("notification_preferences")
      .select(
        "user_id, restaurant_id, quiet_hours_enabled, quiet_hours_start, quiet_hours_end",
      )
      .in("user_id", userIds);

    if (error) {
      throw new Error(
        `could not read notification_preferences: ${error.message}`,
      );
    }

    for (const raw of (data ?? []) as any[]) {
      const existing = out.get(raw.user_id);
      // A user with rows in two restaurants: prefer this house's row.
      if (existing && raw.restaurant_id !== restaurantId) continue;
      out.set(raw.user_id, {
        quietHours: {
          enabled: raw.quiet_hours_enabled === true,
          start: raw.quiet_hours_start || "22:00",
          end: raw.quiet_hours_end || "08:00",
        },
      });
    }
    return out;
  }

  // ==========================================================================
  // SAYING IT ONCE
  // ==========================================================================

  /**
   * Claim, write, confirm — in that order, or not at all.
   *
   * Returns what happened rather than throwing, because one unsayable event
   * must not cost a tenant the rest of its sweep. Every branch moves the tally,
   * so a run row can never say "considered 40, emitted 0" without also saying
   * which of the four reasons produced the zero.
   */
  async emit(ctx: EmitContext, event: ProducerEvent): Promise<EmitOutcome> {
    const { restaurantId, producer, audience, tally } = ctx;
    tally.considered += 1;
    tally.deferredQuietHours += audience.deferred.length;

    if (audience.ready.length === 0) {
      // Not a failure and not health either. Either the house has no members or
      // every one of them is asleep; the deferred count above says which.
      return "no_audience";
    }

    const claimed = await this.claim(
      restaurantId,
      producer,
      event.dedupeKey,
      audience.ready,
      event.occurredAt,
      ctx.now,
    );

    if (claimed === null) {
      // The claim query itself failed. Falling through to a write here is how a
      // producer sends twice, so it does not.
      tally.failed += 1;
      return "failed";
    }

    if (claimed.length === 0) {
      tally.alreadyClaimed += 1;
      return "already_claimed";
    }

    const { inserted } = await this.notifications.persistForRestaurant(
      restaurantId,
      {
        type: event.payload.type,
        title: event.payload.title,
        message: event.payload.message,
        priority: event.payload.priority ?? "medium",
        actionUrl: event.payload.actionUrl,
        actionLabel: event.payload.actionLabel,
        // The funnel's own group_key stays useful for grouping in the inbox.
        // It is NOT the dedupe here — the claim index is.
        groupKey: `${producer}:${event.dedupeKey}`,
        metadata: {
          ...(event.payload.metadata ?? {}),
          producer,
          occurredAt: event.occurredAt.toISOString(),
        },
      },
      // `persistForRestaurant` intersects this with the restaurant's own
      // membership, so a bug in the audience split cannot write outside the
      // tenant (notifications.service.ts:641-646).
      { onlyUserIds: claimed.map((c) => c.userId) },
    );

    if (inserted === 0) {
      // The funnel is best-effort and returns 0 on failure. Reading that as
      // success is precisely absence-reported-as-health, so the claims are
      // released and the next sweep retries them.
      this.logger.error(
        `NOTIFICATION_PRODUCER_PERSIST_EMPTY restaurant=${restaurantId} ` +
          `producer=${producer} key=${event.dedupeKey} claimed=${claimed.length} — ` +
          "the notification funnel wrote no rows; claims released for retry.",
      );
      await this.release(claimed);
      tally.failed += 1;
      return "failed";
    }

    await this.confirm(claimed, "written");
    tally.emitted += claimed.length;
    return "written";
  }

  /**
   * Insert the claim rows, ignoring the ones that already exist.
   *
   * `null` means the query failed and is NOT the same as `[]`, which means
   * every reader had already been claimed. The caller must not write on either,
   * but only one of them is an error.
   */
  private async claim(
    restaurantId: string,
    producer: string,
    dedupeKey: string,
    userIds: string[],
    occurredAt: Date,
    sweepNow?: Date,
  ): Promise<WonClaim[] | null> {
    const client = this.databaseService.getClient();
    // The sweep's instant when it has one, so `claimed_at` and the suppression
    // window `claimedKeysSince` compares it against derive from one value.
    const now = (sweepNow ?? this.clock.now()).toISOString();
    const rows = userIds.map((userId) => ({
      restaurant_id: restaurantId,
      producer,
      dedupe_key: dedupeKey,
      user_id: userId,
      claimed_at: now,
      occurred_at: occurredAt.toISOString(),
      delivered_at: null as string | null,
      outcome: null as string | null,
    }));

    const { data, error } = await client
      .from("notification_producer_claims")
      .upsert(rows, {
        onConflict: "restaurant_id,producer,dedupe_key,user_id",
        ignoreDuplicates: true,
      })
      .select("id, user_id");

    if (error) {
      this.logger.error(
        `NOTIFICATION_PRODUCER_CLAIM_FAILED restaurant=${restaurantId} ` +
          `producer=${producer} key=${dedupeKey} — ${error.message}. ` +
          "Nothing was written for this event on this tick.",
      );
      return null;
    }

    return (data ?? []).map((r: any) => ({ id: r.id, userId: r.user_id }));
  }

  private async confirm(
    claimed: WonClaim[],
    outcome: "written" | "failed",
    failure?: string,
  ): Promise<void> {
    const client = this.databaseService.getClient();
    const { error } = await client
      .from("notification_producer_claims")
      .update({
        delivered_at: this.clock.now().toISOString(),
        outcome,
        failure: failure ?? null,
      })
      .in(
        "id",
        claimed.map((c) => c.id),
      );
    if (error) {
      // The notification went out; only the confirmation did not. The row stays
      // claimed-but-unconfirmed, which the status read reports as exactly that
      // rather than counting it as delivered.
      this.logger.warn(
        `NOTIFICATION_PRODUCER_CONFIRM_FAILED rows=${claimed.length} — ${error.message}`,
      );
    }
  }

  private async release(claimed: WonClaim[]): Promise<void> {
    const client = this.databaseService.getClient();
    const { error } = await client
      .from("notification_producer_claims")
      .delete()
      .in(
        "id",
        claimed.map((c) => c.id),
      );
    if (error) {
      this.logger.error(
        `NOTIFICATION_PRODUCER_RELEASE_FAILED rows=${claimed.length} — ${error.message}. ` +
          "These events will not be retried; the rows are claimed with no write.",
      );
    }
  }

  // ==========================================================================
  // THE RUN ROW
  // ==========================================================================

  async openRun(
    restaurantId: string,
    producer: string,
    now: Date,
  ): Promise<string | null> {
    const client = this.databaseService.getClient();
    const { data, error } = await client
      .from("notification_producer_runs")
      .insert({
        restaurant_id: restaurantId,
        producer,
        started_at: now.toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      // The sweep proceeds without a ledger row: writing the notification
      // matters more than the bookkeeping. It is NOT silent — the page keeps
      // showing the previous run, and its staleness line is what makes this
      // visible.
      this.logger.error(
        `NOTIFICATION_PRODUCER_RUN_OPEN_FAILED restaurant=${restaurantId} ` +
          `producer=${producer} — ${error.message}. This sweep will not appear in the run ledger.`,
      );
      return null;
    }
    return data?.id ?? null;
  }

  async closeRun(
    runId: string | null,
    tally: ProducerTally,
    finishedAt: Date,
    error: string | null,
  ): Promise<void> {
    if (!runId) return;
    const client = this.databaseService.getClient();
    const { error: writeError } = await client
      .from("notification_producer_runs")
      .update({
        finished_at: finishedAt.toISOString(),
        considered: tally.considered,
        emitted: tally.emitted,
        deferred_quiet_hours: tally.deferredQuietHours,
        already_claimed: tally.alreadyClaimed,
        failed: tally.failed,
        truncated: tally.truncated,
        withheld_reason: tally.withheldReason,
        error,
      })
      .eq("id", runId);

    if (writeError) {
      this.logger.warn(
        `NOTIFICATION_PRODUCER_RUN_CLOSE_FAILED run=${runId} — ${writeError.message}; ` +
          "the run stays open, which the page reads as unfinished.",
      );
    }
  }

  /**
   * Every dedupe key this producer has claimed for this house since `since`.
   *
   * It exists for the one producer whose suppression window is longer than its
   * key's granularity: the market signal keys on
   * `product:<id>:<date>` but must stay quiet about a product for a week, so it
   * needs to know what it already said. The UNIQUE index still carries same-tick
   * correctness — two instances that both pass this check on the same day
   * collide on the identical key and only one wins — so this read is a
   * suppression window, never the idempotency guarantee.
   *
   * Throws rather than returning `[]`: an empty list read from a failed query
   * would un-suppress every product at once.
   */
  async claimedKeysSince(
    restaurantId: string,
    producer: string,
    since: Date,
  ): Promise<Set<string>> {
    const client = this.databaseService.getClient();
    const { data, error } = await client
      .from("notification_producer_claims")
      .select("dedupe_key")
      .eq("restaurant_id", restaurantId)
      .eq("producer", producer)
      .gte("claimed_at", since.toISOString());
    if (error) {
      throw new Error(
        `could not read notification_producer_claims: ${error.message}`,
      );
    }
    return new Set(
      (data ?? []).map((r: any) => String(r?.dedupe_key ?? "")).filter(Boolean),
    );
  }

  /**
   * Has this producer EVER claimed this dedupe key in this house?
   *
   * Added 2026-09-05 for the experiment-ended producer's mail copy, and narrow
   * on purpose. `emit` answers "did I win a claim on THIS sweep", which is not
   * the same question: quiet hours defer a member, so a second sweep wins a
   * second claim for the same event and `emit` says "written" again. That is
   * correct for an inbox row — the sleeping member must still be served — and
   * wrong for an email, which is one copy of one ending.
   *
   * Together with the UNIQUE index this is atomic, and that is worth spelling
   * out because a read used as a guard usually is not. Two instances on the
   * same tick both read `false` here and both call `emit`; the index lets only
   * ONE of them win the claims, so only that one sees `"written"` and only that
   * one sends. The read suppresses LATER sweeps; the index settles the tie
   * within one.
   *
   * Throws rather than answering `false`: a failed read reported as "never
   * claimed" would send the copy again on every sweep for as long as the
   * failure lasted.
   */
  async hasClaimFor(
    restaurantId: string,
    producer: string,
    dedupeKey: string,
  ): Promise<boolean> {
    const client = this.databaseService.getClient();
    const { data, error } = await client
      .from("notification_producer_claims")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("producer", producer)
      .eq("dedupe_key", dedupeKey)
      .limit(1);
    if (error) {
      throw new Error(
        `could not read notification_producer_claims: ${error.message}`,
      );
    }
    return (data ?? []).length > 0;
  }

  /**
   * Write one fact onto the notification rows a producer has already written,
   * addressed by the group key `emit` stamped on them.
   *
   * The ONE thing this is for: an outcome that is not knowable at insert time.
   * The experiment-ended producer's mail is sent AFTER its row lands — the row
   * is the record and the mail is a copy of it — so whether the copy went out
   * cannot be part of the insert. It is merged into `metadata` rather than
   * replacing it, and a failure is logged and returned rather than thrown: the
   * row is already correct without this, and losing the sweep over an
   * annotation would be the tail wagging the dog.
   */
  async annotate(
    restaurantId: string,
    groupKey: string,
    patch: Record<string, unknown>,
  ): Promise<boolean> {
    const client = this.databaseService.getClient();
    const { data, error } = await client
      .from("notifications")
      .select("id, metadata")
      .eq("restaurant_id", restaurantId)
      .eq("group_key", groupKey);
    if (error) {
      this.logger.warn(
        `PRODUCER_ANNOTATE_UNREADABLE restaurant=${restaurantId} group=${groupKey} — ` +
          `${error.message}. The notification stands; its metadata keeps what it was written with.`,
      );
      return false;
    }
    let ok = true;
    for (const row of (data ?? []) as any[]) {
      const merged = { ...(row?.metadata ?? {}), ...patch };
      const { error: writeError } = await client
        .from("notifications")
        .update({ metadata: merged })
        .eq("id", row.id);
      if (writeError) {
        ok = false;
        this.logger.warn(
          `PRODUCER_ANNOTATE_FAILED restaurant=${restaurantId} notification=${row.id} — ` +
            `${writeError.message}.`,
        );
      }
    }
    return ok;
  }

  /**
   * The most recent run row for one producer in one house, or `null` when there
   * has never been one. `null` is a real answer and the page must say it —
   * "this producer has never run for this restaurant" — rather than drawing a
   * next-run time as if the job were armed.
   */
  async lastRun(restaurantId: string, producer: string): Promise<any | null> {
    const client = this.databaseService.getClient();
    const { data, error } = await client
      .from("notification_producer_runs")
      .select(
        "started_at, finished_at, considered, emitted, deferred_quiet_hours, already_claimed, failed, truncated, withheld_reason, error",
      )
      .eq("restaurant_id", restaurantId)
      .eq("producer", producer)
      .order("started_at", { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(
        `could not read notification_producer_runs: ${error.message}`,
      );
    }
    return (data ?? [])[0] ?? null;
  }
}
