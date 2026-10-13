import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { InventoryService } from "./inventory.service";
import { zoneLabel } from "../cellar/zones.service";
import { FACT_TIME_TRUST_MS } from "../common/fact-time";

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
}

interface ShelfRow {
  location_id: string;
  sort_order: number;
  claimed_by: string | null;
  claimed_at: string | null;
  done_by: string | null;
  done_at: string | null;
}

const SESSION_COLUMNS =
  "id, restaurant_id, kind, status, opened_by, opened_at, signed_off_at, abandoned_at";
const SHELF_COLUMNS =
  "location_id, sort_order, claimed_by, claimed_at, done_by, done_at";

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
  ) {}

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

  /** The house's open counts, newest first, with how many shelves are done. */
  async listOpen(house: string) {
    const client = this.dbService.getClient();
    const { data, error } = await client
      .from("stock_count_sessions")
      .select(SESSION_COLUMNS)
      .eq("restaurant_id", house)
      .eq("status", "open")
      .order("opened_at", { ascending: false });
    if (error) throw this.unreadable("sessions read", error);
    const sessions = (data ?? []) as SessionRow[];
    if (sessions.length === 0) return { sessions: [] };
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
        shelves: tally.get(s.id)?.shelves ?? 0,
        shelvesDone: tally.get(s.id)?.done ?? 0,
      })),
    };
  }

  /**
   * Opens a count over the leaf shelves under the chosen zones (all of the
   * house's leaf shelves when none are chosen). The caller has checked the
   * person is an owner or a manager (ADR 0238 / 0334). `openKey` makes a
   * double tap or a retry open one count, not two.
   */
  async open(
    house: string,
    userId: string,
    dto: { kind?: unknown; zoneIds?: unknown; openKey?: unknown },
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

    const made = await client
      .from("stock_count_sessions")
      .insert({
        restaurant_id: house,
        kind,
        opened_by: userId,
        open_key: openKey,
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
      if (zeroItemIds.some((id) => !expected.has(id) && !landed.has(id))) {
        throw new HttpException(
          "One of the items marked not found is not on this shelf's books. Nothing was counted.",
          HttpStatus.BAD_REQUEST,
        );
      }
    }

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
    for (const inventoryId of zeroItemIds) {
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
        sessionStatus: session.status,
        message:
          "Count this shelf again: some bottles moved after it was counted.",
      };
    }

    const doneAt = (at ?? new Date()).toISOString();
    const { data, error } = await this.dbService
      .getClient()
      .from("stock_count_session_shelves")
      .update({
        done_by: userId,
        done_at: doneAt,
        ...(shelf.claimed_by ? {} : { claimed_by: userId, claimed_at: doneAt }),
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
      sessionStatus: session.status,
      replayed: !data || (data as unknown[]).length === 0,
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
}
