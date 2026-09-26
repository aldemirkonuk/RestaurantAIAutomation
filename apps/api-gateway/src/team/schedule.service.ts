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

  /** Read-only week for a staff member: only their own shifts. */
  async getMyWeek(userId: string, restaurantId: string, weekStart: string) {
    await this.team.assertAccess(userId, restaurantId);
    const weekEnd = addDays(weekStart, 6);
    const { data: member } = await this.sb
      .from("team_members")
      .select("id, display_name")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .maybeSingle();

    const { data: schedule } = await this.sb
      .from("schedules")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("week_start", weekStart)
      .maybeSingle();

    const { data: shifts } = await this.sb
      .from("shifts")
      .select("*, shift_breaks(*)")
      .eq("restaurant_id", restaurantId)
      .gte("shift_date", weekStart)
      .lte("shift_date", weekEnd)
      .order("shift_date", { ascending: true });

    // Staff must never see labor cost. Strip it from every row.
    const strip = (s: any) => {
      const { labor_cost: _omit, ...rest } = s;
      return rest;
    };
    const all = (shifts ?? []).map(strip);
    const mine = member
      ? all.filter((s: any) => s.member_id === member.id)
      : [];
    const open = all.filter((s: any) => s.state === "open" || !s.member_id);

    let acknowledged = false;
    if (member && schedule) {
      const { data: receipt } = await this.sb
        .from("schedule_receipts")
        .select("id")
        .eq("schedule_id", schedule.id)
        .eq("member_id", member.id)
        .maybeSingle();
      acknowledged = !!receipt;
    }
    return { member, schedule, mine, open, acknowledged };
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

  /** Staff opening a published schedule records a read receipt. */
  async acknowledge(userId: string, restaurantId: string, scheduleId: string) {
    await this.team.assertAccess(userId, restaurantId);
    const { data: schedule } = await this.sb
      .from("schedules")
      .select("id")
      .eq("id", scheduleId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!schedule) throw new NotFoundException("Schedule not found");

    const { data: member } = await this.sb
      .from("team_members")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) return { acknowledged: false };
    await this.sb.from("schedule_receipts").upsert(
      {
        schedule_id: scheduleId,
        member_id: member.id,
        seen_at: new Date().toISOString(),
      },
      { onConflict: "schedule_id,member_id" },
    );
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
        "member_id, start_time, end_time, shift_date, recorded_break_min, shift_breaks(*)",
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

    // The break, as whoever edits the shift records it (ADR 0215): a number of
    // minutes records it (0 = no break taken); `null` clears the record, so
    // the shift is counted with the Art. 68 minimum for its length again.
    const nextStart = dto.startTime ?? cur.start_time;
    const nextEnd = dto.endTime ?? cur.end_time;
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

    // Recompute labor cost if member, time or break changed.
    if (
      dto.memberId !== undefined ||
      dto.startTime !== undefined ||
      dto.endTime !== undefined ||
      recordedBreak !== undefined
    ) {
      patch.labor_cost = await this.laborCost(
        restaurantId,
        dto.memberId ?? cur.member_id,
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
    await this.sb
      .from("shifts")
      .delete()
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId);
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
    const { data: original } = await this.sb
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!original) throw new NotFoundException("Shift not found");

    // Keep the original on the caller's row as "callout" (strike-through),
    // and open a fresh unassigned cover slot for the same window.
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
      .select()
      .single();
    if (calloutErr || !calloutShift)
      throw new InternalServerErrorException("Failed to mark call-out");

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
        note: `Cover for call-out (${original.member_id ?? "unassigned"})`,
        // The same window keeps the break on record for it, so the cover is
        // counted (and priced, once assigned) like the shift it replaces;
        // nothing on record stays nothing on record (ADR 0215).
        recorded_break_min: original.recorded_break_min ?? null,
        labor_cost: null,
      })
      .select()
      .single();
    if (openErr || !openShift)
      throw new InternalServerErrorException("Failed to open cover shift");

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

    const { data: shift } = await this.sb
      .from("shifts")
      .select("id, member_id, state, start_time, end_time")
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!shift) throw new NotFoundException("Shift not found");

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
    }

    const cost = await this.recomputeCostForMember(
      restaurantId,
      shiftId,
      dto.memberId,
    );
    const { data, error } = await this.sb
      .from("shifts")
      .update({
        member_id: dto.memberId,
        state: "covered",
        labor_cost: cost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .select("*, shift_breaks(*)")
      .maybeSingle();
    if (error || !data)
      throw new InternalServerErrorException("Failed to assign cover");
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
    // (ADR 0215; and before migration 20260925180100 applies, this read names
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

    const assigned = worked.filter((sh) => !!sh.member_id);
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
