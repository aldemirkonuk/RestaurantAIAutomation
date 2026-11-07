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
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  STATUS_LABEL,
  dwellMinutesSince,
  needsShortVisitConfirm,
  seatingFreshness,
} from "@wineops/floor-core";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "../notifications/notifications.service";
import { WebsocketGateway, type FloorWord } from "../websocket/websocket.gateway";
import {
  type FloorActor,
  isManagerRole,
  isUniqueViolation,
  readFloorHouse,
  serviceDateOf,
} from "./floor-common";
import { readHolders } from "./floor-holders";

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
}
