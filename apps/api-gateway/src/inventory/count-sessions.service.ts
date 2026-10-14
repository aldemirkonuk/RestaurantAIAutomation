import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "../notifications/notifications.service";
import { InventoryService } from "./inventory.service";
import { zoneLabel } from "../cellar/zones.service";
import { FACT_TIME_TRUST_MS } from "../common/fact-time";
import { STAND_IN_BOTTLE_ML } from "./stock-count-result";
import { readHouseZone } from "../common/house-day";
import {
  CountPeriodRefused,
  periodChoiceAt,
  sessionPeriodFor,
} from "./count-period";

/**
 * A stock-take walked shelf by shelf on a phone (F-1544; F-076: a 112-wine
 * cellar was 112 dialogs). Lane 1 of the phone stock count decision: the
 * session envelope -- open, pull, claim, shelf done, park, abandon.
 *
 * The founder's picks, 2026-10-12 (S224), that shape this file:
 *   F2 (a) NO APPROVAL. A session is a grouping and coverage envelope, never a
 *          hold on stock. Every count it causes goes through the existing
 *          per-item count path (`InventoryService.recordSpotCount` ->
 *          `record_stock_count`, ADR 0078's one writer) at once, as the
 *          person who counted it (the verified token, never the body).
 *   F4 (a) a phone-width web page first; these routes are what it calls.
 *
 * Tenancy: the house is the token's (ADR 0141), and every statement here is
 * scoped to it. The tables are service-role only (OD-72 / OD-73).
 *
 * Blind count: a pull names the items expected on each shelf, never how many.
 * No figure here is money, and none is a quantity the books hold.
 */

export const COUNT_SESSION_KINDS = [
  "closing",
  "month_end",
  "full",
  "opening",
] as const;
export type CountSessionKind = (typeof COUNT_SESSION_KINDS)[number];

/** A count's kind as the floor reads it (the web's `kindWords`). */
const COUNT_KIND_WORDS: Record<CountSessionKind, string> = {
  closing: "Closing count",
  month_end: "Month-end count",
  full: "Full count",
  opening: "Opening stock",
};

export interface HouseLocation {
  id: string;
  parent_id: string | null;
  is_active: boolean | null;
  display_order: number | null;
  zone: string | null;
  section: string | null;
  name: string | null;
  created_at?: string | null;
}

const LOCATION_COLUMNS =
  "id, parent_id, is_active, display_order, zone, section, name, created_at";

/** A live location: not soft-deleted (the read filters) and not switched off. */
const isLive = (l: HouseLocation) => l.is_active !== false;

/**
 * The leaf shelves of a house -- live places no live place sits inside -- in
 * walk order, optionally only those under the chosen zones. The same leaf
 * rule as the web's `shelvesFor` (SpotCountPanel.tsx, F-945 / F-1542): a zone
 * that holds other zones is never counted as a shelf, because its racks'
 * bottles would be counted against the zone's own books alone.
 *
 * Walk order is the tree's own: each level by `display_order` (unset last),
 * then by name, so Cellar > Rack A > Shelf 1, Shelf 2 come out together.
 */
export function leafShelvesInScope(
  houseLocations: HouseLocation[],
  zoneIds: string[] = [],
): HouseLocation[] {
  const live = houseLocations.filter(isLive);
  const byId = new Map(live.map((l) => [l.id, l]));
  const parentIds = new Set(
    live.map((l) => l.parent_id).filter((p): p is string => !!p),
  );
  const chain = (l: HouseLocation): HouseLocation[] => {
    const out: HouseLocation[] = [];
    const seen = new Set<string>();
    let cur: HouseLocation | undefined = l;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.unshift(cur);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return out;
  };
  const scope = new Set(zoneIds);
  const leaves = live
    .filter((l) => !parentIds.has(l.id))
    .map((l) => ({ l, path: chain(l) }))
    .filter(
      ({ path }) => scope.size === 0 || path.some((p) => scope.has(p.id)),
    );
  const key = (p: HouseLocation) => ({
    order: p.display_order ?? Number.MAX_SAFE_INTEGER,
    label: zoneLabel(p).toLocaleLowerCase(),
  });
  leaves.sort((a, b) => {
    const n = Math.min(a.path.length, b.path.length);
    for (let i = 0; i < n; i++) {
      const ka = key(a.path[i]);
      const kb = key(b.path[i]);
      if (ka.order !== kb.order) return ka.order - kb.order;
      if (ka.label !== kb.label) return ka.label < kb.label ? -1 : 1;
      if (a.path[i].id !== b.path[i].id)
        return a.path[i].id < b.path[i].id ? -1 : 1;
    }
    return a.path.length - b.path.length;
  });
  return leaves.map(({ l }) => l);
}

interface SessionRow {
  id: string;
  restaurant_id: string;
  kind: CountSessionKind;
  status: "open" | "signed_off" | "abandoned";
  opened_by: string | null;
  opened_at: string;
  signed_off_at: string | null;
  abandoned_at: string | null;
  // F-1544 lane 5 (F1 b): the month its counts are filed in, YYYY-MM; null
  // for an opening count and every session opened before lane 5.
  attributed_period: string | null;
}

interface ShelfRow {
  location_id: string;
  sort_order: number;
  claimed_by: string | null;
  claimed_at: string | null;
  done_by: string | null;
  done_at: string | null;
  // F-1544 lane 4: how many times a manager sent the shelf back, and when
  // last. A phone that sees a newer round forgets its old pass.
  recount_round: number;
  recount_asked_at: string | null;
}

const SESSION_COLUMNS =
  "id, restaurant_id, kind, status, opened_by, opened_at, signed_off_at, abandoned_at, attributed_period";
const SHELF_COLUMNS =
  "location_id, sort_order, claimed_by, claimed_at, done_by, done_at, recount_round, recount_asked_at";

/** How many ended counts the list shows (S227 owed item). */
const ENDED_SHOWN = 10;

/**
 * The places a count can be narrowed to when it is opened (S227 owed item:
 * zone choice): each live top-level place that holds at least one leaf
 * shelf, with how many, in walk order. Its id is what `open` takes as a
 * zone, so the shelves it covers are `leafShelvesInScope`'s, never a copy.
 */
export function countZonesOf(
  houseLocations: HouseLocation[],
): Array<{ id: string; name: string; shelves: number }> {
  const live = houseLocations.filter(isLive);
  const liveIds = new Set(live.map((l) => l.id));
  return live
    .filter((l) => !l.parent_id || !liveIds.has(l.parent_id))
    .map((l) => ({
      l,
      shelves: leafShelvesInScope(houseLocations, [l.id]).length,
    }))
    .filter((z) => z.shelves > 0)
    .sort(
      (a, b) =>
        (a.l.display_order ?? Number.MAX_SAFE_INTEGER) -
          (b.l.display_order ?? Number.MAX_SAFE_INTEGER) ||
        zoneLabel(a.l).localeCompare(zoneLabel(b.l)),
    )
    .map(({ l, shelves }) => ({ id: l.id, name: zoneLabel(l), shelves }));
}

/** A person may say "done" for a shelf, given who holds its claim. */
export function mayCloseShelf(
  claimedBy: string | null,
  userId: string,
  isManager: boolean,
): boolean {
  return claimedBy == null || claimedBy === userId || isManager;
}

/**
 * How long ago a queued act was taken, as the outbox sends it (F-249), read
 * the way `recordSpotCount` reads it. Returns the moment, or null for "now".
 */
export function countedMoment(
  countedAgoMs: unknown,
  now = Date.now(),
): Date | null {
  if (countedAgoMs == null) return null;
  const ms = Number(countedAgoMs);
  if (!(Number.isFinite(ms) && ms >= 0 && ms <= now)) {
    throw new HttpException(
      "The time this was done could not be read, so it was not saved. Do it again.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return new Date(now - ms);
}

@Injectable()
export class CountSessionsService {
  private readonly logger = new Logger(CountSessionsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly inventory: InventoryService,
    // F-1638: the floor is told when a count opens or a shelf is sent back.
    // Optional so the specs that build this with two arguments still do.
    @Optional()
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications?: NotificationsService,
  ) {}

  /**
   * F-1638: a team prompt to the house, on the bell and the phone. A team
   * push: Push off holds it, quiet hours do not, and each one sent inside
   * someone's quiet hours is logged (the founder's F-540 ruling, F-1340).
   * Never fails the act it follows: the count is already open, the shelf is
   * already sent back.
   */
  private async tellTheFloor(
    house: string,
    by: string,
    what: "count_opened" | "count_recount",
    payload: { title: string; message: string; actionUrl: string },
    only?: string[],
  ) {
    if (!this.notifications) return;
    try {
      // Not the person who did it (their own act), and no one outside the house.
      const others = only
        ? only.filter((id) => id !== by)
        : (await this.dbService.getRestaurantMemberIds(house)).filter(
            (id) => id !== by,
          );
      if (others.length === 0) return;
      await this.notifications.persistForRestaurant(
        house,
        {
          type: "system",
          title: payload.title,
          message: payload.message,
          priority: "medium",
          actionUrl: payload.actionUrl,
          actionLabel: "Open the count",
          metadata: { action: what },
        },
        only
          ? { onlyUserIds: others, teamPush: { what, by } }
          : // Routed (ADR 0218): someone who is Away is not called in.
            { wantedBy: others, teamPush: { what, by } },
      );
    } catch (e) {
      this.logger.warn(
        `count ${what} notice for ${house} failed: ${(e as Error)?.message}`,
      );
    }
  }

  private unreadable(what: string, err: { message?: string }) {
    this.logger.error(`count session ${what} failed: ${err.message}`);
    return new HttpException(
      "The count could not be read just now. Try again in a moment.",
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private async session(house: string, sessionId: string): Promise<SessionRow> {
    const { data, error } = await this.dbService
      .getClient()
      .from("stock_count_sessions")
      .select(SESSION_COLUMNS)
      .eq("restaurant_id", house)
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw this.unreadable("session read", error);
    if (!data) {
      throw new HttpException(
        "That count is not one of this house's.",
        HttpStatus.NOT_FOUND,
      );
    }
    return data as SessionRow;
  }

  private async shelf(
    house: string,
    sessionId: string,
    locationId: string,
  ): Promise<ShelfRow> {
    const { data, error } = await this.dbService
      .getClient()
      .from("stock_count_session_shelves")
      .select(SHELF_COLUMNS)
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .eq("location_id", locationId)
      .maybeSingle();
    if (error) throw this.unreadable("shelf read", error);
    if (!data) {
      throw new HttpException(
        "That shelf is not part of this count.",
        HttpStatus.NOT_FOUND,
      );
    }
    return data as ShelfRow;
  }

  private async houseLocations(house: string): Promise<HouseLocation[]> {
    const { data, error } = await this.dbService
      .getClient()
      .from("storage_locations")
      .select(LOCATION_COLUMNS)
      .eq("restaurant_id", house)
      .is("deleted_at", null);
    if (error) throw this.unreadable("shelves read", error);
    return (data ?? []) as HouseLocation[];
  }

  private async personNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const want = [...new Set(ids.filter(Boolean))];
    if (want.length === 0) return out;
    const { data, error } = await this.dbService
      .getClient()
      .from("users")
      .select("user_id, name")
      .in("user_id", want);
    if (error) throw this.unreadable("people read", error);
    for (const r of (data ?? []) as Array<{
      user_id: string;
      name: string | null;
    }>) {
      if (r.name?.trim()) out.set(r.user_id, r.name.trim());
    }
    return out;
  }

  /**
   * The months a count opened now may be for (F-1544 lane 5, F1 b): this
   * month, and the month that just ended while within its 6 hours. Null when
   * the house names no time zone (its counts are then filed by their moment).
   */
  private async periodChoice(house: string) {
    let zone: string | null;
    try {
      ({ zone } = await readHouseZone(this.dbService.getClient(), house));
    } catch (e) {
      throw this.unreadable("house zone read", e as { message?: string });
    }
    return zone ? periodChoiceAt(new Date(), zone) : null;
  }

  /** The house's open counts, newest first, with how many shelves are done. */
  async listOpen(house: string) {
    const client = this.dbService.getClient();
    const periods = await this.periodChoice(house);
    const zones = countZonesOf(await this.houseLocations(house));
    const ended = await this.listEnded(house);
    const { data, error } = await client
      .from("stock_count_sessions")
      .select(SESSION_COLUMNS)
      .eq("restaurant_id", house)
      .eq("status", "open")
      .order("opened_at", { ascending: false });
    if (error) throw this.unreadable("sessions read", error);
    const sessions = (data ?? []) as SessionRow[];
    if (sessions.length === 0) return { sessions: [], periods, zones, ended };
    const shelves = await client
      .from("stock_count_session_shelves")
      .select("session_id, done_at")
      .eq("restaurant_id", house)
      .in(
        "session_id",
        sessions.map((s) => s.id),
      );
    if (shelves.error) throw this.unreadable("shelves read", shelves.error);
    const tally = new Map<string, { shelves: number; done: number }>();
    for (const r of (shelves.data ?? []) as Array<{
      session_id: string;
      done_at: string | null;
    }>) {
      const t = tally.get(r.session_id) ?? { shelves: 0, done: 0 };
      t.shelves += 1;
      if (r.done_at) t.done += 1;
      tally.set(r.session_id, t);
    }
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        kind: s.kind,
        status: s.status,
        openedAt: s.opened_at,
        period: s.attributed_period ?? null,
        shelves: tally.get(s.id)?.shelves ?? 0,
        shelvesDone: tally.get(s.id)?.done ?? 0,
      })),
      periods,
      zones,
      ended,
    };
  }

  /**
   * The house's last ended counts, newest first (S227 owed item): when each
   * ended, the month it is filed in, and who signed it off or stopped it, so
   * a finished count can be found again after it leaves the open list.
   */
  private async listEnded(house: string) {
    const { data, error } = await this.dbService
      .getClient()
      .from("stock_count_sessions")
      .select(
        "id, kind, status, opened_at, signed_off_at, signed_off_by, abandoned_at, abandoned_by, attributed_period",
      )
      .eq("restaurant_id", house)
      .in("status", ["signed_off", "abandoned"])
      .order("opened_at", { ascending: false })
      .limit(ENDED_SHOWN);
    if (error) throw this.unreadable("ended counts read", error);
    const rows = (
      (data ?? []) as Array<
        SessionRow & {
          signed_off_by: string | null;
          abandoned_by: string | null;
        }
      >
    ).slice(0, ENDED_SHOWN);
    const people = await this.personNames(
      rows.map((r) => r.signed_off_by ?? r.abandoned_by ?? ""),
    );
    return rows.map((r) => {
      const by = r.status === "signed_off" ? r.signed_off_by : r.abandoned_by;
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        openedAt: r.opened_at,
        endedAt:
          (r.status === "signed_off" ? r.signed_off_at : r.abandoned_at) ??
          null,
        endedBy: by ? (people.get(by) ?? "Someone") : null,
        period: r.attributed_period ?? null,
      };
    });
  }

  /**
   * Opens a count over the leaf shelves under the chosen zones (all of the
   * house's leaf shelves when none are chosen). The caller has checked the
   * person is an owner or a manager (ADR 0238 / 0334). `openKey` makes a
   * double tap or a retry open one count, not two.
   *
   * F-1544 lane 5 (F1 b): `period` (YYYY-MM) is the month its counts are
   * filed in -- this month, or last month only within 6 hours after it ended
   * (`sessionPeriodFor`). Not named: this month. A replayed open keeps the
   * period it was opened with.
   */
  async open(
    house: string,
    userId: string,
    dto: {
      kind?: unknown;
      zoneIds?: unknown;
      openKey?: unknown;
      period?: unknown;
    },
  ) {
    const kind = dto?.kind as CountSessionKind;
    if (!COUNT_SESSION_KINDS.includes(kind)) {
      throw new HttpException(
        "Say which count this is: closing, month end, full or opening.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const zoneIds = Array.isArray(dto?.zoneIds)
      ? [
          ...new Set(
            dto.zoneIds.filter((z): z is string => typeof z === "string"),
          ),
        ]
      : [];
    const openKey =
      typeof dto?.openKey === "string" && dto.openKey.trim()
        ? dto.openKey.trim()
        : null;
    const client = this.dbService.getClient();

    if (openKey) {
      const seen = await client
        .from("stock_count_sessions")
        .select("id")
        .eq("restaurant_id", house)
        .eq("open_key", openKey)
        .maybeSingle();
      if (seen.error) throw this.unreadable("open replay read", seen.error);
      if (seen.data)
        return this.pull(house, (seen.data as { id: string }).id, userId);
    }

    const locations = await this.houseLocations(house);
    const known = new Set(locations.filter(isLive).map((l) => l.id));
    if (zoneIds.some((z) => !known.has(z))) {
      throw new HttpException(
        "One of the places chosen is not one of this house's. Nothing was opened.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const shelves = leafShelvesInScope(locations, zoneIds);
    if (shelves.length === 0) {
      throw new HttpException(
        "There are no shelves to count there. Add the house's shelves first. Nothing was opened.",
        HttpStatus.BAD_REQUEST,
      );
    }

    let attributedPeriod: string | null;
    try {
      const { zone } = await readHouseZone(client, house);
      attributedPeriod = sessionPeriodFor(dto?.period, kind, new Date(), zone);
    } catch (e) {
      if (e instanceof CountPeriodRefused)
        throw new HttpException(
          `${e.message} Nothing was opened.`,
          HttpStatus.BAD_REQUEST,
        );
      throw this.unreadable("house zone read", e as { message?: string });
    }

    const made = await client
      .from("stock_count_sessions")
      .insert({
        restaurant_id: house,
        kind,
        opened_by: userId,
        open_key: openKey,
        attributed_period: attributedPeriod,
      })
      .select("id")
      .single();
    if (made.error) {
      // A retry that raced the first: the first one's count is this one.
      if ((made.error as { code?: string }).code === "23505" && openKey) {
        const again = await client
          .from("stock_count_sessions")
          .select("id")
          .eq("restaurant_id", house)
          .eq("open_key", openKey)
          .maybeSingle();
        if (again.error) throw this.unreadable("open replay read", again.error);
        if (again.data)
          return this.pull(house, (again.data as { id: string }).id, userId);
      }
      this.logger.error(`count session open failed: ${made.error.message}`);
      throw new HttpException(
        "The count could not be opened just now. Nothing was opened. Try again.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const sessionId = (made.data as { id: string }).id;
    const rows = shelves.map((l, i) => ({
      session_id: sessionId,
      restaurant_id: house,
      location_id: l.id,
      sort_order: i,
    }));
    const placed = await client
      .from("stock_count_session_shelves")
      .insert(rows);
    if (placed.error) {
      // A count with no shelves would read as "nothing to count". It was
      // made a moment ago and nothing references it yet, so it is removed.
      this.logger.error(
        `count session shelves failed: ${placed.error.message}`,
      );
      const undo = await client
        .from("stock_count_sessions")
        .delete()
        .eq("restaurant_id", house)
        .eq("id", sessionId);
      if (undo.error) {
        this.logger.error(
          `count session ${sessionId} left with no shelves: ${undo.error.message}`,
        );
      }
      throw new HttpException(
        "The count could not be opened just now. Nothing was opened. Try again.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    // An opening count takes lines from owners and managers only (ADR 0335
    // §3), so the floor is not called to it.
    if (kind !== "opening")
      await this.tellTheFloor(house, userId, "count_opened", {
        title: "A stock count is open",
        message: `${COUNT_KIND_WORDS[kind]}: ${shelves.length} ${shelves.length === 1 ? "shelf" : "shelves"} to count. Take a shelf when you can.`,
        actionUrl: `/count/${sessionId}`,
      });
    return this.pull(house, sessionId, userId);
  }

  /**
   * What a phone takes before the walk: the shelves in walk order, who is on
   * each, which are done, and the items expected on each -- never how many
   * (blind count). An item that also has bottles on the books with no shelf,
   * or on a zone that holds other zones, is marked: a shelf count of it would
   * book those bottles a second time (F-945), so it is counted as a whole.
   */
  async pull(house: string, sessionId: string, userId: string) {
    const client = this.dbService.getClient();
    const session = await this.session(house, sessionId);
    const shelvesRead = await client
      .from("stock_count_session_shelves")
      .select(SHELF_COLUMNS)
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .order("sort_order", { ascending: true });
    if (shelvesRead.error)
      throw this.unreadable("shelves read", shelvesRead.error);
    const shelves = (shelvesRead.data ?? []) as ShelfRow[];
    const shelfIds = shelves.map((s) => s.location_id);

    const label = new Map<string, string>();
    const expected = new Map<string, Set<string>>();
    let lotRows: Array<{
      inventory_id: string;
      location_id: string;
      qty: number | null;
      open_bottle_ml: number | null;
    }> = [];
    if (shelfIds.length) {
      // Names for every shelf, including one deleted since the count opened.
      const names = await client
        .from("storage_locations")
        .select("id, zone, section, name")
        .eq("restaurant_id", house)
        .in("id", shelfIds);
      if (names.error) throw this.unreadable("shelf names read", names.error);
      for (const l of (names.data ?? []) as HouseLocation[]) {
        label.set(l.id, zoneLabel(l));
      }
      const onShelves = await client
        .from("inventory_lots")
        .select("inventory_id, location_id, qty, open_bottle_ml")
        .eq("restaurant_id", house)
        .eq("stock_state", "live")
        .in("location_id", shelfIds);
      if (onShelves.error) {
        throw this.unreadable("shelf stock read", onShelves.error);
      }
      lotRows = (onShelves.data ?? []) as typeof lotRows;
    }
    for (const l of lotRows as Array<{
      inventory_id: string;
      location_id: string;
      qty: number | null;
      open_bottle_ml: number | null;
    }>) {
      if (!((l.qty ?? 0) > 0 || (l.open_bottle_ml ?? 0) > 0)) continue;
      const set = expected.get(l.location_id) ?? new Set<string>();
      set.add(l.inventory_id);
      expected.set(l.location_id, set);
    }
    const itemIds = [...new Set([...expected.values()].flatMap((s) => [...s]))];

    const items = await this.itemNames(house, itemIds);
    const wholeOnly = await this.itemsCountedWhole(house, itemIds);
    const people = await this.personNames(
      shelves.flatMap((s) => [s.claimed_by ?? "", s.done_by ?? ""]),
    );

    return {
      id: session.id,
      kind: session.kind,
      status: session.status,
      openedAt: session.opened_at,
      period: session.attributed_period ?? null,
      shelves: shelves.map((s) => ({
        locationId: s.location_id,
        name: label.get(s.location_id) ?? "A shelf no longer in use",
        order: s.sort_order,
        claimedByMe: s.claimed_by === userId,
        claimedBy: s.claimed_by
          ? (people.get(s.claimed_by) ?? "Someone")
          : null,
        claimedAt: s.claimed_at,
        done: s.done_at != null,
        doneAt: s.done_at,
        doneBy: s.done_by ? (people.get(s.done_by) ?? "Someone") : null,
        round: s.recount_round ?? 0,
        recountAskedAt: s.recount_asked_at,
        items: [...(expected.get(s.location_id) ?? [])]
          .map((id) => ({
            inventoryId: id,
            ...(items.get(id) ?? {
              name: "An item with no name",
              producer: "",
              vintage: null,
            }),
            countWhole: wholeOnly.has(id),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
    };
  }

  private async itemNames(house: string, itemIds: string[]) {
    const out = new Map<
      string,
      { name: string; producer: string; vintage: string | null }
    >();
    if (itemIds.length === 0) return out;
    const client = this.dbService.getClient();
    const rows = await client
      .from("restaurant_inventory")
      .select("id, display_name, wine_name, master_wine_id")
      .eq("restaurant_id", house)
      .in("id", itemIds);
    if (rows.error) throw this.unreadable("item names read", rows.error);
    const list = (rows.data ?? []) as Array<{
      id: string;
      display_name: string | null;
      wine_name: string | null;
      master_wine_id: string | null;
    }>;
    const wineIds = [
      ...new Set(
        list.map((r) => r.master_wine_id).filter((w): w is string => !!w),
      ),
    ];
    const wines = new Map<
      string,
      { name: string; producer: string; vintage: string | null }
    >();
    if (wineIds.length) {
      const w = await client
        .from("master_wine_library")
        .select("id, wine_name, name, producer, vintage")
        .in("id", wineIds);
      if (w.error) throw this.unreadable("wine names read", w.error);
      for (const r of (w.data ?? []) as Array<Record<string, unknown>>) {
        wines.set(r.id as string, {
          name: ((r.wine_name as string) || (r.name as string) || "").trim(),
          producer: ((r.producer as string) || "").trim(),
          vintage: r.vintage == null ? null : String(r.vintage),
        });
      }
    }
    for (const r of list) {
      const wine = r.master_wine_id ? wines.get(r.master_wine_id) : undefined;
      out.set(r.id, {
        name:
          r.display_name?.trim() ||
          r.wine_name?.trim() ||
          wine?.name ||
          "An item with no name",
        producer: wine?.producer ?? "",
        vintage: wine?.vintage ?? null,
      });
    }
    return out;
  }

  /** Items with live bottles on no shelf, or on a zone that holds zones (F-945). */
  private async itemsCountedWhole(house: string, itemIds: string[]) {
    const out = new Set<string>();
    if (itemIds.length === 0) return out;
    const locations = await this.houseLocations(house);
    const parentIds = new Set(
      locations
        .filter(isLive)
        .map((l) => l.parent_id)
        .filter((p): p is string => !!p),
    );
    const lots = await this.dbService
      .getClient()
      .from("inventory_lots")
      .select("inventory_id, location_id, qty")
      .eq("restaurant_id", house)
      .eq("stock_state", "live")
      .in("inventory_id", itemIds);
    if (lots.error) throw this.unreadable("item stock read", lots.error);
    for (const l of (lots.data ?? []) as Array<{
      inventory_id: string;
      location_id: string | null;
      qty: number | null;
    }>) {
      if (
        (l.qty ?? 0) > 0 &&
        (!l.location_id || parentIds.has(l.location_id))
      ) {
        out.add(l.inventory_id);
      }
    }
    return out;
  }

  /**
   * Takes a shelf for this person while there is signal. A shelf someone else
   * holds is refused with their name; an owner or a manager may take it over
   * (a phone that died with the claim). Claiming again is a no-op.
   */
  async claim(
    house: string,
    sessionId: string,
    locationId: string,
    userId: string,
    opts: { takeOver?: boolean; isManager: () => Promise<boolean> },
  ) {
    const session = await this.session(house, sessionId);
    if (session.status !== "open") {
      throw new HttpException(
        "This count has ended, so its shelves cannot be taken.",
        HttpStatus.CONFLICT,
      );
    }
    const shelf = await this.shelf(house, sessionId, locationId);
    if (shelf.claimed_by === userId) {
      return { locationId, claimedByMe: true, claimedAt: shelf.claimed_at };
    }
    if (shelf.claimed_by && !(opts.takeOver && (await opts.isManager()))) {
      const who = (await this.personNames([shelf.claimed_by])).get(
        shelf.claimed_by,
      );
      throw new HttpException(
        `${who ?? "Someone else"} is counting this shelf. Pick another one.`,
        HttpStatus.CONFLICT,
      );
    }
    const claimedAt = new Date().toISOString();
    let q = this.dbService
      .getClient()
      .from("stock_count_session_shelves")
      .update({ claimed_by: userId, claimed_at: claimedAt })
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .eq("location_id", locationId);
    // Only over the claim this decision was made on: a claim taken in the
    // meantime is not overwritten.
    q = shelf.claimed_by
      ? q.eq("claimed_by", shelf.claimed_by)
      : q.is("claimed_by", null);
    const { data, error } = await q.select("location_id");
    if (error) throw this.unreadable("claim", error);
    if (!data || (data as unknown[]).length === 0) {
      throw new HttpException(
        "Someone else took this shelf a moment ago. Pick another one.",
        HttpStatus.CONFLICT,
      );
    }
    return { locationId, claimedByMe: true, claimedAt };
  }

  /**
   * "Shelf done": the counter has confirmed the expected items they did not
   * find (`zeroItemIds`). Each is posted as a count of 0 for this shelf
   * through the existing per-item count path, as this person, at the moment
   * it was done -- so a stale offline "done" is refused like any stale count
   * (F-249 / F-880) and comes back as "count this shelf again". The shelf is
   * marked done only when every zero landed. A retry replays: each zero's key
   * is `count:<item>:shelf-done:<clientDoneId>`.
   *
   * Accepted on an ended count too: an offline change is never dropped for
   * arriving late (ADR 0241); review lists it as arriving after sign-off.
   */
  async shelfDone(
    house: string,
    sessionId: string,
    locationId: string,
    userId: string,
    dto: {
      clientDoneId?: unknown;
      zeroItemIds?: unknown;
      countedAgoMs?: unknown;
    },
    isManager: () => Promise<boolean>,
  ) {
    const clientDoneId =
      typeof dto?.clientDoneId === "string" ? dto.clientDoneId.trim() : "";
    if (!clientDoneId) {
      throw new HttpException(
        "clientDoneId is required (made on the phone, so a retry is not counted twice).",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      dto?.zeroItemIds != null &&
      !(
        Array.isArray(dto.zeroItemIds) &&
        dto.zeroItemIds.every((z) => typeof z === "string")
      )
    ) {
      throw new HttpException(
        "The items not found could not be read, so the shelf was not closed.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const zeroItemIds = [
      ...new Set((dto?.zeroItemIds as string[] | undefined) ?? []),
    ];
    const at = countedMoment(dto?.countedAgoMs);

    const session = await this.session(house, sessionId);
    const shelf = await this.shelf(house, sessionId, locationId);
    // F-1544 lane 4: a "done" from before a manager sent the shelf back is
    // the old pass. It posts no zeros and does not close the shelf again.
    if (
      shelf.recount_asked_at &&
      (at ?? new Date()).getTime() < Date.parse(shelf.recount_asked_at)
    ) {
      return {
        locationId,
        done: false,
        posted: [] as string[],
        held: [] as string[],
        refused: [] as Array<{ inventoryId: string; reason: string }>,
        skipped: [] as Array<{ inventoryId: string; name: string }>,
        sessionStatus: session.status,
        round: shelf.recount_round,
        message: "A manager asked for this shelf to be counted again.",
      };
    }
    const heldByAnother = !!shelf.claimed_by && shelf.claimed_by !== userId;
    const manager =
      session.kind === "opening" || heldByAnother ? await isManager() : false;
    if (session.kind === "opening" && !manager) {
      throw new HttpException(
        "Only an owner or a manager loads opening stock. The shelf was not closed.",
        HttpStatus.FORBIDDEN,
      );
    }
    if (!mayCloseShelf(shelf.claimed_by, userId, manager)) {
      const who = (await this.personNames([shelf.claimed_by as string])).get(
        shelf.claimed_by as string,
      );
      throw new HttpException(
        `${who ?? "Someone else"} is counting this shelf, so it was not closed.`,
        HttpStatus.CONFLICT,
      );
    }

    // The key recordSpotCount gives each zero (count:<item>:<clientCountId>).
    const clientCountId = `shelf-done:${clientDoneId}`;
    let offBooks: string[] = [];
    if (zeroItemIds.length) {
      // A zero that already landed under this act's key is a replay: the
      // shelf's books for it may read 0 now BECAUSE it landed, and refusing
      // it would turn a retried "done" into a failure (ADR 0241).
      const landedRead = await this.dbService
        .getClient()
        .from("stock_counts")
        .select("inventory_id")
        .eq("restaurant_id", house)
        .in(
          "idempotency_key",
          zeroItemIds.map((id) => `count:${id}:${clientCountId}`),
        );
      if (landedRead.error) {
        throw this.unreadable("replay read", landedRead.error);
      }
      const landed = new Set(
        ((landedRead.data ?? []) as Array<{ inventory_id: string }>).map(
          (r) => r.inventory_id,
        ),
      );
      const onShelf = await this.dbService
        .getClient()
        .from("inventory_lots")
        .select("inventory_id, qty, open_bottle_ml")
        .eq("restaurant_id", house)
        .eq("stock_state", "live")
        .eq("location_id", locationId)
        .in("inventory_id", zeroItemIds);
      if (onShelf.error)
        throw this.unreadable("shelf stock read", onShelf.error);
      const expected = new Set(
        (
          (onShelf.data ?? []) as Array<{
            inventory_id: string;
            qty: number | null;
            open_bottle_ml: number | null;
          }>
        )
          .filter((l) => (l.qty ?? 0) > 0 || (l.open_bottle_ml ?? 0) > 0)
          .map((l) => l.inventory_id),
      );
      // F-1616: an item the books no longer hold here (its last bottle sold
      // after the phone pulled the list, or another phone zeroed it) already
      // reads 0, so "not found" agrees with the books. It is not counted and
      // is named back; the rest of the shelf still closes. Refusing the whole
      // act left the shelf refused for good, since the phone resends its list.
      offBooks = zeroItemIds.filter(
        (id) => !expected.has(id) && !landed.has(id),
      );
    }
    const toZero = zeroItemIds.filter((id) => !offBooks.includes(id));
    const skipped: Array<{ inventoryId: string; name: string }> = [];
    if (offBooks.length) {
      // House-scoped: an id of another house gets no name, only the plain words.
      const names = await this.itemNames(house, offBooks);
      for (const id of offBooks) {
        skipped.push({
          inventoryId: id,
          name: names.get(id)?.name ?? "An item not on this shelf",
        });
      }
    }
    const skippedWords = skipped.length
      ? `Not counted, no longer on this shelf's books: ${skipped.map((x) => x.name).join(", ")}.`
      : undefined;

    // ADR 0286: a "done" taken more than 72 h ago is kept only on an owner's
    // or a manager's word (recordSpotCount refuses it otherwise). Asked only
    // then, so an ordinary "done" costs no role read.
    const tooOldForStaff =
      dto?.countedAgoMs != null &&
      Number(dto.countedAgoMs) > FACT_TIME_TRUST_MS;
    const role =
      tooOldForStaff && (manager || (await isManager())) ? "manager" : null;

    const posted: string[] = [];
    const held: string[] = [];
    const refused: Array<{ inventoryId: string; reason: string }> = [];
    for (const inventoryId of toZero) {
      try {
        const out = await this.inventory.recordSpotCount(house, inventoryId, {
          countedQty: 0,
          stockState: "live",
          clientCountId,
          reason: "Shelf done: not on the shelf",
          performedBy: userId,
          locationId,
          opening: session.kind === "opening",
          ...(dto?.countedAgoMs != null
            ? { countedAgoMs: Number(dto.countedAgoMs) }
            : {}),
          // F-1544 lane 2: a line of this walk, and "not on the shelf"
          // means no open bottle either, so an item there only as an open
          // bottle does not stay on the books (F3 a).
          sessionId,
          openMl: 0,
          role,
        });
        // A zero for an item this walk already counted on this shelf is held
        // for the manager (F2 a), not posted.
        if (out?.count?.held) held.push(inventoryId);
        else posted.push(inventoryId);
      } catch (e) {
        // A count the stock overtook, or one the writer refused: that item is
        // counted again. Anything else (the database away) is the house's,
        // and the phone keeps the whole act to try again; the zeros that
        // landed replay by key.
        const status = e instanceof HttpException ? e.getStatus() : 0;
        if (
          status === HttpStatus.CONFLICT ||
          status === HttpStatus.BAD_REQUEST
        ) {
          refused.push({
            inventoryId,
            reason:
              e instanceof HttpException
                ? String(e.message)
                : "Count it again.",
          });
          continue;
        }
        throw e;
      }
    }
    if (refused.length) {
      return {
        locationId,
        done: false,
        posted,
        held,
        refused,
        skipped,
        sessionStatus: session.status,
        message: [
          "Count this shelf again: some bottles moved after it was counted.",
          skippedWords,
        ]
          .filter(Boolean)
          .join(" "),
      };
    }

    const doneAt = (at ?? new Date()).toISOString();
    const { data, error } = await this.dbService
      .getClient()
      .from("stock_count_session_shelves")
      .update({
        done_by: userId,
        done_at: doneAt,
        // An unclaimed shelf is claimed by whoever finished it. A claimed one
        // keeps its claim: an undefined key is left out of the request body,
        // so the columns are not written. Named keys rather than a spread, so
        // the capture-contract guard can read every column this writes.
        claimed_by: shelf.claimed_by ? undefined : userId,
        claimed_at: shelf.claimed_by ? undefined : doneAt,
      })
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .eq("location_id", locationId)
      // A late replay never moves "done" back in time.
      .or(`done_at.is.null,done_at.lt."${doneAt}"`)
      .select("location_id");
    if (error) throw this.unreadable("shelf done", error);
    return {
      locationId,
      done: true,
      posted,
      held,
      refused,
      skipped,
      sessionStatus: session.status,
      replayed: !data || (data as unknown[]).length === 0,
      ...(skippedWords ? { message: skippedWords } : {}),
    };
  }

  /**
   * An item found that the house does not carry. Parked for review: nothing
   * is created, no stock moves. Parked once per `clientLineId`.
   */
  async park(
    house: string,
    sessionId: string,
    userId: string,
    dto: {
      clientLineId?: unknown;
      locationId?: unknown;
      description?: unknown;
      countedQty?: unknown;
      countedAgoMs?: unknown;
    },
  ) {
    const clientLineId =
      typeof dto?.clientLineId === "string" ? dto.clientLineId.trim() : "";
    const description =
      typeof dto?.description === "string" ? dto.description.trim() : "";
    const qty = Number(dto?.countedQty);
    if (!clientLineId) {
      throw new HttpException(
        "clientLineId is required (made on the phone, so a retry is not parked twice).",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!description) {
      throw new HttpException(
        "Write what the label says, so a manager can find it.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!(Number.isInteger(qty) && qty >= 0)) {
      throw new HttpException(
        "Say how many bottles, as a whole number.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const locationId =
      typeof dto?.locationId === "string" ? dto.locationId : "";
    const at = countedMoment(dto?.countedAgoMs) ?? new Date();
    await this.session(house, sessionId);
    await this.shelf(house, sessionId, locationId);

    const client = this.dbService.getClient();
    const put = await client.from("stock_count_parked_lines").upsert(
      {
        session_id: sessionId,
        restaurant_id: house,
        location_id: locationId,
        description: description.slice(0, 500),
        counted_qty: qty,
        counted_by: userId,
        counted_at: at.toISOString(),
        client_line_id: clientLineId,
      },
      { onConflict: "restaurant_id,client_line_id", ignoreDuplicates: true },
    );
    if (put.error) throw this.unreadable("park", put.error);
    const back = await client
      .from("stock_count_parked_lines")
      .select("id, session_id, state")
      .eq("restaurant_id", house)
      .eq("client_line_id", clientLineId)
      .maybeSingle();
    if (back.error) throw this.unreadable("park read", back.error);
    if (!back.data)
      throw this.unreadable("park read", {
        message: "row not found after upsert",
      });
    const row = back.data as { id: string; session_id: string; state: string };
    return { id: row.id, sessionId: row.session_id, state: row.state };
  }

  /**
   * Stops a count. The counts it already caused stay: each was a count in its
   * own right the moment it posted (ADR 0078, F2 a). The caller has checked
   * the person is an owner or a manager. Abandoning twice is a no-op.
   */
  async abandon(house: string, sessionId: string, userId: string) {
    const { data, error } = await this.dbService
      .getClient()
      .from("stock_count_sessions")
      .update({
        status: "abandoned",
        abandoned_by: userId,
        abandoned_at: new Date().toISOString(),
      })
      .eq("restaurant_id", house)
      .eq("id", sessionId)
      .eq("status", "open")
      .select("id, status, abandoned_at");
    if (error) throw this.unreadable("abandon", error);
    const row = (
      (data ?? []) as Array<{
        id: string;
        status: string;
        abandoned_at: string;
      }>
    )[0];
    if (row)
      return { id: row.id, status: row.status, abandonedAt: row.abandoned_at };
    const session = await this.session(house, sessionId);
    if (session.status === "abandoned") {
      return {
        id: session.id,
        status: session.status,
        abandonedAt: session.abandoned_at,
      };
    }
    throw new HttpException(
      "This count was signed off, so it cannot be stopped.",
      HttpStatus.CONFLICT,
    );
  }

  // ---------------------------------------------------------------------
  // F-1544 lane 4: the review. A manager reads the walk shelf by shelf,
  // settles what it could not settle by itself (a shelf counted twice, an
  // item the house does not carry), sends a shelf back, and signs it off.
  // Every count was posted the moment it arrived (F2 a); nothing here
  // approves one.
  // ---------------------------------------------------------------------

  /** Every row of a read, page by page (PostgREST stops at 1,000, F-293). */
  private async everyRow<T>(
    what: string,
    page: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  ): Promise<T[]> {
    const size = 1000;
    const out: T[] = [];
    for (let from = 0; ; from += size) {
      const { data, error } = await page(from, from + size - 1);
      if (error) throw this.unreadable(what, error);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < size) return out;
    }
  }

  /**
   * The walk, for the review page. `seesMoney` (an owner or a manager, read
   * by the caller) adds what the books expected, the difference and its
   * value; anyone else sees what was counted, never the books (a blind
   * count, DASH-G6).
   */
  async review(
    house: string,
    sessionId: string,
    seesMoney: boolean,
  ): Promise<CountReview> {
    const client = this.dbService.getClient();
    const session = await this.session(house, sessionId);
    const signed = await client
      .from("stock_count_sessions")
      .select("signed_off_by")
      .eq("restaurant_id", house)
      .eq("id", sessionId)
      .maybeSingle();
    if (signed.error) throw this.unreadable("sign-off read", signed.error);
    const signedOffBy =
      (signed.data as { signed_off_by?: string | null } | null)
        ?.signed_off_by ?? null;

    const shelvesRead = await client
      .from("stock_count_session_shelves")
      .select(SHELF_COLUMNS)
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .order("sort_order", { ascending: true });
    if (shelvesRead.error)
      throw this.unreadable("shelves read", shelvesRead.error);
    const shelves = (shelvesRead.data ?? []) as ShelfRow[];
    const shelfIds = shelves.map((s) => s.location_id);

    const counts = await this.everyRow<ReviewCountRow>("lines read", (f, t) =>
      client
        .from("stock_counts")
        .select(
          "id, inventory_id, location_id, counted_qty, expected_qty, variance_qty, counted_open_ml, expected_open_ml, counted_by, counted_at, arrived_at",
        )
        .eq("restaurant_id", house)
        .eq("session_id", sessionId)
        .order("id", { ascending: true })
        .range(f, t),
    );
    const heldRead = await client
      .from("stock_count_held_lines")
      .select(
        "id, inventory_id, location_id, counted_qty, counted_open_ml, counted_by, counted_at, held_against, state",
      )
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .eq("state", "held")
      .order("counted_at", { ascending: true });
    if (heldRead.error) throw this.unreadable("held read", heldRead.error);
    const held = (heldRead.data ?? []) as Array<{
      id: string;
      inventory_id: string;
      location_id: string | null;
      counted_qty: number;
      counted_open_ml: number | null;
      counted_by: string | null;
      counted_at: string;
      held_against: string | null;
    }>;
    const parkedRead = await client
      .from("stock_count_parked_lines")
      .select(
        "id, location_id, description, counted_qty, counted_by, counted_at",
      )
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .eq("state", "parked")
      .order("counted_at", { ascending: true });
    if (parkedRead.error)
      throw this.unreadable("parked read", parkedRead.error);
    const parked = (parkedRead.data ?? []) as Array<{
      id: string;
      location_id: string;
      description: string;
      counted_qty: number;
      counted_by: string | null;
      counted_at: string;
    }>;

    // What is on the books on a done shelf with no line from this walk: a
    // line the phone could not send (refused, or never sent). Refusals are
    // not kept on the server, so this is how the review sees them.
    const done = new Set(
      shelves.filter((s) => s.done_at).map((s) => s.location_id),
    );
    const lots = done.size
      ? await this.everyRow<{
          inventory_id: string;
          location_id: string;
          qty: number | null;
          open_bottle_ml: number | null;
        }>("shelf stock read", (f, t) =>
          client
            .from("inventory_lots")
            .select("id, inventory_id, location_id, qty, open_bottle_ml")
            .eq("restaurant_id", house)
            .eq("stock_state", "live")
            .in("location_id", [...done])
            .order("id", { ascending: true })
            .range(f, t),
        )
      : [];
    const countedHere = new Set(
      counts.map((c) => `${c.inventory_id}|${c.location_id ?? ""}`),
    );
    const missed = new Map<string, Set<string>>();
    for (const l of lots) {
      if (!((l.qty ?? 0) > 0 || (l.open_bottle_ml ?? 0) > 0)) continue;
      if (countedHere.has(`${l.inventory_id}|${l.location_id}`)) continue;
      const set = missed.get(l.location_id) ?? new Set<string>();
      set.add(l.inventory_id);
      missed.set(l.location_id, set);
    }
    // F-1618: an item counted whole (F-945) is one the walk told staff not
    // to count on a shelf ("Count it on Inventory, all at once"), and that
    // count carries no session. Its shelf bottles are not a line the phone
    // failed to send, so they are not listed as one.
    const wholeOnly = await this.itemsCountedWhole(house, [
      ...new Set([...missed.values()].flatMap((s) => [...s])),
    ]);
    for (const [shelfId, set] of missed) {
      for (const id of wholeOnly) set.delete(id);
      if (set.size === 0) missed.delete(shelfId);
    }

    const heldAgainstIds = held
      .map((h) => h.held_against)
      .filter((x): x is string => !!x);
    const against = new Map<string, ReviewCountRow>();
    for (const c of counts) against.set(c.id, c);
    const missingAgainst = heldAgainstIds.filter((id) => !against.has(id));
    if (missingAgainst.length) {
      const more = await client
        .from("stock_counts")
        .select(
          "id, inventory_id, location_id, counted_qty, expected_qty, variance_qty, counted_open_ml, expected_open_ml, counted_by, counted_at, arrived_at",
        )
        .eq("restaurant_id", house)
        .in("id", missingAgainst);
      if (more.error) throw this.unreadable("held-against read", more.error);
      for (const c of (more.data ?? []) as ReviewCountRow[])
        against.set(c.id, c);
    }

    const itemIds = [
      ...new Set([
        ...counts.map((c) => c.inventory_id),
        ...held.map((h) => h.inventory_id),
        ...[...missed.values()].flatMap((s) => [...s]),
      ]),
    ];
    const names = await this.itemNames(house, itemIds);
    const nameOf = (id: string) =>
      names.get(id)?.name ?? "An item with no name";

    const placeIds = [
      ...new Set([
        ...shelfIds,
        ...counts.map((c) => c.location_id ?? ""),
        ...held.map((h) => h.location_id ?? ""),
      ]),
    ].filter(Boolean);
    const label = new Map<string, string>();
    if (placeIds.length) {
      const where = await client
        .from("storage_locations")
        .select("id, zone, section, name")
        .eq("restaurant_id", house)
        .in("id", placeIds);
      if (where.error) throw this.unreadable("shelf names read", where.error);
      for (const l of (where.data ?? []) as HouseLocation[])
        label.set(l.id, zoneLabel(l));
    }
    const placeName = (id: string | null) =>
      id
        ? (label.get(id) ?? "A shelf no longer in use")
        : "Every shelf at once";

    const people = await this.personNames([
      ...counts.map((c) => c.counted_by ?? ""),
      ...held.map((h) => h.counted_by ?? ""),
      ...parked.map((p) => p.counted_by ?? ""),
      ...shelves.map((s) => s.done_by ?? ""),
      signedOffBy ?? "",
    ]);
    const person = (id: string | null) =>
      id ? (people.get(id) ?? "Someone") : null;

    // Money: the house's own currency and each item's cost per bottle. Read
    // only for the people who see money.
    let currency: string | null = null;
    const cost = new Map<string, { wac: number | null; bottleMl: number }>();
    const ml = new Map<string, number>();
    // Each item's bottle size, for everyone: the open bottles are said in
    // tenths of that bottle, as staff entered them (S230 owed item). A size
    // is not money; an item with none is said on a 750 ml stand-in.
    if (itemIds.length) {
      const size = await client
        .from("restaurant_inventory")
        .select("id, bottle_size_ml")
        .eq("restaurant_id", house)
        .in("id", itemIds);
      if (size.error) throw this.unreadable("bottle size read", size.error);
      for (const r of (size.data ?? []) as Array<{
        id: string;
        bottle_size_ml: number | null;
      }>) {
        if (r.bottle_size_ml && r.bottle_size_ml > 0)
          ml.set(r.id, Number(r.bottle_size_ml));
      }
    }
    const openTenthsOf = (inventoryId: string, openMl: number | null) =>
      openMl == null
        ? null
        : Math.round(
            (openMl / (ml.get(inventoryId) ?? STAND_IN_BOTTLE_ML)) * 10,
          );
    if (seesMoney && itemIds.length) {
      const cur = await client
        .from("restaurants")
        .select("currency")
        .eq("id", house)
        .maybeSingle();
      if (cur.error) throw this.unreadable("currency read", cur.error);
      currency =
        (cur.data as { currency?: string | null } | null)?.currency ?? null;
      const wac = await client
        .from("inventory_lot_rollup")
        .select("inventory_id, wac")
        .eq("restaurant_id", house)
        .in("inventory_id", itemIds);
      if (wac.error) throw this.unreadable("cost read", wac.error);
      for (const r of (wac.data ?? []) as Array<{
        inventory_id: string;
        wac: number | null;
      }>) {
        cost.set(r.inventory_id, {
          wac: r.wac == null ? null : Number(r.wac),
          bottleMl: ml.get(r.inventory_id) ?? STAND_IN_BOTTLE_ML,
        });
      }
    }
    const valueOf = (c: ReviewCountRow): number | null => {
      const k = cost.get(c.inventory_id);
      if (!k || k.wac == null) return null;
      const openDiff =
        c.counted_open_ml != null && c.expected_open_ml != null
          ? (c.counted_open_ml - c.expected_open_ml) / k.bottleMl
          : 0;
      return Math.round((c.variance_qty + openDiff) * k.wac * 100) / 100;
    };
    // F-1621: the open bottles' difference in tenths of a bottle, as staff
    // entered them, so the difference column says what the value counts.
    const openDifferenceOf = (c: ReviewCountRow): number | null =>
      c.counted_open_ml != null && c.expected_open_ml != null
        ? Math.round(
            ((c.counted_open_ml - c.expected_open_ml) /
              (ml.get(c.inventory_id) ?? STAND_IN_BOTTLE_ML)) *
              10,
          )
        : null;

    const signedAt = session.signed_off_at
      ? Date.parse(session.signed_off_at)
      : null;
    const lineOf = (c: ReviewCountRow): ReviewLine => ({
      countId: c.id,
      inventoryId: c.inventory_id,
      name: nameOf(c.inventory_id),
      counted: c.counted_qty,
      openMl: c.counted_open_ml,
      openTenths: openTenthsOf(c.inventory_id, c.counted_open_ml),
      bottleSizeKnown: ml.has(c.inventory_id),
      countedBy: person(c.counted_by),
      countedAt: c.counted_at,
      afterSignOff:
        signedAt != null &&
        !!c.arrived_at &&
        Date.parse(c.arrived_at) > signedAt,
      ...(seesMoney
        ? {
            expected: c.expected_qty,
            expectedOpenMl: c.expected_open_ml,
            variance: c.variance_qty,
            openDifferenceTenths: openDifferenceOf(c),
            value: valueOf(c),
          }
        : {}),
    });

    const byShelf = new Map<string, ReviewCountRow[]>();
    const elsewhere: ReviewCountRow[] = [];
    const inWalk = new Set(shelfIds);
    for (const c of counts) {
      if (c.location_id && inWalk.has(c.location_id)) {
        const list = byShelf.get(c.location_id) ?? [];
        list.push(c);
        byShelf.set(c.location_id, list);
      } else elsewhere.push(c);
    }
    const sortLines = (a: ReviewLine, b: ReviewLine) =>
      a.name.localeCompare(b.name) || a.countedAt.localeCompare(b.countedAt);

    // A bottle short on one shelf and the same wine found where the books
    // had none: most likely moved, not lost. Both counts already set each
    // shelf right, so nothing is posted; the review says so (money only).
    const moved: CountReview["moved"] = [];
    if (seesMoney) {
      const short = counts.filter((c) => c.variance_qty < 0 && c.location_id);
      const found = counts.filter(
        (c) => c.variance_qty > 0 && c.expected_qty === 0 && c.location_id,
      );
      for (const f of found) {
        const s = short.find(
          (x) =>
            x.inventory_id === f.inventory_id &&
            x.location_id !== f.location_id,
        );
        if (!s) continue;
        moved.push({
          inventoryId: f.inventory_id,
          name: nameOf(f.inventory_id),
          bottles: Math.min(-s.variance_qty, f.variance_qty),
          from: placeName(s.location_id),
          to: placeName(f.location_id),
        });
      }
    }

    const reviewShelves = shelves.map((s) => {
      const lines = (byShelf.get(s.location_id) ?? [])
        .map(lineOf)
        .sort(sortLines);
      return {
        locationId: s.location_id,
        name: placeName(s.location_id),
        done: s.done_at != null,
        doneAt: s.done_at,
        doneBy: person(s.done_by),
        round: s.recount_round ?? 0,
        recountAskedAt: s.recount_asked_at,
        lines,
        missed: [...(missed.get(s.location_id) ?? [])]
          .map((id) => ({ inventoryId: id, name: nameOf(id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        ...(seesMoney
          ? {
              value: lines.some((l) => l.value == null)
                ? null
                : Math.round(
                    lines.reduce((t, l) => t + (l.value ?? 0), 0) * 100,
                  ) / 100,
            }
          : {}),
      };
    });

    return {
      id: session.id,
      kind: session.kind,
      status: session.status,
      openedAt: session.opened_at,
      period: session.attributed_period ?? null,
      signedOffAt: session.signed_off_at,
      signedOffBy: person(signedOffBy),
      seesMoney,
      currency,
      shelves: reviewShelves,
      notCounted: reviewShelves
        .filter((s) => !s.done)
        .map((s) => ({
          locationId: s.locationId,
          name: s.name,
          round: s.round,
        })),
      elsewhere: elsewhere.map(lineOf).sort(sortLines),
      held: held.map((h) => {
        const a = h.held_against ? against.get(h.held_against) : undefined;
        return {
          id: h.id,
          inventoryId: h.inventory_id,
          name: nameOf(h.inventory_id),
          locationId: h.location_id,
          shelf: placeName(h.location_id),
          counted: h.counted_qty,
          openMl: h.counted_open_ml,
          openTenths: openTenthsOf(h.inventory_id, h.counted_open_ml),
          bottleSizeKnown: ml.has(h.inventory_id),
          countedBy: person(h.counted_by),
          countedAt: h.counted_at,
          against: a ? lineOf(a) : null,
        };
      }),
      parked: parked.map((p) => ({
        id: p.id,
        locationId: p.location_id,
        shelf: placeName(p.location_id),
        description: p.description,
        counted: p.counted_qty,
        countedBy: person(p.counted_by),
        countedAt: p.counted_at,
      })),
      moved,
      afterSignOff: counts
        .map(lineOf)
        .filter((l) => l.afterSignOff)
        .sort(sortLines),
    };
  }

  /** A held line the manager chose: posted now, as its counter, at its moment. */
  async useHeldLine(
    house: string,
    sessionId: string,
    heldLineId: string,
    userId: string,
  ) {
    const client = this.dbService.getClient();
    const read = await client
      .from("stock_count_held_lines")
      .select(
        "id, inventory_id, location_id, stock_state, counted_qty, counted_open_ml, counted_by, counted_at, reason, idempotency_key, state, resolved_count_id",
      )
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .eq("id", heldLineId)
      .maybeSingle();
    if (read.error) throw this.unreadable("held read", read.error);
    const h = read.data as {
      id: string;
      inventory_id: string;
      location_id: string | null;
      stock_state: "live" | "shadow";
      counted_qty: number;
      counted_open_ml: number | null;
      counted_by: string | null;
      counted_at: string;
      reason: string | null;
      idempotency_key: string;
      state: "held" | "posted" | "dropped";
      resolved_count_id: string | null;
    } | null;
    if (!h) {
      throw new HttpException(
        "That line is not one of this count's.",
        HttpStatus.NOT_FOUND,
      );
    }
    if (h.state === "posted") {
      return {
        heldLineId: h.id,
        state: "posted",
        countId: h.resolved_count_id,
        replayed: true,
      };
    }
    if (h.state === "dropped") {
      throw new HttpException(
        "This line was set aside, so it cannot be used now.",
        HttpStatus.CONFLICT,
      );
    }
    const prefix = `count:${h.inventory_id}:`;
    if (!h.idempotency_key.startsWith(prefix)) {
      throw new HttpException(
        "This line could not be matched to its count. Count the shelf again.",
        HttpStatus.CONFLICT,
      );
    }
    const session = await this.session(house, sessionId);
    const out = await this.inventory.recordSpotCount(
      house,
      h.inventory_id,
      {
        countedQty: h.counted_qty,
        stockState: h.stock_state,
        clientCountId: h.idempotency_key.slice(prefix.length),
        reason: h.reason ?? "Stock-take line",
        performedBy: h.counted_by,
        countedAgoMs: Math.max(0, Date.now() - Date.parse(h.counted_at)),
        locationId: h.location_id,
        opening: session.kind === "opening",
        sessionId,
        openMl: h.counted_open_ml,
        // The manager's word keeps a line older than 72 h (ADR 0286).
        role: "manager",
      },
      { heldLineId: h.id, resolvedBy: userId },
    );
    return {
      heldLineId: h.id,
      state: "posted",
      countId: out?.count?.countId ?? null,
      replayed: false,
    };
  }

  /** A held line set aside: it stays as a record; no stock moves. */
  async dropHeldLine(
    house: string,
    sessionId: string,
    heldLineId: string,
    userId: string,
  ) {
    const client = this.dbService.getClient();
    const upd = await client
      .from("stock_count_held_lines")
      .update({
        state: "dropped",
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
      })
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .eq("id", heldLineId)
      .eq("state", "held")
      .select("id");
    if (upd.error) throw this.unreadable("held drop", upd.error);
    if ((upd.data as unknown[] | null)?.length)
      return { heldLineId, state: "dropped", replayed: false };
    const now = await client
      .from("stock_count_held_lines")
      .select("state")
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .eq("id", heldLineId)
      .maybeSingle();
    if (now.error) throw this.unreadable("held read", now.error);
    const state = (now.data as { state?: string } | null)?.state;
    if (!state) {
      throw new HttpException(
        "That line is not one of this count's.",
        HttpStatus.NOT_FOUND,
      );
    }
    if (state === "dropped")
      return { heldLineId, state: "dropped", replayed: true };
    throw new HttpException(
      "This line was already used, so it cannot be set aside.",
      HttpStatus.CONFLICT,
    );
  }

  private async parkedLine(house: string, sessionId: string, id: string) {
    const read = await this.dbService
      .getClient()
      .from("stock_count_parked_lines")
      .select(
        "id, location_id, counted_qty, counted_by, counted_at, state, resolved_count_id",
      )
      .eq("restaurant_id", house)
      .eq("session_id", sessionId)
      .eq("id", id)
      .maybeSingle();
    if (read.error) throw this.unreadable("parked read", read.error);
    if (!read.data) {
      throw new HttpException(
        "That line is not one of this count's.",
        HttpStatus.NOT_FOUND,
      );
    }
    return read.data as {
      id: string;
      location_id: string;
      counted_qty: number;
      counted_by: string | null;
      counted_at: string;
      state: "parked" | "carried" | "dropped";
      resolved_count_id: string | null;
    };
  }

  /**
   * A parked line the manager matched to an item the house already carries:
   * its bottles are counted on its shelf, as its counter, at its moment,
   * through the one count writer. Creating a new item from a parked line
   * ("carry this", ADR 0115) is not built: that ADR is still proposed.
   */
  async carryParked(
    house: string,
    sessionId: string,
    parkedId: string,
    userId: string,
    dto: { inventoryId?: unknown },
  ) {
    const inventoryId =
      typeof dto?.inventoryId === "string" ? dto.inventoryId.trim() : "";
    if (!inventoryId) {
      throw new HttpException(
        "Choose which of the house's items this is.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const p = await this.parkedLine(house, sessionId, parkedId);
    if (p.state === "carried") {
      return {
        parkedId: p.id,
        state: "carried",
        countId: p.resolved_count_id,
        replayed: true,
      };
    }
    if (p.state === "dropped") {
      throw new HttpException(
        "This line was set aside, so it cannot be counted now.",
        HttpStatus.CONFLICT,
      );
    }
    const session = await this.session(house, sessionId);
    const out = await this.inventory.recordSpotCount(house, inventoryId, {
      countedQty: p.counted_qty,
      stockState: "live",
      // One key per parked line: a retry replays, never counts twice.
      clientCountId: `parked:${p.id}`,
      reason: "Stock-take: found on the shelf, matched in review",
      performedBy: p.counted_by,
      countedAgoMs: Math.max(0, Date.now() - Date.parse(p.counted_at)),
      locationId: p.location_id,
      opening: session.kind === "opening",
      sessionId,
      role: "manager",
    });
    const countId = out?.count?.countId ?? null;
    const upd = await this.dbService
      .getClient()
      .from("stock_count_parked_lines")
      .update({
        state: "carried",
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
        resolved_count_id: countId,
      })
      .eq("restaurant_id", house)
      .eq("id", p.id)
      .eq("state", "parked")
      .select("id");
    if (upd.error) throw this.unreadable("parked carry", upd.error);
    return {
      parkedId: p.id,
      state: "carried",
      countId,
      held: out?.count?.held === true,
      replayed: false,
    };
  }

  /** A parked line set aside: nothing is counted. */
  async dropParked(
    house: string,
    sessionId: string,
    parkedId: string,
    userId: string,
  ) {
    const p = await this.parkedLine(house, sessionId, parkedId);
    if (p.state === "dropped")
      return { parkedId: p.id, state: "dropped", replayed: true };
    if (p.state === "carried") {
      throw new HttpException(
        "This line was already counted, so it cannot be set aside.",
        HttpStatus.CONFLICT,
      );
    }
    const upd = await this.dbService
      .getClient()
      .from("stock_count_parked_lines")
      .update({
        state: "dropped",
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
      })
      .eq("restaurant_id", house)
      .eq("id", p.id)
      .eq("state", "parked")
      .select("id");
    if (upd.error) throw this.unreadable("parked drop", upd.error);
    return { parkedId: p.id, state: "dropped", replayed: false };
  }

  /**
   * Sends a shelf back to be counted again. `seenRound` is the round the
   * manager saw, so a double tap sends it back once.
   */
  async askRecount(
    house: string,
    sessionId: string,
    locationId: string,
    userId: string,
    dto: { seenRound?: unknown },
  ) {
    const seen = Number(dto?.seenRound);
    if (!Number.isInteger(seen) || seen < 0) {
      throw new HttpException(
        "The page is out of date. Refresh it and try again.",
        HttpStatus.BAD_REQUEST,
      );
    }
    // Who said it was done, read before the send-back clears it (F-1638).
    const before = await this.shelf(house, sessionId, locationId);
    const r = await this.inventory.askShelfRecount(
      house,
      sessionId,
      locationId,
      userId,
      seen,
    );
    if (r.replayed !== true) {
      // The person who counted it, and whoever holds it now.
      const told = [
        ...new Set(
          [before.done_by, before.claimed_by].filter(
            (id): id is string => typeof id === "string",
          ),
        ),
      ];
      if (told.length) {
        const where = await this.houseLocations(house)
          .then((all) => all.find((l) => l.id === locationId))
          .catch(() => undefined);
        await this.tellTheFloor(
          house,
          userId,
          "count_recount",
          {
            title: "A shelf to count again",
            message: `${where ? zoneLabel(where) : "A shelf you counted"} was sent back. Count it again when you can.`,
            actionUrl: `/count/${sessionId}`,
          },
          told,
        );
      }
    }
    return {
      locationId,
      round: Number(r.round ?? seen),
      askedAt: (r.asked_at as string | null) ?? null,
      setAside: Number(r.dropped_held ?? 0),
      replayed: r.replayed === true,
    };
  }

  /**
   * Signs the walk off: the manager's word that it is complete (F2 a). With
   * shelves not counted it asks first, unless the manager says to go on.
   */
  async signOff(
    house: string,
    sessionId: string,
    userId: string,
    dto: { evenIfUnfinished?: unknown },
  ) {
    const r = await this.inventory.signOffCountSession(
      house,
      sessionId,
      userId,
      dto?.evenIfUnfinished === true,
    );
    return {
      id: sessionId,
      status: String(r.status ?? ""),
      signedOff: r.status === "signed_off",
      signedOffAt: (r.signed_off_at as string | null) ?? null,
      notCounted: r.not_counted == null ? 0 : Number(r.not_counted),
      stamped: r.stamped == null ? null : Number(r.stamped),
      replayed: r.replayed === true,
    };
  }
}

interface ReviewCountRow {
  id: string;
  inventory_id: string;
  location_id: string | null;
  counted_qty: number;
  expected_qty: number;
  variance_qty: number;
  counted_open_ml: number | null;
  expected_open_ml: number | null;
  counted_by: string | null;
  counted_at: string;
  arrived_at: string | null;
}

export interface ReviewLine {
  countId: string;
  inventoryId: string;
  name: string;
  counted: number;
  openMl: number | null;
  /** The open bottles in tenths of the item's bottle; null when not counted. */
  openTenths: number | null;
  /** False: the item names no bottle size and the tenths stand on 750 ml. */
  bottleSizeKnown: boolean;
  countedBy: string | null;
  countedAt: string;
  afterSignOff: boolean;
  /** Owner and manager only. */
  expected?: number;
  expectedOpenMl?: number | null;
  variance?: number;
  /** F-1621: open bottles' difference in tenths; null when open was not counted. */
  openDifferenceTenths?: number | null;
  /** In the house's currency; null when the item has no cost. */
  value?: number | null;
}

export interface CountReview {
  id: string;
  kind: CountSessionKind;
  status: string;
  openedAt: string;
  /** The month (YYYY-MM) its counts are filed in; null when it names none. */
  period: string | null;
  signedOffAt: string | null;
  signedOffBy: string | null;
  seesMoney: boolean;
  currency: string | null;
  shelves: Array<{
    locationId: string;
    name: string;
    done: boolean;
    doneAt: string | null;
    doneBy: string | null;
    round: number;
    recountAskedAt: string | null;
    lines: ReviewLine[];
    missed: Array<{ inventoryId: string; name: string }>;
    value?: number | null;
  }>;
  notCounted: Array<{ locationId: string; name: string; round: number }>;
  elsewhere: ReviewLine[];
  held: Array<{
    id: string;
    inventoryId: string;
    name: string;
    locationId: string | null;
    shelf: string;
    counted: number;
    openMl: number | null;
    openTenths: number | null;
    bottleSizeKnown: boolean;
    countedBy: string | null;
    countedAt: string;
    against: ReviewLine | null;
  }>;
  parked: Array<{
    id: string;
    locationId: string;
    shelf: string;
    description: string;
    counted: number;
    countedBy: string | null;
    countedAt: string;
  }>;
  moved: Array<{
    inventoryId: string;
    name: string;
    bottles: number;
    from: string;
    to: string;
  }>;
  afterSignOff: ReviewLine[];
}
