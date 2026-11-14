import { restoreArrivalEntry } from "../arrival/restore-entry";
import * as crypto from "crypto";
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  CsvParserService,
  type CsvRowIssue,
} from "./parsers/csv-parser.service";
import { ScanParserService } from "./parsers/scan-parser.service";
import { pagesToOneFile } from "./parsers/pages-to-pdf";
import { WineSubmissionsService } from "../wines/wine-submissions.service";
import { ImportMenuDto, type MenuCadence } from "./dto/import-menu.dto";
import { AddMenuItemDto } from "./dto/add-menu-item.dto";
import { ReviewMenuItemDto } from "./dto/review-menu-item.dto";
import { UpdateOnboardingProgressDto } from "./dto/update-onboarding-progress.dto";
import { MenuReadWarning, WineExtractItem } from "./wine-extract-item.interface";
import { itemNeedsPencil } from "./pencil-rule";
import { lineMoney, namesMoney, typedMoneyOf, typedMoneyRefusal } from "./menu-money";
import { isKitchenLine, lineForViewer, type LineView } from "./menu-line-view";
import { kindNoun, lineFamily, matchHouseGoods } from "./house-good-match";
import {
  setHouseMenuPrice,
  setHouseMenuPrices,
  type HeldKind,
  type HousePriceOutcome,
  type HousePriceRowAnswer,
  type KindOutcome,
} from "../pricing/house-menu-price";
import { readOpenLocks, readPeople, type OpenLock } from "../pricing/price-locks";

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
  /** The house's own good this line named (house-good-match.ts); never sent to the library. */
  houseItemId?: string | null;
  /** Two or more of the house's goods fit the line: none was guessed. */
  houseCandidates?: HouseCandidate[];
  /**
   * A kitchen line (menu-line-view.ts isKitchenLine): kept unlinked, never
   * sent to the library. Carried on the line since r33, when resolving moved
   * ahead of the version write (#773) and the write lost the local list.
   */
  kitchen?: boolean;
  /**
   * Why the line took no price: its menu prints the price only in another
   * money (r36 N1, menu-money.ts). Carried on the line since the r37 meet,
   * because resolving and writing are two steps on the menu chain.
   */
  heldNote?: string;
}

interface HouseCandidate {
  inventoryItemId: string;
  name: string;
  kind: string | null;
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
  /** The section the line was read or set into (LINE_SELECT reads it). */
  category?: string | null;
  raw_extracted_text?: string | null;
  region?: string | null;
  grape_variety?: string | null;
  kitchen_line?: boolean;
  // Set at import when the menu printed this line's price only in another
  // money (r36 N1): the carry keeps the flag and takes no price.
  price_flag?: string | null;
  price_flag_note?: string | null;
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

/**
 * The price flags a line can carry (founder answers 3 and 4), and
 * `other_currency`: the menu prints the line's price only in a money that is
 * not the house's, so no price was taken from it (r36 N1, menu-money.ts).
 */
type PriceFlag = "blank_kept_last_known" | "blank_no_house_price" | "other_currency";

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
 *   kept_newer          a price someone set after this menu was chosen stands: the carry is
 *                       dated by the choice, and the writer answers it "stale" (L14; r31 w1 F2)
 */
export type PlanResult =
  | "kept_newer"
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
  /** The line's section as read or set (red, cocktail, beer…): the plan names a line by its kind. */
  category: string | null;
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
  /** r36 N1: why no price is taken, when the menu prints it only in another money. */
  flagNote?: string;
  /** A locked wine that was not on the menu being replaced comes back with this one (L18). */
  returned: boolean;
  /** Both vintages are years and they differ: look before trusting the link (L18). */
  vintageMismatch: boolean;
  /**
   * r35 G21: a line linked to none of the house's goods that fits one or more
   * of its live goods by name, matched now (the read's own candidates are not
   * kept). Choosing the menu carries such a line as a good of its own beside
   * them, so the plan names them and a manager links it first. Absent when no
   * good fits, and on the current menu (its lines were carried already).
   */
  houseCandidates?: HouseCandidate[];
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
/**
 * What taking one dropped drink off sale did (r35 G10): per kind, the
 * writer's own outcome ("changed" is cleared, "unchanged" had no price,
 * "locked" is held and named in `held`, "stale" a price set after the
 * choice stands), or the sentence for why nothing is known.
 */
export interface TakenOff {
  menuItemId: string;
  name: string;
  inventoryId: string;
  bottle: KindOutcome | null;
  glass: KindOutcome | null;
  held: HeldKind[];
  error: string | null;
}

function takenOffFailed(n: NotOnThisFile, error: string): TakenOff {
  return { menuItemId: n.menuItemId, name: n.name, inventoryId: n.inventoryId ?? "", bottle: null, glass: null, held: [], error };
}

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
  /** The house's IANA zone, for saying its dates on its clock (never part of the fingerprint). */
  timezone?: string | null;
  /** Why there is no zone to say them in: not set, not a zone, or not readable. */
  timezoneReason?: string | null;
}

/**
 * The zone a house's menu dates are said in, or why there is none (menu r21:
 * the founder's goal is "dates in the house time zone"; until now /menu named
 * a read by the clock of whatever device looked at it, so a house in Istanbul
 * read from a laptop in Detroit was told its 06:05 menu was read 22:05 the
 * day before). Never a default: a missing zone is said, and the page falls
 * back to the device's clock saying so (ADR 0067; venueTime.ts rule 2).
 */
export function houseZoneOf(
  raw: unknown,
  readError: string | null,
): { timezone: string | null; timezoneReason: string | null } {
  if (readError !== null) return { timezone: null, timezoneReason: `the house's time zone could not be read (${readError})` };
  if (typeof raw !== "string" || raw.trim() === "") return { timezone: null, timezoneReason: "the house has no time zone set" };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw.trim() });
  } catch {
    return { timezone: null, timezoneReason: `the house's time zone "${raw}" is not one this page knows` };
  }
  return { timezone: raw.trim(), timezoneReason: null };
}

/** An active menu row as getMenu reads it. */
export interface CurrentMenuRow {
  id: string;
  name: string | null;
  status: string | null;
  made_current_at?: string | null;
  created_at?: string | null;
}

/**
 * Active menus, the one a person made current last first: by made_current_at
 * (a menu never chosen, from before ADR 0193, has none and comes after every
 * chosen one), then created_at, then id, so the same rows always give the same
 * order (r28 G20).
 */
export function newestCurrentFirst(rows: CurrentMenuRow[]): CurrentMenuRow[] {
  const t = (v: string | null | undefined): number => {
    const n = v ? Date.parse(v) : NaN;
    return Number.isFinite(n) ? n : -Infinity;
  };
  return [...rows].sort(
    (a, b) =>
      t(b.made_current_at) - t(a.made_current_at) ||
      t(b.created_at) - t(a.created_at) ||
      String(a.id).localeCompare(String(b.id)),
  );
}

function emptyPlanCounts(): Record<PlanResult, number> {
  return {
    change: 0,
    kept_newer: 0,
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

/**
 * Only a finished read has a plan or can be made current (the table says the
 * same: restaurant_menus_only_a_finished_read_is_current). 409, nothing changed.
 */
function assertReadFinished(row: Record<string, unknown>): void {
  const state = (row.read_state as string | undefined) ?? "done";
  if (state === "reading") {
    throw new ConflictException("This menu is still being read. Its plan can be shown once the read is done; nothing was changed.");
  }
  if (state === "failed") {
    const why = typeof row.read_failure === "string" ? ` ${row.read_failure}` : "";
    throw new ConflictException(`This read failed, so it has no lines to make current.${why}`);
  }
}

/** When a kept menu was read: `extracted_at`, or, for a menu read before menus were kept, when its row was made. */
function readMomentOf(row: Record<string, unknown>): string | null {
  const at = row.extracted_at ?? row.created_at ?? null;
  return typeof at === "string" && at !== "" ? at : null;
}

/**
 * THE MOMENT A CARRY OF THIS MENU IS DATED BY (r31 walk w1, F2). A menu that
 * is current was chosen at `made_current_at`, and carrying it again writes
 * every price dated by that moment, so the writer keeps any price that took
 * effect after it ("stale", L14). A menu not yet current is chosen now, and
 * nothing in effect is newer than now: null. The plan and the carry read this
 * one moment, so "Check its prices" never promises a price the carry keeps.
 */
export function carryMomentOf(row: Record<string, unknown>): string | null {
  if (row.status !== "active") return null;
  const at = row.made_current_at;
  return typeof at === "string" && at !== "" ? at : null;
}

/** A price in effect that took effect after the carry's moment stands (the writer's `stale`). */
export function keptFromTheCarry(set: { at: string | null } | null, carryAt: string | null): boolean {
  if (!set?.at || !carryAt) return false;
  const a = Date.parse(set.at);
  const c = Date.parse(carryAt);
  return Number.isFinite(a) && Number.isFinite(c) && a > c;
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
  /**
   * Where a read stands (founder 2026-11-07, "Background job"): reading,
   * done, or failed with `readFailure` saying why. Every menu read before
   * reads were backgrounded is done.
   */
  readState: MenuReadState;
  readFailure: string | null;
  extractedAt: string | null;
  extractedBy: { userId: string; name: string | null } | null;
  madeCurrentAt: string | null;
  madeCurrentBy: { userId: string; name: string | null } | null;
  retiredAt: string | null;
  retiredBy: { userId: string; name: string | null } | null;
  createdAt: string | null;
}

export type MenuReadState = "reading" | "done" | "failed";

/** What a background scan that found no line ends with (kept as its failure). */
const EMPTY_SCAN_FAILED =
  "No line could be read from this file. The file is kept with this read; nothing else changed. Try a clearer photo or the PDF itself.";

/** What a read the server stopped hearing from ends with (the lazy sweep). */
const STOPPED_READ_FAILED =
  "The read stopped before it finished (the server restarted, or the read ran past half an hour). The file is kept; send it again.";

/** A read still `reading` after this long is no longer being read by anyone. */
const READ_STALE_MS = 30 * 60 * 1000;

/** What `POST /menus/import` says when a read finds no line (422, nothing kept). */
const EMPTY_READ_REFUSAL: Record<string, string> = {
  scan: "No line could be read from this file, so no menu was kept. Try a clearer photo or the PDF itself.",
  csv: "No line could be read from this file, so no menu was kept. Check that each row names a wine.",
  manual: "No line was given, so no menu was kept.",
};

/** The labels a read is kept with; a reopened read must fit them (`sameFileRead`). */
interface ReadLabels {
  cadence: MenuCadence | null;
  menuDate: { date: string; precision: "day" | "month" } | null;
}

/**
 * The insert of a `reading` version met another read of the same file and
 * labels still under way (uq_restaurant_menus_one_read_of_a_file_at_a_time).
 */
class SameFileReading extends Error {
  constructor() {
    super("the same file is already being read for this house");
    this.name = "SameFileReading";
  }
}

/** What `POST /menus/import` answers, and what a finished background read keeps (`read_reply`). */
export interface MenuImportReply {
  menuId: string;
  /** Always false for a new read; a reopened read says whether it is current now. */
  current: boolean;
  /** A scan still being read: poll `GET /menu-versions/:menuId/read`. */
  reading?: true;
  /** The same bytes were read before: this is that read, not a new one. */
  reopened?: { readAt: string | null };
  /** How many photos the upload joined into this one menu. */
  pages?: number;
  itemsExtracted: number;
  submissionsCreated: number;
  items: MenuImportReviewItem[];
  source: { kept: boolean; failure: string | null };
  warnings: MenuReadWarning[];
  /**
   * Rows a CSV or spreadsheet read could not take whole, and why (a price
   * left blank, a line with no name; csv-parser.service.ts). A scan says
   * what it could not read in `warnings` instead.
   */
  notes?: CsvRowIssue[];
}

/** The sentence a failed background read is kept with. A refusal keeps its own words. */
function failureWords(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse() as unknown;
    const msg =
      typeof body === "string"
        ? body
        : Array.isArray((body as { message?: unknown })?.message)
          ? ((body as { message: string[] }).message).join(" ")
          : (body as { message?: unknown })?.message;
    if (typeof msg === "string" && msg.trim() !== "") return msg.trim();
  }
  const m = (err as Error)?.message;
  return `The read stopped with an error, and nothing from it was kept but the file: ${m && m.trim() !== "" ? m.trim() : "no reason was given"}.`;
}

/**
 * Why a menu's file was not kept, in the house's words. The storage error
 * itself ("name resolution failed", a bucket name) goes to the log: it is the
 * operator's to fix, and the house can do nothing with it.
 */
export const SOURCE_NOT_TAKEN = "the file store did not take it";

const VERSION_SELECT =
  "id, name, status, cadence, menu_date, menu_date_precision, source_method, source_path, source_mime, source_bytes, source_failure, lines_extracted, read_warnings, read_state, read_failure, extracted_at, extracted_by, made_current_at, made_current_by, retired_at, retired_by, created_at";

/**
 * The columns every line read asks for. `raw_extracted_text` is read so
 * `lineForViewer` (menu-line-view.ts) can say `kitchen_line`; it leaves this
 * read only when the caller's view allows it (`MenuVersionsController.one`,
 * for a role that sees money and suppliers). A CSV line is the whole row
 * (csv-parser.service.ts, `raw_text`), cost and supplier cells included, and no header
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

/**
 * The price a line added on /menu names (r28 G7): the number a caller sent, or
 * the text the person typed, read by parseMenuPrice. The web's Add form used
 * number boxes read with Number(): in a lira house "45,50" emptied the box in
 * Chrome (the line went in unpriced) and "1.250" became 1.25. A text that is
 * not a price is refused with the reason, and nothing is added.
 */
export function addedPrice(
  sent: number | null | undefined,
  typed: string | null | undefined,
  label: "glass" | "bottle",
): number | undefined {
  const text = typeof typed === "string" ? typed.trim() : "";
  if (text === "") return sent ?? undefined;
  if (sent !== undefined && sent !== null) {
    throw new BadRequestException(`The ${label} price was sent twice, as a number and as typed text. Nothing was added.`);
  }
  const read = parseMenuPrice(text);
  if ("refused" in read) {
    throw new BadRequestException(`The ${label} price ${read.refused.replace("Nothing was changed.", "Nothing was added.")}`);
  }
  return read.value;
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

/**
 * The kind and unit of a good a menu line adds to the house (r28 G2), from the
 * line's section the way the matcher reads it (`lineFamily`). A section that
 * names no known drink says nothing here, and the insert trigger's wine and
 * bottle stand: a library wine line with no section is most often a wine.
 *
 * A cocktail is counted in servings ('each'), not bottles: it is mixed, not
 * stocked. Linking it to its recipe is not done here (left in the PR).
 */
export function newGoodIdentity(category: string | null | undefined): { kind?: string; uom?: string } {
  const family = lineFamily(category);
  const words = ` ${String(category ?? "").toLowerCase().replace(/[^a-z]+/g, " ")} `;
  switch (family) {
    case "beer":
    case "cider":
    case "sake":
      return { kind: family, uom: "bottle" };
    case "cocktail":
      return { kind: "cocktail", uom: "each" };
    case "spirit":
      if (/ (whiskey|whisky|whiskies) /.test(words)) return { kind: "whiskey", uom: "bottle" };
      if (/ (liqueur|liqueurs) /.test(words)) return { kind: "liqueur", uom: "bottle" };
      return { kind: "spirit", uom: "bottle" };
    case "soft":
      if (/ (non alcoholic|alcohol free) /.test(words)) return { kind: "non_alcoholic", uom: "bottle" };
      return { kind: "soft_drink", uom: "bottle" };
    case "wine":
      return { kind: "wine", uom: "bottle" };
    default:
      return {};
  }
}

/** What one line will write, and the flag it carries, decided BEFORE the write. */
interface CarryPlan {
  bottle: number | null;
  glass: number | null;
  flag: PriceFlag | null;
  flagNote: string | null;
}

/**
 * One linked menu line's prices onto the house's own (see carryMenuPrice for
 * the founder's rules): the prices it names, and its flag against the house's
 * price just before this line is written.
 */
function carryPlanOf(
  item: InsertedMenuItem,
  house: { bottle: number | string | null; glass: number | string | null },
  // The good's kind, for the sentence: a gin is not "this wine" (r21, D4).
  kind: string | null = null,
): CarryPlan {
  // The menu printed this line's price only in another money (r36 N1): no
  // price is carried, and the line keeps the sentence its read gave it.
  if (item.price_flag === "other_currency" && item.price_flag_note) {
    return { bottle: null, glass: null, flag: "other_currency", flagNote: item.price_flag_note };
  }
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
  return { bottle, glass, flag, flagNote };
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
  /**
   * Set when two or more of the house's goods fit this line by name, kind,
   * vintage and size: none was guessed, and the line went to the library.
   */
  houseCandidates?: HouseCandidate[];
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
  ): Promise<MenuImportReply> {
    const { restaurantId } = dto;
    // Checked before the billed read: a date that is not on the calendar
    // refuses the upload rather than failing after it was paid for.
    const menuDate = parseMenuDate(dto.menuDate);

    // A scan (billed, slow) reads in the background; a sheet or typed lines at once.
    if (dto.method === "scan") return this.beginScan(dto, userId, menuDate);

    // 1. Parse input → WineExtractItem[].
    let items: WineExtractItem[];
    const warnings: MenuReadWarning[] = [];
    let notes: CsvRowIssue[] = [];
    let sourceBytes: Buffer | null = null;
    let sourceMime: { mime: string; ext: string } | null = null;
    if (dto.method === "csv") {
      if (dto.data.fileBase64) {
        ({ items, issues: notes } = await this.csvParser.readExcel(
          dto.data.fileBase64,
        ));
        sourceBytes = Buffer.from(dto.data.fileBase64, "base64");
        sourceMime = sniffMime(sourceBytes);
      } else {
        ({ items, issues: notes } = this.csvParser.read(dto.data.csvContent!));
        sourceBytes = Buffer.from(dto.data.csvContent!, "utf8");
        sourceMime = { mime: "text/csv", ext: "csv" };
      }
    } else {
      items = dto.data.items ?? [];
    }

    // 1b. A read with no line is refused BEFORE anything is written: no source
    // upload, no draft version, no onboarding mark (QA B-5; ADR 0067, a failed
    // read is never an empty one).
    if (items.length === 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: "Unprocessable Entity",
        message: EMPTY_READ_REFUSAL[dto.method] ?? EMPTY_READ_REFUSAL.scan,
        warnings,
      });
    }

    // 2. Resolve against the wine library BEFORE anything is written: a
    // failed resolution throws here, with no version row and no source upload,
    // and says nothing was kept (r31 w1 F1, #1486).
    const resolved = await this.resolveOrKeepNothing(items, restaurantId);

    // 3. Keep the source, or say why it was not kept.
    const kept =
      sourceBytes && sourceMime
        ? await this.keepSource(restaurantId, sourceBytes, sourceMime)
        : null;

    // 4. A new version, in draft: kept whether or not it is ever made current.
    const menu = await this.createVersion(
      restaurantId,
      userId,
      dto,
      items,
      warnings,
      kept,
      menuDate,
    );

    // 5-6: insert menu_items and create the governance submission trail. NOT
    // current, so no inventory or price. A failed line write removes the
    // version it was writing into (`persistIntoNewVersion`).
    const reviewItems = await this.persistIntoNewVersion(
      resolved,
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
      notes,
    };
  }

  /** Background reads this process is running, by menu id (the sweep spares them). */
  private readonly reading = new Map<string, Promise<void>>();

  /** Resolves when this process's read of `menuId` has ended (tests, shutdown). */
  async whenRead(menuId: string): Promise<void> {
    await this.reading.get(menuId);
  }

  /**
   * Start a scan read and answer at once (founder 2026-11-07: "Background
   * job"; audit M12: a read past the web's 30 s "failed" while the server went
   * on). The file and the draft are kept BEFORE the read, so a read that fails
   * or is cut off still names its file and says why (ADR 0213 #17).
   *
   * Several photos sent together are one menu and one version (founder
   * 2026-11-07, "One upload = one version"), joined into one PDF, one photo
   * per page. The same bytes sent again reopen the read they made unless the
   * person asks to read them again (`readAgain`): a resend is not billed
   * twice. Two requests with the same bytes sent together (a double tap, a
   * retry, two phones) make one read: the database keeps one `reading` row
   * per house, file and labels (uq_restaurant_menus_one_read_of_a_file_at_a_time),
   * and the request that loses the insert joins the read already under way.
   */
  private async beginScan(
    dto: ImportMenuDto,
    userId: string,
    menuDate: { date: string; precision: "day" | "month" } | null,
  ): Promise<MenuImportReply> {
    const { restaurantId } = dto;
    const pages = Array.isArray(dto.data?.images)
      ? dto.data.images
      : typeof dto.data?.imageBase64 === "string"
        ? [dto.data.imageBase64]
        : null;
    if (!pages) {
      throw new BadRequestException(
        "A scan sends the photo or PDF it reads (data.imageBase64, or data.images for several pages). Nothing was kept.",
      );
    }
    const file = await pagesToOneFile(pages);
    const bytes = Buffer.from(file, "base64");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

    const labels: ReadLabels = { cadence: dto.cadence ?? null, menuDate };
    if (dto.readAgain !== true) {
      const earlier = await this.sameFileRead(restaurantId, sha256, labels);
      if (earlier) return earlier;
    }

    const kept = await this.keepSource(restaurantId, bytes, sniffMime(bytes));
    let menu: { id: string };
    try {
      menu = await this.createVersion(restaurantId, userId, dto, [], [], kept, menuDate, "reading");
    } catch (err) {
      if (!(err instanceof SameFileReading)) throw err;
      // Another request with these bytes and labels began its read first:
      // this one joins it (readAgain too: reading the file twice at once
      // would only pay twice for one answer). The source path is the file's
      // own hash, so the upload above wrote the same object, not a second.
      const joined = await this.sameFileRead(restaurantId, sha256, labels, { readingOnly: true });
      if (joined) return joined;
      // The read in the way is one nobody is reading any more: end it, then begin.
      await this.sweepStaleReads(restaurantId);
      try {
        menu = await this.createVersion(restaurantId, userId, dto, [], [], kept, menuDate, "reading");
      } catch (again) {
        if (!(again instanceof SameFileReading)) throw again;
        throw new ConflictException(
          "This file is already being read for this house. Wait for that read, then look on the Menu page. Nothing new was kept.",
        );
      }
    }
    // Detached; must never reject (an unhandled rejection ends the process).
    const run = this.finishScan(menu.id, restaurantId, file, dto, userId, kept)
      .catch((err) => this.logger.error(`Menu read ${menu.id} could not record how it ended: ${(err as Error)?.message ?? err}`))
      .finally(() => this.reading.delete(menu.id));
    this.reading.set(menu.id, run);

    return {
      menuId: menu.id,
      current: false,
      reading: true,
      pages: pages.length,
      itemsExtracted: 0,
      submissionsCreated: 0,
      items: [],
      source: { kept: !!kept?.path, failure: kept?.failure ?? null },
      warnings: [],
    };
  }

  /**
   * The read these exact bytes already made for this house, if it is still
   * worth reopening (founder 2026-11-07, "One upload = one version"; a resend
   * is not billed twice). Reopened, it is said as it is NOW, never as it was
   * frozen when the read finished (batch review of #1062):
   *
   * - only a read whose labels fit: a cadence or menu date the new upload
   *   names must be the version's own. The same file for another day is its
   *   own version, read again; an upload that names no label takes the
   *   version's.
   * - only a draft or the current menu. A retired menu sent again is read
   *   as a new version, so its choice is made afresh and never rolls the
   *   house back to an old menu under an "already read" banner.
   * - its lines are the live ones (`reopenedReply`): a discarded line is not
   *   offered again, a corrected name or price is the corrected one.
   *
   * `readingOnly` looks only for a read under way (the losing side of two
   * imports of the same file at once).
   */
  private async sameFileRead(
    restaurantId: string,
    sha256: string,
    labels: ReadLabels,
    opts: { readingOnly?: boolean } = {},
  ): Promise<MenuImportReply | null> {
    const { data, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id, status, read_state, read_reply, extracted_at, source_path, source_failure, cadence, menu_date, menu_date_precision")
      .eq("restaurant_id", restaurantId)
      .eq("source_sha256", sha256)
      .eq("source_method", "scan");
    if (error) {
      // Not knowing costs one more read, never a lost one.
      this.logger.warn(`Could not look for an earlier read of the same file: ${error.message}`);
      return null;
    }
    const fits = (row: Record<string, any>) =>
      (labels.cadence === null || (row.cadence ?? null) === labels.cadence) &&
      (labels.menuDate === null ||
        ((row.menu_date ?? null) === labels.menuDate.date && (row.menu_date_precision ?? null) === labels.menuDate.precision));
    const rows = ((data ?? []) as Array<Record<string, any>>)
      .filter(fits)
      .sort((a, b) => String(b.extracted_at ?? "").localeCompare(String(a.extracted_at ?? "")));
    const cutoff = Date.now() - READ_STALE_MS;
    for (const row of rows) {
      const state = (row.read_state as MenuReadState | undefined) ?? "done";
      if (state === "reading" && (this.reading.has(row.id) || Date.parse(row.extracted_at) >= cutoff)) {
        return {
          menuId: row.id,
          current: false,
          reading: true,
          itemsExtracted: 0,
          submissionsCreated: 0,
          items: [],
          source: { kept: !!row.source_path, failure: row.source_failure ?? null },
          warnings: [],
        };
      }
      if (opts.readingOnly) continue;
      if (
        state === "done" &&
        (row.status === "draft" || row.status === "active") &&
        row.read_reply &&
        typeof row.read_reply === "object"
      ) {
        const reopened = await this.reopenedReply(row, restaurantId);
        if (reopened) return reopened;
      }
    }
    return null;
  }

  /**
   * A finished read as it stands now: the reply it was kept with, its lines
   * replaced by the version's live ones. A line discarded since is gone; a
   * corrected field is the corrected value; a line added since is there. What
   * the read did when it ran (its price-sync outcome, its match) stays as the
   * read said it. A line read that fails gives null: the caller reads the
   * file again rather than show lines it could not check.
   */
  private async reopenedReply(row: Record<string, any>, restaurantId: string): Promise<MenuImportReply | null> {
    const reply = row.read_reply as MenuImportReply;
    const live: Array<Record<string, any>> = [];
    let after: string | null = null;
    for (;;) {
      let q = this.dbService.supabase
        .from("menu_items")
        .select(`${LINE_SELECT}, submission_id`)
        .eq("menu_id", row.id)
        .eq("restaurant_id", restaurantId)
        .neq("status", "discarded");
      if (after) q = q.gt("id", after);
      const { data, error } = await q.order("id", { ascending: true }).limit(PAGE_ROWS);
      if (error) {
        this.logger.warn(`Could not read the lines of earlier read ${row.id}; reading the file again: ${error.message}`);
        return null;
      }
      const page = (data ?? []) as Array<Record<string, any>>;
      live.push(...page);
      if (page.length < PAGE_ROWS) break;
      after = String(page[page.length - 1].id);
    }
    const asRead = new Map((Array.isArray(reply.items) ? reply.items : []).map((i) => [i.menuItemId, i]));
    const money = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
    const items: MenuImportReviewItem[] = live.map((line) => {
      const was = asRead.get(line.id);
      return {
        ...(was ?? {
          submissionId: line.submission_id ?? null,
          matched: !!line.wine_library_id,
          needsReview: false,
          rawText: line.raw_extracted_text ?? null,
        }),
        menuItemId: line.id,
        inventoryItemId: line.inventory_item_id ?? null,
        name: line.name,
        producer: line.producer ?? null,
        category: line.category ?? null,
        vintage: line.vintage ?? null,
        region: line.region ?? null,
        grapeVariety: line.grape_variety ?? null,
        byGlassPrice: money(line.by_glass_price),
        bottlePrice: money(line.bottle_price),
        priceFlag: line.price_flag ?? null,
        priceFlagNote: line.price_flag_note ?? null,
      };
    });
    return {
      ...reply,
      items,
      current: row.status === "active",
      reopened: { readAt: row.extracted_at ?? null },
    };
  }

  /** The background half of a scan. Never rejects: every ending is written on the version. */
  private async finishScan(
    menuId: string,
    restaurantId: string,
    file: string,
    dto: ImportMenuDto,
    userId: string,
    kept: { path: string | null; failure: string | null } | null,
  ): Promise<void> {
    const sb = this.dbService.supabase;
    try {
      const { items, warnings } = await this.scanParser.parseWithWarnings(file, restaurantId);
      if (items.length === 0) {
        await this.endRead(menuId, { read_state: "failed", read_failure: EMPTY_SCAN_FAILED, read_warnings: warnings });
        return;
      }
      const { error: linesError } = await sb
        .from("restaurant_menus")
        .update({ extraction: items, read_warnings: warnings, lines_extracted: items.length })
        .eq("id", menuId)
        .eq("restaurant_id", restaurantId);
      if (linesError) throw new Error(`the lines read could not be kept: ${linesError.message}`);
      const reviewItems = await this.resolveAndPersistItems(items, restaurantId, menuId, userId, dto.method, false);
      await this.markMenuUploaded(restaurantId);
      const reply: MenuImportReply = {
        menuId,
        current: false,
        itemsExtracted: items.length,
        submissionsCreated: reviewItems.filter((r) => r.submissionId).length,
        items: reviewItems,
        source: { kept: !!kept?.path, failure: kept?.failure ?? null },
        warnings,
      };
      const ended = await this.endRead(menuId, { read_state: "done", read_reply: reply });
      // The sweep already said this read stopped (it ran past half an hour, or
      // another server took it for dead): it stays failed, so it keeps no line.
      if (ended === "not_reading") await this.dropUnfinishedRead(menuId, restaurantId);
    } catch (err) {
      this.logger.error(`Menu read ${menuId} failed: ${(err as Error)?.message ?? err}`);
      // A failed read keeps no half of what it wrote: its lines and the library
      // submissions made for them go (dropUnfinishedRead); the version says why.
      await this.dropUnfinishedRead(menuId, restaurantId);
      await this.endRead(menuId, {
        read_state: "failed",
        read_failure: failureWords(err),
        lines_extracted: 0,
        extraction: [],
      });
    }
  }

  /**
   * Ends a read that is still `reading`. A read the sweep has already ended
   * is left as the sweep said (`not_reading`), never turned back into done.
   */
  private async endRead(
    menuId: string,
    patch: Record<string, unknown>,
  ): Promise<"ended" | "not_reading" | "unknown"> {
    const { data, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .update(patch)
      .eq("id", menuId)
      .eq("read_state", "reading")
      .select("id");
    if (error) {
      this.logger.error(`Menu read ${menuId} ended but could not say so: ${error.message}`);
      return "unknown";
    }
    return Array.isArray(data) && data.length > 0 ? "ended" : "not_reading";
  }

  /**
   * What a read that did not finish wrote for its version goes: its lines, and
   * the library submissions made for them. A submission names no menu, so it
   * is found through the line that points at it, before the lines go. Library
   * rows the resolver added stay: they are the shared library's, matched by
   * signature and reused by the next read of the same wine (the synchronous
   * path left them too; PR #773's register entry). A submission whose line was
   * never pointed at it (the process died between the two writes) is not
   * found here either; the transaction that would close both is still owed.
   */
  private async dropUnfinishedRead(menuId: string, restaurantId: string): Promise<void> {
    const sb = this.dbService.supabase;
    const { data: lines, error: readError } = await sb
      .from("menu_items")
      .select("id, submission_id")
      .eq("menu_id", menuId)
      .eq("restaurant_id", restaurantId);
    if (readError) this.logger.error(`Lines of unfinished read ${menuId} could not be read: ${readError.message}`);
    const submissionIds = ((lines ?? []) as Array<{ submission_id?: string | null }>)
      .map((l) => l.submission_id)
      .filter((id): id is string => typeof id === "string" && id !== "");
    const { error: dropError } = await sb.from("menu_items").delete().eq("menu_id", menuId).eq("restaurant_id", restaurantId);
    if (dropError) {
      // The lines still point at their submissions; removing those now would
      // only null the pointers (ON DELETE SET NULL) and hide what is left.
      this.logger.error(`Lines of unfinished read ${menuId} were not removed: ${dropError.message}`);
      return;
    }
    if (submissionIds.length === 0) return;
    const { error: subError } = await sb
      .from("master_wine_library_submissions")
      .delete()
      .eq("restaurant_id", restaurantId)
      .in("id", submissionIds);
    if (subError) this.logger.error(`Submissions of unfinished read ${menuId} were not removed: ${subError.message}`);
  }

  /** A read nobody is reading any more (a restart) is said to have failed, lazily, when someone looks. */
  private async sweepStaleReads(restaurantId: string): Promise<void> {
    const sb = this.dbService.supabase;
    const { data, error } = await sb
      .from("restaurant_menus")
      .select("id, extracted_at")
      .eq("restaurant_id", restaurantId)
      .eq("read_state", "reading");
    if (error) return void this.logger.warn(`Could not look for stopped menu reads: ${error.message}`);
    const cutoff = Date.now() - READ_STALE_MS;
    const stale = ((data ?? []) as Array<{ id: string; extracted_at: string | null }>)
      .filter((r) => !this.reading.has(r.id) && !(Date.parse(String(r.extracted_at)) >= cutoff))
      .map((r) => r.id);
    if (stale.length === 0) return;
    const { data: ended, error: upd } = await sb
      .from("restaurant_menus")
      .update({ read_state: "failed", read_failure: STOPPED_READ_FAILED, lines_extracted: 0, extraction: [] })
      .eq("restaurant_id", restaurantId)
      .eq("read_state", "reading")
      .in("id", stale)
      .select("id");
    if (upd) return void this.logger.warn(`Could not end stopped menu reads: ${upd.message}`);
    // A stopped read keeps no half of what it wrote, as a failed one does.
    for (const row of (ended ?? []) as Array<{ id: string }>) await this.dropUnfinishedRead(row.id, restaurantId);
  }

  /** Where one read stands, and what it found once it is done (`GET /menu-versions/:id/read`). */
  async readStatus(
    restaurantId: string,
    menuId: string,
  ): Promise<{
    menuId: string;
    state: MenuReadState;
    failure: string | null;
    warnings: MenuReadWarning[];
    reply: MenuImportReply | null;
  }> {
    await this.sweepStaleReads(restaurantId);
    const { data, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id, read_state, read_failure, read_warnings, read_reply")
      .eq("id", menuId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(`The menu read could not be looked up: ${error.message}`);
    if (!data) throw new NotFoundException("No menu of this restaurant by that id.");
    const row = data as Record<string, any>;
    return {
      menuId,
      state: (row.read_state as MenuReadState | undefined) ?? "done",
      failure: row.read_failure ?? null,
      warnings: Array.isArray(row.read_warnings) ? row.read_warnings.filter((w: unknown) => w && typeof w === "object") : [],
      reply: row.read_reply && typeof row.read_reply === "object" ? (row.read_reply as MenuImportReply) : null,
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
    // Same order as `importMenu`: the library first, then the version.
    const resolved = await this.resolveOrKeepNothing(items, restaurantId);
    const menu = await this.createVersion(
      restaurantId,
      userId,
      dto,
      items,
      [], // arrival refuses a partial read
      null,
      null,
    );
    const reviewItems = await this.persistIntoNewVersion(
      resolved,
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
        this.logger.error(`Menu source ${path} was not kept: ${error.message}`);
        return { path: null, sha256, mime: type.mime, bytes: bytes.length, failure: SOURCE_NOT_TAKEN };
      }
      return { path, sha256, mime: type.mime, bytes: bytes.length, failure: null };
    } catch (err: any) {
      this.logger.error(`Menu source ${path} was not kept: ${err?.message ?? "unknown error"}`);
      return {
        path: null,
        sha256,
        mime: type.mime,
        bytes: bytes.length,
        failure: SOURCE_NOT_TAKEN,
      };
    }
  }

  /**
   * A FAILED IMPORT KEEPS NO MENU (r31 walk w1, F1). The version row is written
   * before its lines are resolved, so a library failure ("URI too long" at 120
   * new wines) used to leave a kept menu of 126, 206 or 430 lines with no line
   * behind it, listed under Menus kept and offered to be made current. The
   * draft this import made is taken back (its lines go with it, ON DELETE
   * CASCADE), and the refusal says nothing was kept. Only a draft is ever
   * taken back, and only this import's own. A take-back that itself fails is
   * said: the menu is then kept unread and can be discarded by hand.
   */
  /**
   * The library first, before anything is written (#773): a failed resolution
   * keeps no version, and the refusal says so in the words #1486 gave a failed
   * import (r37 meet of the two).
   */
  private async resolveOrKeepNothing(items: WineExtractItem[], restaurantId: string): Promise<ResolvedItem[]> {
    try {
      return await this.resolveLibrary(items, restaurantId);
    } catch (err: any) {
      throw new InternalServerErrorException(`${err?.message ?? String(err)}. Nothing was kept; import the menu again.`);
    }
  }

  private async persistOrDropVersion<T>(
    restaurantId: string,
    menuId: string,
    persist: () => Promise<T>,
  ): Promise<T> {
    try {
      return await persist();
    } catch (err: any) {
      const why = err?.message ?? String(err);
      const { error } = await this.dbService.supabase
        .from("restaurant_menus")
        .delete()
        .eq("id", menuId)
        .eq("restaurant_id", restaurantId)
        .eq("status", "draft");
      if (error) {
        this.logger.error(`Menu import: the failed draft ${menuId} could not be taken back: ${error.message}`);
        throw new InternalServerErrorException(
          `${why}. The menu was kept, but with none of its lines: discard it under Menus kept, then import it again.`,
        );
      }
      throw new InternalServerErrorException(`${why}. Nothing was kept; import the menu again.`);
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
    readState: MenuReadState = "done",
  ): Promise<{ id: string }> {
    const { data, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .insert({
        read_state: readState,
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
    if (error && (error as { code?: string }).code === "23505" && readState === "reading") {
      // uq_restaurant_menus_one_read_of_a_file_at_a_time: the same file is already being read.
      throw new SameFileReading();
    }
    if (error || !data) {
      throw new InternalServerErrorException(
        `The menu was read but could not be kept, so nothing was saved: ${error?.message ?? "no row returned"}`,
      );
    }
    return data as { id: string };
  }

  /**
   * Writes the lines of a version this request just created. If that write
   * throws, the version row is deleted (its `menu_items` go with it, ON DELETE
   * CASCADE) and the error is rethrown, so a failed line write leaves no
   * empty draft. The source file is not deleted: it is content-addressed
   * (`<house>/menus/<sha256>.<ext>`), so another version may name the same
   * object. If the delete itself fails, the error says the draft remains.
   */
  private async persistIntoNewVersion(
    resolved: ResolvedItem[],
    restaurantId: string,
    menuId: string,
    userId: string,
    method: "scan" | "csv" | "manual",
    current: boolean,
  ): Promise<MenuImportReviewItem[]> {
    // r37 meet: one take-back, #1486's (only this import's own draft, and the
    // refusal in the house's words).
    return this.persistOrDropVersion(restaurantId, menuId, () =>
      this.persistItems(resolved, restaurantId, menuId, userId, method, current),
    );
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
    // Whether the caller is an owner or a manager (resolved by the
    // controller). Matters only when the menu is the CURRENT one: a line
    // added there joins the house's own goods at once, priced or not (r35
    // G14), and a priced one sets the house's own price (founder,
    // 2026-09-21, answer 1). A kept menu that is not current is the review
    // step, open to any member (ADR 0358 D2: any member may read a menu in).
    callerMayPrice = false,
  ): Promise<MenuImportReviewItem> {
    if (!callerRestaurantId) {
      throw new ForbiddenException(
        "This session is not attached to a restaurant, so no line can be added to a menu.",
      );
    }
    // A typed price is read before anything is read or written: a price
    // that is not one refuses the whole line (r28 G7).
    const byGlassPrice = addedPrice(dto.by_glass_price, dto.by_glass_typed, "glass");
    const bottlePrice = addedPrice(dto.bottle_price, dto.bottle_typed, "bottle");
    // A typed price whose mark names another money is not the house's (r36 N1).
    for (const typed of [dto.by_glass_typed, dto.bottle_typed]) {
      await this.refuseOtherMoney(typed, callerRestaurantId, "Nothing was added.");
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
    const namesPrice = byGlassPrice !== undefined || bottlePrice !== undefined;
    if (isCurrent && namesPrice && !callerMayPrice) {
      throw new ForbiddenException(
        "Only managers and owners can put a price on the current menu: it sets the house's own price. Nothing was added.",
      );
    }
    // r35 G14: an unpriced line on the current menu still adds a good to the
    // house's own list (and a library row), and only an owner or a manager
    // can discard it again (ADR 0358 D2). Adding is gated the same way.
    if (isCurrent && !callerMayPrice) {
      throw new ForbiddenException(
        "Only managers and owners can add a line to the current menu: it adds a good to the house's own list. Nothing was added.",
      );
    }

    const item: WineExtractItem = {
      name: dto.name,
      producer: dto.producer,
      category: dto.category,
      vintage: dto.vintage,
      region: dto.region,
      grape_variety: dto.grape_variety,
      by_glass_price: byGlassPrice,
      bottle_price: bottlePrice,
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
    /**
     * r35 G14: the caller is an owner or a manager (resolved by the
     * controller). Anyone else may correct a line of a kept menu that is not
     * current (the review step), never a line of the current menu, and never
     * renames the house's own good.
     */
    callerMayManage = false,
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

    // r35 G14: a correction to the current menu changes what the house sells
    // (a name renames its good; a section can turn a drink into a kitchen
    // line), so it is an owner's or a manager's, checked before any write.
    if (!callerMayManage) {
      const { data: ownMenu, error: ownMenuErr } = await this.dbService.supabase
        .from("restaurant_menus")
        .select("status")
        .eq("id", menuItem.menu_id)
        .eq("restaurant_id", callerRestaurantId)
        .maybeSingle();
      if (ownMenuErr) {
        throw new InternalServerErrorException(
          `Whether this line is on the current menu could not be read, so nothing was changed: ${ownMenuErr.message}`,
        );
      }
      if ((ownMenu as { status?: string } | null)?.status === "active") {
        throw new ForbiddenException(
          "Only managers and owners can correct a line of the current menu: it changes what the house sells. Nothing was changed.",
        );
      }
    }

    const oldValue = (menuItem as Record<string, unknown>)[dto.fieldName];
    const isPrice = PRICE_FIELDS.has(dto.fieldName);
    let newValueTyped: string | number = dto.newValue;
    if (isPrice) {
      const price = parseMenuPrice(dto.newValue);
      if ("refused" in price) throw new BadRequestException(price.refused);
      await this.refuseOtherMoney(dto.newValue, callerRestaurantId, "Nothing was changed.");
      newValueTyped = price.value;
    }
    // r33 meet with #1418: a typed price is read by parseMenuPrice (the one
    // reader /menu's add and correct share; it refuses a minus, letters and a
    // two-way `1.250` in words). readMenuPrice stays the spreadsheet cell
    // reader inside csv-parser.service.ts.

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

    // Keep the restaurant's own inventory display name in sync -- an owner's
    // or a manager's correction only (r35 G14): anyone else corrects the line.
    if (dto.fieldName === "name" && menuItem.inventory_item_id && callerMayManage) {
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
   *
   * SEVERAL CURRENT MENUS (r28 G20). Production can hold more than one active
   * menu for a house (no unique index; see readCurrentMenus), and this read
   * used `.maybeSingle()`, which PostgREST answers with an error for two rows,
   * so the whole /menu page failed for that house. It now reads them all and
   * shows the one made current last (then the one read last); `otherCurrent`
   * says how many more are marked current, so the page can say so. Choosing a
   * menu (make_menu_current) archives every other one, which settles it.
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
    otherCurrent?: number;
    housePricesUnreadable?: string;
  }> {
    const { data: actives, error: menuErr } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id, name, status, made_current_at, created_at")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active");

    if (menuErr) throw new Error(`Failed to load menu: ${menuErr.message}`);
    const withheld = view.rawLine ? {} : { rawLineWithheld: true as const };
    const ordered = newestCurrentFirst((actives ?? []) as CurrentMenuRow[]);
    const menu = ordered[0] ?? null;
    if (!menu) return { menuId: null, name: null, status: null, items: [], ...withheld };
    if (ordered.length > 1) {
      this.logger.warn(
        `Restaurant ${restaurantId} has ${ordered.length} active menus; /menu shows ${menu.id}, made current last`,
      );
    }

    // A discarded line (migration 20260922230100, ADR 0160 sec110 item 7) is
    // a soft remove: the row stays for the record, but this read path must
    // not keep serving it as live. Read in pages: PostgREST stops at 1000
    // rows without saying so, and a long wine list is exactly that long.
    const items = await this.readLines(menu.id, restaurantId, view);
    const house = await this.housePricesOf(restaurantId, items);

    return {
      menuId: menu.id,
      name: menu.name,
      status: menu.status,
      items: house.items,
      ...withheld,
      ...(ordered.length > 1 ? { otherCurrent: ordered.length - 1 } : {}),
      ...(house.unreadable ? { housePricesUnreadable: house.unreadable } : {}),
    };
  }

  /**
   * The house's own price beside each linked line of the current menu (r21
   * defect 7, r28 G11). The menu line keeps the price the menu printed; the
   * house's own price (`restaurant_inventory.menu_price_current` / `_glass`,
   * Inventory "Your price") can differ: changed there after the menu was made
   * current, held by a price lock, or not carried. Each line linked to a house
   * good gets `house_price: { bottle, glass, removed }`, read in chunks of 150
   * ids and in this house only. A line with no link gets nothing. A chunk that
   * cannot be read is said once on the reply (`housePricesUnreadable`), never
   * taken for "no house price".
   */
  private async housePricesOf(
    restaurantId: string,
    items: Array<Record<string, unknown>>,
  ): Promise<{ items: Array<Record<string, unknown>>; unreadable: string | null }> {
    const ids = [...new Set(items.map((i) => i.inventory_item_id).filter((v) => v !== null && v !== undefined && v !== "").map(String))];
    if (ids.length === 0) return { items, unreadable: null };
    type Row = { id: string; menu_price_current: unknown; menu_price_glass: unknown; is_active: boolean | null; deleted_at: string | null };
    const byId = new Map<string, Row>();
    let unreadable: string | null = null;
    for (let at = 0; at < ids.length; at += WINE_ID_CHUNK) {
      const chunk = ids.slice(at, at + WINE_ID_CHUNK);
      const { data, error } = await this.dbService.supabase
        .from("restaurant_inventory")
        .select("id, menu_price_current, menu_price_glass, is_active, deleted_at")
        .eq("restaurant_id", restaurantId)
        .in("id", chunk);
      if (error) {
        unreadable = `the house's own prices could not be read: ${error.message}`;
        continue;
      }
      for (const r of (data ?? []) as Row[]) byId.set(String(r.id), r);
    }
    return {
      unreadable,
      items: items.map((line) => {
        const row = line.inventory_item_id ? byId.get(String(line.inventory_item_id)) : undefined;
        if (!row) return line;
        return {
          ...line,
          house_price: {
            bottle: linePrice(row.menu_price_current),
            glass: linePrice(row.menu_price_glass),
            removed: row.is_active === false || !!row.deleted_at,
          },
        };
      }),
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
    // r36 N5: the plan reads the replaced menu's discarded lines too.
    withDiscarded = false,
  ): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    let after: string | null = null;
    for (;;) {
      let q = this.dbService.supabase
        .from("menu_items")
        .select(LINE_SELECT)
        .eq("menu_id", menuId)
        .eq("restaurant_id", restaurantId);
      if (!withDiscarded) q = q.neq("status", "discarded");
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

  /**
   * Link one line of a kept menu to one of the house's own goods (r28 G21).
   *
   * A read whose line fits two or more of the house's goods (name, kind,
   * vintage and size) guesses none: the line goes to the library and the reply
   * names the goods (`houseCandidates`). Choosing that menu then carried the
   * line by its library wine, which adds a second good beside the house's own
   * when the house's row names another library wine or none. An owner or a
   * manager now picks the good, and the line is linked as a single fit would
   * have linked it: its good, and the good's library wine (or none).
   *
   * Only a menu that is not current: the current menu's lines were already
   * carried, so a new link there would not move what was carried. A kitchen
   * line is never linked (it is never carried). The good must be this house's
   * and live. Every read and the write are scoped to the house.
   */
  async linkLineToHouseGood(
    restaurantId: string,
    menuId: string,
    menuItemId: string,
    inventoryItemId: string,
  ): Promise<{ menuItemId: string; inventoryItemId: string; goodName: string }> {
    const db = this.dbService.supabase;
    const { data: menu, error: menuErr } = await db
      .from("restaurant_menus")
      .select("id, status")
      .eq("id", menuId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (menuErr) throw new InternalServerErrorException(`The menu could not be read: ${menuErr.message}. Nothing was changed.`);
    if (!menu) throw new NotFoundException("No menu of this restaurant by that id. Nothing was changed.");
    if (menu.status === "active") {
      throw new ConflictException(
        "This is the current menu: its lines were carried to the house when it was chosen, so a line is not linked here. Nothing was changed.",
      );
    }
    const { data: line, error: lineErr } = await db
      .from("menu_items")
      .select("id, name, category, raw_extracted_text, status")
      .eq("id", menuItemId)
      .eq("menu_id", menuId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (lineErr) throw new InternalServerErrorException(`The menu line could not be read: ${lineErr.message}. Nothing was changed.`);
    if (!line || line.status === "discarded") throw new NotFoundException("No line of this menu by that id. Nothing was changed.");
    if (isKitchenItem(line as unknown as InsertedMenuItem)) {
      throw new BadRequestException("This is a dish: it is never carried to the house's goods, so it is not linked to one. Nothing was changed.");
    }
    const { data: good, error: goodErr } = await db
      .from("restaurant_inventory")
      .select("id, master_wine_id, wine_name, display_name, is_active, deleted_at")
      .eq("id", inventoryItemId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (goodErr) throw new InternalServerErrorException(`The house's good could not be read: ${goodErr.message}. Nothing was changed.`);
    if (!good) throw new NotFoundException("No good of this house by that id. Nothing was changed.");
    if (good.is_active === false || good.deleted_at) {
      throw new ConflictException("That good is removed on Inventory. Bring it back there first. Nothing was changed.");
    }
    const { error: writeErr } = await db
      .from("menu_items")
      .update({ inventory_item_id: good.id, wine_library_id: good.master_wine_id ?? null })
      .eq("id", menuItemId)
      .eq("menu_id", menuId)
      .eq("restaurant_id", restaurantId);
    if (writeErr) throw new InternalServerErrorException(`The line was not linked: ${writeErr.message}. Nothing was changed.`);
    return { menuItemId, inventoryItemId: String(good.id), goodName: String(good.display_name ?? good.wine_name ?? "") };
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
    timezone: string | null;
    timezoneReason: string | null;
  }> {
    await this.sweepStaleReads(restaurantId);
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
      ...(await this.houseZone(restaurantId)),
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
    assertReadFinished(row);
    const lines = (await this.readLines(menuId, restaurantId)) as unknown as InsertedMenuItem[];
    const plan = await this.computePlan(restaurantId, menuId, await this.isOnlyCurrent(restaurantId, menuId, row), lines, readMomentOf(row), carryMomentOf(row));
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
      ...(await this.houseZone(restaurantId)),
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
    /** r31 w1 F2: the moment a carry of this menu is dated by; null when it is chosen now. */
    carryAt: string | null = null,
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
          .select("id, master_wine_id, wine_name, display_name, kind, bottle_size_ml, is_active, deleted_at, menu_price_current, menu_price_glass, master_wine_library(vintage)")
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
        // r36 N5: a drink discarded from the current menu kept its house
        // price, and this list skipped it, so the next menu could never take
        // it off sale. It is offered here like any line this file leaves out;
        // it is not "on the menu being replaced" for a lock's return (L18).
        for (const line of await this.readLines(m.id, restaurantId, { rawLine: false }, true)) {
          const discarded = line.status === "discarded";
          if (!discarded && line.wine_library_id) onReplaced.add(String(line.wine_library_id));
          else if (!discarded && line.inventory_item_id) onReplaced.add(`good:${String(line.inventory_item_id)}`);
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
        else if (keptFromTheCarry(lastSet.get(String(row.id)) ?? null, carryAt)) result = "kept_newer";
        else result = "change";
        counts[result] += 1;
        const set = row && (result === "change" || result === "kept_newer") ? (lastSet.get(String(row.id)) ?? null) : null;
        return {
          kind,
          menuPrice,
          housePrice,
          result,
          lastSet: set ? { by: { userId: set.by, name: null }, at: set.at, source: set.source } : null,
          setAfterRead: result === "change" && !!set && setByAPersonAfter(set, readAt),
          lock: lock
            ? { lockId: lock.lockId, lockedPrice: lock.lockedPrice, lockedBy: { userId: lock.lockedBy, name: null }, lockedAt: lock.lockedAt }
            : null,
        };
      };
      const bottle = kindPlan("bottle", menuB, houseB);
      const glass = kindPlan("glass", menuG, houseG);
      // The same rule the carry writes (carryMenuPrice): answer 3, then answer 4.
      let flag: PriceFlag | null = null;
      if (line.price_flag === "other_currency" && line.price_flag_note) flag = "other_currency";
      else if (wineId || row) {
        if ((menuB === null && houseB !== null) || (menuG === null && houseG !== null)) flag = "blank_kept_last_known";
        else if (menuB === null && menuG === null && houseB === null && houseG === null) flag = "blank_no_house_price";
      }
      const locked = !!row && lockedWines.has(String(row.id));
      const libVintage = row?.master_wine_library?.vintage ?? null;
      const readYear = yearOf(line.vintage);
      return {
        menuItemId: line.id,
        name: line.name,
        category: typeof line.category === "string" && line.category.trim() ? line.category : null,
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
        // r36 N1: the sentence a held line carries, so the plan can say which money the menu printed.
        ...(flag === "other_currency" ? { flagNote: String(line.price_flag_note) } : {}),
      };
    });

    // r35 G21: which unlinked drink lines fit the house's own live goods,
    // matched now with the read's own matcher. The read's candidates are in
    // its reply only, so after a reload the plan is where they are seen again.
    if (!current) {
      const loose = planLines.filter((l) => l.inventoryId === null);
      if (loose.length > 0) {
        const byId = new Map(lines.map((l) => [l.id, l]));
        let fits: Awaited<ReturnType<typeof matchHouseGoods>> = [];
        // The live goods are the rows read above: no second read of the house.
        const live = [...byInventory.values()]
          .filter((r) => r.is_active === true && !r.deleted_at)
          .map((r) => ({
            id: String(r.id),
            display_name: r.display_name ?? null,
            wine_name: r.wine_name ?? null,
            kind: r.kind ?? null,
            master_wine_id: r.master_wine_id ?? null,
            bottle_size_ml: r.bottle_size_ml ?? null,
          }));
        try {
          fits = await matchHouseGoods(
            client,
            restaurantId,
            loose.map((l) => {
              const line = byId.get(l.menuItemId)!;
              return { name: line.name, producer: line.producer ?? null, category: line.category ?? null, vintage: line.vintage ?? null };
            }),
            live,
          );
        } catch (err) {
          fail("the house's goods each line may be", err instanceof Error ? err.message : String(err));
        }
        loose.forEach((l, i) => {
          const m = fits[i];
          const goods = m?.outcome === "one" ? [m.good] : m?.outcome === "many" ? m.goods : [];
          if (goods.length > 0) {
            l.houseCandidates = goods.map((g) => ({
              inventoryItemId: String(g.id),
              name: g.display_name ?? g.wine_name ?? "",
              kind: g.kind ?? null,
            }));
          }
        });
      }
    }

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
      // The house's row: by the wine, or by the good an unlinked line named
      // (r35 G10: a good-linked drink used to read "nothing is kept for it"
      // whatever price it held).
      const row = wineId
        ? (house.get(wineId) ?? null)
        : line.inventory_item_id
          ? (byInventory.get(String(line.inventory_item_id)) ?? null)
          : null;
      // A good this menu carries under another line is on this file: listed
      // here, taking its price off would undo the price this menu sets.
      if (row && onThisMenu.has(String(row.id))) continue;
      seen.add(key);
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
      // r35 G21: the goods each loose line fits; a new one is a different plan.
      fits: planLines
        .filter((l) => l.houseCandidates)
        .map((l) => [l.menuItemId, l.houseCandidates!.map((c) => c.inventoryItemId).sort()])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
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
   *
   * TAKING A DROPPED DRINK OFF SALE (r35 G10, MU-12). Silence still changes
   * nothing (L12): a drink the current menu lists and this one does not keeps
   * its price unless the person names it in `takeOff` (its line id from the
   * plan's `notOnThisFile`). A named drink's bottle and glass price are
   * cleared through the one writer, dated by the choice and naming the menu,
   * so the version trail keeps what it was sold at. Its row, stock and kind
   * stay: the bottles are still in the cellar. A lock still holds its kind
   * (L16), said by name. An id the plan does not offer is refused (400)
   * before the switch, and nothing is changed.
   */
  async makeCurrent(
    restaurantId: string,
    menuId: string,
    userId: string,
    fingerprint?: string | null,
    takeOff: readonly string[] = [],
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
    takenOff: TakenOff[];
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
    assertReadFinished(version);
    const plan = await this.computePlan(restaurantId, menuId, await this.isOnlyCurrent(restaurantId, menuId, version), lines, readMomentOf(version), carryMomentOf(version));
    if (plan.fingerprint !== fingerprint.trim()) {
      throw new ConflictException(
        "What choosing this menu would do has changed since it was shown (a price or a lock moved). Nothing was changed; look at the plan again.",
      );
    }
    // Every drink named to take off is one the plan offers: a drink the
    // current menu lists, this one does not, and the house holds a row for.
    const offered = new Map((plan.notOnThisFile ?? []).filter((n) => n.inventoryId).map((n) => [n.menuItemId, n]));
    const named = [...new Set(takeOff.map(String))];
    const notOffered = named.filter((id) => !offered.has(id));
    if (notOffered.length > 0) {
      throw new BadRequestException(
        `${notOffered.length === 1 ? "One drink" : `${notOffered.length} drinks`} named to take off sale ${notOffered.length === 1 ? "is" : "are"} not a drink the current menu lists, this one leaves out and the house holds. Nothing was changed; look at the plan again.`,
      );
    }
    const toTakeOff = named.map((id) => offered.get(id)!);
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
      takenOff: [] as TakenOff[],
    };
    // CHOOSING A CURRENT MENU AGAIN FINISHES ITS CARRY (r28 G1). It answered
    // "already_current" with zero lines, so a carry cut off part-way (a deploy,
    // a refused price call) could never be finished from any screen. Every
    // price is written dated by the original choice, so the carry is safe to
    // run again: a line already carried answers "unchanged", a price someone
    // set after the choice answers "stale" and stands, a lock still holds.
    const outcome = r.outcome;
    if (outcome === "already_current" && !madeCurrentAt) return { outcome, ...empty };

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
        takenOff: toTakeOff.map((n) => takenOffFailed(n, why)),
      };
    }

    // addToInventory writes each line's house link and price flag back itself.
    // The switch is already committed: a refusal from here on must never
    // reach the page as "nothing changed".
    let priceSync: Map<string, PriceSyncEntry>;
    try {
      ({ priceSync } = await this.addToInventory(lines, restaurantId, userId, {
        effectiveFrom: madeCurrentAt,
        menuId,
      }));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.error(`menu ${menuId} is current but its prices were not carried: ${why}`);
      throw new InternalServerErrorException(
        `This menu is now the current one, but its prices did not reach the house (${why}). Choose it again under Menus kept to carry them; a price set since it was chosen stays.${toTakeOff.length ? " No price was taken off the drinks it leaves out: take them off on Inventory." : ""}`,
      );
    }

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
    const takenOff = toTakeOff.length ? await this.takeOffSale(restaurantId, menuId, userId, madeCurrentAt, toTakeOff) : [];
    return {
      outcome,
      ...empty,
      lines: lines.length,
      priceSync: counts,
      flagged,
      failed,
      held,
      returned,
      takenOff,
    };
  }

  /**
   * Clear the bottle and glass price of each drink named (r35 G10), dated by
   * the choice and naming the menu, through the one batch writer (per row on
   * a database without it). The switch is committed: a refusal is said on
   * its drink, never thrown.
   */
  private async takeOffSale(
    restaurantId: string,
    menuId: string,
    userId: string,
    at: string,
    drinks: NotOnThisFile[],
  ): Promise<TakenOff[]> {
    const client = this.dbService.supabase;
    const common = {
      restaurantId,
      source: "manual" as const,
      changedBy: userId,
      effectiveFrom: at,
      menuId,
      reason: "taken off sale: not on the menu made current",
    };
    let answers: Map<string, HousePriceRowAnswer> | null;
    try {
      answers = await setHouseMenuPrices(
        client,
        common,
        drinks.map((n) => ({ key: n.menuItemId, inventoryId: n.inventoryId!, bottle: null, glass: null })),
      );
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return drinks.map((n) => takenOffFailed(n, why));
    }
    const out: TakenOff[] = [];
    for (const n of drinks) {
      let a: HousePriceRowAnswer | undefined;
      if (answers === null) {
        try {
          a = { ok: true, result: await setHouseMenuPrice(client, { ...common, inventoryId: n.inventoryId!, bottle: null, glass: null }) };
        } catch (err) {
          a = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      } else {
        a = answers.get(n.menuItemId);
      }
      if (!a) {
        out.push(takenOffFailed(n, "The price writer's answer did not name this drink; whether its price was taken off is unknown."));
      } else if (!a.ok) {
        this.logger.error(`menu ${menuId}: the price of "${n.name}" was not taken off: ${a.error}`);
        out.push(takenOffFailed(n, a.error));
      } else {
        out.push({
          menuItemId: n.menuItemId,
          name: n.name,
          inventoryId: n.inventoryId!,
          bottle: a.result.kinds.bottle,
          glass: a.result.kinds.glass,
          held: a.result.held,
          error: null,
        });
      }
    }
    return out;
  }

  /**
   * Whether this menu is the house's ONLY current menu (r28 G20). A menu marked
   * current beside another one is planned as a menu being chosen: choosing it
   * sets the others aside (make_menu_current archives every other active menu
   * and answers made_current), so the plan lists what they carry and this one
   * does not, and offers the choice. Planned as "already current", the plan
   * offered no choice when no price differed, and the house could not settle
   * which menu is current. A failed read is a 5xx, never a guess.
   */
  private async isOnlyCurrent(restaurantId: string, menuId: string, row: Record<string, any>): Promise<boolean> {
    if (row.status !== "active") return false;
    const { data, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active")
      .neq("id", menuId);
    if (error) throw new InternalServerErrorException(`The house's current menus could not be read: ${error.message}`);
    return ((data ?? []) as unknown[]).length === 0;
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
      readWarnings: Array.isArray(r.read_warnings) ? r.read_warnings.filter((w: unknown) => w && typeof w === "object") : null,
      readState: (r.read_state as MenuReadState | undefined) ?? "done",
      readFailure: r.read_failure ?? null,
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
  /** The house's zone for its menu dates (houseZoneOf); a failed read is said, never a default. */
  private async houseZone(restaurantId: string): Promise<{ timezone: string | null; timezoneReason: string | null }> {
    const { data, error } = await this.dbService.supabase
      .from("restaurants")
      .select("timezone")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) this.logger.warn(`The house's time zone could not be read: ${error.message}`);
    return houseZoneOf((data as { timezone?: unknown } | null)?.timezone, error ? error.message : null);
  }

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
    const resolved = await this.resolveLibrary(items, restaurantId);
    return this.persistItems(resolved, restaurantId, menuId, userId, method, current);
  }

  /** Every line resolved against the wine library; writes no menu row. */
  private async resolveLibrary(
    items: WineExtractItem[],
    restaurantId: string,
  ): Promise<ResolvedItem[]> {
    if (items.length === 0) return [];

    // THE HOUSE'S MONEY (r36 N1, menu-money.ts). A line whose menu prints its
    // price only in another money takes no price, and says why; a line that
    // prints the house's money in a second column takes that column. The
    // house's money is read only when a line names one.
    const held = new Map<WineExtractItem, string>();
    if (items.some((item) => namesMoney(item as unknown as Record<string, unknown>))) {
      const house = await this.houseMoney(restaurantId);
      items = items.map((item) => {
        const take = lineMoney(item as unknown as Record<string, unknown>, house.code, house.unreadable);
        if (take.kind === "as_read") return item;
        if (take.kind === "house_column") {
          return { ...item, by_glass_price: take.glass ?? undefined, bottle_price: take.bottle ?? undefined };
        }
        const kept = { ...item, by_glass_price: undefined, bottle_price: undefined };
        held.set(kept, take.note);
        return kept;
      });
    }

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
    //
    // THE HOUSE'S OWN GOODS COME FIRST (r21 walk, D1). A drink line that names
    // exactly one good the house already carries (house-good-match.ts: name,
    // kind, vintage and size where stated) is linked to that good and never
    // sent to the library, so it makes no library row and no second inventory
    // row. Its library wine, if the good names one, comes with it. A line two
    // goods fit goes the old way and says which. A failed read of the house's
    // goods is fatal, like the library call below: taking it for "the house
    // carries nothing" is exactly how the copies were made.
    const house = await matchHouseGoods(
      this.dbService.supabase,
      restaurantId,
      items.map((item, idx) => (kitchen[idx] ? null : item)),
    ).catch((err: Error) => {
      this.logger.error(`Menu import: ${err.message}`);
      throw new Error(`Menu import failed: ${err.message}`);
    });
    const drinks = items.filter((_, idx) => !kitchen[idx] && house[idx].outcome !== "one");
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
      // Back onto every line, in the menu's order: a kitchen line is unlinked,
      // and a line that named the house's good takes that good.
      let next = 0;
      return items.map((item, idx) => {
        const h = house[idx];
        if (!kitchen[idx] && h.outcome === "one") {
          return {
            item,
            masterWineId: h.good.master_wine_id ?? null,
            matched: true,
            libraryTier: null,
            confidence: null,
            houseItemId: h.good.id,
            ...(held.has(item) ? { heldNote: held.get(item) } : {}),
          };
        }
        const r = kitchen[idx] ? undefined : drinkResults[next++];
        return {
          item,
          kitchen: kitchen[idx],
          masterWineId: r?.masterWineId ?? null,
          matched: r?.matched ?? false,
          libraryTier: r?.libraryTier ?? null,
          confidence: r?.confidence ?? null,
          ...(held.has(item) ? { heldNote: held.get(item) } : {}),
          ...(h.outcome === "many"
            ? {
                houseCandidates: h.goods.map((g) => ({
                  inventoryItemId: g.id,
                  name: g.display_name ?? g.wine_name ?? "",
                  kind: g.kind ?? null,
                })),
              }
            : {}),
        };
      });
    } catch (err) {
      this.logger.error(`Library resolution failed for menu: ${err.message}`);
      throw new Error(
        `Menu import failed during library resolution: ${err.message}`,
      );
    }
  }

  /** Inserts already-resolved lines into `menuId`; if `current`, also seeds the house's inventory and prices. */
  private async persistItems(
    resolved: ResolvedItem[],
    restaurantId: string,
    menuId: string,
    userId: string,
    method: "scan" | "csv" | "manual",
    current: boolean,
  ): Promise<MenuImportReviewItem[]> {
    if (resolved.length === 0) return [];

    // Unlinked items are the ones a manager has to fix by hand, so say how
    // many there are rather than leaving it to be discovered in the UI.
    // A kitchen line is unlinked on purpose and is not counted; nor is a line
    // linked to the house's own good, library wine or not.
    const unlinked = resolved.filter((r) => !r.masterWineId && !r.houseItemId && !r.kitchen).length;
    // The lines that went to the library: not a kitchen line, not the house's own good.
    const drinks = resolved.filter((r) => !r.kitchen && !r.houseItemId);
    if (unlinked > 0) {
      this.logger.error(
        `Menu import: ${unlinked}/${drinks.length} drink line(s) could not be ` +
          `linked to the wine library and will have no inventory row`,
      );
    }
    for (const r of resolved) {
      if (r.houseCandidates) {
        this.logger.warn(
          `Menu import: "${r.item.name}" fits ${r.houseCandidates.length} of the house's goods ` +
            `(${r.houseCandidates.map((c) => `${c.name} [${c.kind ?? "no kind"}] ${c.inventoryItemId}`).join("; ")}); ` +
            `none was guessed, so it went to the library`,
        );
      }
    }

    const menuItemRows = resolved.map(({ item, masterWineId, houseItemId, heldNote }) => ({
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
      ...(heldNote ? { price_flag: "other_currency", price_flag_note: heldNote } : {}),
      wine_library_id: masterWineId,
      ...(houseItemId ? { inventory_item_id: houseItemId } : {}),
      source: method,
      // Every line is kept as read (r28 G16). A typed line past the 25th used
      // to be flagged "Free tier: exceeds 25 item limit": no plan holds such a
      // cap (pricing is undecided, OD-23; every house runs on the default
      // tier), the flag gated nothing, and a new house typing its menu was told
      // it was over a limit. menu-line-view still reads that note on old rows.
      status: "approved",
      review_notes: null,
    }));

    const { data, error: menuItemsErr } = await this.dbService.supabase
      .from("menu_items")
      .insert(menuItemRows)
      .select(
        "id, wine_library_id, inventory_item_id, name, by_glass_price, bottle_price, created_at, producer, vintage, region, grape_variety, category, raw_extracted_text, price_flag, price_flag_note",
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
          ? (inventoryMap.get(menuItem.id) ?? r.houseItemId ?? null)
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
        priceFlag: menuItem
          ? (priceSync.get(menuItem.id)?.flag ?? (r.heldNote ? "other_currency" : null))
          : null,
        priceFlagNote: menuItem
          ? (priceSync.get(menuItem.id)?.flagNote ?? r.heldNote ?? null)
          : null,
        priceHeld: menuItem ? (priceSync.get(menuItem.id)?.held ?? []) : [],
        ...(r.houseCandidates ? { houseCandidates: r.houseCandidates } : {}),
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
      // A line that named the house's own good never went to the library.
      if (!r.masterWineId || r.houseItemId) return;
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
        // The good's kind from its line's section (r28 G2). Without it the
        // insert trigger files every good a menu adds as a bottle of wine
        // (20260903171000:431), beer, gin, cola and cocktail alike.
        ...newGoodIdentity(firstLine.get(w)!.category),
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

    // 3. Each line's row, then every price through the writer in ONE call per
    //    round (r28 G1). Round r holds the r-th line of each wine, in menu
    //    order: a second line of one wine must see the price the first just
    //    set (what the per-line read used to see), so its round re-reads those
    //    rows first. A plain menu is one round; a wine listed by the glass and
    //    again by the bottle makes two. The price stays set_house_menu_price's,
    //    run inside set_house_menu_prices (L4, L27).
    const carried = new Set<string>();
    const writeBacks: Array<{ id: string; inventory_item_id: string; price_flag: PriceFlag | null; price_flag_note: string | null }> = [];
    const rounds: Array<Array<{ item: InsertedMenuItem; inventoryId: string; kind: string | null }>> = [];
    const roundOf = new Map<string, number>();
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
      result.set(item.id, inventoryId);
      // A row this call created is "created" on its first line only.
      if (!existing && !carried.has(w)) result.created.add(item.id);
      carried.add(w);
      const r = roundOf.get(w) ?? 0;
      roundOf.set(w, r + 1);
      const kind = existing ? (existing.kind ?? null) : (createdKind.get(w) ?? null);
      (rounds[r] ??= []).push({ item, inventoryId, kind });
    }

    for (let r = 0; r < rounds.length; r += 1) {
      const round = rounds[r];
      // The house's price before this round: as read (or none, for a row this
      // call created) for the first, read again for every later round.
      const before = new Map<string, { bottle: number | string | null; glass: number | string | null }>();
      const againFailed = new Map<string, string>();
      if (r === 0) {
        for (const { item, inventoryId } of round) {
          const existing = existingByWine.get(keyOf(item)) ?? null;
          before.set(inventoryId, {
            bottle: existing?.menu_price_current ?? null,
            glass: existing?.menu_price_glass ?? null,
          });
        }
      } else {
        const ids = [...new Set(round.map((x) => x.inventoryId))];
        for (let at = 0; at < ids.length; at += WINE_ID_CHUNK) {
          const chunk = ids.slice(at, at + WINE_ID_CHUNK);
          const { data: again, error: againErr } = await client
            .from("restaurant_inventory")
            .select("id, menu_price_current, menu_price_glass")
            .eq("restaurant_id", restaurantId)
            .in("id", chunk);
          if (againErr) {
            for (const id of chunk) againFailed.set(id, againErr.message);
            continue;
          }
          for (const row of (again ?? []) as Array<{ id: string; menu_price_current: number | string | null; menu_price_glass: number | string | null }>) {
            before.set(String(row.id), { bottle: row.menu_price_current ?? null, glass: row.menu_price_glass ?? null });
          }
        }
      }
      const toWrite: Array<{ item: InsertedMenuItem; inventoryId: string; plan: CarryPlan }> = [];
      for (const { item, inventoryId, kind } of round) {
        const againErr = againFailed.get(inventoryId);
        if (againErr !== undefined) {
          const message = `the house's own row for this wine could not be read, so neither its price nor a blank-price flag was decided: ${againErr}`;
          this.logger.error(`menu line ${item.id} ("${item.name}"): ${message}`);
          priceSync.set(item.id, { outcome: "failed", error: message, flag: null, flagNote: null, held: [] });
          continue;
        }
        const plan = carryPlanOf(item, before.get(inventoryId) ?? { bottle: null, glass: null }, kind);
        writeBacks.push({ id: item.id, inventory_item_id: inventoryId, price_flag: plan.flag, price_flag_note: plan.flagNote });
        if (plan.bottle === null && plan.glass === null) {
          priceSync.set(item.id, { outcome: "no_price", error: null, flag: plan.flag, flagNote: plan.flagNote, held: [] });
          continue;
        }
        toWrite.push({ item, inventoryId, plan });
      }
      if (toWrite.length === 0) continue;
      const answers = await setHouseMenuPrices(
        client,
        {
          restaurantId,
          source: "import",
          changedBy: userId,
          // Dated by the choice of the menu, or now for a line added to the
          // current menu -- never by the line's own created_at (L11).
          effectiveFrom: dating.effectiveFrom,
          menuId: dating.menuId,
          reason: "menu line",
        },
        toWrite.map(({ item, inventoryId, plan }) => ({
          key: String(item.id),
          inventoryId,
          ...(plan.bottle !== null ? { bottle: plan.bottle } : {}),
          ...(plan.glass !== null ? { glass: plan.glass } : {}),
        })),
      );
      for (const { item, inventoryId, plan } of toWrite) {
        if (answers === null) {
          // The batch writer is not in this database yet: one call per line, as before.
          priceSync.set(item.id, await this.carryMenuPrice(item, restaurantId, inventoryId, userId, plan, dating));
          continue;
        }
        const a = answers.get(String(item.id));
        if (a?.ok) {
          priceSync.set(item.id, { outcome: a.result.outcome, error: null, flag: plan.flag, flagNote: plan.flagNote, held: a.result.held });
        } else {
          const message = a ? a.error : "The price writer's answer did not name this line; whether its price changed is unknown.";
          this.logger.error(`menu line ${item.id} ("${item.name}"): the house price was not updated: ${message}`);
          priceSync.set(item.id, { outcome: "failed", error: message, flag: plan.flag, flagNote: plan.flagNote, held: [] });
        }
      }
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
   * The house's own money (restaurants.currency), or why it could not be read.
   * null code: the house has not named its money (r36 N1, menu-money.ts).
   */
  private async houseMoney(restaurantId: string): Promise<{ code: string | null; unreadable: string | null }> {
    const { data, error } = await this.dbService.supabase
      .from("restaurants")
      .select("currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) return { code: null, unreadable: error.message };
    const code = (data as { currency?: unknown } | null)?.currency;
    return { code: typeof code === "string" && code.trim() !== "" ? code.trim().toUpperCase() : null, unreadable: null };
  }

  /**
   * Refuses a typed price whose mark names another money than the house's
   * (r36 N1): "€12" typed in a lira house would be stored as 12 lira. A typed
   * price with no mark is never read against the house, so most saves read
   * nothing more. A house whose money cannot be read refuses a marked price.
   */
  private async refuseOtherMoney(typed: unknown, restaurantId: string, nothing: string): Promise<void> {
    if (typeof typed !== "string" || typedMoneyOf(typed) === null) return;
    const house = await this.houseMoney(restaurantId);
    if (house.unreadable !== null) {
      throw new BadRequestException(
        `"${typed.trim()}" names a currency, and this house's own money could not be read (${house.unreadable}). Type the price without the mark. ${nothing}`,
      );
    }
    const why = typedMoneyRefusal(typed, house.code);
    if (why) throw new BadRequestException(why.replace("Nothing was changed.", nothing));
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
    plan: CarryPlan,
    dating: CarryDating,
  ): Promise<PriceSyncEntry> {
    const { bottle, glass, flag, flagNote } = plan;
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

  /**
   * A person's setup, read from the house their session is in (OB-1, the
   * session's call under the 2026-11-07 /goal). The house facts (a menu
   * read, a menu made current, a supplier, an invite) come from the house's
   * own tables every time; the person's row keeps only checklist_dismissed.
   * A GET writes nothing; an invitee with no row still reads their house.
   * "Activated" = a CURRENT menu with a live line (ADR 0193: a kept draft
   * gives no stock and no prices); the threshold no longer gates it. This
   * read does not make any menu current: that is the person's choice, on the
   * first proof (#1053) or on /menu, and the web says which one is missing.
   * `completed_at` = when the last of current menu, supplier and invite held.
   * It is derived, not remembered: if the house loses its only supplier or
   * its current menu, the step is undone again and the checklist says so
   * (putting the checklist away, `checklist_dismissed`, is what is kept).
   * An invite counts while it can still be used or once it was used; an
   * expired, unused invite does not (a revoked one is deleted, so it never
   * counts). A supplier counts whoever added it -- the person, a promoted
   * prospect, or a seller read off the house's own invoice.
   * A failed read throws; it is never taken for "not yet".
   * `next_steps` (readNextSteps) are read alongside and never throw: each
   * gives null when its own read fails.
   */
  async getOnboardingProgress(userId: string, restaurantId: string | null | undefined) {
    if (!restaurantId) {
      throw new NotFoundException(
        "This session is in no house yet, so there is no house setup to read.",
      );
    }
    const supabase = this.dbService.supabase;
    const fail = (what: string, message: string) =>
      new InternalServerErrorException(
        `Could not read this house's ${what} for its setup: ${message}`,
      );

    const [own, menuRead, menuCurrent, supplier, invite, house, nextSteps] =
      await Promise.all([
        supabase
          .from("user_onboarding_progress")
          .select("id, checklist_dismissed")
          .eq("user_id", userId)
          .maybeSingle(),
        this.firstLiveMenuLine(restaurantId, "read"),
        this.firstLiveMenuLine(restaurantId, "current"),
        supabase
          .from("providers")
          .select("created_at")
          .eq("restaurant_id", restaurantId)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .limit(1),
        supabase
          .from("organization_invites")
          .select("created_at")
          .eq("restaurant_id", restaurantId)
          .or(`used_at.not.is.null,expires_at.gt.${new Date().toISOString()}`)
          .order("created_at", { ascending: true })
          .limit(1),
        supabase
          .from("restaurants")
          .select("threshold_configured")
          .eq("id", restaurantId)
          .maybeSingle(),
        this.readNextSteps(restaurantId),
      ]);
    if (own.error) throw fail("setup row", own.error.message);
    if (supplier.error) throw fail("suppliers", supplier.error.message);
    if (invite.error) throw fail("invites", invite.error.message);
    if (house.error) throw fail("settings", house.error.message);

    // A fact holds when its first row exists; `since` is that row's time.
    const supplierRow = (supplier.data ?? [])[0] ?? null;
    const inviteRow = (invite.data ?? [])[0] ?? null;
    const times = [menuCurrent?.since, supplierRow?.created_at, inviteRow?.created_at];
    const completedAt =
      menuCurrent && supplierRow && inviteRow && times.every(Boolean)
        ? (times as string[]).reduce((a, b) =>
            Date.parse(b) > Date.parse(a) ? b : a,
          )
        : null;

    return {
      id: own.data?.id ?? null,
      user_id: userId,
      restaurant_id: restaurantId,
      menu_uploaded: menuRead !== null,
      menu_current: menuCurrent !== null,
      vendor_added: supplierRow !== null,
      team_member_invited: inviteRow !== null,
      checklist_dismissed: !!own.data?.checklist_dismissed,
      completed_at: completedAt,
      threshold_configured: !!house.data?.threshold_configured,
      activated: menuCurrent !== null,
      next_steps: nextSteps,
    };
  }

  /**
   * What leads past the menu to the house's costs (r28 onboarding gap 3, the
   * session's call under the 2026-11-07 /goal): the first goods on the list,
   * the house's mailbox, and the first invoice checked. These are the next
   * steps, not setup: they never decide `completed_at` or `activated`, so a
   * house that finished setup is not sent back into it.
   *
   * Each fact is read on its own. A read that fails gives `null` (not read),
   * never `false`: the setup above still answers, and the panel says the step
   * could not be read instead of calling it not done (absence is not health,
   * and a failed read is not absence).
   *
   * - goods_listed: an active good on the house's list (the desk's count).
   * - mailbox_connected: a live Gmail grant held for this house, to send or
   *   to read (the only mailbox a house can connect today).
   * - invoice: "checked" once an invoice is verified (its costs are applied),
   *   else "waiting" while one is in and not yet checked, else "none".
   *   A rejected or superseded paper is neither.
   */
  private async readNextSteps(restaurantId: string): Promise<{
    goods_listed: boolean | null;
    mailbox_connected: boolean | null;
    invoice: "none" | "waiting" | "checked" | null;
  }> {
    const supabase = this.dbService.supabase;
    // A read that throws or rejects (a dropped connection) is a failed read
    // like any other: it gives this fact `null` and never fails the setup.
    const settle = (
      query: () => PromiseLike<{ data: unknown[] | null; error: unknown }>,
    ): Promise<{ data: unknown[] | null; error: unknown }> =>
      new Promise<PromiseLike<{ data: unknown[] | null; error: unknown }>>(
        (resolve) => resolve(query()),
      ).then(
        (read) => read,
        (error: unknown) => ({ data: null, error: error ?? "rejected" }),
      );
    const [goods, mailbox, checked, waiting] = await Promise.all([
      settle(() =>
        supabase
          .from("restaurant_inventory")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .is("deleted_at", null)
          .eq("is_active", true)
          .limit(1),
      ),
      settle(() =>
        supabase
          .from("integration_oauth_connections")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .in("integration_id", ["gmail_send", "gmail_read"])
          .is("revoked_at", null)
          .limit(1),
      ),
      settle(() =>
        supabase
          .from("procurement_documents")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("doc_type", "invoice")
          .eq("status", "verified")
          .limit(1),
      ),
      settle(() =>
        supabase
          .from("procurement_documents")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("doc_type", "invoice")
          .in("status", ["received", "extracting", "needs_review"])
          .limit(1),
      ),
    ]);
    const held = (read: { data: unknown[] | null; error: unknown }) =>
      read.error ? null : (read.data ?? []).length > 0;
    const isChecked = held(checked);
    const isWaiting = held(waiting);
    let invoice: "none" | "waiting" | "checked" | null;
    if (isChecked === true) invoice = "checked";
    else if (isChecked === null) invoice = null;
    else if (isWaiting === null) invoice = null;
    else invoice = isWaiting ? "waiting" : "none";
    return {
      goods_listed: held(goods),
      mailbox_connected: held(mailbox),
      invoice,
    };
  }

  /**
   * The house's first live menu line (a `menu_items` row
   * that is not discarded), on a version that is not archived ("read") or on
   * the current version ("current"), with when it was written; null when
   * there is none. Lines are
   * counted where they live, whatever put them there -- a read, a CSV, lines
   * typed in review -- never from `lines_extracted` (#770). A failed read
   * throws.
   */
  private async firstLiveMenuLine(
    restaurantId: string,
    which: "read" | "current",
  ): Promise<{ since: string | null } | null> {
    let query = this.dbService.supabase
      .from("menu_items")
      .select("created_at, restaurant_menus!inner(status)")
      .eq("restaurant_id", restaurantId)
      .neq("status", "discarded");
    query =
      which === "current"
        ? query.eq("restaurant_menus.status", "active")
        : query.neq("restaurant_menus.status", "archived");
    const { data, error } = await query
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) {
      throw new InternalServerErrorException(
        `Could not read this house's menus for its setup: ${error.message}`,
      );
    }
    const first = (data ?? [])[0];
    return first ? { since: first.created_at ?? null } : null;
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

  /**
   * Only the person's own flag is written: putting the checklist away. The
   * house facts (menu, supplier, invite) are read from the house in
   * `getOnboardingProgress` and a client cannot set them; a body that names
   * them changes nothing (older clients still send `vendor_added`). A person
   * with no row gets one, in the session's house. Answers the progress read.
   */
  async updateOnboardingProgress(
    userId: string,
    restaurantId: string | null | undefined,
    dto: UpdateOnboardingProgressDto,
  ) {
    if (dto.checklist_dismissed !== undefined) {
      if (!restaurantId) {
        throw new NotFoundException(
          "This session is in no house yet, so there is no checklist to put away.",
        );
      }
      // Update the person's row (user_id is UNIQUE); with none, insert one.
      // Two first-time PATCHes at once both find no row: the loser's insert
      // hits the unique index (23505) and updates the winner's row instead
      // of answering 500. Not an upsert: that would rewrite the row's
      // restaurant_id, which the menu self-heal still keys on.
      const dismissed = { checklist_dismissed: dto.checklist_dismissed };
      const updateOwn = () =>
        this.dbService.supabase
          .from("user_onboarding_progress")
          .update(dismissed)
          .eq("user_id", userId)
          .select("id");
      const notPutAway = (message: string) =>
        new InternalServerErrorException(
          `The checklist was not put away: ${message}`,
        );
      const updated = await updateOwn();
      if (updated.error) throw notPutAway(updated.error.message);
      if ((updated.data ?? []).length === 0) {
        const inserted = await this.dbService.supabase
          .from("user_onboarding_progress")
          .insert({
            user_id: userId,
            restaurant_id: restaurantId,
            ...dismissed,
          });
        if (inserted.error?.code === "23505") {
          const again = await updateOwn();
          if (again.error) throw notPutAway(again.error.message);
        } else if (inserted.error) {
          throw notPutAway(inserted.error.message);
        }
      }
    }
    return this.getOnboardingProgress(userId, restaurantId);
  }
}
