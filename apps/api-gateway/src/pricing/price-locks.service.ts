import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { readHouseMoney } from "../common/house-money";
import { DatabaseService } from "../database/database.service";
import { lineIsDrink, RAW_LINE_COLUMN } from "../menus/menu-line-view";
import {
  MarginAdviceService,
  ROLLUP_SELECT,
  readAdviceTaxTerms,
  type InventoryPriceRow,
} from "./margin-advice.service";
import { fmtMoney, type HouseMoneyTerms } from "./margin-to-target";
import { confirmedPourFrom, readHouseTargetMargin, targetsFrom } from "./target-margin.service";
import { type LockKind, lockFromRow, readOpenLocks, readPeople } from "./price-locks";

/**
 * A house holds a price (ADR 0193, round 3).
 *
 * THE FOUNDER, 2026-09-21, verbatim: "add a section to that where you can lock
 * price, but wha f that menu item disappears? so think verify validate your
 * decision and build". The decision is ADR 0193's L1-L27; the SQL is
 * `20260922230800_a_house_can_hold_a_price.sql`.
 *
 * This service lists a house's open locks with what a person needs to judge
 * each one (L17, L23) and runs the four acts -- lock, release, change and keep
 * locked, move -- through their SQL functions, which take the wine row's lock
 * first (L27). Who may act (owner or manager) is the controller's check (L8).
 * Nothing here expires or releases a lock: only a person ends one (L16).
 */

/** A fact about an open lock, computed when it is read (L23). Never a timer. */
export type LockMarker =
  | "off_target"
  | "advice_unknown"
  | "author_without_access"
  | "not_on_current_menu"
  | "no_current_menu"
  | "wine_removed"
  | "menu_differs";

/** The markers that put a lock in the feed's `price_locks_to_review` (L23). */
export const REVIEW_MARKERS: LockMarker[] = [
  "off_target",
  "author_without_access",
  "not_on_current_menu",
  "no_current_menu",
  "wine_removed",
];

export interface LockView {
  lockId: string;
  inventoryId: string;
  kind: LockKind;
  lockedPrice: number;
  lockedAt: string;
  /** Whole days since the lock was set. A fact, not a deadline. */
  ageDays: number;
  note: string | null;
  movedFromLockId: string | null;
  lockedBy: { userId: string; name: string | null };
  wine: {
    name: string | null;
    vintage: number | null;
    masterWineId: string | null;
    /** false = removed from inventory (the lock still holds, L16). null = not read. */
    active: boolean | null;
    /** The house price for this kind now; equals lockedPrice while the lock is open (L3). */
    housePrice: number | null;
  };
  /**
   * Not on the house's current menu, or there is no current menu (L17).
   * null = UNKNOWN: the current menu or this lock's wine could not be read, so
   * the lock is said to be in neither group (L25) -- never "on the menu" and
   * never "not on it" (last-call review, 2026-09-21: an unread menu had put
   * every lock under "On the current menu").
   */
  dormant: boolean | null;
  /** The current menu's price for this kind of this wine, when it lists one. */
  menuPrice: number | null;
  /**
   * Each live line that lists this wine, naming its menu and that menu's kind
   * (ADR 0340 rule 25), with its price of the lock's kind. [] = on no live
   * menu; null = UNKNOWN, as `dormant`.
   */
  onMenus: Array<{
    menuId: string;
    kind: string | null;
    price: number | null;
  }> | null;
  markers: LockMarker[];
  /** The advice for this kind at the held price, when it could be computed. */
  advice: { state: string; sentence: string; advisedPrice: number | null; gapPct: number | null } | null;
  /** Why the advice is unknown, when it is (`advice_unknown`). */
  adviceUnknownReason: string | null;
}

export interface LockReadout {
  restaurantId: string;
  generatedAt: string;
  /** false = the locks could not be read. Never an empty list standing in for "none" (L25). */
  readable: boolean;
  reason: string | null;
  /** Every lock surface says it: a lock is at THIS house only (L26). */
  scope: "this house";
  currentMenus: Array<{ menuId: string; name: string | null }>;
  locks: LockView[];
  counts: { open: number; onCurrentMenu: number; notOnCurrentMenu: number; toReview: number };
  /** Whether the people behind the locks could be named (L25). */
  namesReadable: boolean;
  namesReason: string | null;
  /** Whether every marker could be computed; when not, the missing ones are not guessed. */
  markersReadable: boolean;
  markersReason: string | null;
  /** Set when the reader does not hold the house's money: each lock's advice was left out (F-619). */
  amountsWithheld?: true;
}

export interface LockActResult {
  outcome: "locked" | "released" | "changed_and_locked" | "moved" | "unchanged";
  lock: OpenLockRecord;
  previousLockId: string | null;
  housePrice: number | null;
  /** One sentence a person can read: what happened, and what did not. */
  sentence: string;
}

export interface OpenLockRecord {
  lockId: string;
  inventoryId: string;
  kind: LockKind;
  lockedPrice: number;
  lockedBy: string;
  lockedAt: string;
  note: string | null;
  movedFromLockId: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseNote: string | null;
}

const PAGE_ROWS = 1000;

/** A lock's price in the house's money and formats (F-1232); unknown either way, the bare figure. */
function money(
  n: number | null | undefined,
  house?: HouseMoneyTerms | null,
): string {
  return n === null || n === undefined || !Number.isFinite(Number(n))
    ? "no price"
    : fmtMoney(Number(n), house);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function recordFrom(raw: unknown): OpenLockRecord {
  const r = (raw ?? {}) as Record<string, unknown>;
  const base = lockFromRow(r);
  return {
    ...base,
    releasedAt: typeof r.released_at === "string" ? r.released_at : null,
    releasedBy: typeof r.released_by === "string" ? r.released_by : null,
    releaseNote: typeof r.release_note === "string" ? r.release_note : null,
  };
}

/** A lock act's SQL refusal, as the HTTP answer it means. */
export function lockActError(error: { code?: string; message?: string }, what: string): Error {
  const message = String(error.message ?? "").replace(/^[a-z_]+: /, "");
  switch (error.code) {
    case "P0002":
      return new NotFoundException(`${message || `No ${what} of this house by that id.`}`);
    case "22023":
      return new BadRequestException(message);
    case "HPL02":
    case "HPL03":
    case "HPL04":
    case "HPL05":
    case "HPL01":
      return new ConflictException(message);
    case "23505":
      return new ConflictException(
        "That price is already locked (another lock was set a moment ago). Nothing was changed.",
      );
    default:
      return new InternalServerErrorException(`The ${what} was not changed: ${error.message ?? "no reason given"}`);
  }
}

@Injectable()
export class PriceLocksService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly marginAdvice: MarginAdviceService,
  ) {}

  /**
   * Every open lock of this house, grouped by whether its wine is on the
   * current menu, with the facts that say whether it still makes sense (L17,
   * L23). Removed wines are listed: this read never filters `is_active` (the
   * advice list does, which is why this is not built on it).
   */
  async list(restaurantId: string): Promise<LockReadout> {
    const client = this.databaseService.client;
    const generatedAt = new Date().toISOString();
    const empty = { open: 0, onCurrentMenu: 0, notOnCurrentMenu: 0, toReview: 0 };
    const read = await readOpenLocks(client, restaurantId);
    if (read.error !== null) {
      return {
        restaurantId,
        generatedAt,
        readable: false,
        reason: `The price locks could not be read: ${read.error}. This is not the same as having none.`,
        scope: "this house",
        currentMenus: [],
        locks: [],
        counts: empty,
        namesReadable: false,
        namesReason: "the locks themselves could not be read",
        markersReadable: false,
        markersReason: "the locks themselves could not be read",
      };
    }
    const locks = read.locks;
    const missing: string[] = [];
    const inventoryIds = [...new Set(locks.map((l) => l.inventoryId))];

    // The wines behind the locks, active or not.
    const wines = new Map<string, InventoryPriceRow & Record<string, unknown>>();
    if (inventoryIds.length > 0) {
      const { data, error } = await client
        .from("restaurant_inventory")
        .select(
          "id, master_wine_id, wine_name, is_active, deleted_at, sale_type, menu_price_current, menu_price_glass, last_purchase_price, last_purchase_price_tax_basis, bottle_size_ml, pour_size_ml, pour_size_confirmed_by, pour_size_confirmed_at, master_wine_library(name, vintage, bottle_size_ml)",
        )
        .eq("restaurant_id", restaurantId)
        .in("id", inventoryIds);
      if (error) missing.push(`the locked wines could not be read (${error.message})`);
      else for (const w of (data ?? []) as Array<Record<string, unknown>>) wines.set(String(w.id), w as never);
    }

    // The current menu (one, normally; more only for a house that never chose).
    const menus = await this.currentMenuLines(restaurantId);
    if (menus.error) missing.push(`the current menu could not be read (${menus.error})`);

    // Advice inputs for the locked wines.
    const [targets, rollup, house] = await Promise.all([
      readHouseTargetMargin(client, restaurantId),
      inventoryIds.length === 0
        ? Promise.resolve({ data: [], error: null } as { data: unknown[]; error: { message: string } | null })
        : client
            .from("inventory_lot_rollup")
            // The advice's own columns, the tax proof's (F-620) among them.
            .select(ROLLUP_SELECT)
            .eq("restaurant_id", restaurantId)
            .in("inventory_id", inventoryIds),
      readHouseMoney(client, restaurantId),
    ]);
    // F-620: the lock's advice is the advice's own, tax basis included; an
    // unread basis leaves the advice unknown, never read as "unset".
    const tax =
      targets.error === null
        ? await readAdviceTaxTerms(
            client,
            restaurantId,
            targets.row?.target_margin_set_at ?? null,
          )
        : { terms: null, error: null };
    const adviceReadable =
      targets.error === null && !rollup.error && tax.error === null;
    if (targets.error !== null) missing.push(`the target margin could not be read (${targets.error})`);
    if (tax.error !== null)
      missing.push(
        `whether the house's prices include tax could not be read (${tax.error})`,
      );
    if (rollup.error) missing.push(`the recorded costs could not be read (${rollup.error.message})`);
    const lots = new Map<string, Record<string, unknown>>();
    for (const r of (rollup.data ?? []) as Array<Record<string, unknown>>) lots.set(String(r.inventory_id), r);
    const terms = {
      ...targetsFrom(targets.row),
      pourMl: confirmedPourFrom(targets.row),
      currency: targets.row?.currency ?? null,
      locale: house.locale,
      tax: tax.terms,
    };

    // Who set each lock, and whether they still manage this house.
    const authors = [...new Set(locks.map((l) => l.lockedBy))];
    const people = await readPeople(client, authors);
    const access = await this.managersAmong(restaurantId, authors);
    const namesReadable = people.error === null;
    const accessKnown = people.error === null && access.error === null;
    if (!accessKnown) {
      missing.push(
        `whether each lock's author still manages this house could not be read (${people.error ?? access.error})`,
      );
    }

    const now = Date.now();
    const views: LockView[] = locks.map((l) => {
      const w = wines.get(l.inventoryId) ?? null;
      const master = w ? String(w.master_wine_id ?? "") : null;
      const lib = (w?.master_wine_library ?? null) as { name?: string | null; vintage?: number | null } | null;
      const markers: LockMarker[] = [];
      // Unknown until both the current menu and this lock's wine were read.
      let dormant: boolean | null = null;
      let menuPrice: number | null = null;
      let onMenus: LockView["onMenus"] = null;
      if (!menus.error) {
        if (menus.menus.length === 0) {
          markers.push("no_current_menu");
          dormant = true;
          onMenus = [];
        } else {
          const onMenu = master ? menus.lines.filter((x) => x.wineLibraryId === master) : [];
          if (w) {
            dormant = onMenu.length === 0;
            onMenus = onMenu.map((x) => ({
              menuId: x.menuId,
              kind: x.kind,
              price: l.kind === "bottle" ? x.bottle : x.glass,
            }));
          }
          if (dormant === true) markers.push("not_on_current_menu");
          const prices = onMenu
            .map((x) => (l.kind === "bottle" ? x.bottle : x.glass))
            .filter((p): p is number => p !== null);
          menuPrice = prices[0] ?? null;
          if (prices.some((p) => Math.abs(p - l.lockedPrice) >= 0.005)) markers.push("menu_differs");
        }
      }
      if (w && (w.is_active === false || (w as { deleted_at?: unknown }).deleted_at)) markers.push("wine_removed");
      if (accessKnown && !this.managesHouse(l.lockedBy, access.roles, people.people.get(l.lockedBy), restaurantId)) {
        markers.push("author_without_access");
      }
      let advice: LockView["advice"] = null;
      let adviceUnknownReason: string | null = null;
      if (w && adviceReadable) {
        const wa = this.marginAdvice.adviseWine(w, lots.get(l.inventoryId) ?? null, terms);
        const a = l.kind === "bottle" ? wa.bottle : wa.glass;
        if (a) {
          advice = { state: a.state, sentence: a.sentence, advisedPrice: a.advisedPrice, gapPct: a.gapPct };
          if (a.state === "raise" || a.state === "lower") markers.push("off_target");
          else if (a.state !== "on_target") {
            markers.push("advice_unknown");
            adviceUnknownReason = a.sentence;
          }
        } else {
          markers.push("advice_unknown");
          adviceUnknownReason = `This wine is not sold by the ${l.kind}, so there is no ${l.kind} advice.`;
        }
      }
      const housePrice = w ? num(l.kind === "bottle" ? w.menu_price_current : w.menu_price_glass) : null;
      return {
        lockId: l.lockId,
        inventoryId: l.inventoryId,
        kind: l.kind,
        lockedPrice: l.lockedPrice,
        lockedAt: l.lockedAt,
        ageDays: Math.max(0, Math.floor((now - new Date(l.lockedAt).getTime()) / 86_400_000)),
        note: l.note,
        movedFromLockId: l.movedFromLockId,
        lockedBy: { userId: l.lockedBy, name: people.people.get(l.lockedBy)?.name ?? null },
        wine: {
          name: (w?.wine_name as string | null | undefined) ?? lib?.name ?? null,
          vintage: lib?.vintage ?? null,
          masterWineId: master,
          active: w ? w.is_active !== false && !(w as { deleted_at?: unknown }).deleted_at : null,
          housePrice,
        },
        dormant,
        menuPrice,
        onMenus,
        markers,
        advice,
        adviceUnknownReason,
      };
    });

    const toReview = views.filter((v) => v.markers.some((m) => REVIEW_MARKERS.includes(m))).length;
    return {
      restaurantId,
      generatedAt,
      readable: true,
      reason: null,
      scope: "this house",
      currentMenus: menus.menus,
      locks: views,
      counts: {
        open: views.length,
        onCurrentMenu: views.filter((v) => v.dormant === false).length,
        notOnCurrentMenu: views.filter((v) => v.dormant === true).length,
        toReview,
      },
      namesReadable,
      namesReason: namesReadable ? null : `the people behind these locks could not be named: ${people.error}`,
      markersReadable: missing.length === 0,
      markersReason: missing.length === 0 ? null : `Some facts about these locks are not shown: ${missing.join("; ")}.`,
    };
  }

  /** Hold the house's price for one kind of one wine, as it is now (L1, L2). */
  async lock(
    restaurantId: string,
    inventoryId: string,
    kind: LockKind,
    actorUserId: string,
    note?: string | null,
  ): Promise<LockActResult> {
    if (kind !== "bottle" && kind !== "glass") {
      throw new BadRequestException("A lock holds the bottle or the glass price. Nothing was locked.");
    }
    const { data, error } = await this.databaseService.client.rpc("lock_house_menu_price", {
      p_restaurant_id: restaurantId,
      p_inventory_id: inventoryId,
      p_kind: kind,
      p_actor: actorUserId,
      p_note: note ?? null,
    });
    if (error) throw lockActError(error, "wine");
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.outcome !== "locked" || !r.lock) {
      throw new InternalServerErrorException("The lock answered no outcome; whether the price is locked is unknown.");
    }
    const lock = recordFrom(r.lock);
    const house = await readHouseMoney(
      this.databaseService.client,
      restaurantId,
    );
    return {
      outcome: "locked",
      lock,
      previousLockId: null,
      housePrice: lock.lockedPrice,
      sentence: `The ${kind} price is locked at ${money(lock.lockedPrice, house)} at this house. No menu, correction or advice changes it until an owner or a manager does.`,
    };
  }

  /** Only a person ends a lock (L16), and releasing changes no price (L24). */
  async release(
    restaurantId: string,
    lockId: string,
    actorUserId: string,
    note?: string | null,
  ): Promise<LockActResult> {
    const { data, error } = await this.databaseService.client.rpc("release_house_price_lock", {
      p_restaurant_id: restaurantId,
      p_lock_id: lockId,
      p_actor: actorUserId,
      p_note: note ?? null,
    });
    if (error) throw lockActError(error, "lock");
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.outcome !== "released" || !r.lock) {
      throw new InternalServerErrorException("The release answered no outcome; whether the lock is released is unknown.");
    }
    const lock = recordFrom(r.lock);
    const housePrice = num(r.house_price);
    return {
      outcome: "released",
      lock,
      previousLockId: null,
      housePrice,
      sentence: await this.releaseSentence(restaurantId, lock, housePrice),
    };
  }

  /** "Change and keep locked", one act (L6). The caller names the lock it saw. */
  async changeAndKeep(
    restaurantId: string,
    lockId: string,
    price: unknown,
    actorUserId: string,
    note?: string | null,
  ): Promise<LockActResult> {
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      throw new BadRequestException("Say the new price, a number of 0 or more. Nothing was changed.");
    }
    const { data, error } = await this.databaseService.client.rpc("change_locked_house_menu_price", {
      p_restaurant_id: restaurantId,
      p_lock_id: lockId,
      p_price: price,
      p_actor: actorUserId,
      p_note: note ?? null,
    });
    if (error) throw lockActError(error, "lock");
    const r = (data ?? {}) as Record<string, unknown>;
    const house = await readHouseMoney(
      this.databaseService.client,
      restaurantId,
    );
    if (r.outcome === "unchanged" && r.lock) {
      const lock = recordFrom(r.lock);
      return {
        outcome: "unchanged",
        lock,
        previousLockId: null,
        housePrice: lock.lockedPrice,
        sentence: `That is the price already held (${money(lock.lockedPrice, house)}). Nothing changed.`,
      };
    }
    if (r.outcome !== "changed_and_locked" || !r.lock) {
      throw new InternalServerErrorException("The change answered no outcome; whether the price changed is unknown.");
    }
    const lock = recordFrom(r.lock);
    return {
      outcome: "changed_and_locked",
      lock,
      previousLockId: typeof r.previous_lock_id === "string" ? r.previous_lock_id : null,
      housePrice: lock.lockedPrice,
      sentence: `The ${lock.kind} price is now ${money(lock.lockedPrice, house)} (it was ${money(num(r.previous_price), house)}) and stays locked.`,
    };
  }

  /**
   * Link a lock to another wine of this house (L20): the person names the
   * target and the price. There is no default price -- a missing one is a 400.
   */
  async move(
    restaurantId: string,
    lockId: string,
    targetInventoryId: unknown,
    price: unknown,
    actorUserId: string,
    note?: string | null,
  ): Promise<LockActResult> {
    if (typeof targetInventoryId !== "string" || targetInventoryId === "") {
      throw new BadRequestException("Say which wine of this house the lock moves to. Nothing was changed.");
    }
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      throw new BadRequestException(
        "Say the price the wine is locked at: a move never guesses one. Nothing was changed.",
      );
    }
    const { data, error } = await this.databaseService.client.rpc("move_house_price_lock", {
      p_restaurant_id: restaurantId,
      p_lock_id: lockId,
      p_target_inventory_id: targetInventoryId,
      p_price: price,
      p_actor: actorUserId,
      p_note: note ?? null,
    });
    if (error) throw lockActError(error, "lock");
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.outcome !== "moved" || !r.lock) {
      throw new InternalServerErrorException("The move answered no outcome; where the lock is now is unknown.");
    }
    const lock = recordFrom(r.lock);
    const house = await readHouseMoney(
      this.databaseService.client,
      restaurantId,
    );
    return {
      outcome: "moved",
      lock,
      previousLockId: typeof r.previous_lock_id === "string" ? r.previous_lock_id : null,
      housePrice: lock.lockedPrice,
      sentence: `The lock moved: this wine's ${lock.kind} price is ${money(lock.lockedPrice, house)} and locked. The old lock is released and kept on the record.`,
    };
  }

  /**
   * L24's sentence: a release changes no price; when the current menu reads
   * another price, it says so. A failed read of the menu is said, not
   * guessed.
   */
  private async releaseSentence(
    restaurantId: string,
    lock: OpenLockRecord,
    housePrice: number | null,
  ): Promise<string> {
    const house = await readHouseMoney(
      this.databaseService.client,
      restaurantId,
    );
    const stays = `The house ${lock.kind} price stays ${money(housePrice, house)}`;
    const { data: wine, error: wineErr } = await this.databaseService.client
      .from("restaurant_inventory")
      .select("master_wine_id")
      .eq("id", lock.inventoryId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    const menus = wineErr ? null : await this.currentMenuLines(restaurantId);
    if (wineErr || !menus || menus.error) {
      return `The lock is released. ${stays}. Whether the current menu reads another price could not be read (${wineErr?.message ?? menus?.error}).`;
    }
    const master = (wine as { master_wine_id?: string } | null)?.master_wine_id ?? null;
    const prices = menus.lines
      .filter((x) => master !== null && x.wineLibraryId === master)
      .map((x) => (lock.kind === "bottle" ? x.bottle : x.glass))
      .filter((p): p is number => p !== null);
    const other = prices.find((p) => housePrice === null || Math.abs(p - housePrice) >= 0.005);
    if (other !== undefined) {
      return `The lock is released. The current menu reads ${money(other, house)}; the house price stays ${money(housePrice, house)} until a menu is chosen or a manager changes it.`;
    }
    return `The lock is released. ${stays}; nothing else changed.`;
  }

  /**
   * The current menu(s) of this house and their live DRINK lines, keyset-paged.
   * A failed page is an error. Every live menu is read, of any kind; a line
   * counts only when `lineIsDrink` says so on its menu's kind (ADR 0340 rule
   * 25), so a dish on the Food menu never makes a lock "on the menu" and a
   * dessert wine on Desserts does. Each line names its menu and kind. The raw
   * line is read for that test only and never kept.
   */
  async currentMenuLines(restaurantId: string): Promise<{
    menus: Array<{ menuId: string; name: string | null }>;
    lines: Array<{
      menuId: string;
      kind: string | null;
      wineLibraryId: string | null;
      bottle: number | null;
      glass: number | null;
    }>;
    error: string | null;
  }> {
    const client = this.databaseService.client;
    const { data: menuRows, error: menuErr } = await client
      .from("restaurant_menus")
      .select("id, name, menu_type")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active");
    if (menuErr) return { menus: [], lines: [], error: menuErr.message };
    const read = (menuRows ?? []) as Array<{
      id: string;
      name?: string | null;
      menu_type?: string | null;
    }>;
    const menus = read.map((m) => ({ menuId: m.id, name: m.name ?? null }));
    const kindOf = new Map(
      read.map((m) => [
        m.id,
        typeof m.menu_type === "string" ? m.menu_type : null,
      ]),
    );
    const lines: Array<{
      menuId: string;
      kind: string | null;
      wineLibraryId: string | null;
      bottle: number | null;
      glass: number | null;
    }> = [];
    for (const m of menus) {
      const kind = kindOf.get(m.menuId) ?? null;
      let after: string | null = null;
      for (;;) {
        let q = client
          .from("menu_items")
          .select(
            "id, wine_library_id, bottle_price, by_glass_price, line_kind, category, raw_extracted_text",
          )
          .eq("menu_id", m.menuId)
          .eq("restaurant_id", restaurantId)
          .neq("status", "discarded");
        if (after) q = q.gt("id", after);
        const { data, error } = await q.order("id", { ascending: true }).limit(PAGE_ROWS);
        if (error) return { menus, lines: [], error: error.message };
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        for (const r of rows) {
          if (
            !lineIsDrink(
              {
                line_kind: r.line_kind,
                category: r.category,
                raw: r[RAW_LINE_COLUMN],
              },
              kind,
            )
          )
            continue;
          lines.push({
            menuId: m.menuId,
            kind,
            wineLibraryId: typeof r.wine_library_id === "string" ? r.wine_library_id : null,
            bottle: num(r.bottle_price),
            glass: num(r.by_glass_price),
          });
        }
        if (rows.length < PAGE_ROWS) break;
        after = String(rows[rows.length - 1].id);
      }
    }
    return { menus, lines, error: null };
  }

  /** The role each of these people holds through an ACTIVE access row for this house. */
  private async managersAmong(
    restaurantId: string,
    userIds: string[],
  ): Promise<{ roles: Map<string, string | null>; error: string | null }> {
    const roles = new Map<string, string | null>();
    if (userIds.length === 0) return { roles, error: null };
    const { data, error } = await this.databaseService.client
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .in("user_id", userIds);
    if (error) return { roles, error: error.message };
    for (const r of (data ?? []) as Array<{ user_id: string; role?: string | null }>) roles.set(r.user_id, r.role ?? null);
    return { roles, error: null };
  }

  /**
   * Whether a person can still manage this house, read the way
   * `OrganizationsService.resolveRestaurantRole` reads it: an active access
   * row decides; without one, the legacy single-house role on `users`.
   */
  private managesHouse(
    userId: string,
    roles: Map<string, string | null>,
    person: { role: string | null; restaurantId: string | null } | undefined,
    restaurantId: string,
  ): boolean {
    const role = roles.has(userId)
      ? roles.get(userId)
      : person && person.restaurantId === restaurantId
        ? person.role
        : null;
    return role === "owner" || role === "manager";
  }
}
