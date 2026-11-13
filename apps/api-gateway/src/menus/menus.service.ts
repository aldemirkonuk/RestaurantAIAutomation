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
  UnprocessableEntityException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { CsvParserService } from "./parsers/csv-parser.service";
import { ScanParserService } from "./parsers/scan-parser.service";
import { WineSubmissionsService } from "../wines/wine-submissions.service";
import { ImportMenuDto, type MenuCadence } from "./dto/import-menu.dto";
import { AddMenuItemDto } from "./dto/add-menu-item.dto";
import { ReviewMenuItemDto } from "./dto/review-menu-item.dto";
import { UpdateOnboardingProgressDto } from "./dto/update-onboarding-progress.dto";
import { MenuReadWarning, WineExtractItem } from "./wine-extract-item.interface";
import { itemNeedsPencil } from "./pencil-rule";
import { isKitchenLine, lineForViewer, type LineView } from "./menu-line-view";
import { kindNoun } from "./house-good-match";
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
/**
 * Wine ids per `.in()` read of the house's rows (menu proposal 2e). Each id is
 * 36 characters in the query string, so 150 keep a request well under URL
 * limits, and one row per house and wine keeps every chunk far below PAGE_ROWS.
 */
const WINE_ID_CHUNK = 150;
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
  // The house's own good, when the line named it (a good whose row names no
  // library wine, a house gin say, is carried by this link alone).
  inventory_item_id?: string | null;
  name: string;
  // The menu's own prices: ADR 0193 carries them to the house's price. Dated
  // by the moment the menu was CHOSEN (round 3, L11), never by the line.
  by_glass_price?: number | string | null;
  bottle_price?: number | string | null;
  created_at?: string | null;
  producer?: string | null;
  vintage?: string | null;
  // What decides a kitchen line (menu-line-view.ts isKitchenLine). A line read
  // through readLines already says `kitchen_line`, decided on the full row
  // before its raw line was withheld; a freshly inserted line is decided here.
  category?: string | null;
  raw_extracted_text?: string | null;
  region?: string | null;
  grape_variety?: string | null;
  kitchen_line?: boolean;
}

/**
 * Whether a menu line is a kitchen line (a dish, not a drink). The view's
 * `kitchen_line` when the line carries it, else the same test on the row. A
 * kitchen line stays on the menu, and it is never carried to the house: no
 * inventory row, no house price, no stock. Before this, the split was shown
 * and nowhere enforced, so "Tiramisu 9" under Desserts became a bottle at 9.00
 * when its menu was made current.
 */
export function isKitchenItem(line: InsertedMenuItem): boolean {
  if (typeof line.kitchen_line === "boolean") return line.kitchen_line;
  return isKitchenLine(line.category, line.raw_extracted_text, line as unknown as Record<string, unknown>);
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

/**
 * A line on the menu being replaced that this menu does not carry (2d, "not on
 * this file"). Shown, never acted on: choosing this menu leaves its wine, its
 * house row and its prices exactly as they are (ADR 0193 L12, "Silence changes
 * nothing"), and a lock on it stays (L16).
 */
export interface NotOnThisFile {
  /** The line on the menu being replaced. */
  menuItemId: string;
  name: string;
  producer: string | null;
  vintage: string | null;
  wineLibraryId: string | null;
  /** The house's own row for this wine, when it has one. */
  inventoryId: string | null;
  /** The house's prices now, which stay. */
  bottle: number | null;
  glass: number | null;
  /** Kinds an open lock holds; they stay locked. */
  locked: Array<"bottle" | "glass">;
  /** False when the house's row is deleted or inactive (it no longer sells it); null with no row. */
  active: boolean | null;
}

/**
 * A name folded for "is it on the other file": case, accents, spacing and the
 * Turkish dotted/dotless i, so "RAKI" and "Rakı" are one name.
 */
export function foldMenuName(name: unknown): string {
  return String(name ?? "")
    .replace(/[İIı]/g, "i")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
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
  /**
   * Lines set aside as kitchen lines: they stay on the menu and are carried
   * nowhere (no wine, price or stock). Not in `lines` or `counts`.
   */
  kitchenLines: Array<{ menuItemId: string; name: string }>;
  /**
   * Wines on the menu being replaced that this menu does not carry. Display
   * only: they keep their price and their row (L12). Empty when this menu is
   * already current or no menu is being replaced.
   */
  notOnThisFile: NotOnThisFile[];
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
  /** null = read before this was recorded. */
  readWarnings: MenuReadWarning[] | null;
  extractedAt: string | null;
  extractedBy: { userId: string; name: string | null } | null;
  madeCurrentAt: string | null;
  madeCurrentBy: { userId: string; name: string | null } | null;
  retiredAt: string | null;
  retiredBy: { userId: string; name: string | null } | null;
  createdAt: string | null;
}

/** What `POST /menus/import` says when a read finds no line (422, nothing kept). */
const EMPTY_READ_REFUSAL: Record<string, string> = {
  scan: "No line could be read from this file, so no menu was kept. Try a clearer photo or the PDF itself.",
  csv: "No line could be read from this file, so no menu was kept. Check that each row names a wine.",
  manual: "No line was given, so no menu was kept.",
};

const VERSION_SELECT =
  "id, name, status, cadence, menu_date, menu_date_precision, source_method, source_path, source_mime, source_bytes, source_failure, lines_extracted, read_warnings, extracted_at, extracted_by, made_current_at, made_current_by, retired_at, retired_by, created_at";

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
  "id, name, producer, category, vintage, region, country, grape_variety, by_glass_price, bottle_price, wine_library_id, inventory_item_id, source, status, review_notes, price_flag, price_flag_note, raw_extracted_text, created_at";

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

/**
 * A price a person typed for a menu line, as a number, or why it is not one.
 *
 * Menu r21 (2026-11-13): the correction route read a price by deleting every
 * character that was not a digit or a dot, so a house that writes a decimal
 * comma had "45,50" stored as 4550.00 and "1.250,00" as 1.25, and "-5" became
 * 5 -- and on the current menu that number became the house's own price. Now:
 *   - a currency mark at either end and spaces are dropped (45 TL, $70, ₺ 1 250);
 *   - one separator followed by one or two digits is the decimal ("45,5", "45.50");
 *   - with both marks, the last is the decimal and the other groups thousands
 *     in threes ("1.250,00", "1,250.00");
 *   - one mark followed by three digits ("1,250", "1.250") is refused: it is
 *     1250 in one house and 1.25 in another, and a price is never guessed;
 *   - anything else (a minus, letters, two decimals) is refused.
 */
export function parseMenuPrice(raw: string): { value: number } | { refused: string } {
  const typed = String(raw ?? "");
  const s = typed
    .replace(/\s+/g, "")
    .replace(/^(?:[₺$€£]|TL|TRY|USD|EUR|GBP)/i, "")
    .replace(/(?:[₺$€£]|TL|TRY|USD|EUR|GBP)$/i, "");
  const not = (why: string) => ({ refused: `"${typed}" is not a price: ${why}. Nothing was changed.` });
  if (s === "") return not("there is no number in it");
  if (!/^\d[\d.,]*$/.test(s)) return not("a price is written in digits, with no minus, no letters and at most one decimal mark");
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  const asNumber = (whole: string, frac: string) => ({ value: Number(`${whole}${frac ? `.${frac}` : ""}`) });
  if (dot >= 0 && comma >= 0) {
    const dec = dot > comma ? "." : ",";
    const group = dec === "." ? "," : ".";
    const at = s.lastIndexOf(dec);
    const whole = s.slice(0, at);
    const frac = s.slice(at + 1);
    const grouped = new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})*$`);
    if (frac.length < 1 || frac.length > 2 || !grouped.test(whole)) return not("its marks do not read as one amount");
    return asNumber(whole.split(group).join(""), frac);
  }
  const sep = dot >= 0 ? "." : comma >= 0 ? "," : null;
  if (sep === null) return asNumber(s, "");
  const parts = s.split(sep);
  if (parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2 && parts[0] !== "") return asNumber(parts[0], parts[1]);
  if (parts.length === 2 && parts[1].length === 3 && /^\d{1,3}$/.test(parts[0])) {
    const whole = `${parts[0]}${parts[1]}`;
    const small = String(Number(`${parts[0]}.${parts[1]}`));
    return not(`it could be ${whole} or ${small}; write it as ${whole} or ${small}`);
  }
  if (parts.length > 2 && /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => p.length === 3)) {
    return asNumber(parts.join(""), "");
  }
  return not("its marks do not read as one amount");
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
  | "kitchen_line"
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
    warnings: MenuReadWarning[];
  }> {
    const { restaurantId } = dto;
    // Checked before the billed read: a date that is not on the calendar
    // refuses the upload rather than failing after it was paid for.
    const menuDate = parseMenuDate(dto.menuDate);

    // 1. Parse input → WineExtractItem[]. A scan is the billed read; its spend
    // ceiling fails CLOSED (scan-parser.service.ts, ADR 0163 Q22).
    let items: WineExtractItem[];
    let warnings: MenuReadWarning[] = [];
    let sourceBytes: Buffer | null = null;
    let sourceMime: { mime: string; ext: string } | null = null;
    if (dto.method === "scan") {
      ({ items, warnings } = await this.scanParser.parseWithWarnings(
        dto.data.imageBase64!,
        restaurantId,
      ));
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

    // 1b. A read with no line is refused BEFORE anything is written: no source
    // upload, no draft version, no onboarding mark (QA B-5; ADR 0067, a failed
    // read is never an empty one). The warnings ride along so the page can say
    // which pages failed.
    if (items.length === 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: "Unprocessable Entity",
        message: EMPTY_READ_REFUSAL[dto.method] ?? EMPTY_READ_REFUSAL.scan,
        warnings,
      });
    }

    // 2. Keep the source, or say why it was not kept.
    const kept =
      sourceBytes && sourceMime
        ? await this.keepSource(restaurantId, sourceBytes, sourceMime)
        : null;

    // 3. A new version, in draft: kept whether or not it is ever made current.
    const menu = await this.createVersion(
      restaurantId,
      userId,
      dto,
      items,
      warnings,
      kept,
      menuDate,
    );

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
    // Only a read with a line gets here (1b): an empty read is not proof
    // (ADR 0213 #17).
    await this.markMenuUploaded(restaurantId);

    return {
      menuId: menu.id,
      current: false,
      itemsExtracted: items.length,
      submissionsCreated: reviewItems.filter((r) => r.submissionId).length,
      items: reviewItems,
      source: { kept: !!kept?.path, failure: kept?.failure ?? null },
      warnings,
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
      [], // arrival refuses a partial read
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
    warnings: MenuReadWarning[],
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
        read_warnings: warnings,
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
    let newValueTyped: string | number = dto.newValue;
    if (isPrice) {
      const price = parseMenuPrice(dto.newValue);
      if ("refused" in price) throw new BadRequestException(price.refused);
      newValueTyped = price.value;
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
      } else if (isKitchenItem(menuItem as InsertedMenuItem)) {
        // A dish's price lives on its menu line only (#1085): there is no
        // house price for it, and saying "not matched to a wine" was wrong.
        priceSync = "kitchen_line";
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
      // What was stored, so a page says the price it now holds ("45,50" -> "45.5").
      newValue: String(newValueTyped),
      ...(priceSync !== undefined ? { priceSync, priceSyncError, priceHeld } : {}),
    };
  }

  /**
   * Read path for the interactive menu (decision 39 — the menus module had
   * no GET at all, which is why no menu page could exist). Returns the
   * restaurant's active menu with its items, newest first within category.
   * A line's raw line is sent only when `view.rawLine` says so (default: not);
   * a reply without it says `rawLineWithheld: true`.
   */
  async getMenu(
    restaurantId: string,
    view: LineView = { rawLine: false },
  ): Promise<{
    menuId: string | null;
    name: string | null;
    status: string | null;
    items: Array<Record<string, unknown>>;
    rawLineWithheld?: true;
  }> {
    const { data: menu, error: menuErr } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id, name, status")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active")
      .maybeSingle();

    if (menuErr) throw new Error(`Failed to load menu: ${menuErr.message}`);
    const withheld = view.rawLine ? {} : { rawLineWithheld: true as const };
    if (!menu) return { menuId: null, name: null, status: null, items: [], ...withheld };

    // A discarded line (migration 20260922230100, ADR 0160 sec110 item 7) is
    // a soft remove: the row stays for the record, but this read path must
    // not keep serving it as live. Read in pages: PostgREST stops at 1000
    // rows without saying so, and a long wine list is exactly that long.
    const items = await this.readLines(menu.id, restaurantId, view);

    return {
      menuId: menu.id,
      name: menu.name,
      status: menu.status,
      items,
      ...withheld,
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
   * a shorter menu. Each row goes through `lineForViewer`: the allowlisted
   * keys and `kitchen_line` for everyone, the raw line only when the caller
   * says the viewer may see it (default: not). The plan, make-current and
   * readCurrentMenus readers pass no view, so they get no raw line.
   */
  private async readLines(
    menuId: string,
    restaurantId: string,
    view: LineView = { rawLine: false },
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
    return out.map((row) => lineForViewer(row, view));
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
      items: await this.readLines(menuId, restaurantId, view),
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
    // Every row by its id too: a line linked to a good whose row names no
    // library wine (a house gin) is planned on that row, as the carry does.
    const byInventory = new Map<string, Record<string, any>>();
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
        for (const r of rows) {
          if (r.master_wine_id) house.set(String(r.master_wine_id), r);
          byInventory.set(String(r.id), r);
        }
        if (rows.length < PAGE_ROWS) break;
        after = String(rows[rows.length - 1].id);
      }
    }

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
    // Every drink line of the menu being replaced, for "not on this file" (2d).
    const replacedLines: InsertedMenuItem[] = [];
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
          else if (line.inventory_item_id) onReplaced.add(`good:${String(line.inventory_item_id)}`);
          const row = line as unknown as InsertedMenuItem;
          if (!isKitchenItem(row)) replacedLines.push(row);
        }
      }
    }

    const counts = emptyPlanCounts();
    const onThisMenu = new Set<string>();
    const kitchenLines = lines
      .filter((line) => isKitchenItem(line))
      .map((line) => ({ menuItemId: line.id, name: line.name }));
    const planLines: PlanLine[] = lines.filter((line) => !isKitchenItem(line)).map((line) => {
      const wineId = line.wine_library_id ?? null;
      const row = wineId
        ? (house.get(wineId) ?? null)
        : line.inventory_item_id
          ? (byInventory.get(String(line.inventory_item_id)) ?? null)
          : null;
      if (row) onThisMenu.add(String(row.id));
      const menuB = linePrice(line.bottle_price);
      const menuG = linePrice(line.by_glass_price);
      const houseB = row ? linePrice(row.menu_price_current) : null;
      const houseG = row ? linePrice(row.menu_price_glass) : null;
      const kindPlan = (kind: "bottle" | "glass", menuPrice: number | null, housePrice: number | null): PlanKind => {
        const lock = row ? (locks.get(`${row.id}:${kind}`) ?? null) : null;
        let result: PlanResult;
        if (!wineId && !row) result = "not_linked";
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
      if (wineId || row) {
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
        returned:
          !current &&
          locked &&
          (!replacing || !onReplaced.has(wineId ? String(wineId) : `good:${String(line.inventory_item_id)}`)),
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

    // NOT ON THIS FILE (2d). A replaced line is on this file when this menu
    // carries its wine. A name stands in for the wine only when one side is
    // unlinked: two lines that both name a wine are compared by the wine, so
    // "Barolo" 2015 replaced by "Barolo" 2018 (another library wine, which
    // choosing this menu does not carry onto the 2015 row) is listed. One
    // entry per wine (or per name, unlinked), in the replaced menu's order.
    // Nothing is written for them: L12.
    const idsHere = new Set<string>();
    const namesHere = new Set<string>();
    const unlinkedNamesHere = new Set<string>();
    for (const line of lines) {
      if (isKitchenItem(line)) continue;
      const name = foldMenuName(line.name);
      if (line.wine_library_id) idsHere.add(String(line.wine_library_id));
      else unlinkedNamesHere.add(name);
      namesHere.add(name);
    }
    const notOnThisFile: NotOnThisFile[] = [];
    const seen = new Set<string>();
    for (const line of replacedLines) {
      const wineId = line.wine_library_id ? String(line.wine_library_id) : null;
      const name = foldMenuName(line.name);
      const here = wineId ? idsHere.has(wineId) || unlinkedNamesHere.has(name) : namesHere.has(name);
      if (here) continue;
      const key = wineId ? `w:${wineId}` : `n:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = wineId ? (house.get(wineId) ?? null) : null;
      const locked = row
        ? (["bottle", "glass"] as const).filter((k) => locks.has(`${row.id}:${k}`))
        : [];
      notOnThisFile.push({
        menuItemId: line.id,
        name: line.name,
        producer: line.producer ?? null,
        vintage: line.vintage ?? null,
        wineLibraryId: wineId,
        inventoryId: row ? String(row.id) : null,
        bottle: row ? linePrice(row.menu_price_current) : null,
        glass: row ? linePrice(row.menu_price_glass) : null,
        locked: [...locked],
        // A row the house deleted or set inactive still holds its prices, but
        // the house no longer sells the wine: the page says so.
        active: row ? row.is_active !== false && !row.deleted_at : null,
      });
    }

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
      kitchen: kitchenLines.map((k) => k.menuItemId).sort(),
      // The person is shown which wines stay as they are; a different list is
      // a different plan (L13), though nothing is written for them.
      notOnThisFile: notOnThisFile.map((n) => n.menuItemId).sort(),
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
      kitchenLines,
      notOnThisFile,
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
      const wines = lines.filter((l) => !isKitchenItem(l));
      const kitchen = lines.length - wines.length;
      return {
        outcome: "made_current",
        ...empty,
        lines: lines.length,
        priceSync: {
          ...(wines.length ? { failed: wines.length } : {}),
          ...(kitchen ? { kitchen_line: kitchen } : {}),
        },
        failed: wines.map((l) => ({ menuItemId: l.id, name: l.name, error: why })),
      };
    }

    // addToInventory writes each line's house link and price flag back itself.
    const { priceSync } = await this.addToInventory(lines, restaurantId, userId, {
      effectiveFrom: madeCurrentAt,
      menuId,
    });

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
      readWarnings: Array.isArray(r.read_warnings) ? r.read_warnings : null,
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
    //
    // A KITCHEN LINE NEVER REACHES THE LIBRARY (menu walk 2026-11-11). The
    // resolver makes a provisional library row for every line it cannot match,
    // so "Tiramisu 9" under Desserts became a wine in the shared library at
    // import, whether or not its menu was ever chosen. A dish is not a wine:
    // it is decided here with the same test the page and the carry use
    // (menu-line-view.ts isKitchenLine), kept on the menu unlinked, and never
    // sent to the resolver. No library row, so no submission either.
    const kitchen = items.map((item) =>
      isKitchenLine(item.category, item.raw_text, item as unknown as Record<string, unknown>),
    );
    const drinks = items.filter((_, idx) => !kitchen[idx]);
    let resolved: ResolvedItem[];
    try {
      const drinkResults = drinks.length === 0 ? [] : await this.wineSubmissions.resolveLibraryWinesBatch(
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
          menuCategory: item.category,
        })),
        // A menu prints "House White" and "Red — by the glass" as often as it
        // prints a producer. Those lines are this venue's own wines and never
        // join the shared library (ADR 0130), so the resolver has to know
        // whose menu this is.
        restaurantId,
      );
      // Back onto every line, in the menu's order: a kitchen line is unlinked.
      let next = 0;
      resolved = items.map((item, idx) => {
        const r = kitchen[idx] ? undefined : drinkResults[next++];
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

    // Unlinked items are the ones a manager has to fix by hand, so say how
    // many there are rather than leaving it to be discovered in the UI.
    // A kitchen line is unlinked on purpose and is not counted.
    const unlinked = resolved.filter((r, idx) => !r.masterWineId && !kitchen[idx]).length;
    if (unlinked > 0) {
      this.logger.error(
        `Menu import: ${unlinked}/${drinks.length} drink line(s) could not be ` +
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
      .select(
        "id, wine_library_id, name, by_glass_price, bottle_price, created_at, producer, vintage, region, grape_variety, category, raw_extracted_text",
      );

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
    // (addToInventory wrote each carried line's house link back itself.)

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
      await this.writeBackLines(
        restaurantId,
        [...submissionMap.entries()].map(([id, submissionId]) => ({ id, submission_id: submissionId })),
      );
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
    // A kitchen line is never carried: no inventory row, no price, no stock.
    // Said on the line, never dropped (ADR 0193 round 3, L15).
    for (const i of menuItems) {
      if (isKitchenItem(i)) {
        priceSync.set(i.id, { outcome: "kitchen_line", error: null, flag: null, flagNote: null, held: [] });
      }
    }
    // A line is carried by its library wine, or -- when it names none -- by the
    // house's own good it was linked to (a house gin whose row names no wine).
    const validItems = menuItems.filter((i) => (i.wine_library_id || i.inventory_item_id) && !isKitchenItem(i));
    if (validItems.length === 0) return { inventoryMap: result, priceSync };
    const keyOf = (i: InsertedMenuItem): string =>
      i.wine_library_id ? String(i.wine_library_id) : `good:${String(i.inventory_item_id)}`;

    const client = this.dbService.supabase;
    const thresholdMin = await this.getDefaultThresholdMin(restaurantId);

    // BATCHED (menu proposal 2e, M15). This was one read, maybe one insert,
    // one flag write and one link write PER LINE -- about a third of a second
    // each against the pooler, so minutes for a long list. Now: the house's
    // rows read in chunks, one insert for the wines it lacks, and one write-back
    // for every line's link and flag. The price stays one set_house_menu_price
    // call per priced line: it is the writer that holds the locks (L4, L27).

    // 1. The house's own row for every wine on these lines. A chunk that cannot
    //    be read fails its lines, said on each, never taken for "no row".
    const wineIds = [...new Set(validItems.filter((i) => i.wine_library_id).map((i) => String(i.wine_library_id)))];
    type HouseRow = { id: string; master_wine_id: string | null; kind?: string | null; menu_price_current: number | string | null; menu_price_glass: number | string | null };
    const existingByWine = new Map<string, HouseRow>();
    const readFailed = new Map<string, string>();
    const HOUSE_ROW = "id, master_wine_id, kind, menu_price_current, menu_price_glass";
    for (let at = 0; at < wineIds.length; at += WINE_ID_CHUNK) {
      const chunk = wineIds.slice(at, at + WINE_ID_CHUNK);
      const { data, error } = await client
        .from("restaurant_inventory")
        .select(HOUSE_ROW)
        .eq("restaurant_id", restaurantId)
        .in("master_wine_id", chunk);
      if (error) {
        for (const w of chunk) readFailed.set(w, error.message);
        continue;
      }
      // One row per house and wine (the UNIQUE), so a chunk never nears the 1000-row cap.
      for (const r of (data ?? []) as HouseRow[]) existingByWine.set(String(r.master_wine_id), r);
    }
    // The goods named by their own row, by id and in this house only. A link to
    // a row that is gone is said on its line, never taken for a new wine.
    const goodIds = [...new Set(validItems.filter((i) => !i.wine_library_id).map((i) => String(i.inventory_item_id)))];
    for (let at = 0; at < goodIds.length; at += WINE_ID_CHUNK) {
      const chunk = goodIds.slice(at, at + WINE_ID_CHUNK);
      const { data, error } = await client
        .from("restaurant_inventory")
        .select(HOUSE_ROW)
        .eq("restaurant_id", restaurantId)
        .in("id", chunk);
      if (error) {
        for (const g of chunk) readFailed.set(`good:${g}`, error.message);
        continue;
      }
      for (const r of (data ?? []) as HouseRow[]) existingByWine.set(`good:${String(r.id)}`, r);
    }

    // 2. One insert for every wine the house has no row for, named by its first
    //    line and WITHOUT a price on purpose: the price goes through
    //    set_house_menu_price below, so its version row says 'import' and names
    //    the person, instead of the trigger's "no person named". If the batch is
    //    refused, each wine is tried on its own so one refusal does not fail the rest.
    const firstLine = new Map<string, InsertedMenuItem>();
    for (const i of validItems) if (i.wine_library_id && !firstLine.has(String(i.wine_library_id))) firstLine.set(String(i.wine_library_id), i);
    const missing = wineIds.filter((w) => !readFailed.has(w) && !existingByWine.has(w));
    const createdByWine = new Map<string, string>();
    const createdKind = new Map<string, string | null>();
    const insertFailed = new Map<string, string>();
    if (missing.length > 0) {
      const rowFor = (w: string) => ({
        restaurant_id: restaurantId,
        master_wine_id: w,
        wine_name: firstLine.get(w)!.name,
        threshold_min: thresholdMin,
        is_active: true,
      });
      const { data, error } = await client
        .from("restaurant_inventory")
        .insert(missing.map(rowFor))
        .select("id, master_wine_id, kind");
      if (!error) {
        for (const r of (data ?? []) as Array<{ id: string; master_wine_id: string; kind?: string | null }>) {
          createdByWine.set(String(r.master_wine_id), String(r.id));
          createdKind.set(String(r.master_wine_id), r.kind ?? null);
        }
      } else {
        this.logger.warn(`adding ${missing.length} wine(s) to the house in one go was refused (${error.message}); adding them one by one`);
        for (const w of missing) {
          const { data: one, error: oneErr } = await client.from("restaurant_inventory").insert(rowFor(w)).select("id, kind").single();
          if (oneErr || !one?.id) insertFailed.set(w, oneErr?.message ?? "no row came back");
          else {
            createdByWine.set(w, String(one.id));
            createdKind.set(w, (one as { kind?: string | null }).kind ?? null);
          }
        }
      }
    }

    // 3. Each line, in menu order: its row, then its price through the writer.
    const carried = new Set<string>();
    const writeBacks: Array<{ id: string; inventory_item_id: string; price_flag: PriceFlag | null; price_flag_note: string | null }> = [];
    for (const item of validItems) {
      const w = keyOf(item);
      // A failed read is not "no row" (last-call review, 2026-09-21). Read as
      // one, it tried a duplicate INSERT (refused by the house+wine UNIQUE),
      // skipped the line in silence -- counted "not_linked" -- and decided the
      // blank-price flag (founder answer 3) from a price it never saw.
      const readErr = readFailed.get(w);
      if (readErr !== undefined) {
        const message = `the house's own row for this wine could not be read, so neither its price nor a blank-price flag was decided: ${readErr}`;
        this.logger.error(`menu line ${item.id} ("${item.name}"): ${message}`);
        priceSync.set(item.id, { outcome: "failed", error: message, flag: null, flagNote: null, held: [] });
        continue;
      }
      const existing = existingByWine.get(w) ?? null;
      const inventoryId = existing?.id ?? createdByWine.get(w) ?? null;
      if (!inventoryId && !item.wine_library_id) {
        const message = "the house's good this line was linked to is no longer in the house's inventory, so no price was set";
        this.logger.warn(`menu line ${item.id} ("${item.name}"): ${message}`);
        priceSync.set(item.id, { outcome: "failed", error: message, flag: null, flagNote: null, held: [] });
        continue;
      }
      if (!inventoryId) {
        // Still non-fatal for the menu, but said on the line: "not_linked"
        // means the menu matched no wine, never that the house's row failed.
        const why = insertFailed.get(w) ?? "no row came back";
        const message = `the wine could not be added to the house's inventory, so no price was set: ${why}`;
        this.logger.warn(`inventory seeding failed for "${item.name}" (non-fatal): ${why}`);
        priceSync.set(item.id, { outcome: "failed", error: message, flag: null, flagNote: null, held: [] });
        continue;
      }
      let house = {
        bottle: existing?.menu_price_current ?? null,
        glass: existing?.menu_price_glass ?? null,
      };
      if (carried.has(w)) {
        // A second line of the same wine: the first may just have moved its
        // price, so the row is read again -- what the per-line read used to see.
        const { data: again, error: againErr } = await client
          .from("restaurant_inventory")
          .select("menu_price_current, menu_price_glass")
          .eq("id", inventoryId)
          .eq("restaurant_id", restaurantId)
          .maybeSingle();
        if (againErr) {
          const message = `the house's own row for this wine could not be read, so neither its price nor a blank-price flag was decided: ${againErr.message}`;
          this.logger.error(`menu line ${item.id} ("${item.name}"): ${message}`);
          priceSync.set(item.id, { outcome: "failed", error: message, flag: null, flagNote: null, held: [] });
          continue;
        }
        house = { bottle: again?.menu_price_current ?? null, glass: again?.menu_price_glass ?? null };
      }
      result.set(item.id, inventoryId);
      // A row this call created is "created" on its first line only.
      if (!existing && !carried.has(w)) result.created.add(item.id);
      carried.add(w);
      const kind = existing ? (existing.kind ?? null) : (createdKind.get(w) ?? null);
      const entry = await this.carryMenuPrice(item, restaurantId, inventoryId, userId, house, dating, kind);
      priceSync.set(item.id, entry);
      writeBacks.push({ id: item.id, inventory_item_id: inventoryId, price_flag: entry.flag, price_flag_note: entry.flagNote });
    }

    // 4. Every carried line's house link and price flag (null clears a flag an
    //    earlier choice left), in one call. A line whose write failed carries
    //    the reason; the price outcome itself is already decided.
    await this.writeBackLines(restaurantId, writeBacks, (id, message) => {
      const entry = priceSync.get(id);
      if (entry) entry.flagError = message;
    });

    return { inventoryMap: result, priceSync };
  }

  /**
   * Writes back many lines of one house in one call (menu proposal 2e):
   * `menu_items_write_back` sets only the keys each row names (house link,
   * submission, price flag and note). If that call is refused or does not say
   * how many rows it wrote -- the function not there yet, say -- each line is
   * written on its own, and a line whose write fails is handed to `onFail`
   * with the reason and logged loudly.
   */
  private async writeBackLines(
    restaurantId: string,
    rows: Array<{ id: string } & Record<string, unknown>>,
    onFail?: (menuItemId: string, message: string) => void,
  ): Promise<void> {
    if (rows.length === 0) return;
    const client = this.dbService.supabase;
    const { data, error } = await client.rpc("menu_items_write_back", {
      p_restaurant_id: restaurantId,
      p_rows: rows,
    });
    if (!error && typeof data === "number") {
      if (data !== rows.length) {
        this.logger.warn(`${rows.length - data} of ${rows.length} menu line(s) were gone when written back`);
      }
      return;
    }
    this.logger.warn(
      `menu lines were not written back in one call (${error?.message ?? "no count came back"}); writing them one by one`,
    );
    for (const { id, ...patch } of rows) {
      const { error: oneErr } = await client
        .from("menu_items")
        .update(patch)
        .eq("id", id)
        .eq("restaurant_id", restaurantId);
      if (oneErr) {
        this.logger.error(`menu line ${id}: ${Object.keys(patch).join(", ")} not written: ${oneErr.message}`);
        onFail?.(id, oneErr.message);
      }
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
    // The good's kind, for the sentence: a gin is not "this wine" (r21, D4).
    kind: string | null = null,
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
          ? `The menu line shows no price, and the house had no price for this ${kindNoun(kind)} either, so it stands on the menu unpriced. A manager can set one on Inventory, under Your price.`
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
