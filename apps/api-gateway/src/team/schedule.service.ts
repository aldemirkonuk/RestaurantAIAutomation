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
  handoverChecks,
  HandoverShift,
  HouseLabour,
  houseLabour,
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
  spanHours,
  TeamRole,
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
import { readHouseZone } from "../common/house-day";
import { houseMembersInRoles } from "../common/tenant/live-membership";
import { houseFrame as frameOf } from "../common/house-frame";
import { dayWords, weekWords } from "./house-date-words";
import { labourShare, readWeekSales } from "./week-sales";

/** Why a week's coverage is `null` (F-1376): its rules could not be read. */
export const COVERAGE_RULES_UNREAD =
  "Could not read the coverage rules, so no day is called covered.";

/** Minutes since midnight from an "HH:MM" string. */
function toMinutes(t: string): number {
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}
function periodOf(start: string): "am" | "pm" {
  return toMinutes(start) < 15 * 60 ? "am" : "pm";
}

/**
 * Whether a shift counts toward a coverage rule's period (F-170). By its start
 * time, as before, and also by its Kind: a shift the owner set to "evening"
 * or "double" that is still on the clock after 15:00 counts toward the
 * evening, so an 11:00–23:00 evening shift fills an evening rule and a double
 * fills both. The Kind alone is not enough: the shift form starts every new
 * shift as "evening", so a 09:00–14:00 shift left at that never counts.
 */
export function servesPeriod(
  shift: { start_time: string; end_time: string; shift_type?: string | null },
  period: string,
): boolean {
  if (periodOf(shift.start_time) === period) return true;
  if (period !== "pm") return false;
  const kind = String(shift.shift_type ?? "").toLowerCase();
  if (kind !== "pm" && kind !== "double") return false;
  const start = toMinutes(shift.start_time);
  const end = toMinutes(shift.end_time);
  // Past 15:00, or past midnight (an end before the start). Equal times are a
  // moment, not a whole night, as in pay-rules hoursBetween (F-874).
  return end > 15 * 60 || end < start;
}

// The house's way of writing a date lives in `./house-date-words` so
// TeamService can use it without importing this module, which imports it.
export { weekWords };

/** A shift as the one conflict check reads it. */
type GivenShift = Pick<
  HandoverShift,
  "id" | "shift_date" | "start_time" | "end_time"
>;

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

    const [
      { data: schedule, error: scheduleErr },
      { data: shifts, error: shiftsErr },
      settings,
    ] = await Promise.all([
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
    // A week whose schedule row could not be read is not an unpublished week
    // (F-1119): it used to come back as a draft with nobody having seen it.
    if (scheduleErr) {
      this.logger.error(
        `getWeek: could not read the schedule of ${weekStart} for ` +
          `restaurant ${restaurantId}: ${scheduleErr.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read whether this week is published, so the week is not shown.",
      );
    }
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
    let receipts: any[] = [];
    if (schedule) {
      const { data: seen, error: seenErr } = await this.sb
        .from("schedule_receipts")
        .select("member_id, seen_at")
        .eq("schedule_id", schedule.id);
      // Unread receipts are not "nobody has seen it" (F-1119).
      if (seenErr) {
        this.logger.error(
          `getWeek: could not read who has seen ${weekStart} for ` +
            `restaurant ${restaurantId}: ${seenErr.message}`,
        );
        throw new InternalServerErrorException(
          "Could not read who has seen this week, so the week is not shown.",
        );
      }
      receipts = seen ?? [];
    }

    const coverage = await this.computeCoverage(
      restaurantId,
      weekStart,
      shiftRows,
    );
    const frame = await this.houseFrame(restaurantId);
    // `labourRegion` is the state already read inside the country (ADR
    // 0305), so it reads back as itself ("US-CA" is California's key).
    const labour = houseLabour({
      ...frame,
      state_province: frame.labourRegion,
    });
    // The cost is priced again on the house's rules NOW, as the hours are
    // (F-1548): a cost stored before the owner recorded the state or fixed the
    // country was priced on the old rules, and the week's hours and its cost
    // then disagreed. Only for a viewer who gets the money.
    // `onTheRoster` answers a new array, so its rows are swapped in place for
    // their re-priced copies; the rows read from the database are not touched.
    if (settings?.labor_tracking_enabled && seesMoney(viewer)) {
      const priced = await this.priceOnHouseRules(
        restaurantId,
        shiftRows,
        labour,
      );
      shiftRows.splice(0, shiftRows.length, ...priced);
    }
    const labor = await this.computeLabor(
      restaurantId,
      weekStart,
      shiftRows,
      settings,
      viewer,
      roster,
      labour,
    );

    return {
      schedule,
      shifts: shiftRows.map((s: any) => shiftForViewer(s, viewer)),
      coverage,
      // Unread rules are not "every day covered" (F-1376): say why it is null.
      ...(coverage === null ? { coverageUnread: COVERAGE_RULES_UNREAD } : {}),
      labor,
      receipts,
      settings,
      ...frame,
      // The currency travels with the money, and only to whoever gets the
      // money: /team printed every figure in US dollars (ADR 0215).
      ...(seesMoney(viewer)
        ? { money: await this.houseMoney(restaurantId) }
        : {}),
    };
  }

  /**
   * Each assigned shift's cost priced again on the house's labour rules as
   * they are now, at the wage the person had on the shift's day — the rule
   * `laborCost` prices a write with (the old wage of the first change after
   * that day, else the wage on file). F-1548: the stored `labor_cost` was
   * priced at write time, so a house whose state was recorded or whose
   * country was fixed later kept costs on the old rules while its hours were
   * read on the new ones. A person with no wage stays unpriced (ADR 0088).
   * Nothing is written: the stored cost is re-priced on its next write.
   */
  private async priceOnHouseRules(
    restaurantId: string,
    shifts: any[],
    labour: HouseLabour,
  ): Promise<any[]> {
    const ids = [
      ...new Set(shifts.filter((s) => s.member_id).map((s) => s.member_id)),
    ];
    if (ids.length === 0) return shifts;
    const first = shifts
      .map((s) => String(s.shift_date ?? "").slice(0, 10))
      .sort()[0];
    const [people, changes] = await Promise.all([
      this.sb
        .from("team_members")
        .select("id, hourly_wage")
        .eq("restaurant_id", restaurantId)
        .in("id", ids),
      this.sb
        .from("team_member_wage_changes")
        .select("member_id, old_wage, changed_at")
        .eq("restaurant_id", restaurantId)
        .in("member_id", ids)
        .gte("changed_at", `${addDays(first, 1)}T00:00:00.000Z`)
        .order("changed_at", { ascending: true }),
    ]);
    const failed = people.error ?? changes.error;
    if (failed) {
      this.logger.error(
        `getWeek: could not read the wages to price the week in ` +
          `${restaurantId}: ${failed.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read the wages to cost this week, so the week is not shown.",
      );
    }
    const wageNow = new Map<string, unknown>(
      (people.data ?? []).map((p: any) => [p.id, p.hourly_wage]),
    );
    const history = (changes.data ?? []) as any[];
    return shifts.map((s) => {
      if (!s.member_id) return s;
      const day = String(s.shift_date ?? "").slice(0, 10);
      const after = Date.parse(`${addDays(day, 1)}T00:00:00Z`);
      const later = history.find(
        (c) => c.member_id === s.member_id && Date.parse(c.changed_at) >= after,
      );
      const wage = later ? later.old_wage : wageNow.get(s.member_id);
      return {
        ...s,
        labor_cost: priceShift((wage ?? null) as any, s, labour),
      };
    });
  }

  /**
   * The house's own time zone, so a phone elsewhere still reads "tonight" as
   * the house's night (F-252), and its country, so a shift time prints on the
   * house's clock — "17:00" in a Turkish house, not "5p" (F-1007). The country
   * is not money and goes to every viewer. `null` when none is stated or it
   * could not be read; the client then falls back to its own clock.
   * `labourRegion` is the state whose labour rules sit on top of the
   * country's ("US-CA", ADR 0330); `null` when the country's own apply.
   */
  private async houseFrame(restaurantId: string): Promise<{
    timezone: string | null;
    country: string | null;
    labourRegion: string | null;
  }> {
    const { data, error } = await this.sb
      .from("restaurants")
      .select("timezone, country, state_province")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `houseFrame: could not read the time zone of ${restaurantId}: ${error.message}`,
      );
      return { timezone: null, country: null, labourRegion: null };
    }
    return {
      timezone: data?.timezone ?? null,
      country: data?.country ?? null,
      labourRegion: houseLabour(data).rules.region,
    };
  }

  /**
   * The labour rules and zone a shift is priced on (founder S195: a house's
   * rules follow its country). A failed read refuses, like a failed wage
   * read: a cost priced on the wrong country's break is not a cost.
   */
  private async houseLabourOf(restaurantId: string): Promise<HouseLabour> {
    const { data, error } = await this.sb
      .from("restaurants")
      .select("timezone, country, state_province")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        `houseLabourOf: could not read the country of ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read where this restaurant is, so its labour rules are unknown and the shift was not priced.",
      );
    }
    return houseLabour(data);
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
   * Read-only week for a staff member: only their own shifts.
   *
   * A week its manager has not published is still being drawn (F-506): staff
   * get the schedule row, so the page can say it is not out yet, but none of
   * its shifts — neither as theirs nor as open to take. An open shift that has
   * already ended on the house's clock is not offered either (F-507).
   */
  async getMyWeek(userId: string, restaurantId: string, weekStart: string) {
    const { role } = await this.team.assertAccess(userId, restaurantId);
    const weekEnd = addDays(weekStart, 6);
    // Each read below decides a sentence the person reads about their week:
    // no member row says "ask your manager to add you", no schedule says "not
    // out yet", no shifts says "Off" on all seven days. A failed read is none
    // of those, so it refuses and the page says the week is not known (F-922;
    // getWeek above was fixed for the same fault).
    const unreadable = (what: string, message: string): never => {
      this.logger.error(
        `getMyWeek: could not read ${what} of ${weekStart} for ` +
          `restaurant ${restaurantId}: ${message}`,
      );
      throw new InternalServerErrorException(
        "Could not read your week, so it is not shown.",
      );
    };
    const { data: member, error: memberErr } = await this.sb
      .from("team_members")
      .select("id, display_name")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memberErr) unreadable("the caller's roster row", memberErr.message);

    const { data: schedule, error: scheduleErr } = await this.sb
      .from("schedules")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (scheduleErr) unreadable("the schedule", scheduleErr.message);

    const { data: shifts, error: shiftsErr } = await this.sb
      .from("shifts")
      .select("*, shift_breaks(*)")
      .eq("restaurant_id", restaurantId)
      .gte("shift_date", weekStart)
      .lte("shift_date", weekEnd)
      .order("shift_date", { ascending: true });
    if (shiftsErr) unreadable("the shifts", shiftsErr.message);

    // Staff must never see labor cost. Strip it from every row.
    const strip = (s: any) => {
      const { labor_cost: _omit, ...rest } = s;
      return rest;
    };
    const unpublished =
      role === "staff" && (schedule as any)?.status !== "published";
    const all = unpublished ? [] : (shifts ?? []).map(strip);
    const mine = member
      ? all.filter((s: any) => s.member_id === member.id)
      : [];
    const openAny = all.filter((s: any) => s.state === "open" || !s.member_id);
    const nowOnClock = openAny.length
      ? await this.houseClockNow(restaurantId)
      : "";
    const open = openAny.filter((s: any) => !shiftHasEnded(s, nowOnClock));

    let acknowledged = false;
    if (member && schedule) {
      const { data: receipt, error: receiptErr } = await this.sb
        .from("schedule_receipts")
        .select("id")
        .eq("schedule_id", schedule.id)
        .eq("member_id", member.id)
        .maybeSingle();
      // A failed read would ask the person to tell their manager again.
      if (receiptErr) unreadable("the read receipt", receiptErr.message);
      acknowledged = !!receipt;
    }
    return {
      member,
      schedule,
      mine,
      open,
      acknowledged,
      ...(await this.houseFrame(restaurantId)),
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

    // The count the person was shown is the count they agreed to lose
    // (F-1030). A tab loaded before another manager filled the week says
    // "0 shifts" and would otherwise delete everything there now.
    if (dto.expectShifts !== undefined && dto.expectShifts !== inTheWay) {
      throw new ConflictException(
        `The week of ${dto.toWeekStart} now has ${inTheWay} shift(s), not the ` +
          `${dto.expectShifts} you were shown, so someone changed it after ` +
          "you opened the page. Nothing was copied and nothing was deleted. " +
          "Look at the week again before you copy.",
      );
    }

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
    const labour = await this.houseLabourOf(restaurantId);
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

    const dayShift = daysBetween(dto.fromWeekStart, dto.toWeekStart);
    // Each copied shift is checked like a new one (F-377, F-171): one whose
    // person is inactive, on approved leave that day, or already working then
    // arrives as an open shift for the crew to claim, never on them. Read
    // before anything is deleted, so a failed read changes nothing.
    const givenBy = new Map<string, GivenShift[]>();
    for (const s of copyable) {
      if (!s.member_id) continue;
      const list = givenBy.get(s.member_id) ?? [];
      list.push({
        id: s.id,
        shift_date: addDays(s.shift_date, dayShift),
        start_time: s.start_time,
        end_time: s.end_time,
      });
      givenBy.set(s.member_id, list);
    }
    const refused = await this.whyNotFor(restaurantId, givenBy, {
      ignore: inTheWayIds,
      inactiveToo: true,
    });
    const rows = copyable.map((s: any) => {
      if (s.member_id && refused.has(s.id)) {
        return {
          restaurant_id: restaurantId,
          schedule_id: target.id,
          member_id: null,
          shift_date: addDays(s.shift_date, dayShift),
          start_time: s.start_time,
          end_time: s.end_time,
          role: s.role,
          shift_type: "open",
          state: "open",
          note: s.note,
          recorded_break_min: recordedBreakMinutes(s),
          labor_cost: null,
        };
      }
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
          ? priceShift(wageOf.get(s.member_id) ?? null, copy, labour)
          : null,
      };
    });
    if (!rows.length && inTheWay === 0) {
      return { copied: 0, deleted: 0, schedule: target };
    }
    // The delete and the insert are one transaction that holds the week's
    // schedule row (F-1030, migration replace_week_shifts): it re-reads the
    // week under that lock and refuses when it is not the week read above, so
    // two copies at once cannot both land and double every shift, and a copy
    // that fails half way leaves the week as it was. The delete is by id, the
    // rows counted above: a date-range delete would also take a removed
    // person's kept shifts in that week (ADR 0215 item 20).
    const { data: done, error } = await (this.sb as any).rpc(
      "replace_week_shifts",
      {
        p_restaurant_id: restaurantId,
        p_schedule_id: target.id,
        p_week_start: dto.toWeekStart,
        p_seen: (existing ?? []).map((s: any) => s.id),
        p_delete: inTheWayIds,
        p_rows: rows,
      },
    );
    if (error) {
      if (error.code === "40001") {
        throw new ConflictException(
          `Someone changed the week of ${dto.toWeekStart} while this copy ` +
            "was being made. Nothing was copied and nothing was deleted. " +
            "Look at the week again before you copy.",
        );
      }
      this.logger.error(
        `copyWeek: could not replace the week ${dto.toWeekStart} for ` +
          `restaurant ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not copy the week. Nothing was copied and nothing was deleted.",
      );
    }
    const deleted = Number(done?.deleted ?? inTheWay);
    if (!rows.length) return { copied: 0, deleted, schedule: target };
    return {
      copied: rows.length,
      deleted,
      // How many arrived as open shifts instead of on their person.
      openedInstead: refused.size,
      schedule: target,
    };
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
      .select(
        "id, restaurant_id, week_start, status, published_at, published_by",
      )
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

    // F-1082: a publish whose reply was lost (a timeout on slow Wi-Fi) has
    // already landed, and pressing it again must not tell the whole crew a
    // second time. A week that is already live, with no receipts to clear and
    // no shift added, edited or deleted since it went live, is answered as it
    // stands: nothing is written and nobody is notified again.
    // F-1114: `resetReceipts: true` is the manager's explicit "send the
    // announcement again" once told nothing changed, so it is not short-
    // circuited; without it a lost announcement could never be re-sent.
    if (
      current.status === "published" &&
      !dto.resetReceipts &&
      receiptsAtRisk === 0 &&
      current.published_at &&
      (await this.unchangedSincePublished(restaurantId, current))
    ) {
      // `unchanged` names this answer: `republished: false` alone is also
      // what a first publish says, and the page read it as "nothing changed".
      return {
        schedule: current,
        receiptsCleared: 0,
        republished: false,
        unchanged: true,
      };
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

    // Notify the whole restaurant + deep-link back into /team. The sentence
    // names the week in the house's hand; the link keeps the ISO date. The
    // page opens a week from `week` alone; a schedule is one week, so no id
    // rides along (F-1151: `schedule=` had no reader).
    // F-1148: the funnel answers 0 when its insert failed (it logs and
    // swallows the error), so the count is read and handed back: a week that
    // went live while nobody was told says so, instead of "published".
    // `heldAway` are the people Away today, who get nothing by design (ADR 0218).
    const { locale } = frameOf(await this.houseFrame(restaurantId));
    const announced = await this.notifications.persistForRestaurant(
      restaurantId,
      {
        type: "system",
        title: "Schedule published",
        message: `The week of ${weekWords(schedule.week_start, locale)} is live. Open it to see your shifts.`,
        priority: "high",
        actionUrl: `/team?week=${schedule.week_start}`,
        actionLabel: "View schedule",
        groupKey: `schedule_published:${scheduleId}:${schedule.published_at}`,
        metadata: { scheduleId, weekStart: schedule.week_start },
      },
    );
    const reach = await this.crewReach(
      restaurantId,
      userId,
      announced?.ids ?? [],
    );
    return {
      schedule,
      receiptsCleared,
      republished: current.status === "published",
      // F-1228: the crew told, never the person who pressed Publish or the
      // other owners and managers; `null` when who got it could not be read.
      notified: reach.crew,
      // False only when the notice was written to nobody at all (F-1148).
      announced: (announced?.inserted ?? 0) > 0,
      noAccount: reach.noAccount,
      heldAway: announced?.routing?.heldAway ?? 0,
    };
  }

  /**
   * F-1228: how many of the crew a house notice reached, and how many on the
   * roster have no account to reach at all. The notice goes to every member,
   * so its own count included the publisher and every owner and manager, and
   * a week no crew member heard about read as told. A count that cannot be
   * read is `null`, never 0.
   */
  private async crewReach(
    restaurantId: string,
    actorId: string,
    notificationIds: string[],
  ): Promise<{ crew: number | null; noAccount: number | null }> {
    // The house's owners and managers: the one shared role reader (it
    // throws on a failed read, which leaves the reach unknown).
    const leaders = houseMembersInRoles(this.sb, restaurantId, [
      "owner",
      "manager",
    ]).then(
      (ids) => ({ ids, error: null as { message: string } | null }),
      (e: Error) => ({ ids: [] as string[], error: { message: e.message } }),
    );
    const [rows, lead, unlinked] = await Promise.all([
      notificationIds.length
        ? this.sb
            .from("notifications")
            .select("user_id")
            .in("id", notificationIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      leaders,
      this.sb
        .from("team_members")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("status", "active")
        .is("user_id", null),
    ]);
    const failed = rows.error ?? lead.error;
    if (failed) {
      this.logger.warn(
        `crewReach: who a notice reached in ${restaurantId} could not be read: ${failed.message}`,
      );
    }
    if (unlinked.error) {
      this.logger.warn(
        `crewReach: the roster of ${restaurantId} could not be read: ${unlinked.error.message}`,
      );
    }
    const leads = new Set(lead.ids);
    const crew = new Set(
      ((rows.data ?? []) as any[])
        .map((r) => r.user_id as string)
        .filter((id) => id && id !== actorId && !leads.has(id)),
    );
    return {
      crew: failed ? null : crew.size,
      noAccount: unlinked.error ? null : (unlinked.data ?? []).length,
    };
  }

  /**
   * True only when nothing on this week moved after it went live: no shift
   * of the schedule was written later, and no shift on one of its days was
   * deleted later. A read that fails answers false, so the crew hears about
   * the week again rather than missing a change (F-1082).
   */
  private async unchangedSincePublished(
    restaurantId: string,
    week: { id: string; week_start: string; published_at: string },
  ): Promise<boolean> {
    const { data: edited, error: editedErr } = await this.sb
      .from("shifts")
      .select("id")
      .eq("schedule_id", week.id)
      .eq("restaurant_id", restaurantId)
      .gt("updated_at", week.published_at)
      .limit(1);
    if (editedErr) {
      this.logger.warn(
        `publish: could not check week ${week.id} for edits: ${editedErr.message}`,
      );
      return false;
    }
    if ((edited ?? []).length > 0) return false;
    const { data: deleted, error: deletedErr } = await this.sb
      .from("system_audit_log")
      .select("changes")
      .eq("restaurant_id", restaurantId)
      .eq("action", "shift_deleted")
      .gt("created_at", week.published_at);
    if (deletedErr) {
      this.logger.warn(
        `publish: could not check week ${week.id} for deleted shifts: ${deletedErr.message}`,
      );
      return false;
    }
    const last = addDays(week.week_start, 6);
    return !(deleted ?? []).some(
      (row: { changes?: { shift_date?: unknown } }) => {
        const day = row.changes?.shift_date;
        return typeof day === "string" && day >= week.week_start && day <= last;
      },
    );
  }

  /** Staff opening a published schedule records a read receipt. */
  async acknowledge(userId: string, restaurantId: string, scheduleId: string) {
    await this.team.assertAccess(userId, restaurantId);
    // F-1005: every step is checked, so "seen" is only said once the receipt
    // is written. A database hiccup is not "Schedule not found", and a person
    // with no roster row is told why nothing was recorded.
    const unrecorded = (what: string, message: string): never => {
      this.logger.error(
        `acknowledge: could not ${what} for schedule ${scheduleId} in ` +
          `restaurant ${restaurantId}: ${message}`,
      );
      throw new InternalServerErrorException(
        "Could not let your manager know you have seen the schedule. Please try again.",
      );
    };
    const { data: schedule, error: scheduleErr } = await this.sb
      .from("schedules")
      .select("id")
      .eq("id", scheduleId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (scheduleErr) unrecorded("read the schedule", scheduleErr.message);
    if (!schedule) throw new NotFoundException("Schedule not found");

    const { data: member, error: memberErr } = await this.sb
      .from("team_members")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memberErr) unrecorded("read your roster row", memberErr.message);
    if (!member) {
      throw new ConflictException(
        "You are not on this restaurant's team list yet, so there is no schedule to confirm. Ask your manager to add you.",
      );
    }
    const { error: upsertErr } = await this.sb.from("schedule_receipts").upsert(
      {
        schedule_id: scheduleId,
        member_id: member.id,
        seen_at: new Date().toISOString(),
      },
      { onConflict: "schedule_id,member_id" },
    );
    if (upsertErr) unrecorded("write the read receipt", upsertErr.message);
    return { acknowledged: true };
  }

  // ── Shifts ────────────────────────────────────────────────────────────────
  /**
   * A shift's planned cost: worked hours (span minus the break the shift is
   * counted with — recorded, or the Art. 68 minimum for its length when none
   * is on record) at the wage in force on the shift's date. A failed wage read
   * is an error, not an unpriced shift: "no wage on file" is what `null` says,
   * and a database hiccup is not that.
   *
   * The wage in force (F-690): the wage on file now, unless it changed after
   * the shift's date — then the wage the first such change replaced
   * (`team_member_wage_changes.old_wage`). Fixing September's break after an
   * October raise used to reprice September at the October wage.
   */
  private async laborCost(
    restaurantId: string,
    memberId: string | null | undefined,
    shift: ShiftLike,
    shiftDate: string,
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
    const dayAfter = new Date(`${shiftDate.slice(0, 10)}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    const { data: later, error: laterErr } = await this.sb
      .from("team_member_wage_changes")
      .select("old_wage, changed_at")
      .eq("restaurant_id", restaurantId)
      .eq("member_id", memberId)
      .gte("changed_at", dayAfter.toISOString())
      .order("changed_at", { ascending: true })
      .limit(1);
    if (laterErr) {
      this.logger.error(
        `laborCost: could not read the wage history of member ${memberId} ` +
          `in ${restaurantId}: ${laterErr.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read this person's wage history to price the shift, so it was not saved.",
      );
    }
    const wage =
      later && later.length > 0 ? later[0].old_wage : (m?.hourly_wage ?? null);
    return priceShift(
      wage ?? null,
      { ...shift, shift_date: shiftDate },
      await this.houseLabourOf(restaurantId),
    );
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
    if (dto.memberId) {
      await this.team.assertMemberInRestaurant(restaurantId, dto.memberId);
      await this.assertMayWork(restaurantId, dto.memberId, [
        {
          id: "new",
          shift_date: dto.shiftDate,
          start_time: dto.startTime,
          end_time: dto.endTime,
        },
      ]);
    }
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
      },
      dto.shiftDate,
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
        "member_id, state, updated_at, start_time, end_time, shift_date, recorded_break_min, shift_breaks(*)",
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
    // The shift as the editor saw it (F-1033). The sheet sends back the whole
    // form, the person included, so a sheet opened before another manager
    // moved the shift would put the old person back without a word.
    const staleWho =
      dto.expectMemberId !== undefined &&
      (dto.expectMemberId ?? null) !== (cur.member_id ?? null);
    const staleWhen =
      dto.expectUpdatedAt !== undefined &&
      !sameInstant(dto.expectUpdatedAt, cur.updated_at);
    if (staleWho || staleWhen) throw changedSinceOpened();
    // Taking the person off makes it an open shift for the crew to claim, as
    // a new shift with nobody on it is (F-1032); putting someone on an open
    // one schedules it, so it is no longer offered to the crew.
    if (dto.state === undefined && dto.memberId !== undefined) {
      if (dto.memberId === null && cur.member_id) patch.state = "open";
      if (dto.memberId && cur.state === "open") patch.state = "scheduled";
    }

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

    // The person the shift will have, checked like a new shift whenever who,
    // when or how long changes (F-377, F-171): an edit could move a shift onto
    // their approved leave, or onto another of their shifts.
    const nextDate = dto.shiftDate ?? cur.shift_date;
    const nextMember =
      dto.memberId !== undefined ? dto.memberId : cur.member_id;
    if (
      nextMember &&
      (nextMember !== cur.member_id ||
        dto.shiftDate !== undefined ||
        dto.startTime !== undefined ||
        dto.endTime !== undefined)
    ) {
      await this.assertMayWork(
        restaurantId,
        nextMember,
        [
          {
            id: shiftId,
            shift_date: nextDate,
            start_time: nextStart,
            end_time: nextEnd,
          },
        ],
        { inactiveToo: nextMember !== cur.member_id },
      );
    }

    // Rebind schedule when the date moves into another week.
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
        nextDate,
      );
    }

    // Compare-and-set on the row as read above (F-1033): a change that lands
    // between that read and this write leaves no row matched, said as a 409.
    let write = this.sb
      .from("shifts")
      .update(patch)
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId);
    if (cur.updated_at) write = write.eq("updated_at", cur.updated_at);
    const { data, error } = await write
      .select("*, shift_breaks(*)")
      .maybeSingle();
    if (error) throw new InternalServerErrorException("Failed to update shift");
    if (!data) throw changedSinceOpened();
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
      .select("member_id, shift_date, start_time, end_time, role, state")
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
    // F-690: a deleted shift leaves a trail — who deleted which shift, and
    // what it was — before the row goes. No trail, no delete. The cost is
    // left out: the house log is read by people without pay access.
    const { error: auditErr } = await this.sb.from("system_audit_log").insert({
      actor_type: "user",
      actor_id: userId,
      action: "shift_deleted",
      entity_type: "shift",
      entity_id: shiftId,
      changes: {
        member_id: cur.member_id ?? null,
        shift_date: cur.shift_date ?? null,
        start_time: cur.start_time ?? null,
        end_time: cur.end_time ?? null,
        role: cur.role ?? null,
        state: cur.state ?? null,
      },
      restaurant_id: restaurantId,
      reason: null,
    });
    if (auditErr) {
      this.logger.error(
        `deleteShift: could not record the delete of shift ${shiftId} in ` +
          `${restaurantId}: ${auditErr.message}`,
      );
      throw new InternalServerErrorException(
        "Could not keep a record of this shift, so it was not deleted.",
      );
    }
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
    const { data: original } = await this.sb
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!original) throw new NotFoundException("Shift not found");
    await this.team.assertOnTheRoster(
      restaurantId,
      original,
      "Shift not found",
    );

    // F-1116: only a shift someone still holds can be called out. A second
    // press, or a retry after a lost reply, finds it already in "callout"
    // and must not open a second cover slot or alert the house again.
    if (original.state === "callout") {
      throw new ConflictException(
        "This call-out is already reported. Its cover slot is under Open shifts.",
      );
    }
    if (!original.member_id || original.state === "open") {
      throw new ConflictException(
        "Nobody holds this shift, so there is no call-out to report. It is already open.",
      );
    }
    await this.assertCoverable(restaurantId, original, "callout");

    // Keep the original on the caller's row as "callout" (strike-through),
    // and open a fresh unassigned cover slot for the same window. The state
    // compare makes two presses that read the shift at once land only one.
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
      .eq("state", original.state)
      .select()
      .maybeSingle();
    if (calloutErr)
      throw new InternalServerErrorException("Failed to mark call-out");
    if (!calloutShift) {
      throw new ConflictException(
        "This call-out is already reported. Its cover slot is under Open shifts.",
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

    // The day as the house writes a date, as the publish notice does (F-1229);
    // the link keeps the ISO date.
    const { locale } = frameOf(await this.houseFrame(restaurantId));
    // A team push: Push off holds it, quiet hours do not, and a push sent
    // inside someone's window is logged (the founder's F-540 ruling, F-1340).
    await this.notifications.persistForRestaurant(
      restaurantId,
      {
        type: "system",
        title: "Shift call-out — cover needed",
        message: `${original.role ?? "A shift"} on ${weekWords(original.shift_date, locale)} ${original.start_time}-${original.end_time} is open.`,
        priority: "critical",
        actionUrl: shiftLink(openShift.id, original.shift_date),
        actionLabel: "Find cover",
        metadata: { shiftId: openShift.id, calloutShiftId: shiftId },
      },
      { teamPush: { what: "shift_callout", by: userId } },
    );
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
    await this.team.assertOnTheRoster(restaurantId, shift, "Shift not found");
    // F-1113: the push says "Tap to claim", and staff may claim only an open
    // shift (assignCover). A shift someone still holds, or a called-out row,
    // is never offered: nobody told to claim it could.
    if (shift.state !== "open" && shift.member_id) {
      throw new ConflictException(
        shift.state === "callout"
          ? "This is the called-out shift, which nobody can claim. Offer its cover slot under Open shifts."
          : "Someone still holds this shift, so nobody could claim it. Report a call-out first, then offer the cover slot it opens.",
      );
    }
    await this.assertCoverable(restaurantId, shift, "offer");
    // F-1225: an offer to nobody is not an offer; it was answered as sent.
    if (!dto.memberIds?.length) {
      throw new BadRequestException(
        "Nobody is free to cover this shift, so nobody was asked.",
      );
    }

    const { data: members } = await this.sb
      .from("team_members")
      .select("id, user_id")
      .eq("restaurant_id", restaurantId)
      .in("id", dto.memberIds);
    // F-1158: nobody on approved time off or Away that day is asked, the
    // grid's rule (offOn, F-1148) held here too, so a direct call cannot
    // push "Tap to claim" to a person assignCover will refuse or who asked
    // to be left alone. Unreadable means nobody is asked.
    const day = String(shift.shift_date).slice(0, 10);
    const { data: leave, error: leaveErr } = await this.sb
      .from("time_off_requests")
      .select("member_id")
      .eq("restaurant_id", restaurantId)
      .in("member_id", dto.memberIds)
      .eq("status", "approved")
      .lte("start_date", day)
      .gte("end_date", day);
    const { data: away, error: awayErr } = await this.sb
      .from("house_away")
      .select("user_id")
      .eq("restaurant_id", restaurantId)
      .lte("away_from", day)
      .gte("away_until", day);
    if (leaveErr || awayErr) {
      this.logger.error(
        `offerCover: could not read leave or Away in ${restaurantId}: ${(leaveErr ?? awayErr)!.message}`,
      );
      throw new InternalServerErrorException(
        "Could not check who is off that day, so nobody was asked to cover. Try again.",
      );
    }
    const onLeave = new Set((leave ?? []).map((l: any) => l.member_id));
    const isAway = new Set((away ?? []).map((a: any) => a.user_id));
    const free = (members ?? []).filter(
      (m: any) => !onLeave.has(m.id) && !(m.user_id && isAway.has(m.user_id)),
    );
    const targetUserIds = free.map((m: any) => m.user_id).filter(Boolean);

    // F-1225: the offer lands on each person's bell, so someone who uses only
    // the web sees it too, and the funnel pushes it to their phone unless
    // they turned push off. `notified` is the people it was written to, not
    // the people it was addressed to: a push that found no phone, or an
    // inbox write that failed, used to read as asked.
    let notified = 0;
    if (targetUserIds.length) {
      // The day as the house writes a date (F-1229); the link keeps the ISO date.
      // The bell row names its house (persistForRestaurant stamps it, F-1183).
      const { locale } = frameOf(await this.houseFrame(restaurantId));
      const out = await this.notifications.persistForRestaurant(
        restaurantId,
        {
          type: "system",
          title: "Shift available — can you cover?",
          message: `${shift.role ?? "Shift"} ${weekWords(shift.shift_date, locale)} ${shift.start_time}-${shift.end_time}. Open it to claim.`,
          priority: "high",
          actionUrl: shiftLink(shiftId, shift.shift_date),
          actionLabel: "Claim it",
          metadata: { shiftId, action: "shift_offer" },
        },
        // A team push: Push off holds it, quiet hours do not (F-1340).
        {
          onlyUserIds: targetUserIds,
          teamPush: { what: "shift_offer", by: userId },
        },
      );
      notified = out?.inserted ?? 0;
    }
    return {
      offered: free.length,
      notified,
      // On the roster but with no account: nothing could reach them.
      noAccount: free.length - targetUserIds.length,
      setAside: (members ?? []).length - free.length,
    };
  }

  /**
   * F-1224: cover is asked for only on a week the crew can see and a shift
   * still ahead. A week still being drawn is not out to staff, so nobody could
   * claim its cover (assignCover, F-506), and a shift that is over can no
   * longer be worked (F-507): a call-out on either told the whole house
   * "cover needed" for a slot every claim was refused. Checked before
   * anything is written or sent.
   */
  private async assertCoverable(
    restaurantId: string,
    shift: {
      schedule_id?: string | null;
      shift_date?: string | null;
      start_time?: string | null;
      end_time?: string | null;
    },
    act: "callout" | "offer",
  ): Promise<void> {
    const { data: week, error } = shift.schedule_id
      ? await this.sb
          .from("schedules")
          .select("status")
          .eq("id", shift.schedule_id)
          .eq("restaurant_id", restaurantId)
          .maybeSingle()
      : { data: null, error: null };
    if (error) {
      this.logger.error(
        `assertCoverable: the week of a shift in ${restaurantId} could not be read: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not check whether this week is published, so nothing was changed and nobody was told. Try again.",
      );
    }
    if (week?.status !== "published") {
      throw new ConflictException(
        act === "callout"
          ? "This week is not published yet, so the crew has not seen it. Change the shift on the draft instead; nobody was told."
          : "This week is not published yet, so nobody could take its shifts. Publish the week first; nobody was asked.",
      );
    }
    if (shiftHasEnded(shift, await this.houseClockNow(restaurantId))) {
      throw new ConflictException(
        act === "callout"
          ? "This shift has already ended, so there is no cover left to find. Nothing was changed and nobody was told."
          : "This shift has already ended, so nobody can take it now. Nobody was asked.",
      );
    }
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
    const viewer = await this.team.assertAccess(
      userId,
      restaurantId,
      undefined,
      {
        payAccess: true,
      },
    );
    const { role } = viewer;
    await this.team.assertMemberInRestaurant(restaurantId, dto.memberId);

    const { data: shift } = await this.sb
      .from("shifts")
      .select(
        "id, member_id, state, schedule_id, shift_date, start_time, end_time",
      )
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!shift) throw new NotFoundException("Shift not found");
    await this.team.assertOnTheRoster(restaurantId, shift, "Shift not found");

    if (role === "staff") {
      const { data: me } = await this.sb
        .from("team_members")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("user_id", userId)
        .maybeSingle();
      const isOpen = shift.state === "open" || !shift.member_id;
      if (!me || me.id !== dto.memberId) {
        throw new ForbiddenException(
          "You can only claim open shifts for yourself",
        );
      }
      // A stale screen: someone already took it. Say who, not "forbidden".
      if (!isOpen && shift.state === "covered") {
        throw await this.takenBy(restaurantId, shift.member_id, me.id);
      }
      if (!isOpen) {
        throw new ForbiddenException(
          "You can only claim open shifts for yourself",
        );
      }
      // A week still being drawn is not out to staff (F-506), and a shift
      // that is over cannot be worked, only paid for (F-507).
      const { data: week } = shift.schedule_id
        ? await this.sb
            .from("schedules")
            .select("status")
            .eq("id", shift.schedule_id)
            .eq("restaurant_id", restaurantId)
            .maybeSingle()
        : { data: null };
      if (week?.status !== "published") {
        throw new ConflictException(
          "This week's schedule isn't out yet, so its shifts can't be taken. They can be once your manager publishes the week.",
        );
      }
      if (shiftHasEnded(shift, await this.houseClockNow(restaurantId))) {
        throw new ConflictException(
          "This shift has already ended, so it can't be taken now.",
        );
      }
    }
    const cost = await this.recomputeCostForMember(
      restaurantId,
      shiftId,
      dto.memberId,
    );
    // A cover or a claim is a shift given to someone, checked like one
    // (F-377, F-171). Before the write, so a refusal changes nothing.
    await this.assertMayWork(restaurantId, dto.memberId, [shift], {
      self: role === "staff",
    });
    let claim = this.sb
      .from("shifts")
      .update({
        member_id: dto.memberId,
        state: "covered",
        labor_cost: cost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId);
    // offerCover pushes the same shift to several people at once. A staff
    // claim is a compare-and-set on what made it claimable, so of two taps in
    // the same second one wins and the other is told who has it — the later
    // write no longer silently replaces the first.
    if (role === "staff") {
      claim = shift.member_id
        ? claim.eq("state", "open").eq("member_id", shift.member_id)
        : claim.is("member_id", null);
    }
    const { data, error } = await claim
      .select("*, shift_breaks(*)")
      .maybeSingle();
    if (error) throw new InternalServerErrorException("Failed to assign cover");
    if (!data) {
      if (role !== "staff")
        throw new InternalServerErrorException("Failed to assign cover");
      const { data: now, error: nowError } = await this.sb
        .from("shifts")
        .select("member_id")
        .eq("id", shiftId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      // The claim lost either way; a failed read only means we cannot say to whom.
      if (nowError) {
        this.logger.warn(
          `claim ${shiftId}: could not read who holds it: ${nowError.message}`,
        );
        throw new ConflictException(
          "This shift is no longer open. Refresh to see who has it.",
        );
      }
      throw await this.takenBy(
        restaurantId,
        now?.member_id ?? null,
        dto.memberId,
      );
    }
    // Only the owner sees labor_cost — it is the wage times the hours, so it
    // is the wage (ADR 0215). Staff never did; a manager no longer does.
    return shiftForViewer(data, viewer);
  }

  /** The 409 for a claim that lost: names who holds the shift now. */
  private async takenBy(
    restaurantId: string,
    holderId: string | null,
    myId: string,
  ): Promise<ConflictException> {
    if (holderId && holderId === myId)
      return new ConflictException("This shift is already yours.");
    let name: string | null = null;
    if (holderId) {
      const { data: holder, error } = await this.sb
        .from("team_members")
        .select("display_name")
        .eq("id", holderId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      // Unread, the holder is still someone else — only the name is unknown.
      if (error)
        this.logger.warn(
          `could not read shift holder ${holderId}: ${error.message}`,
        );
      name = holder?.display_name?.trim() || null;
    }
    return new ConflictException(
      `${name ?? "Someone else"} has already taken this shift.`,
    );
  }

  /**
   * The one check every write that puts a person on a shift makes — create,
   * edit, a manager's cover, a staff claim and copy-week (F-377, F-171).
   * Before, only the leaving-person hand-over read leave and overlap
   * (`handoverChecks`, ADR 0215 item 27), so every everyday path scheduled
   * over approved leave and double-booked with no word, and an inactive
   * person could be given an 11-hour shift and its wage.
   *
   * A shift may not go to someone who is inactive on the roster (only when
   * they are being put on it — editing the times of a shift they already hold
   * is not), who has approved time off that day, or who already works then
   * unless the owner allowed double booking. Refused, not warned: the fix is
   * at the source — set them active, change the time off, move the other
   * shift (coordinator's call, sim-run/bulletproof/reconcile/
   * calendar-team-decisions.md). Returns the reason per given shift id; a
   * failed read refuses, because not knowing their leave is not their having
   * none.
   */
  private async whyNotFor(
    restaurantId: string,
    givenBy: ReadonlyMap<string, readonly GivenShift[]>,
    opts: {
      ignore?: readonly string[];
      inactiveToo?: boolean;
      self?: boolean;
    } = {},
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const memberIds = [...givenBy.keys()];
    const all = [...givenBy.values()].flat();
    if (!all.length) return out;
    const dates = all.map((g) => g.shift_date.slice(0, 10)).sort();
    const from = dates[0];
    const until = dates[dates.length - 1];
    const fail = (what: string, err: { message: string }): never => {
      this.logger.error(
        `whyNotFor: could not read ${what} in ${restaurantId}: ${err.message}`,
      );
      throw new InternalServerErrorException(
        `Could not read ${what}, so the shift was not given to anyone. Nothing was changed.`,
      );
    };

    const { data: people, error: peopleErr } = await this.sb
      .from("team_members")
      .select("id, status")
      .eq("restaurant_id", restaurantId)
      .in("id", memberIds);
    if (peopleErr) fail("who is active on the team", peopleErr);
    // A day either side: an overnight shift reaches into the next day.
    const { data: theirs, error: theirsErr } = await this.sb
      .from("shifts")
      .select(
        "id, member_id, shift_date, start_time, end_time, state, recorded_break_min",
      )
      .eq("restaurant_id", restaurantId)
      .in("member_id", memberIds)
      .gte("shift_date", addDays(from, -1))
      .lte("shift_date", addDays(until, 1));
    if (theirsErr) fail("their other shifts", theirsErr);
    const { data: leave, error: leaveErr } = await this.sb
      .from("time_off_requests")
      .select("member_id, start_date, end_date, status")
      .eq("restaurant_id", restaurantId)
      .in("member_id", memberIds)
      .eq("status", "approved")
      .lte("start_date", until)
      .gte("end_date", from);
    if (leaveErr) fail("their time off", leaveErr);
    const { data: settings, error: settingsErr } = await this.sb
      .from("team_settings")
      .select("allow_double_booking")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (settingsErr) fail("whether double booking is allowed", settingsErr);
    const allowDoubleBooking = settings?.allow_double_booking === true;
    const labour = await this.houseLabourOf(restaurantId);

    const ignore = new Set([...(opts.ignore ?? []), ...all.map((g) => g.id)]);
    for (const [memberId, given] of givenBy) {
      const inactive = (people ?? []).some(
        (p: any) => p.id === memberId && p.status === "inactive",
      );
      const checks = handoverChecks(
        given.map((g) => ({ ...g })),
        {},
        (theirs ?? []).filter(
          (t: any) => t.member_id === memberId && !ignore.has(t.id),
        ) as any[],
        (leave ?? []).filter((l: any) => l.member_id === memberId) as any[],
        allowDoubleBooking,
        labour,
      );
      for (const g of given) {
        const codes = new Map(
          (checks.get(g.id) ?? []).map((c) => [c.code, c.level]),
        );
        const day = dayWords(g.shift_date);
        const reason =
          opts.inactiveToo && inactive
            ? opts.self
              ? "You are set to inactive on the team, so this shift cannot go to you. Ask your manager."
              : "This person is set to inactive on the team. Set them active first, or give the shift to someone else."
            : codes.has("time_off")
              ? opts.self
                ? `You have approved time off on ${day}, so this shift cannot go to you.`
                : `This person has approved time off on ${day}. Change their time off first, or give the shift to someone else.`
              : codes.get("overlap") === "refuse"
                ? opts.self
                  ? `You already have a shift at that time on ${day}, and double booking is off in this house.`
                  : `This person already has a shift at that time on ${day}, and double booking is off in this house. Give the shift to someone else.`
                : null;
        if (reason) out.set(g.id, reason);
      }
    }
    return out;
  }

  /** `whyNotFor` for one person, refused in words (409) when it says no. */
  private async assertMayWork(
    restaurantId: string,
    memberId: string,
    given: readonly GivenShift[],
    opts: { inactiveToo?: boolean; self?: boolean } = {},
  ): Promise<void> {
    const refused = await this.whyNotFor(
      restaurantId,
      new Map([[memberId, given]]),
      { inactiveToo: opts.inactiveToo ?? true, self: opts.self },
    );
    const reason = [...refused.values()][0];
    if (reason) throw new ConflictException(`${reason} Nothing was saved.`);
  }

  /**
   * Now on the house's clock, as "YYYY-MM-DD HH:MM". With no zone known, or
   * none readable, it is read on the clock furthest behind (UTC-12), so a
   * shift is only ever called over once it is over everywhere.
   */
  private async houseClockNow(restaurantId: string): Promise<string> {
    let zone: string | null = null;
    try {
      zone = (await readHouseZone(this.sb, restaurantId)).zone;
    } catch (e) {
      this.logger.warn(
        `houseClockNow: the time zone of ${restaurantId} could not be read; ` +
          `shifts are judged over on the latest clock: ${(e as Error).message}`,
      );
    }
    return clockAt(zone ?? "Etc/GMT+12", new Date());
  }

  private async recomputeCostForMember(
    restaurantId: string,
    shiftId: string,
    memberId: string,
  ): Promise<number | null> {
    const { data: s, error } = await this.sb
      .from("shifts")
      .select(
        "start_time, end_time, shift_date, recorded_break_min, shift_breaks(*)",
      )
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
    return this.laborCost(restaurantId, memberId, s, s.shift_date);
  }

  // ── Coverage engine ──────────────────────────────────────────────────────
  /**
   * Deterministic coverage per day/period/role against coverage_templates.
   * Returns per-day gap summaries so manager + staff see identical truth.
   * `null` when the rules could not be read (F-1376): with no rules every day
   * came back gap-free and the week read "covered".
   */
  private async computeCoverage(
    restaurantId: string,
    weekStart: string,
    shifts: any[],
  ): Promise<any> {
    const { data: templates, error: templatesErr } = await this.sb
      .from("coverage_templates")
      .select("*")
      .eq("restaurant_id", restaurantId);
    if (templatesErr) {
      this.logger.error(
        `computeCoverage: could not read the coverage rules of ` +
          `restaurant ${restaurantId}: ${templatesErr.message}`,
      );
      return null;
    }
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
          return srole === trole && servesPeriod(s, r.shift_period);
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
   *    clients read it) and it never carries a price. [S195, 2026-10-11: the
   *    line is the house's country's — 45 in Türkiye, 40 in the US, 48 in
   *    GB and DE, none where the country is not built in.] It is computed whether or not cost tracking is on: it is
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
    labour: HouseLabour,
  ): Promise<any> {
    const worked = shifts.filter(isWorked);
    let totalHours = 0;
    let breakHours = 0;
    let assumedBreakHours = 0;
    let assumedBreakShifts = 0;
    const byMember = new Map<string, number>();
    /** Worked hours per person per house day, for a daily line (US-CA, DE). */
    const byMemberDay = new Map<string, number>();
    for (const s of worked) {
      const w = workedHours(s, labour);
      totalHours += w;
      breakHours += spanHours(s, labour) - w;
      const b = breakCounted(s, labour);
      if (b.assumed) {
        assumedBreakShifts += 1;
        assumedBreakHours += b.minutes / 60;
      }
      if (s.member_id) {
        byMember.set(s.member_id, (byMember.get(s.member_id) ?? 0) + w);
        const k = `${s.member_id}|${String(s.shift_date ?? "").slice(0, 10)}`;
        byMemberDay.set(k, (byMemberDay.get(k) ?? 0) + w);
      }
    }
    const reviewAt = labour.rules.weeklyReviewHours;
    const overtime = [...byMember.entries()]
      .filter(([, h]) => reviewAt != null && h > reviewAt)
      .map(([memberId, h]) => ({ memberId, hours: Math.round(h * 10) / 10 }));
    // A day over the daily line (ADR 0330: California's 8 hours, Labor Code
    // §510; Germany's 10). Every shift that person works that day counts,
    // so a split shift is one day. A review, never a price, like the week.
    const dayAt = labour.rules.dailyReviewHours;
    const overDay = [...byMemberDay.entries()]
      .filter(([, h]) => dayAt != null && h > dayAt)
      .map(([k, h]) => {
        const [memberId, date] = k.split("|");
        return { memberId, date, hours: Math.round(h * 10) / 10 };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
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
      /** The house's country's review line; `null` = its rules are not built in. */
      weeklyReviewHours: reviewAt,
      labourCountry: labour.rules.country,
      overtime,
      /** The house's daily line (8 in California, 10 in Germany); `null` = none. */
      dailyReviewHours: dayAt,
      /** The state whose rules sit on the country's ("US-CA"); `null` = none. */
      labourRegion: labour.rules.region,
      /** People over `dailyReviewHours` worked hours on a day. */
      overDay,
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
    // The share of sales the target is measured against (F-1549): the cost
    // over the week's net sales, the dashboard's figure for the same house
    // days. `null` with the reason whenever the sales are not all known.
    const sales = await readWeekSales(
      this.sb,
      restaurantId,
      weekStart,
      labour.zone ?? null,
    );
    return {
      enabled: true,
      ...hours,
      /** `null` = this week cannot be costed yet. Never a partial, never 0. */
      totalCost,
      /** The week's net sales from the till; `null` = not all known. */
      netSales: sales.netSales,
      /** F-1588: the week's net is not on one tax basis, and why; else null. */
      netSalesTaxNote: sales.taxNote ?? null,
      ...labourShare(totalCost, sales, ownerShiftsLeftOut),
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
      return {
        readable: false,
        paid: null,
        paidDays: null,
        unknownTypeDays: null,
      };
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
/** Two timestamps naming the same moment, whatever their spelling. */
function sameInstant(a: unknown, b: unknown): boolean {
  const x = Date.parse(String(a ?? ""));
  const y = Date.parse(String(b ?? ""));
  return Number.isFinite(x) && x === y;
}

/** A shift edited from a sheet opened before someone else changed it (F-1033). */
function changedSinceOpened(): ConflictException {
  return new ConflictException(
    "Someone else changed or removed this shift after you opened it, so " +
      "nothing was saved. Close this and open the shift again to see it as " +
      "it is now.",
  );
}

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
/**
 * Where a notice about one shift opens: /team on the week that holds it.
 * /team reads `week` (the Monday) and opened on this week for every link,
 * so a cover call for next Friday showed a week without it (F-217). `shift`
 * stays for the phone, which routes on the path.
 */
function shiftLink(shiftId: string, shiftDate: unknown): string {
  const base = `/team?shift=${encodeURIComponent(shiftId)}`;
  return typeof shiftDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(shiftDate)
    ? `${base}&week=${mondayOf(shiftDate)}`
    : base;
}
function mondayOf(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
/** "YYYY-MM-DD HH:MM" on `zone`'s clock at `now`. */
function clockAt(zone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}
/**
 * Whether a shift's end is at or before `nowOnClock` (from `clockAt`). A shift
 * that ends before it starts runs past midnight, into the next day; equal
 * times are a moment on its own day, as the feed and the hours read them (F-874).
 */
function shiftHasEnded(
  sh: {
    shift_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
  },
  nowOnClock: string,
): boolean {
  if (!sh.shift_date || !sh.end_time || !nowOnClock) return false;
  const end = sh.end_time.slice(0, 5);
  const start = (sh.start_time ?? "").slice(0, 5);
  const endDay =
    start && end < start ? addDays(sh.shift_date, 1) : sh.shift_date;
  return `${endDay} ${end}` <= nowOnClock;
}
