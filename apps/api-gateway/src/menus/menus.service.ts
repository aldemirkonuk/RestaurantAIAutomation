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
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { CsvParserService } from "./parsers/csv-parser.service";
import { ScanParserService } from "./parsers/scan-parser.service";
import { WineSubmissionsService } from "../wines/wine-submissions.service";
import { ImportMenuDto, type MenuCadence } from "./dto/import-menu.dto";
import { AddMenuItemDto } from "./dto/add-menu-item.dto";
import { ReviewMenuItemDto } from "./dto/review-menu-item.dto";
import { UpdateOnboardingProgressDto } from "./dto/update-onboarding-progress.dto";
import { WineExtractItem } from "./wine-extract-item.interface";
import { itemNeedsPencil } from "./pencil-rule";
import {
  setHouseMenuPrice,
  type HeldKind,
  type HousePriceOutcome,
} from "../pricing/house-menu-price";
import { readOpenLocks, readPeople, type OpenLock } from "../pricing/price-locks";

const FREE_TIER_MANUAL_LIMIT = 25;
/** The private bucket the gateway already keeps original bytes in (document intake). */
const SOURCE_BUCKET = "vendor-attachments";
/** How long a link to a kept menu source lives. */
const SOURCE_URL_SECONDS = 300;
/** PostgREST's max_rows (supabase/config.toml): a page never holds more. */
const PAGE_ROWS = 1000;
const DEFAULT_THRESHOLD_MIN_FALLBACK = 3;
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
  // The menu's own prices: ADR 0193 carries them to the house's price. Dated
  // by the moment the menu was CHOSEN (round 3, L11), never by the line.
  by_glass_price?: number | string | null;
  bottle_price?: number | string | null;
  created_at?: string | null;
  producer?: string | null;
  vintage?: string | null;
}

/**
 * How a carry is dated and which menu it names (ADR 0193 round 3, L11). A
 * chosen menu passes the moment of the choice (`made_current_at`); a line
 * added to the current menu passes null, which the writer reads as now.
 */
interface CarryDating {
  effectiveFrom: string | null;
  menuId: string | null;
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
 *   new_wine            the house has no row for this wine yet; it is added with the menu's price
 */
export type PlanResult =
  | "change"
  | "unchanged"
  | "held_by_lock"
  | "blank_kept"
  | "blank_never_priced"
  | "not_linked"
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
  /** A locked wine that was not on the menu being replaced comes back with this one (L18). */
  returned: boolean;
  /** Both vintages are years and they differ: look before trusting the link (L18). */
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
  /** Whether the people named in the plan could be named (L25). */
  namesReadable: boolean;
  namesReason: string | null;
}

function emptyPlanCounts(): Record<PlanResult, number> {
  return {
    change: 0,
    unchanged: 0,
    held_by_lock: 0,
    blank_kept: 0,
    blank_never_priced: 0,
    not_linked: 0,
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
}

const VERSION_SELECT =
  "id, name, status, cadence, menu_date, menu_date_precision, source_method, source_path, source_mime, source_bytes, source_failure, lines_extracted, extracted_at, extracted_by, made_current_at, made_current_by, retired_at, retired_by, created_at";

const LINE_SELECT =
  "id, name, producer, category, vintage, region, country, grape_variety, by_glass_price, bottle_price, wine_library_id, inventory_item_id, source, status, price_flag, price_flag_note, created_at";

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
    if (dto.method === "scan") {
      items = await this.scanParser.parse(dto.data.imageBase64!, restaurantId);
      sourceBytes = Buffer.from(dto.data.imageBase64!, "base64");
      sourceMime = sniffMime(sourceBytes);
    } else if (dto.method === "csv") {
      if (dto.data.fileBase64) {
        items = await this.csvParser.parseExcel(dto.data.fileBase64);
        sourceBytes = Buffer.from(dto.data.fileBase64, "base64");
        sourceMime = sniffMime(sourceBytes);
      } else {
        items = this.csvParser.parse(dto.data.csvContent!);
        sourceBytes = Buffer.from(dto.data.csvContent!, "utf8");
        sourceMime = { mime: "text/csv", ext: "csv" };
      }
    } else {
      items = dto.data.items ?? [];
    }

    // 2. Keep the source, or say why it was not kept.
    const kept =
      sourceBytes && sourceMime
        ? await this.keepSource(restaurantId, sourceBytes, sourceMime)
        : null;

    // 3. A new version, in draft: kept whether or not it is ever made current.
    const menu = await this.createVersion(restaurantId, userId, dto, items, kept, menuDate);

    // 4-6: resolve against the wine library, insert menu_items, and create the
    // governance submission trail. NOT current, so no inventory or price.
    const reviewItems = await this.resolveAndPersistItems(
      items,
      restaurantId,
      menu.id,
      userId,
      dto.method,
      false,
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
    };
  }

  /** Arrival reads evidence without creating menu, library or inventory rows. */
  async previewArrivalMenu(
    method: "scan" | "csv",
    content: string,
    restaurantId: string,
    binary = false,
  ): Promise<WineExtractItem[]> {
    const items =
      method === "scan"
        ? await this.scanParser.parse(content, restaurantId, true)
        : binary
          ? await this.csvParser.parseExcel(content)
          : this.csvParser.parse(content);
    if (!items.length)
      throw new BadRequestException(
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
    const menu = await this.createVersion(
      restaurantId,
      userId,
      dto,
      items,
      null,
      null,
    );
    const reviewItems = await this.resolveAndPersistItems(
      items,
      restaurantId,
      menu.id,
      userId,
      method,
      false,
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
  ): Promise<{ id: string }> {
    const { data, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .insert({
        restaurant_id: restaurantId,
        name: "Wine List",
        menu_type: "beverage",
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
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(
        `The menu was read but could not be kept, so nothing was saved: ${error?.message ?? "no row returned"}`,
      );
    }
    return data as { id: string };
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
    // Whether the caller may set a house price (owner or manager, resolved by
    // the controller). Matters only when the menu is the CURRENT one and the
    // line names a price: that line then sets the house's own price, which
    // is an owner's or a manager's act (founder, 2026-09-21, answer 1).
    callerMayPrice = false,
  ): Promise<MenuImportReviewItem> {
    if (!callerRestaurantId) {
      throw new ForbiddenException(
        "This session is not attached to a restaurant, so no line can be added to a menu.",
      );
    }
    const { data: menu, error: menuErr } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id, restaurant_id, status")
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
    const namesPrice =
      (dto.by_glass_price !== undefined && dto.by_glass_price !== null) ||
      (dto.bottle_price !== undefined && dto.bottle_price !== null);
    if (isCurrent && namesPrice && !callerMayPrice) {
      throw new ForbiddenException(
        "Only managers and owners can put a price on the current menu: it sets the house's own price. Nothing was added.",
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

    const [reviewItem] = await this.resolveAndPersistItems(
      [item],
      menu.restaurant_id,
      menu.id,
      userId,
      "manual",
      isCurrent,
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
   */
  async discardMenuItem(
    restaurantId: string,
    menuItemId: string,
  ): Promise<{ menuItemId: string; status: "discarded" }> {
    const { data: row, error: readErr } = await this.dbService.supabase
      .from("menu_items")
      .select("id, restaurant_id, status")
      .eq("id", menuItemId)
      .maybeSingle();

    if (readErr) {
      throw new Error(`Could not read the menu item: ${readErr.message}`);
    }
    if (!row || row.restaurant_id !== restaurantId) {
      throw new NotFoundException("No menu item of this restaurant");
    }

    // The house again on the write, not only on the read above: the write is
    // what must never land on another house's row.
    const { error: writeErr } = await this.dbService.supabase
      .from("menu_items")
      .update({ status: "discarded" })
      .eq("id", menuItemId)
      .eq("restaurant_id", restaurantId);

    if (writeErr) {
      throw new Error(`The item was not discarded: ${writeErr.message}`);
    }

    return { menuItemId, status: "discarded" };
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

    if (updateErr) {
      throw new Error(`Failed to update menu_item: ${updateErr.message}`);
    }

    // Keep the restaurant's own inventory display name in sync.
    if (dto.fieldName === "name" && menuItem.inventory_item_id) {
      await this.dbService.supabase
        .from("restaurant_inventory")
        .update({ wine_name: dto.newValue })
        .eq("id", menuItem.inventory_item_id)
        .eq("restaurant_id", callerRestaurantId);
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
   * no GET at all, which is why no menu page could exist). Returns the
   * restaurant's active menu with its items, newest first within category.
   */
  async getMenu(restaurantId: string): Promise<{
    menuId: string | null;
    name: string | null;
    status: string | null;
    items: Array<Record<string, unknown>>;
  }> {
    const { data: menu, error: menuErr } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id, name, status")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active")
      .maybeSingle();

    if (menuErr) throw new Error(`Failed to load menu: ${menuErr.message}`);
    if (!menu) return { menuId: null, name: null, status: null, items: [] };

    // A discarded line (migration 20260922230100, ADR 0160 sec110 item 7) is
    // a soft remove: the row stays for the record, but this read path must
    // not keep serving it as live. Read in pages: PostgREST stops at 1000
    // rows without saying so, and a long wine list is exactly that long.
    const items = await this.readLines(menu.id, restaurantId);

    return {
      menuId: menu.id,
      name: menu.name,
      status: menu.status,
      items,
    };
  }

  /**
   * The house's CURRENT menu(s) and every live line on them — the set
   * `/promotions`' "On my menu" rung reads (founder item 36; research-filters
   * adversarial pass F1/F2). Only `status = 'active'` versions: a draft (read,
   * never chosen) or an archived menu (current once) is not "on my menu".
   * Production can hold more than one active menu for a house (ADR 0193's
   * migration adds no unique index), so this TOLERATES several and returns the
   * union — `getMenu`'s `.maybeSingle()` would throw there — and says so in
   * the log. Every line is read through `readLines` (keyset-paged; discarded
   * lines excluded), so a list past PostgREST's 1000-row stop is read whole.
   * `readAt` is when the menu became current, else when it was read, else its
   * own date — never a draft's `created_at` (F8).
   */
  async readCurrentMenus(restaurantId: string): Promise<{
    menus: Array<{ menuId: string; name: string | null; readAt: string | null }>;
    lines: Array<Record<string, unknown> & { menu_id: string }>;
  }> {
    const { data, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id, name, made_current_at, extracted_at, menu_date")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active");
    if (error) throw new Error(`The current menu (restaurant_menus) could not be read: ${error.message}`);
    const actives = (data ?? []) as Array<{
      id: string;
      name: string | null;
      made_current_at: string | null;
      extracted_at: string | null;
      menu_date: string | null;
    }>;
    if (actives.length > 1) {
      this.logger.warn(
        `Restaurant ${restaurantId} has ${actives.length} active menus; reading their lines as one union`,
      );
    }
    const menus: Array<{ menuId: string; name: string | null; readAt: string | null }> = [];
    const lines: Array<Record<string, unknown> & { menu_id: string }> = [];
    for (const m of actives) {
      menus.push({ menuId: m.id, name: m.name ?? null, readAt: m.made_current_at ?? m.extracted_at ?? m.menu_date ?? null });
      for (const line of await this.readLines(m.id, restaurantId)) lines.push({ ...line, menu_id: m.id });
    }
    return { menus, lines };
  }

  /**
   * Every live line of one menu of this house, keyset-paged on id and then
   * ordered for reading (section, then name). A failed page is an error, never
   * a shorter menu.
   */
  private async readLines(menuId: string, restaurantId: string): Promise<Array<Record<string, unknown>>> {
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
    return out;
  }

  // ── Menu versions (ADR 0193; founder 2026-09-21, answer 7) ────────────────

  /**
   * Every menu this house has read, newest first, with the current one and the
   * last one used named. The founder: keep ALL menu extractions, accessible
   * over time; a "current menu" and the "last one used". A failed read is an
   * error, never an empty history.
   */
  async listVersions(restaurantId: string): Promise<{
    current: MenuVersion | null;
    lastUsed: MenuVersion | null;
    versions: MenuVersion[];
    namesReadable: boolean;
    namesReason: string | null;
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
    const current = versions.find((v) => v.current) ?? null;
    const lastUsed =
      versions
        .filter((v) => v.status === "archived" && v.retiredAt)
        .sort((a, b) => String(b.retiredAt).localeCompare(String(a.retiredAt)))[0] ?? null;
    return {
      current,
      lastUsed,
      versions,
      namesReadable: namesError === null,
      namesReason: namesError === null ? null : `who read or chose these menus could not be named: ${namesError}`,
    };
  }

  /** One kept menu of this house and its lines. Another house's id is a 404. */
  async getVersion(
    restaurantId: string,
    menuId: string,
  ): Promise<{
    version: MenuVersion;
    items: Array<Record<string, unknown>>;
    namesReadable: boolean;
    namesReason: string | null;
  }> {
    const row = await this.readVersionRow(restaurantId, menuId);
    const { names, error } = await this.namesOf([row.extracted_by, row.made_current_by, row.retired_by]);
    return {
      version: this.toVersion(row, names),
      items: await this.readLines(menuId, restaurantId),
      namesReadable: error === null,
      namesReason: error === null ? null : `who read or chose this menu could not be named: ${error}`,
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
   */
  async planFor(restaurantId: string, menuId: string): Promise<MenuPlan> {
    const row = await this.readVersionRow(restaurantId, menuId);
    const lines = (await this.readLines(menuId, restaurantId)) as unknown as InsertedMenuItem[];
    const plan = await this.computePlan(restaurantId, menuId, row.status === "active", lines, readMomentOf(row));
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
      namesReadable: error === null,
      namesReason: error === null ? null : `the people named in this plan could not be named: ${error}`,
    };
  }

  /**
   * The plan itself, from what the house holds NOW. Shared by `planFor` (the
   * page) and `makeCurrent` (which recomputes it and compares fingerprints).
   * Every read that decides it throws on failure: a plan with a hole in it is
   * not a plan.
   */
  private async computePlan(
    restaurantId: string,
    menuId: string,
    current: boolean,
    lines: InsertedMenuItem[],
    readAt: string | null,
  ): Promise<MenuPlan> {
    const client = this.dbService.supabase;
    const fail = (what: string, message: string): never => {
      throw new InternalServerErrorException(
        `What choosing this menu would do could not be worked out, so nothing was changed: ${what} could not be read (${message}).`,
      );
    };

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

    // The wines on the menu being REPLACED (every other active menu), for L18's "returned".
    const onReplaced = new Set<string>();
    let replacing = false;
    if (!current) {
      const { data: actives, error: activeErr } = await client
        .from("restaurant_menus")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("status", "active");
      if (activeErr) fail("the current menu", activeErr.message);
      for (const m of (actives ?? []) as Array<{ id: string }>) {
        if (m.id === menuId) continue;
        replacing = true;
        for (const line of await this.readLines(m.id, restaurantId)) {
          if (line.wine_library_id) onReplaced.add(String(line.wine_library_id));
        }
      }
    }

    const counts = emptyPlanCounts();
    const onThisMenu = new Set<string>();
    const planLines: PlanLine[] = lines.map((line) => {
      const wineId = line.wine_library_id ?? null;
      const row = wineId ? (house.get(wineId) ?? null) : null;
      if (row) onThisMenu.add(String(row.id));
      const menuB = linePrice(line.bottle_price);
      const menuG = linePrice(line.by_glass_price);
      const houseB = row ? linePrice(row.menu_price_current) : null;
      const houseG = row ? linePrice(row.menu_price_glass) : null;
      const kindPlan = (kind: "bottle" | "glass", menuPrice: number | null, housePrice: number | null): PlanKind => {
        const lock = row ? (locks.get(`${row.id}:${kind}`) ?? null) : null;
        let result: PlanResult;
        if (!wineId) result = "not_linked";
        else if (!row) result = menuPrice === null ? "blank_never_priced" : "new_wine";
        else if (menuPrice === null) result = housePrice === null ? "blank_never_priced" : "blank_kept";
        else if (lock) result = "held_by_lock";
        else if (housePrice !== null && Math.abs(menuPrice - housePrice) < 0.005) result = "unchanged";
        else result = "change";
        counts[result] += 1;
        const set = row && result === "change" ? (lastSet.get(String(row.id)) ?? null) : null;
        return {
          kind,
          menuPrice,
          housePrice,
          result,
          lastSet: set ? { by: { userId: set.by, name: null }, at: set.at, source: set.source } : null,
          setAfterRead: !!set && setByAPersonAfter(set, readAt),
          lock: lock
            ? { lockId: lock.lockId, lockedPrice: lock.lockedPrice, lockedBy: { userId: lock.lockedBy, name: null }, lockedAt: lock.lockedAt }
            : null,
        };
      };
      const bottle = kindPlan("bottle", menuB, houseB);
      const glass = kindPlan("glass", menuG, houseG);
      // The same rule the carry writes (carryMenuPrice): answer 3, then answer 4.
      let flag: PriceFlag | null = null;
      if (wineId) {
        if ((menuB === null && houseB !== null) || (menuG === null && houseG !== null)) flag = "blank_kept_last_known";
        else if (menuB === null && menuG === null && houseB === null && houseG === null) flag = "blank_no_house_price";
      }
      const locked = !!row && lockedWines.has(String(row.id));
      const libVintage = row?.master_wine_library?.vintage ?? null;
      const readYear = yearOf(line.vintage);
      return {
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
        returned: !current && locked && (!replacing || !onReplaced.has(String(wineId))),
        vintageMismatch: locked && readYear !== null && typeof libVintage === "number" && readYear !== libVintage,
      };
    });

    const dormantLocks: DormantLock[] = lockRead.locks
      .filter((l) => !onThisMenu.has(l.inventoryId))
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

    const decisive = {
      menuId,
      lines: [...planLines]
        .sort((a, b) => a.menuItemId.localeCompare(b.menuItemId))
        .map((l) => [
          l.menuItemId,
          l.inventoryId,
          [l.bottle.result, l.bottle.menuPrice, l.bottle.housePrice, l.bottle.lock?.lockId ?? null],
          [l.glass.result, l.glass.menuPrice, l.glass.housePrice, l.glass.lock?.lockId ?? null],
        ]),
      dormant: dormantLocks.map((d) => d.lockId).sort(),
    };
    return {
      menuId,
      current,
      readAt,
      generatedAt: new Date().toISOString(),
      fingerprint: crypto.createHash("sha256").update(JSON.stringify(decisive)).digest("hex"),
      lines: planLines,
      counts,
      dormantLocks,
      namesReadable: true,
      namesReason: null,
    };
  }

  /**
   * Make a kept menu the house's current one (founder, 2026-09-21: after a
   * photo and an extraction the person chooses whether it becomes the current
   * default menu). An owner's or a manager's act: the controller checks.
   *
   * THE PLAN FIRST (ADR 0193 round 3, L13). The caller sends the fingerprint
   * of the plan it showed; the plan is recomputed here, before the switch, and
   * a missing fingerprint (400) or a different one (409) changes nothing.
   *
   * `make_menu_current` (migrations 20260922230700, 20260922230800) does the
   * switch in one transaction under the house row's lock and returns the
   * moment of the choice. THEN every linked line reaches the house: its price
   * is written through set_house_menu_price DATED BY THE CHOICE
   * (`made_current_at`) and naming the menu (L11) -- an older menu chosen
   * again brings its prices back, except a kind a lock holds (L4), which is
   * reported and named (L15). A price someone set after the choice but before
   * its line was carried wins (`stale`, L14). A blank price keeps the house's
   * price and flags the line; a line with no price for a wine the house has
   * no price for is flagged too (answers 3 and 4).
   */
  async makeCurrent(
    restaurantId: string,
    menuId: string,
    userId: string,
    fingerprint?: string | null,
  ): Promise<{
    outcome: "made_current" | "already_current";
    menuId: string;
    previousMenuIds: string[];
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
  }> {
    if (typeof fingerprint !== "string" || fingerprint.trim() === "") {
      throw new BadRequestException(
        "Choosing the current menu names the plan it was shown (its fingerprint, from GET /menu-versions/:menuId/plan). Nothing was changed.",
      );
    }
    // The lines are read BEFORE the switch (last-call review, 2026-09-21). Read
    // after it, a failed read left the menu current with nothing carried, and
    // choosing it again answered "already_current" with zero lines: a switch
    // that could never be finished, reported as one that had been. Now a failed
    // read throws here and nothing is changed.
    const lines = (await this.readLines(menuId, restaurantId)) as unknown as InsertedMenuItem[];
    const version = await this.readVersionRow(restaurantId, menuId);
    const plan = await this.computePlan(restaurantId, menuId, version.status === "active", lines, readMomentOf(version));
    if (plan.fingerprint !== fingerprint.trim()) {
      throw new ConflictException(
        "What choosing this menu would do has changed since it was shown (a price or a lock moved). Nothing was changed; look at the plan again.",
      );
    }
    const { data, error } = await this.dbService.supabase.rpc("make_menu_current", {
      p_restaurant_id: restaurantId,
      p_menu_id: menuId,
      p_actor: userId,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "P0002") throw new NotFoundException("No menu of this restaurant by that id. Nothing was changed.");
      if (code === "22023") throw new BadRequestException(error.message);
      throw new InternalServerErrorException(`The menu was not made current: ${error.message}`);
    }
    const r = (data ?? {}) as { outcome?: string; previous_menu_ids?: string[]; made_current_at?: string | null };
    if (r.outcome !== "made_current" && r.outcome !== "already_current") {
      throw new InternalServerErrorException(
        "The menu switch returned no outcome; whether this menu is current is unknown.",
      );
    }
    const madeCurrentAt = typeof r.made_current_at === "string" ? r.made_current_at : null;
    const empty = {
      menuId,
      previousMenuIds: r.previous_menu_ids ?? [],
      madeCurrentAt,
      lines: 0,
      priceSync: {},
      flagged: 0,
      failed: [],
      held: [],
      returned: [],
    };
    if (r.outcome === "already_current") return { outcome: "already_current", ...empty };

    if (!madeCurrentAt) {
      // The menu IS current, and its prices cannot be dated by the choice. Said
      // on every line, never dated by something else.
      const why = "the menu switch did not say when it happened, so no price was dated or carried";
      return {
        outcome: "made_current",
        ...empty,
        lines: lines.length,
        priceSync: lines.length ? { failed: lines.length } : {},
        failed: lines.map((l) => ({ menuItemId: l.id, name: l.name, error: why })),
      };
    }

    const { inventoryMap, priceSync } = await this.addToInventory(lines, restaurantId, userId, {
      effectiveFrom: madeCurrentAt,
      menuId,
    });
    await this.backfillMenuItemColumn(inventoryMap, "inventory_item_id");

    const counts: Record<string, number> = {};
    const failed: Array<{ menuItemId: string; name: string; error: string }> = [];
    const held: Array<{
      menuItemId: string;
      name: string;
      kind: "bottle" | "glass";
      lockId: string;
      lockedPrice: number | null;
      lockedBy: string | null;
      lockedAt: string | null;
    }> = [];
    let flagged = 0;
    for (const line of lines) {
      const entry = priceSync.get(line.id);
      const outcome = entry?.outcome ?? "not_linked";
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      if (entry?.flag) flagged += 1;
      for (const h of entry?.held ?? []) held.push({ menuItemId: line.id, name: line.name, ...h });
      if (entry?.outcome === "failed" || entry?.flagError) {
        failed.push({ menuItemId: line.id, name: line.name, error: entry.error ?? entry.flagError ?? "" });
      }
    }
    const returned = plan.lines.filter((l) => l.returned).map((l) => ({ menuItemId: l.menuItemId, name: l.name }));
    return {
      outcome: "made_current",
      ...empty,
      lines: lines.length,
      priceSync: counts,
      flagged,
      failed,
      held,
      returned,
    };
  }

  private async readVersionRow(restaurantId: string, menuId: string): Promise<Record<string, any>> {
    const { data, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .select(VERSION_SELECT)
      .eq("id", menuId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(`The menu could not be read: ${error.message}`);
    if (!data) throw new NotFoundException("No menu of this restaurant by that id.");
    return data as Record<string, any>;
  }

  private toVersion(r: Record<string, any>, names: Map<string, string | null>): MenuVersion {
    const who = (id: string | null | undefined) => (id ? { userId: id, name: names.get(id) ?? null } : null);
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      menuId: r.id,
      name: r.name ?? null,
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
    let resolved: ResolvedItem[];
    try {
      const results = await this.wineSubmissions.resolveLibraryWinesBatch(
        items.map((item) => ({
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
          menuCategory: item.category,
        })),
        // A menu prints "House White" and "Red — by the glass" as often as it
        // prints a producer. Those lines are this venue's own wines and never
        // join the shared library (ADR 0130), so the resolver has to know
        // whose menu this is.
        restaurantId,
      );
      resolved = items.map((item, idx) => ({
        item,
        masterWineId: results[idx]?.masterWineId ?? null,
        matched: results[idx]?.matched ?? false,
        libraryTier: results[idx]?.libraryTier ?? null,
        confidence: results[idx]?.confidence ?? null,
      }));
    } catch (err) {
      this.logger.error(`Library resolution failed for menu: ${err.message}`);
      throw new Error(
        `Menu import failed during library resolution: ${err.message}`,
      );
    }

    // Unlinked items are the ones a manager has to fix by hand, so say how
    // many there are rather than leaving it to be discovered in the UI.
    const unlinked = resolved.filter((r) => !r.masterWineId).length;
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
      .select("id, wine_library_id, name, by_glass_price, bottle_price, created_at");

    if (menuItemsErr) {
      this.logger.error(`Failed to insert menu_items: ${menuItemsErr.message}`);
      throw new Error(`menu_items insert failed: ${menuItemsErr.message}`);
    }

    // A single bulk INSERT ... RETURNING preserves VALUES-clause order in
    // practice (no ON CONFLICT / trigger reordering here), so index-aligned
    // zipping with `resolved` is safe and avoids an N+1 re-fetch.
    const insertedMenuItems: InsertedMenuItem[] = data ?? [];

    // Seed restaurant_inventory (awaited — previously fire-and-forget into a
    // table named "inventory" that does not exist in this schema) -- only for
    // the CURRENT menu. A kept menu's lines stay out of the house's inventory
    // and prices until an owner or manager makes it current.
    // A line added to the CURRENT menu is dated now (the writer's default)
    // and names its menu (ADR 0193 round 3, L11).
    const { inventoryMap, priceSync } = current
      ? await this.addToInventory(insertedMenuItems, restaurantId, userId, { effectiveFrom: null, menuId })
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
   * through set_house_menu_price as change_source 'import', DATED BY THE
   * CHOICE of the menu (`dating.effectiveFrom`, ADR 0193 round 3, L11; it had
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
    const validItems = menuItems.filter((i) => i.wine_library_id);
    if (validItems.length === 0) return { inventoryMap: result, priceSync };

    const thresholdMin = await this.getDefaultThresholdMin(restaurantId);

    for (const item of validItems) {
      const { data: existing, error: existingErr } = await this.dbService.supabase
        .from("restaurant_inventory")
        .select("id, menu_price_current, menu_price_glass")
        .eq("restaurant_id", restaurantId)
        .eq("master_wine_id", item.wine_library_id)
        .maybeSingle();

      // A failed read is not "no row" (last-call review, 2026-09-21). Read as
      // one, it tried a duplicate INSERT (refused by the house+wine UNIQUE),
      // skipped the line in silence -- counted "not_linked" -- and decided the
      // blank-price flag (founder answer 3) from a price it never saw.
      if (existingErr) {
        const message = `the house's own row for this wine could not be read, so neither its price nor a blank-price flag was decided: ${existingErr.message}`;
        this.logger.error(`menu line ${item.id} ("${item.name}"): ${message}`);
        priceSync.set(item.id, { outcome: "failed", error: message, flag: null, flagNote: null, held: [] });
        continue;
      }

      let inventoryId: string | null = existing?.id ?? null;
      if (!inventoryId) {
        // Inserted WITHOUT a price on purpose: the price goes through
        // set_house_menu_price below, so its version row says 'import' and
        // names the person, instead of the trigger's "no person named".
        const { data: created, error } = await this.dbService.supabase
          .from("restaurant_inventory")
          .insert({
            restaurant_id: restaurantId,
            master_wine_id: item.wine_library_id,
            wine_name: item.name,
            threshold_min: thresholdMin,
            is_active: true,
          })
          .select("id")
          .single();

        if (error) {
          // Still non-fatal for the menu, but said on the line: "not_linked"
          // means the menu matched no wine, never that the house's row failed.
          const message = `the wine could not be added to the house's inventory, so no price was set: ${error.message}`;
          this.logger.warn(`inventory seeding failed for "${item.name}" (non-fatal): ${error.message}`);
          priceSync.set(item.id, { outcome: "failed", error: message, flag: null, flagNote: null, held: [] });
          continue;
        }
        inventoryId = created?.id ?? null;
      }
      if (!inventoryId) continue;
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
      );
      priceSync.set(item.id, entry);
      await this.writeLineFlag(item.id, entry);
    }

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
    if (bottle === null && knownBottle !== null) kept.push(`bottle price ${knownBottle.toFixed(2)}`);
    if (glass === null && knownGlass !== null) kept.push(`glass price ${knownGlass.toFixed(2)}`);
    const noPriceAnywhere =
      bottle === null && glass === null && knownBottle === null && knownGlass === null;
    const flag: PriceFlag | null =
      kept.length > 0 ? "blank_kept_last_known" : noPriceAnywhere ? "blank_no_house_price" : null;
    // Past tense on purpose (last-call review, 2026-09-21): the note stays on
    // the line after a manager changes the price on Inventory, so it states
    // what was kept when the line was carried -- true forever -- not what the
    // house "keeps" now, which the first price change would make false.
    const flagNote =
      kept.length > 0
        ? `The menu line shows no ${kept.map((k) => k.split(" ")[0]).join(" or ")} price, so the house kept the ${kept.join(" and ")} it already had. A manager can change it on Inventory, under Your price.`
        : noPriceAnywhere
          ? "The menu line shows no price, and the house had no price for this wine either, so it stands on the menu unpriced. A manager can set one on Inventory, under Your price."
          : null;
    if (bottle === null && glass === null) return { outcome: "no_price", error: null, flag, flagNote, held: [] };
    try {
      const r = await setHouseMenuPrice(this.dbService.supabase, {
        restaurantId,
        inventoryId,
        ...(bottle !== null ? { bottle } : {}),
        ...(glass !== null ? { glass } : {}),
        source: "import",
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
    for (const [menuItemId, value] of menuItemToValue.entries()) {
      const { error } = await this.dbService.supabase
        .from("menu_items")
        .update({ [column]: value })
        .eq("id", menuItemId);

      if (error) {
        this.logger.warn(
          `Failed to backfill ${column} for menu_item ${menuItemId}: ${error.message}`,
        );
      }
    }
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

  async getOnboardingProgress(userId: string) {
    const { data, error } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data)
      throw new NotFoundException(
        "Onboarding progress not found for this user",
      );

    // Restaurant-scoped self-heal: user_onboarding_progress is keyed by
    // user_id, so an invitee who joins after the owner already uploaded a
    // menu would otherwise see "Upload your wine menu" as still pending.
    // Auto-satisfy it from the restaurant's actual state instead.
    let menuUploaded = !!data.menu_uploaded;
    if (!menuUploaded) {
      const { data: activeMenu } = await this.dbService.supabase
        .from("restaurant_menus")
        .select("id")
        .eq("restaurant_id", data.restaurant_id)
        .eq("status", "active")
        .maybeSingle();

      if (activeMenu) {
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
      threshold_configured: thresholdConfigured,
      // "Activated" = the two soft-gate essentials — the manager has a
      // working inventory and a low-stock signal. Vendor/team are optional.
      activated: menuUploaded && thresholdConfigured,
    };
  }

  async setDefaultThreshold(
    restaurantId: string,
    thresholdMin: number,
  ): Promise<{ default_threshold_min: number; threshold_configured: true }> {
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

    return { default_threshold_min: thresholdMin, threshold_configured: true };
  }

  async updateOnboardingProgress(
    userId: string,
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
    const current = await this.getOnboardingProgress(userId);
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
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
