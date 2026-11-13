import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ExpoPushService } from "../push/expo-push.service";
import { TeamService } from "./team.service";
import {
  breakCounted,
  hoursBetween,
  isWorked,
  leaveInWeek,
  onTheRoster,
  priceShift,
  recordedBreakMinutes,
  seesMoney,
  seesShiftMoneyOf,
  MoneyViewer,
  shiftForViewer,
  ShiftLike,
  TeamRole,
  WEEKLY_REVIEW_HOURS,
  workedHours,
} from "./pay-rules";
import {
  AssignCoverDto,
  CalloutDto,
  CopyWeekDto,
  CreateScheduleDto,
  CreateShiftDto,
  OfferCoverDto,
  PublishScheduleDto,
  UpdateShiftDto,
} from "./dto/team.dto";
import {
  CLOCK_TIME,
  shiftSpan,
  shiftTimesRefusal,
  spansOverlap,
} from "./shift-input";

/** Minutes since midnight from an "HH:MM" string. */
function toMinutes(t: string): number {
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}
function periodOf(start: string): "am" | "pm" {
  return toMinutes(start) < 15 * 60 ? "am" : "pm";
}

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly team: TeamService,
    private readonly notifications: NotificationsService,
    private readonly push: ExpoPushService,
  ) {}

  private get sb() {
    return this.db.supabase;
  }

  // ── Schedules ────────────────────────────────────────────────────────────
  async getOrCreateWeek(
    userId: string,
    restaurantId: string,
    weekStart: string,
  ): Promise<any> {
    await this.team.assertAccess(userId, restaurantId, "manager");
    const { data: existing } = await this.sb
      .from("schedules")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (existing) return existing;
    const { data, error } = await this.sb
      .from("schedules")
      .insert({ restaurant_id: restaurantId, week_start: weekStart })
      .select()
      .single();
    if (error)
      throw new InternalServerErrorException("Failed to create schedule");
    return data;
  }

  async createSchedule(
    userId: string,
    restaurantId: string,
    dto: CreateScheduleDto,
  ) {
    return this.getOrCreateWeek(userId, restaurantId, dto.weekStart);
  }

  /**
   * Full week payload: schedule row, shifts (+breaks), coverage analysis,
   * labor summary, receipts. Staff callers get a read-only slice via
   * getMyWeek(); owners and managers get the week here — and only the owner
   * gets its money (ADR 0215, founder 2026-09-21: "Owner only").
   */
  async getWeek(
    userId: string,
    restaurantId: string,
    weekStart: string,
  ): Promise<any> {
    // Manager-gated: the full week. Its money is the owner's alone — a
    // manager's copy carries hours and no `labor_cost`, because
    // `labor_cost / (end - start)` is the wage (ADR 0215).
    // Money in the reply follows the caller's pay access (ADR 0215, round 4
    // item 19): the owner, or a manager an owner switched on.
    const viewer = await this.team.assertAccess(
      userId,
      restaurantId,
      "manager",
      { payAccess: true },
    );
    const weekEnd = addDays(weekStart, 6);

    const [{ data: schedule }, { data: shifts, error: shiftsErr }, settings] =
      await Promise.all([
        this.sb
          .from("schedules")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .eq("week_start", weekStart)
          .maybeSingle(),
        this.sb
          .from("shifts")
          .select("*, shift_breaks(*)")
          .eq("restaurant_id", restaurantId)
          .gte("shift_date", weekStart)
          .lte("shift_date", weekEnd)
          .order("shift_date", { ascending: true }),
        this.team.getSettings(userId, restaurantId),
      ]);
    // A week whose shifts could not be read is not an empty week: it used to
    // come back as zero hours and, for the owner, a complete zero cost.
    if (shiftsErr) {
      this.logger.error(
        `getWeek: could not read the shifts of ${weekStart} for ` +
          `restaurant ${restaurantId}: ${shiftsErr.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read this week's shifts, so the week is not shown.",
      );
    }

    // A removed person's shifts are kept five years, not shown (ADR 0215 item
    // 20, `onTheRoster`): read as they were before the removal stopped
    // deleting them, so a removed person's next week is not "covered" by them.
    const roster = await this.team.rosterMemberIds(restaurantId);
    const shiftRows = onTheRoster(shifts ?? [], roster);
    const receipts = schedule
      ? ((
          await this.sb
            .from("schedule_receipts")
            .select("member_id, seen_at")
            .eq("schedule_id", schedule.id)
        ).data ?? [])
      : [];

    const coverage = await this.computeCoverage(
      restaurantId,
      weekStart,
      shiftRows,
    );
    const labor = await this.computeLabor(
      restaurantId,
      weekStart,
      shiftRows,
      settings,
      viewer,
      roster,
    );

    return {
      schedule,
      shifts: shiftRows.map((s: any) => shiftForViewer(s, viewer)),
      coverage,
      labor,
      receipts,
      settings,
      // The currency travels with the money, and only to whoever gets the
      // money: /team printed every figure in US dollars (ADR 0215).
      ...(seesMoney(viewer)
        ? { money: await this.houseMoney(restaurantId) }
        : {}),
    };
  }

  /**
   * The house's own currency and country, so a figure is printed in its money
   * and its locale. `currency: null` is "not recorded" (ADR 0117 Q25), never
   * dollars; a failed read says so rather than reading as not recorded.
   */
  private async houseMoney(restaurantId: string): Promise<{
    currency: string | null;
    country: string | null;
    readable: boolean;
  }> {
    const { data, error } = await this.sb
      .from("restaurants")
      .select("currency, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        `houseMoney: could not read the currency of ${restaurantId}: ${error.message}`,
      );
      return { currency: null, country: null, readable: false };
    }
    return {
      currency: data?.currency ?? null,
      country: data?.country ?? null,
      readable: true,
    };
  }

  /**
   * Read-only week for one person: their own shifts and the open ones.
   *
   * FAILS CLOSED (QA round 4, B1). Every read here used to take `{ data }`
   * alone, so a failed shifts read came back as `mine: []` and the page
   * printed "Off" for seven days: a week reported as free because a query
   * failed. A read that fails now raises, and the page says the week could
   * not be loaded.
   *
   * ONLY A PUBLISHED WEEK REACHES STAFF (QA round 4, H2). A schedule row is
   * created as `draft` the first time a manager touches the week, and every
   * shift a manager adds after that used to reach staff at once, moving as
   * the manager edited, with nothing saying it was not final. A staff caller
   * now gets a shift only when the schedule it belongs to is published,
   * decided here on the server, per shift, from the shift's own
   * `schedule_id` (a range that straddles two weeks is judged week by week).
   * A shift whose `schedule_id` is null is judged by the schedules row of the
   * week its `shift_date` falls in: `release_leaving_shifts` (and so a call-out
   * of its rest) writes a null id when the cut rest of a shift lands in a week
   * that had no schedules row yet, and nothing attaches it later. Hiding it
   * would show that person's real shift as a day off once the week is
   * published. Only when that week has no row, or its row is a draft, is the
   * shift unpublished. An owner or manager still sees every shift, each
   * marked `draft` when its week is not published.
   */
  async getMyWeek(userId: string, restaurantId: string, weekStart: string) {
    const { role } = await this.team.assertAccess(userId, restaurantId);
    const seesDrafts = role === "owner" || role === "manager";
    const weekEnd = addDays(weekStart, 6);
    const refuse = (what: string, err: { message: string }): never => {
      this.logger.error(
        `getMyWeek: could not read ${what} for restaurant ${restaurantId}, ` +
          `week ${weekStart}: ${err.message}`,
      );
      throw new InternalServerErrorException(
        `Could not read ${what}, so your week is not shown. This is not a week off.`,
      );
    };

    const { data: member, error: memberErr } = await this.sb
      .from("team_members")
      .select("id, display_name")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memberErr) refuse("your place on the team", memberErr);

    const { data: weekSchedule, error: scheduleErr } = await this.sb
      .from("schedules")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (scheduleErr) refuse("this week's schedule", scheduleErr);

    const { data: shifts, error: shiftsErr } = await this.sb
      .from("shifts")
      .select("*, shift_breaks(*)")
      .eq("restaurant_id", restaurantId)
      .gte("shift_date", weekStart)
      .lte("shift_date", weekEnd)
      .order("shift_date", { ascending: true });
    if (shiftsErr) refuse("this week's shifts", shiftsErr);

    // Which of the schedules these shifts belong to are published.
    const scheduleIds = Array.from(
      new Set(
        (shifts ?? [])
          .map((s: any) => s.schedule_id as string | null)
          .filter((id): id is string => !!id),
      ),
    );
    const published = new Set<string>();
    if (weekSchedule?.status === "published") published.add(weekSchedule.id);
    if (scheduleIds.length > 0) {
      const { data: rows, error: statusErr } = await this.sb
        .from("schedules")
        .select("id, status")
        .eq("restaurant_id", restaurantId)
        .in("id", scheduleIds);
      if (statusErr) refuse("whether this week is published", statusErr);
      for (const r of (rows ?? []) as Array<{ id: string; status: string }>) {
        if (r.status === "published") published.add(r.id);
      }
    }
    // A shift with no schedule_id belongs to the week of its shift_date.
    const publishedWeeks = new Set<string>();
    if (weekSchedule?.status === "published")
      publishedWeeks.add(weekSchedule.week_start);
    const loneWeeks = Array.from(
      new Set(
        (shifts ?? [])
          .filter((s: any) => !s.schedule_id)
          .map((s: any) => mondayOf(s.shift_date as string)),
      ),
    ).filter((w) => w !== weekSchedule?.week_start);
    if (loneWeeks.length > 0) {
      const { data: rows, error: weeksErr } = await this.sb
        .from("schedules")
        .select("id, week_start, status")
        .eq("restaurant_id", restaurantId)
        .in("week_start", loneWeeks);
      if (weeksErr) refuse("whether this week is published", weeksErr);
      for (const r of (rows ?? []) as Array<{
        week_start: string;
        status: string;
      }>) {
        if (r.status === "published") publishedWeeks.add(r.week_start);
      }
    }
    const isPublished = (s: any) =>
      s.schedule_id
        ? published.has(s.schedule_id)
        : publishedWeeks.has(mondayOf(s.shift_date as string));

    // Staff must never see labor cost. Strip it from every row.
    const strip = (s: any) => {
      const { labor_cost: _omit, ...rest } = s;
      return { ...rest, draft: !isPublished(s) };
    };
    const all = (shifts ?? [])
      .filter((s: any) => seesDrafts || isPublished(s))
      .map(strip);
    const mine = member
      ? all.filter((s: any) => s.member_id === member.id)
      : [];
    const open = all.filter((s: any) => s.state === "open" || !s.member_id);

    const weekPublished = weekSchedule?.status === "published";
    // Staff are not shown an unpublished schedule row either: its id is what
    // "I have seen it" confirms, and there is nothing yet to confirm.
    const schedule = weekPublished || seesDrafts ? weekSchedule : null;

    let acknowledged = false;
    if (member && weekSchedule && weekPublished) {
      const { data: receipt, error: receiptErr } = await this.sb
        .from("schedule_receipts")
        .select("id")
        .eq("schedule_id", weekSchedule.id)
        .eq("member_id", member.id)
        .maybeSingle();
      if (receiptErr)
        refuse("whether you have confirmed this week", receiptErr);
      acknowledged = !!receipt;
    }
    return {
      member,
      schedule,
      mine,
      open,
      acknowledged,
      /** The week the caller asked for is published. */
      published: weekPublished,
      /**
       * True only for staff on an unpublished week: shifts may exist, and are
       * withheld until the manager publishes. Never true for owner/manager.
       */
      draftsWithheld: !seesDrafts && !weekPublished,
    };
  }

  /**
   * Copy one week's shifts onto another.
   *
   * **This deletes the target week.** It always did — "replace target week so
   * re-running copy doesn't duplicate rows" — but neither the request nor the
   * response said so, and it is one client click. A manager who had already
   * built next week by hand and then pressed "Copy last week" lost the lot,
   * with a toast reading "Copied N shifts".
   *
   * The destruction is now in the contract (ADR 0088 T7):
   *  - an empty target week copies with no flag, because nothing is destroyed;
   *  - a target week that already holds shifts is a **409** naming how many are
   *    in the way, unless the caller passes `replaceTarget: true`;
   *  - the response says `deleted`, always, so the caller can report the real
   *    outcome rather than only the happy half of it;
   *  - a removed person's kept shifts, in either week, are neither copied nor
   *    counted nor deleted (ADR 0215 item 20, `onTheRoster`).
   *
   * The confirmation dialog is the client's half of the same fix.
   */
  async copyWeek(userId: string, restaurantId: string, dto: CopyWeekDto) {
    await this.team.assertAccess(userId, restaurantId, "manager");
    const target = await this.getOrCreateWeek(
      userId,
      restaurantId,
      dto.toWeekStart,
    );
    const fromEnd = addDays(dto.fromWeekStart, 6);
    const toEnd = addDays(dto.toWeekStart, 6);
    // Pre-existing debt (`schedule.service.ts::shifts::src` in the baseline),
    // fixed here because it is the same method and the same shape as the read
    // below: a failed source-week query gave `src === undefined` and the method
    // returned `{ copied: 0 }` — reporting a SUCCESSFUL copy of nothing for a
    // week that may be full. "I could not read the source" is not "the source
    // is empty", and the caller has no way to tell those apart from that reply.
    const { data: src, error: srcErr } = await this.sb
      .from("shifts")
      .select("*, shift_breaks(*)")
      .eq("restaurant_id", restaurantId)
      .gte("shift_date", dto.fromWeekStart)
      .lte("shift_date", fromEnd);
    if (srcErr) {
      this.logger.error(
        `copyWeek: could not read the source week ${dto.fromWeekStart} for ` +
          `restaurant ${restaurantId}: ${srcErr.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read the week you are copying from, so nothing was copied.",
      );
    }
    // A removed person's shifts are kept five years, never copied (ADR 0215
    // item 20): a copy writes a NEW shift, and a new shift is only ever for
    // someone on the roster — the check createShift makes, which the dropped
    // foreign key used to make here. Nor is a kept shift in the target week
    // "in the way": replacing the week does not delete it.
    const roster = await this.team.rosterMemberIds(restaurantId);
    const source = onTheRoster(src ?? [], roster);
    if (!source.length) return { copied: 0, deleted: 0, schedule: target };

    // This read is what arms the "the target week is not empty" guard below.
    // supabase-js RESOLVES with { data, error }, so a failed query used to give
    // `existing === undefined`, `inTheWay === 0`, and the ConflictException
    // would NOT be thrown — the copy would then delete and overwrite a week the
    // manager was never warned about. Failing closed is the only safe read here:
    // not knowing what is in the target week is not the same as it being empty.
    const { data: existing, error: existingErr } = await this.sb
      .from("shifts")
      .select("id, member_id")
      .eq("restaurant_id", restaurantId)
      .gte("shift_date", dto.toWeekStart)
      .lte("shift_date", toEnd);
    if (existingErr) {
      this.logger.error(
        `copyWeek: could not read the target week ${dto.toWeekStart} for ` +
          `restaurant ${restaurantId}: ${existingErr.message}`,
      );
      throw new InternalServerErrorException(
        "Could not check whether the target week already has shifts, so the " +
          "copy was not made. Nothing was changed.",
      );
    }
    const inTheWayIds = onTheRoster(existing ?? [], roster).map(
      (s: any) => s.id as string,
    );
    const inTheWay = inTheWayIds.length;

    if (inTheWay > 0 && !dto.replaceTarget) {
      throw new ConflictException(
        `The week of ${dto.toWeekStart} already has ${inTheWay} shift(s). ` +
          "Copying replaces the whole week; re-send with replaceTarget: true to do that.",
      );
    }

    const copyable = source.filter(
      (s: any) => s.state !== "callout" && s.state !== "open",
    );

    // Re-price from the wage on file NOW (ADR 0215). The copy used to carry the
    // source row's `labor_cost`, so a week copied after a raise — every January
    // minimum-wage rise, for a start — kept last year's cost. Read before
    // anything is deleted: a copy that cannot price itself must not have
    // emptied the target week first, and "could not read the wages" is not
    // "nobody has a wage" (it would render every copied shift unpriced).
    const memberIds = [
      ...new Set(copyable.map((s: any) => s.member_id).filter(Boolean)),
    ] as string[];
    const wageOf = new Map<string, number | null>();
    if (memberIds.length) {
      const { data: wages, error: wagesErr } = await this.sb
        .from("team_members")
        .select("id, hourly_wage")
        .eq("restaurant_id", restaurantId)
        .in("id", memberIds);
      if (wagesErr) {
        this.logger.error(
          `copyWeek: could not read wages to re-price the copy for ` +
            `restaurant ${restaurantId}: ${wagesErr.message}`,
        );
        throw new InternalServerErrorException(
          "Could not read the wages to price the copied week, so nothing was " +
            "copied and nothing was changed.",
        );
      }
      for (const w of wages ?? []) wageOf.set(w.id, w.hourly_wage ?? null);
    }

    let deleted = 0;
    if (inTheWay > 0) {
      // By id, the rows counted above: a date-range delete would also take a
      // removed person's kept shifts in that week (ADR 0215 item 20).
      const { error: deleteErr } = await this.sb
        .from("shifts")
        .delete()
        .eq("restaurant_id", restaurantId)
        .in("id", inTheWayIds);
      if (deleteErr) {
        this.logger.error(
          `copyWeek: could not clear the target week ${dto.toWeekStart} for ` +
            `restaurant ${restaurantId}: ${deleteErr.message}`,
        );
        throw new InternalServerErrorException(
          "Could not clear the week you are copying into, so nothing was copied.",
        );
      }
      deleted = inTheWay;
    }

    const dayShift = daysBetween(dto.fromWeekStart, dto.toWeekStart);
    const rows = copyable.map((s: any) => {
      // The copy carries the source's break ON RECORD as its own recorded
      // break (the planned `shift_breaks` rows are not copied, as before; their
      // minutes are). Nothing on record stays nothing on record, so the copy is
      // counted with the Art. 68 minimum and shown as assumed, like its source.
      const recorded = recordedBreakMinutes(s);
      const copy = {
        restaurant_id: restaurantId,
        schedule_id: target.id,
        member_id: s.member_id,
        shift_date: addDays(s.shift_date, dayShift),
        start_time: s.start_time,
        end_time: s.end_time,
        role: s.role,
        shift_type: s.shift_type === "open" ? "pm" : s.shift_type,
        state: "scheduled",
        note: s.note,
        recorded_break_min: recorded,
      };
      return {
        ...copy,
        // A member who is no longer on the roster has no wage here and the
        // shift is unpriced, not free.
        labor_cost: s.member_id
          ? priceShift(wageOf.get(s.member_id) ?? null, copy)
          : null,
      };
    });
    if (!rows.length) return { copied: 0, deleted, schedule: target };
    const { error } = await this.sb.from("shifts").insert(rows);
    if (error) throw new InternalServerErrorException("Failed to copy week");
    return { copied: rows.length, deleted, schedule: target };
  }

  /**
   * Publish a week.
   *
   * **Re-publishing erases every `schedule_receipts` row for the schedule.**
   * The semantics are right — a new version has not been seen by anyone — but
   * the record of who had seen the previous version is the only evidence that a
   * shift was communicated, it is destroyed on one click, and nothing said so.
   *
   * The contract now names it (ADR 0088 T7):
   *  - a first publish clears nothing and reports `receiptsCleared: 0`;
   *  - a re-publish of a schedule that already carries receipts is a **409**
   *    naming how many will be lost, unless the caller passes
   *    `resetReceipts: true`;
   *  - the response always reports `receiptsCleared`, so the count is measured
   *    rather than assumed.
   */
  async publish(
    userId: string,
    restaurantId: string,
    scheduleId: string,
    dto: PublishScheduleDto = {},
  ) {
    await this.team.assertAccess(userId, restaurantId, "manager");

    const { data: current } = await this.sb
      .from("schedules")
      .select("id, status")
      .eq("id", scheduleId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!current) throw new NotFoundException("Schedule not found");

    // Same shape as copyWeek's target-week read, same consequence: this count
    // arms the "re-publishing clears N read receipts" guard. A failed read gave
    // 0, the guard stayed silent, and the receipts were destroyed without the
    // manager ever being asked. "I could not count them" is not "there are none".
    const { data: receiptRows, error: receiptsErr } = await this.sb
      .from("schedule_receipts")
      .select("id")
      .eq("schedule_id", scheduleId);
    if (receiptsErr) {
      this.logger.error(
        `publish: could not count read receipts for schedule ${scheduleId}: ` +
          receiptsErr.message,
      );
      throw new InternalServerErrorException(
        "Could not check how many read receipts this week already has, so it " +
          "was not re-published. Nothing was changed.",
      );
    }
    const receiptsAtRisk = receiptRows?.length ?? 0;

    if (
      current.status === "published" &&
      receiptsAtRisk > 0 &&
      !dto.resetReceipts
    ) {
      throw new ConflictException(
        `Re-publishing clears the ${receiptsAtRisk} read receipt(s) on this week, ` +
          "so nobody will be recorded as having seen it. Re-send with " +
          "resetReceipts: true to publish the new version.",
      );
    }

    const { data: schedule, error } = await this.sb
      .from("schedules")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        published_by: userId,
      })
      .eq("id", scheduleId)
      .eq("restaurant_id", restaurantId)
      .select()
      .single();
    if (error || !schedule)
      throw new InternalServerErrorException("Failed to publish schedule");

    // Re-publish resets receipts so "seen" reflects the new version.
    let receiptsCleared = 0;
    if (receiptsAtRisk > 0) {
      const { error: clearErr } = await this.sb
        .from("schedule_receipts")
        .delete()
        .eq("schedule_id", scheduleId);
      if (clearErr) {
        this.logger.error(
          `published ${scheduleId} but could not clear its receipts: ${clearErr.message}`,
        );
      } else {
        receiptsCleared = receiptsAtRisk;
      }
    }

    // Notify the whole restaurant + deep-link back into /team.
    await this.notifications.persistForRestaurant(restaurantId, {
      type: "system",
      title: "Schedule published",
      message: `The week of ${schedule.week_start} is live. Open it to see your shifts.`,
      priority: "high",
      actionUrl: `/team?schedule=${scheduleId}&week=${schedule.week_start}`,
      actionLabel: "View schedule",
      groupKey: `schedule_published:${scheduleId}:${schedule.published_at}`,
      metadata: { scheduleId, weekStart: schedule.week_start },
    });
    return {
      schedule,
      receiptsCleared,
      republished: current.status === "published",
    };
  }

  /**
   * Staff opening a published schedule records a read receipt.
   *
   * It used to answer `{ acknowledged: true }` whatever the write did, and
   * 200 `{ acknowledged: false }` for a caller with no roster row, which the
   * page took as success either way (QA round 4, B3): the person believed
   * they had confirmed, and the manager's "seen" count never moved. Every
   * outcome that is not a stored receipt is now an error that says why.
   */
  async acknowledge(userId: string, restaurantId: string, scheduleId: string) {
    await this.team.assertAccess(userId, restaurantId);
    const { data: schedule, error: scheduleErr } = await this.sb
      .from("schedules")
      .select("id, status")
      .eq("id", scheduleId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (scheduleErr) {
      this.logger.error(
        `acknowledge: could not read schedule ${scheduleId}: ${scheduleErr.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read this week, so your manager was not told you have seen it.",
      );
    }
    if (!schedule) throw new NotFoundException("Schedule not found");
    // A week still being built has nothing final to confirm, and staff are
    // not shown it (getMyWeek); a receipt on it would count as "seen".
    if (schedule.status !== "published")
      throw new ConflictException(
        "This week is not published yet, so there is nothing to confirm.",
      );

    const { data: member, error: memberErr } = await this.sb
      .from("team_members")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memberErr) {
      this.logger.error(
        `acknowledge: could not read the roster row of ${userId}: ${memberErr.message}`,
      );
      throw new InternalServerErrorException(
        "Could not look up your place on the team, so your manager was not told you have seen this week.",
      );
    }
    if (!member)
      throw new ConflictException(
        "You are not on this house's roster, so there is no one to record as having seen this week. Ask your manager to add you.",
      );
    const { error: upsertErr } = await this.sb.from("schedule_receipts").upsert(
      {
        schedule_id: scheduleId,
        member_id: member.id,
        seen_at: new Date().toISOString(),
      },
      { onConflict: "schedule_id,member_id" },
    );
    if (upsertErr) {
      this.logger.error(
        `acknowledge: could not store the receipt of member ${member.id} on ` +
          `schedule ${scheduleId}: ${upsertErr.message}`,
      );
      throw new InternalServerErrorException(
        "Your confirmation was not saved, so your manager was not told you have seen this week.",
      );
    }
    return { acknowledged: true };
  }

  // ── Shifts ────────────────────────────────────────────────────────────────
  /**
   * A shift's planned cost: worked hours (span minus the break the shift is
   * counted with — recorded, or the Art. 68 minimum for its length when none
   * is on record) at the wage on file now. A failed wage read is an
   * error, not an unpriced shift: "no wage on file" is what `null` says, and a
   * database hiccup is not that.
   */
  private async laborCost(
    restaurantId: string,
    memberId: string | null | undefined,
    shift: ShiftLike,
  ): Promise<number | null> {
    if (!memberId) return null;
    const { data: m, error } = await this.sb
      .from("team_members")
      .select("hourly_wage")
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        `laborCost: could not read the wage of member ${memberId} in ` +
          `${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read this person's wage to price the shift, so it was not saved.",
      );
    }
    return priceShift(m?.hourly_wage ?? null, shift);
  }

  /**
   * The break a writer records, checked against the shift it belongs to.
   * `undefined` = the writer said nothing (no change); `null` = clear the
   * record (the shift is then counted with the Art. 68 minimum for its
   * length); a whole number of minutes, 0 included (no break taken), shorter
   * than the shift. A break as long as the shift is refused in words, not
   * clamped.
   */
  private recordedBreakFrom(
    minutes: number | null | undefined,
    start: string,
    end: string,
  ): number | null | undefined {
    if (minutes === undefined) return undefined;
    if (minutes === null) return null;
    const span = Math.round(hoursBetween(start, end) * 60);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= span) {
      throw new BadRequestException(
        `A break must be a whole number of minutes, from 0 up to less than the ` +
          `shift's ${span} minutes. Nothing was saved.`,
      );
    }
    return minutes;
  }

  async createShift(userId: string, restaurantId: string, dto: CreateShiftDto) {
    // Money in the reply follows the caller's pay access (ADR 0215, round 4
    // item 19): the owner, or a manager an owner switched on.
    const viewer = await this.team.assertAccess(
      userId,
      restaurantId,
      "manager",
      { payAccess: true },
    );
    if (dto.memberId)
      await this.team.assertMemberInRestaurant(restaurantId, dto.memberId);
    // Clock times only, and a shift that lasts some time (QA round 4 B6).
    const timesRefusal = shiftTimesRefusal(dto.startTime, dto.endTime);
    if (timesRefusal) throw new BadRequestException(timesRefusal);
    // One person, two overlapping shifts: refused unless the owner allows
    // double booking (ADR 0215 item 27). Only hand-over used to ask.
    if (dto.memberId)
      await this.refuseDoubleBooking(restaurantId, dto.memberId, {
        date: dto.shiftDate,
        start: dto.startTime,
        end: dto.endTime,
        excludeShiftId: null,
      });
    // The break whoever writes the shift records, if they record one (ADR
    // 0215). Omitted, nothing is recorded, and the shift — any length,
    // founder round 6y — is counted with the Art. 68 minimum and shown as
    // assumed. Checked before the week row below can be created, so a
    // refused break writes nothing.
    const recordedBreak = this.recordedBreakFrom(
      dto.breakMinutes,
      dto.startTime,
      dto.endTime,
    );
    const schedule = await this.getOrCreateWeek(
      userId,
      restaurantId,
      dto.scheduleId
        ? await this.weekStartOfSchedule(restaurantId, dto.scheduleId)
        : mondayOf(dto.shiftDate),
    );
    const cost = await this.laborCost(restaurantId, dto.memberId, {
      start_time: dto.startTime,
      end_time: dto.endTime,
      recorded_break_min: recordedBreak ?? null,
    });
    const { data, error } = await this.sb
      .from("shifts")
      .insert({
        restaurant_id: restaurantId,
        schedule_id: schedule.id,
        member_id: dto.memberId ?? null,
        shift_date: dto.shiftDate,
        start_time: dto.startTime,
        end_time: dto.endTime,
        role: dto.role ?? null,
        shift_type:
          dto.shiftType ?? (dto.memberId ? periodOf(dto.startTime) : "open"),
        state: dto.memberId ? "scheduled" : "open",
        note: dto.note ?? null,
        labor_cost: cost,
        // Undefined is dropped from the JSON body, so an unsent break leaves
        // the column's own default; an inline key keeps this write readable
        // by check_order_capture_contract.py (no spread).
        recorded_break_min: recordedBreak,
      })
      .select("*, shift_breaks(*)")
      .single();
    if (error) throw new InternalServerErrorException("Failed to create shift");
    return shiftForViewer(data, viewer);
  }

  async updateShift(
    userId: string,
    restaurantId: string,
    shiftId: string,
    dto: UpdateShiftDto,
  ) {
    // Money in the reply follows the caller's pay access (ADR 0215, round 4
    // item 19): the owner, or a manager an owner switched on.
    const viewer = await this.team.assertAccess(
      userId,
      restaurantId,
      "manager",
      { payAccess: true },
    );
    if (dto.memberId)
      await this.team.assertMemberInRestaurant(restaurantId, dto.memberId);
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.memberId !== undefined) patch.member_id = dto.memberId;
    if (dto.shiftDate !== undefined) patch.shift_date = dto.shiftDate;
    if (dto.startTime !== undefined) patch.start_time = dto.startTime;
    if (dto.endTime !== undefined) patch.end_time = dto.endTime;
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.shiftType !== undefined) patch.shift_type = dto.shiftType;
    if (dto.state !== undefined) patch.state = dto.state;
    if (dto.note !== undefined) patch.note = dto.note;

    // A failed read is an error, not a missing shift: it used to answer 404
    // for a shift that exists.
    const { data: cur, error: curErr } = await this.sb
      .from("shifts")
      .select(
        "member_id, start_time, end_time, shift_date, state, recorded_break_min, shift_breaks(*)",
      )
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (curErr) {
      this.logger.error(
        `updateShift: could not read shift ${shiftId} in ${restaurantId}: ` +
          curErr.message,
      );
      throw new InternalServerErrorException(
        "Could not read this shift, so it was not changed.",
      );
    }
    if (!cur) throw new NotFoundException("Shift not found");
    // A removed person's kept shift is owner-only history, not reachable here
    // (ADR 0215 item 20; `TeamService.assertOnTheRoster`, founder item 71).
    await this.team.assertOnTheRoster(restaurantId, cur, "Shift not found");

    // The break, as whoever edits the shift records it (ADR 0215): a number of
    // minutes records it (0 = no break taken); `null` clears the record, so
    // the shift is counted with the Art. 68 minimum for its length again.
    const nextStart = dto.startTime ?? cur.start_time;
    const nextEnd = dto.endTime ?? cur.end_time;
    // Only the times this edit sends are judged (the columns are text).
    for (const sent of [dto.startTime, dto.endTime]) {
      if (sent !== undefined && !CLOCK_TIME.test(sent)) {
        throw new BadRequestException(
          `Shift times must be clock times like 09:00; got "${sent}". Nothing was saved.`,
        );
      }
    }
    if (
      (dto.startTime !== undefined || dto.endTime !== undefined) &&
      CLOCK_TIME.test(String(nextStart)) &&
      CLOCK_TIME.test(String(nextEnd))
    ) {
      const timesRefusal = shiftTimesRefusal(nextStart, nextEnd);
      if (timesRefusal) throw new BadRequestException(timesRefusal);
    }
    // Who, when: re-checked against their other shifts when either moves.
    const nextMember =
      dto.memberId !== undefined ? dto.memberId : cur.member_id;
    if (
      nextMember &&
      (dto.state ?? cur.state) !== "callout" &&
      (dto.memberId !== undefined ||
        dto.shiftDate !== undefined ||
        dto.startTime !== undefined ||
        dto.endTime !== undefined)
    ) {
      await this.refuseDoubleBooking(restaurantId, nextMember, {
        date: dto.shiftDate ?? cur.shift_date,
        start: nextStart,
        end: nextEnd,
        excludeShiftId: shiftId,
      });
    }
    const recordedBreak = this.recordedBreakFrom(
      dto.breakMinutes,
      nextStart,
      nextEnd,
    );
    if (recordedBreak !== undefined) patch.recorded_break_min = recordedBreak;
    // New times with the break left as it was: the break on record must still
    // fit inside the shift. A 60-minute break kept on a shift cut to an hour
    // would count it as no work at all, silently; it is refused in words.
    if (
      recordedBreak === undefined &&
      (dto.startTime !== undefined || dto.endTime !== undefined) &&
      cur.recorded_break_min != null
    ) {
      const kept = Number(cur.recorded_break_min);
      const span = Math.round(hoursBetween(nextStart, nextEnd) * 60);
      if (kept >= span) {
        throw new BadRequestException(
          `The break on record (${kept} minutes) is as long as the shift ` +
            `would be (${span} minutes). Record a shorter break with the new ` +
            `times. Nothing was saved.`,
        );
      }
    }

    // Rebind schedule when the date moves into another week.
    const nextDate = dto.shiftDate ?? cur.shift_date;
    if (
      dto.shiftDate !== undefined &&
      mondayOf(dto.shiftDate) !== mondayOf(cur.shift_date)
    ) {
      const schedule = await this.getOrCreateWeek(
        userId,
        restaurantId,
        mondayOf(nextDate),
      );
      patch.schedule_id = schedule.id;
    }

    // Recompute labor cost if member, time or break changed. The person is
    // the one the shift will HAVE: an explicit `memberId: null` unassigns it,
    // and an open shift carries no one's wage, so it is priced as nobody's
    // (`null`). A `??` here used to fall through that `null` to the person
    // being taken off, so an owner's shift unassigned by a manager kept a cost
    // priced at the owner's wage on a row with no person on it, which
    // `shiftForViewer` passed to them (founder item 71, PR #440 audit).
    const pricedMember =
      dto.memberId !== undefined ? dto.memberId : cur.member_id;
    if (
      dto.memberId !== undefined ||
      dto.startTime !== undefined ||
      dto.endTime !== undefined ||
      recordedBreak !== undefined
    ) {
      patch.labor_cost = await this.laborCost(
        restaurantId,
        pricedMember,
        {
          start_time: nextStart,
          end_time: nextEnd,
          shift_breaks: cur.shift_breaks ?? [],
          recorded_break_min:
            recordedBreak !== undefined
              ? recordedBreak
              : (cur.recorded_break_min ?? null),
        },
      );
    }

    const { data, error } = await this.sb
      .from("shifts")
      .update(patch)
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .select("*, shift_breaks(*)")
      .maybeSingle();
    if (error) throw new InternalServerErrorException("Failed to update shift");
    if (!data) throw new NotFoundException("Shift not found");
    return shiftForViewer(data, viewer);
  }

  async deleteShift(userId: string, restaurantId: string, shiftId: string) {
    await this.team.assertAccess(userId, restaurantId, "manager");
    // A removed person's kept shift is kept five years and ended only by the
    // retention job (ADR 0215 item 20); no manager or owner deletes it here
    // (`TeamService.assertOnTheRoster`). So the shift is read first, and a
    // failed read or delete is said, not answered as done.
    const { data: cur, error: curErr } = await this.sb
      .from("shifts")
      .select("member_id")
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (curErr) {
      this.logger.error(
        `deleteShift: could not read shift ${shiftId} in ${restaurantId}: ` +
          curErr.message,
      );
      throw new InternalServerErrorException(
        "Could not read this shift, so it was not deleted.",
      );
    }
    if (!cur) throw new NotFoundException("Shift not found");
    await this.team.assertOnTheRoster(restaurantId, cur, "Shift not found");
    const { error } = await this.sb
      .from("shifts")
      .delete()
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId);
    if (error) {
      this.logger.error(
        `deleteShift: could not delete shift ${shiftId} in ${restaurantId}: ` +
          error.message,
      );
      throw new InternalServerErrorException("Failed to delete shift");
    }
  }

  // ── Call-out → find & assign cover ───────────────────────────────────────
  async reportCallout(
    userId: string,
    restaurantId: string,
    shiftId: string,
    dto: CalloutDto,
  ) {
    // Money in the reply follows the caller's pay access (ADR 0215, round 4
    // item 19): the owner, or a manager an owner switched on.
    const viewer = await this.team.assertAccess(
      userId,
      restaurantId,
      "manager",
      { payAccess: true },
    );
    const { data: original, error: originalErr } = await this.sb
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (originalErr) {
      this.logger.error(
        `reportCallout: could not read shift ${shiftId} in ${restaurantId}: ` +
          originalErr.message,
      );
      throw new InternalServerErrorException(
        "Could not read this shift, so no call-out was recorded.",
      );
    }
    if (!original) throw new NotFoundException("Shift not found");
    await this.team.assertOnTheRoster(
      restaurantId,
      original,
      "Shift not found",
    );
    // A call-out happens once (QA round 4 B4). A second press used to mark the
    // shift again, open a second cover shift and send the whole house a
    // second critical notice.
    if (original.state === "callout") {
      throw new ConflictException(
        "This shift is already called out, and its cover shift is open. Nothing was sent again.",
      );
    }
    if (original.state === "open" || !original.member_id) {
      throw new BadRequestException(
        "This shift has no one on it to call out. Nothing was changed.",
      );
    }
    // What the shift was, kept by value: the guard and the undo below must
    // name the row as it was read, whatever later writes do to it.
    const before = { state: original.state, note: original.note ?? null };

    // Keep the original on the caller's row as "callout" (strike-through),
    // and open a fresh unassigned cover slot for the same window. The write
    // names the state it read, so two presses at once mark it only once.
    const { data: calloutShift, error: calloutErr } = await this.sb
      .from("shifts")
      .update({
        state: "callout",
        note: dto.reason
          ? `Call-out: ${dto.reason}`
          : (original.note ?? "Called out — cover needed"),
        updated_at: new Date().toISOString(),
      })
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .eq("state", before.state)
      .select()
      .maybeSingle();
    if (calloutErr)
      throw new InternalServerErrorException("Failed to mark call-out");
    if (!calloutShift) {
      throw new ConflictException(
        "This shift changed while the call-out was being recorded (it may already be called out). Nothing was sent.",
      );
    }

    const { data: openShift, error: openErr } = await this.sb
      .from("shifts")
      .insert({
        restaurant_id: restaurantId,
        schedule_id: original.schedule_id,
        member_id: null,
        shift_date: original.shift_date,
        start_time: original.start_time,
        end_time: original.end_time,
        role: original.role,
        shift_type: "open",
        state: "open",
        note: await this.coverNote(restaurantId, original.member_id),
        // The same window keeps the break on record for it, so the cover is
        // counted (and priced, once assigned) like the shift it replaces;
        // nothing on record stays nothing on record (ADR 0215).
        recorded_break_min: original.recorded_break_min ?? null,
        labor_cost: null,
      })
      .select()
      .single();
    if (openErr || !openShift) {
      // The two writes are not one transaction, so the first is undone: a
      // shift marked called-out with no cover shift open is a gap nobody is
      // told to fill.
      const { error: undoErr } = await this.sb
        .from("shifts")
        .update({
          state: before.state,
          note: before.note,
          updated_at: new Date().toISOString(),
        })
        .eq("id", shiftId)
        .eq("restaurant_id", restaurantId)
        .eq("state", "callout");
      if (undoErr) {
        this.logger.error(
          `reportCallout: shift ${shiftId} in ${restaurantId} is marked called out ` +
            `but no cover shift opened, and the mark could not be undone: ${undoErr.message}`,
        );
        throw new InternalServerErrorException(
          "The shift is marked called out, but its cover shift could not be opened. Open an open shift for that time by hand.",
        );
      }
      throw new InternalServerErrorException(
        "Could not open a cover shift, so the call-out was not recorded. Try again.",
      );
    }

    await this.notifications.persistForRestaurant(restaurantId, {
      type: "system",
      title: "Shift call-out — cover needed",
      message: `${original.role ?? "A shift"} on ${original.shift_date} ${original.start_time}-${original.end_time} is open.`,
      priority: "critical",
      actionUrl: `/team?shift=${openShift.id}`,
      actionLabel: "Find cover",
      metadata: { shiftId: openShift.id, calloutShiftId: shiftId },
    });
    return {
      callout: shiftForViewer(calloutShift, viewer),
      open: shiftForViewer(openShift, viewer),
    };
  }

  /**
   * The open cover shift's note, in words (QA round 4 S4). It printed the
   * called-out person's raw member id, and every staff member's week carries
   * open shifts, so the whole crew read a uuid. It now names the person, as
   * the roster does; when the name cannot be read the note still says what
   * the shift is, and a failed name read never stops the call-out.
   */
  private async coverNote(
    restaurantId: string,
    memberId: string | null | undefined,
  ): Promise<string> {
    const plain = "Cover for a call-out";
    if (!memberId) return plain;
    const { data, error } = await this.sb
      .from("team_members")
      .select("display_name")
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `reportCallout: could not read the name of member ${memberId} in ` +
          `${restaurantId} for the cover note: ${error.message}`,
      );
      return plain;
    }
    const name = String(data?.display_name ?? "").trim();
    return name ? `Cover for ${name}, who called out` : plain;
  }

  /** Push the open shift to the selected (qualified/available) members. */
  async offerCover(
    userId: string,
    restaurantId: string,
    shiftId: string,
    dto: OfferCoverDto,
  ) {
    await this.team.assertAccess(userId, restaurantId, "manager");
    const { data: shift } = await this.sb
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!shift) throw new NotFoundException("Shift not found");
    await this.team.assertOnTheRoster(restaurantId, shift, "Shift not found");

    const { data: members } = await this.sb
      .from("team_members")
      .select("user_id")
      .eq("restaurant_id", restaurantId)
      .in("id", dto.memberIds);
    const targetUserIds = (members ?? [])
      .map((m: any) => m.user_id)
      .filter(Boolean);

    if (targetUserIds.length) {
      await this.push.sendToUsers(targetUserIds, {
        title: "Shift available — can you cover?",
        body: `${shift.role ?? "Shift"} ${shift.shift_date} ${shift.start_time}-${shift.end_time}. Tap to claim.`,
        priority: "high",
        data: {
          type: "shift_offer",
          shiftId,
          actionUrl: `/team?shift=${shiftId}`,
        },
      });
    }
    return { offered: dto.memberIds.length, notified: targetUserIds.length };
  }

  /**
   * Assign a member to a shift. Managers can assign anyone. Staff may ONLY
   * self-claim a shift that is currently open (no owner) — they cannot assign
   * other people or hijack a shift that already belongs to someone.
   */
  async assignCover(
    userId: string,
    restaurantId: string,
    shiftId: string,
    dto: AssignCoverDto,
  ) {
    const viewer = await this.team.assertAccess(userId, restaurantId, undefined, {
      payAccess: true,
    });
    const { role } = viewer;
    await this.team.assertMemberInRestaurant(restaurantId, dto.memberId);

    const { data: shift, error: shiftErr } = await this.sb
      .from("shifts")
      .select("id, member_id, state, start_time, end_time, shift_date, schedule_id")
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (shiftErr) {
      this.logger.error(
        `assignCover: could not read shift ${shiftId} in ${restaurantId}: ` +
          shiftErr.message,
      );
      throw new InternalServerErrorException(
        "Could not read this shift, so it was not assigned.",
      );
    }
    if (!shift) throw new NotFoundException("Shift not found");
    await this.team.assertOnTheRoster(restaurantId, shift, "Shift not found");
    // Who held it and in what state, kept by value for the guarded write.
    const read = { state: shift.state, memberId: shift.member_id ?? null };

    if (role === "staff") {
      const { data: me } = await this.sb
        .from("team_members")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("user_id", userId)
        .maybeSingle();
      const isOpen = shift.state === "open" || !shift.member_id;
      if (!isOpen || !me || me.id !== dto.memberId) {
        throw new ForbiddenException(
          "You can only claim open shifts for yourself",
        );
      }
      // A day already gone in every time zone is not claimed (QA round 4 B5).
      // UTC today minus one is earlier than "today" anywhere a house can be.
      if (
        typeof shift.shift_date === "string" &&
        shift.shift_date < addDays(new Date().toISOString().slice(0, 10), -1)
      ) {
        throw new BadRequestException(
          `This shift was on ${shift.shift_date}, which has passed. Nothing was changed.`,
        );
      }
      // Staff do not see a draft week (`getMyWeek`), so they cannot claim
      // from one either, by id or otherwise.
      if (!(await this.weekIsPublished(restaurantId, shift))) {
        throw new ForbiddenException(
          "This shift is in a week that is not published yet. Nothing was changed.",
        );
      }
    }

    // The claimant's own shifts that day (QA round 4 B5): the same rule as a
    // manager's hand edit.
    if (typeof shift.shift_date === "string")
      await this.refuseDoubleBooking(restaurantId, dto.memberId, {
        date: shift.shift_date,
        start: shift.start_time,
        end: shift.end_time,
        excludeShiftId: shiftId,
      });

    const cost = await this.recomputeCostForMember(
      restaurantId,
      shiftId,
      dto.memberId,
    );
    // The write names the person and state it read, so when two people take
    // the same open shift at once only the first is given it; the second is
    // told, instead of silently overwriting the first (QA round 4 B5).
    let claim = this.sb
      .from("shifts")
      .update({
        member_id: dto.memberId,
        state: "covered",
        labor_cost: cost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .eq("state", read.state);
    claim =
      read.memberId == null
        ? claim.is("member_id", null)
        : claim.eq("member_id", read.memberId);
    const { data, error } = await claim
      .select("*, shift_breaks(*)")
      .maybeSingle();
    if (error) throw new InternalServerErrorException("Failed to assign cover");
    if (!data) {
      throw new ConflictException(
        "This shift changed before it could be assigned; someone else may have taken it. Nothing was changed.",
      );
    }
    // Only the owner sees labor_cost — it is the wage times the hours, so it
    // is the wage (ADR 0215). Staff never did; a manager no longer does.
    return shiftForViewer(data, viewer);
  }

  private async recomputeCostForMember(
    restaurantId: string,
    shiftId: string,
    memberId: string,
  ): Promise<number | null> {
    const { data: s, error } = await this.sb
      .from("shifts")
      .select("start_time, end_time, recorded_break_min, shift_breaks(*)")
      // Scoped even though the only caller already proved ownership with a
      // scoped fetch: an unscoped read that is safe only because of what its
      // caller happens to do first is one refactor away from not being.
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    // A failed read is an error, not an unpriced cover: `null` here used to
    // be written as the cover's labor_cost, which says "no wage on file"
    // (ADR 0215; and before migration 20261201110100 applies, this read names
    // a column the table lacks, so it would have priced every cover as null).
    if (error) {
      this.logger.error(
        `assignCover: could not read shift ${shiftId} in ${restaurantId} to ` +
          `price it: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read this shift to price the cover, so it was not assigned.",
      );
    }
    if (!s) return null;
    return this.laborCost(restaurantId, memberId, s);
  }

  // ── Coverage engine ──────────────────────────────────────────────────────
  /**
   * Deterministic coverage per day/period/role against coverage_templates.
   * Returns per-day gap summaries so manager + staff see identical truth.
   */
  private async computeCoverage(
    restaurantId: string,
    weekStart: string,
    shifts: any[],
  ): Promise<any> {
    const { data: templates } = await this.sb
      .from("coverage_templates")
      .select("*")
      .eq("restaurant_id", restaurantId);
    const rules = templates ?? [];

    const days: any[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i);
      const dow = new Date(date + "T00:00:00").getDay();
      const dayShifts = shifts.filter(
        (s) =>
          s.shift_date === date &&
          s.member_id &&
          s.state !== "open" &&
          s.state !== "callout",
      );
      const gaps: any[] = [];
      for (const r of rules) {
        if (r.day_of_week != null && r.day_of_week !== dow) continue;
        const trole = (r.role ?? "").trim().toLowerCase();
        if (!trole) continue; // an empty rule role would match everything
        const staffed = dayShifts.filter((s) => {
          const srole = (s.role ?? "").trim().toLowerCase();
          // Exact role match only (case-insensitive). Fuzzy includes() false-matched roles.
          return srole === trole && periodOf(s.start_time) === r.shift_period;
        }).length;
        if (staffed < r.min_staff) {
          gaps.push({
            role: r.role,
            period: r.shift_period,
            staffed,
            required: r.min_staff,
          });
        }
      }
      const openShifts = shifts.filter(
        (s) => s.shift_date === date && (s.state === "open" || !s.member_id),
      ).length;
      days.push({
        date,
        staffed: dayShifts.length,
        openShifts,
        gaps,
        status: gaps.length ? "gap" : openShifts ? "warn" : "ok",
      });
    }
    return { days, totalGaps: days.reduce((n, d) => n + d.gaps.length, 0) };
  }

  // ── Labor engine ─────────────────────────────────────────────────────────
  /**
   * The week's labour, and whether the week can be costed at all.
   *
   * This used to be `shifts.reduce((s, sh) => s + Number(sh.labor_cost ?? 0), 0)`,
   * which has two failure modes and reports both as a measurement:
   *
   *  - a week where **no** member is priced renders **$0** — a real zero and an
   *    unknown printed identically (ADR 0051 clause 1);
   *  - a week where **some** members are priced renders a **partial sum as a
   *    total**, which is worse than the zero because it looks plausible.
   *
   * Both were live the moment `hourly_wage` stopped being invented (ADR 0088
   * T1): the fabrication would simply have moved from the wage to the total.
   *
   * So the total is `null` until every member-assigned shift carries a cost,
   * and the counts are returned so a caller can say *why* it is unknown
   * ("3 of 11 shifts have no wage on file") rather than only that it is.
   * An open shift has no member and therefore no cost to be missing.
   *
   * ADR 0215 changed four things here:
   *
   *  - **Hours are worked hours.** Every hour figure is the span minus the
   *    shift's breaks (4857 Art. 68); `breakHours` says how much was taken out.
   *  - **A called-out shift is not worked.** It kept its cost when its person
   *    called out, and the cover shift was priced too, so the week paid twice
   *    for one slot. It is out of the hours, the cost and the review flag.
   *  - **Over 45 worked hours is a review.** `overtime` keeps its key (two
   *    clients read it) but it is the Turkish week, not the US 40, and it never
   *    carries a price. It is computed whether or not cost tracking is on: it is
   *    about hours, and hours are not money.
   *  - **Money is the owner's.** A manager's block carries hours and the review
   *    and no cost, no priced/unpriced counts and no cost target. The owner's
   *    block also says how much approved PAID leave falls in the week, because a
   *    person on paid leave has no shift and so used to read as zero cost.
   */
  private async computeLabor(
    restaurantId: string,
    weekStart: string,
    shifts: any[],
    settings: any,
    viewer: MoneyViewer,
    roster: ReadonlySet<string>,
  ): Promise<any> {
    const worked = shifts.filter(isWorked);
    let totalHours = 0;
    let breakHours = 0;
    let assumedBreakHours = 0;
    let assumedBreakShifts = 0;
    const byMember = new Map<string, number>();
    for (const s of worked) {
      const w = workedHours(s);
      totalHours += w;
      breakHours += hoursSpan(s) - w;
      const b = breakCounted(s);
      if (b.assumed) {
        assumedBreakShifts += 1;
        assumedBreakHours += b.minutes / 60;
      }
      if (s.member_id)
        byMember.set(s.member_id, (byMember.get(s.member_id) ?? 0) + w);
    }
    const overtime = [...byMember.entries()]
      .filter(([, h]) => h > WEEKLY_REVIEW_HOURS)
      .map(([memberId, h]) => ({ memberId, hours: Math.round(h * 10) / 10 }));
    const moneyVisible = seesMoney(viewer);
    const hours = {
      moneyVisible,
      totalHours: Math.round(totalHours * 10) / 10,
      breakHours: Math.round(breakHours * 10) / 10,
      /**
       * How much of `breakHours` is ASSUMED (a shift with no break on record,
       * any length, is counted with the Art. 68 minimum), so the figure
       * says it rests on an assumption rather than passing it off as recorded.
       */
      assumedBreakHours: Math.round(assumedBreakHours * 10) / 10,
      assumedBreakShifts,
      weeklyReviewHours: WEEKLY_REVIEW_HOURS,
      overtime,
    };

    if (!settings?.labor_tracking_enabled) return { enabled: false, ...hours };
    if (!moneyVisible) return { enabled: true, ...hours };

    // An owner's shifts are left out of a manager's money (founder item 71,
    // 2026-09-27: "if owner taking money, manager can't see it"): with every
    // other shift's cost beside it, a total that held the owner's would give
    // the owner's figure back by subtraction. The block says how many were
    // left out, so the total is never read as the whole week's.
    // So are a former owner's shifts dated while they owned the house
    // (founder item 80, 2026-09-28: "Hide owner-period pay (Recommended)"),
    // for the same reason: left in, the total would give them back.
    const assignedAll = worked.filter((sh) => !!sh.member_id);
    const assigned = assignedAll.filter((sh) =>
      seesShiftMoneyOf(viewer, sh.member_id, sh.shift_date),
    );
    const ownerShiftsLeftOut = assignedAll.length - assigned.length;
    const priced = assigned.filter((sh) => sh.labor_cost != null);
    const unpricedShifts = assigned.length - priced.length;
    const costComplete = unpricedShifts === 0;
    const totalCost = costComplete
      ? Math.round(
          priced.reduce((s, sh) => s + Number(sh.labor_cost), 0) * 100,
        ) / 100
      : null;
    return {
      enabled: true,
      ...hours,
      /** `null` = this week cannot be costed yet. Never a partial, never 0. */
      totalCost,
      costComplete,
      pricedShifts: priced.length,
      unpricedShifts,
      /**
       * `null` when nobody has configured a target. It was `?? 28` here AND
       * `?? 28` in `getSettings`, so an unconfigured restaurant was told its
       * target twice over (ADR 0088 T1).
       */
      targetPct:
        settings.labor_target_pct == null
          ? null
          : Number(settings.labor_target_pct),
      /**
       * What the total covers: the scheduled shifts, and nothing else. Paid
       * leave is counted in days beside it and is NOT priced here — a day of
       * leave has no hours on file, and pricing monthly pay is the labour
       * page's work (ADR 0215), not a guess this block makes.
       */
      costCovers: "scheduled_shifts",
      /**
       * How many worked shifts are an OWNER's and so not in this viewer's
       * total (item 71) — a current owner's, or a former owner's dated
       * inside their owner period (item 80). Always 0 for an owner; a
       * manager's page says it.
       */
      ownerShiftsLeftOut,
      leave: await this.leaveThisWeek(restaurantId, weekStart, roster),
    };
  }

  /**
   * Approved leave in the week, by type, from dates alone. `reason` is never
   * selected (KVKK: the minimum). A failed read says so rather than reading as
   * "nobody is on leave".
   */
  private async leaveThisWeek(
    restaurantId: string,
    weekStart: string,
    roster: ReadonlySet<string>,
  ): Promise<any> {
    const weekEnd = addDays(weekStart, 6);
    const { data, error } = await this.sb
      .from("time_off_requests")
      .select("member_id, start_date, end_date, status, leave_type")
      .eq("restaurant_id", restaurantId)
      .eq("status", "approved")
      .lte("start_date", weekEnd)
      .gte("end_date", weekStart);
    if (error) {
      this.logger.error(
        `leaveThisWeek: could not read approved leave for ${restaurantId} ` +
          `week ${weekStart}: ${error.message}`,
      );
      return { readable: false, paid: null, paidDays: null, unknownTypeDays: null };
    }
    // A removed person's leave is kept, not counted (ADR 0215 item 20).
    return {
      readable: true,
      ...leaveInWeek(onTheRoster(data ?? [], roster), weekStart),
    };
  }

  /**
   * The week a schedule belongs to — **within this restaurant**.
   *
   * This selected by caller-supplied id with no restaurant filter, and then
   * fell back to *this* Monday when it found nothing. Reached through
   * `POST …/team/shifts` that made a foreign schedule id do two wrong things at
   * once: read another tenant's `week_start`, or — when the id resolved to
   * nothing — quietly file the shift into the current week the caller never
   * named. A supplied id that does not resolve is an error, not a default.
   */
  /**
   * Refuse two shifts at once for one person unless the owner allows double
   * booking (ADR 0215 item 27), before anything is written. A called-out
   * shift does not count; one past midnight does (hence the days around).
   */
  private async refuseDoubleBooking(
    restaurantId: string,
    memberId: string,
    next: { date: string; start: string; end: string; excludeShiftId: string | null },
  ): Promise<void> {
    if (!CLOCK_TIME.test(String(next.start)) || !CLOCK_TIME.test(String(next.end)))
      return;
    const { data, error } = await this.sb
      .from("shifts")
      .select("id, shift_date, start_time, end_time, state")
      .eq("restaurant_id", restaurantId)
      .eq("member_id", memberId)
      .gte("shift_date", addDays(next.date, -1))
      .lte("shift_date", addDays(next.date, 1));
    if (error) {
      this.logger.error(
        `refuseDoubleBooking: could not read member ${memberId}'s shifts in ` +
          `${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read this person's other shifts, so the shift was not saved.",
      );
    }
    const mine = shiftSpan(next.date, next.start, next.end);
    const clash = (data ?? []).find(
      (s: any) =>
        s.id !== next.excludeShiftId &&
        s.state !== "callout" &&
        CLOCK_TIME.test(String(s.start_time)) &&
        CLOCK_TIME.test(String(s.end_time)) &&
        spansOverlap(mine, shiftSpan(s.shift_date, s.start_time, s.end_time)),
    );
    if (!clash) return;
    const allowed = await this.team.doubleBookingAllowed(
      restaurantId,
      (what, err) => {
        this.logger.error(`refuseDoubleBooking: could not ${what}: ${err.message}`);
        throw new InternalServerErrorException(
          "Could not read whether double booking is allowed, so the shift was not saved.",
        );
      },
    );
    if (allowed) return;
    throw new ConflictException(
      `This person already works ${clash.shift_date} ` +
        `${String(clash.start_time).slice(0, 5)}–${String(clash.end_time).slice(0, 5)}, ` +
        `which overlaps this shift. Only the owner can allow double booking. Nothing was saved.`,
    );
  }

  /**
   * Whether the week a shift belongs to is published: its schedule row, or,
   * for a shift with no schedule id, the row of the week its date falls in
   * (the same rule `getMyWeek` applies).
   */
  private async weekIsPublished(
    restaurantId: string,
    shift: { schedule_id?: string | null; shift_date?: string | null },
  ): Promise<boolean> {
    let q = this.sb
      .from("schedules")
      .select("status")
      .eq("restaurant_id", restaurantId);
    q = shift.schedule_id
      ? q.eq("id", shift.schedule_id)
      : q.eq("week_start", mondayOf(String(shift.shift_date)));
    const { data, error } = await q.maybeSingle();
    if (error) {
      this.logger.error(
        `weekIsPublished: could not read the week of a shift in ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read whether this week is published, so the shift was not assigned.",
      );
    }
    return data?.status === "published";
  }

  private async weekStartOfSchedule(
    restaurantId: string,
    scheduleId: string,
  ): Promise<string> {
    const { data } = await this.sb
      .from("schedules")
      .select("week_start")
      .eq("id", scheduleId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!data?.week_start)
      throw new NotFoundException("Schedule not found in this restaurant");
    return data.week_start;
  }
}

// ── date helpers (UTC-explicit so server timezone never shifts the day) ──────
function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() -
      new Date(a + "T00:00:00Z").getTime()) /
      86_400_000,
  );
}
function mondayOf(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
/** A shift's scheduled span, breaks included. */
function hoursSpan(sh: any): number {
  return hoursBetween(sh.start_time, sh.end_time);
}
