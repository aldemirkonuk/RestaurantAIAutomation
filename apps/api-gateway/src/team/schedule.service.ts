import {
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
    if (error) throw new InternalServerErrorException("Failed to create schedule");
    return data;
  }

  async createSchedule(userId: string, restaurantId: string, dto: CreateScheduleDto) {
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
      ? (
          await this.sb
            .from("schedule_receipts")
            .select("member_id, seen_at")
            .eq("schedule_id", schedule.id)
        ).data ?? []
      : [];

    const coverage = await this.computeCoverage(restaurantId, weekStart, shiftRows);
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
    const strip = (s: any) => ({ ...s, labor_cost: undefined });
    const all = (shifts ?? []).map(strip);
    const mine = member ? all.filter((s: any) => s.member_id === member.id) : [];
    const open = all.filter((s: any) => s.state === "open" || !s.member_id);
    return { member, schedule, mine, open };
  }

  async copyWeek(userId: string, restaurantId: string, dto: CopyWeekDto) {
    await this.team.assertAccess(userId, restaurantId, "manager");
    const target = await this.getOrCreateWeek(userId, restaurantId, dto.toWeekStart);
    const fromEnd = addDays(dto.fromWeekStart, 6);
    const { data: src } = await this.sb
      .from("shifts")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .gte("shift_date", dto.fromWeekStart)
      .lte("shift_date", fromEnd);
    if (!src?.length) return { copied: 0, schedule: target };

    const dayShift = daysBetween(dto.fromWeekStart, dto.toWeekStart);
    const rows = src.map((s: any) => ({
      restaurant_id: restaurantId,
      schedule_id: target.id,
      member_id: s.member_id,
      shift_date: addDays(s.shift_date, dayShift),
      start_time: s.start_time,
      end_time: s.end_time,
      role: s.role,
      shift_type: s.shift_type,
      state: "scheduled",
      note: s.note,
      labor_cost: s.labor_cost,
    }));
    const { error } = await this.sb.from("shifts").insert(rows);
    if (error) throw new InternalServerErrorException("Failed to copy week");
    return { copied: rows.length, schedule: target };
  }

  async publish(userId: string, restaurantId: string, scheduleId: string) {
    await this.team.assertAccess(userId, restaurantId, "manager");
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

    // Notify the whole restaurant + deep-link back into /team.
    await this.notifications.persistForRestaurant(restaurantId, {
      type: "system",
      title: "📅 Schedule published",
      message: `The week of ${schedule.week_start} is live. Open it to see your shifts.`,
      priority: "high",
      actionUrl: `/team?schedule=${scheduleId}`,
      actionLabel: "View schedule",
      groupKey: `schedule_published:${scheduleId}`,
      metadata: { scheduleId, weekStart: schedule.week_start },
    });
    return schedule;
  }

  /** Staff opening a published schedule records a read receipt. */
  async acknowledge(userId: string, restaurantId: string, scheduleId: string) {
    await this.team.assertAccess(userId, restaurantId);
    const { data: member } = await this.sb
      .from("team_members")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) return { acknowledged: false };
    await this.sb
      .from("schedule_receipts")
      .upsert(
        { schedule_id: scheduleId, member_id: member.id, seen_at: new Date().toISOString() },
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
      .maybeSingle();
    const wage = m?.hourly_wage;
    if (wage == null) return null;
    return Math.round(hoursBetween(start, end) * Number(wage) * 100) / 100;
  }

  async createShift(userId: string, restaurantId: string, dto: CreateShiftDto) {
    await this.team.assertAccess(userId, restaurantId, "manager");
    const schedule = await this.getOrCreateWeek(
      userId,
      restaurantId,
      dto.scheduleId ? await this.weekStartOfSchedule(dto.scheduleId) : mondayOf(dto.shiftDate),
    );
    const cost = await this.laborCost(restaurantId, dto.memberId, dto.startTime, dto.endTime);
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
        shift_type: dto.shiftType ?? (dto.memberId ? periodOf(dto.startTime) : "open"),
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
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.memberId !== undefined) patch.member_id = dto.memberId;
    if (dto.shiftDate !== undefined) patch.shift_date = dto.shiftDate;
    if (dto.startTime !== undefined) patch.start_time = dto.startTime;
    if (dto.endTime !== undefined) patch.end_time = dto.endTime;
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.shiftType !== undefined) patch.shift_type = dto.shiftType;
    if (dto.state !== undefined) patch.state = dto.state;
    if (dto.note !== undefined) patch.note = dto.note;

    // Recompute labor cost if member/time changed.
    if (dto.memberId !== undefined || dto.startTime !== undefined || dto.endTime !== undefined) {
      const { data: cur } = await this.sb
        .from("shifts")
        .select("member_id, start_time, end_time")
        .eq("id", shiftId)
        .maybeSingle();
      patch.labor_cost = await this.laborCost(
        restaurantId,
        dto.memberId ?? cur?.member_id,
        dto.startTime ?? cur?.start_time,
        dto.endTime ?? cur?.end_time,
      );
    }

    const { data, error } = await this.sb
      .from("shifts")
      .update(patch)
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .select("*, shift_breaks(*)")
      .single();
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
    const { data: shift } = await this.sb
      .from("shifts")
      .update({
        state: "open",
        note: dto.reason ? `Call-out: ${dto.reason}` : "Call-out — cover needed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .select()
      .single();
    if (!shift) throw new NotFoundException("Shift not found");

    await this.notifications.persistForRestaurant(restaurantId, {
      type: "system",
      title: "🚨 Shift call-out — cover needed",
      message: `${shift.role ?? "A shift"} on ${shift.shift_date} ${shift.start_time}-${shift.end_time} is open.`,
      priority: "critical",
      actionUrl: `/team?shift=${shiftId}`,
      actionLabel: "Find cover",
      metadata: { shiftId },
    });
    return shift;
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
    const targetUserIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);

    if (targetUserIds.length) {
      await this.push.sendToUsers(targetUserIds, {
        title: "Shift available — can you cover?",
        body: `${shift.role ?? "Shift"} ${shift.shift_date} ${shift.start_time}-${shift.end_time}. Tap to claim.`,
        priority: "high",
        data: { type: "shift_offer", shiftId, actionUrl: `/team?shift=${shiftId}` },
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
        throw new ForbiddenException("You can only claim open shifts for yourself");
      }
    }

    const cost = await this.recomputeCostForMember(restaurantId, shiftId, dto.memberId);
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
    if (error || !data) throw new InternalServerErrorException("Failed to assign cover");
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
      .eq("id", shiftId)
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
          const roleMatch = srole === trole || srole.includes(trole) || trole.includes(srole);
          return roleMatch && periodOf(s.start_time) === r.shift_period;
        }).length;
        if (staffed < r.min_staff) {
          gaps.push({ role: r.role, period: r.shift_period, staffed, required: r.min_staff });
        }
      }
      const openShifts = shifts.filter((s) => s.shift_date === date && (s.state === "open" || !s.member_id)).length;
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
  private async computeLabor(
    restaurantId: string,
    shifts: any[],
    settings: any,
  ): Promise<any> {
    if (!settings?.labor_tracking_enabled) {
      return { enabled: false, totalHours: hoursTotal(shifts) };
    }
    const totalHours = hoursTotal(shifts);
    const totalCost = shifts.reduce((s, sh) => s + Number(sh.labor_cost ?? 0), 0);
    // Per-member overtime (>40h/week) flags.
    const byMember = new Map<string, number>();
    for (const s of shifts) {
      if (!s.member_id) continue;
      byMember.set(s.member_id, (byMember.get(s.member_id) ?? 0) + hoursBetween(s.start_time, s.end_time));
    }
    const overtime = [...byMember.entries()]
      .filter(([, h]) => h > 40)
      .map(([memberId, h]) => ({ memberId, hours: Math.round(h * 10) / 10 }));
    return {
      enabled: true,
      totalHours: Math.round(totalHours * 10) / 10,
      totalCost: Math.round(totalCost * 100) / 100,
      targetPct: Number(settings.labor_target_pct ?? 28),
      overtime,
    };
  }

  private async weekStartOfSchedule(scheduleId: string): Promise<string> {
    const { data } = await this.sb
      .from("schedules")
      .select("week_start")
      .eq("id", scheduleId)
      .maybeSingle();
    return data?.week_start ?? mondayOf(new Date().toISOString().slice(0, 10));
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
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) /
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
  return shifts.reduce((s, sh) => s + hoursBetween(sh.start_time, sh.end_time), 0);
}
