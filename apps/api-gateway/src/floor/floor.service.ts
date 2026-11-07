/**
 * The waiter's floor (`/floor/me`, ADR 0345 Role map): own tables, taps,
 * clock-in and clock-out, raise Food-up, read Out tonight and own manager
 * notes. Nothing here returns a figure of any kind — no minutes, no score, no
 * other person's name ("Nothing for now", pick 13's option text).
 *
 * Every computation goes through `@wineops/floor-core` (E1). Every write
 * records an act in `floor_events` (or `floor_visits` for a visit), and every
 * change is announced to `restaurant:<id>` as a word only (E2).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  DEFAULT_MEAL_COURSE,
  MEAL_NOTE_MAX,
  STATUS_LABEL,
  dwellMinutesSince,
  isMealCourse,
  needsShortVisitConfirm,
  sanitizeMealNote,
  seatingFreshness,
} from "@wineops/floor-core";
import { DatabaseService } from "../database/database.service";
import { houseMembersInRoles } from "../common/tenant/live-membership";
import { NotificationsService } from "../notifications/notifications.service";
import { WebsocketGateway, type FloorWord } from "../websocket/websocket.gateway";
import {
  type FloorActor,
  isManagerRole,
  isUniqueViolation,
  readFloorHouse,
  requireServiceDate,
  serviceDateOf,
} from "./floor-common";
import { readHolders } from "./floor-holders";
import { pushTo, staffCopy } from "./floor-push";

/**
 * A short-stay confirm opened just under 12 minutes and tapped just after
 * still counts as a quick leave. Open as OD-242, the executor's reading under
 * OD-242: the allowance is 2 minutes.
 */
export const LEAVE_CONFIRM_GRACE_MIN = 2;

export interface OpenSeating {
  id: string;
  table_id: string;
  seated_at: string;
  seated_by: string | null;
  caretaker_at_seat_id: string | null;
  party_size: number | null;
  paid_at: string | null;
  paid_undone_at: string | null;
}

@Injectable()
export class FloorService {
  private readonly logger = new Logger(FloorService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly ws: WebsocketGateway,
    private readonly notifications: NotificationsService,
  ) {}

  private get sb() {
    return this.db.supabase;
  }

  // -------------------------------------------------------------------------
  // Shared reads
  // -------------------------------------------------------------------------

  async tableOf(restaurantId: string, tableId: string) {
    const { data, error } = await this.sb
      .from("restaurant_tables")
      .select("id, label, seats, hidden_at")
      .eq("id", tableId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException("The table could not be read.");
    if (!data) throw new NotFoundException("No such table in this house.");
    return data as { id: string; label: string; seats: number | null; hidden_at: string | null };
  }

  async openSeating(restaurantId: string, seatingId: string): Promise<OpenSeating> {
    const { data, error } = await this.sb
      .from("floor_seatings")
      .select("id, table_id, seated_at, seated_by, caretaker_at_seat_id, party_size, paid_at, paid_undone_at, left_at")
      .eq("id", seatingId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException("The seating could not be read.");
    if (!data) throw new NotFoundException("No such seating in this house.");
    if ((data as { left_at: string | null }).left_at) {
      throw new ConflictException("This party has already left.");
    }
    return data as OpenSeating;
  }

  /** Latest live visit per seating. */
  async lastVisits(restaurantId: string, seatingIds: string[]) {
    const out = new Map<string, { at: string; count: number }>();
    if (seatingIds.length === 0) return out;
    const { data, error } = await this.sb
      .from("floor_visits")
      .select("seating_id, visited_at")
      .eq("restaurant_id", restaurantId)
      .in("seating_id", seatingIds)
      .is("struck_at", null);
    if (error) throw new InternalServerErrorException("The visits could not be read.");
    for (const v of (data ?? []) as Array<{ seating_id: string; visited_at: string }>) {
      const prev = out.get(v.seating_id);
      out.set(v.seating_id, {
        at: !prev || v.visited_at > prev.at ? v.visited_at : prev.at,
        count: (prev?.count ?? 0) + 1,
      });
    }
    return out;
  }

  /** The anchor the late clock counts from: the later of the last visit and an undo of Paid. */
  static lastVisitAnchor(lastVisitAt: string | null, paidUndoneAt: string | null): string | null {
    if (!lastVisitAt) return paidUndoneAt;
    if (!paidUndoneAt) return lastVisitAt;
    return lastVisitAt > paidUndoneAt ? lastVisitAt : paidUndoneAt;
  }

  async event(
    a: FloorActor,
    kind: string,
    fields: { tableId?: string | null; seatingId?: string | null; subjectUserId?: string | null; meta?: Record<string, unknown> },
  ) {
    const { error } = await this.sb.from("floor_events").insert({
      restaurant_id: a.restaurantId,
      kind,
      table_id: fields.tableId ?? null,
      seating_id: fields.seatingId ?? null,
      actor_id: a.userId,
      subject_user_id: fields.subjectUserId ?? null,
      meta: fields.meta ?? {},
    });
    // The act itself has landed; a lost event row is logged, never a failed tap.
    if (error) this.logger.error(`floor_events ${kind} not written: ${error.message}`);
  }

  word(restaurantId: string, tableId: string | null, word: FloorWord) {
    try {
      this.ws.emitFloorWord(restaurantId, { tableId, word });
    } catch (e) {
      this.logger.warn(`floor:changed not emitted: ${(e as Error)?.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // My tables
  // -------------------------------------------------------------------------

  async myTables(a: FloorActor, now = Date.now()) {
    const house = await readFloorHouse(this.sb, a.restaurantId);
    const holders = await readHolders(this.sb, a.restaurantId, serviceDateOf(house.zone, now));
    const mine = [...holders.byTable.entries()]
      .filter(([, users]) => users.includes(a.userId))
      .map(([tableId]) => tableId);
    if (mine.length === 0) return { tables: [] };

    const [tables, seatings] = await Promise.all([
      this.sb
        .from("restaurant_tables")
        .select("id, label, seats, hidden_at")
        .eq("restaurant_id", a.restaurantId)
        .in("id", mine)
        .is("hidden_at", null),
      this.sb
        .from("floor_seatings")
        .select("id, table_id, seated_at, party_size, paid_at, paid_undone_at")
        .eq("restaurant_id", a.restaurantId)
        .in("table_id", mine)
        .is("left_at", null),
    ]);
    if (tables.error || seatings.error) {
      throw new InternalServerErrorException("Your tables could not be read.");
    }
    const open = new Map(
      ((seatings.data ?? []) as OpenSeating[]).map((s) => [s.table_id, s]),
    );
    const visits = await this.lastVisits(a.restaurantId, [...open.values()].map((s) => s.id));
    const rows = ((tables.data ?? []) as Array<{ id: string; label: string; seats: number | null }>)
      .map((t) => {
        const s = open.get(t.id);
        // Paid stops the clock (ADR 0353): a paid table is not late.
        const status = !s
          ? "idle"
          : s.paid_at
            ? "fresh"
            : seatingFreshness(
                {
                  seatedAt: s.seated_at,
                  lastVisitAt: FloorService.lastVisitAnchor(visits.get(s.id)?.at ?? null, s.paid_undone_at),
                },
                house.warnAfterMin,
                house.lateAfterMin,
                now,
              );
        return {
          tableId: t.id,
          label: t.label,
          seats: t.seats,
          seatingId: s?.id ?? null,
          partySize: s?.party_size ?? null,
          paid: Boolean(s?.paid_at),
          status,
          statusLabel: STATUS_LABEL[status],
        };
      })
      .sort((x, y) => x.label.localeCompare(y.label, "en", { numeric: true }));
    return { tables: rows };
  }

  // -------------------------------------------------------------------------
  // Taps
  // -------------------------------------------------------------------------

  async seat(a: FloorActor, tableId: string, partySize: number | null, now = Date.now()) {
    const table = await this.tableOf(a.restaurantId, tableId);
    if (table.hidden_at) throw new ConflictException("This table is hidden from the floor.");
    const house = await readFloorHouse(this.sb, a.restaurantId);
    const holders = await readHolders(this.sb, a.restaurantId, serviceDateOf(house.zone, now));
    const held = holders.byTable.get(tableId) ?? [];
    // The greeting gap belongs to the table's waiter (ADR 0346 D4 c). With
    // several section holders and none of them the tapper, nobody is guessed.
    const caretaker = held.includes(a.userId) ? a.userId : held.length === 1 ? held[0] : null;
    const { data, error } = await this.sb
      .from("floor_seatings")
      .insert({
        restaurant_id: a.restaurantId,
        table_id: tableId,
        seated_by: a.userId,
        caretaker_at_seat_id: caretaker,
        // E9: never guessed. NULL when nobody said.
        party_size: partySize ?? null,
      })
      .select("id, seated_at")
      .single();
    if (isUniqueViolation(error)) throw new ConflictException("This table is already seated.");
    if (error || !data) throw new InternalServerErrorException("The seating could not be written.");
    await this.event(a, "seated", { tableId, seatingId: data.id, meta: { party_size: partySize ?? null } });
    this.word(a.restaurantId, tableId, "seated");
    return { seatingId: data.id, tableId, partySize: partySize ?? null };
  }

  async visit(a: FloorActor, seatingId: string, source: "tap" | "food_delivered" = "tap") {
    const s = await this.openSeating(a.restaurantId, seatingId);
    const { data, error } = await this.sb
      .from("floor_visits")
      .insert({
        restaurant_id: a.restaurantId,
        seating_id: s.id,
        table_id: s.table_id,
        user_id: a.userId,
        source,
      })
      .select("id")
      .single();
    if (error || !data) throw new InternalServerErrorException("The visit could not be written.");
    this.word(a.restaurantId, s.table_id, "visited");
    return { visitId: data.id, seatingId: s.id };
  }

  async paid(a: FloorActor, seatingId: string) {
    const s = await this.openSeating(a.restaurantId, seatingId);
    if (s.paid_at) return { seatingId: s.id, paid: true, already: true };
    const { data, error } = await this.sb
      .from("floor_seatings")
      .update({ paid_at: new Date().toISOString(), paid_by: a.userId, paid_source: "tap" })
      .eq("id", s.id)
      .eq("restaurant_id", a.restaurantId)
      .is("paid_at", null)
      .select("id");
    if (error) throw new InternalServerErrorException("Paid could not be written.");
    if ((data ?? []).length === 0) return { seatingId: s.id, paid: true, already: true };
    await this.event(a, "paid", { tableId: s.table_id, seatingId: s.id, meta: { source: "tap" } });
    this.word(a.restaurantId, s.table_id, "paid");
    return { seatingId: s.id, paid: true, already: false };
  }

  /**
   * One-tap undo of Paid (ADR 0353 › The undo): the table's waiter, whoever is
   * covering it, or an owner or manager. The late clock restarts from the
   * undo; the undo is not a visit.
   */
  async undoPaid(a: FloorActor, seatingId: string, now = Date.now()) {
    const s = await this.openSeating(a.restaurantId, seatingId);
    if (!s.paid_at) throw new ConflictException("This table is not marked Paid.");
    if (!isManagerRole(a)) {
      const house = await readFloorHouse(this.sb, a.restaurantId);
      const holders = await readHolders(this.sb, a.restaurantId, serviceDateOf(house.zone, now));
      const covers = await this.coversFor(a.restaurantId, holders.byTable.get(s.table_id) ?? []);
      const allowed = new Set([...(holders.byTable.get(s.table_id) ?? []), ...covers]);
      if (!allowed.has(a.userId)) {
        throw new ForbiddenException("Only this table's waiter, its cover or a manager can undo Paid.");
      }
    }
    const { error } = await this.sb
      .from("floor_seatings")
      .update({
        paid_at: null,
        paid_by: null,
        paid_source: null,
        paid_undone_at: new Date(now).toISOString(),
        paid_undone_by: a.userId,
      })
      .eq("id", s.id)
      .eq("restaurant_id", a.restaurantId);
    if (error) throw new InternalServerErrorException("The undo could not be written.");
    await this.event(a, "paid_undone", { tableId: s.table_id, seatingId: s.id });
    this.word(a.restaurantId, s.table_id, "paid_undone");
    return { seatingId: s.id, paid: false };
  }

  /**
   * Leave ends a seating; only a person does it (ADR 0353). A very short stay
   * with almost no visits asks for confirmation first (floor-core's
   * `needsShortVisitConfirm`), and a confirmed one is recorded as a quick leave.
   *
   * The kind is the server's, never the client's: the rule runs on the stored
   * `seated_at` (timestamptz) and visits with the server's clock. A
   * `confirmShort` the rule would not have offered, even
   * LEAVE_CONFIRM_GRACE_MIN earlier, is ignored and noted. A seat time the
   * rule cannot read skips the confirm, and the leave says so.
   */
  async leave(a: FloorActor, seatingId: string, confirmShort: boolean, now = Date.now()) {
    const s = await this.openSeating(a.restaurantId, seatingId);
    const v = (await this.lastVisits(a.restaurantId, [s.id])).get(s.id);
    const rule = (nowMs: number) =>
      needsShortVisitConfirm({
        seatedAt: s.seated_at,
        lastCheckInAt: v?.at ?? null,
        checkInCount: v?.count ?? 0,
        nowMs,
      });
    const short = rule(now);
    const unreadable = dwellMinutesSince(s.seated_at, now) === null;
    const quick = short || (confirmShort && rule(now - LEAVE_CONFIRM_GRACE_MIN * 60_000));
    if (short && !confirmShort) {
      throw new ConflictException({
        code: "CONFIRM_SHORT_VISIT",
        message: "This party was seated only a few minutes ago. Confirm they left.",
      });
    }
    const { data, error } = await this.sb
      .from("floor_seatings")
      .update({ left_at: new Date(now).toISOString(), left_by: a.userId })
      .eq("id", s.id)
      .eq("restaurant_id", a.restaurantId)
      .is("left_at", null)
      .select("id");
    if (error) throw new InternalServerErrorException("Leave could not be written.");
    if ((data ?? []).length === 0) throw new ConflictException("This party has already left.");
    await this.event(a, "left", {
      tableId: s.table_id,
      seatingId: s.id,
      meta: quick
        ? { visit_kind: "quick_leave" }
        : unreadable
          ? { confirm_skipped: "unreadable_seat_time" }
          : confirmShort
            ? { confirm_ignored: true }
            : {},
    });
    this.word(a.restaurantId, s.table_id, "left");
    return { seatingId: s.id, left: true, quickLeave: quick };
  }

  // -------------------------------------------------------------------------
  // Food up
  // -------------------------------------------------------------------------

  /**
   * Any staff member raises Food-up for a table (pick 2). The table's holder
   * (or, when on break, their cover) gets a staff push: house, table, "Food up"
   * — the brief and the pass's note stay on signed-in screens (ADR 0352).
   */
  async foodUp(a: FloorActor, tableId: string, course: unknown, note: unknown, now = Date.now()) {
    // The pass's note is validated before it is stored: a string of at most
    // MEAL_NOTE_MAX characters, cleaned by floor-core. It is never sent in a
    // push, and no brief title, body or priority is either (ADR 0352).
    if (note !== undefined && note !== null && typeof note !== "string") {
      throw new BadRequestException("The note must be text.");
    }
    if (typeof note === "string" && note.trim().length > MEAL_NOTE_MAX) {
      throw new BadRequestException(`The note can be at most ${MEAL_NOTE_MAX} characters.`);
    }
    const table = await this.tableOf(a.restaurantId, tableId);
    const house = await readFloorHouse(this.sb, a.restaurantId);
    const meta = {
      course: isMealCourse(course) ? course : DEFAULT_MEAL_COURSE,
      note: sanitizeMealNote(typeof note === "string" ? note : null) || null,
    };
    const { data: seating } = await this.sb
      .from("floor_seatings")
      .select("id")
      .eq("restaurant_id", a.restaurantId)
      .eq("table_id", tableId)
      .is("left_at", null)
      .maybeSingle();
    const { data, error } = await this.sb
      .from("floor_events")
      .insert({
        restaurant_id: a.restaurantId,
        kind: "food_up",
        table_id: tableId,
        seating_id: (seating as { id: string } | null)?.id ?? null,
        actor_id: a.userId,
        meta,
      })
      .select("id")
      .single();
    if (error || !data) throw new InternalServerErrorException("Food up could not be written.");
    this.word(a.restaurantId, tableId, "food_up");

    let pushed: { sentTo: number; notSent: number; reason: string | null };
    try {
      const holders = await readHolders(this.sb, a.restaurantId, serviceDateOf(house.zone, now));
      const held = holders.byTable.get(tableId) ?? [];
      const audience = await this.audienceFor(a.restaurantId, held);
      let sentTo = 0;
      for (const userId of audience) {
        const r = await pushTo(
          this.notifications,
          userId,
          staffCopy({
            restaurantId: a.restaurantId,
            houseName: house.name,
            tableId,
            tableLabel: table.label,
            word: "Food up",
            lateAfterMin: house.lateAfterMin,
          }),
          house.lateAfterMin,
        );
        if (r.sent > 0) sentTo++;
      }
      pushed = {
        sentTo,
        notSent: audience.length - sentTo,
        reason: audience.length === 0 ? "nobody_holds_this_table" : null,
      };
    } catch (e) {
      // The meal run is recorded; the push failed and says so. The scanner's
      // next tick climbs an unsent, unacknowledged Food-up (ADR 0352).
      pushed = { sentTo: 0, notSent: 0, reason: `read_failed: ${(e as Error)?.message}` };
    }
    return { foodUpId: data.id, tableId, pushed };
  }

  async foodAck(a: FloorActor, foodUpId: string) {
    const { data, error } = await this.sb
      .from("floor_events")
      .select("id, table_id, seating_id")
      .eq("id", foodUpId)
      .eq("restaurant_id", a.restaurantId)
      .eq("kind", "food_up")
      .maybeSingle();
    if (error) throw new InternalServerErrorException("The Food up could not be read.");
    if (!data) throw new NotFoundException("No such Food up in this house.");
    const ev = data as { id: string; table_id: string | null; seating_id: string | null };
    await this.event(a, "food_ack", { tableId: ev.table_id, seatingId: ev.seating_id, meta: { food_up_id: ev.id } });
    this.word(a.restaurantId, ev.table_id, "food_ack");
    return { foodUpId: ev.id, acknowledged: true };
  }

  /**
   * The covers of people now on break: the cover named on each holder's latest
   * `on_break` with no `back` after it. Open as OD-236, the executor's reading
   * under OD-242: the cover is the person the waiter names at the On break
   * tap; ADR 0351's `cover` assignment rows are not built.
   */
  async coversFor(restaurantId: string, holders: string[]): Promise<string[]> {
    const onBreak = await this.breakState(restaurantId, holders);
    return [...new Set([...onBreak.values()].filter((c): c is string => Boolean(c)))];
  }

  /**
   * Who a table's alert goes to: each holder who is not on break, and the
   * named cover of each holder who is. A holder on break with no cover named
   * drops out (the scanner then climbs to the manager step). Open as OD-236.
   */
  async audienceFor(restaurantId: string, holders: string[]): Promise<string[]> {
    const onBreak = await this.breakState(restaurantId, holders);
    const out = new Set<string>();
    for (const h of holders) {
      if (!onBreak.has(h)) out.add(h);
      else if (onBreak.get(h)) out.add(onBreak.get(h)!);
    }
    return [...out];
  }

  /** Holders now on break → the cover they named (null when none). */
  private async breakState(restaurantId: string, holders: string[]): Promise<Map<string, string | null>> {
    const onBreak = new Map<string, string | null>();
    if (holders.length === 0) return onBreak;
    const { data, error } = await this.sb
      .from("floor_events")
      .select("kind, actor_id, meta, created_at")
      .eq("restaurant_id", restaurantId)
      .in("kind", ["on_break", "back"])
      .in("actor_id", holders)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new InternalServerErrorException("Breaks could not be read.");
    const seen = new Set<string>();
    for (const e of (data ?? []) as Array<{ kind: string; actor_id: string; meta: Record<string, unknown> }>) {
      if (seen.has(e.actor_id)) continue;
      seen.add(e.actor_id);
      const cover = e.meta?.cover_user_id;
      if (e.kind === "on_break") onBreak.set(e.actor_id, typeof cover === "string" ? cover : null);
    }
    return onBreak;
  }

  // -------------------------------------------------------------------------
  // Punches (ADR 0350): shown beside the plan; no punch prices a shift.
  // -------------------------------------------------------------------------

  private async openPunch(a: FloorActor) {
    const { data, error } = await this.sb
      .from("floor_punches")
      .select("id, clocked_in_at")
      .eq("restaurant_id", a.restaurantId)
      .eq("user_id", a.userId)
      .is("clocked_out_at", null)
      .is("superseded_at", null)
      .maybeSingle();
    if (error) throw new InternalServerErrorException("Your punch could not be read.");
    return data as { id: string; clocked_in_at: string } | null;
  }

  async clockIn(a: FloorActor, kind: "clock_in" | "back" = "clock_in") {
    const { data, error } = await this.sb
      .from("floor_punches")
      // shift_id is left NULL: which plan row a punch sits beside is read when a
      // view opens, by person and time (ADR 0350 › Where a punch is shown).
      .insert({ restaurant_id: a.restaurantId, user_id: a.userId, source: "floor", created_by: a.userId })
      .select("id, clocked_in_at")
      .single();
    if (isUniqueViolation(error)) throw new ConflictException("You are already clocked in.");
    if (error || !data) throw new InternalServerErrorException("The punch could not be written.");
    await this.event(a, kind, { subjectUserId: a.userId, meta: { punch_id: data.id } });
    return { punchId: data.id, clockedInAt: data.clocked_in_at };
  }

  async clockOut(a: FloorActor, reason: "clock_out" | "break" = "clock_out", coverUserId: string | null = null) {
    const open = await this.openPunch(a);
    if (!open) throw new ConflictException("You are not clocked in.");
    const at = new Date().toISOString();
    const { error } = await this.sb
      .from("floor_punches")
      .update({ clocked_out_at: at, clocked_out_reason: reason })
      .eq("id", open.id)
      .eq("restaurant_id", a.restaurantId);
    if (error) throw new InternalServerErrorException("The punch could not be closed.");
    if (reason === "break") {
      await this.event(a, "on_break", {
        subjectUserId: a.userId,
        meta: { punch_id: open.id, cover_user_id: coverUserId },
      });
    } else {
      await this.event(a, "clock_out", { subjectUserId: a.userId, meta: { punch_id: open.id } });
    }
    return { punchId: open.id, clockedOutAt: at, reason };
  }

  /** On break names a cover who must be a live staff-or-above member of this house. */
  async onBreak(a: FloorActor, coverUserId: string | null) {
    if (coverUserId) {
      let members: string[];
      try {
        members = await houseMembersInRoles(this.sb, a.restaurantId, ["owner", "manager", "staff"]);
      } catch {
        throw new InternalServerErrorException("The cover could not be checked.");
      }
      if (!members.includes(coverUserId)) {
        throw new ForbiddenException("The cover is not a member of this house.");
      }
    }
    return this.clockOut(a, "break", coverUserId);
  }

  async back(a: FloorActor) {
    return this.clockIn(a, "back");
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async outTonight(a: FloorActor, now = Date.now()) {
    const house = await readFloorHouse(this.sb, a.restaurantId);
    const date = requireServiceDate(house.zone, now);
    const { data, error } = await this.sb
      .from("floor_out_tonight")
      .select("id, menu_item_id, label, marked_at")
      .eq("restaurant_id", a.restaurantId)
      .eq("service_date", date)
      .is("back_at", null)
      .order("marked_at", { ascending: true });
    if (error) throw new InternalServerErrorException("Out tonight could not be read.");
    const rows = (data ?? []) as Array<{ id: string; menu_item_id: string | null; label: string | null }>;
    const itemIds = rows.map((r) => r.menu_item_id).filter((x): x is string => Boolean(x));
    const names = new Map<string, string>();
    if (itemIds.length > 0) {
      const items = await this.sb
        .from("menu_items")
        .select("id, name")
        .eq("restaurant_id", a.restaurantId)
        .in("id", itemIds);
      if (items.error) throw new InternalServerErrorException("Out tonight could not be read.");
      for (const i of (items.data ?? []) as Array<{ id: string; name: string }>) names.set(i.id, i.name);
    }
    return {
      serviceDate: date,
      items: rows.map((r) => ({
        id: r.id,
        menuItemId: r.menu_item_id,
        name: r.label ?? (r.menu_item_id ? names.get(r.menu_item_id) ?? null : null),
      })),
    };
  }

  /** The person's own manager notes (team_notes addressed to their roster rows in this house). */
  async myNotes(a: FloorActor) {
    const { data: members, error: mErr } = await this.sb
      .from("team_members")
      .select("id")
      .eq("restaurant_id", a.restaurantId)
      .eq("user_id", a.userId);
    if (mErr) throw new InternalServerErrorException("Your notes could not be read.");
    const ids = ((members ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (ids.length === 0) return { notes: [] };
    const { data, error } = await this.sb
      .from("team_note_recipients")
      .select("id, opened_at, note:team_notes(id, body, week_start, created_at, restaurant_id)")
      .in("member_id", ids);
    if (error) throw new InternalServerErrorException("Your notes could not be read.");
    const notes = ((data ?? []) as Array<any>)
      .filter((r) => r.note && r.note.restaurant_id === a.restaurantId)
      .map((r) => ({
        noteId: r.note.id,
        body: r.note.body,
        weekStart: r.note.week_start,
        sentAt: r.note.created_at,
        openedAt: r.opened_at,
      }))
      .sort((x, y) => (x.sentAt < y.sentAt ? 1 : -1));
    return { notes };
  }
}
