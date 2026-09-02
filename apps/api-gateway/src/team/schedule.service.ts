import {
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
function hoursBetween(start: string, end: string): number {
  let diff = toMinutes(end) - toMinutes(start);
  if (diff < 0) diff += 24 * 60; // crosses midnight
  return diff / 60;
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
   * getMyWeek(); managers get everything here.
   */
  async getWeek(
    userId: string,
    restaurantId: string,
    weekStart: string,
  ): Promise<any> {
    // Manager-gated: the full week exposes labor cost + overtime.
    await this.team.assertAccess(userId, restaurantId, "manager");
    const weekEnd = addDays(weekStart, 6);

    const [{ data: schedule }, { data: shifts }, settings] = await Promise.all([
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

    const shiftRows = shifts ?? [];
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
    const labor = await this.computeLabor(restaurantId, shiftRows, settings);

    return { schedule, shifts: shiftRows, coverage, labor, receipts, settings };
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
   *    outcome rather than only the happy half of it.
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
    const { data: src } = await this.sb
      .from("shifts")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .gte("shift_date", dto.fromWeekStart)
      .lte("shift_date", fromEnd);
    if (!src?.length) return { copied: 0, deleted: 0, schedule: target };

    const { data: existing } = await this.sb
      .from("shifts")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .gte("shift_date", dto.toWeekStart)
      .lte("shift_date", toEnd);
    const inTheWay = existing?.length ?? 0;

    if (inTheWay > 0 && !dto.replaceTarget) {
      throw new ConflictException(
        `The week of ${dto.toWeekStart} already has ${inTheWay} shift(s). ` +
          "Copying replaces the whole week; re-send with replaceTarget: true to do that.",
      );
    }

    let deleted = 0;
    if (inTheWay > 0) {
      await this.sb
        .from("shifts")
        .delete()
        .eq("restaurant_id", restaurantId)
        .gte("shift_date", dto.toWeekStart)
        .lte("shift_date", toEnd);
      deleted = inTheWay;
    }

    const dayShift = daysBetween(dto.fromWeekStart, dto.toWeekStart);
    const rows = src
      .filter((s: any) => s.state !== "callout" && s.state !== "open")
      .map((s: any) => ({
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
        labor_cost: s.labor_cost,
      }));
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

    const { data: receiptRows } = await this.sb
      .from("schedule_receipts")
      .select("id")
      .eq("schedule_id", scheduleId);
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
      title: "📅 Schedule published",
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
  private async laborCost(
    restaurantId: string,
    memberId: string | null | undefined,
    start: string,
    end: string,
  ): Promise<number | null> {
    if (!memberId) return null;
    const { data: m } = await this.sb
      .from("team_members")
      .select("hourly_wage")
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    const wage = m?.hourly_wage;
    if (wage == null) return null;
    return Math.round(hoursBetween(start, end) * Number(wage) * 100) / 100;
  }

  async createShift(userId: string, restaurantId: string, dto: CreateShiftDto) {
    await this.team.assertAccess(userId, restaurantId, "manager");
    if (dto.memberId)
      await this.team.assertMemberInRestaurant(restaurantId, dto.memberId);
    const schedule = await this.getOrCreateWeek(
      userId,
      restaurantId,
      dto.scheduleId
        ? await this.weekStartOfSchedule(restaurantId, dto.scheduleId)
        : mondayOf(dto.shiftDate),
    );
    const cost = await this.laborCost(
      restaurantId,
      dto.memberId,
      dto.startTime,
      dto.endTime,
    );
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
      })
      .select("*, shift_breaks(*)")
      .single();
    if (error) throw new InternalServerErrorException("Failed to create shift");
    return data;
  }

  async updateShift(
    userId: string,
    restaurantId: string,
    shiftId: string,
    dto: UpdateShiftDto,
  ) {
    await this.team.assertAccess(userId, restaurantId, "manager");
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

    const { data: cur } = await this.sb
      .from("shifts")
      .select("member_id, start_time, end_time, shift_date")
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!cur) throw new NotFoundException("Shift not found");

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

    // Recompute labor cost if member/time changed.
    if (
      dto.memberId !== undefined ||
      dto.startTime !== undefined ||
      dto.endTime !== undefined
    ) {
      patch.labor_cost = await this.laborCost(
        restaurantId,
        dto.memberId ?? cur.member_id,
        dto.startTime ?? cur.start_time,
        dto.endTime ?? cur.end_time,
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
    return data;
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
    await this.team.assertAccess(userId, restaurantId, "manager");
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
        labor_cost: null,
      })
      .select()
      .single();
    if (openErr || !openShift)
      throw new InternalServerErrorException("Failed to open cover shift");

    await this.notifications.persistForRestaurant(restaurantId, {
      type: "system",
      title: "🚨 Shift call-out — cover needed",
      message: `${original.role ?? "A shift"} on ${original.shift_date} ${original.start_time}-${original.end_time} is open.`,
      priority: "critical",
      actionUrl: `/team?shift=${openShift.id}`,
      actionLabel: "Find cover",
      metadata: { shiftId: openShift.id, calloutShiftId: shiftId },
    });
    return { callout: calloutShift, open: openShift };
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
    const { role } = await this.team.assertAccess(userId, restaurantId);
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
    // Staff must never see labor_cost (wage proxy) in the claim response.
    if (role === "staff") {
      const { labor_cost: _omit, ...rest } = data;
      return rest;
    }
    return data;
  }

  private async recomputeCostForMember(
    restaurantId: string,
    shiftId: string,
    memberId: string,
  ): Promise<number | null> {
    const { data: s } = await this.sb
      .from("shifts")
      .select("start_time, end_time")
      // Scoped even though the only caller already proved ownership with a
      // scoped fetch: an unscoped read that is safe only because of what its
      // caller happens to do first is one refactor away from not being.
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!s) return null;
    return this.laborCost(restaurantId, memberId, s.start_time, s.end_time);
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
   */
  private async computeLabor(
    restaurantId: string,
    shifts: any[],
    settings: any,
  ): Promise<any> {
    if (!settings?.labor_tracking_enabled) {
      return { enabled: false, totalHours: hoursTotal(shifts) };
    }
    const totalHours = hoursTotal(shifts);
    const assigned = shifts.filter((sh) => !!sh.member_id);
    const priced = assigned.filter((sh) => sh.labor_cost != null);
    const unpricedShifts = assigned.length - priced.length;
    const costComplete = unpricedShifts === 0;
    const totalCost = costComplete
      ? Math.round(
          priced.reduce((s, sh) => s + Number(sh.labor_cost), 0) * 100,
        ) / 100
      : null;
    // Per-member overtime (>40h/week) flags.
    const byMember = new Map<string, number>();
    for (const s of shifts) {
      if (!s.member_id) continue;
      byMember.set(
        s.member_id,
        (byMember.get(s.member_id) ?? 0) +
          hoursBetween(s.start_time, s.end_time),
      );
    }
    const overtime = [...byMember.entries()]
      .filter(([, h]) => h > 40)
      .map(([memberId, h]) => ({ memberId, hours: Math.round(h * 10) / 10 }));
    return {
      enabled: true,
      totalHours: Math.round(totalHours * 10) / 10,
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
      overtime,
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
function hoursTotal(shifts: any[]): number {
  return shifts.reduce(
    (s, sh) => s + hoursBetween(sh.start_time, sh.end_time),
    0,
  );
}
