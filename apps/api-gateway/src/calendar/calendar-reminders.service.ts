import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ScheduledTenantsService } from "../communications/scheduled-tenants.service";
import type { ScheduledTenant } from "../communications/scheduled-tenants.service";
import { ConfigService } from "@nestjs/config";
import {
  CALENDAR_REMINDER_FLAG,
  calendarRemindersArmed,
  isKnownTimeZone,
  isWithinQuietHours,
  nextTickAfter,
  reminderDueAt,
  type QuietHours,
} from "./reminder-window";

/**
 * The calendar reminder job — the thing `calendar_events.reminder_sent` has
 * been waiting for since the production baseline.
 *
 * WHAT WAS THERE BEFORE
 * ---------------------
 * `reminder_enabled` and `reminder_days_before` were written by the API and
 * read by nothing. `reminder_sent` was read once (`calendar.service.ts:1118`,
 * mapping it into the response) and **written nowhere** in `apps/` or
 * `services/`. The only thing that fired a calendar reminder was a browser
 * poller draining `localStorage`
 * (`apps/web/src/lib/reminder-scheduler.ts:9,247`, booted at `main.tsx:20`), so
 * a reminder set on the office laptop did not exist on the phone and none fired
 * with the tab closed. calendar.md §13.1 asked for this job by name.
 *
 * THE FOUR PROPERTIES THIS JOB IS BUILT AROUND
 * --------------------------------------------
 * 1. **It never sends twice.** Not by remembering, by construction: every send
 *    is preceded by an INSERT into `calendar_reminder_dispatches`, whose UNIQUE
 *    `(calendar_event_id, user_id)` index is the idempotency key. Two gateway
 *    instances sweeping the same tenant at the same instant cannot both win the
 *    insert, so they cannot both send. `reminder_sent` is the roll-up, not the
 *    lock — a boolean read-then-written is a race, and this table is not.
 * 2. **It is per-tenant isolated.** It runs under
 *    `ScheduledTenantsService.runPerTenant` (ADR 0022), so it serves only
 *    opted-in restaurants, one tenant's failure never costs another its run,
 *    and every run logs `SCHEDULED_JOB_SUMMARY`.
 * 3. **It honours quiet hours** — per person, on the restaurant's wall clock
 *    (see `reminder-window.ts` for why the tenant's zone and not the server's).
 *    A member inside their window is DEFERRED, not dropped: no dispatch row is
 *    claimed for them, so the next sweep after the window closes serves them.
 *    Because the claim is per person, deferring one member cannot delay or
 *    duplicate another's.
 * 4. **It reports itself.** One `calendar_reminder_runs` row per tenant per
 *    sweep, with counts, opened before the work and closed after it. A page
 *    that says "reminders are handled" while this process has been down for a
 *    day is the exact fault ADR 0020 names, so `GET /calendar/reminders/status`
 *    renders the last actual run beside the next scheduled tick and says plainly
 *    when there has never been one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * - **No email or SMS.** The funnel is `persistForRestaurant`, which writes the
 *   durable inbox row, emits over the socket and pushes to mobile. Mail would
 *   need a recipient policy of its own (`RecipientResolverService`, and the
 *   legacy-tenant carve-out in `scheduled-tasks.service.ts:120-146`); the page
 *   renders the email channel disabled and says so rather than pretending.
 * - **No sub-day offsets.** `reminder_days_before` is an INTEGER of days
 *   (baseline:2358). "15 minutes before" is not representable in the column, so
 *   the sheet offers day-granular choices and says why (calendar.md §13).
 * - **No reminders for client-expanded occurrences.** A recurring series that
 *   was never materialised through `POST /calendar/recurrence/:ruleId/generate`
 *   exists as ONE row; the occurrences the page draws are expanded in the
 *   browser (`lib/calendar/recurrence.ts`) and have no id this job can key on.
 *   Materialised occurrences are real rows and are reminded normally.
 */
/**
 * The schedule, as module constants.
 *
 * They are NOT read off the class inside its own `@Cron` decorator: with
 * TypeScript's legacy decorator emit the `__decorate` call and the static field
 * assignments are both hoisted out of the class body, and depending on which
 * lands first the decorator would receive `undefined` and the job would never be
 * registered — a cron that silently does not exist. The statics below re-export
 * these same constants so callers keep one name for them.
 */
const REMINDER_CRON = "*/15 * * * *";
const REMINDER_JOB_NAME = "calendar-reminders";
const REMINDER_INTERVAL_MINUTES = 15;

@Injectable()
export class CalendarRemindersService {
  private readonly logger = new Logger(CalendarRemindersService.name);

  /** The `runPerTenant` job name, and the value stored on every run row. */
  static readonly JOB_NAME = REMINDER_JOB_NAME;

  /** The cron's step. One source, so the decorator and the page cannot drift. */
  static readonly INTERVAL_MINUTES = REMINDER_INTERVAL_MINUTES;
  static readonly CRON_EXPRESSION = REMINDER_CRON;

  /**
   * How far ahead a candidate can sit. `reminder_days_before` has no ceiling in
   * the column, so a window is needed; 60 days is twice the largest offset the
   * UI can produce and is stated on the status response rather than assumed.
   */
  static readonly LOOKAHEAD_DAYS = 60;

  /** How far back the sweep still looks, so a two-day outage is recoverable. */
  static readonly LOOKBACK_DAYS = 3;

  /**
   * The candidate cap. A cap that silently truncates is the disease, so the run
   * row carries `truncated` and the status endpoint surfaces it.
   */
  static readonly CANDIDATE_CAP = 500;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly tenants: ScheduledTenantsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Is the job armed?
   *
   * OFF BY DEFAULT. This path writes real notification rows into real members'
   * inboxes and pushes them to real phones, and it is NOT gated on the page's
   * Mudavym design flag — a design flag decides what a page looks like, not
   * whether a house gets woken up. Arming it is the founder's call; ADR 0109
   * records what must be true first.
   *
   * The whole sweep returns before it reads a row, resolves a member or writes
   * anything while this is unset, and it says so in the log and on the status
   * endpoint rather than looking like a job with nothing to do.
   */
  private armed(): boolean {
    return calendarRemindersArmed(
      this.configService.get<string>(CALENDAR_REMINDER_FLAG) ??
        process.env[CALENDAR_REMINDER_FLAG],
    );
  }

  // ==========================================================================
  // THE CRON
  // ==========================================================================

  @Cron(REMINDER_CRON, { name: REMINDER_JOB_NAME })
  async sweep(): Promise<void> {
    if (!this.armed()) {
      this.logger.log(
        `${REMINDER_JOB_NAME} skipped — ${CALENDAR_REMINDER_FLAG} is not set. ` +
          "This job is off by default and sends nothing until it is armed. " +
          "The page reports this as 'built but not armed', not as 'nothing was due'.",
      );
      return;
    }
    await this.tenants.runPerTenant(
      CalendarRemindersService.JOB_NAME,
      async (tenant) => {
        await this.sweepTenant(tenant);
      },
    );
  }

  // ==========================================================================
  // ONE TENANT
  // ==========================================================================

  /**
   * Sweep one restaurant. Exported (public) so a spec can drive it with a fixed
   * clock instead of waiting fifteen minutes for a decorator.
   */
  async sweepTenant(
    tenant: ScheduledTenant,
    now: Date = new Date(),
  ): Promise<RunTally> {
    const timeZone = isKnownTimeZone(tenant.timezone)
      ? tenant.timezone
      : "UTC";
    if (timeZone !== tenant.timezone) {
      this.logger.error(
        `CALENDAR_REMINDER_TIMEZONE_UNKNOWN restaurant=${tenant.id} ` +
          `timezone=${JSON.stringify(tenant.timezone)} — falling back to UTC. ` +
          "Reminder times for this house will be wrong until the column is fixed.",
      );
    }

    const tally: RunTally = {
      considered: 0,
      sent: 0,
      deferredQuietHours: 0,
      expired: 0,
      failed: 0,
      truncated: false,
    };

    const runId = await this.openRun(tenant.id, now);

    try {
      const memberIds = await this.databaseService.getRestaurantMemberIds(
        tenant.id,
      );
      if (memberIds.length === 0) {
        // Not an error and not health either: a restaurant with no members has
        // nobody to remind, and the run row says so with considered = 0.
        this.logger.log(
          `${CalendarRemindersService.JOB_NAME} restaurant=${tenant.id} — no active members; nothing to remind.`,
        );
        await this.closeRun(runId, tally, now, null);
        return tally;
      }

      const prefs = await this.readPreferences(tenant.id, memberIds);
      const intended = memberIds.filter(
        (id) => prefs.get(id)?.calendarRemindersEnabled !== false,
      );

      const candidates = await this.readCandidates(tenant.id, now);
      tally.truncated = candidates.truncated;
      if (candidates.truncated) {
        this.logger.warn(
          `CALENDAR_REMINDER_CANDIDATES_TRUNCATED restaurant=${tenant.id} ` +
            `cap=${CalendarRemindersService.CANDIDATE_CAP} — the sweep read a full page; ` +
            "later entries wait for the next tick.",
        );
      }

      for (const row of candidates.rows) {
        await this.processEvent(row, {
          tenantId: tenant.id,
          timeZone,
          now,
          intended,
          prefs,
          tally,
        });
      }

      await this.closeRun(runId, tally, new Date(), null);
      return tally;
    } catch (error: any) {
      await this.closeRun(runId, tally, new Date(), error?.message ?? "unknown");
      throw error;
    }
  }

  // ==========================================================================
  // ONE EVENT
  // ==========================================================================

  private async processEvent(
    row: CandidateRow,
    ctx: {
      tenantId: string;
      timeZone: string;
      now: Date;
      intended: string[];
      prefs: Map<string, MemberPreference>;
      tally: RunTally;
    },
  ): Promise<void> {
    const { tenantId, timeZone, now, intended, prefs, tally } = ctx;

    // A row whose own status says it is off the book is not reminded about.
    const status = String(row.status ?? "").toLowerCase();
    if (status === "cancelled" || status === "dismissed") return;

    const when = reminderDueAt(row, timeZone);
    if (!when) {
      tally.failed++;
      this.logger.warn(
        `CALENDAR_REMINDER_UNREADABLE_DATE restaurant=${tenantId} event=${row.id} — ` +
          "no readable start date; skipped rather than guessed.",
      );
      return;
    }

    if (now.getTime() < when.dueAt.getTime()) return; // not due yet
    tally.considered++;

    const started = now.getTime() >= when.startAt.getTime();

    const ready: string[] = [];
    const expired: string[] = [];
    let deferred = 0;

    for (const userId of intended) {
      const quiet = prefs.get(userId)?.quietHours ?? QUIET_OFF;
      const inQuiet = isWithinQuietHours(now, timeZone, quiet);
      if (started) {
        // The entry has already begun. Reminding now is not a reminder, and
        // holding it for a quiet window that ends after the event is worse.
        expired.push(userId);
      } else if (inQuiet) {
        deferred++;
      } else {
        ready.push(userId);
      }
    }

    tally.deferredQuietHours += deferred;

    if (expired.length) {
      const claimed = await this.claim(
        tenantId,
        row.id,
        expired,
        when.dueAt,
        "expired",
      );
      tally.expired += claimed.length;
    }

    if (ready.length) {
      const claimed = await this.claim(
        tenantId,
        row.id,
        ready,
        when.dueAt,
        null,
      );
      if (claimed.length) {
        const ok = await this.deliver(tenantId, row, when, claimed, timeZone);
        if (ok) {
          tally.sent += claimed.length;
          await this.confirm(claimed, "sent");
        } else {
          tally.failed += claimed.length;
          // Release the claim so the next sweep can try again. Nothing was
          // sent, so releasing cannot produce a double send — and leaving the
          // claim would make the reminder permanently undeliverable.
          await this.release(claimed);
        }
      }
    }

    // The roll-up. Only when nobody is still waiting: a `reminder_sent = true`
    // written while two members sit inside quiet hours would strand them.
    if (deferred === 0) {
      await this.stampEvent(row.id, ctx.tenantId, intended);
    }
  }

  // ==========================================================================
  // THE LEDGER
  // ==========================================================================

  /** Insert the claim rows, ignoring the ones that already exist. */
  private async claim(
    restaurantId: string,
    eventId: string,
    userIds: string[],
    dueAt: Date,
    outcome: "expired" | null,
  ): Promise<ClaimedRow[]> {
    const client = this.databaseService.getClient();
    const rows = userIds.map((userId) => ({
      restaurant_id: restaurantId,
      calendar_event_id: eventId,
      user_id: userId,
      due_at: dueAt.toISOString(),
      claimed_at: new Date().toISOString(),
      outcome,
      sent_at: null as string | null,
    }));

    const { data, error } = await client
      .from("calendar_reminder_dispatches")
      .upsert(rows, {
        onConflict: "calendar_event_id,user_id",
        ignoreDuplicates: true,
      })
      .select("id, user_id");

    if (error) {
      // A failed claim must not fall through to a send. Saying nothing and
      // sending anyway is how a job sends twice.
      this.logger.error(
        `CALENDAR_REMINDER_CLAIM_FAILED restaurant=${restaurantId} event=${eventId} — ` +
          `${error.message}. Nothing was sent for this event on this tick.`,
      );
      return [];
    }

    return (data ?? []).map((r: any) => ({ id: r.id, userId: r.user_id }));
  }

  private async confirm(
    claimed: ClaimedRow[],
    outcome: "sent" | "failed",
  ): Promise<void> {
    const client = this.databaseService.getClient();
    const { error } = await client
      .from("calendar_reminder_dispatches")
      .update({ sent_at: new Date().toISOString(), outcome })
      .in(
        "id",
        claimed.map((c) => c.id),
      );
    if (error) {
      // The notification went out; only the confirmation did not. The row stays
      // claimed-but-unconfirmed, which the status endpoint reports as exactly
      // that rather than counting it as delivered.
      this.logger.warn(
        `CALENDAR_REMINDER_CONFIRM_FAILED rows=${claimed.length} — ${error.message}`,
      );
    }
  }

  private async release(claimed: ClaimedRow[]): Promise<void> {
    const client = this.databaseService.getClient();
    const { error } = await client
      .from("calendar_reminder_dispatches")
      .delete()
      .in(
        "id",
        claimed.map((c) => c.id),
      );
    if (error) {
      this.logger.error(
        `CALENDAR_REMINDER_RELEASE_FAILED rows=${claimed.length} — ${error.message}. ` +
          "These reminders will not be retried; the rows are claimed with no send.",
      );
    }
  }

  /**
   * Write the durable notification. One call for the whole batch, narrowed to
   * the claimed members with `onlyUserIds` — which `persistForRestaurant`
   * intersects with the restaurant's own membership, so a bug here cannot write
   * outside the tenant.
   */
  private async deliver(
    restaurantId: string,
    row: CandidateRow,
    when: { dueAt: Date; startAt: Date },
    claimed: ClaimedRow[],
    timeZone: string,
  ): Promise<boolean> {
    const title = String(row.title ?? "Calendar entry").slice(0, 200);
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(when.startAt);
    const clock = row.all_day
      ? "all day"
      : new Intl.DateTimeFormat("en-US", {
          timeZone,
          hour: "numeric",
          minute: "2-digit",
        }).format(when.startAt);

    const { inserted } = await this.notifications.persistForRestaurant(
      restaurantId,
      {
        type: "calendar_reminder",
        title,
        message: row.all_day
          ? `On the book for ${day}, all day.`
          : `On the book for ${day} at ${clock}.`,
        priority: "medium",
        actionUrl: "/calendar",
        actionLabel: "Open the calendar",
        groupKey: `calendar_reminder:${row.id}`,
        metadata: {
          eventId: row.id,
          eventType: row.event_type ?? null,
          startsAt: when.startAt.toISOString(),
          dueAt: when.dueAt.toISOString(),
          timeZone,
          source: CalendarRemindersService.JOB_NAME,
        },
      },
      { onlyUserIds: claimed.map((c) => c.userId) },
    );

    if (inserted === 0) {
      // `persistForRestaurant` is best-effort and returns 0 on failure. Reading
      // that as success is precisely absence-reported-as-health.
      this.logger.error(
        `CALENDAR_REMINDER_PERSIST_EMPTY restaurant=${restaurantId} event=${row.id} ` +
          `claimed=${claimed.length} — the notification funnel wrote no rows.`,
      );
      return false;
    }
    return true;
  }

  /**
   * Stamp `reminder_sent` once every intended member has a dispatch row whose
   * outcome is `sent`.
   *
   * "Every member has a ROW" would be the cheaper predicate and it would be a
   * lie: an expired dispatch is a reminder that was never sent, and a column
   * named `reminder_sent` set to true over it is the absence-reported-as-health
   * fault written into the one column this whole build exists to give a writer.
   * An entry whose reminders all expired keeps `reminder_sent = false` — true,
   * and the dispatch rows say why — and simply falls out of the candidate window
   * after LOOKBACK_DAYS, its claims making every intervening sweep a no-op.
   *
   * The predicate `reminder_sent = false` is carried into the UPDATE so a
   * concurrent sweep cannot double-stamp.
   */
  private async stampEvent(
    eventId: string,
    restaurantId: string,
    intended: string[],
  ): Promise<void> {
    if (intended.length === 0) {
      // Nobody wants a calendar reminder in this house. Stamping would record a
      // send that did not happen, so the row stays open and produces no work.
      return;
    }
    const client = this.databaseService.getClient();
    const { data, error } = await client
      .from("calendar_reminder_dispatches")
      .select("user_id, outcome")
      .eq("calendar_event_id", eventId)
      .in("user_id", intended);

    if (error) {
      this.logger.warn(
        `CALENDAR_REMINDER_ROLLUP_READ_FAILED event=${eventId} — ${error.message}; ` +
          "reminder_sent left false, so the next sweep reconsiders it.",
      );
      return;
    }

    const sentTo = new Set(
      (data ?? [])
        .filter((r: any) => r.outcome === "sent")
        .map((r: any) => r.user_id),
    );
    if (intended.some((id) => !sentTo.has(id))) return;

    const { error: stampError } = await client
      .from("calendar_events")
      .update({
        reminder_sent: true,
        reminder_sent_at: new Date().toISOString(),
      })
      .eq("id", eventId)
      .eq("restaurant_id", restaurantId)
      .eq("reminder_sent", false);

    if (stampError) {
      this.logger.warn(
        `CALENDAR_REMINDER_STAMP_FAILED event=${eventId} — ${stampError.message}`,
      );
    }
  }

  // ==========================================================================
  // READS
  // ==========================================================================

  private async readCandidates(
    restaurantId: string,
    now: Date,
  ): Promise<{ rows: CandidateRow[]; truncated: boolean }> {
    const client = this.databaseService.getClient();
    const from = new Date(
      now.getTime() -
        CalendarRemindersService.LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const to = new Date(
      now.getTime() +
        CalendarRemindersService.LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
    );

    // Filtered on `event_date`, not `start_date`: `event_date` is the NOT NULL
    // column (baseline:2349) and the indexed one (`idx_calendar_events_date`),
    // and the pair is kept in step by `sync_calendar_event_date_columns()`
    // (baseline:1714-1735). `start_date` is still preferred when READING the
    // value, because that is the column the API writes first.
    const { data, error } = await client
      .from("calendar_events")
      .select(
        "id, title, event_type, status, all_day, start_date, event_date, start_time, event_time, reminder_days_before",
      )
      .eq("restaurant_id", restaurantId)
      .eq("reminder_enabled", true)
      .eq("reminder_sent", false)
      .gte("event_date", from.toISOString().slice(0, 10))
      .lte("event_date", to.toISOString().slice(0, 10))
      .order("event_date", { ascending: true })
      .limit(CalendarRemindersService.CANDIDATE_CAP + 1);

    if (error) {
      // Throwing hands the tenant to `runPerTenant`, which logs
      // SCHEDULED_JOB_TENANT_FAILED and keeps every other tenant's run. An
      // empty array here would be a sweep that found "nothing to do".
      throw new Error(`could not read calendar_events: ${error.message}`);
    }

    const rows = (data ?? []) as CandidateRow[];
    const truncated = rows.length > CalendarRemindersService.CANDIDATE_CAP;
    return {
      rows: truncated
        ? rows.slice(0, CalendarRemindersService.CANDIDATE_CAP)
        : rows,
      truncated,
    };
  }

  /**
   * Per-member notification preferences.
   *
   * A member with no row gets the same defaults `NotificationsService`
   * .getPreferences returns for a missing row (notifications.service.ts:
   * 1074-1113): reminders on, quiet hours off. That is a documented default,
   * not an invented one.
   */
  private async readPreferences(
    restaurantId: string,
    userIds: string[],
  ): Promise<Map<string, MemberPreference>> {
    const client = this.databaseService.getClient();
    const out = new Map<string, MemberPreference>();

    const { data, error } = await client
      .from("notification_preferences")
      .select(
        "user_id, restaurant_id, calendar_reminders_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end",
      )
      .in("user_id", userIds);

    if (error) {
      // Failing OPEN here is the wrong instinct and failing CLOSED is worse: a
      // read failure must not silently ignore quiet hours (waking people), nor
      // silently suppress every reminder. It aborts the tenant's sweep, which
      // `runPerTenant` records, and the next tick tries again.
      throw new Error(
        `could not read notification_preferences: ${error.message}`,
      );
    }

    for (const raw of (data ?? []) as any[]) {
      const existing = out.get(raw.user_id);
      // A user with rows in two restaurants: prefer this house's row.
      if (existing && raw.restaurant_id !== restaurantId) continue;
      out.set(raw.user_id, {
        calendarRemindersEnabled: raw.calendar_reminders_enabled !== false,
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
  // THE RUN ROW
  // ==========================================================================

  private async openRun(
    restaurantId: string,
    now: Date,
  ): Promise<string | null> {
    const client = this.databaseService.getClient();
    const { data, error } = await client
      .from("calendar_reminder_runs")
      .insert({
        restaurant_id: restaurantId,
        job_name: CalendarRemindersService.JOB_NAME,
        started_at: now.toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      // The sweep proceeds without a ledger row: delivering the reminder matters
      // more than the bookkeeping. It is NOT silent — the page will keep showing
      // the previous run, and its staleness line is what makes this visible.
      this.logger.error(
        `CALENDAR_REMINDER_RUN_OPEN_FAILED restaurant=${restaurantId} — ${error.message}. ` +
          "This sweep will not appear in the run ledger.",
      );
      return null;
    }
    return data?.id ?? null;
  }

  private async closeRun(
    runId: string | null,
    tally: RunTally,
    finishedAt: Date,
    error: string | null,
  ): Promise<void> {
    if (!runId) return;
    const client = this.databaseService.getClient();
    const { error: writeError } = await client
      .from("calendar_reminder_runs")
      .update({
        finished_at: finishedAt.toISOString(),
        considered: tally.considered,
        sent: tally.sent,
        deferred_quiet_hours: tally.deferredQuietHours,
        expired: tally.expired,
        failed: tally.failed,
        truncated: tally.truncated,
        error,
      })
      .eq("id", runId);

    if (writeError) {
      this.logger.warn(
        `CALENDAR_REMINDER_RUN_CLOSE_FAILED run=${runId} — ${writeError.message}; ` +
          "the run stays open, which the page reads as unfinished.",
      );
    }
  }

  // ==========================================================================
  // WHAT THE PAGE IS ALLOWED TO SAY
  // ==========================================================================

  /**
   * Everything `/calendar` needs to describe this job truthfully, for one
   * restaurant and one reader.
   *
   * The load-bearing field is `served`. `runPerTenant` enumerates opted-in
   * tenants only (ADR 0022), so for a restaurant that is not opted in this job
   * does nothing at all — and a page that showed a next-run time for it would be
   * promising a run that will never serve it. `served: false` carries a reason;
   * `served: null` means the opt-in register could not be read and the page says
   * that instead of guessing.
   */
  async statusFor(
    restaurantId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<ReminderStatus> {
    const client = this.databaseService.getClient();

    const armed = this.armed();
    let served: boolean | null = null;
    let servedReason: string | null = null;
    let timeZone: string | null = null;
    try {
      const tenants = await this.tenants.list();
      const mine = tenants.find((t) => t.id === restaurantId);
      served = !!mine;
      timeZone = mine?.timezone ?? null;
      if (!mine) {
        servedReason =
          `This restaurant is not enumerated by the scheduler, so the reminder job ` +
          `does not run for it. It is opted in with one row in restaurant_feature_flags ` +
          `(flag_name = '${ScheduledTenantsService.OPT_IN_FLAG}', enabled = true).`;
      }
    } catch (e: any) {
      served = null;
      servedReason = `The opt-in register could not be read (${e?.message ?? "unknown error"}), so whether this job serves this restaurant is unknown.`;
    }

    const [runRes, unconfirmedRes, pendingRes, prefRes, deliveredRes] =
      await Promise.all([
        client
          .from("calendar_reminder_runs")
          .select(
            "started_at, finished_at, considered, sent, deferred_quiet_hours, expired, failed, truncated, error",
          )
          .eq("restaurant_id", restaurantId)
          .eq("job_name", CalendarRemindersService.JOB_NAME)
          .order("started_at", { ascending: false })
          .limit(1),
        client
          .from("calendar_reminder_dispatches")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .is("sent_at", null)
          .is("outcome", null),
        client
          .from("calendar_events")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("reminder_enabled", true)
          .eq("reminder_sent", false)
          .gte("event_date", now.toISOString().slice(0, 10)),
        client
          .from("notification_preferences")
          .select(
            "calendar_reminders_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end",
          )
          .eq("user_id", userId)
          .limit(1),
        client
          .from("calendar_reminder_dispatches")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("user_id", userId)
          .eq("outcome", "sent"),
      ]);

    const runRow = (runRes.data ?? [])[0] as any | undefined;
    const prefRow = (prefRes.data ?? [])[0] as any | undefined;

    // "No run row" and "could not read the run ledger" are different sentences,
    // and collapsing them is the absence-reported-as-health fault in one field:
    // an unreachable table would otherwise render as "this job has never run".
    const ledgerReadable = !runRes.error;
    if (runRes.error) {
      this.logger.warn(
        `CALENDAR_REMINDER_RUNS_UNREADABLE restaurant=${restaurantId} — ${runRes.error.message}`,
      );
    }

    const lastRun = runRow
      ? {
          startedAt: runRow.started_at as string,
          finishedAt: (runRow.finished_at as string | null) ?? null,
          considered: Number(runRow.considered ?? 0),
          sent: Number(runRow.sent ?? 0),
          deferredQuietHours: Number(runRow.deferred_quiet_hours ?? 0),
          expired: Number(runRow.expired ?? 0),
          failed: Number(runRow.failed ?? 0),
          truncated: runRow.truncated === true,
          error: (runRow.error as string | null) ?? null,
        }
      : null;

    return {
      jobName: CalendarRemindersService.JOB_NAME,
      cronExpression: CalendarRemindersService.CRON_EXPRESSION,
      intervalMinutes: CalendarRemindersService.INTERVAL_MINUTES,
      lookaheadDays: CalendarRemindersService.LOOKAHEAD_DAYS,
      /** Days, because the column is days. Stated so the UI cannot imply minutes. */
      granularity: "days",
      served,
      servedReason,
      /**
       * The env switch. False means the cron returns before it reads anything,
       * so `served: true, armed: false` is a real and common state: this house
       * WOULD be served, and nothing is being sent.
       */
      armed,
      armedFlag: CALENDAR_REMINDER_FLAG,
      timeZone,
      /** False when the ledger itself could not be read — not the same as "never ran". */
      ledgerReadable,
      lastRun,
      /** A schedule, not a promise — null when this house is not served. */
      nextRunAt:
        served === true && armed
          ? nextTickAfter(
              now,
              CalendarRemindersService.INTERVAL_MINUTES,
            ).toISOString()
          : null,
      /** Rows claimed and never confirmed: a crash between claim and send. */
      unconfirmed: numberOrNull(unconfirmedRes.count, unconfirmedRes.error),
      /** Entries still waiting for their reminder. */
      pending: numberOrNull(pendingRes.count, pendingRes.error),
      /** How many this reader has actually been sent by this job. */
      deliveredToMe: numberOrNull(deliveredRes.count, deliveredRes.error),
      viewer: {
        remindersEnabled: prefRow
          ? prefRow.calendar_reminders_enabled !== false
          : true,
        quietHours: prefRow
          ? {
              enabled: prefRow.quiet_hours_enabled === true,
              start: prefRow.quiet_hours_start || "22:00",
              end: prefRow.quiet_hours_end || "08:00",
            }
          : { enabled: false, start: "22:00", end: "08:00" },
        /** True when there is no stored row and the defaults are standing in. */
        usingDefaults: !prefRow,
      },
    };
  }
}

/* ── shapes ───────────────────────────────────────────────────────────────── */

const QUIET_OFF: QuietHours = { enabled: false, start: "22:00", end: "08:00" };

/** A count PostgREST could not produce is unknown, and unknown is not zero. */
function numberOrNull(count: number | null, error: unknown): number | null {
  if (error) return null;
  return typeof count === "number" ? count : null;
}

export interface RunTally {
  considered: number;
  sent: number;
  deferredQuietHours: number;
  expired: number;
  failed: number;
  truncated: boolean;
}

interface CandidateRow {
  id: string;
  title: string | null;
  event_type: string | null;
  status: string | null;
  all_day: boolean | null;
  start_date: string | null;
  event_date: string | null;
  start_time: string | null;
  event_time: string | null;
  reminder_days_before: number | null;
}

interface ClaimedRow {
  id: string;
  userId: string;
}

interface MemberPreference {
  calendarRemindersEnabled: boolean;
  quietHours: QuietHours;
}

export interface ReminderStatus {
  jobName: string;
  cronExpression: string;
  intervalMinutes: number;
  lookaheadDays: number;
  granularity: "days";
  served: boolean | null;
  servedReason: string | null;
  armed: boolean;
  armedFlag: string;
  timeZone: string | null;
  ledgerReadable: boolean;
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    considered: number;
    sent: number;
    deferredQuietHours: number;
    expired: number;
    failed: number;
    truncated: boolean;
    error: string | null;
  } | null;
  nextRunAt: string | null;
  unconfirmed: number | null;
  pending: number | null;
  deliveredToMe: number | null;
  viewer: {
    remindersEnabled: boolean;
    quietHours: QuietHours;
    usingDefaults: boolean;
  };
}
