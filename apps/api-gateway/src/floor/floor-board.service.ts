/**
 * The manager's floor (`/floor`, ADR 0345 Role map: owner and manager): the
 * board with every figure, the shift report and its CSV. Figures are owners'
 * and managers' only for the first rollout; the controller admits nobody else
 * and the realtime copy goes through `emitToHouseRoles` (E2).
 *
 * Every figure is computed by `@wineops/floor-core` (E1): freshness, the
 * response-time samples and their credit, the waiter score and its band, and
 * the order waiters are listed in (`sortByScore`, ties on the user id; no rank
 * is stored or sent).
 */
import { BadRequestException, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import {
  type FreshnessStatus,
  type SeatingFacts,
  type VisitEvent,
  STATUS_LABEL,
  avgOf,
  exactMinutesSince,
  liveOnTimePct,
  onTimePct,
  overdueGapCount,
  responseSamples,
  scoreBand,
  scoreBandLabel,
  seatingFreshness,
  sortByScore,
  waiterPerformanceScore,
} from "@wineops/floor-core";
import { DatabaseService } from "../database/database.service";
import { localMidnight, shiftLocalDate } from "../notifications/producers/service-day";
import {
  type FloorActor,
  type FloorHouse,
  SERVICE_DAY_ROLLOVER_HOURS,
  readFloorHouse,
  serviceDateOf,
} from "./floor-common";
import { readHolders } from "./floor-holders";
import { FloorService } from "./floor.service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An actor, seater or caretaker id as floor-core's response time must get it:
 * null, never "". floor-core keeps a "" caretaker and drops a "" actor's gap
 * without a trace (.planning/tech-debt.d response-time item 1).
 */
const idOrNull = (id: string | null | undefined): string | null => (id ? id : null);

interface SeatingRow {
  id: string;
  table_id: string;
  seated_at: string;
  seated_by: string | null;
  caretaker_at_seat_id: string | null;
  party_size: number | null;
  paid_at: string | null;
  paid_source: string | null;
  paid_undone_at: string | null;
  left_at: string | null;
}

@Injectable()
export class FloorBoardService {
  private readonly logger = new Logger(FloorBoardService.name);

  constructor(private readonly db: DatabaseService) {}

  private get sb() {
    return this.db.supabase;
  }

  /** [start, end) of a house-local service date: 06:00 that day to 06:00 the next. */
  static windowOf(date: string, zone: string): { start: number; end: number } {
    const h = SERVICE_DAY_ROLLOVER_HOURS * 3_600_000;
    return {
      start: localMidnight(date, zone).getTime() + h,
      end: localMidnight(shiftLocalDate(date, 1), zone).getTime() + h,
    };
  }

  async names(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const { data, error } = await this.sb.from("users").select("user_id, name").in("user_id", ids);
    if (error) throw new InternalServerErrorException("Names could not be read.");
    for (const u of (data ?? []) as Array<{ user_id: string; name: string }>) out.set(u.user_id, u.name);
    return out;
  }

  private async tables(restaurantId: string) {
    const { data, error } = await this.sb
      .from("restaurant_tables")
      .select("id, label, seats, hidden_at")
      .eq("restaurant_id", restaurantId);
    if (error) throw new InternalServerErrorException("The tables could not be read.");
    return (data ?? []) as Array<{ id: string; label: string; seats: number | null; hidden_at: string | null }>;
  }

  private async seatingsIn(restaurantId: string, start: number, end: number, includeOpen: boolean) {
    const q = this.sb
      .from("floor_seatings")
      .select("id, table_id, seated_at, seated_by, caretaker_at_seat_id, party_size, paid_at, paid_source, paid_undone_at, left_at")
      .eq("restaurant_id", restaurantId);
    const { data, error } = includeOpen
      ? await q.or(`left_at.is.null,seated_at.gte.${new Date(start).toISOString()}`).lt("seated_at", new Date(end).toISOString())
      : await q.gte("seated_at", new Date(start).toISOString()).lt("seated_at", new Date(end).toISOString());
    if (error) throw new InternalServerErrorException("The seatings could not be read.");
    return (data ?? []) as SeatingRow[];
  }

  private async visitsOf(restaurantId: string, seatingIds: string[]) {
    if (seatingIds.length === 0) return [] as Array<{ seating_id: string; table_id: string; user_id: string | null; visited_at: string }>;
    const { data, error } = await this.sb
      .from("floor_visits")
      .select("seating_id, table_id, user_id, visited_at")
      .eq("restaurant_id", restaurantId)
      .in("seating_id", seatingIds)
      .is("struck_at", null);
    if (error) throw new InternalServerErrorException("The visits could not be read.");
    return (data ?? []) as Array<{ seating_id: string; table_id: string; user_id: string | null; visited_at: string }>;
  }

  /**
   * Each user's last floor tap on a table in [start, end): the latest of a
   * standing check-in (`floor_visits`) and a tapped act on a table
   * (`floor_events` with a table: seat, Paid, leave, Food-up). ADR 0346 D4 (b)
   * ends a seating's open gap at its caretaker's last tap that service day.
   */
  async lastTaps(restaurantId: string, userIds: string[], start: number, end: number): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const from = new Date(start).toISOString();
    const to = new Date(end).toISOString();
    const [visits, events] = await Promise.all([
      this.sb
        .from("floor_visits")
        .select("user_id, visited_at")
        .eq("restaurant_id", restaurantId)
        .in("user_id", ids)
        .is("struck_at", null)
        .gte("visited_at", from)
        .lt("visited_at", to),
      this.sb
        .from("floor_events")
        .select("actor_id, created_at")
        .eq("restaurant_id", restaurantId)
        .in("actor_id", ids)
        .not("table_id", "is", null)
        .gte("created_at", from)
        .lt("created_at", to),
    ]);
    if (visits.error || events.error) throw new InternalServerErrorException("The floor taps could not be read.");
    const taps = [
      ...((visits.data ?? []) as Array<{ user_id: string | null; visited_at: string }>).map((v) => [v.user_id, v.visited_at] as const),
      ...((events.data ?? []) as Array<{ actor_id: string | null; created_at: string }>).map((e) => [e.actor_id, e.created_at] as const),
    ];
    for (const [userId, at] of taps) {
      const ms = Date.parse(at);
      if (!userId || !Number.isFinite(ms)) continue;
      const prev = out.get(userId);
      if (prev === undefined || ms > Date.parse(prev)) out.set(userId, new Date(ms).toISOString());
    }
    return out;
  }

  /**
   * Per-waiter figures over a window, from floor-core's samples. `lastTap`
   * holds each caretaker's last floor tap that service day; the live board
   * passes none, so every `caretakerLastTapAt` is null there.
   */
  figures(
    seatings: SeatingRow[],
    visits: Array<{ seating_id: string; table_id: string; user_id: string | null; visited_at: string }>,
    hidden: Set<string>,
    house: FloorHouse,
    now: number,
    lastTap: ReadonlyMap<string, string> = new Map(),
  ) {
    const events: VisitEvent[] = visits.map((v) => ({
      tableId: v.table_id,
      actorId: idOrNull(v.user_id),
      seatingId: v.seating_id,
      type: "check_in",
      createdAt: v.visited_at,
    }));
    const facts: SeatingFacts[] = seatings.map((s) => {
      const caretaker = idOrNull(s.caretaker_at_seat_id);
      return {
        seatingId: s.id,
        tableId: s.table_id,
        seatedAt: s.seated_at,
        seatedBy: idOrNull(s.seated_by),
        caretakerAtSeatId: caretaker,
        paidAt: s.paid_at,
        leftAt: s.left_at,
        caretakerLastTapAt: caretaker ? lastTap.get(caretaker) ?? null : null,
        tableHidden: hidden.has(s.table_id),
      };
    });
    const samples = responseSamples(events, { seatings: facts, warnAfterMin: house.warnAfterMin, now });
    // *Not closed* (neither Paid nor leave by `now`) is counted beside the
    // seating's caretaker at seat time; a caretaker with only such seatings
    // still gets a row.
    const caretakerOf = new Map(seatings.map((s) => [s.id, idOrNull(s.caretaker_at_seat_id)]));
    const notClosed = new Map<string, number>();
    let notClosedUnassigned = 0;
    for (const id of samples.seatingsNotClosed) {
      const who = caretakerOf.get(id);
      if (who) notClosed.set(who, (notClosed.get(who) ?? 0) + 1);
      else notClosedUnassigned += 1;
    }
    const gapsBy = new Map(samples.byWaiter);
    for (const who of notClosed.keys()) if (!gapsBy.has(who)) gapsBy.set(who, []);
    const waiters = [...gapsBy.entries()].map(([userId, gaps]) => {
      const score = waiterPerformanceScore(gaps, house.warnAfterMin);
      return {
        userId,
        notClosed: notClosed.get(userId) ?? 0,
        gaps: gaps.length,
        avgGapMin: avgOf(gaps),
        onTimePct: onTimePct(gaps, house.warnAfterMin),
        overdueGaps: overdueGapCount(gaps, house.lateAfterMin),
        score,
        band: score === null ? null : scoreBand(score),
        bandLabel: score === null ? null : scoreBandLabel(scoreBand(score)),
      };
    });
    return {
      waiters: sortByScore(waiters.map((w) => ({ id: w.userId, score: w.score, w }))).map((r) => r.w),
      samples,
      notClosedUnassigned,
    };
  }

  // -------------------------------------------------------------------------
  // The board
  // -------------------------------------------------------------------------

  async board(a: FloorActor, now = Date.now()) {
    const house = await readFloorHouse(this.sb, a.restaurantId);
    const date = serviceDateOf(house.zone, now);
    const [tables, holders] = await Promise.all([
      this.tables(a.restaurantId),
      readHolders(this.sb, a.restaurantId, date),
    ]);
    const hidden = new Set(tables.filter((t) => t.hidden_at).map((t) => t.id));
    const window = date && house.zone ? FloorBoardService.windowOf(date, house.zone) : null;
    // Without a zone the floor still shows what is open now; the day's figures
    // need a day, and a day needs the house's clock (never UTC).
    const seatings = window
      ? await this.seatingsIn(a.restaurantId, window.start, window.end, true)
      : await this.openSeatings(a.restaurantId);
    const visits = await this.visitsOf(a.restaurantId, seatings.map((s) => s.id));
    const last = new Map<string, string>();
    for (const v of visits) {
      const p = last.get(v.seating_id);
      if (!p || v.visited_at > p) last.set(v.seating_id, v.visited_at);
    }
    const openByTable = new Map(seatings.filter((s) => !s.left_at).map((s) => [s.table_id, s]));
    const names = await this.names([
      ...[...holders.byTable.values()].flat(),
      ...seatings.map((s) => s.seated_by ?? ""),
    ]);

    const statusByWaiter = new Map<string, FreshnessStatus[]>();
    const rows = tables
      .filter((t) => !t.hidden_at)
      .map((t) => {
        const s = openByTable.get(t.id) ?? null;
        const anchor = s ? FloorService.lastVisitAnchor(last.get(s.id) ?? null, s.paid_undone_at) : null;
        const status: FreshnessStatus = !s
          ? "idle"
          : s.paid_at
            ? "fresh"
            : seatingFreshness({ seatedAt: s.seated_at, lastVisitAt: anchor }, house.warnAfterMin, house.lateAfterMin, now);
        const held = holders.byTable.get(t.id) ?? [];
        if (s) for (const u of held) statusByWaiter.set(u, [...(statusByWaiter.get(u) ?? []), status]);
        return {
          tableId: t.id,
          label: t.label,
          seats: t.seats,
          sectionId: holders.sectionOf.get(t.id) ?? null,
          holders: held.map((userId) => ({ userId, name: names.get(userId) ?? null })),
          seatingId: s?.id ?? null,
          seatedAt: s?.seated_at ?? null,
          seatedBy: s?.seated_by ? { userId: s.seated_by, name: names.get(s.seated_by) ?? null } : null,
          partySize: s?.party_size ?? null,
          paidAt: s?.paid_at ?? null,
          paidSource: s?.paid_source ?? null,
          minutesSinceVisit: s ? exactMinutesSince(anchor ?? s.seated_at, now) : null,
          status,
          statusLabel: STATUS_LABEL[status],
        };
      })
      .sort((x, y) => x.label.localeCompare(y.label, "en", { numeric: true }));

    // The live board passes no last taps: every caretakerLastTapAt is null.
    const { waiters } = window
      ? this.figures(seatings, visits, hidden, house, Math.min(now, window.end))
      : { waiters: [] as ReturnType<FloorBoardService["figures"]>["waiters"] };
    const allWaiters = new Set([...waiters.map((w) => w.userId), ...statusByWaiter.keys()]);
    const waiterNames = await this.names([...allWaiters]);
    const byId = new Map(waiters.map((w) => [w.userId, w]));
    return {
      serviceDate: date,
      zoneSet: Boolean(house.zone),
      warnAfterMin: house.warnAfterMin,
      lateAfterMin: house.lateAfterMin,
      tables: rows,
      waiters: sortByScore(
        [...allWaiters].map((userId) => ({
          ...(byId.get(userId) ?? {
            gaps: 0, notClosed: 0, avgGapMin: null, onTimePct: null, overdueGaps: 0, score: null, band: null, bandLabel: null,
          }),
          id: userId,
          userId,
          name: waiterNames.get(userId) ?? null,
          // "Fresh now": the share of their seated tables not late this minute.
          liveOnTimePct: liveOnTimePct(statusByWaiter.get(userId) ?? []),
        })),
      ).map(({ id: _id, ...w }) => w),
    };
  }

  private async openSeatings(restaurantId: string) {
    const { data, error } = await this.sb
      .from("floor_seatings")
      .select("id, table_id, seated_at, seated_by, caretaker_at_seat_id, party_size, paid_at, paid_source, paid_undone_at, left_at")
      .eq("restaurant_id", restaurantId)
      .is("left_at", null);
    if (error) throw new InternalServerErrorException("The seatings could not be read.");
    return (data ?? []) as SeatingRow[];
  }

  // -------------------------------------------------------------------------
  // The shift report, its seating timeline, and the CSV
  // -------------------------------------------------------------------------

  async report(a: FloorActor, date: string | undefined, now = Date.now()) {
    const house = await readFloorHouse(this.sb, a.restaurantId);
    if (!house.zone) {
      throw new BadRequestException({
        code: "HOUSE_ZONE_NOT_SET",
        message: "The shift report is filed on the house's day, and this house has no time zone. Set it in Settings › Time zone.",
      });
    }
    const day = date ?? serviceDateOf(house.zone, now)!;
    if (!DATE_RE.test(day)) throw new BadRequestException("date must be YYYY-MM-DD");
    const window = FloorBoardService.windowOf(day, house.zone);
    const [tables, seatings] = await Promise.all([
      this.tables(a.restaurantId),
      this.seatingsIn(a.restaurantId, window.start, window.end, false),
    ]);
    const hidden = new Set(tables.filter((t) => t.hidden_at).map((t) => t.id));
    const label = new Map(tables.map((t) => [t.id, t.label]));
    const visits = await this.visitsOf(a.restaurantId, seatings.map((s) => s.id));
    const end = Math.min(now, window.end);
    const caretakers = seatings.map((s) => s.caretaker_at_seat_id ?? "");
    const lastTap = await this.lastTaps(a.restaurantId, caretakers, window.start, end);
    const { waiters, samples, notClosedUnassigned } = this.figures(seatings, visits, hidden, house, end, lastTap);
    const names = await this.names([
      ...waiters.map((w) => w.userId),
      ...seatings.map((s) => s.seated_by ?? ""),
      ...visits.map((v) => v.user_id ?? ""),
    ]);
    const visitsBySeating = new Map<string, typeof visits>();
    for (const v of visits) visitsBySeating.set(v.seating_id, [...(visitsBySeating.get(v.seating_id) ?? []), v]);
    return {
      serviceDate: day,
      window: { start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() },
      measuredTo: new Date(end).toISOString(),
      warnAfterMin: house.warnAfterMin,
      lateAfterMin: house.lateAfterMin,
      // Already in floor-core's order (sortByScore); no rank is sent.
      waiters: waiters.map((w) => ({ ...w, name: names.get(w.userId) ?? null })),
      notClosed: { total: samples.seatingsNotClosed.length, unassigned: notClosedUnassigned },
      timeline: seatings
        .sort((x, y) => (x.seated_at < y.seated_at ? -1 : 1))
        .map((s) => ({
          seatingId: s.id,
          tableId: s.table_id,
          tableLabel: label.get(s.table_id) ?? null,
          tableHidden: hidden.has(s.table_id),
          seatedAt: s.seated_at,
          seatedBy: s.seated_by ? { userId: s.seated_by, name: names.get(s.seated_by) ?? null } : null,
          partySize: s.party_size,
          paidAt: s.paid_at,
          paidSource: s.paid_source,
          leftAt: s.left_at,
          visits: (visitsBySeating.get(s.id) ?? [])
            .sort((x, y) => (x.visited_at < y.visited_at ? -1 : 1))
            .map((v) => ({ at: v.visited_at, by: v.user_id ? { userId: v.user_id, name: names.get(v.user_id) ?? null } : null })),
        })),
    };
  }

  async csv(a: FloorActor, date: string | undefined, kind: "seatings" | "waiters", now = Date.now()) {
    const r = await this.report(a, date, now);
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      // Formula-injection guard: a cell a spreadsheet would evaluate is quoted as text.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines: string[] = [];
    if (kind === "waiters") {
      lines.push("waiter,user_id,score,band,on_time_pct,avg_gap_min,gaps,overdue_gaps,not_closed");
      for (const w of r.waiters) {
        lines.push(
          [w.name, w.userId, w.score, w.bandLabel, w.onTimePct, w.avgGapMin, w.gaps, w.overdueGaps, w.notClosed].map(esc).join(","),
        );
      }
    } else {
      lines.push("table,seated_at,seated_by,party_size,visits,paid_at,paid_source,left_at,table_hidden");
      for (const s of r.timeline) {
        lines.push(
          [s.tableLabel, s.seatedAt, s.seatedBy?.name ?? "", s.partySize, s.visits.length, s.paidAt, s.paidSource, s.leftAt, s.tableHidden]
            .map(esc)
            .join(","),
        );
      }
    }
    return { filename: `floor-${kind}-${r.serviceDate}.csv`, body: lines.join("\n") + "\n" };
  }
}
