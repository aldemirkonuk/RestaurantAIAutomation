import { restoreArrivalEntry } from "../arrival/restore-entry";
import * as crypto from "crypto";
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  CsvParserService,
  type MenuRead,
  type MenuReadNotes,
} from "./parsers/csv-parser.service";
import { ScanParserService } from "./parsers/scan-parser.service";
import { WineSubmissionsService } from "../wines/wine-submissions.service";
import { ImportMenuDto, type MenuCadence } from "./dto/import-menu.dto";
import { AddMenuItemDto } from "./dto/add-menu-item.dto";
import { ReviewMenuItemDto } from "./dto/review-menu-item.dto";
import { UpdateOnboardingProgressDto } from "./dto/update-onboarding-progress.dto";
import { WineExtractItem } from "./wine-extract-item.interface";
import {
  DRAFT_NAMES,
  headingsOf,
  menusSplitByKind,
  splitByKind,
  type DraftKind,
  type KindSlice,
} from "./section-table";
import { itemNeedsPencil } from "./pencil-rule";
import {
  LIVE_MENU_KINDS,
  readCurrentMenuLines,
  readCurrentMenuRows,
  type CurrentMenuRow,
} from "./current-menu-lines";
import {
  confirmedDrinkCategory,
  effectiveDrinkCategory,
  houseKindOf,
  isCocktailLine,
  lineForViewer,
  lineIsDrink,
  NON_DRINK_MENU_KINDS,
  RAW_LINE_COLUMN,
  readMenuSectionCategories,
  type LineView,
} from "./menu-line-view";
import {
  setHouseMenuPrice,
  type HeldKind,
  type HousePriceOutcome,
} from "../pricing/house-menu-price";
import { readOpenLocks, readPeople, type OpenLock } from "../pricing/price-locks";
import { fmtMoney, type HouseMoneyTerms } from "../pricing/margin-to-target";
import { readHouseMoney } from "../common/house-money";
import {
  cocktailNameKey,
  cocktailsSoldOut,
} from "../beverages/cocktail-recipe";

const FREE_TIER_MANUAL_LIMIT = 25;
/** The private bucket the gateway already keeps original bytes in (document intake). */
const SOURCE_BUCKET = "vendor-attachments";
/**
 * A photo or PDF read that kept only part of the menu says so, with the
 * reason (F-1292): the import reply, the list of kept menus and the plan all
 * say it, and making it current asks first. ADR 0340 rule 17 (lane 5b): the
 * reason is written to `restaurant_menus.part_read` and the name carries no
 * data; a version kept before that has it in its name, after this prefix,
 * and `partReadOf` reads it back from there.
 */
const DRINKS_LIST = "Drinks list";
const PART_READ_PREFIX = `${DRINKS_LIST}, read in part: `;

/** Why a version kept before rule 17 was read only in part, from its name; null when whole. */
export function partReadOf(name: unknown): string | null {
  return typeof name === "string" && name.startsWith(PART_READ_PREFIX)
    ? name.slice(PART_READ_PREFIX.length) || null
    : null;
}

/** How long a link to a kept menu source lives. */
const SOURCE_URL_SECONDS = 300;
/** PostgREST's max_rows (supabase/config.toml): a page never holds more. */
const PAGE_ROWS = 1000;
const DEFAULT_THRESHOLD_MIN_FALLBACK = 3;

/**
 * The section columns the Full menu reads (ADR 0340 rule 22). A const so
 * check_read_columns_exist.py checks it against the migrations.
 */
const FULL_MENU_SECTION_COLUMNS =
  "id, menu_id, parent_id, position, title, drink_category";

/** One section of the Full menu: its lines in the house's order, then its own sections. */
export interface FullMenuSection {
  id: string;
  parentId: string | null;
  title: string;
  position: number;
  drinkCategory: string | null;
  lines: Array<Record<string, unknown>>;
  sections: FullMenuSection[];
}

/** One live kind of the Full menu (ADR 0340 rule 22). */
export interface FullMenuKind {
  kind: string;
  menuId: string;
  name: string | null;
  madeCurrentAt: string | null;
  sections: FullMenuSection[];
  /** Lines in no section (a line added to a live menu lands here). */
  unsorted: Array<Record<string, unknown>>;
}

/** The Full menu: every live kind as one document (ADR 0340 rule 22, §F10). */
export interface FullMenu {
  /** When the server read it: the "as of" an offline copy shows. */
  readAt: string;
  /** The kinds in the house's order: `restaurants.menu_kind_order`, else Drinks, Food, Desserts. */
  kindOrder: string[];
  /** Whether the house has set its own order (false = the default). */
  kindOrderSet: boolean;
  kinds: FullMenuKind[];
  /**
   * Legacy dishes on the live Drinks menu (no stored `line_kind`, and the
   * legacy rule says kitchen), left off the document because a Food menu is
   * live. Empty while no Food menu is live: then they show in their section.
   * `onFood`: a live Food line has the same name.
   */
  hiddenDishes: Array<{
    id: string;
    name: string;
    menuId: string;
    onFood: boolean;
  }>;
  rawLineWithheld: true;
  soldOutReadable: boolean;
  soldOutReason: string | null;
}

/** Whether `order` names each live menu kind exactly once (`restaurants_menu_kind_order_is_the_three_kinds`). */
export function isMenuKindOrder(order: unknown): order is string[] {
  return (
    Array.isArray(order) &&
    order.length === LIVE_MENU_KINDS.length &&
    new Set(order).size === order.length &&
    order.every((k) => (LIVE_MENU_KINDS as readonly unknown[]).includes(k))
  );
}

/** A line's place: its stored position first (none last), then its name. */
function byPlace(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const pos = (v: unknown) =>
    typeof v === "number" ? v : Number.MAX_SAFE_INTEGER;
  return (
    pos(a.position) - pos(b.position) ||
    String(a.name ?? "").localeCompare(String(b.name ?? ""))
  );
}

/** A name as two lines are compared by: trimmed, lower-cased. */
const sameName = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
/**
 * A large menu made current (F-448): the house's rows for its wines are read
 * this many at a time, and this many lines are carried side by side. Done one
 * line at a time, a 2,000-line menu was ~8,000 serial round trips and the page
 * gave up waiting long before the carry ended.
 */
const CARRY_READ_CHUNK = 100;
const CARRY_CONCURRENCY = 12;
/** Line ids per read in resolve-on-tap, so a large section stays under the URL limit. */
const RESOLVE_ON_TAP_CHUNK = 100;

/** Run `work` over `items`, at most `size` at once. Never throws past `work`. */
async function inPool<T>(
  items: T[],
  size: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
}
const PRICE_FIELDS = new Set(["by_glass_price", "bottle_price"]);

interface ResolvedItem {
  item: WineExtractItem;
  masterWineId: string | null;
  matched: boolean;
  libraryTier: number | null;
  /** Best library-match score, 0-100. See LibraryResolutionResult. */
  confidence: number | null;
}

interface InsertedMenuItem {
  id: string;
  wine_library_id: string | null;
  name: string;
  // F-1470: a cocktail section's line is made, not stocked (isCocktailLine).
  category?: string | null;
  // The menu's own prices: ADR 0193 carries them to the house's price. Dated
  // by the moment the menu was CHOSEN (round 3, L11), never by the line.
  by_glass_price?: number | string | null;
  bottle_price?: number | string | null;
  created_at?: string | null;
  producer?: string | null;
  vintage?: string | null;
  // Set by lineForViewer on a line read, and by the import on a line it
  // inserts: NOT lineIsDrink (ADR 0340 rule 8). A kitchen line is set aside:
  // no stock row, no price (F-1170).
  kitchen_line?: boolean;
  // ADR 0340 rule 7: the line's stored kind, own category and section, as
  // the line read (LINE_SELECT) returns them.
  line_kind?: string | null;
  drink_category?: string | null;
  section_id?: string | null;
  // ADR 0340 rule 8 / ADR 0333 item 3: the house item kind a person confirmed
  // for this line (its own category, or its confirmed section's). Set by
  // makeCurrent; the carry writes it as declared. Unset: the library decides.
  declared_kind?: string | null;
  // ADR 0340 rule 7 / F20: a dish's own price (a drink line's is NULL).
  price?: number | string | null;
}

/**
 * The library wine a line carries to the house, or null. A kitchen (food)
 * line carries none, whatever it was linked to before (F-1170, the
 * coordinator's call: kitchen lines are set aside until a food model exists,
 * OD-113), so a menu made current gives it no stock row and no price, and
 * the plan says so before.
 */
function carriedWine(line: InsertedMenuItem): string | null {
  // ADR 0340 rule 8: `kitchen_line` is `!lineIsDrink` on every path that
  // builds an InsertedMenuItem (lineForViewer, resolveAndPersistItems).
  // F-1470: nor does a cocktail. It is made from its recipe's ingredients,
  // so a stock row of its own sat at 0 below its threshold and read as
  // critical low stock every morning. Its recipe's linked lines are its stock.
  // F-1526: the line's own drink category, when a person set one, decides.
  return line.kitchen_line === true ||
    isCocktailLine(line.category, line.name, line.drink_category)
    ? null
    : (line.wine_library_id ?? null);
}

/**
 * How a carry is dated and which menu it names (ADR 0193 round 3, L11). A
 * chosen menu passes the moment of the choice (`made_current_at`); a line
 * added to the current menu passes null, which the writer reads as now.
 * `source` says which act it is (S202 amendment): a menu made current is
 * 'menu_current', its own dated price change; a line added is 'import'.
 */
interface CarryDating {
  effectiveFrom: string | null;
  menuId: string | null;
  source: "import" | "menu_current";
}

/** The price flags a line can carry (founder answers 3 and 4). */
type PriceFlag = "blank_kept_last_known" | "blank_no_house_price";

/**
 * What choosing a menu WOULD do, per line and per kind (ADR 0193 round 3,
 * L13) -- the section the founder asked for ("add a section to that where you
 * can lock price"), shown before an owner or manager confirms:
 *   change              the house price becomes the menu's
 *   unchanged           it already is
 *   held_by_lock        a lock holds the house price; the menu's is not applied
 *   blank_kept          the line shows no price; the house keeps its own (flagged)
 *   blank_never_priced  the line shows no price and the house has none either
 *   not_linked          the line matched no wine, so there is no house price
 *   kitchen             a kitchen (food) line, set aside: no stock row, no price (F-1297)
 *   new_wine            the house has no row for this wine yet; it is added with the menu's price
 */
export type PlanResult =
  | "change"
  | "unchanged"
  | "held_by_lock"
  | "blank_kept"
  | "blank_never_priced"
  | "not_linked"
  | "kitchen"
  | "cocktail"
  | "new_wine";

export interface PlanPerson {
  userId: string | null;
  name: string | null;
}

export interface PlanKind {
  kind: "bottle" | "glass";
  menuPrice: number | null;
  housePrice: number | null;
  result: PlanResult;
  /** For a price this choice would replace: who set it, when, and from where. */
  lastSet: { by: PlanPerson; at: string | null; source: string | null } | null;
  /**
   * A person set this wine's price (by hand, or by accepting advice) AFTER this
   * menu was read. The founder, 2026-09-21, confirming L11 verbatim: "The menu
   * sets it, locks keep" -- so the chosen menu replaces it, and the plan lists
   * it FIRST, with who and when, beside its Keep switch. Read from the open
   * version row, which carries both kinds of the wine: a glass edit marks the
   * bottle too (listed first when it need not be, never the other way round).
   */
  setAfterRead: boolean;
  /** The lock that holds this kind, when one does. */
  lock: { lockId: string; lockedPrice: number; lockedBy: PlanPerson; lockedAt: string } | null;
}

export interface PlanLine {
  menuItemId: string;
  /** As the menu reads. */
  name: string;
  producer: string | null;
  vintage: string | null;
  wineLibraryId: string | null;
  inventoryId: string | null;
  /** The house's own row for this wine, beside the line as read (L18). */
  house: { wineName: string | null; vintage: number | null; active: boolean } | null;
  bottle: PlanKind;
  glass: PlanKind;
  /** The flag the line will carry once this menu is current. */
  flag: PriceFlag | null;
  /** The menu of the batch this line is on, and its kind (ADR 0340 rule 18). */
  menuId: string;
  menuKind: string | null;
  /** The line's stored kind and section (ADR 0340 rule 7); decisive, so a tap after the plan moves it. */
  lineKind: string | null;
  sectionId: string | null;
  /**
   * A dish (not a drink) beside the same dish on the live menu of its kind,
   * matched by section key and name (ADR 0340 rule 18). Display only: a dish
   * has no house price. Null for a drink, or a dish with no match.
   */
  dish: {
    price: number | null;
    livePrice: number | null;
    changed: boolean;
  } | null;
  /** A locked wine that was not on the menu being replaced comes back with this one (L18). */
  returned: boolean;
  /** The vintages differ, a year against no year included: look before trusting the link (L18, F-661). */
  vintageMismatch: boolean;
}

export interface DormantLock {
  lockId: string;
  inventoryId: string;
  kind: "bottle" | "glass";
  lockedPrice: number;
  lockedBy: PlanPerson;
  lockedAt: string;
  wineName: string | null;
  active: boolean | null;
}

/** A current menu that choosing another one takes off (F-696). */
export interface RetiringMenu {
  menuId: string;
  name: string | null;
  /** Its kind: only the live menu of a kind the batch makes current retires (ADR 0340 rule 18). */
  kind: string | null;
  /** The lines on it now (discarded ones left out), every one of which leaves the menu. */
  lines: number;
}

export interface MenuPlan {
  menuId: string;
  /** Whether this menu is already the current one (choosing it again changes nothing). */
  current: boolean;
  /** When this menu was read (a legacy menu: when its row was made); null when neither is recorded. */
  readAt: string | null;
  generatedAt: string;
  /**
   * The plan's decisive content, hashed. `POST make-current` requires it and
   * refuses (409, nothing changed) when the plan it recomputes differs (L13).
   */
  fingerprint: string;
  lines: PlanLine[];
  /** Per kind, bottle and glass together. */
  counts: Record<PlanResult, number>;
  /** Every open lock whose wine is NOT on this menu: kept, dormant, never released by the choice (L16, L17). */
  dormantLocks: DormantLock[];
  /**
   * The menu this choice takes off, and how many lines leave with it (F-696).
   * `make_menu_current` archives every other current menu of the house (ADR
   * 0193 item 7), so a second list chosen ends the first. Empty when this
   * menu is already current or none is.
   */
  retiring: RetiringMenu[];
  /**
   * Why only part of this menu was read; null when it was read whole. Making
   * it current takes every line that was not read off the house's menu, so
   * make-current asks for `partReadAccepted` first (F-1292).
   */
  partRead?: string | null;
  /** Whether the people named in the plan could be named (L25). */
  namesReadable: boolean;
  namesReason: string | null;
  /** The house's IANA zone, for printing dates as the house's day (F-699); never decides the plan. */
  timezone?: string | null;
  /** Every menu of the batch, the URL's first (ADR 0340 rules 18, 20). */
  menus: PlanMenu[];
  /**
   * Lines of a live menu the batch replaces that the batch's menu of the same
   * kind does not list: they leave the menu unless kept (ADR 0340 rule 18,
   * "Gone from this kind"). Only the kinds in the batch.
   */
  gone: GoneLine[];
  /** Lines of a draft in the batch that cannot go live until a person says what they are (blocks their menu). */
  unsure: UnsureLine[];
  /** One wine at two prices of one price kind across the post-switch live set (blocks until picked; S198). */
  conflicts: PriceConflict[];
}

/** One menu of a make-live batch, as the plan reads it. */
export interface PlanMenu {
  menuId: string;
  kind: string | null;
  current: boolean;
  partRead: string | null;
  lines: number;
  /** Unsure lines on it, and conflicts one of its lines is in. A current menu blocks nothing. */
  unsure: number;
  conflicts: number;
}

/** A live line no menu of the batch lists (ADR 0340 rule 18). */
export interface GoneLine {
  menuId: string;
  menuItemId: string;
  name: string;
  kind: string | null;
  sectionKey: string | null;
}

/**
 * Why a draft line is Unsure (ADR 0340 rule 15, as far as lane 3c can tell):
 *   kind_not_decided   a Food or Desserts line with no stored kind
 *   no_drink_category  a line stored as a drink with no vocabulary category
 */
export type UnsureReason = "kind_not_decided" | "no_drink_category";

export interface UnsureLine {
  menuId: string;
  menuItemId: string;
  name: string;
  reason: UnsureReason;
}

/** One wine at two prices of one price kind (ADR 0340 rule 19). */
export interface PriceConflict {
  wineLibraryId: string;
  inventoryId: string | null;
  kind: "bottle" | "glass";
  name: string;
  prices: Array<{
    price: number;
    menuId: string;
    menuItemId: string;
    /** A live line (another kind's live menu, or a batch menu already current); never written before the switch. */
    live: boolean;
    menuKind: string | null;
  }>;
}

/** The owner's answer to one conflict: the one price this wine has, by price kind (S198). */
export interface PricePick {
  wineLibraryId: string;
  kind: "bottle" | "glass";
  price: number;
}

/** What `makeCurrent` takes beyond the URL's menu (ADR 0340 rule 20). */
export interface MakeCurrentBatch {
  /** The other menus of the batch; the URL's menu is always in it. */
  menuIds?: string[];
  picks?: PricePick[];
  /** The kinds whose part-read the person accepted (rule 17). */
  partReadAcceptedKinds?: string[];
}

/** A menu of the batch as `computePlan` takes it. */
interface BatchMenu {
  menuId: string;
  kind: string | null;
  current: boolean;
  readAt: string | null;
  partRead: string | null;
  lines: InsertedMenuItem[];
}

/** One menu's carry (ADR 0193 L11, ADR 0340 rule 4). */
interface CarryOutcome {
  lines: number;
  counts: Record<string, number>;
  flagged: number;
  failed: Array<{ menuItemId: string; name: string; error: string }>;
  held: MakeCurrentResult["held"];
  /** Whether `carried_at` is set: the carry wrote every line it could. */
  finished: boolean;
}

/** What choosing menus current answers (one menu, or a batch of one per kind). */
export interface MakeCurrentResult {
  /** made_current when any menu of the batch was made current by this call. */
  outcome: "made_current" | "already_current";
  menuId: string;
  previousMenuIds: string[];
  /** The URL's menu's moment of choice. */
  madeCurrentAt: string | null;
  lines: number;
  priceSync: Record<string, number>;
  flagged: number;
  failed: Array<{ menuItemId: string; name: string; error: string }>;
  held: Array<{
    menuItemId: string;
    name: string;
    kind: "bottle" | "glass";
    lockId: string;
    lockedPrice: number | null;
    lockedBy: string | null;
    lockedAt: string | null;
  }>;
  returned: Array<{ menuItemId: string; name: string }>;
  /** Per menu of the batch (ADR 0340 rule 4). */
  menus: Array<{
    menuId: string;
    kind: string | null;
    outcome: "made_current" | "already_current";
    madeCurrentAt: string | null;
    /** An already-current menu whose unfinished carry this call ran again. */
    recarried: boolean;
    carryFinished: boolean;
    lines: number;
  }>;
  /** How many conflicts the owner's picks answered. */
  picked: number;
}

/** A section's key and category, for matching lines across menus (ADR 0340 rules 6, 18). */
interface SectionKeyRow {
  key: string | null;
  parent_id: string | null;
  drink_category: string | null;
  confirmed_at: string | null;
}

/**
 * A name as two reads of one dish are compared (ADR 0340 rule 18): Turkish
 * dotted and dotless i folded, case folded, every run of non-letters and
 * non-digits one space.
 */
export function normalLineName(name: unknown): string {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/[İIı]/g, "i")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Why a menu was read only in part: the column (rule 17), else the legacy name prefix. */
function partReadOfRow(row: Record<string, any>): string | null {
  const col =
    typeof row.part_read === "string" && row.part_read.trim() !== ""
      ? row.part_read
      : null;
  return col ?? partReadOf(row.name);
}

function emptyPlanCounts(): Record<PlanResult, number> {
  return {
    change: 0,
    unchanged: 0,
    held_by_lock: 0,
    blank_kept: 0,
    blank_never_priced: 0,
    not_linked: 0,
    kitchen: 0,
    cocktail: 0,
    new_wine: 0,
  };
}

/** A menu line's price as a number, or null (blank, malformed or negative). */
function linePrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A four-digit year out of a vintage as the menu reads it, or null ("NV", blank, anything else). */
function yearOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1800 && v <= 2200) return v;
  const m = /\b(1[89]\d{2}|2[01]\d{2})\b/.exec(String(v ?? ""));
  return m ? Number(m[1]) : null;
}

/** When a kept menu was read: `extracted_at`, or, for a menu read before menus were kept, when its row was made. */
function readMomentOf(row: Record<string, unknown>): string | null {
  const at = row.extracted_at ?? row.created_at ?? null;
  return typeof at === "string" && at !== "" ? at : null;
}

/**
 * A price a PERSON set (`manual`: typed on /inventory, or a lock changed or
 * moved; `agent_accepted`: advice accepted) after the menu was read -- the case the founder's L11
 * confirmation names ("The menu sets it, locks keep"): the chosen menu replaces
 * it, and the plan lists it first with who and when. A price another menu set
 * (`import`) is not a person's, and an unknown moment on either side is not
 * "after".
 */
function setByAPersonAfter(set: { at: string | null; source: string | null }, readAt: string | null): boolean {
  if (set.source !== "manual" && set.source !== "agent_accepted") return false;
  if (!set.at || !readAt) return false;
  const a = Date.parse(set.at);
  const r = Date.parse(readAt);
  return Number.isFinite(a) && Number.isFinite(r) && a > r;
}

/**
 * One kept menu (ADR 0193, menu versions). `status` active = the current menu,
 * draft = read and kept but never chosen, archived = was current once;
 * `retiredAt` says until when. Legacy rows (read before menus were kept) have
 * `extractedAt: null`, and every field they never recorded is null, never a
 * guess.
 */
export interface MenuVersion {
  menuId: string;
  name: string | null;
  /** Why only part of this menu was read (cut short, pages skipped, parts failed); null when it was read whole (F-1292). */
  partRead: string | null;
  /** The menu kind (ADR 0340): `beverage` (Drinks), `food`, `desserts`; a legacy `full|bar|events` row says its old kind. */
  kind: string | null;
  status: "active" | "draft" | "archived" | string;
  current: boolean;
  cadence: MenuCadence | null;
  menuDate: string | null;
  menuDatePrecision: "day" | "month" | null;
  sourceMethod: "scan" | "csv" | "manual" | null;
  source: { kept: boolean; mime: string | null; bytes: number | null; failure: string | null };
  linesExtracted: number | null;
  extractedAt: string | null;
  extractedBy: { userId: string; name: string | null } | null;
  madeCurrentAt: string | null;
  madeCurrentBy: { userId: string; name: string | null } | null;
  retiredAt: string | null;
  retiredBy: { userId: string; name: string | null } | null;
  createdAt: string | null;
  /**
   * ADR 0340 rule 4: whether the carry of this menu's prices finished
   * (`carried_at`). null for a menu never made current; false for one made
   * current whose carry has not finished, including one made current before
   * `carried_at` existed; choosing it again finishes it.
   */
  carryFinished: boolean | null;
}

const VERSION_SELECT =
  "id, name, menu_type, status, cadence, menu_date, menu_date_precision, source_method, source_path, source_mime, source_bytes, source_failure, lines_extracted, extracted_at, extracted_by, made_current_at, made_current_by, retired_at, retired_by, created_at, part_read, carried_at";

/**
 * The columns every line read asks for. `raw_extracted_text` is read so
 * `lineForViewer` (menu-line-view.ts) can say `kitchen_line`; it leaves this
 * read only when the caller's view allows it (`MenuVersionsController.one`,
 * for a role that sees money and suppliers). A CSV line is the whole row
 * (csv-parser.service.ts:55), cost and supplier cells included, and no header
 * is kept to tell them apart. Other paths still carry the same text: the
 * import's reply and the kept source file (tech-debt.d, this branch's entries).
 */
export const LINE_SELECT =
  "id, name, producer, category, vintage, region, country, grape_variety, by_glass_price, bottle_price, wine_library_id, inventory_item_id, source, status, review_notes, price_flag, price_flag_note, raw_extracted_text, created_at, section_id, position, line_kind, drink_category, price";
/**
 * A discarded line: the member columns (no raw line: this read does not pass
 * through lineForViewer), and what it would go back to (F-268).
 * A literal, not built from LINE_SELECT, so check_read_columns_exist.py can
 * read it.
 */
const DISCARDED_LINE_SELECT =
  "id, name, producer, category, vintage, region, country, grape_variety, by_glass_price, bottle_price, wine_library_id, inventory_item_id, source, status, price_flag, price_flag_note, created_at, prior_status";

/** The words /logs prints for a discarded line (F-484): line, prices, menu. */
function discardSubject(
  row: {
    name?: string | null;
    by_glass_price?: number | string | null;
    bottle_price?: number | string | null;
  },
  menuName: string | null,
): string {
  const prices = [
    row.bottle_price != null ? `bottle ${row.bottle_price}` : null,
    row.by_glass_price != null ? `glass ${row.by_glass_price}` : null,
  ].filter(Boolean);
  const line = `${row.name?.trim() || "A line"}${prices.length ? ` (${prices.join(", ")})` : ""}`;
  return menuName ? `${line} on ${menuName}` : line;
}

/** The kinds of file a menu read keeps, sniffed from the bytes, never trusted from a name. */
function sniffMime(bytes: Buffer): { mime: string; ext: string } {
  if (bytes.subarray(0, 4).toString("latin1") === "%PDF") return { mime: "application/pdf", ext: "pdf" };
  if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG") return { mime: "image/png", ext: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  if (bytes.subarray(0, 3).toString("latin1") === "GIF") return { mime: "image/gif", ext: "gif" };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b)
    return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
  return { mime: "application/octet-stream", ext: "bin" };
}

/** A `YYYY-MM-DD` or `YYYY-MM` that is a real date, as the stored date and its precision. */
export function parseMenuDate(
  raw: string | null | undefined,
): { date: string; precision: "day" | "month" } | null {
  // null as well: @IsOptional() admits it, and "no date" is not a malformed one.
  if (raw === undefined || raw === null) return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(raw);
  if (!m) throw new BadRequestException("menuDate is a day (YYYY-MM-DD) or a month (YYYY-MM). Nothing was read.");
  const day = m[3] ?? "01";
  const d = new Date(`${m[1]}-${m[2]}-${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${day}`) {
    throw new BadRequestException(`${raw} is not a date on the calendar. Nothing was read.`);
  }
  return { date: `${m[1]}-${m[2]}-${day}`, precision: m[3] ? "day" : "month" };
}

/**
 * What happened to the house's own price when a menu line was written or
 * corrected (ADR 0193). Said per line, because a menu import that silently
 * dropped a price is the defect this build closes:
 *   changed    the house price now matches the menu line
 *   unchanged  it already did
 *   stale      a newer price is in effect (a manager set one after this line
 *              was dated); the menu line keeps its own price, the house's
 *              later price stands
 *   no_price   the line carries no price, so nothing was written
 *   not_linked the line has no inventory row, so there is no house price
 *   not_current the line's menu is not the current menu, so it does not set
 *              the house's price (ADR 0193, menu versions: a menu read is kept,
 *              and its prices reach the house when an owner or manager makes
 *              it current)
 *   failed     the write was refused or failed; `priceSyncError` says why
 *
 *   locked     every kind the line names is held by a price lock (ADR 0193
 *              round 3); a line that changed one kind while another was
 *              held says "changed" AND names the held kind in `priceHeld`
 *
 * Separately, `priceFlag` says a line was FLAGGED: its menu price was blank
 * for a price the house already has, so the house kept its last known price
 * (founder, 2026-09-21, answer 3), or it shows no price at all for a wine the
 * house has no price for either (round 6c answer 4, "Flag it").
 */
export type MenuPriceSync =
  | HousePriceOutcome
  | "no_price"
  | "not_linked"
  | "not_current"
  | "failed";

/** What one line did to the house price, and whether it was flagged. */
interface PriceSyncEntry {
  outcome: MenuPriceSync;
  error: string | null;
  flag: PriceFlag | null;
  flagNote: string | null;
  /** Every kind a price lock held (L5): never dropped from what is said. */
  held: HeldKind[];
  /** Set when the flag itself could not be written on the line. */
  flagError?: string;
}

export interface MenuImportReviewItem {
  menuItemId: string;
  inventoryItemId?: string | null;
  inventoryCreated?: boolean;
  submissionId: string | null;
  name: string;
  producer: string | null;
  category: string | null;
  vintage: string | null;
  region: string | null;
  grapeVariety: string | null;
  byGlassPrice: number | null;
  bottlePrice: number | null;
  rawText: string | null;
  matched: boolean;
  needsReview: boolean;
  /** ADR 0193: what this line did to the house's own price. */
  priceSync?: MenuPriceSync;
  priceSyncError?: string | null;
  /** ADR 0193: set when a blank menu price kept the house's last known one, or found none. */
  priceFlag?: PriceFlag | null;
  priceFlagNote?: string | null;
  /** ADR 0193 round 3: the kinds a price lock held, with their locks. */
  priceHeld?: HeldKind[];
}

@Injectable()
export class MenusService {
  restoreArrivalThreshold(
    restaurantId: string,
    actorId: string,
    batchId: string,
    rowId: string,
  ) {
    return restoreArrivalEntry(
      this.dbService,
      "threshold",
      restaurantId,
      actorId,
      batchId,
      rowId,
    );
  }

  /** Guarded seven-day restore, with expected values loaded from the sealed receipt. */
  restoreArrival(
    restaurantId: string,
    actorId: string,
    batchId: string,
    rowId: string,
  ) {
    return restoreArrivalEntry(
      this.dbService,
      "menu_item",
      restaurantId,
      actorId,
      batchId,
      rowId,
    );
  }

  private readonly logger = new Logger(MenusService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly csvParser: CsvParserService,
    private readonly scanParser: ScanParserService,
    private readonly wineSubmissions: WineSubmissionsService,
  ) {}

  /**
   * Read a menu and KEEP it as its own version (ADR 0193, menu versions; the
   * founder, 2026-09-21: keep all menu extractions -- the source and the
   * extracted lines -- over time; after a photo and an extraction the person
   * chooses whether it becomes the current menu; either way the extraction is
   * kept as ML data).
   *
   * This used to reuse the house's one `active` menu and append the lines to
   * it, seeding inventory and prices as it went: a re-scan was
   * indistinguishable from the menu it replaced and its source was thrown
   * away. Now every read is a NEW `restaurant_menus` row in `draft`, carrying
   * the source file (or why it could not be kept), the parser's lines as read,
   * who read it and when, and the person's optional cadence tag and date. Its
   * lines are resolved against the library and stored, but they do not touch
   * the house's inventory or prices: that happens when an owner or manager
   * makes it current (`makeCurrent`).
   */
  async importMenu(
    dto: ImportMenuDto,
    userId: string,
  ): Promise<{
    menuId: string;
    current: false;
    itemsExtracted: number;
    submissionsCreated: number;
    items: MenuImportReviewItem[];
    source: { kept: boolean; failure: string | null };
    /** A CSV or workbook's header cells that were not read, as written (F-070). */
    unreadColumns: string[];
    /** A spreadsheet read: those columns again, the rows skipped and why, the cells unread. */
    read: MenuReadNotes | null;
    /** Why a photo or PDF was read only in part; null when it was read whole (F-1292). */
    partRead: string | null;
    /**
     * Only with MENUS_SPLIT_BY_KIND (ADR 0340 rule 13): every draft the
     * upload made, Drinks first, and the id they share. `menuId` is the
     * Drinks draft, else the first.
     */
    drafts?: Array<{
      menuId: string;
      kind: DraftKind;
      items: MenuImportReviewItem[];
    }>;
    readTogetherId?: string;
  }> {
    const { restaurantId } = dto;
    // Checked before the billed read: a date that is not on the calendar
    // refuses the upload rather than failing after it was paid for.
    const menuDate = parseMenuDate(dto.menuDate);

    // 1. Parse input → WineExtractItem[]. A scan is the billed read; its spend
    // ceiling fails CLOSED (scan-parser.service.ts, ADR 0163 Q22).
    let items: WineExtractItem[];
    let sourceBytes: Buffer | null = null;
    let sourceMime: { mime: string; ext: string } | null = null;
    let read: MenuRead | null = null;
    const gaps: string[] = [];
    // ADR 0340 rule 13: the section read and the split by kind, OFF until
    // the founder turns it on after lane 8.
    const split = menusSplitByKind();
    if (dto.method === "scan") {
      items = await this.scanParser.parse(
        dto.data.imageBase64!,
        restaurantId,
        false,
        gaps,
        { sections: split },
      );
      sourceBytes = Buffer.from(dto.data.imageBase64!, "base64");
      sourceMime = sniffMime(sourceBytes);
    } else if (dto.method === "csv") {
      if (dto.data.fileBase64) {
        read = await this.csvParser.readExcel(
          dto.data.fileBase64,
          dto.groupMark ?? null,
          { sections: split },
        );
        sourceBytes = Buffer.from(dto.data.fileBase64, "base64");
        sourceMime = sniffMime(sourceBytes);
      } else {
        read = this.csvParser.read(
          dto.data.csvContent!,
          dto.groupMark ?? null,
          {
            sections: split,
          },
        );
        sourceBytes = Buffer.from(dto.data.csvContent!, "utf8");
        sourceMime = { mime: "text/csv", ext: "csv" };
      }
      items = read.items;
      gaps.push(...(read.gaps ?? []));
    } else {
      items = dto.data.items ?? [];
    }

    // A read that found no line is refused before anything is kept (F-680):
    // it made an empty version and ticked "menu uploaded", and the owner was
    // told only "Nothing was set". Now the reason is the answer.
    if (items.length === 0) {
      throw new BadRequestException(
        read?.emptyCause ??
          (dto.method === "scan"
            ? "We could not find any drinks on this page, so nothing was kept. Try a clearer photo or a PDF of the drinks list."
            : "There are no lines to keep, so nothing was kept."),
      );
    }

    // 2. Keep the source, or say why it was not kept.
    const kept =
      sourceBytes && sourceMime
        ? await this.keepSource(restaurantId, sourceBytes, sourceMime)
        : null;

    // 3. A new version, in draft: kept whether or not it is ever made current.
    const partRead = gaps.length ? [...new Set(gaps)].join("; ") : null;
    if (split)
      return this.importSplitByKind(
        dto,
        userId,
        items,
        kept,
        menuDate,
        partRead,
        read,
      );
    const menu = await this.createVersion(
      restaurantId,
      userId,
      dto,
      items,
      kept,
      menuDate,
      partRead,
      "beverage",
      crypto.randomUUID(),
    );

    // 4-6: resolve against the wine library, insert menu_items, and create the
    // governance submission trail. NOT current, so no inventory or price.
    // A failure here takes the version back out (F-1296): it used to stay
    // listed with N lines and hold none, under a bare "Internal server error".
    // ADR 0340 rule 12: the draft's sections are made from its lines'
    // categories, the house's layout carried over, in the same step, so a
    // failure to make them takes the version back out too.
    const resolving = this.resolveAndPersistItems(
      items,
      restaurantId,
      menu.id,
      userId,
      dto.method,
      false,
      menu.menu_type ?? null,
    );
    const persisting = resolving.then(async (lines) => {
      await this.materialiseSections(restaurantId, menu.id, userId);
      return lines;
    });
    const reviewItems = await this.linesOrNothingKept(
      restaurantId,
      menu.id,
      persisting,
    );

    // 7. Mark menu_uploaded for everyone on this restaurant (matches the
    // restaurant-scoped pattern used by vendor_added / team_member_invited).
    await this.markMenuUploaded(restaurantId);

    return {
      menuId: menu.id,
      current: false,
      itemsExtracted: items.length,
      submissionsCreated: reviewItems.filter((r) => r.submissionId).length,
      items: reviewItems,
      source: { kept: !!kept?.path, failure: kept?.failure ?? null },
      unreadColumns: read?.notes.ignoredColumns ?? [],
      read: read?.notes ?? null,
      partRead,
    };
  }

  /**
   * The split by kind (ADR 0340 rules 13 and 15, lane 5b), only with
   * MENUS_SPLIT_BY_KIND: one read becomes one draft per kind it found, made
   * in the order Drinks, Food, Desserts and sharing one `read_together_id`.
   * Each draft keeps its own lines (a dish and an Unsure line never reach
   * the resolver) and the sections they were printed under
   * (`materialise_read_sections`). Every draft carries the read's gaps: a
   * page or sheet that was not read could have held any kind (rule 17).
   * A failure anywhere takes every draft of the read back out, so an upload
   * is kept whole or not at all.
   */
  private async importSplitByKind(
    dto: ImportMenuDto,
    userId: string,
    items: WineExtractItem[],
    kept: {
      path: string | null;
      sha256: string;
      mime: string;
      bytes: number;
      failure: string | null;
    } | null,
    menuDate: { date: string; precision: "day" | "month" } | null,
    partRead: string | null,
    read: MenuRead | null,
  ) {
    const { restaurantId } = dto;
    // The §F12 second opinion on the read's headings: never fails the read.
    const headings = headingsOf(items);
    const opinion = headings.length
      ? await this.scanParser.classifyHeadings(headings, restaurantId)
      : null;
    const slices = splitByKind(items, opinion);
    const readTogetherId = crypto.randomUUID();
    const drafts: Array<{
      menuId: string;
      kind: DraftKind;
      items: MenuImportReviewItem[];
    }> = [];
    try {
      for (const slice of slices) {
        const menu = await this.createVersion(
          restaurantId,
          userId,
          dto,
          slice.items,
          kept,
          menuDate,
          partRead,
          slice.kind,
          readTogetherId,
        );
        const lines = await this.resolveAndPersistItems(
          slice.items,
          restaurantId,
          menu.id,
          userId,
          dto.method,
          false,
          menu.menu_type ?? null,
        );
        await this.materialiseReadSections(
          restaurantId,
          menu.id,
          userId,
          slice,
          lines,
        );
        drafts.push({ menuId: menu.id, kind: slice.kind, items: lines });
      }
    } catch (err: any) {
      this.logger.error(
        `Menu import failed after a draft was written: ${err?.message}`,
      );
      const left = await this.dropReadTogether(restaurantId, readTogetherId);
      throw new ServiceUnavailableException(
        left
          ? `The menu was read, but its lines could not be saved, and the drafts it started could not be removed (${left}). They show under Menus kept; read the menu again in a moment.`
          : "The menu was read, but its lines could not be saved, so nothing was kept. Read the menu again in a moment.",
      );
    }

    await this.markMenuUploaded(restaurantId);

    const all = drafts.flatMap((d) => d.items);
    return {
      menuId: (drafts.find((d) => d.kind === "beverage") ?? drafts[0]).menuId,
      current: false as const,
      itemsExtracted: items.length,
      submissionsCreated: all.filter((r) => r.submissionId).length,
      items: all,
      source: { kept: !!kept?.path, failure: kept?.failure ?? null },
      unreadColumns: read?.notes.ignoredColumns ?? [],
      read: read?.notes ?? null,
      partRead,
      drafts,
      readTogetherId,
    };
  }

  /**
   * A split draft's printed sections (rule 14), its lines placed under them
   * by the ids just written; the house's layout carried over by key.
   */
  private async materialiseReadSections(
    restaurantId: string,
    menuId: string,
    userId: string,
    slice: KindSlice,
    lines: MenuImportReviewItem[],
  ): Promise<void> {
    const { error } = await this.dbService.supabase.rpc(
      "materialise_read_sections",
      {
        p_restaurant_id: restaurantId,
        p_menu_id: menuId,
        p_actor: userId,
        p_sections: slice.sections.map((sec) => ({
          path: sec.path,
          suggested_kind: sec.suggestedKind,
          suggested_category: sec.suggestedCategory,
          suggested_by: sec.suggestedBy === "none" ? null : sec.suggestedBy,
          lines: sec.lines
            .map((i) => lines[i]?.menuItemId)
            .filter((id): id is string => typeof id === "string"),
        })),
      },
    );
    if (error) {
      throw new Error(
        `the menu's sections could not be made: ${error.message}`,
      );
    }
  }

  /**
   * Every draft of one read, its lines first, taken back out (rule 13: an
   * upload is kept whole or not at all). Returns null when they are gone, or
   * the reason they are not. Sections go with their menu (ON DELETE
   * CASCADE); the section log is append-only and keeps its rows.
   */
  private async dropReadTogether(
    restaurantId: string,
    readTogetherId: string,
  ): Promise<string | null> {
    const { data, error: readErr } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("read_together_id", readTogetherId);
    if (readErr) return readErr.message;
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) return null;
    const { error: linesErr } = await this.dbService.supabase
      .from("menu_items")
      .delete()
      .in("menu_id", ids)
      .eq("restaurant_id", restaurantId);
    if (linesErr) return linesErr.message;
    const { error } = await this.dbService.supabase
      .from("restaurant_menus")
      .delete()
      .eq("restaurant_id", restaurantId)
      .eq("read_together_id", readTogetherId)
      .eq("status", "draft");
    return error ? error.message : null;
  }

  /**
   * The lines of a just-written version, or, when they could not be matched
   * or saved, the version taken back out and a refusal that says nothing was
   * kept (F-1296).
   */
  private async linesOrNothingKept<T>(
    restaurantId: string,
    menuId: string,
    persisting: Promise<T>,
  ): Promise<T> {
    try {
      return await persisting;
    } catch (err: any) {
      this.logger.error(
        `Menu import failed after the version was written: ${err?.message}`,
      );
      const left = await this.dropUnfinishedVersion(restaurantId, menuId);
      throw new ServiceUnavailableException(
        left
          ? `The menu was read, but its lines could not be saved, and the empty menu it started could not be removed (${left}). It shows under Menus kept with no lines; read the menu again in a moment.`
          : "The menu was read, but its lines could not be saved, so nothing was kept. Read the menu again in a moment.",
      );
    }
  }

  /**
   * Remove a version whose lines could not be written (F-1296), its lines
   * first. Returns null when it is gone, or the reason it is not.
   */
  private async dropUnfinishedVersion(
    restaurantId: string,
    menuId: string,
  ): Promise<string | null> {
    const { error: linesErr } = await this.dbService.supabase
      .from("menu_items")
      .delete()
      .eq("menu_id", menuId)
      .eq("restaurant_id", restaurantId);
    if (linesErr) return linesErr.message;
    const { error } = await this.dbService.supabase
      .from("restaurant_menus")
      .delete()
      .eq("id", menuId)
      .eq("restaurant_id", restaurantId);
    return error ? error.message : null;
  }

  /** Arrival reads evidence without creating menu, library or inventory rows. */
  async previewArrivalMenu(
    method: "scan" | "csv",
    content: string,
    restaurantId: string,
    binary = false,
  ): Promise<WineExtractItem[]> {
    const read =
      method === "scan"
        ? null
        : binary
          ? await this.csvParser.readExcel(content)
          : this.csvParser.read(content);
    const items = read
      ? read.items
      : await this.scanParser.parse(content, restaurantId, true);
    if (!items.length)
      throw new BadRequestException(
        read?.emptyCause ??
          "No supported beverage items were extracted. Nothing was imported.",
      );
    if (items.length > 500)
      throw new BadRequestException(
        "This menu contains more than 500 entries. Divide the evidence into smaller files.",
      );
    return items.map(({ raw_text: _raw, ...item }) => item);
  }

  /** A kept version after Arrival's held seal — not made current (ADR 0193). */
  async importParsedItems(
    items: WineExtractItem[],
    restaurantId: string,
    userId: string,
    method: "scan" | "csv" | "manual",
  ) {
    const dto = { restaurantId, method, data: { items } } as ImportMenuDto;
    // Arrival reads with the drinks prompt only, so its draft is the Drinks
    // draft by what was read, never by a default (ADR 0340 rule 13).
    const menu = await this.createVersion(
      restaurantId,
      userId,
      dto,
      items,
      null,
      null,
      null,
      "beverage",
      crypto.randomUUID(),
    );
    // The same step an upload takes (ADR 0340 rule 12, F-1296): lines, then
    // sections; a failure in either takes the version back out.
    const persisting = this.resolveAndPersistItems(
      items,
      restaurantId,
      menu.id,
      userId,
      method,
      false,
      menu.menu_type ?? null,
    ).then(async (lines) => {
      await this.materialiseSections(restaurantId, menu.id, userId);
      return lines;
    });
    const reviewItems = await this.linesOrNothingKept(
      restaurantId,
      menu.id,
      persisting,
    );
    return {
      menuId: menu.id,
      current: false,
      itemsExtracted: items.length,
      submissionsCreated: reviewItems.filter((r) => r.submissionId).length,
      items: reviewItems,
    };
  }

  /**
   * The source file, content-addressed under the house in the private bucket
   * the gateway already keeps original bytes in. A failed write is returned as
   * a reason (stored on the version), never swallowed into a menu that looks
   * kept -- the same rule document intake follows for its originals.
   */
  private async keepSource(
    restaurantId: string,
    bytes: Buffer,
    type: { mime: string; ext: string },
  ): Promise<{ path: string | null; sha256: string; mime: string; bytes: number; failure: string | null }> {
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const path = `${restaurantId}/menus/${sha256}.${type.ext}`;
    try {
      const { error } = await this.dbService.supabase.storage
        .from(SOURCE_BUCKET)
        .upload(path, bytes, { contentType: type.mime, upsert: true });
      if (error) {
        return { path: null, sha256, mime: type.mime, bytes: bytes.length, failure: `the source file was not kept: ${error.message}` };
      }
      return { path, sha256, mime: type.mime, bytes: bytes.length, failure: null };
    } catch (err: any) {
      return {
        path: null,
        sha256,
        mime: type.mime,
        bytes: bytes.length,
        failure: `the source file was not kept: ${err?.message ?? "unknown error"}`,
      };
    }
  }

  private async createVersion(
    restaurantId: string,
    userId: string,
    dto: ImportMenuDto,
    items: WineExtractItem[],
    kept: { path: string | null; sha256: string; mime: string; bytes: number; failure: string | null } | null,
    menuDate: { date: string; precision: "day" | "month" } | null,
    partRead: string | null,
    // ADR 0340 rule 13: the kind the read decided for this draft, passed by
    // every caller; never defaulted here.
    kind: DraftKind,
    // Rule 10: the id every draft of one upload shares.
    readTogetherId: string,
  ): Promise<{ id: string; menu_type?: string | null }> {
    const { data, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .insert({
        restaurant_id: restaurantId,
        // Named for what it holds (F-018: every drink, not only the wine);
        // rule 17: the name carries no data, the reason a read is partial
        // is its own column.
        name: DRAFT_NAMES[kind],
        part_read: partRead,
        menu_type: kind,
        status: "draft",
        cadence: dto.cadence ?? null,
        menu_date: menuDate?.date ?? null,
        menu_date_precision: menuDate?.precision ?? null,
        source_method: dto.method,
        source_path: kept?.path ?? null,
        source_sha256: kept?.path ? kept.sha256 : null,
        source_mime: kept?.mime ?? null,
        source_bytes: kept?.bytes ?? null,
        source_failure: kept?.failure ?? null,
        extraction: items,
        lines_extracted: items.length,
        extracted_by: userId,
        extracted_at: new Date().toISOString(),
        // ADR 0340 rule 10: the drafts of one upload share an id, so a
        // section can move to a Food or Desserts draft made in the review
        // (move_menu_section_to_kind) even when the read produced one draft.
        read_together_id: readTogetherId,
      })
      .select("id, menu_type")
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(
        `The menu was read but could not be kept, so nothing was saved: ${error?.message ?? "no row returned"}`,
      );
    }
    return data as { id: string; menu_type?: string | null };
  }

  /**
   * Adds one manager-entered wine to an existing menu during the review step.
   *
   * TENANT CHECK, added 2026-09-17 alongside `/menu`'s add/discard build
   * (ADR 0160 sec110 item 7). Before this, the lookup ran on `dto.menuId`
   * alone — a caller authenticated for ANY restaurant could add a line to a
   * DIFFERENT restaurant's menu by supplying its (non-secret, guessable by
   * enumeration) menu id, because nothing compared `menu.restaurant_id`
   * against the caller's own. `callerRestaurantId` is optional only so a
   * legacy call site missing it is refused loudly (`ForbiddenException`)
   * rather than silently — never so the check can be skipped.
   *
   * 2026-09-25 (PR #446, merged over #434): the house is now part of the
   * lookup itself, and another house's menu id is the SAME 404 as a missing
   * one (ADR 0147: a row that is not the caller's is a 404). #434 answered it
   * 403 "does not belong to the caller's restaurant", which told any
   * signed-in caller that the id is a real menu. A failed read is an error
   * (500), no longer folded into "not found". A session naming no house stays
   * a 403, the refusal ADR 0193 item 6 gives the sibling PATCH route.
   */
  async addMenuItem(
    dto: AddMenuItemDto,
    userId: string,
    callerRestaurantId?: string | null,
    // Whether the caller is the house's owner or a manager (resolved by the
    // controller). Matters only when the menu is the CURRENT one: a line added
    // there is a stock row and a wine-library submission, and a priced one
    // sets the house's own price (founder, 2026-09-21, answer 1). Adding to it
    // is the same act as taking a line off it (F-268, F-698).
    callerManages = false,
  ): Promise<MenuImportReviewItem> {
    if (!callerRestaurantId) {
      throw new ForbiddenException(
        "This session is not attached to a restaurant, so no line can be added to a menu.",
      );
    }
    const { data: menu, error: menuErr } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id, restaurant_id, status, menu_type")
      .eq("id", dto.menuId)
      .eq("restaurant_id", callerRestaurantId)
      .maybeSingle();

    if (menuErr) {
      throw new Error(`Could not read the menu ${dto.menuId}: ${menuErr.message}`);
    }
    if (!menu || menu.restaurant_id !== callerRestaurantId) {
      throw new NotFoundException("Menu not found");
    }

    const isCurrent = menu.status === "active";
    if (isCurrent && !callerManages) {
      throw new ForbiddenException(
        "Only an owner or a manager can add a line to the current menu: it adds the wine to the house's stock, and a price on it sets the house's own price. Nothing was added.",
      );
    }

    const item: WineExtractItem = {
      name: dto.name,
      producer: dto.producer,
      category: dto.category,
      vintage: dto.vintage,
      region: dto.region,
      grape_variety: dto.grape_variety,
      by_glass_price: dto.by_glass_price,
      bottle_price: dto.bottle_price,
    };

    // ADR 0340 rule 8: the line is judged by lineIsDrink on this menu's kind,
    // so a line added to a Food or Desserts menu (drafts and live alike) is
    // not sent to the library and, live, makes no stock row or price.
    const [reviewItem] = await this.resolveAndPersistItems(
      [item],
      menu.restaurant_id,
      menu.id,
      userId,
      "manual",
      isCurrent,
      menu.menu_type ?? null,
    );

    // Manager-added rows are always flagged for review, regardless of match.
    await this.dbService.supabase
      .from("menu_items")
      .update({
        status: "flagged",
        review_notes: "Manually added during review",
      })
      .eq("id", reviewItem.menuItemId)
      .eq("restaurant_id", callerRestaurantId);

    if (reviewItem.submissionId) {
      await this.dbService.supabase.from("override_events").insert({
        submission_id: reviewItem.submissionId,
        actor_id: userId,
        field_name: "name",
        old_value: null,
        new_value: dto.name,
        reason: "Manually added during import review",
        promotion_status: "pending",
      });
    }

    return { ...reviewItem, needsReview: true };
  }

  /**
   * Discards one line from the active menu (ADR 0160 sec110 item 7). A soft
   * remove — `status = 'discarded'` (migration 20260922230100) — never a
   * DELETE: what it cost and who added it stays in the record, `getMenu`
   * just stops serving it as live. Tenant-scoped by `restaurantId`, taken
   * from the URL path (the controller's `:restaurantId`, matched against the
   * JWT by `JwtAuthGuard` before this ever runs) — never from the body, and
   * the row's own `restaurant_id` is checked again here so a menu item id
   * from a different restaurant 404s rather than silently discarding
   * someone else's line.
   *
   * WHO AND WHEN (F-484, 2026-10-09). The discard writes one
   * `system_audit_log` row — `menu_line_discarded`, the actor, the line, its
   * menu and its prices at the moment it went — so /logs says who took it off
   * and when. No `discarded_by`/`discarded_at` columns were added: the audit
   * row is the record /logs already reads, it carries the time and the
   * prices the columns would not, and two records of one act can disagree.
   * Like `recordAccessChange`, a failed audit write does not undo the
   * discard (the line is already off the menu); it is logged and the reply
   * says `audited: false`, so a missing record is said, not inferred.
   */
  async discardMenuItem(
    restaurantId: string,
    menuItemId: string,
    actorUserId: string | null = null,
  ): Promise<{ menuItemId: string; status: "discarded"; audited: boolean }> {
    const { data: row, error: readErr } = await this.dbService.supabase
      .from("menu_items")
      .select(
        "id, restaurant_id, status, menu_id, name, by_glass_price, bottle_price",
      )
      .eq("id", menuItemId)
      .maybeSingle();

    if (readErr) {
      throw new Error(`Could not read the menu item: ${readErr.message}`);
    }
    if (!row || row.restaurant_id !== restaurantId) {
      throw new NotFoundException("No menu item of this restaurant");
    }

    // Discarding a line twice keeps the status it had the first time: writing
    // 'discarded' over prior_status would leave nothing to put it back to.
    // Nothing was written, so no audit row either (F-484).
    if (row.status === "discarded")
      return { menuItemId, status: "discarded", audited: false };

    // What the line was before it went, for the audit row (F-484).
    const before = { ...row };

    // The house again on the write, not only on the read above: the write is
    // what must never land on another house's row. prior_status keeps the
    // status the line had (a_discarded_menu_line_remembers_its_status, F-268),
    // so restoreMenuItem can put it back exactly as it stood.
    const { error: writeErr } = await this.dbService.supabase
      .from("menu_items")
      .update({ status: "discarded", prior_status: row.status ?? null })
      .eq("id", menuItemId)
      .eq("restaurant_id", restaurantId);

    if (writeErr) {
      throw new Error(`The item was not discarded: ${writeErr.message}`);
    }

    const audited = await this.recordMenuLineAudit(
      restaurantId,
      before,
      actorUserId,
      "menu_line_discarded",
      "discarded",
    );
    return { menuItemId, status: "discarded", audited };
  }

  /**
   * The audit half of `discardMenuItem` (F-484) and `restoreMenuItem`
   * (F-1419): one row naming who moved the line, which line, on which menu
   * and at what price. Never throws.
   */
  private async recordMenuLineAudit(
    restaurantId: string,
    row: {
      id: string;
      status: string | null;
      menu_id?: string | null;
      name?: string | null;
      by_glass_price?: number | string | null;
      bottle_price?: number | string | null;
    },
    actorUserId: string | null,
    action: "menu_line_discarded" | "menu_line_restored",
    toStatus: string,
  ): Promise<boolean> {
    const verb = action === "menu_line_restored" ? "put back" : "discarded";
    try {
      let menuName: string | null = null;
      if (row.menu_id) {
        const { data: menu, error: menuError } = await this.dbService.supabase
          .from("restaurant_menus")
          .select("name")
          .eq("id", row.menu_id)
          .eq("restaurant_id", restaurantId)
          .maybeSingle();
        // The line is still recorded; only the menu's name is left out.
        if (menuError) {
          this.logger.warn(
            `menu line ${row.id} ${verb}: menu ${row.menu_id} unread (${menuError.message}); recorded without its name`,
          );
        }
        menuName = menu?.name ?? null;
      }
      const { error } = await this.dbService.supabase
        .from("system_audit_log")
        .insert({
          actor_type: actorUserId ? "user" : "system",
          actor_id: actorUserId,
          action,
          entity_type: "menu_item",
          entity_id: row.id,
          restaurant_id: restaurantId,
          reason: null,
          changes: {
            // Read on /logs as one phrase: "Opus One (bottle 120, glass 18) on Wine List".
            subject: discardSubject(row, menuName),
            fields: { status: { from: row.status ?? null, to: toStatus } },
            menu_id: row.menu_id ?? null,
            menu_name: menuName,
            bottle_price: row.bottle_price ?? null,
            by_glass_price: row.by_glass_price ?? null,
          },
        });
      if (error) {
        this.logger.error(
          `menu line ${row.id} was ${verb} but the audit row failed: ${error.message}`,
        );
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error(
        `menu line ${row.id} was ${verb} but the audit row threw: ${err?.message ?? err}`,
      );
      return false;
    }
  }

  /**
   * Puts a discarded line back on the menu (F-268; coordinator's call for the
   * founder, 2026-10-08). It returns to the status it had when it was
   * discarded; a line discarded before menu_items kept that (prior_status
   * NULL) comes back 'in_review', which the page states. Tenant-scoped the
   * same way as discardMenuItem: a foreign or missing id 404s. A line that is
   * not discarded is left as it is (a second tap changes nothing).
   *
   * WHO AND WHEN (F-1419, 2026-10-11): like the discard, the restore files a
   * `menu_line_restored` row naming the actor, and a failed audit write is
   * said as `audited: false` rather than undoing the restore.
   */
  async restoreMenuItem(
    restaurantId: string,
    menuItemId: string,
    actorUserId: string | null = null,
  ): Promise<{ menuItemId: string; status: string; audited: boolean }> {
    const { data: row, error: readErr } = await this.dbService.supabase
      .from("menu_items")
      .select(
        "id, restaurant_id, status, prior_status, menu_id, name, by_glass_price, bottle_price",
      )
      .eq("id", menuItemId)
      .maybeSingle();

    if (readErr) {
      throw new Error(`Could not read the menu item: ${readErr.message}`);
    }
    if (!row || row.restaurant_id !== restaurantId) {
      throw new NotFoundException("No menu item of this restaurant");
    }
    if (row.status !== "discarded")
      return { menuItemId, status: row.status, audited: false };

    const status: string = row.prior_status ?? "in_review";
    // What the line was before it came back, for the audit row (F-1419).
    const before = { ...row };
    const { error: writeErr } = await this.dbService.supabase
      .from("menu_items")
      .update({ status, prior_status: null })
      .eq("id", menuItemId)
      .eq("restaurant_id", restaurantId)
      .eq("status", "discarded");

    if (writeErr) {
      throw new Error(`The item was not put back: ${writeErr.message}`);
    }

    const audited = await this.recordMenuLineAudit(
      restaurantId,
      before,
      actorUserId,
      "menu_line_restored",
      status,
    );
    return { menuItemId, status, audited };
  }

  /**
   * The lines taken off the house's current menus, so an owner or a manager
   * can see them and put one back (F-268). Same paged read as getMenu, the
   * other half of the status split; no current menu means none. Every live
   * kind's discarded lines are read (ADR 0340 rule 25), through the one
   * current-menu read, which throws on a failed read.
   */
  async getDiscardedLines(
    restaurantId: string,
  ): Promise<{ items: Array<Record<string, unknown>> }> {
    const activeIds = (
      await readCurrentMenuRows(this.dbService.supabase, restaurantId)
    ).map((m) => m.id);
    if (activeIds.length === 0) return { items: [] };

    // Paged like readLines (PostgREST stops at 1000 rows without saying so);
    // a failed page is an error, never a shorter list.
    const items: Array<Record<string, unknown>> = [];
    let after: string | null = null;
    for (;;) {
      let q = this.dbService.supabase
        .from("menu_items")
        .select(DISCARDED_LINE_SELECT)
        .in("menu_id", activeIds)
        .eq("restaurant_id", restaurantId)
        .eq("status", "discarded");
      if (after) q = q.gt("id", after);
      const { data, error } = await q
        .order("id", { ascending: true })
        .limit(PAGE_ROWS);
      if (error)
        throw new Error(`Failed to load the discarded lines: ${error.message}`);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      items.push(...rows);
      if (rows.length < PAGE_ROWS) break;
      after = String(rows[rows.length - 1].id);
    }
    items.sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? "")),
    );
    return { items };
  }

  /**
   * Applies a manager's inline correction to one menu_items field.
   *
   * The edit takes effect immediately for this restaurant's own inventory
   * (managers are trusted for their own data) and is logged as an
   * override_events row against the item's submission for global governance
   * review — it does NOT mutate the shared master_wine_library row, since
   * other restaurants may be matched to the same provisional wine.
   */
  async reviewMenuItem(
    menuItemId: string,
    userId: string,
    callerRestaurantId: string | null | undefined,
    dto: ReviewMenuItemDto,
  ): Promise<{
    menuItemId: string;
    fieldName: string;
    newValue: string;
    priceSync?: MenuPriceSync;
    priceSyncError?: string | null;
    priceHeld?: HeldKind[];
  }> {
    // TENANT CHECK (ADR 0193, fixed before this route could write a price).
    // `PATCH /menus/items/:id` names no restaurant, so `JwtAuthGuard`'s
    // path/body comparison has nothing to compare, and this lookup used to run
    // on the id ALONE: a caller authenticated for any house could correct --
    // and, from this build on, re-price -- another house's menu line by its
    // id. The house now comes from the verified token and the row is read
    // scoped to it; a foreign or unknown id is the same 404, so the route does
    // not confirm another house's ids exist. No house on the token is refused.
    if (!callerRestaurantId) {
      throw new ForbiddenException(
        "This session is not attached to a restaurant, so no menu line can be corrected.",
      );
    }
    const { data: menuItem, error } = await this.dbService.supabase
      .from("menu_items")
      .select("*")
      .eq("id", menuItemId)
      .eq("restaurant_id", callerRestaurantId)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not read the menu item: ${error.message}`);
    }
    if (!menuItem || menuItem.restaurant_id !== callerRestaurantId) {
      throw new NotFoundException("No menu item of this restaurant");
    }

    const oldValue = (menuItem as Record<string, unknown>)[dto.fieldName];
    const isPrice = PRICE_FIELDS.has(dto.fieldName);
    const newValueTyped: string | number = isPrice
      ? parseFloat(dto.newValue.replace(/[^0-9.]/g, ""))
      : dto.newValue;

    if (isPrice && Number.isNaN(newValueTyped as number)) {
      throw new BadRequestException(
        `Invalid numeric value for ${dto.fieldName}`,
      );
    }

    // A rename also renames the house's own wine in stock. Who may rename a
    // line at all (owner or manager) is the controller's check. The stock is
    // renamed FIRST, and its error is read: if it fails, nothing is written
    // and the person is told, rather than a renamed line beside a stock row
    // that silently kept the old name (F-920).
    const renamesStock =
      dto.fieldName === "name" && Boolean(menuItem.inventory_item_id);
    if (renamesStock) {
      const { error: renameErr } = await this.dbService.supabase
        .from("restaurant_inventory")
        .update({ wine_name: dto.newValue })
        .eq("id", menuItem.inventory_item_id)
        .eq("restaurant_id", callerRestaurantId);
      if (renameErr) {
        throw new InternalServerErrorException(
          `The wine could not be renamed in your stock, so the menu line was not renamed either: ${renameErr.message}`,
        );
      }
    }

    const { error: updateErr } = await this.dbService.supabase
      .from("menu_items")
      .update({
        [dto.fieldName]: newValueTyped,
        status: "flagged",
        review_notes: `Manager corrected ${dto.fieldName}`,
        // A manager correcting the price IS the look the blank-price flag
        // asked for (founder, 2026-09-21, answer 3): the flag is answered.
        ...(isPrice ? { price_flag: null, price_flag_note: null } : {}),
      })
      .eq("id", menuItemId)
      .eq("restaurant_id", callerRestaurantId);

    // An InternalServerErrorException, so the sentence reaches the page: a
    // plain Error reached it as "Internal server error", and the page then
    // said "Nothing was changed." beside a stock row already renamed (F-1002).
    if (updateErr) {
      throw new InternalServerErrorException(
        renamesStock
          ? `The wine was renamed in your stock, but the menu line was not: ${updateErr.message}`
          : `The menu line was not saved: ${updateErr.message}`,
      );
    }

    // A PRICE correction is a menu update, and a menu update changes the
    // house's own price (ADR 0193, founder 2026-09-21: "it could be changed
    // every time a menu is updated") -- when the line is on the CURRENT menu.
    // A kept menu that is not current does not set the house's price (menu
    // versions). Written through set_house_menu_price as change_source
    // 'import', dated now, by the person on the token. Who may correct a
    // price at all (owner or manager) is the controller's check.
    let priceSync: MenuPriceSync | undefined;
    let priceSyncError: string | null = null;
    let priceHeld: HeldKind[] = [];
    let lineMenuCurrent = false;
    if (isPrice) {
      const { data: lineMenu, error: lineMenuErr } = await this.dbService.supabase
        .from("restaurant_menus")
        .select("status")
        .eq("id", menuItem.menu_id)
        .eq("restaurant_id", callerRestaurantId)
        .maybeSingle();
      if (lineMenuErr) {
        // The line is already corrected; whether the house price should
        // follow is unknown, and that is said, not guessed.
        priceSync = "failed";
        priceSyncError = `the line's menu could not be read, so the house price was not updated: ${lineMenuErr.message}`;
      } else {
        lineMenuCurrent = (lineMenu as { status?: string } | null)?.status === "active";
      }
    }
    if (isPrice && priceSync === undefined) {
      if (!lineMenuCurrent) {
        priceSync = "not_current";
      } else if (!menuItem.inventory_item_id) {
        priceSync = "not_linked";
      } else {
        try {
          const r = await setHouseMenuPrice(this.dbService.supabase, {
            restaurantId: callerRestaurantId,
            inventoryId: menuItem.inventory_item_id,
            ...(dto.fieldName === "bottle_price"
              ? { bottle: newValueTyped as number }
              : { glass: newValueTyped as number }),
            source: "import",
            changedBy: userId,
            reason: `menu line corrected (${dto.fieldName})`,
            menuId: menuItem.menu_id ?? null,
          });
          priceSync = r.outcome;
          priceHeld = r.held;
        } catch (err) {
          priceSync = "failed";
          priceSyncError = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `menu_item ${menuItemId}: the house price was not updated: ${priceSyncError}`,
          );
        }
      }
    }

    if (menuItem.submission_id) {
      const { error: overrideErr } = await this.dbService.supabase
        .from("override_events")
        .insert({
          submission_id: menuItem.submission_id,
          actor_id: userId,
          field_name: dto.fieldName,
          old_value:
            oldValue !== null && oldValue !== undefined
              ? String(oldValue)
              : null,
          new_value: String(newValueTyped),
          reason: "Manager correction during menu import review",
          promotion_status: "pending",
        });

      if (overrideErr) {
        this.logger.warn(
          `Failed to log override_event for menu_item ${menuItemId} (non-fatal): ${overrideErr.message}`,
        );
      }
    }

    return {
      menuItemId,
      fieldName: dto.fieldName,
      newValue: dto.newValue,
      ...(priceSync !== undefined ? { priceSync, priceSyncError, priceHeld } : {}),
    };
  }

  /**
   * Read path for the interactive menu (decision 39 — the menus module had
   * no GET at all, which is why no menu page could exist). Returns every
   * live menu of the house (one per kind, ADR 0340) and their lines.
   * A line's raw line is sent only when `view.rawLine` says so (default: not);
   * a reply without it says `rawLineWithheld: true`.
   *
   * `kinds` names each live menu (Drinks, Food, Desserts order). The root
   * `menuId` / `name` / `status` and `items` keep the one-menu shape for the
   * pages that read it today: `items` is the union of every live kind's
   * lines, each saying its `menu_id` and `menu_type`, and `menuId` is the
   * live Drinks menu, or, when no Drinks menu is live, the first live kind's
   * (the menu a one-menu house was already shown). Two live kinds are no
   * longer an error: `.maybeSingle()` failed on them (ADR 0340 rule 25).
   */
  async getMenu(
    restaurantId: string,
    view: LineView = { rawLine: false },
  ): Promise<{
    menuId: string | null;
    name: string | null;
    status: string | null;
    kinds: Array<{
      menuId: string;
      kind: string | null;
      name: string | null;
      status: string;
    }>;
    items: Array<Record<string, unknown>>;
    rawLineWithheld?: true;
    housePricesReadable?: boolean;
    housePricesReason?: string | null;
    soldOutReadable?: boolean;
    soldOutReason?: string | null;
  }> {
    const live = await readCurrentMenuRows(
      this.dbService.supabase,
      restaurantId,
    );
    const withheld = view.rawLine ? {} : { rawLineWithheld: true as const };
    if (live.length === 0)
      return {
        menuId: null,
        name: null,
        status: null,
        kinds: [],
        items: [],
        ...withheld,
      };
    const menu = live.find((m) => m.menu_type === "beverage") ?? live[0];

    // A discarded line (migration 20260922230100, ADR 0160 sec110 item 7) is
    // a soft remove: the row stays for the record, but this read path must
    // not keep serving it as live. Read in pages: PostgREST stops at 1000
    // rows without saying so, and a long wine list is exactly that long.
    const items = await this.readLinesOf(live, restaurantId, view);
    const house = await this.readHousePrices(restaurantId, items);
    const out = await this.readSoldOut(restaurantId, house.items);

    return {
      menuId: menu.id,
      name: menu.name,
      status: menu.status,
      kinds: live.map((m) => ({
        menuId: m.id,
        kind: m.menu_type,
        name: m.name,
        status: m.status,
      })),
      items: out.items,
      ...withheld,
      housePricesReadable: house.readable,
      housePricesReason: house.reason,
      soldOutReadable: out.readable,
      soldOutReason: out.reason,
    };
  }

  /**
   * The Full menu (ADR 0340 rule 22, §F10): every live kind of the house as
   * one document, composed here so the page, an export and the phase-2 guest
   * page read the same thing. Kind blocks come in the house's order
   * (`restaurants.menu_kind_order`, else Drinks, Food, Desserts); each holds
   * its sections as a tree in the house's order, its lines by position, and
   * the lines in no section.
   *
   * - Every line goes through `lineForViewer` (`readLinesOf`): the
   *   `MEMBER_LINE_KEYS` allowlist, `kitchen_line`, and never the raw line,
   *   whoever reads (rule 23: every role reads the prices it reads today).
   * - 86 marks (`readSoldOut`) are asked for drink lines only: a dish is
   *   never marked sold out, whatever stock row a legacy line still links.
   * - Once a Food menu is live, a legacy dish on the live Drinks menu (no
   *   stored `line_kind`, the legacy rule says kitchen) is left off the
   *   document and named in `hiddenDishes`; before that it shows in its
   *   section, as today.
   *
   * Every read is this house's (`restaurant_id`); a failed read throws, never
   * a shorter menu (ADR 0067). A failed 86 read marks nothing and says so.
   */
  async getFullMenu(restaurantId: string): Promise<FullMenu> {
    const db = this.dbService.supabase;
    const live = await readCurrentMenuRows(db, restaurantId);
    const order = await this.readKindOrder(restaurantId);
    const readAt = new Date().toISOString();
    const empty: FullMenu = {
      readAt,
      kindOrder: order.kindOrder,
      kindOrderSet: order.set,
      kinds: [],
      hiddenDishes: [],
      rawLineWithheld: true,
      soldOutReadable: true,
      soldOutReason: null,
    };
    if (live.length === 0) return empty;

    const lines = await this.readLinesOf(live, restaurantId, {
      rawLine: false,
    });
    const sections = await this.readFullMenuSections(
      restaurantId,
      live.map((m) => m.id),
    );
    const drinks = lines.filter((l) => l.kitchen_line !== true);
    const sold = await this.readSoldOut(restaurantId, drinks);
    const marked = new Map(sold.items.map((l) => [String(l.id), l]));
    const all = lines.map((l) => marked.get(String(l.id)) ?? l);

    const foodLive = live.some((m) => m.menu_type === "food");
    const foodNames = new Set(
      all.filter((l) => l.menu_type === "food").map((l) => sameName(l.name)),
    );
    const isHidden = (l: Record<string, unknown>) =>
      foodLive &&
      l.menu_type === "beverage" &&
      (l.line_kind === null || l.line_kind === undefined) &&
      l.kitchen_line === true;
    const hiddenDishes = all.filter(isHidden).map((l) => ({
      id: String(l.id),
      name: String(l.name ?? ""),
      menuId: String(l.menu_id),
      onFood: foodNames.has(sameName(l.name)),
    }));

    const rank = (kind: string | null) => {
      const at = order.kindOrder.indexOf(String(kind));
      return at === -1 ? order.kindOrder.length : at;
    };
    const kinds = [...live]
      .sort((a, b) => rank(a.menu_type) - rank(b.menu_type))
      .map((m): FullMenuKind => {
        const nodes = new Map<string, FullMenuSection>();
        for (const s of sections.filter((x) => x.menu_id === m.id)) {
          nodes.set(String(s.id), {
            id: String(s.id),
            parentId: typeof s.parent_id === "string" ? s.parent_id : null,
            title: String(s.title ?? ""),
            position: Number(s.position ?? 0),
            drinkCategory:
              typeof s.drink_category === "string" ? s.drink_category : null,
            lines: [],
            sections: [],
          });
        }
        const top: FullMenuSection[] = [];
        for (const node of nodes.values()) {
          const parent = node.parentId ? nodes.get(node.parentId) : undefined;
          (parent ? parent.sections : top).push(node);
        }
        const unsorted: Array<Record<string, unknown>> = [];
        for (const l of all) {
          if (l.menu_id !== m.id || isHidden(l)) continue;
          const node =
            typeof l.section_id === "string"
              ? nodes.get(l.section_id)
              : undefined;
          (node ? node.lines : unsorted).push(l);
        }
        const tidy = (list: FullMenuSection[]) => {
          list.sort(
            (a, b) => a.position - b.position || a.id.localeCompare(b.id),
          );
          for (const n of list) {
            n.lines.sort(byPlace);
            tidy(n.sections);
          }
        };
        tidy(top);
        unsorted.sort(byPlace);
        return {
          kind: String(m.menu_type),
          menuId: m.id,
          name: m.name,
          madeCurrentAt: m.made_current_at,
          sections: top,
          unsorted,
        };
      });

    return {
      ...empty,
      kinds,
      hiddenDishes,
      soldOutReadable: sold.readable,
      soldOutReason: sold.reason,
    };
  }

  /**
   * The order of the house's kind blocks on the Full menu. A stored value
   * that is not the three kinds once each (the CHECK forbids it) reads as the
   * default. A failed read throws: the page says it, never a guessed order.
   */
  private async readKindOrder(
    restaurantId: string,
  ): Promise<{ kindOrder: string[]; set: boolean }> {
    const { data, error } = await this.dbService.supabase
      .from("restaurants")
      .select("menu_kind_order")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        `The order of this house's menus could not be read: ${error.message}`,
      );
    }
    const stored = (data as { menu_kind_order?: unknown } | null)
      ?.menu_kind_order;
    return isMenuKindOrder(stored)
      ? { kindOrder: [...stored], set: true }
      : { kindOrder: [...LIVE_MENU_KINDS], set: false };
  }

  /** The sections of these menus of this house, keyset-paged. A failed page throws. */
  private async readFullMenuSections(
    restaurantId: string,
    menuIds: string[],
  ): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    let after: string | null = null;
    for (;;) {
      let q = this.dbService.supabase
        .from("menu_sections")
        .select(FULL_MENU_SECTION_COLUMNS)
        .eq("restaurant_id", restaurantId)
        .in("menu_id", menuIds);
      if (after) q = q.gt("id", after);
      const { data, error } = await q
        .order("id", { ascending: true })
        .limit(PAGE_ROWS);
      if (error) {
        throw new InternalServerErrorException(
          `The sections of this house's menus could not be read: ${error.message}`,
        );
      }
      const page = (data ?? []) as Array<Record<string, unknown>>;
      rows.push(...page);
      if (page.length < PAGE_ROWS) break;
      after = String(page[page.length - 1].id);
    }
    return rows;
  }

  /**
   * Sets the order of the kind blocks on the Full menu (ADR 0340 rule 22):
   * the three kinds, each once. The caller has checked the person may manage
   * the house. Nothing else on the house row is written.
   */
  async setMenuKindOrder(
    restaurantId: string,
    order: unknown,
  ): Promise<{ kindOrder: string[] }> {
    if (!isMenuKindOrder(order)) {
      throw new BadRequestException(
        "The order names Drinks, Food and Desserts (beverage, food, desserts) once each. Nothing was changed.",
      );
    }
    const { data, error } = await this.dbService.supabase
      .from("restaurants")
      .update({ menu_kind_order: order })
      .eq("id", restaurantId)
      .select("id");
    if (error) {
      throw new InternalServerErrorException(
        `The order of the menus was not saved: ${error.message}. Nothing was changed.`,
      );
    }
    if (!data || (data as unknown[]).length === 0) {
      throw new NotFoundException("That restaurant was not found.");
    }
    return { kindOrder: [...order] };
  }

  /**
   * F-145 (S195). A line whose wine is 86'd (an open stock_outs row,
   * 20261231900000) is sent `sold_out: true`, so the house's menu shows it
   * unavailable. Read in this house only. A failed read marks nothing and
   * says `soldOutReadable: false` with the reason -- never a menu that looks
   * as if nothing is sold out.
   *
   * F-1474: a cocktail is a line with no stock row of its own. It is matched
   * to the house's cocktail by its exact name (the till's rule, F-1329), and
   * is sold out while any recipe line linked to stock takes from an 86'd
   * row; `sold_out_because` names those lines in the bar's words. A failed
   * cocktail read marks no cocktail and says so; the wines stand.
   */
  private async readSoldOut(
    restaurantId: string,
    items: Array<Record<string, unknown>>,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    readable: boolean;
    reason: string | null;
  }> {
    const recipes = await this.readMenuCocktails(restaurantId, items);
    const ids = [
      ...new Set([
        ...items
          .map((i) => i.inventory_item_id)
          .filter((v): v is string => typeof v === "string" && v !== ""),
        ...recipes.lines.map((l) => l.inventory_id),
      ]),
    ];
    const cocktailReason = recipes.error
      ? `Which cocktails an 86'd ingredient stops could not be read, so none is marked (${recipes.error}).`
      : null;
    if (ids.length === 0) {
      return { items, readable: !cocktailReason, reason: cocktailReason };
    }
    const out = new Set<string>();
    for (let k = 0; k < ids.length; k += 200) {
      const { data, error } = await this.dbService.supabase
        .from("stock_outs")
        .select("inventory_id")
        .eq("restaurant_id", restaurantId)
        .is("ended_at", null)
        .in("inventory_id", ids.slice(k, k + 200));
      if (error) {
        return {
          items,
          readable: false,
          reason: `Which drinks are sold out could not be read, so none is marked; that is not the same as none sold out (${error.message}).`,
        };
      }
      for (const r of (data ?? []) as Array<Record<string, unknown>>)
        out.add(String(r.inventory_id));
    }
    const stopped = cocktailsSoldOut(recipes.lines, out);
    return {
      items: items.map((i) => {
        if (
          typeof i.inventory_item_id === "string" &&
          out.has(i.inventory_item_id)
        ) {
          return { ...i, sold_out: true };
        }
        const cocktailId = recipes.byLine.get(i);
        const because = cocktailId ? stopped.get(cocktailId) : undefined;
        return because
          ? { ...i, sold_out: true, sold_out_because: because }
          : i;
      }),
      readable: !cocktailReason,
      reason: cocktailReason,
    };
  }

  /**
   * F-1474: the house's cocktail each line with no stock row of its own
   * names, by its exact name, and those cocktails' recipe lines linked to
   * stock. A name two cocktails share names neither; a retired cocktail
   * names none.
   */
  private async readMenuCocktails(
    restaurantId: string,
    items: Array<Record<string, unknown>>,
  ): Promise<{
    byLine: Map<Record<string, unknown>, string>;
    lines: Array<{
      cocktail_id: string;
      inventory_id: string;
      free_text: string | null;
    }>;
    error: string | null;
  }> {
    const byLine = new Map<Record<string, unknown>, string>();
    const none = { byLine, lines: [], error: null };
    // F-1505: a cocktail line carried before F-1470 still holds its old
    // 0-stock row as inventory_item_id; its section says it is a cocktail,
    // so it is matched by name too.
    const bare = items.filter(
      (i) =>
        (!i.inventory_item_id ||
          isCocktailLine(i.category, i.name, i.drink_category)) &&
        cocktailNameKey(i.name as string) !== "",
    );
    if (bare.length === 0) return none;
    const { data: cocktails, error } = await this.dbService.supabase
      .from("cocktails")
      .select("id, name, display_name")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null);
    if (error) return { ...none, error: error.message };
    const byName = new Map<string, string>();
    const shared = new Set<string>();
    for (const c of (cocktails ?? []) as Array<Record<string, unknown>>) {
      for (const key of new Set(
        [c.name, c.display_name]
          .filter((v): v is string => typeof v === "string" && v !== "")
          .map(cocktailNameKey),
      )) {
        if (byName.has(key) && byName.get(key) !== c.id) shared.add(key);
        else byName.set(key, String(c.id));
      }
    }
    for (const key of shared) byName.delete(key);
    for (const i of bare) {
      const id = byName.get(cocktailNameKey(i.name as string));
      if (id) byLine.set(i, id);
    }
    const cocktailIds = [...new Set(byLine.values())];
    if (cocktailIds.length === 0) return none;
    const { data: lines, error: linesError } = await this.dbService.supabase
      .from("cocktail_ingredients")
      .select("cocktail_id, inventory_id, free_text")
      .in("cocktail_id", cocktailIds);
    if (linesError) return { ...none, error: linesError.message };
    return {
      byLine,
      lines: ((lines ?? []) as Array<Record<string, unknown>>)
        .filter((l) => typeof l.inventory_id === "string")
        .map((l) => ({
          cocktail_id: String(l.cocktail_id),
          inventory_id: String(l.inventory_id),
          free_text: typeof l.free_text === "string" ? l.free_text : null,
        })),
      error: null,
    };
  }

  /**
   * F-618. The house's price (`menu_price_current` / `menu_price_glass`) is
   * what /inventory, the reports, the POS and the advice read. Making a menu
   * current sets it from the lines (ADR 0193 item 4), and since S195 any other
   * change of it is written onto the current menu's lines (migration
   * 20270105500000), so the two agree. They still differ where ADR 0193 keeps
   * them apart: a locked price, a stale line, or a line older than that
   * migration. So each linked line is sent the house's price beside its own:
   * `house_bottle_price` / `house_glass_price`, null when the house has none.
   * Neither is chosen over the other here; the page shows both when they
   * differ. Read in this house only. A failed read sends no house price and
   * says `housePricesReadable: false` with the reason -- never a line that
   * looks like it agrees.
   */
  private async readHousePrices(
    restaurantId: string,
    items: Array<Record<string, unknown>>,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    readable: boolean;
    reason: string | null;
  }> {
    const ids = [
      ...new Set(
        items
          .map((i) => i.inventory_item_id)
          .filter((v): v is string => typeof v === "string" && v !== ""),
      ),
    ];
    if (ids.length === 0) return { items, readable: true, reason: null };
    const prices = new Map<
      string,
      { bottle: number | null; glass: number | null }
    >();
    const num = (v: unknown) =>
      v === null || v === undefined || !Number.isFinite(Number(v))
        ? null
        : Number(v);
    for (let k = 0; k < ids.length; k += 200) {
      const { data, error } = await this.dbService.supabase
        .from("restaurant_inventory")
        .select("id, menu_price_current, menu_price_glass")
        .eq("restaurant_id", restaurantId)
        .in("id", ids.slice(k, k + 200));
      if (error) {
        return {
          items,
          readable: false,
          reason: `This house's own prices could not be read, so a line whose price differs from them is not marked (${error.message}).`,
        };
      }
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        prices.set(String(r.id), {
          bottle: num(r.menu_price_current),
          glass: num(r.menu_price_glass),
        });
      }
    }
    return {
      items: items.map((i) => {
        const p =
          typeof i.inventory_item_id === "string"
            ? prices.get(i.inventory_item_id)
            : undefined;
        return p
          ? { ...i, house_bottle_price: p.bottle, house_glass_price: p.glass }
          : i;
      }),
      readable: true,
      reason: null,
    };
  }

  /**
   * The house's CURRENT menus and every live line on them — the set
   * `/promotions`' "On my menu" rung reads (founder item 36; research-filters
   * adversarial pass F1/F2). Only `status = 'active'` versions: a draft (read,
   * never chosen) or an archived menu (current once) is not "on my menu".
   * A house keeps one live menu per kind (ADR 0340), so this returns the
   * union of up to three, each menu and line saying its kind; `opts.kinds`
   * narrows it to those kinds. The menus come from the one current-menu read
   * (`readCurrentMenuRows`), which throws on a failed read. Every line is
   * read through `readLines` (keyset-paged; discarded lines excluded), so a
   * list past PostgREST's 1000-row stop is read whole. `readAt` is when the
   * menu became current, else when it was read, else its own date — never a
   * draft's `created_at` (F8).
   */
  async readCurrentMenus(
    restaurantId: string,
    opts: { kinds?: readonly string[] } = {},
  ): Promise<{
    menus: Array<{
      menuId: string;
      kind: string | null;
      name: string | null;
      readAt: string | null;
    }>;
    lines: Array<
      Record<string, unknown> & { menu_id: string; menu_type: string | null }
    >;
  }> {
    const actives = await readCurrentMenuRows(
      this.dbService.supabase,
      restaurantId,
      opts.kinds,
    );
    return {
      menus: actives.map((m) => ({
        menuId: m.id,
        kind: m.menu_type,
        name: m.name,
        readAt: m.made_current_at ?? m.extracted_at ?? m.menu_date ?? null,
      })),
      lines: (await this.readLinesOf(actives, restaurantId)) as Array<
        Record<string, unknown> & { menu_id: string; menu_type: string | null }
      >,
    };
  }

  /**
   * Every live line of these current menus, menu by menu in the order given
   * (kind order, from `readCurrentMenuRows`), each line saying its `menu_id`
   * and its menu's `menu_type`, so no reader has to guess a line's kind.
   */
  private async readLinesOf(
    menus: CurrentMenuRow[],
    restaurantId: string,
    view: LineView = { rawLine: false },
  ): Promise<Array<Record<string, unknown>>> {
    const lines: Array<Record<string, unknown>> = [];
    for (const m of menus) {
      for (const line of await this.readLines(
        m.id,
        restaurantId,
        view,
        m.menu_type,
      ))
        lines.push({ ...line, menu_id: m.id, menu_type: m.menu_type });
    }
    return lines;
  }

  /**
   * Every live line of one menu of this house, keyset-paged on id and then
   * ordered for reading (section, then name). A failed page is an error, never
   * a shorter menu. Each row goes through `lineForViewer`: the allowlisted
   * keys and `kitchen_line` for everyone, the raw line only when the caller
   * says the viewer may see it (default: not). The plan, make-current and
   * readCurrentMenus readers pass no view, so they get no raw line.
   * `menuKind` is the menu's `menu_type`, which `kitchen_line` is judged on
   * (ADR 0340 rule 8); null (a reader that only counts lines or reads their
   * wine ids) judges by the legacy rule.
   */
  private async readLines(
    menuId: string,
    restaurantId: string,
    view: LineView = { rawLine: false },
    menuKind: string | null = null,
  ): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    let after: string | null = null;
    for (;;) {
      let q = this.dbService.supabase
        .from("menu_items")
        .select(LINE_SELECT)
        .eq("menu_id", menuId)
        .eq("restaurant_id", restaurantId)
        .neq("status", "discarded");
      if (after) q = q.gt("id", after);
      const { data, error } = await q.order("id", { ascending: true }).limit(PAGE_ROWS);
      if (error) throw new Error(`Failed to load menu items: ${error.message}`);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      out.push(...rows);
      if (rows.length < PAGE_ROWS) break;
      after = String(rows[rows.length - 1].id);
    }
    const key = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    out.sort(
      (a, b) =>
        key(a.category).localeCompare(key(b.category)) || key(a.name).localeCompare(key(b.name)),
    );
    return out.map((row) => lineForViewer(row, view, menuKind));
  }

  // ── Menu versions (ADR 0193; founder 2026-09-21, answer 7) ────────────────

  /**
   * Every menu this house has read, newest first, with the current one and the
   * last one used named. The founder: keep ALL menu extractions, accessible
   * over time; a "current menu" and the "last one used". A failed read is an
   * error, never an empty history.
   */
  async listVersions(restaurantId: string): Promise<{
    /** The live Drinks menu, else the first live kind's: the one-menu shape pages read today. */
    current: MenuVersion | null;
    /** Every live menu by its kind (ADR 0340): `beverage`, `food`, `desserts`; a kind with no live menu is null. */
    currentByKind: Record<string, MenuVersion | null>;
    lastUsed: MenuVersion | null;
    versions: MenuVersion[];
    namesReadable: boolean;
    namesReason: string | null;
    /** The house's IANA zone, so the page prints each date as the house's day (F-699); null when unset or unread. */
    timezone: string | null;
  }> {
    const rows: Array<Record<string, any>> = [];
    let after: string | null = null;
    for (;;) {
      let q = this.dbService.supabase
        .from("restaurant_menus")
        .select(VERSION_SELECT)
        .eq("restaurant_id", restaurantId);
      if (after) q = q.gt("id", after);
      const { data, error } = await q.order("id", { ascending: true }).limit(PAGE_ROWS);
      if (error) {
        throw new InternalServerErrorException(`The house's menus could not be read: ${error.message}`);
      }
      const page = (data ?? []) as Array<Record<string, any>>;
      rows.push(...page);
      if (page.length < PAGE_ROWS) break;
      after = String(page[page.length - 1].id);
    }
    const { names, error: namesError } = await this.namesOf(
      rows.flatMap((r) => [r.extracted_by, r.made_current_by, r.retired_by]),
    );
    const versions = rows
      .map((r) => this.toVersion(r, names))
      .sort((a, b) => String(b.extractedAt ?? b.createdAt ?? "").localeCompare(String(a.extractedAt ?? a.createdAt ?? "")));
    const currentByKind: Record<string, MenuVersion | null> = {};
    for (const kind of LIVE_MENU_KINDS)
      currentByKind[kind] =
        versions.find((v) => v.current && v.kind === kind) ?? null;
    const current =
      currentByKind.beverage ??
      LIVE_MENU_KINDS.map((k) => currentByKind[k]).find((v) => v !== null) ??
      versions.find((v) => v.current) ??
      null;
    const lastUsed =
      versions
        .filter((v) => v.status === "archived" && v.retiredAt)
        .sort((a, b) => String(b.retiredAt).localeCompare(String(a.retiredAt)))[0] ?? null;
    return {
      current,
      currentByKind,
      lastUsed,
      versions,
      namesReadable: namesError === null,
      namesReason: namesError === null ? null : `who read or chose these menus could not be named: ${namesError}`,
      timezone: await this.houseZone(restaurantId),
    };
  }

  /**
   * The house's IANA zone (`restaurants.timezone`), so a page prints a moment
   * as the house's day, not UTC's (F-699). Null when none is set or the read
   * fails: the page then prints the day as stored, never the reader's clock.
   */
  private async houseZone(restaurantId: string): Promise<string | null> {
    const { data, error } = await this.dbService.supabase
      .from("restaurants")
      .select("timezone")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) return null;
    const zone = (data as { timezone?: unknown } | null)?.timezone;
    return typeof zone === "string" && zone ? zone : null;
  }

  /**
   * One kept menu of this house and its lines. Another house's id is a 404.
   * A line's raw line is sent only when `view.rawLine` says so (default: not);
   * a reply without it says `rawLineWithheld: true`.
   */
  async getVersion(
    restaurantId: string,
    menuId: string,
    view: LineView = { rawLine: false },
  ): Promise<{
    version: MenuVersion;
    items: Array<Record<string, unknown>>;
    namesReadable: boolean;
    namesReason: string | null;
    rawLineWithheld?: true;
  }> {
    const row = await this.readVersionRow(restaurantId, menuId);
    const { names, error } = await this.namesOf([row.extracted_by, row.made_current_by, row.retired_by]);
    return {
      version: this.toVersion(row, names),
      items: await this.readLines(
        menuId,
        restaurantId,
        view,
        row.menu_type ?? null,
      ),
      namesReadable: error === null,
      namesReason: error === null ? null : `who read or chose this menu could not be named: ${error}`,
      ...(view.rawLine ? {} : { rawLineWithheld: true as const }),
    };
  }

  /**
   * A short-lived link to the kept source file (the photo, PDF or CSV the menu
   * was read from). A version with no kept source says why (404 with the
   * stored reason), never an empty link.
   */
  async sourceUrl(
    restaurantId: string,
    menuId: string,
  ): Promise<{ url: string; expiresInSeconds: number; mime: string | null }> {
    const row = await this.readVersionRow(restaurantId, menuId);
    if (!row.source_path) {
      throw new NotFoundException(
        row.source_failure
          ? `This menu's source was not kept: ${row.source_failure}`
          : row.source_method === "manual"
            ? "This menu was typed in, so there is no source file."
            : "This menu was read before menus were kept, so there is no source file.",
      );
    }
    const { data, error } = await this.dbService.supabase.storage
      .from(SOURCE_BUCKET)
      .createSignedUrl(row.source_path, SOURCE_URL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new InternalServerErrorException(
        `A link to this menu's source could not be made: ${error?.message ?? "no link returned"}`,
      );
    }
    return { url: data.signedUrl, expiresInSeconds: SOURCE_URL_SECONDS, mime: row.source_mime ?? null };
  }

  /**
   * What choosing this menu WOULD do (ADR 0193 round 3, L13): per line and per
   * kind, the house price, the menu price and the planned result; for a price
   * that would be replaced, who set it and when; every lock that holds a kind;
   * and every open lock whose wine is not on this menu. The founder,
   * 2026-09-21: "add a section to that where you can lock price, but wha f that
   * menu item disappears?" -- this is that section's data. Nothing is written.
   * A failed read is a 5xx, so make-current cannot go ahead on a plan nobody
   * saw (L25).
   *
   * ADR 0340 rules 18-20: `batchIds` names the other menus that go live with
   * this one (one per kind). The plan is worked out against the live set as
   * it would be after the switch: the batch, plus every other kind's live
   * menu. Every menu is looked up inside the house (another house's id: 404).
   */
  async planFor(
    restaurantId: string,
    menuId: string,
    batchIds: string[] = [],
  ): Promise<MenuPlan> {
    const batch: BatchMenu[] = [];
    let primary: Record<string, any> | null = null;
    for (const id of [...new Set([menuId, ...batchIds])]) {
      const row = await this.readVersionRow(restaurantId, id);
      if (!primary) primary = row;
      const lines = (await this.readLines(
        id,
        restaurantId,
        { rawLine: false },
        row.menu_type ?? null,
      )) as unknown as InsertedMenuItem[];
      batch.push({
        menuId: id,
        kind: row.menu_type ?? null,
        current: row.status === "active",
        readAt: readMomentOf(row),
        partRead: partReadOfRow(row),
        lines,
      });
    }
    const plan = await this.computePlan(restaurantId, batch);
    // Names are for reading the plan; they never decide it (the fingerprint
    // leaves them out). A failed read is said.
    const ids = new Set<string>();
    for (const l of plan.lines) {
      for (const k of [l.bottle, l.glass]) {
        if (k.lastSet?.by.userId) ids.add(k.lastSet.by.userId);
        if (k.lock?.lockedBy.userId) ids.add(k.lock.lockedBy.userId);
      }
    }
    for (const d of plan.dormantLocks) if (d.lockedBy.userId) ids.add(d.lockedBy.userId);
    const { names, error } = await this.namesOf([...ids]);
    const named = (p: PlanPerson): PlanPerson => ({ userId: p.userId, name: p.userId ? (names.get(p.userId) ?? null) : null });
    for (const l of plan.lines) {
      for (const k of [l.bottle, l.glass]) {
        if (k.lastSet) k.lastSet.by = named(k.lastSet.by);
        if (k.lock) k.lock.lockedBy = named(k.lock.lockedBy);
      }
    }
    for (const d of plan.dormantLocks) d.lockedBy = named(d.lockedBy);
    return {
      ...plan,
      partRead: partReadOfRow(primary ?? {}),
      namesReadable: error === null,
      namesReason: error === null ? null : `the people named in this plan could not be named: ${error}`,
      timezone: await this.houseZone(restaurantId),
    };
  }

  /**
   * The plan itself, from what the house holds NOW. Shared by `planFor` (the
   * page) and `makeCurrent` (which recomputes it and compares fingerprints).
   * Every read that decides it throws on failure: a plan with a hole in it is
   * not a plan.
   *
   * ADR 0340 rule 18: "being replaced", "retiring", `returned` and
   * `dormantLocks` are worked out against the post-switch live set: a live
   * menu retires only when the batch makes a menu of ITS kind current, and a
   * lock on a wine another kind's live menu lists is not dormant.
   */
  private async computePlan(
    restaurantId: string,
    batch: BatchMenu[],
  ): Promise<MenuPlan> {
    const client = this.dbService.supabase;
    const fail = (what: string, message: string): never => {
      throw new InternalServerErrorException(
        `What choosing this menu would do could not be worked out, so nothing was changed: ${what} could not be read (${message}).`,
      );
    };
    const primary = batch[0];

    // The house's wines, every one (keyset-paged): which line lands on which row.
    const house = new Map<string, Record<string, any>>();
    {
      let after: string | null = null;
      for (;;) {
        let q = client
          .from("restaurant_inventory")
          .select("id, master_wine_id, wine_name, is_active, deleted_at, menu_price_current, menu_price_glass, master_wine_library(vintage)")
          .eq("restaurant_id", restaurantId);
        if (after) q = q.gt("id", after);
        const { data, error } = await q.order("id", { ascending: true }).limit(PAGE_ROWS);
        if (error) fail("the house's wines", error.message);
        const rows = (data ?? []) as Array<Record<string, any>>;
        for (const r of rows) if (r.master_wine_id) house.set(String(r.master_wine_id), r);
        if (rows.length < PAGE_ROWS) break;
        after = String(rows[rows.length - 1].id);
      }
    }
    const byInventory = new Map<string, Record<string, any>>();
    for (const r of house.values()) byInventory.set(String(r.id), r);

    const lockRead = await readOpenLocks(client, restaurantId);
    if (lockRead.error !== null) fail("the house's price locks", lockRead.error);
    const locks = new Map<string, OpenLock>(lockRead.locks.map((l) => [`${l.inventoryId}:${l.kind}`, l]));
    const lockedWines = new Set(lockRead.locks.map((l) => l.inventoryId));

    // Who set each price now in effect (the open version row).
    const lastSet = new Map<string, { by: string | null; at: string | null; source: string | null }>();
    {
      let after: string | null = null;
      for (;;) {
        let q = client
          .from("menu_price_versions")
          .select("id, inventory_id, changed_by, effective_from, change_source")
          .eq("restaurant_id", restaurantId)
          .is("effective_to", null);
        if (after) q = q.gt("id", after);
        const { data, error } = await q.order("id", { ascending: true }).limit(PAGE_ROWS);
        if (error) fail("who set the house's prices", error.message);
        const rows = (data ?? []) as Array<Record<string, any>>;
        for (const r of rows) {
          lastSet.set(String(r.inventory_id), {
            by: r.changed_by ?? null,
            at: r.effective_from ?? null,
            source: r.change_source ?? null,
          });
        }
        if (rows.length < PAGE_ROWS) break;
        after = String(rows[rows.length - 1].id);
      }
    }

    // The post-switch live set (ADR 0340 rule 18). A live menu not in the
    // batch RETIRES when the batch makes a menu of its kind current; any
    // other stays live beside the batch.
    const batchIds = new Set(batch.map((b) => b.menuId));
    const replacedKinds = new Set(
      batch.filter((b) => !b.current).map((b) => b.kind),
    );
    let actives: CurrentMenuRow[] = [];
    try {
      actives = await readCurrentMenuRows(client, restaurantId);
    } catch (err: any) {
      fail("the current menus", err?.message ?? String(err));
    }
    const readLive = async (m: CurrentMenuRow): Promise<InsertedMenuItem[]> => {
      try {
        return (await this.readLines(
          m.id,
          restaurantId,
          { rawLine: false },
          m.menu_type,
        )) as unknown as InsertedMenuItem[];
      } catch (err: any) {
        return fail("a current menu's lines", err?.message ?? String(err));
      }
    };
    const retiringMenus: Array<{
      row: CurrentMenuRow;
      lines: InsertedMenuItem[];
    }> = [];
    const stayingMenus: Array<{
      row: CurrentMenuRow;
      lines: InsertedMenuItem[];
    }> = [];
    for (const m of actives) {
      if (batchIds.has(m.id)) continue;
      const entry = { row: m, lines: await readLive(m) };
      if (replacedKinds.has(m.menu_type)) retiringMenus.push(entry);
      else stayingMenus.push(entry);
    }

    // Section keys of the batch and of what it replaces: a dish, and a line
    // with no wine, is matched across two reads by (section key, name).
    const sections = await this.readSectionKeys(restaurantId, [
      ...batchIds,
      ...retiringMenus.map((m) => m.row.id),
    ]);
    if (sections.error !== null) fail("the menus' sections", sections.error);
    const sectionKeyOf = (l: InsertedMenuItem): string | null =>
      l.section_id
        ? (sections.rows.get(String(l.section_id))?.key ?? null)
        : null;
    const identityOf = (l: InsertedMenuItem): string => {
      const wine = carriedWine(l);
      return wine
        ? `w:${wine}`
        : `n:${sectionKeyOf(l) ?? ""}|${normalLineName(l.name)}`;
    };

    // The wines on the menu each kind replaces, for L18's "returned".
    const onReplaced = new Map<string | null, Set<string>>();
    const replacedLineByIdentity = new Map<
      string | null,
      Map<string, InsertedMenuItem>
    >();
    for (const { row, lines } of retiringMenus) {
      const wines = onReplaced.get(row.menu_type) ?? new Set<string>();
      const byIdentity =
        replacedLineByIdentity.get(row.menu_type) ??
        new Map<string, InsertedMenuItem>();
      for (const line of lines) {
        if (line.wine_library_id) wines.add(String(line.wine_library_id));
        byIdentity.set(identityOf(line), line);
      }
      onReplaced.set(row.menu_type, wines);
      replacedLineByIdentity.set(row.menu_type, byIdentity);
    }

    const counts = emptyPlanCounts();
    // Every house row a line of the post-switch live set lists (dormant locks).
    const onLiveSet = new Set<string>();
    for (const { lines } of stayingMenus) {
      for (const line of lines) {
        const wineId = carriedWine(line);
        const row = wineId ? house.get(wineId) : undefined;
        if (row) onLiveSet.add(String(row.id));
      }
    }
    const planLines: PlanLine[] = [];
    for (const menu of batch) {
      const replacing = onReplaced.has(menu.kind);
      const replaced = onReplaced.get(menu.kind) ?? new Set<string>();
      for (const line of menu.lines) {
        const wineId = carriedWine(line);
        const row = wineId ? (house.get(wineId) ?? null) : null;
        if (row) onLiveSet.add(String(row.id));
        const menuB = linePrice(line.bottle_price);
        const menuG = linePrice(line.by_glass_price);
        const houseB = row ? linePrice(row.menu_price_current) : null;
        const houseG = row ? linePrice(row.menu_price_glass) : null;
        // Each menu of the batch is dated by its own read.
        const readAt = menu.readAt;
        const kindPlan = (
          kind: "bottle" | "glass",
          menuPrice: number | null,
          housePrice: number | null,
        ): PlanKind => {
          const lock = row ? (locks.get(`${row.id}:${kind}`) ?? null) : null;
          let result: PlanResult;
          if (line.kitchen_line === true) result = "kitchen";
          else if (
            isCocktailLine(line.category, line.name, line.drink_category)
          )
            result = "cocktail";
          else if (!wineId) result = "not_linked";
          else if (!row)
            result = menuPrice === null ? "blank_never_priced" : "new_wine";
          else if (menuPrice === null)
            result = housePrice === null ? "blank_never_priced" : "blank_kept";
          else if (lock) result = "held_by_lock";
          else if (
            housePrice !== null &&
            Math.abs(menuPrice - housePrice) < 0.005
          )
            result = "unchanged";
          else result = "change";
          counts[result] += 1;
          const set =
            row && result === "change"
              ? (lastSet.get(String(row.id)) ?? null)
              : null;
          return {
            kind,
            menuPrice,
            housePrice,
            result,
            lastSet: set
              ? {
                  by: { userId: set.by, name: null },
                  at: set.at,
                  source: set.source,
                }
              : null,
            setAfterRead: !!set && setByAPersonAfter(set, readAt),
            lock: lock
              ? {
                  lockId: lock.lockId,
                  lockedPrice: lock.lockedPrice,
                  lockedBy: { userId: lock.lockedBy, name: null },
                  lockedAt: lock.lockedAt,
                }
              : null,
          };
        };
        const bottle = kindPlan("bottle", menuB, houseB);
        const glass = kindPlan("glass", menuG, houseG);
        // The same rule the carry writes (carryMenuPrice): answer 3, then answer 4.
        let flag: PriceFlag | null = null;
        if (wineId) {
          if (
            (menuB === null && houseB !== null) ||
            (menuG === null && houseG !== null)
          )
            flag = "blank_kept_last_known";
          else if (
            menuB === null &&
            menuG === null &&
            houseB === null &&
            houseG === null
          )
            flag = "blank_no_house_price";
        }
        const locked = !!row && lockedWines.has(String(row.id));
        const libVintage = row?.master_wine_library?.vintage ?? null;
        const readYear = yearOf(line.vintage);
        // A dish beside the same dish on the live menu it replaces (display only).
        let dish: PlanLine["dish"] = null;
        if (line.kitchen_line === true && !menu.current) {
          const was =
            replacedLineByIdentity.get(menu.kind)?.get(identityOf(line)) ??
            null;
          if (was) {
            const price = linePrice(line.price);
            const livePrice = linePrice(was.price);
            dish = {
              price,
              livePrice,
              changed:
                price !== livePrice &&
                (price === null ||
                  livePrice === null ||
                  Math.abs(price - livePrice) >= 0.005),
            };
          }
        }
        planLines.push({
          menuItemId: line.id,
          name: line.name,
          producer: line.producer ?? null,
          vintage: line.vintage ?? null,
          wineLibraryId: wineId,
          inventoryId: row ? String(row.id) : null,
          house: row
            ? {
                wineName: row.wine_name ?? null,
                vintage: typeof libVintage === "number" ? libVintage : null,
                active: row.is_active !== false && !row.deleted_at,
              }
            : null,
          bottle,
          glass,
          flag,
          menuId: menu.menuId,
          menuKind: menu.kind,
          lineKind: typeof line.line_kind === "string" ? line.line_kind : null,
          sectionId:
            typeof line.section_id === "string" ? line.section_id : null,
          dish,
          returned:
            !menu.current &&
            locked &&
            (!replacing || !replaced.has(String(wineId))),
          // F-661: a year against no year differs too ("Yakut" read beside the house's Yakut 2019).
          vintageMismatch:
            locked &&
            readYear !== (typeof libVintage === "number" ? libVintage : null),
        });
      }
    }

    const dormantLocks: DormantLock[] = lockRead.locks
      .filter((l) => !onLiveSet.has(l.inventoryId))
      .map((l) => {
        const w = byInventory.get(l.inventoryId) ?? null;
        return {
          lockId: l.lockId,
          inventoryId: l.inventoryId,
          kind: l.kind,
          lockedPrice: l.lockedPrice,
          lockedBy: { userId: l.lockedBy, name: null },
          lockedAt: l.lockedAt,
          wineName: w?.wine_name ?? null,
          active: w ? w.is_active !== false && !w.deleted_at : null,
        };
      });

    // F-696: the switch takes the current menu of each kind it makes current
    // off, and its lines with it. The plan names that menu and counts its
    // lines, and its id is decisive: a different menu current by the time of
    // the choice is a plan that moved.
    const retiring: RetiringMenu[] = retiringMenus.map(({ row, lines }) => ({
      menuId: row.id,
      name: row.name ?? null,
      kind: row.menu_type,
      lines: lines.length,
    }));

    // Gone from this kind (rule 18): a replaced menu's line the batch's menu
    // of the same kind does not list. Only the kinds in the batch.
    const gone: GoneLine[] = [];
    for (const { row, lines } of retiringMenus) {
      const draft = batch.find((b) => !b.current && b.kind === row.menu_type);
      const listed = new Set((draft?.lines ?? []).map(identityOf));
      for (const line of lines) {
        if (listed.has(identityOf(line))) continue;
        gone.push({
          menuId: row.id,
          menuItemId: line.id,
          name: line.name,
          kind: row.menu_type,
          sectionKey: sectionKeyOf(line),
        });
      }
    }

    // Unsure (rule 15, the part this lane can tell): a draft's line that
    // cannot go live until a person says what it is.
    const unsure: UnsureLine[] = [];
    for (const menu of batch) {
      if (menu.current) continue;
      for (const line of menu.lines) {
        let reason: UnsureReason | null = null;
        if (
          line.line_kind !== "drink" &&
          line.line_kind !== "dish" &&
          typeof menu.kind === "string" &&
          NON_DRINK_MENU_KINDS.includes(menu.kind)
        )
          reason = "kind_not_decided";
        else if (
          line.line_kind === "drink" &&
          effectiveDrinkCategory(line, sections.rows) === null
        )
          reason = "no_drink_category";
        if (reason)
          unsure.push({
            menuId: menu.menuId,
            menuItemId: line.id,
            name: line.name,
            reason,
          });
      }
    }

    // Two prices (rule 19, S198): lines that carry the same wine with
    // different prices of one price kind, across the post-switch live set,
    // when at least one of them is on a draft of the batch. A blank is not a
    // price; a line with no wine cannot conflict (it is "not linked").
    const groups = new Map<string, PriceConflict>();
    const addPrices = (
      line: InsertedMenuItem,
      menuId: string,
      kind: string | null,
      live: boolean,
    ) => {
      const wine = carriedWine(line);
      if (!wine) return;
      for (const [priceKind, value] of [
        ["bottle", line.bottle_price],
        ["glass", line.by_glass_price],
      ] as const) {
        const price = linePrice(value);
        if (price === null) continue;
        const key = `${wine}:${priceKind}`;
        const g = groups.get(key) ?? {
          wineLibraryId: wine,
          inventoryId: house.get(wine) ? String(house.get(wine)!.id) : null,
          kind: priceKind,
          name: line.name,
          prices: [],
        };
        g.prices.push({
          price,
          menuId,
          menuItemId: line.id,
          live,
          menuKind: kind,
        });
        groups.set(key, g);
      }
    };
    for (const menu of batch)
      for (const line of menu.lines)
        addPrices(line, menu.menuId, menu.kind, menu.current);
    for (const { row, lines } of stayingMenus)
      for (const line of lines) addPrices(line, row.id, row.menu_type, true);
    const cents = (p: number) => Math.round(p * 100);
    const conflicts: PriceConflict[] = [...groups.values()].filter(
      (g) =>
        g.prices.some((p) => !p.live) &&
        new Set(g.prices.map((p) => cents(p.price))).size > 1,
    );
    for (const c of conflicts) {
      const onDraft = c.prices.find((p) => !p.live);
      if (onDraft)
        c.name =
          planLines.find((l) => l.menuItemId === onDraft.menuItemId)?.name ??
          c.name;
    }

    const menus: PlanMenu[] = batch.map((b) => ({
      menuId: b.menuId,
      kind: b.kind,
      current: b.current,
      partRead: b.partRead,
      lines: b.lines.length,
      unsure: unsure.filter((u) => u.menuId === b.menuId).length,
      conflicts: b.current
        ? 0
        : conflicts.filter((c) =>
            c.prices.some((p) => p.menuId === b.menuId && !p.live),
          ).length,
    }));

    // The batch fingerprint (rule 18): every menu of the batch and its kind,
    // every line's prices, stored kind and section, and what retires, leaves,
    // is Unsure or conflicts. A tap, a move or a price after the plan was
    // shown changes it.
    const decisive = {
      menuId: primary.menuId,
      menus: [...menus]
        .sort((a, b) => a.menuId.localeCompare(b.menuId))
        .map((m) => [m.menuId, m.kind, m.current]),
      lines: [...planLines]
        .sort((a, b) => a.menuItemId.localeCompare(b.menuItemId))
        .map((l) => [
          l.menuItemId,
          l.menuId,
          l.inventoryId,
          l.lineKind,
          l.sectionId,
          [l.bottle.result, l.bottle.menuPrice, l.bottle.housePrice, l.bottle.lock?.lockId ?? null],
          [l.glass.result, l.glass.menuPrice, l.glass.housePrice, l.glass.lock?.lockId ?? null],
          l.dish ? [l.dish.price, l.dish.livePrice] : null,
        ]),
      dormant: dormantLocks.map((d) => d.lockId).sort(),
      retiring: retiring.map((m) => m.menuId).sort(),
      gone: gone.map((g) => g.menuItemId).sort(),
      unsure: unsure.map((u) => `${u.menuItemId}:${u.reason}`).sort(),
      conflicts: conflicts
        .map((c) => [
          `${c.wineLibraryId}:${c.kind}`,
          c.prices.map((p) => `${p.menuItemId}:${cents(p.price)}`).sort(),
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    };
    return {
      menuId: primary.menuId,
      current: primary.current,
      readAt: primary.readAt,
      generatedAt: new Date().toISOString(),
      fingerprint: crypto.createHash("sha256").update(JSON.stringify(decisive)).digest("hex"),
      lines: planLines,
      counts,
      dormantLocks,
      retiring,
      namesReadable: true,
      namesReason: null,
      menus,
      gone,
      unsure,
      conflicts,
    };
  }

  /**
   * Make kept menus the house's current ones (founder, 2026-09-21: after a
   * photo and an extraction the person chooses whether it becomes the current
   * default menu). An owner's or a manager's act: the controller checks.
   *
   * THE PLAN FIRST (ADR 0193 round 3, L13). The caller sends the fingerprint
   * of the plan it showed; the plan is recomputed here, before the switch, and
   * a missing fingerprint (400) or a different one (409) changes nothing.
   *
   * ONE BATCH, ONE PER KIND (ADR 0340 rules 18-20). `batch.menuIds` names the
   * other menus that go live with the URL's one; the single-id call is a batch
   * of one. Every menu's lines and sections are read before the switch. An
   * Unsure line on a draft refuses the batch (400): the owner makes live the
   * kinds with nothing blocking. Two prices for one wine refuse it until each
   * is picked (`batch.picks`); a pick is a DRAFT edit (every draft line of
   * that wine and price kind takes the picked price), never a write to a live
   * line or a house price before the switch (rule 19, F5).
   *
   * `make_menus_current` (migration 20270107300000) does the switch in one
   * transaction under the house row's lock. THEN each menu made current is
   * carried: every linked line's price is written through
   * set_house_menu_price DATED BY THE CHOICE (`made_current_at`) and naming
   * its menu (L11), except a kind a lock holds (L4), which is reported and
   * named (L15). A price someone set after the choice but before its line
   * was carried wins (`stale`, L14). A blank price keeps the house's price and
   * flags the line (answers 3 and 4). A menu whose carry finished with no
   * failed line gets `carried_at`; one already current whose carry never
   * finished (`carried_at` NULL) is carried again, dated by its own choice
   * (rule 4).
   */
  async makeCurrent(
    restaurantId: string,
    menuId: string,
    userId: string,
    fingerprint?: string | null,
    partReadAccepted = false,
    batch: MakeCurrentBatch = {},
  ): Promise<MakeCurrentResult> {
    if (typeof fingerprint !== "string" || fingerprint.trim() === "") {
      throw new BadRequestException(
        "Choosing the current menu names the plan it was shown (its fingerprint, from GET /menu-versions/:menuId/plan). Nothing was changed.",
      );
    }
    const ids = [...new Set([menuId, ...(batch.menuIds ?? [])])];
    const acceptedKinds = new Set(batch.partReadAcceptedKinds ?? []);
    // The lines are read BEFORE the switch (last-call review, 2026-09-21). Read
    // after it, a failed read left the menu current with nothing carried, and
    // choosing it again answered "already_current" with zero lines: a switch
    // that could never be finished, reported as one that had been. Now a failed
    // read throws here and nothing is changed. ADR 0340 rule 4: every menu of
    // the batch, each read before the switch.
    const menus: BatchMenu[] = [];
    for (const id of ids) {
      const version = await this.readVersionRow(restaurantId, id);
      const lines = (await this.readLines(
        id,
        restaurantId,
        { rawLine: false },
        version.menu_type ?? null,
      )) as unknown as InsertedMenuItem[];
      // ADR 0340 rule 8 / ADR 0333 item 3: a category a person confirmed (the
      // line's own, or its confirmed section's) is written on the house item as
      // its declared kind, so a later library reclassify never overwrites it.
      // Read before the switch, like the lines: unread, the carry could not
      // tell a confirmed kind from a guessed one, so nothing is changed.
      const { sections, error: sectionsErr } = await readMenuSectionCategories(
        this.dbService.supabase,
        restaurantId,
        id,
      );
      if (sectionsErr) {
        throw new InternalServerErrorException(
          `This menu's sections could not be read, so the kind each drink is filed under is not known. Nothing was changed: ${sectionsErr}`,
        );
      }
      for (const line of lines) {
        if (line.kitchen_line === true) continue;
        const confirmed = confirmedDrinkCategory(line, sections);
        if (confirmed) line.declared_kind = houseKindOf(confirmed);
      }
      // A menu with no lines would empty the house's menu (F-681); the database
      // refuses it too (make_menus_current), this says why before the plan.
      if (lines.length === 0 && version.status !== "active") {
        throw new BadRequestException(
          "This menu has no lines, so making it current would empty the house's menu. Nothing was changed.",
        );
      }
      // A menu read only in part would take every line that was not read off
      // the house's menu (F-1292). The arrival path refuses such a read; here
      // the person may still choose it, but only having said so, for all of
      // the batch or for this menu's kind (rule 17).
      const partRead = partReadOfRow(version);
      if (
        partRead &&
        version.status !== "active" &&
        partReadAccepted !== true &&
        !acceptedKinds.has(String(version.menu_type))
      ) {
        throw new BadRequestException(
          `Only part of this menu was read (${partRead}). Making it current would take every drink that was not read off the house's menu. Read the menu again, or confirm that you want it current with those drinks missing. Nothing was changed.`,
        );
      }
      menus.push({
        menuId: id,
        kind: version.menu_type ?? null,
        current: version.status === "active",
        readAt: readMomentOf(version),
        partRead,
        lines,
      });
    }
    const plan = await this.computePlan(restaurantId, menus);
    if (plan.fingerprint !== fingerprint.trim()) {
      throw new ConflictException(
        "What choosing this menu would do has changed since it was shown (a price or a lock moved). Nothing was changed; look at the plan again.",
      );
    }
    if (plan.unsure.length > 0) {
      const kinds = [
        ...new Set(
          plan.unsure.map(
            (u) => menus.find((m) => m.menuId === u.menuId)?.kind ?? "?",
          ),
        ),
      ];
      throw new BadRequestException(
        `${plan.unsure.length} line(s) on the ${kinds.join(", ")} menu still need a person to say what they are. Make the other kinds live now, or sort these first. Nothing was changed.`,
      );
    }
    const picked = this.pickedPrices(plan.conflicts, batch.picks ?? []);
    await this.applyPicks(restaurantId, menus, plan.conflicts, picked);

    const db = this.dbService.supabase;
    const { data, error } = await db.rpc("make_menus_current", {
      p_restaurant_id: restaurantId,
      p_menu_ids: ids,
      p_actor: userId,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "P0002") throw new NotFoundException("No menu of this restaurant by that id. Nothing was changed.");
      if (code === "22023") throw new BadRequestException(error.message);
      throw new InternalServerErrorException(`The menu was not made current: ${error.message}`);
    }
    const r = (data ?? {}) as {
      made_current_at?: string | null;
      menus?: Array<{
        outcome?: string;
        menu_id?: string;
        previous_menu_ids?: string[];
        made_current_at?: string | null;
        carried_at?: string | null;
      }>;
    };
    const outcomes = Array.isArray(r.menus) ? r.menus : [];
    if (
      outcomes.length !== ids.length ||
      outcomes.some(
        (o) => o.outcome !== "made_current" && o.outcome !== "already_current",
      ) ||
      ids.some((id) => !outcomes.some((o) => o.menu_id === id))
    ) {
      throw new InternalServerErrorException(
        "The menu switch returned no outcome; whether this menu is current is unknown.",
      );
    }

    const result: MakeCurrentResult = {
      outcome: outcomes.some((o) => o.outcome === "made_current")
        ? "made_current"
        : "already_current",
      menuId,
      previousMenuIds: [
        ...new Set(outcomes.flatMap((o) => o.previous_menu_ids ?? [])),
      ],
      madeCurrentAt: null,
      lines: 0,
      priceSync: {},
      flagged: 0,
      failed: [],
      held: [],
      returned: [],
      menus: [],
      picked: picked.size,
    };
    for (const id of ids) {
      const o = outcomes.find((x) => x.menu_id === id)!;
      const menu = menus.find((m) => m.menuId === id)!;
      const at =
        typeof o.made_current_at === "string" ? o.made_current_at : null;
      if (
        id === menuId ||
        (result.madeCurrentAt === null && o.outcome === "made_current")
      )
        result.madeCurrentAt = at;
      // Carried now: a menu this call made current, or one already current
      // whose carry never finished (rule 4), dated by its own choice.
      const carry =
        o.outcome === "made_current" || (o.carried_at == null && at !== null);
      const done = carry
        ? await this.carryMenu(restaurantId, userId, id, menu.lines, at)
        : {
            lines: 0,
            counts: {},
            flagged: 0,
            failed: [],
            held: [],
            finished: o.carried_at != null,
          };
      result.lines += done.lines;
      for (const [k, n] of Object.entries(done.counts))
        result.priceSync[k] = (result.priceSync[k] ?? 0) + n;
      result.flagged += done.flagged;
      result.failed.push(...done.failed);
      result.held.push(...done.held);
      if (o.outcome === "made_current")
        result.returned.push(
          ...plan.lines
            .filter((l) => l.menuId === id && l.returned)
            .map((l) => ({ menuItemId: l.menuItemId, name: l.name })),
        );
      result.menus.push({
        menuId: id,
        kind: menu.kind,
        outcome: o.outcome as "made_current" | "already_current",
        madeCurrentAt: at,
        recarried: carry && o.outcome === "already_current",
        carryFinished: done.finished,
        lines: done.lines,
      });
    }
    return result;
  }

  private async readVersionRow(
    restaurantId: string,
    menuId: string,
  ): Promise<Record<string, any>> {
    const { data, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .select(VERSION_SELECT)
      .eq("id", menuId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error)
      throw new InternalServerErrorException(
        `The menu could not be read: ${error.message}`,
      );
    if (!data)
      throw new NotFoundException("No menu of this restaurant by that id.");
    return data as Record<string, any>;
  }

  /**
   * The owner's picks against the plan's conflicts (rule 19): every conflict
   * needs exactly one, at one of the prices it shows; a pick naming no
   * conflict, or a price nobody listed, is refused. Nothing is written.
   */
  private pickedPrices(
    conflicts: PriceConflict[],
    picks: PricePick[],
  ): Map<string, number> {
    const out = new Map<string, number>();
    const byKey = new Map(
      conflicts.map((c) => [`${c.wineLibraryId}:${c.kind}`, c]),
    );
    for (const p of picks) {
      const key = `${p?.wineLibraryId}:${p?.kind}`;
      const c = byKey.get(key);
      if (!c) {
        throw new BadRequestException(
          "A price was picked for a wine that has no two prices in this plan. Nothing was changed; look at the plan again.",
        );
      }
      if (out.has(key)) {
        throw new BadRequestException(
          `Two prices were picked for ${c.name}. Pick one. Nothing was changed.`,
        );
      }
      const price = Number(p.price);
      if (
        !c.prices.some(
          (x) => Math.round(x.price * 100) === Math.round(price * 100),
        )
      ) {
        throw new BadRequestException(
          `The price picked for ${c.name} is not one of the prices it shows. Nothing was changed.`,
        );
      }
      out.set(key, price);
    }
    const open = conflicts.filter(
      (c) => !out.has(`${c.wineLibraryId}:${c.kind}`),
    );
    if (open.length > 0) {
      throw new BadRequestException(
        `${open.map((c) => c.name).join(", ")} ${open.length === 1 ? "has" : "have"} two prices; pick one before making these menus live. Nothing was changed.`,
      );
    }
    return out;
  }

  /**
   * A pick is a DRAFT edit (ADR 0340 rule 19, F5): every line of a draft in
   * the batch that carries the wine at another price of that kind takes the
   * picked price. A live line (another kind's, or a batch menu already
   * current) is never written here; the carry's dated `menu_current` write
   * sets the house price, and the follow trigger brings the other live lines
   * to it. A failed write stops before the switch (500): nothing went live,
   * and the drafts keep the picks already written.
   */
  private async applyPicks(
    restaurantId: string,
    menus: BatchMenu[],
    conflicts: PriceConflict[],
    picked: Map<string, number>,
  ): Promise<void> {
    for (const c of conflicts) {
      const price = picked.get(`${c.wineLibraryId}:${c.kind}`);
      if (price === undefined) continue;
      const column = c.kind === "bottle" ? "bottle_price" : "by_glass_price";
      for (const entry of c.prices) {
        if (
          entry.live ||
          Math.round(entry.price * 100) === Math.round(price * 100)
        )
          continue;
        const menu = menus.find((m) => m.menuId === entry.menuId && !m.current);
        if (!menu) continue;
        const { error } = await this.dbService.supabase
          .from("menu_items")
          .update({ [column]: price })
          .eq("id", entry.menuItemId)
          .eq("restaurant_id", restaurantId)
          .eq("menu_id", menu.menuId);
        if (error) {
          throw new InternalServerErrorException(
            `The price picked for ${c.name} could not be written on the draft, so nothing was made live: ${error.message}`,
          );
        }
        const line = menu.lines.find((l) => l.id === entry.menuItemId);
        if (line) line[column] = price;
      }
    }
  }

  /**
   * One menu's per-line carry, dated by its choice (ADR 0193 round 3, L11),
   * then `carried_at` when no line failed (ADR 0340 rule 4), so a retry
   * finishes a carry that did not.
   */
  private async carryMenu(
    restaurantId: string,
    userId: string,
    menuId: string,
    lines: InsertedMenuItem[],
    madeCurrentAt: string | null,
  ): Promise<CarryOutcome> {
    if (!madeCurrentAt) {
      // The menu IS current, and its prices cannot be dated by the choice. Said
      // on every line, never dated by something else.
      const why = "the menu switch did not say when it happened, so no price was dated or carried";
      return {
        lines: lines.length,
        counts: lines.length ? { failed: lines.length } : {},
        flagged: 0,
        failed: lines.map((l) => ({ menuItemId: l.id, name: l.name, error: why })),
        held: [],
        finished: false,
      };
    }
    const { inventoryMap, priceSync } = await this.addToInventory(lines, restaurantId, userId, {
      effectiveFrom: madeCurrentAt,
      menuId,
        source: "menu_current",
    });
    await this.backfillMenuItemColumn(inventoryMap, "inventory_item_id");

    const counts: Record<string, number> = {};
    const failed: CarryOutcome["failed"] = [];
    const held: CarryOutcome["held"] = [];
    let flagged = 0;
    for (const line of lines) {
      const entry = priceSync.get(line.id);
      // A kitchen line is set aside, not an unmatched wine (F-1297).
      // F-1470: so is a cocktail; its recipe is its stock.
      const outcome =
        line.kitchen_line === true
          ? "kitchen"
          : isCocktailLine(line.category, line.name, line.drink_category)
            ? "cocktail"
            : (entry?.outcome ?? "not_linked");
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      if (entry?.flag) flagged += 1;
      for (const h of entry?.held ?? []) held.push({ menuItemId: line.id, name: line.name, ...h });
      if (entry?.outcome === "failed" || entry?.flagError) {
        failed.push({ menuItemId: line.id, name: line.name, error: entry.error ?? entry.flagError ?? "" });
      }
    }
    let finished = false;
    if (failed.length === 0) {
      const { error } = await this.dbService.supabase
        .from("restaurant_menus")
        .update({ carried_at: new Date().toISOString() })
        .eq("id", menuId)
        .eq("restaurant_id", restaurantId)
        .is("carried_at", null);
      if (error) {
        this.logger.warn(
          `menu ${menuId} was carried but its carry could not be marked finished: ${error.message}`,
        );
        failed.push({
          menuItemId: "",
          name: "",
          error: `the carry finished but could not be marked finished (${error.message}); choosing this menu again finishes it`,
        });
      } else {
        finished = true;
      }
    }
    return { lines: lines.length, counts, flagged, failed, held, finished };
  }

  /**
   * Every section of these menus, by id, with its key (ADR 0340 rule 18:
   * a dish is matched across two reads by section key and name). Keyset-paged
   * inside the house; a failed read is said, never an empty map.
   */
  private async readSectionKeys(
    restaurantId: string,
    menuIds: string[],
  ): Promise<{ rows: Map<string, SectionKeyRow>; error: string | null }> {
    const rows = new Map<string, SectionKeyRow>();
    if (menuIds.length === 0) return { rows, error: null };
    let after: string | null = null;
    for (;;) {
      let q = this.dbService.supabase
        .from("menu_sections")
        .select("id, menu_id, key, parent_id, drink_category, confirmed_at")
        .eq("restaurant_id", restaurantId)
        .in("menu_id", menuIds);
      if (after) q = q.gt("id", after);
      const { data, error } = await q
        .order("id", { ascending: true })
        .limit(PAGE_ROWS);
      if (error) return { rows: new Map(), error: error.message };
      const page = (data ?? []) as Array<Record<string, unknown>>;
      for (const r of page) {
        rows.set(String(r.id), {
          key: typeof r.key === "string" ? r.key : null,
          parent_id: typeof r.parent_id === "string" ? r.parent_id : null,
          drink_category:
            typeof r.drink_category === "string" ? r.drink_category : null,
          confirmed_at:
            typeof r.confirmed_at === "string" ? r.confirmed_at : null,
        });
      }
      if (page.length < PAGE_ROWS) break;
      after = String(page[page.length - 1].id);
    }
    return { rows, error: null };
  }

  private toVersion(r: Record<string, any>, names: Map<string, string | null>): MenuVersion {
    const who = (id: string | null | undefined) => (id ? { userId: id, name: names.get(id) ?? null } : null);
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      menuId: r.id,
      name: r.name ?? null,
      partRead: partReadOfRow(r),
      kind: r.menu_type ?? null,
      status: r.status,
      current: r.status === "active",
      cadence: r.cadence ?? null,
      menuDate:
        r.menu_date && r.menu_date_precision === "month"
          ? String(r.menu_date).slice(0, 7)
          : (r.menu_date ?? null),
      menuDatePrecision: r.menu_date_precision ?? null,
      sourceMethod: r.source_method ?? null,
      source: {
        kept: !!r.source_path,
        mime: r.source_mime ?? null,
        bytes: num(r.source_bytes),
        failure: r.source_failure ?? null,
      },
      linesExtracted: num(r.lines_extracted),
      extractedAt: r.extracted_at ?? null,
      extractedBy: who(r.extracted_by),
      madeCurrentAt: r.made_current_at ?? null,
      madeCurrentBy: who(r.made_current_by),
      retiredAt: r.retired_at ?? null,
      retiredBy: who(r.retired_by),
      createdAt: r.created_at ?? null,
      carryFinished: r.made_current_at
        ? typeof r.carried_at === "string"
        : null,
    };
  }

  /**
   * `public.users.user_id` -> name. A failed lookup is RETURNED with its reason
   * (ADR 0193 round 3, L25: it used to be logged and dropped, so "read by X"
   * vanished without a word), never raw ids shown as names.
   */
  private async namesOf(
    ids: Array<string | null | undefined>,
  ): Promise<{ names: Map<string, string | null>; error: string | null }> {
    const { people, error } = await readPeople(this.dbService.supabase, ids);
    const names = new Map<string, string | null>();
    for (const [id, p] of people) names.set(id, p.name);
    if (error) this.logger.warn(`The people behind this house's menus could not be named: ${error}`);
    return { names, error };
  }

  // ── Shared pipeline: resolve against the library, insert, seed inventory ──

  /**
   * The library step of an upload, on its own so the review's tap can run it
   * again for lines that became drinks (`resolveOnTap`, ADR 0340 rule 9):
   * every line not set aside as kitchen goes to the resolver in ONE batched
   * call; a kitchen line comes back unlinked. A whole-batch failure throws.
   */
  private async resolveDrinkLines(
    items: WineExtractItem[],
    kitchen: boolean[],
    restaurantId: string,
  ): Promise<ResolvedItem[]> {
    const drinks = items.filter((_, idx) => !kitchen[idx]);
    try {
      const results = await this.wineSubmissions.resolveLibraryWinesBatch(
        drinks.map((item) => ({
          name: item.name,
          producer: item.producer,
          vintage: item.vintage,
          region: item.region,
          grapeVariety: item.grape_variety,
          // Not a matching field — the resolver keeps it out of every
          // signature hash. It is carried so the library row this creates
          // arrives with something for wine_classify_beverage_kind() to read,
          // which is what makes a beer line on an uploaded menu come back as
          // beverage_kind='beer' instead of 'unknown' and light the Beer
          // register (cellar/cellar-registers.ts, registerForKind).
          // F-1293: a Turkish section ("Rakı", "Kırmızı") goes as the kind
          // it names, since the classifier reads English words only.
          // ADR 0340 rule 8 / ADR 0333: only the effective vocabulary token
          // is sent, never the heading as written; a line with none sends
          // no category.
          menuCategory:
            effectiveDrinkCategory({ category: item.category }) ?? undefined,
        })),
        // A menu prints "House White" and "Red — by the glass" as often as it
        // prints a producer. Those lines are this venue's own wines and never
        // join the shared library (ADR 0130), so the resolver has to know
        // whose menu this is.
        restaurantId,
      );
      let next = 0;
      return items.map((item, idx) => {
        if (kitchen[idx])
          return {
            item,
            masterWineId: null,
            matched: false,
            libraryTier: null,
            confidence: null,
          };
        const r = results[next++];
        return {
          item,
          masterWineId: r?.masterWineId ?? null,
          matched: r?.matched ?? false,
          libraryTier: r?.libraryTier ?? null,
          confidence: r?.confidence ?? null,
        };
      });
    } catch (err) {
      this.logger.error(`Library resolution failed for menu: ${err.message}`);
      throw new Error(
        `Menu import failed during library resolution: ${err.message}`,
      );
    }
  }

  /**
   * A just-written draft's sections (ADR 0340 rule 12): one per distinct
   * category its lines carry, the house's layout carried over by key from its
   * live (else latest archived) menu of the same kind, never its
   * confirmation; one `menu_section_changes` row per section. One database
   * function, so the sections and their log commit together.
   */
  private async materialiseSections(
    restaurantId: string,
    menuId: string,
    userId: string,
  ): Promise<void> {
    const { error } = await this.dbService.supabase.rpc(
      "materialise_menu_sections",
      { p_restaurant_id: restaurantId, p_menu_id: menuId, p_actor: userId },
    );
    if (error) {
      throw new Error(
        `the menu's sections could not be made: ${error.message}`,
      );
    }
  }

  /**
   * Resolve-on-tap (ADR 0340 rule 9): lines of a draft that a tap made drinks
   * (a section or line confirmed, a category set, a section moved to the
   * Drinks draft) and that hold no library wine go to the same resolver an
   * upload uses, are linked, and file their submission. Only lines of this
   * house's menu `menuId` are read. A dish, a discarded line and a line
   * already linked are left. A failed resolve is returned as the lines left
   * unlinked with the reason: the tap itself already committed, and the line
   * shows "Unsure" until it is linked by hand or tapped again.
   */
  async resolveOnTap(
    restaurantId: string,
    menuId: string,
    lineIds: string[],
    userId: string,
  ): Promise<{ linked: string[]; unlinked: string[]; error: string | null }> {
    const ids = [...new Set(lineIds.filter((id) => typeof id === "string"))];
    if (ids.length === 0) return { linked: [], unlinked: [], error: null };

    const { data: menu, error: menuErr } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("menu_type")
      .eq("id", menuId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (menuErr || !menu) {
      return {
        linked: [],
        unlinked: ids,
        error: menuErr?.message ?? "the menu was not found",
      };
    }

    const rows: Array<Record<string, any>> = [];
    for (let i = 0; i < ids.length; i += RESOLVE_ON_TAP_CHUNK) {
      const { data, error } = await this.dbService.supabase
        .from("menu_items")
        .select(
          "id, name, producer, vintage, region, grape_variety, category, line_kind, drink_category, section_id, raw_extracted_text, wine_library_id, status, by_glass_price, bottle_price",
        )
        .eq("restaurant_id", restaurantId)
        .eq("menu_id", menuId)
        .in("id", ids.slice(i, i + RESOLVE_ON_TAP_CHUNK));
      if (error) return { linked: [], unlinked: ids, error: error.message };
      rows.push(...((data ?? []) as Array<Record<string, any>>));
    }
    const { sections, error: sectionsErr } = await readMenuSectionCategories(
      this.dbService.supabase,
      restaurantId,
      menuId,
    );
    if (sectionsErr) return { linked: [], unlinked: ids, error: sectionsErr };

    const lines = rows.filter(
      (r) =>
        !r.wine_library_id &&
        r.status !== "discarded" &&
        lineIsDrink(
          // The raw line is read for the kitchen test only, never returned.
          {
            line_kind: r.line_kind,
            category: r.category,
            raw: r[RAW_LINE_COLUMN],
          },
          menu.menu_type,
        ),
    );
    if (lines.length === 0) return { linked: [], unlinked: [], error: null };

    const items: WineExtractItem[] = lines.map((r) => ({
      name: r.name,
      producer: r.producer ?? undefined,
      vintage: r.vintage ?? undefined,
      region: r.region ?? undefined,
      grape_variety: r.grape_variety ?? undefined,
      // The effective vocabulary token, never the heading (ADR 0333).
      category: effectiveDrinkCategory(r, sections) ?? undefined,
      by_glass_price: r.by_glass_price ?? undefined,
      bottle_price: r.bottle_price ?? undefined,
    }));
    let resolved: ResolvedItem[];
    try {
      resolved = await this.resolveDrinkLines(
        items,
        items.map(() => false),
        restaurantId,
      );
    } catch (err: any) {
      return {
        linked: [],
        unlinked: lines.map((r) => String(r.id)),
        error: err?.message ?? "the library could not be read",
      };
    }

    const linked: string[] = [];
    const unlinked: string[] = [];
    let writeError: string | null = null;
    await inPool(
      resolved.map((r, idx) => [r, lines[idx]] as const),
      CARRY_CONCURRENCY,
      async ([r, line]) => {
        if (!r.masterWineId) {
          unlinked.push(String(line.id));
          return;
        }
        const { error } = await this.dbService.supabase
          .from("menu_items")
          .update({ wine_library_id: r.masterWineId })
          .eq("id", line.id)
          .eq("restaurant_id", restaurantId)
          .eq("menu_id", menuId)
          .is("wine_library_id", null);
        if (error) {
          writeError = error.message;
          unlinked.push(String(line.id));
        } else {
          linked.push(String(line.id));
        }
      },
    );

    // Provenance trail, as on upload: non-fatal.
    try {
      const linkedSet = new Set(linked);
      const keep = resolved
        .map((r, idx) => ({ r, line: lines[idx] }))
        .filter(({ line }) => linkedSet.has(String(line.id)));
      const submissionMap = await this.submitToWineLibrary(
        keep.map(({ r }) => r),
        keep.map(({ r, line }) => ({
          id: String(line.id),
          wine_library_id: r.masterWineId,
          name: line.name,
        })),
        restaurantId,
        userId,
      );
      await this.backfillMenuItemColumn(submissionMap, "submission_id");
    } catch (err: any) {
      this.logger.warn(
        `wine library submission failed (non-fatal): ${err?.message}`,
      );
    }

    return { linked, unlinked, error: writeError };
  }

  private async resolveAndPersistItems(
    items: WineExtractItem[],
    restaurantId: string,
    menuId: string,
    userId: string,
    method: "scan" | "csv" | "manual",
    // Whether `menuId` is the house's CURRENT menu. Only a current menu's
    // lines seed the house's inventory and set its prices (ADR 0193, menu
    // versions); a kept menu's lines wait for `makeCurrent`.
    current: boolean,
    // The menu's `menu_type` (ADR 0340 rule 8): each line is judged by
    // lineIsDrink on it. Null judges by the legacy rule.
    menuKind: string | null,
  ): Promise<MenuImportReviewItem[]> {
    if (items.length === 0) return [];

    // Resolve every item against master_wine_library BEFORE inserting
    // menu_items — wine_library_id and restaurant_inventory.master_wine_id
    // are both FK targets and must point at a real row, not be populated
    // asynchronously after the fact.
    //
    // One batched call, not one per wine. This used to be a bounded-concurrency
    // loop of individual lookups; against the pooler each round trip is
    // ~320-380ms and almost none of that is query time. Measured on a real
    // 182-wine extraction scaled to RL Restaurant's 485 wines, batching took
    // 183.12s down to 0.91s.
    //
    // A whole-batch failure is fatal here on purpose. Per-wine failures were
    // caught as non-fatal and turned into masterWineId: null, which is how an
    // import could report success while linking nothing; if the single call
    // covering every wine fails, the import genuinely cannot proceed and should
    // say so rather than write a menu of unlinked items.
    //
    // A kitchen (food) line is set aside (F-1170): it is kept as a menu line
    // and nothing else. It is not sent to the resolver, so it creates no
    // library row and files no submission, and with no library wine it seeds
    // no stock row. /house/menu tells the owner these lines were set aside.
    // ADR 0340 rule 8: "kitchen" is NOT lineIsDrink on this menu's kind, so a
    // line on a Food or Desserts menu with no stored kind is set aside too.
    // ADR 0340 rule 15 (lane 5b): a line the split decided is a drink only
    // when it says so; a dish and an Unsure line (line_kind null) never go
    // to the resolver. A line with no split verdict keeps the rule above.
    const legacy = (item: WineExtractItem) =>
      !lineIsDrink({ category: item.category, raw: item.raw_text }, menuKind);
    const kitchen = items.map((item) =>
      item.line_kind === undefined ? legacy(item) : item.line_kind !== "drink",
    );
    const resolved = await this.resolveDrinkLines(items, kitchen, restaurantId);

    // Unlinked items are the ones a manager has to fix by hand, so say how
    // many there are rather than leaving it to be discovered in the UI.
    const unlinked = resolved.filter(
      (r, idx) => !kitchen[idx] && !r.masterWineId,
    ).length;
    if (unlinked > 0) {
      this.logger.error(
        `Menu import: ${unlinked}/${resolved.length} item(s) could not be ` +
          `linked to the wine library and will have no inventory row`,
      );
    }

    const menuItemRows = resolved.map(({ item, masterWineId }, idx) => ({
      menu_id: menuId,
      restaurant_id: restaurantId,
      name: item.name,
      producer: item.producer ?? null,
      category: item.category ?? null,
      vintage: item.vintage ?? null,
      region: item.region ?? null,
      grape_variety: item.grape_variety ?? null,
      by_glass_price: item.by_glass_price ?? null,
      bottle_price: item.bottle_price ?? null,
      // Rule 7: only a dish holds a dish price; the split's verdict and its
      // reasons when Unsure. A line with no verdict writes none of them.
      price: item.line_kind === "dish" ? (item.price ?? null) : null,
      line_kind: item.line_kind ?? null,
      kind_flag: item.kind_flag ?? null,
      raw_extracted_text: item.raw_text ?? null,
      wine_library_id: masterWineId,
      source: method,
      status:
        method === "manual" && idx >= FREE_TIER_MANUAL_LIMIT
          ? "flagged"
          : "approved",
      review_notes:
        method === "manual" && idx >= FREE_TIER_MANUAL_LIMIT
          ? "Free tier: exceeds 25 item limit"
          : null,
    }));

    const { data, error: menuItemsErr } = await this.dbService.supabase
      .from("menu_items")
      .insert(menuItemRows)
      .select(
        "id, wine_library_id, name, category, by_glass_price, bottle_price, created_at",
      );

    if (menuItemsErr) {
      this.logger.error(`Failed to insert menu_items: ${menuItemsErr.message}`);
      throw new Error(`menu_items insert failed: ${menuItemsErr.message}`);
    }

    // A single bulk INSERT ... RETURNING preserves VALUES-clause order in
    // practice (no ON CONFLICT / trigger reordering here), so index-aligned
    // zipping with `resolved` is safe and avoids an N+1 re-fetch.
    const insertedMenuItems: InsertedMenuItem[] = (data ?? []).map(
      (row: InsertedMenuItem, idx: number) => ({
        ...row,
        kitchen_line: kitchen[idx] ?? false,
      }),
    );

    // Seed restaurant_inventory (awaited — previously fire-and-forget into a
    // table named "inventory" that does not exist in this schema) -- only for
    // the CURRENT menu. A kept menu's lines stay out of the house's inventory
    // and prices until an owner or manager makes it current.
    // A line added to the CURRENT menu is dated now (the writer's default)
    // and names its menu (ADR 0193 round 3, L11).
    const { inventoryMap, priceSync } = current
      ? await this.addToInventory(insertedMenuItems, restaurantId, userId, {
          effectiveFrom: null,
          menuId,
          source: "import",
        })
      : {
          inventoryMap: Object.assign(new Map<string, string>(), {
            created: new Set<string>(),
          }),
          priceSync: new Map<string, PriceSyncEntry>(
            insertedMenuItems.map((m) => [
              m.id,
              { outcome: "not_current", error: null, flag: null, flagNote: null, held: [] },
            ]),
          ),
        };
    await this.backfillMenuItemColumn(inventoryMap, "inventory_item_id");

    // Provenance trail for governance (awaited, non-fatal on failure so a
    // submissions-table hiccup never blocks the manager's own inventory).
    let submissionMap = new Map<string, string>();
    try {
      submissionMap = await this.submitToWineLibrary(
        resolved,
        insertedMenuItems,
        restaurantId,
        userId,
      );
      await this.backfillMenuItemColumn(submissionMap, "submission_id");
    } catch (err) {
      this.logger.warn(
        `wine library submission failed (non-fatal): ${err.message}`,
      );
    }

    return resolved.map((r, idx) => {
      const menuItem = insertedMenuItems[idx];
      return {
        menuItemId: menuItem?.id,
        inventoryItemId: menuItem
          ? (inventoryMap.get(menuItem.id) ?? null)
          : null,
        inventoryCreated: menuItem
          ? inventoryMap.created.has(menuItem.id)
          : false,
        submissionId: menuItem
          ? (submissionMap.get(menuItem.id) ?? null)
          : null,
        name: r.item.name,
        producer: r.item.producer ?? null,
        category: r.item.category ?? null,
        vintage: r.item.vintage ?? null,
        region: r.item.region ?? null,
        grapeVariety: r.item.grape_variety ?? null,
        byGlassPrice: r.item.by_glass_price ?? null,
        bottlePrice: r.item.bottle_price ?? null,
        rawText: r.item.raw_text ?? null,
        matched: r.matched,
        needsReview: itemNeedsPencil({
          matched: r.matched,
          category: r.item.category,
        }),
        priceSync: menuItem
          ? (priceSync.get(menuItem.id)?.outcome ?? "not_linked")
          : "not_linked",
        priceSyncError: menuItem
          ? (priceSync.get(menuItem.id)?.error ?? null)
          : null,
        priceFlag: menuItem ? (priceSync.get(menuItem.id)?.flag ?? null) : null,
        priceFlagNote: menuItem ? (priceSync.get(menuItem.id)?.flagNote ?? null) : null,
        priceHeld: menuItem ? (priceSync.get(menuItem.id)?.held ?? []) : [],
      };
    });
  }

  private async submitToWineLibrary(
    resolved: ResolvedItem[],
    insertedMenuItems: InsertedMenuItem[],
    restaurantId: string,
    userId: string,
  ): Promise<Map<string, string>> {
    const rows: Record<string, unknown>[] = [];
    const correspondingMenuItemIds: string[] = [];

    resolved.forEach((r, idx) => {
      if (!r.masterWineId) return;
      const menuItem = insertedMenuItems[idx];
      if (!menuItem) return;

      rows.push({
        restaurant_id: restaurantId,
        submitted_by: userId,
        status: r.matched ? "merged" : "pending_review",
        decision_reason: r.matched ? "library_match" : "provisional_created",
        matched_master_id: r.masterWineId,
        payload: r.item,
        normalized_fields: {
          // Was `name.toLowerCase().trim()`, a third normalizer writing the
          // same field name as the library's normalized_name but folding
          // nothing — so "Château Margaux" stayed "château margaux" here and
          // was "chateau margaux" everywhere else.
          normalized_name: this.wineSubmissions.normalizeText(r.item.name),
          normalized_producer: this.wineSubmissions.normalizeText(
            r.item.producer,
          ),
          producer: r.item.producer ?? null,
          vintage: r.item.vintage ?? null,
          region: r.item.region ?? null,
          grape_variety: r.item.grape_variety ?? null,
        },
      });
      correspondingMenuItemIds.push(menuItem.id);
    });

    const menuItemToSubmission = new Map<string, string>();
    if (rows.length === 0) return menuItemToSubmission;

    const { data, error } = await this.dbService.supabase
      .from("master_wine_library_submissions")
      .insert(rows)
      .select("id");

    if (error) throw new Error(error.message);

    (data ?? []).forEach((row, i) => {
      const menuItemId = correspondingMenuItemIds[i];
      if (menuItemId) menuItemToSubmission.set(menuItemId, row.id);
    });

    return menuItemToSubmission;
  }

  /**
   * Seeds restaurant_inventory for every menu item that resolved to a
   * master_wine_library row. Returns a menuItemId → restaurant_inventory.id
   * map so the caller can backfill menu_items.inventory_item_id.
   *
   * THE MENU'S PRICES REACH THE HOUSE (ADR 0193, founder 2026-09-21: "it
   * could be changed every time a menu is updated"). This used to insert the
   * row with no price at all -- the scanned line's by_glass_price /
   * bottle_price sat on `item` and were dropped -- and an existing row was
   * never touched by a re-scan. Now every linked line with a price writes it
   * through set_house_menu_price as change_source 'menu_current' (S202; a line
   * added to the current menu stays 'import'), DATED BY THE CHOICE of the menu (`dating.effectiveFrom`, ADR 0193 round 3, L11; it had
   * been the line's own `created_at`, which backdated history and stopped an
   * older menu chosen again from bringing its prices back) and naming the
   * menu. A kind a price lock holds is not written and is named (L4, L5). A
   * line that states no price leaves the house's price alone -- a scan that
   * missed the glass column is not a decision to clear it.
   */
  private async addToInventory(
    menuItems: InsertedMenuItem[],
    restaurantId: string,
    userId: string,
    dating: CarryDating,
  ): Promise<{
    inventoryMap: Map<string, string> & { created: Set<string> };
    priceSync: Map<string, PriceSyncEntry>;
  }> {
    const result = Object.assign(new Map<string, string>(), {
      created: new Set<string>(),
    });
    const priceSync = new Map<string, PriceSyncEntry>();
    const validItems = menuItems.filter((i) => carriedWine(i));
    if (validItems.length === 0) return { inventoryMap: result, priceSync };

    const thresholdMin = await this.getDefaultThresholdMin(restaurantId);

    type HouseRow = {
      id: string;
      master_wine_id?: string;
      is_active?: boolean | null;
      menu_price_current?: number | string | null;
      menu_price_glass?: number | string | null;
      kind?: string | null;
      identity_provenance?: string | null;
    };
    type HouseRead = {
      data: HouseRow | null;
      error: { message: string } | null;
    };

    // The house's rows for the menu's wines, read in sets (F-448). Each wine's
    // answer, or the read's failure, is kept for its first line.
    const wineIds = [
      ...new Set(validItems.map((i) => i.wine_library_id as string)),
    ];
    const prefetched = new Map<string, HouseRead>();
    for (let i = 0; i < wineIds.length; i += CARRY_READ_CHUNK) {
      const chunk = wineIds.slice(i, i + CARRY_READ_CHUNK);
      const { data, error } = await this.dbService.supabase
        .from("restaurant_inventory")
        .select(
          "id, master_wine_id, is_active, menu_price_current, menu_price_glass, kind, identity_provenance",
        )
        .eq("restaurant_id", restaurantId)
        .in("master_wine_id", chunk);
      for (const wine of chunk) {
        prefetched.set(
          wine,
          error
            ? { data: null, error }
            : {
                data:
                  ((data ?? []) as HouseRow[]).find(
                    (r) => r.master_wine_id === wine,
                  ) ?? null,
                error: null,
              },
        );
      }
    }

    // The kept price in a flag note is in the house's money (F-1174). Never
    // throws: unread, the note prints the bare figure, as before.
    const houseMoney = await readHouseMoney(
      this.dbService.supabase,
      restaurantId,
    );

    const carryLine = async (item: InsertedMenuItem, read: HouseRead) => {
      const { data: existing, error: existingErr } = read;

      // A failed read is not "no row" (last-call review, 2026-09-21). Read as
      // one, it tried a duplicate INSERT (refused by the house+wine UNIQUE),
      // skipped the line in silence -- counted "not_linked" -- and decided the
      // blank-price flag (founder answer 3) from a price it never saw.
      if (existingErr) {
        const message = `the house's own row for this wine could not be read, so neither its price nor a blank-price flag was decided: ${existingErr.message}`;
        this.logger.error(`menu line ${item.id} ("${item.name}"): ${message}`);
        priceSync.set(item.id, { outcome: "failed", error: message, flag: null, flagNote: null, held: [] });
        return;
      }

      let inventoryId: string | null = existing?.id ?? null;
      if (!inventoryId) {
        // Inserted WITHOUT a price on purpose: the price goes through
        // set_house_menu_price below, so its version row names the act and
        // names the person, instead of the trigger's "no person named".
        const { data: created, error } = await this.dbService.supabase
          .from("restaurant_inventory")
          .insert({
            restaurant_id: restaurantId,
            master_wine_id: item.wine_library_id,
            wine_name: item.name,
            threshold_min: thresholdMin,
            is_active: true,
            // ADR 0340 rule 8 / ADR 0333 item 3: a kind a person confirmed is
            // stored as declared ('house_declared' is the provenance a
            // library reclassify never follows); otherwise the library's
            // kind is taken, as before (set_house_item_identity).
            ...(item.declared_kind
              ? {
                  kind: item.declared_kind,
                  identity_provenance: "house_declared",
                }
              : {}),
          })
          .select("id")
          .single();

        if (error) {
          // Still non-fatal for the menu, but said on the line: "not_linked"
          // means the menu matched no wine, never that the house's row failed.
          const message = `the wine could not be added to the house's inventory, so no price was set: ${error.message}`;
          this.logger.warn(`inventory seeding failed for "${item.name}" (non-fatal): ${error.message}`);
          priceSync.set(item.id, { outcome: "failed", error: message, flag: null, flagNote: null, held: [] });
          return;
        }
        inventoryId = created?.id ?? null;
      }
      if (!inventoryId) return;
      // F-946: a wine the house removed comes back when a current menu lists
      // it, as the add form and the bulk add already bring it back. Left
      // inactive, the menu sold it while /inventory, /cellar, low stock and
      // reorder never showed it, and a delivery of it landed in a hidden row.
      if (existing && existing.is_active === false) {
        const { error: backErr } = await this.dbService.supabase
          .from("restaurant_inventory")
          .update({ is_active: true })
          .eq("restaurant_id", restaurantId)
          .eq("id", inventoryId);
        if (backErr) {
          const message = `this wine was removed from the house's inventory and could not be brought back, so no price was set: ${backErr.message}`;
          this.logger.error(
            `menu line ${item.id} ("${item.name}"): ${message}`,
          );
          priceSync.set(item.id, {
            outcome: "failed",
            error: message,
            flag: null,
            flagNote: null,
            held: [],
          });
          return;
        }
      }
      // ADR 0340 rule 8 / ADR 0333 item 3: an existing house item takes the
      // kind a person confirmed, as declared. A failed write is said on the
      // line and no price is carried, as when a removed wine cannot come back.
      if (
        existing &&
        item.declared_kind &&
        (existing.kind !== item.declared_kind ||
          existing.identity_provenance !== "house_declared")
      ) {
        const { error: kindErr } = await this.dbService.supabase
          .from("restaurant_inventory")
          .update({
            kind: item.declared_kind,
            identity_provenance: "house_declared",
          })
          .eq("restaurant_id", restaurantId)
          .eq("id", inventoryId);
        if (kindErr) {
          const message = `the kind confirmed for this drink could not be written on the house's item, so no price was set: ${kindErr.message}`;
          this.logger.error(
            `menu line ${item.id} ("${item.name}"): ${message}`,
          );
          priceSync.set(item.id, {
            outcome: "failed",
            error: message,
            flag: null,
            flagNote: null,
            held: [],
          });
          return;
        }
      }
      result.set(item.id, inventoryId);
      if (!existing) result.created.add(item.id);
      const entry = await this.carryMenuPrice(
        item,
        restaurantId,
        inventoryId,
        userId,
        {
          bottle: existing?.menu_price_current ?? null,
          glass: existing?.menu_price_glass ?? null,
        },
        dating,
        houseMoney,
      );
      priceSync.set(item.id, entry);
      await this.writeLineFlag(item.id, entry);
    };

    // Lines naming the same wine are carried one after another in menu order,
    // as before: the later line reads the house's row the earlier one wrote.
    // Different wines are carried side by side, CARRY_CONCURRENCY at a time.
    const byWine = new Map<string, InsertedMenuItem[]>();
    for (const item of validItems) {
      const wine = item.wine_library_id as string;
      byWine.set(wine, [...(byWine.get(wine) ?? []), item]);
    }
    await inPool(
      [...byWine.entries()],
      CARRY_CONCURRENCY,
      async ([wine, group]) => {
        for (const [n, item] of group.entries()) {
          const read: HouseRead =
            n === 0
              ? prefetched.get(wine)!
              : await this.dbService.supabase
                  .from("restaurant_inventory")
                  .select(
                    "id, is_active, menu_price_current, menu_price_glass, kind, identity_provenance",
                  )
                  .eq("restaurant_id", restaurantId)
                  .eq("master_wine_id", wine)
                  .maybeSingle();
          await carryLine(item, read);
        }
      },
    );

    return { inventoryMap: result, priceSync };
  }

  /**
   * The blank-price flag, written on the line (null clears a flag an earlier
   * choice left). A failed write is logged loudly and returned on the entry;
   * the price outcome itself is already decided.
   */
  private async writeLineFlag(menuItemId: string, entry: PriceSyncEntry): Promise<void> {
    const { error } = await this.dbService.supabase
      .from("menu_items")
      .update({ price_flag: entry.flag, price_flag_note: entry.flagNote })
      .eq("id", menuItemId);
    if (error) {
      this.logger.error(`menu line ${menuItemId}: its price flag was not written: ${error.message}`);
      entry.flagError = error.message;
    }
  }

  /**
   * One linked menu line's prices onto the house's own (see addToInventory).
   *
   * A BLANK PRICE KEEPS THE LAST KNOWN ONE, AND IS FLAGGED (founder,
   * 2026-09-21, answer 3: a blank price on a menu line keeps the last known
   * price, is flagged if unclear, and a manager can change it). A kind the
   * line leaves blank is never written, so the house's price for it stands;
   * when the house HAS a price for that kind, keeping it is the unclear case
   * -- the scan may have missed the column, or the menu may have dropped it --
   * so the line is flagged `blank_kept_last_known` with a sentence naming the
   * kept price.
   *
   * A LINE WITH NO PRICE AT ALL, FOR A WINE THE HOUSE HAS NO PRICE FOR, IS
   * FLAGGED TOO (founder, 2026-09-21, round 6c, verbatim: "Flag it"):
   * `blank_no_house_price`. The wine would stand on the current menu with no
   * price anywhere. A single blank kind beside a priced one, for a kind the
   * house never priced (most wines are not poured by the glass), is not
   * flagged: that is the ordinary shape of a wine list, not an unclear line.
   */
  private async carryMenuPrice(
    item: InsertedMenuItem,
    restaurantId: string,
    inventoryId: string,
    userId: string,
    house: { bottle: number | string | null; glass: number | string | null },
    dating: CarryDating,
    money: HouseMoneyTerms = {},
  ): Promise<PriceSyncEntry> {
    const price = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const bottle = price(item.bottle_price);
    const glass = price(item.by_glass_price);
    const knownBottle = price(house.bottle);
    const knownGlass = price(house.glass);
    const kept: string[] = [];
    if (bottle === null && knownBottle !== null)
      kept.push(`bottle price ${fmtMoney(knownBottle, money)}`);
    if (glass === null && knownGlass !== null)
      kept.push(`glass price ${fmtMoney(knownGlass, money)}`);
    const noPriceAnywhere =
      bottle === null && glass === null && knownBottle === null && knownGlass === null;
    const flag: PriceFlag | null =
      kept.length > 0 ? "blank_kept_last_known" : noPriceAnywhere ? "blank_no_house_price" : null;
    // Kind-neutral words (F-066): a menu line is a beer, a cocktail or a tea
    // as often as a wine. The price is set on /menu itself, Edit on the line
    // (F-065), which also clears this note.
    // Past tense on purpose (last-call review, 2026-09-21): the note stays on
    // the line after a manager changes the price on Inventory, so it states
    // what was kept when the line was carried -- true forever -- not what the
    // house "keeps" now, which the first price change would make false.
    const flagNote =
      kept.length > 0
        ? `The menu line shows no ${kept.map((k) => k.split(" ")[0]).join(" or ")} price, so the house kept the ${kept.join(" and ")} it already had. An owner or a manager can change it here, with Edit on this line.`
        : noPriceAnywhere
          ? "The menu line shows no price, and the house had no price for it either, so it stands on the menu unpriced. An owner or a manager can set one here, with Edit on this line."
          : null;
    if (bottle === null && glass === null) return { outcome: "no_price", error: null, flag, flagNote, held: [] };
    try {
      const r = await setHouseMenuPrice(this.dbService.supabase, {
        restaurantId,
        inventoryId,
        ...(bottle !== null ? { bottle } : {}),
        ...(glass !== null ? { glass } : {}),
        source: dating.source,
        changedBy: userId,
        // Dated by the choice of the menu, or now for a line added to the
        // current menu -- never by the line's own created_at (L11).
        effectiveFrom: dating.effectiveFrom,
        menuId: dating.menuId,
        reason: "menu line",
      });
      return { outcome: r.outcome, error: null, flag, flagNote, held: r.held };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `menu line ${item.id} ("${item.name}"): the house price was not updated: ${message}`,
      );
      return { outcome: "failed", error: message, flag, flagNote, held: [] };
    }
  }

  private async getDefaultThresholdMin(restaurantId: string): Promise<number> {
    const { data } = await this.dbService.supabase
      .from("restaurants")
      .select("default_threshold_min")
      .eq("id", restaurantId)
      .maybeSingle();
    return data?.default_threshold_min ?? DEFAULT_THRESHOLD_MIN_FALLBACK;
  }

  private async backfillMenuItemColumn(
    menuItemToValue: Map<string, string>,
    column: "inventory_item_id" | "submission_id",
  ): Promise<void> {
    // Side by side, CARRY_CONCURRENCY at a time (F-448): one write per line,
    // never one line after another for a 2,000-line menu.
    await inPool(
      [...menuItemToValue.entries()],
      CARRY_CONCURRENCY,
      async ([menuItemId, value]) => {
      const { error } = await this.dbService.supabase
        .from("menu_items")
        .update({ [column]: value })
        .eq("id", menuItemId);

      if (error) {
        this.logger.warn(
          `Failed to backfill ${column} for menu_item ${menuItemId}: ${error.message}`,
        );
      }
      },
    );
  }

  private async markMenuUploaded(restaurantId: string): Promise<void> {
    const { error } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .update({ menu_uploaded: true })
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.warn(
        `Failed to mark menu_uploaded for restaurant ${restaurantId}: ${error.message}`,
      );
      return;
    }

    // Check every user's progress row for this restaurant and set
    // completed_at for anyone who has now finished all three tasks.
    const { data: rows } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .select(
        "id, menu_uploaded, vendor_added, team_member_invited, completed_at",
      )
      .eq("restaurant_id", restaurantId);

    const toComplete = (rows ?? []).filter(
      (row) =>
        row.menu_uploaded &&
        row.vendor_added &&
        row.team_member_invited &&
        !row.completed_at,
    );

    for (const row of toComplete) {
      const { error: completedErr } = await this.dbService.supabase
        .from("user_onboarding_progress")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", row.id);

      if (completedErr) {
        this.logger.warn(
          `Failed to set completed_at for onboarding row ${row.id}: ${completedErr.message}`,
        );
      }
    }
  }

  /**
   * The checklist of the house the session is in (F-240). The row is kept per
   * person per house (UNIQUE (user_id, restaurant_id),
   * 20261231800000_onboarding_progress_is_kept_per_house.sql); read by person
   * alone, a second house showed the first house's checklist. A house with no
   * row for this person (opened through Add a location before that file, or
   * joined by invite) has no checklist: 404, never another house's.
   */
  async getOnboardingProgress(userId: string, restaurantId: string | null) {
    if (!restaurantId)
      throw new NotFoundException(
        "Onboarding progress not found for this house",
      );
    const { data, error } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .select("*")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error) throw error;
    if (!data)
      throw new NotFoundException(
        "Onboarding progress not found for this house",
      );

    // Restaurant-scoped self-heal: an invitee who joins after the owner
    // already uploaded a menu would otherwise see "Upload your wine menu" as
    // still pending. Auto-satisfy it from the house's actual state instead.
    // The current menu is read every time: a draft read ticks menu_uploaded
    // (markMenuUploaded on every import) but stocks nothing, so it is not the
    // menu half of "activated" (F-1061, F-031). ADR 0340 rule 26 (§F13): a
    // live menu of any kind counts only when it holds a drink line, by the
    // same lineIsDrink the drink readers use (readCurrentMenuLines, drinks),
    // so a house whose only live menu is Food is not activated. A failed read
    // of either table THROWS: it never reads as "no menu" (ADR 0067).
    const live = await readCurrentMenuLines(
      this.dbService.supabase,
      data.restaurant_id,
      { drinks: true },
    );
    const menuCurrent = live.rows.length > 0;
    let menuUploaded = !!data.menu_uploaded;
    if (!menuUploaded) {
      if (menuCurrent) {
        menuUploaded = true;
        const { error: healErr } = await this.dbService.supabase
          .from("user_onboarding_progress")
          .update({ menu_uploaded: true })
          .eq("id", data.id);
        if (healErr) {
          this.logger.warn(
            `Failed to self-heal menu_uploaded for onboarding row ${data.id}: ${healErr.message}`,
          );
        }
      }
    }

    const { data: restaurant } = await this.dbService.supabase
      .from("restaurants")
      .select("threshold_configured")
      .eq("id", data.restaurant_id)
      .maybeSingle();
    const thresholdConfigured = !!restaurant?.threshold_configured;

    return {
      ...data,
      menu_uploaded: menuUploaded,
      menu_current: menuCurrent,
      threshold_configured: thresholdConfigured,
      // "Activated" = the two soft-gate essentials — the house has a current
      // menu (so a stocked inventory) and a low-stock signal. A draft read is
      // not a current menu (F-1061). Vendor/team are optional.
      activated: menuCurrent && thresholdConfigured,
    };
  }

  /**
   * How many items the house carries now. The house default reaches only rows
   * created after it is saved, so the threshold step names this count and
   * offers to set the number on them too (F-1059).
   */
  async countCarriedItems(restaurantId: string): Promise<number> {
    const { count, error } = await this.dbService.supabase
      .from("restaurant_inventory")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    if (error) {
      throw new Error(`Failed to count the items carried: ${error.message}`);
    }
    return count ?? 0;
  }

  /**
   * The house's low-stock number as saved, or the number a new item gets when
   * none is saved — what the threshold step and Settings open on (F-1414).
   * A failed read throws: the field does not open on a guess.
   */
  async readDefaultThreshold(restaurantId: string): Promise<number> {
    const { data, error } = await this.dbService.supabase
      .from("restaurants")
      .select("default_threshold_min")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read the low-stock number: ${error.message}`);
    }
    return data?.default_threshold_min ?? DEFAULT_THRESHOLD_MIN_FALLBACK;
  }

  /**
   * Saves the house default. It is copied onto a row only when the row is
   * created, so items carried now keep their own par unless the person asked,
   * in so many words, for the number on them too (`applyToCarried`, F-1059).
   * Nothing is written to a carried row without that ask.
   */
  async setDefaultThreshold(
    restaurantId: string,
    thresholdMin: number,
    applyToCarried = false,
  ): Promise<{
    default_threshold_min: number;
    threshold_configured: true;
    applied_to_carried: number;
  }> {
    const { error } = await this.dbService.supabase
      .from("restaurants")
      .update({
        default_threshold_min: thresholdMin,
        threshold_configured: true,
      })
      .eq("id", restaurantId);

    if (error) {
      throw new Error(`Failed to set default threshold: ${error.message}`);
    }

    let applied = 0;
    if (applyToCarried) {
      const { data: rows, error: applyErr } = await this.dbService.supabase
        .from("restaurant_inventory")
        .update({ threshold_min: thresholdMin })
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .select("id");
      if (applyErr) {
        throw new Error(
          `The default was saved, but it could not be set on the items you carry: ${applyErr.message}`,
        );
      }
      applied = (rows ?? []).length;
    }

    return {
      default_threshold_min: thresholdMin,
      threshold_configured: true,
      applied_to_carried: applied,
    };
  }

  async updateOnboardingProgress(
    userId: string,
    restaurantId: string | null,
    dto: UpdateOnboardingProgressDto,
  ) {
    const updates: Record<string, boolean | string> = {};
    if (dto.menu_uploaded !== undefined)
      updates.menu_uploaded = dto.menu_uploaded;
    if (dto.vendor_added !== undefined) updates.vendor_added = dto.vendor_added;
    if (dto.team_member_invited !== undefined)
      updates.team_member_invited = dto.team_member_invited;
    if (dto.checklist_dismissed !== undefined)
      updates.checklist_dismissed = dto.checklist_dismissed;

    // Auto-set completed_at when all three tasks become true
    const current = await this.getOnboardingProgress(userId, restaurantId);
    const merged = { ...current, ...updates };
    if (
      merged.menu_uploaded &&
      merged.vendor_added &&
      merged.team_member_invited &&
      !current.completed_at
    ) {
      updates.completed_at = new Date().toISOString();
    }

    const { data, error } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .update(updates)
      .eq("id", current.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
