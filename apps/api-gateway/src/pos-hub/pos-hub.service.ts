import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from "@nestjs/common";
import * as crypto from "crypto";
import { DatabaseService } from "../database/database.service";
import { readWholeWindow } from "../common/read-whole-window";
import { houseDayOf, readHouseZone } from "../common/house-day";
import { zoneOffsetMs } from "../calendar/zoned-time";
import { assertInventoryBelongsToRestaurant } from "../common/tenant/assert-inventory-belongs-to-restaurant";
import { LowStockAlertsService } from "../notifications/low-stock-alerts.service";
import { CanonicalCheck, CheckChannel } from "./pos-types";
import { ADAPTERS } from "./pos-adapters";
import {
  loadHouseTaxContext,
  keepsStoredStamp,
  resolveCheckSubtotal,
  type HouseTaxContextRead,
} from "./tax-basis-resolver";
import {
  PROVIDER_BY_KEY,
  POS_PROVIDERS,
  registrySummary,
} from "./pos-provider.registry";
import { NotificationsService } from "../notifications/notifications.service";
import { AreaRoutingService } from "../areas/area-routing.service";
import { recipeMeasure } from "../beverages/cocktail-recipe";
import {
  fileRefusedChecksNote,
  tillName,
  type RefusedCheck,
  type RefusedChecksNote,
} from "./refused-checks-note";
import { createHash } from "crypto";

/**
 * `record_glass_pour` COALESCEs a missing `bottle_size_ml` to 750 before it
 * subtracts a pour (baseline_from_production.sql:1148). Mirrored here so the
 * "a pour can never exceed the container it comes from" guard below reasons
 * about the same number the database will.
 */
const RPC_DEFAULT_BOTTLE_ML = 750;

/** Below this, a value is a unit mistake (litres typed into an ml field). */
const MIN_PLAUSIBLE_SALE_ML = 10;
/** Above this, likewise — a Melchizedek is 30 000ml and nothing pours more. */
const MAX_PLAUSIBLE_SALE_ML = 30000;

/** The inventory facts a depletion needs. Nulls are real: see ADR 0011. */
export interface InventoryVolumes {
  bottleMl: number | null;
  pourMl: number | null;
  menuPrice: number | null;
}

/**
 * The one rule for reading an inventory row's sizes: a size that is not a
 * finite positive number is no size at all (null), so `resolveSaleVolume`
 * queues rather than pouring from a 0ml or negative bottle. Exported so the
 * sale-unit review reads the row exactly as the import does (ADR 0281).
 */
export function inventoryVolumesFromRow(row: {
  bottle_size_ml?: unknown;
  pour_size_ml?: unknown;
  menu_price_current?: unknown;
}): InventoryVolumes {
  const positive = (v: unknown) => {
    // Number(null) is 0 and Number("") is 0, which this rule already refuses.
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    bottleMl: positive(row?.bottle_size_ml),
    pourMl: positive(row?.pour_size_ml),
    menuPrice: positive(row?.menu_price_current),
  };
}

/**
 * A sale older than this when it reaches the hub is counted as back-dated in
 * the import result (`stock.backdatedOver72h`). It is still dated by its
 * check, at any age: the founder ruled that C02's "older needs a manager",
 * which holds for door receipts, counts and orders, does not hold for a POS
 * check ("No: trust the till", ADR 0281, fork F1).
 */
export const BACKDATED_AFTER_MS = 72 * 60 * 60 * 1000;

/**
 * When one check is dated (ADR 0281): one reading of its closed_at, made
 * before the check is stored, and every date the import writes for it.
 */
export interface SaleInstant {
  /**
   * What `pos_checks.closed_at` receives. When `readClosedAt` reads the till's
   * closed_at, this is that reading as an ISO-8601 UTC string, not clamped: a
   * close time in the future stays on the check. When it does not, it is the
   * value exactly as the till sent it, or null when there is none. ingest()
   * stores only the null: it refuses a check whose closed_at is present and
   * not read, so no such value reaches Postgres (ADR 0281, founder ruling F4).
   */
  closedAt: unknown;
  /**
   * What `p_occurred_at`, `recorded_at` and `created_at` receive, always an
   * ISO-8601 UTC string: the same string as `closedAt` when that is a reading
   * not in the future, otherwise import time. Postgres reads a UTC string as
   * the same instant whatever its session's time zone, so when the two are
   * the same string, the check and its consumption rows carry one instant.
   * The ledger rows carry it too unless the database's clock runs behind the
   * gateway's: they take the earlier of it and the database's now().
   */
  at: string;
  /**
   * `readClosedAt` did not read closed_at (or there is none), so `at` is
   * import time while `closedAt` keeps the till's value. `backdatedOver72h` is
   * false whenever this is true. In ingest() it covers two cases only, and
   * neither dates anything at import time: an open check (closed_at null or
   * absent), which moves no stock, and a present closed_at that is not read,
   * whose check is refused before it is stored.
   */
  fellBack: boolean;
  /** closed_at was later than now, so `at` is now and `closedAt` is not. */
  clamped: boolean;
  /** closed_at is more than BACKDATED_AFTER_MS before now (exactly 72h is not). */
  backdatedOver72h: boolean;
}

/**
 * The one closed_at shape the import reads (ADR 0281): an ISO-8601 calendar
 * date in extended form (`YYYY-MM-DD`), optionally followed by `T` or one
 * space and a time `hh:mm`, `hh:mm:ss` or `hh:mm:ss.f` (1 to 9 fraction
 * digits, kept to the millisecond), optionally followed by `Z` or a numeric
 * offset `±hh`, `±hhmm` or `±hh:mm`. A zone needs a time. RFC 2822 is not in
 * it (ADR 0281 says why).
 */
const ISO_CLOSED_AT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

/** The widest real UTC offset, +14:00; an offset or a zone reading beyond it is refused. */
const MAX_OFFSET_MS = 14 * 60 * 60 * 1000;

/**
 * Read a till's closed_at strictly, as epoch milliseconds, or NaN.
 *
 * V8's `Date.parse` reads almost anything: "12" and "Table 12" as
 * 2001-12-01, "0" as 2000-01-01, "2026-02-30" as 2 March. Postgres refused
 * all of those, so on main such a check failed loudly; read leniently, it
 * would date revenue, stock and consumption on an instant the till never
 * sent (the ADR 0090 audit of PR #603 at 1a7a4137d). So a string is read
 * only when it matches ISO_CLOSED_AT and its written date and time survive a
 * round trip through the UTC calendar unchanged: year, month and day, and
 * hour, minute and second where written. "2026-09-31", 24:00 and a leap
 * second :60 fail it. Then:
 *
 * - with `Z` or an offset, the instant is the written wall clock minus the
 *   offset, computed here; no `Date.parse`;
 * - with no offset, in a house whose zone is known, the wall clock is read on
 *   the house's clock, and a date alone is the house's midnight that opens
 *   that day (F-1601: the till writes the house's time, and a US house's
 *   daily export read as UTC midnight landed every check on the day before);
 * - with no offset in a house with no zone, a date alone is UTC midnight,
 *   which is how ECMAScript reads a date-only form, and a date and time is
 *   `Date.parse`'s reading in the gateway's own zone, kept only when it lies
 *   within 14 hours of the written wall clock.
 *
 * Anything else is NaN: saleInstant falls back, and ingest() refuses the
 * check.
 */
function readClosedAt(raw: string, houseZone: string | null): number {
  const m = ISO_CLOSED_AT.exec(raw);
  if (!m) return NaN;
  const [, yy, mo, dd, hh, mi, ss, frac, zone] = m;
  const year = Number(yy);
  const month = Number(mo);
  const day = Number(dd);
  const hour = hh === undefined ? 0 : Number(hh);
  const minute = mi === undefined ? 0 : Number(mi);
  const second = ss === undefined ? 0 : Number(ss);
  const millis =
    frac === undefined ? 0 : Number(frac.slice(0, 3).padEnd(3, "0"));
  // setUTCFullYear, not Date.UTC: Date.UTC reads a year from 0 to 99 as 19xx.
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(hour, minute, second, millis);
  if (
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() !== month - 1 ||
    wall.getUTCDate() !== day ||
    wall.getUTCHours() !== hour ||
    wall.getUTCMinutes() !== minute ||
    wall.getUTCSeconds() !== second
  ) {
    return NaN;
  }
  const wallMs = wall.getTime();
  if (zone === "Z") return wallMs;
  if (zone === undefined && houseZone) {
    // Two passes, as zonedWallClockToUtc: the offset depends on the instant.
    // The offset is read on the whole second; Intl does not format millis.
    const whole = wallMs - millis;
    let at = whole - zoneOffsetMs(new Date(whole), houseZone);
    at = whole - zoneOffsetMs(new Date(at), houseZone);
    return at + millis;
  }
  if (hh === undefined) return wallMs;
  if (zone !== undefined) {
    const digits = zone.slice(1).replace(":", "");
    const offsetMs =
      (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || "0")) *
      60 *
      1000;
    if (Number(digits.slice(2) || "0") > 59 || offsetMs > MAX_OFFSET_MS) {
      return NaN;
    }
    return zone[0] === "-" ? wallMs + offsetMs : wallMs - offsetMs;
  }
  const local = Date.parse(raw);
  return Number.isFinite(local) && Math.abs(wallMs - local) <= MAX_OFFSET_MS
    ? local
    : NaN;
}

/** True when closed_at is a date, or a date and time, written with no offset. */
function closedAtHasNoOffset(closedAt: unknown): boolean {
  if (typeof closedAt !== "string") return false;
  const m = ISO_CLOSED_AT.exec(closedAt.trim());
  return m !== null && m[8] === undefined;
}

/**
 * Date a closed check's stock by when it closed, not by when it arrived.
 *
 * The string is read once, here, by readClosedAt, and only the result
 * travels. Handing a string the gateway has read to Postgres as well would
 * have it read a second time, and where the two readings differ (a zone-less
 * string when the gateway's zone and the database session's differ; measured
 * in the ADR 0090 audit of PR #603 at 01ac04eaa) the ledger, the consumption
 * row and the check could land on different days. So a zone-less string is
 * read in one zone for all of them: the house's when it is known (F-1601),
 * else the gateway's own. A value readClosedAt does not read (a dotted or slashed date such as "03.10.2026" or
 * "10/03/2026 3:00 PM", a two-digit year such as "1/1/50", a POSIX-looking
 * "UTC+3", RFC 2822, "12", "2026-02-30", a number) falls back here, and
 * ingest() refuses its check: the founder ruled that such a date is not
 * imported rather than guessed at (ADR 0281, F4).
 *
 * Pure, so the boundaries are tested without a database. `nowMs` is the
 * import's clock, read once per check. `houseZone` reads a closed_at written
 * with no offset on the house's clock (F-1601); null keeps the reading above.
 */
export function saleInstant(
  closedAt: unknown,
  nowMs: number,
  houseZone: string | null = null,
): SaleInstant {
  const raw = typeof closedAt === "string" ? closedAt.trim() : "";
  const parsed = raw ? readClosedAt(raw, houseZone) : NaN;
  const importTime = new Date(nowMs).toISOString();
  if (!Number.isFinite(parsed)) {
    return {
      closedAt: closedAt ?? null,
      at: importTime,
      fellBack: true,
      clamped: false,
      backdatedOver72h: false,
    };
  }
  const read = new Date(parsed).toISOString();
  if (parsed > nowMs) {
    return {
      closedAt: read,
      at: importTime,
      fellBack: false,
      clamped: true,
      backdatedOver72h: false,
    };
  }
  return {
    closedAt: read,
    at: read,
    fellBack: false,
    clamped: false,
    backdatedOver72h: nowMs - parsed > BACKDATED_AFTER_MS,
  };
}

/**
 * What errors[] says about a check refused for its closed_at, worded as the
 * option the founder picked in ADR 0281's fork F4 ("Refuse, say why").
 */
const CLOSED_AT_NOT_READABLE =
  "date not readable — write it as 2026-10-03 21:00";

/**
 * At most this many refused checks are named in errors[]; the rest are one
 * line that counts them. An export written in one such format is refused
 * check by check, so 800 of its checks are said in 51 lines, not 800.
 */
const MAX_REFUSED_CHECK_LINES = 50;

/** The till's closed_at as errors[] quotes it: JSON, cut at 80 characters. */
function quoteClosedAt(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/**
 * What one import did to stock, line by line (ADR 0281). The counters
 * partition `lines`: every line counted there lands in exactly one of
 * notStock, booked, alreadyBooked, queued.* or failed.
 * `consumptionNotWritten` and `backdatedOver72h` are sub-counts of the lines
 * that moved stock; `alreadyCounted` is a sub-count of alreadyBooked.
 */
export interface StockTally {
  /**
   * Every line on a closed check this import stored. A check whose
   * pos_checks upsert failed (or whose stock step threw before reading its
   * lines) moves no stock and is not counted here; its own errors[] line
   * names it. Nor is a check refused for its closed_at, which is never
   * stored (`refusedUnreadableDate` counts it).
   */
  lines: number;
  /**
   * Lines with nothing to move by design: not a stock line (kept on
   * pos_checks.items for the analytics that read it), a quantity of zero or
   * less, or a voided line whose sale this hub never booked (F-393; errors[]
   * names those).
   */
  notStock: number;
  /**
   * Stock moved by this import: a sale depleted, or a void returned. A void
   * replayed is counted here too: apply_stock_movement answers a known key
   * with the existing transaction, exactly as it answers a new one.
   */
  booked: number;
  /** A replay: an earlier import already moved this line's stock. */
  alreadyBooked: number;
  /**
   * F-1433, of alreadyBooked: sold before the item's last count of every
   * shelf, and reached the hub after it (a nightly export, a till that synced
   * late). The count already holds the sale, so no stock moved; the sale's
   * consumption row is written, and errors[] names the item and the count.
   */
  alreadyCounted: number;
  /** Lines in pos_unresolved_lines, by the reason written there. */
  queued: { unmapped: number; no_sale_volume: number };
  /**
   * Moved no stock AND are not in the review queue: the stock write was
   * refused or threw, or the queue insert failed. errors[] names them.
   */
  failed: number;
  /** Stock moved, but its wine_consumption_log row did not land. */
  consumptionNotWritten: number;
  /** Lines this import booked whose check closed more than 72 hours ago. */
  backdatedOver72h: number;
}

type StockFailureKind =
  | "stock"
  | "queue"
  | "consumption"
  | "neverTaken"
  | "alreadyCounted";

/**
 * The import report a check's stock effects count into (ADR 0281), keyed by
 * the check object, so two imports running at once never share one. Module
 * scope rather than an instance field, so a service built without its
 * constructor (as several specs build it) still has it.
 */
const STOCK_REPORTS = new WeakMap<object, StockReport>();
/**
 * F-639. NEWER_THAN_VOID: checks the till says are newer than the stored
 * void. AFTER_VOID: checks applyStockEffects did not move because this hub
 * already returned their stock for a void and nothing says the copy is newer
 * (a till's late retry of the "closed" event).
 */
const NEWER_THAN_VOID = new WeakSet<object>();
const AFTER_VOID = new WeakSet<object>();

/** Lines that reached an outcome; the rest of a check's lines are notStock. */
function decidedLines(t: StockTally): number {
  return (
    t.booked +
    t.alreadyBooked +
    t.queued.unmapped +
    t.queued.no_sale_volume +
    t.failed
  );
}

/**
 * One wine line of a closed check, resolved to what it takes (sim wave 8).
 * Exactly one of `bottles` (a whole-bottle move) or `pours` x `pourMl` (a draw
 * through record_glass_pour) is set. `part` marks a fractional quantity
 * carried as ml (F-394): a split check's half bottle, or a third of one.
 */
interface PlannedStockLine {
  it: {
    name: string;
    external_item_id: string | null;
    qty: number;
    price: number | null;
    inventory_id: string | null;
    /** F-1329: a cocktail's recipe line; its till price is the cocktail's. */
    ingredient?: boolean;
  };
  inventoryId: string;
  idem: string;
  label: string;
  inv: InventoryVolumes | null;
  qty: number;
  bottles: number;
  pours: number;
  pourMl: number;
  part: boolean;
  consumed: ResolvedSaleVolume;
  consumedQty: number;
}

/**
 * What earlier imports of one check moved, per inventory item (F-393/F-395).
 * Read from the stock writes themselves: `inventory_transactions` rows keyed
 * under the check (whole bottles; record_glass_pour's own ledger row carries
 * no key) and `pour_events` rows keyed under it (ml).
 */
interface CheckLedger {
  /** No keyed stock row exists for this check: its first import. */
  empty: boolean;
  /** Whole bottles taken net (sales minus returns), per item. */
  bottles: Map<string, number>;
  /** Ml poured and not voided, per item. */
  ml: Map<string, number>;
  /** Keyed rows of either kind, per item: names the next correction's key. */
  rows: Map<string, number>;
  /** Keys of the pours booked for this check. */
  pourKeys: Set<string>;
  /** Pour keys whose B19 whole-bottle void return is already booked. */
  glassVoided: Set<string>;
  /**
   * What each key booked: bottles for a stock row, ml for a pour. A line
   * whose own key booked exactly what it asks for now is unchanged, so its
   * consumption row belongs under that key and a replay may write it.
   */
  byKey: Map<string, number>;
  /** F-639: a void of this check has returned stock (a `:void` key). */
  voidBooked: boolean;
  /**
   * F-1197: items a correction took bottles back from (a `:bottles:` key
   * that returned stock). Their consumption rows were marked reversed and
   * one row of what the check still holds was written, so a line's own key
   * no longer stands for its sale and a replay must not write it.
   */
  cutBack: Set<string>;
  /**
   * F-1241: per item, the key of its latest `:bottles:` correction, when that
   * correction took bottles back. A replay retries its mark and its row of
   * what stands, both idempotent, in case they failed after the stock moved.
   */
  lastCut: Map<string, string>;
}

/**
 * F-1195: the tills a file import can backfill: every feed with an adapter
 * but the import itself. A check is stored only through an adapter, so these
 * are every source a house's checks can carry.
 */
const IMPORT_TILLS = Object.keys(ADAPTERS).filter((k) => k !== "csv_import");

/**
 * F-1329: how a till line's name is compared with a cocktail's: trimmed, one
 * space between words, case folded, and the Turkish dotted and dotless i read
 * as one letter, so "SPRITZ" and "Spritz" and "RAKI" and "Rakı" are each one
 * name. Exact after that; nothing fuzzier names a recipe.
 */
function cocktailNameKey(name: string | null | undefined): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[ıİI]/g, "i")
    .toLowerCase();
}

/** F-1329: one linked line of a cocktail's recipe, as the till takes it. */
interface RecipeStockLine {
  inventoryId: string;
  freeText: string | null;
  quantity: unknown;
  unit: unknown;
}

/** Every stock key of a check begins with this (B15). */
function checkLedgerPrefix(source: string, externalCheckId: string): string {
  return `pos:${source}:${externalCheckId}:`;
}

/** Said when a till takes back a pour that was already poured. */
const POURED_CANNOT_RETURN =
  "the till took back a glass or part of a bottle that was already poured; a poured glass cannot be put back on the shelf automatically, so count this bottle and correct its stock by hand";

/** At most this many grouped stock lines reach errors[]; the rest are summed into one. */
const MAX_STOCK_ERROR_GROUPS = 50;
const MAX_STOCK_ERROR_MESSAGE = 300;

/**
 * Accumulates the stock half of one import: the tally, and the failures
 * grouped by (kind, item) so errors[] carries one line per group rather than
 * one per line — a back-fill with 800 refused pours of one wine is one line
 * with a count, not 800 (ADR 0281).
 */
export class StockReport {
  readonly tally: StockTally = {
    lines: 0,
    notStock: 0,
    booked: 0,
    alreadyBooked: 0,
    alreadyCounted: 0,
    queued: { unmapped: 0, no_sale_volume: 0 },
    failed: 0,
    consumptionNotWritten: 0,
    backdatedOver72h: 0,
  };

  private readonly groups = new Map<
    string,
    {
      kind: StockFailureKind;
      label: string;
      count: number;
      message: string;
      checkId: string;
    }
  >();
  private overflowLines = 0;
  private readonly overflowKeys = new Set<string>();
  /**
   * F-1436: the items a person must count by hand (a poured glass the till
   * took back), each with the first check that asked. errors[] reaches only
   * the caller, and a webhook has none, so ingest() rings the house as well.
   */
  readonly needsCount = new Map<string, string>();

  askForCount(label: string, checkId: string): void {
    if (!this.needsCount.has(label)) this.needsCount.set(label, checkId);
  }

  noteFailure(
    kind: StockFailureKind,
    label: string,
    message: string | null | undefined,
    checkId: string,
  ): void {
    const key = `${kind}\u0000${label}`;
    const group = this.groups.get(key);
    if (group) {
      group.count++;
      return;
    }
    if (this.groups.size >= MAX_STOCK_ERROR_GROUPS) {
      this.overflowLines++;
      this.overflowKeys.add(key);
      return;
    }
    const text = String(message ?? "no message")
      .replace(/\s+/g, " ")
      .trim();
    this.groups.set(key, {
      kind,
      label,
      count: 1,
      message:
        text.length > MAX_STOCK_ERROR_MESSAGE
          ? `${text.slice(0, MAX_STOCK_ERROR_MESSAGE)}…`
          : text,
      checkId,
    });
  }

  /** One sentence per group, in the order the groups were first seen. */
  errorLines(): string[] {
    const out: string[] = [];
    for (const g of this.groups.values()) {
      const lines = `${g.count} line${g.count === 1 ? "" : "s"}`;
      switch (g.kind) {
        case "stock":
          out.push(
            `stock: "${g.label}" moved no stock on ${lines} and is not in the review queue: ${g.message} (first on check ${g.checkId})`,
          );
          break;
        case "queue":
          out.push(
            `stock: "${g.label}" moved no stock on ${lines} and could not be queued for review: ${g.message} (first on check ${g.checkId})`,
          );
          break;
        case "consumption":
          out.push(
            `stock: "${g.label}" moved stock on ${lines} but its consumption log row was not written: ${g.message} (first on check ${g.checkId})`,
          );
          break;
        case "neverTaken":
          // F-393: not a failure, but said, because a void that returns
          // nothing looks like one to a person comparing the till with stock.
          out.push(
            `stock: "${g.label}" was voided on ${lines} before this hub booked its sale, so no stock was taken and none was returned (first on check ${g.checkId})`,
          );
          break;
        case "alreadyCounted":
          // F-1433: not a failure either; the message is the count's time.
          out.push(
            `stock: "${g.label}" was sold on ${lines} before the count of ${g.message}, so that count already holds it and no stock was taken again; the sale is kept (first on check ${g.checkId})`,
          );
          break;
      }
    }
    if (this.overflowLines > 0) {
      out.push(
        `stock: ${this.overflowLines} more failure${this.overflowLines === 1 ? "" : "s"} across ${this.overflowKeys.size} more item${this.overflowKeys.size === 1 ? "" : "s"} are counted in stock but not listed here`,
      );
    }
    return out;
  }
}

/**
 * How much stock one sale of a POS item removes (ADR 0011).
 *
 * `whole_bottle` is a unit move on `apply_stock_movement`; `volume` is an
 * arbitrary ml draw routed through `record_glass_pour`'s `p_pour_ml`. There is
 * deliberately no "assume a bottle" arm — an unresolvable line resolves to
 * `unresolved` and is queued.
 *
 * Discriminated on `mode` rather than an `ok` boolean: this package compiles
 * with `strictNullChecks: false` (tsconfig.json), under which boolean literal
 * discriminants do not narrow.
 */
export type SaleVolume =
  | { mode: "whole_bottle" }
  | { mode: "volume"; ml: number }
  | { mode: "unresolved"; reason: string };

/** A sale volume that resolved — i.e. one that may touch stock. */
export type ResolvedSaleVolume = Exclude<SaleVolume, { mode: "unresolved" }>;

/**
 * Resolve one line's depletion, in the order locked by ADR 0011:
 * `sale_volume_ml` → `sale_unit` + the inventory row → fail closed.
 *
 * Pure and exported so the Toast door (`toast.service.ts:502`, which still
 * carries its own `?? "bottle"`) can adopt the same contract without a second
 * implementation of it, and so the resolution can be tested without a database.
 */
export function resolveSaleVolume(
  saleVolumeMl: number | null | undefined,
  saleUnit: string | null | undefined,
  inv: InventoryVolumes | null,
): SaleVolume {
  const label =
    typeof saleUnit === "string" ? saleUnit.trim().toLowerCase() : null;

  // 1. An explicit volume is the truth and outranks the label. A mapping that
  //    says "glass" and "60ml" sells a 60ml taster, not a 150ml pour.
  if (saleVolumeMl !== null && saleVolumeMl !== undefined) {
    const ml = Number(saleVolumeMl);
    if (!Number.isFinite(ml) || ml < MIN_PLAUSIBLE_SALE_ML) {
      return {
        mode: "unresolved",
        reason: `sale_volume_ml ${saleVolumeMl} is not a usable volume`,
      };
    }
    // A pour is taken out of ONE container. Asking for more than the container
    // holds drives inventory_lots.open_bottle_ml negative rather than failing —
    // silent lot corruption, which is worse than the under-depletion we accept
    // everywhere else here. Queue it instead: the mapping points at the wrong
    // inventory row.
    const capacity = inv?.bottleMl ?? RPC_DEFAULT_BOTTLE_ML;
    if (ml > capacity) {
      return {
        mode: "unresolved",
        reason: `sale_volume_ml ${ml} exceeds the ${capacity}ml container it pours from`,
      };
    }
    // Selling exactly one container IS a whole-bottle sale, so it books as one
    // rather than as a pour that happens to empty a bottle.
    if (inv?.bottleMl != null && ml === inv.bottleMl)
      return { mode: "whole_bottle" };
    return { mode: "volume", ml };
  }

  // 2. Derive from the label. Only these two carry a derivation; every other
  //    label is a reporting word with no arithmetic attached to it.
  if (label === "bottle") {
    // Deliberately does not consult the inventory row: bottle_size_ml is
    // nullable in production and a unit move never needed it.
    return { mode: "whole_bottle" };
  }
  if (label === "glass") {
    if (inv?.pourMl == null) {
      return {
        mode: "unresolved",
        reason:
          "sale_unit 'glass' but the inventory row carries no pour_size_ml",
      };
    }
    return { mode: "volume", ml: inv.pourMl };
  }

  // 3. Fail closed. This is where the 92 production mappings land.
  return {
    mode: "unresolved",
    reason: label
      ? `sale_unit '${label}' carries no volume — set sale_volume_ml`
      : "neither sale_volume_ml nor a derivable sale_unit",
  };
}

/**
 * Which rung of the secret chain authenticated a webhook. Ordered most
 * specific first; `legacy_global` is the pre-existing process-wide key and is
 * the only rung that is NOT bound to a provider or a tenant.
 */
export type WebhookSecretSource =
  | "per_connection"
  | "per_provider"
  | "legacy_global";

export interface ResolvedWebhookSecret {
  secret: string;
  source: WebhookSecretSource;
  envVar: string;
}

/** Env-var-safe token: `generic_webhook` -> `GENERIC_WEBHOOK`. */
function envToken(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
}

/**
 * The two scoped env vars a (provider, restaurant) pair may be keyed by.
 * Exported so operators and tests name them from one place rather than
 * re-deriving the string. `__` separates the two tokens because provider keys
 * themselves contain `_` (`ncr_aloha`), and a single separator would make
 * `POS_WEBHOOK_SECRET_NCR_ALOHA` ambiguous.
 */
export function webhookSecretEnvVars(
  providerKey: string,
  restaurantId: string,
): { perConnection: string; perProvider: string } {
  const provider = envToken(providerKey);
  return {
    perConnection: `POS_WEBHOOK_SECRET_${provider}__${envToken(restaurantId)}`,
    perProvider: `POS_WEBHOOK_SECRET_${provider}`,
  };
}

/**
 * The message a scoped signature covers.
 *
 * The provider and the restaurant are inside the signed bytes, not merely
 * beside them, so one provider-wide secret still cannot mint a signature that
 * authenticates a different tenant's payload — the same reason Toast signs
 * `timestamp.body` rather than `body` (toast.service.ts:152).
 */
function scopedSignedPayload(
  providerKey: string,
  restaurantId: string,
  rawBody: Buffer | string,
  timestamp: string,
): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  return `${timestamp}.${providerKey}:${restaurantId}.${body}`;
}

/**
 * F-639: how far a signed webhook's timestamp may sit from now, either way.
 * A signature with no time in it authenticated a captured body forever, so a
 * replayed old copy of a check could be re-sent at will.
 */
export const WEBHOOK_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * A webhook timestamp read strictly: epoch seconds or milliseconds (digits
 * only), or ISO text. Anything else is null, and the webhook is refused.
 */
export function readWebhookTimestamp(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const s = raw.trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    // Ten digits is seconds until the year 2286; more is milliseconds.
    return s.length <= 10 ? n * 1000 : n;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function webhookTimestampIsFresh(
  raw: unknown,
  nowMs: number = Date.now(),
): boolean {
  const t = readWebhookTimestamp(raw);
  return t !== null && Math.abs(nowMs - t) <= WEBHOOK_FRESHNESS_MS;
}

/** What the hub holds for a check, read before a new copy is stored. */
export interface StoredCheckCopy {
  voided: boolean | null;
  closed_at: string | null;
  source_version: number | string | null;
  source_modified_at: string | null;
  /** F-1624: what the copy was written with (absent from an older read). */
  subtotal?: number | string | null;
  gross_subtotal?: number | string | null;
  tax_basis?: string | null;
}

/**
 * F-639: whether an incoming copy of a check must not replace the stored
 * one. It is older (by the till's version when both carry one, else by its
 * modified-at when both carry one), or it is not known to be newer and would
 * un-void the check or re-open it. The same rule as the pos_checks trigger
 * pos_checks_keep_newest (migration a_check_keeps_its_newest_version).
 */
export function copyIsStale(
  stored: StoredCheckCopy | null,
  incoming: {
    voided: boolean;
    closedAt: string | null;
    sourceVersion?: number | null;
    sourceModifiedAt?: string | null;
  },
): "older" | "would_undo" | null {
  if (!stored) return null;
  let newer: boolean | null = null;
  const storedVersion =
    stored.source_version == null ? null : Number(stored.source_version);
  const storedModified =
    stored.source_modified_at == null
      ? null
      : Date.parse(stored.source_modified_at);
  const incomingModified =
    incoming.sourceModifiedAt == null
      ? null
      : Date.parse(incoming.sourceModifiedAt);
  if (
    incoming.sourceVersion != null &&
    storedVersion != null &&
    Number.isFinite(storedVersion)
  ) {
    if (incoming.sourceVersion < storedVersion) return "older";
    newer = incoming.sourceVersion > storedVersion;
  } else if (
    incomingModified != null &&
    Number.isFinite(incomingModified) &&
    storedModified != null &&
    Number.isFinite(storedModified)
  ) {
    if (incomingModified < storedModified) return "older";
    newer = incomingModified > storedModified;
  }
  if (newer !== true) {
    if (stored.voided === true && !incoming.voided) return "would_undo";
    if (stored.closed_at != null && incoming.closedAt == null)
      return "would_undo";
  }
  return null;
}

/**
 * F-640: POS category words that say a line is food. An unmapped line is
 * queued for review unless its category says food: a drink the hub has no
 * word for is asked about, never dropped. Matched as whole words.
 */
const FOOD_CATEGORY_WORDS = new Set([
  "food",
  "foods",
  "kitchen",
  "starter",
  "starters",
  "appetizer",
  "appetizers",
  "appetiser",
  "appetisers",
  "meze",
  "mezze",
  "main",
  "mains",
  "entree",
  "entrees",
  "entrée",
  "entrées",
  "dessert",
  "desserts",
  "salad",
  "salads",
  "soup",
  "soups",
  "side",
  "sides",
  "grill",
  "pizza",
  "pasta",
  "burger",
  "burgers",
  "sandwich",
  "sandwiches",
  "breakfast",
  "brunch",
  "yemek",
  "yemekler",
  "tatlı",
  "tatlılar",
  "salata",
  "çorba",
  "kahvaltı",
  "başlangıç",
  "başlangıçlar",
  "ızgara",
]);

export function categoryIsFood(category: string | null | undefined): boolean {
  if (!category) return false;
  // Both lower-casings: "KITCHEN" is "kitchen", and "TATLI" is "tatlı" only
  // the Turkish way.
  return [category.toLowerCase(), category.toLocaleLowerCase("tr")].some(
    (lower) =>
      lower.split(/[^\p{L}]+/u).some((w) => FOOD_CATEGORY_WORDS.has(w)),
  );
}

/** Identity the webhook route claims, and which this must bind the key to. */
export interface WebhookContext {
  provider: string;
  restaurantId: string;
}

/**
 * How many checks received in one import named each channel (ADR 0302). It
 * is counted before any check is stored, so a check refused for its closed_at
 * or whose upsert failed is counted too, and the four counts partition
 * `received`: `none` is a check that named no channel the hub reads (every
 * Square, Clover or Toast check: see CANONICAL_FEEDS), `unrecognised` one
 * that named a value outside the vocabulary. Neither writes a channel: a new
 * row is stored with none, which reads as table service, and a re-send leaves
 * the stored channel as it was.
 */
export type ChannelTally = Record<
  CheckChannel | "none" | "unrecognised",
  number
>;

/** At most this many distinct unrecognised names are quoted in errors[]. */
const MAX_CHANNEL_NAMES_SAID = 5;

/**
 * Said, unquoted, in place of a named channel that is not a string. The
 * vocabulary is strings only (checkChannelOf), so any other JSON value is
 * unrecognised, and it is never converted to text to quote it: `String()` on
 * `{"toString":1}` or a deeply nested array throws, and the tally runs before
 * the per-check try, so one such check aborted the whole import (ADR 0302,
 * audit at 28c59e9f8).
 */
const CHANNEL_NOT_TEXT_SAID = "a value that is not text";

/**
 * The providers whose `raw` is the canonical row itself (the generic adapter,
 * under both keys), so a `raw.channel` there is a channel the feed named. A
 * Square, Clover or Toast `raw` is that provider's own order or check object:
 * whether any of them carries a top-level `channel`, and what it would mean,
 * is not verified, and their order types wait for the owner's mapping (ADR
 * 0302, fork AW24-b). Their checks name no channel here.
 */
const CANONICAL_FEEDS: ReadonlySet<string> = new Set([
  "generic_webhook",
  "csv_import",
]);

/**
 * Count the channels an import named, and say the ones this hub does not
 * know. On a canonical feed, a name the adapter dropped is read back from the
 * source row (`raw.channel`, which that feed keeps verbatim): reading it as
 * "no channel" would report an absence as health (ADR 0302).
 */
export function tallyChannels(
  checks: CanonicalCheck[],
  providerKey: string,
): {
  tally: ChannelTally;
  said: string | null;
} {
  const tally: ChannelTally = {
    booth_event: 0,
    table: 0,
    none: 0,
    unrecognised: 0,
  };
  const readsNamed = CANONICAL_FEEDS.has(providerKey);
  const names = new Set<string>();
  let namedNotText = false;
  for (const c of checks) {
    if (c.channel) {
      tally[c.channel]++;
      continue;
    }
    const named = readsNamed
      ? (c.raw as { channel?: unknown } | null | undefined)?.channel
      : null;
    if (named == null || (typeof named === "string" && named.trim() === "")) {
      tally.none++;
      continue;
    }
    tally.unrecognised++;
    if (typeof named === "string") names.add(named.trim().slice(0, 40));
    else namedNotText = true;
  }
  if (tally.unrecognised === 0) return { tally, said: null };
  const n = tally.unrecognised;
  const shown = [...names].map((v) => JSON.stringify(v));
  if (namedNotText) shown.push(CHANNEL_NOT_TEXT_SAID);
  const quoted = shown.slice(0, MAX_CHANNEL_NAMES_SAID).join(", ");
  const more =
    shown.length > MAX_CHANNEL_NAMES_SAID
      ? ` and ${shown.length - MAX_CHANNEL_NAMES_SAID} more`
      : "";
  return {
    tally,
    said:
      `channel: ${n} check${n === 1 ? "" : "s"} named a channel this hub does not know ` +
      `(${quoted}${more}): counted as unrecognised and not written as a channel. ` +
      `A check with no stored channel reads as table service; the known channels are "table" and "booth_event".`,
  };
}

/**
 * PosHubService — the unified ingestion pipeline and the single POS door for
 * stock writes (SimPOS testbed plan, decision B13).
 *
 * raw payload → adapter.normalize() → wine mapping (pos_item_mappings →
 * keyword heuristic) → table/server resolution → UPSERT pos_checks → stock
 * depletion via apply_stock_movement/record_glass_pour for closed checks only
 * (decision B18). Idempotent on (restaurant_id, source, external_check_id)
 * for the check row, and on `pos:{source}:{externalCheckId}:{externalItemId}
 * :{lineNo}` (decision B15) for the first import of a check's stock, so webhook
 * replays and re-imports are safe. Every later import of the same check is
 * compared with the stock rows keyed under it and moves only the difference
 * (sim wave 8): a corrected or voided check corrects stock, and a void never
 * returns what was never taken.
 */
@Injectable()
export class PosHubService {
  private readonly logger = new Logger(PosHubService.name);

  /**
   * Which (source, provider, restaurant) triples have already been logged, so
   * a route that takes production webhook volume states its key resolution
   * once rather than on every request. Bounded: `restaurantId` comes off an
   * unauthenticated path, so an attacker could otherwise grow this set without
   * limit by varying it.
   */
  private readonly loggedSecretResolutions = new Set<string>();
  private static readonly MAX_LOGGED_RESOLUTIONS = 500;

  // Multilingual wine keywords (incl. Turkish şarap) for the fallback
  // heuristic when no pos_item_mappings row exists yet.
  private static readonly WINE_WORDS = [
    "wine",
    "vino",
    "şarap",
    "sarap",
    "rosé",
    "rose ",
    "champagne",
    "prosecco",
    "cava",
    "brut",
    "chardonnay",
    "sauvignon",
    "riesling",
    "pinot",
    "merlot",
    "cabernet",
    "syrah",
    "shiraz",
    "malbec",
    "tempranillo",
    "nebbiolo",
    "sangiovese",
    "grenache",
    "zinfandel",
    "chianti",
    "bordeaux",
    "burgundy",
    "rioja",
    "barolo",
    // F-640: Turkish grapes, by their Turkish and their ASCII spellings.
    "öküzgözü",
    "okuzgozu",
    "boğazkere",
    "bogazkere",
    "narince",
    "kalecik",
    "sultaniye",
    "çalkarası",
    "calkarasi",
  ];

  // F-640: beer, rakı and spirits. Matched as whole words, unlike the wine
  // words above: "ale" is in "kale" and "rum" in "crumble".
  private static readonly DRINK_WORDS = new Set([
    "beer",
    "bira",
    "efes",
    "draft",
    "draught",
    "lager",
    "ale",
    "ipa",
    "pilsner",
    "stout",
    "rakı",
    "raki",
    "whisky",
    "whiskey",
    "viski",
    "bourbon",
    "vodka",
    "votka",
    "gin",
    "rum",
    "tequila",
    "mezcal",
    "cognac",
    "konyak",
    "brandy",
    "liqueur",
    "likör",
    "vermouth",
    "aperol",
    "campari",
    "ouzo",
    "sake",
    "cider",
  ]);

  constructor(
    private readonly dbService: DatabaseService,
    // Optional so the hub still boots (and ingests) if the notifications
    // module is unavailable — alerting is a side effect of depletion, never a
    // precondition for it.
    @Optional()
    @Inject(forwardRef(() => LowStockAlertsService))
    private readonly lowStockAlerts?: LowStockAlertsService,
    // ADR 0281 (amended 2026-10-05): refused checks reach the owners' and
    // managers' bell. Optional for the same reason: the note is a side effect
    // of an import, never a precondition for it.
    @Optional()
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications?: NotificationsService,
    // ADR 0218: Away applies to that note. Database only, so no cycle.
    @Optional()
    private readonly areaRouting?: AreaRoutingService,
  ) {}

  getProviders() {
    return { summary: registrySummary(), providers: POS_PROVIDERS };
  }

  // =========================================================================
  // Webhook auth (decision B17: the hub had no auth guard at all; decision
  // B28: SimPOS signs with a real HMAC secret so this path stays exercised)
  // =========================================================================

  /** Log a key-resolution outcome once per (source, provider, restaurant). */
  private logSecretResolutionOnce(key: string, emit: () => void): void {
    if (this.loggedSecretResolutions.has(key)) return;
    // Overflow clears rather than stops deduping: memory stays bounded and the
    // route keeps reporting, at the cost of repeating a line after 500 pairs.
    if (
      this.loggedSecretResolutions.size >= PosHubService.MAX_LOGGED_RESOLUTIONS
    ) {
      this.loggedSecretResolutions.clear();
    }
    this.loggedSecretResolutions.add(key);
    emit();
  }

  /**
   * Resolve the HMAC key for one (provider, restaurant), most specific first:
   *
   *   1. `POS_WEBHOOK_SECRET_<PROVIDER>__<RESTAURANT_ID>` — per connection.
   *   2. `POS_WEBHOOK_SECRET_<PROVIDER>`                  — per provider.
   *   3. `POS_HUB_WEBHOOK_SECRET`                         — legacy, global.
   *
   * The first rung that is SET wins; a rung being set is therefore the cutover
   * switch for everything below it. Configuring (1) or (2) for a provider
   * stops the legacy global key from authenticating that provider at all —
   * deliberate, because a fallback that runs after a scoped signature fails is
   * not a fallback, it is the hole still being open.
   *
   * Returns null when nothing is configured. Callers must reject on null.
   */
  private resolveWebhookSecret(
    providerKey: string,
    restaurantId: string,
  ): ResolvedWebhookSecret | null {
    const { perConnection, perProvider } = webhookSecretEnvVars(
      providerKey,
      restaurantId,
    );

    const rungs: Array<{ source: WebhookSecretSource; envVar: string }> = [
      { source: "per_connection", envVar: perConnection },
      { source: "per_provider", envVar: perProvider },
      { source: "legacy_global", envVar: "POS_HUB_WEBHOOK_SECRET" },
    ];

    for (const rung of rungs) {
      const secret = process.env[rung.envVar];
      if (!secret) continue;
      const logKey = `${rung.source}:${providerKey}:${restaurantId}`;
      this.logSecretResolutionOnce(logKey, () => {
        if (rung.source === "legacy_global") {
          this.logger.warn(
            `POS webhook [${providerKey}] r=${restaurantId} is authenticating with the ` +
              `legacy process-wide POS_HUB_WEBHOOK_SECRET, which is shared by every ` +
              `provider and every tenant. Set ${perProvider} (or ${perConnection}) to ` +
              `bind this door to one provider and one restaurant.`,
          );
        } else {
          this.logger.log(
            `POS webhook [${providerKey}] r=${restaurantId} keyed by ${rung.envVar} (${rung.source})`,
          );
        }
      });
      return { secret, source: rung.source, envVar: rung.envVar };
    }

    return null;
  }

  /**
   * Verify an inbound webhook's HMAC-SHA256 signature.
   *
   * Fails closed on every path: an unknown provider, a blank context, a
   * missing signature or body, and — decision B16's posture — no configured
   * secret all reject. There is no arm that returns true without a key.
   *
   * The signature is bound to the identity the URL claims. A scoped key signs
   * `"<timestamp>.<provider>:<restaurantId>." + rawBody` (the timestamp
   * since F-639, sent in X-Pos-Hub-Timestamp), so a signature minted for one
   * tenant does not authenticate another's payload even when both sit behind
   * the same provider-wide secret. Before this, one process-wide key covered
   * all 27 providers and every restaurant while the route read `restaurantId`
   * straight out of the path and never bound it to anything — so a signature
   * valid for restaurant A was valid for restaurant B's URL, and holding the
   * secret meant stock writes for any tenant (POS-BRIDGE-AUDIT.md §2.4, OD-B).
   *
   * The legacy global key keeps its original unscoped scheme (HMAC over the
   * raw body alone) so today's signers — SimPOS `sendSignedWebhook`
   * (simpos.service.ts:490) and `scripts/simulate/bridge.py` — keep working
   * until a scoped secret is configured. Every acceptance on that rung is
   * logged as the open door it is.
   */
  verifyWebhookSignature(
    rawBody: Buffer | string | undefined,
    signature: string | null | undefined,
    context: WebhookContext,
    /** X-Pos-Hub-Timestamp: required, and signed over, on a scoped secret. */
    timestamp?: string | null,
  ): boolean {
    const providerKey = context?.provider?.trim();
    const restaurantId = context?.restaurantId?.trim();
    if (!providerKey || !restaurantId) {
      this.logger.error(
        "POS webhook rejected: signature verification requires a provider and a restaurant to key on",
      );
      return false;
    }

    // An unrecognized provider is rejected here rather than deeper in
    // `ingest`, so an unauthenticated caller cannot probe the registry and no
    // secret is ever matched against a provider we do not serve.
    const provider = PROVIDER_BY_KEY[providerKey];
    if (!provider) {
      this.logSecretResolutionOnce(`unknown:${providerKey}`, () =>
        this.logger.error(
          `POS webhook rejected: unknown provider '${providerKey}'`,
        ),
      );
      return false;
    }

    const resolved = this.resolveWebhookSecret(providerKey, restaurantId);
    if (!resolved) {
      const { perConnection, perProvider } = webhookSecretEnvVars(
        providerKey,
        restaurantId,
      );
      this.logSecretResolutionOnce(
        `missing:${providerKey}:${restaurantId}`,
        () =>
          this.logger.error(
            `POS webhook rejected (fail closed): no secret configured for provider ` +
              `'${providerKey}'${provider.status === "available" ? " — which the registry marks AVAILABLE, so this door is advertised and shut" : ""}. ` +
              `Set ${perProvider}, ${perConnection}, or the legacy POS_HUB_WEBHOOK_SECRET.`,
          ),
      );
      return false;
    }

    if (!signature || !rawBody) return false;

    // F-639: a scoped signature covers the time it was made, and a time more
    // than WEBHOOK_FRESHNESS_MS from now is refused, so a captured body
    // cannot be re-sent later to roll a check back. The legacy global rung
    // keeps its untimed scheme for today's signers (SimPOS, bridge.py); it
    // is already logged as the open door it is.
    if (
      resolved.source !== "legacy_global" &&
      !webhookTimestampIsFresh(timestamp)
    ) {
      this.logSecretResolutionOnce(`stale:${providerKey}:${restaurantId}`, () =>
        this.logger.error(
          `POS webhook [${providerKey}] r=${restaurantId} rejected: X-Pos-Hub-Timestamp is missing, unreadable, or more than ${WEBHOOK_FRESHNESS_MS / 60000} minutes from now`,
        ),
      );
      return false;
    }

    try {
      const signedPayload =
        resolved.source === "legacy_global"
          ? rawBody
          : scopedSignedPayload(
              providerKey,
              restaurantId,
              rawBody,
              String(timestamp).trim(),
            );

      const expected = crypto
        .createHmac("sha256", resolved.secret)
        .update(signedPayload)
        .digest("hex");
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(signature.toLowerCase(), "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (err: any) {
      this.logger.error(
        `Webhook signature verification error: ${err?.message}`,
      );
      return false;
    }
  }

  // =========================================================================
  // Ingestion
  // =========================================================================

  async ingest(
    restaurantId: string,
    providerKey: string,
    payload: unknown,
  ): Promise<{
    provider: string;
    /**
     * F-1195: the source the checks were stored under: the feed's own, but
     * for a file import, the house's till it backfills (importTill).
     */
    storedUnder: string;
    received: number;
    upserted: number;
    /** Checks per channel this import named (ADR 0302). */
    channels: ChannelTally;
    wineItemsDetected: number;
    /**
     * Checks not imported because their closed_at was present and not read
     * (ADR 0281, founder ruling F4): no pos_checks row, no stock, no
     * consumption, and not counted in `upserted`, `wineItemsDetected` or
     * `stock`. errors[] names the first 50 and counts the rest. Every other
     * check received is upserted or named in errors[] as not stored.
     */
    refusedUnreadableDate: number;
    /**
     * F-639: copies of a check not imported because the hub already keeps a
     * newer one, or because they would un-void or re-open it without being
     * newer (a till's late retry). Nothing was written or moved for them.
     */
    olderCopies: number;
    errors: string[];
    /**
     * What the import did to stock (ADR 0281). Before this, a refused or
     * skipped stock write was only logged and the result read as a clean
     * import: 811 back-filled pours moved nothing with no word here (A-029).
     */
    stock: StockTally;
    /**
     * The one bell note for this import's refused checks (ADR 0281, amended
     * 2026-10-05). Null when nothing was refused, so no note was due;
     * otherwise whether it was filed, to how many bells, and why not.
     */
    bellNote: RefusedChecksNote | null;
  }> {
    const provider = PROVIDER_BY_KEY[providerKey];
    if (!provider) throw new Error(`Unknown POS provider '${providerKey}'`);
    const adapter = ADAPTERS[providerKey];
    if (!adapter)
      throw new Error(
        `Provider '${providerKey}' is ${provider.status} — no adapter yet. Use 'generic_webhook' or 'csv_import' to bridge it today.`,
      );

    const checks = adapter.normalize(payload);
    const errors: string[] = [];
    const stock = new StockReport();
    if (!checks.length)
      return {
        provider: providerKey,
        storedUnder: providerKey,
        received: 0,
        upserted: 0,
        channels: tallyChannels([], providerKey).tally,
        wineItemsDetected: 0,
        refusedUnreadableDate: 0,
        olderCopies: 0,
        errors: ["No recognizable checks in payload"],
        stock: stock.tally,
        bellNote: null,
      };

    // F-1195: the source every stored row and stock key carries. A file
    // import is stored under the house's till, so a check the till already
    // sent is one row and one booking of stock. The adapter and the channel
    // tally read the feed that carried the checks.
    const source =
      providerKey === "csv_import"
        ? ((await this.importTill(restaurantId, payload)) ?? providerKey)
        : providerKey;
    const [mappingLookup, tableLookup] = await Promise.all([
      this.loadItemMappings(restaurantId, source),
      this.loadTables(restaurantId),
    ]);
    const mappings = mappingLookup.rows;
    if (mappingLookup.error) errors.push(mappingLookup.error);
    // F-1329: the house's cocktails are read by name only when a line's
    // mapping names no cocktail; a check whose every line names one reads
    // nothing more. F-1469: a MAPPED line counts too. A button mapped onto
    // the Aperol row before its cocktail was written down ("Aperol Spritz")
    // otherwise took one Aperol serve per Spritz, never the recipe.
    const cocktailLookup = checks.some(
      (c) =>
        Array.isArray(c?.items) &&
        c.items.some(
          (it) =>
            it &&
            this.resolveWine(
              it.name,
              it.externalItemId,
              mappings,
              it.modifierIds ?? [],
            ).cocktailId === null,
        ),
    )
      ? await this.loadHouseCocktails(restaurantId)
      : { byName: new Map<string, string>(), error: null };
    if (cocktailLookup.error) errors.push(cocktailLookup.error);
    const tables = tableLookup.tables;
    // Degrade, do not reject: table resolution is an enrichment, so a failed
    // lookup must not turn into a 500 the POS retries forever. But it is SAID,
    // through the same `errors` channel a failed check upsert uses, so the
    // ingest can no longer report a clean success over a lookup that failed.
    if (tableLookup.error) errors.push(tableLookup.error);
    // ADR 0302: a channel the hub does not know is counted as unrecognised
    // and never written as a channel, and said here rather than dropped in
    // silence. A row with no stored channel reads as table service.
    const channels = tallyChannels(checks, providerKey);
    if (channels.said) errors.push(channels.said);

    let upserted = 0;
    let olderCopies = 0;
    let wineItems = 0;
    let refusedUnreadableDate = 0;
    const refusedChecks: RefusedCheck[] = [];
    const client = this.dbService.getClient();
    // F-1324: read once, and only when a file-imported check needs comparing.
    let zoneRead: Promise<string | null> | null = null;
    const houseZone = () =>
      (zoneRead ??= readHouseZone(client, restaurantId).then((z) => z.zone));
    // F-1537: the house's tax basis, read once, when the first check reaches
    // the write. An unset house is a strict no-op: its rows are written
    // exactly as before (tax-basis-resolver, rule 1).
    let taxRead: Promise<HouseTaxContextRead> | null = null;
    const houseTax = () =>
      (taxRead ??= loadHouseTaxContext(client, restaurantId));
    const netNotRecorded = new Map<string, number>();

    for (const check of checks) {
      try {
        // F-1199: Clover dates a paid order by its last change, so a tip
        // adjusted the next morning would move the sale to that day. Once a
        // closed_at is stored for the check, that first one is kept, and the
        // check is dated by it below.
        if (providerKey === "clover" && check.closedAt) {
          const stored = await this.readStoredCheck(
            restaurantId,
            providerKey,
            check.externalCheckId,
          );
          if (!stored.ok) {
            errors.push(
              `${check.externalCheckId}: not imported, the copy already kept could not be read to keep its day: ${stored.message}`,
            );
            continue;
          }
          if (stored.row?.closed_at != null)
            check.closedAt = stored.row.closed_at;
        }
        // ADR 0281: the one reading of this check's closed_at, taken before
        // the check is stored. The check row and every stock and consumption
        // row below are dated from it (see SaleInstant).
        // F-1601: a closed_at with no offset is the house's own clock, so
        // the house's zone is read for it (once per import).
        const when = saleInstant(
          check.closedAt,
          Date.now(),
          closedAtHasNoOffset(check.closedAt) ? await houseZone() : null,
        );
        // ADR 0281, founder ruling F4 ("Refuse, say why"): a closed_at that is
        // present but not read is not imported, so it is never guessed at,
        // here or by Postgres. The check is refused before anything is
        // written for it. An open check (closed_at null or absent) is stored
        // as before and moves no stock.
        if (
          when.fellBack &&
          check.closedAt !== null &&
          check.closedAt !== undefined
        ) {
          refusedUnreadableDate++;
          refusedChecks.push(check);
          if (refusedUnreadableDate <= MAX_REFUSED_CHECK_LINES) {
            errors.push(
              `${check.externalCheckId}: not imported, ${CLOSED_AT_NOT_READABLE} (closed_at was ${quoteClosedAt(check.closedAt)})`,
            );
          }
          continue;
        }
        // sim F-397: a voided flag that reads as neither yes nor no is not
        // guessed at — either guess moves stock the wrong way.
        if (check.voidedUnread !== undefined) {
          errors.push(
            `${check.externalCheckId}: not imported, voided not readable — write true or false (voided was ${quoteClosedAt(check.voidedUnread)})`,
          );
          continue;
        }
        // sim F-396: "1.250,00" or "1.350" from a Turkish till is not read as
        // nothing or as a thousandth of itself; the check is refused instead.
        if (check.moneyUnread !== undefined) {
          errors.push(
            `${check.externalCheckId}: not imported, ${check.moneyUnread.field} not readable as an amount — write it as 1250.00 (it was ${quoteClosedAt(check.moneyUnread.value)})`,
          );
          continue;
        }
        // F-1193: "0,5" or "2,000" bottles is not read as one bottle.
        if (check.qtyUnread !== undefined) {
          errors.push(
            `${check.externalCheckId}: not imported, ${check.qtyUnread.field} not readable as a quantity — write it as 2 or 0.5 (it was ${quoteClosedAt(check.qtyUnread.value)})`,
          );
          continue;
        }
        // F-1537 / F-1584: a `tax` or line tax rate that reads as neither a
        // figure nor absent is not guessed into one ("0.20" is 20 % or a fifth
        // of one). It no longer refuses the check: only an inclusive house
        // reads either, and there the resolver writes net not recorded with
        // its reason. An unset or US house stores the check exactly as before.
        // F-1537: a check is not written on a tax basis nobody read.
        const tax = await houseTax();
        if (!tax.ok) {
          errors.push(`${check.externalCheckId}: not imported, ${tax.message}`);
          continue;
        }
        // F-1238: a check a file import stored before this house's till sent
        // anything is under csv_import; the till's own copy of it takes that
        // row over, so it is one check, not two. Its stock stays booked under
        // the import's keys, which readCheckLedger reads for the till's copy.
        // F-1324: only when the two are the same check by its day and total.
        if (source !== "csv_import") {
          const adopted = await this.adoptImportedCheck(
            restaurantId,
            source,
            {
              externalCheckId: check.externalCheckId,
              openedAt: check.openedAt ?? null,
              closedAt:
                typeof when.closedAt === "string" ? when.closedAt : null,
              total: check.total ?? null,
            },
            houseZone,
          );
          if (!adopted.ok) {
            errors.push(
              `${check.externalCheckId}: not imported, could not tell whether a file import already holds this check, so it was not stored twice: ${adopted.message}`,
            );
            continue;
          }
        }
        // F-639: a copy older than the one stored, or one that would un-void
        // or re-open it without being newer, is not imported and moves no
        // stock. The trigger pos_checks_keep_newest holds the same rule at
        // the row, for every copy and for two copies racing each other. The
        // stored copy is read here only when this one says which version it
        // is; without that, nothing here can call it newer, and a copy that
        // would take back stock a void returned is stopped at the stock
        // ledger instead (applyStockEffects, AFTER_VOID).
        // F-1624: the stored copy, read once here when either rule needs it.
        let storedCopy: StoredCheckCopy | null = null;
        if (check.sourceVersion != null || check.sourceModifiedAt) {
          const stored = await this.readStoredCheck(
            restaurantId,
            source,
            check.externalCheckId,
          );
          if (!stored.ok) {
            errors.push(
              `${check.externalCheckId}: not imported, the copy already kept could not be read to tell which is newer: ${stored.message}`,
            );
            continue;
          }
          const stale = copyIsStale(stored.row, {
            voided: check.voided === true,
            closedAt: check.closedAt ? String(check.closedAt) : null,
            sourceVersion: check.sourceVersion,
            sourceModifiedAt: check.sourceModifiedAt,
          });
          if (stale) {
            olderCopies++;
            continue;
          }
          storedCopy = stored.row;
          if (stored.row?.voided === true && check.voided !== true) {
            // Newer than the stored void, by the till's own word: the till
            // un-voided it, and the stock ledger may take the sale again.
            NEWER_THAN_VOID.add(check);
          }
        }
        const items = check.items.map((it) => {
          const modifierIds = it.modifierIds ?? [];
          const mapped = this.resolveWine(
            it.name,
            it.externalItemId,
            mappings,
            modifierIds,
          );
          const is_wine =
            typeof it.is_wine === "boolean" ? it.is_wine : mapped.isWine;
          if (is_wine) wineItems++;
          const category = it.category ?? mapped.category ?? null;
          // F-1329: the cocktail this line sells, by its mapping, else by
          // its exact name among the house's own cocktails. F-1469: the name
          // is tried for a mapped line too; a recipe that links stock is
          // what the drink is made of, and it wins over the mapping's row.
          const cocktailId =
            mapped.cocktailId ??
            cocktailLookup.byName.get(cocktailNameKey(it.name)) ??
            null;
          return {
            name: it.name,
            external_item_id: it.externalItemId ?? null,
            category,
            qty: it.qty,
            price: it.price,
            is_wine,
            master_wine_id: it.master_wine_id ?? mapped.masterWineId ?? null,
            inventory_id: mapped.inventoryId,
            sale_unit: mapped.saleUnit,
            sale_volume_ml: mapped.saleVolumeMl,
            // F-641: kept on the stored line so the size it was sold in is
            // on the record; written only when the till sent one.
            ...(modifierIds.length > 0 ? { modifier_ids: modifierIds } : {}),
            // Read by applyStockEffects only; never stored (see row.items).
            unmapped_drink:
              mapped.unmapped &&
              typeof it.is_wine !== "boolean" &&
              !categoryIsFood(category),
            size_unnamed: mapped.sizeUnnamed,
            cocktail_id: cocktailId,
          };
        });

        // F-1537: the subtotal made pre-tax under the house's basis, once,
        // here (ADR 0295 draft rule 1; never at read time). `as_before`
        // (unset) adds nothing to the row.
        const taxStamp = resolveCheckSubtotal(
          {
            subtotal: check.subtotal ?? null,
            total: check.total ?? null,
            tip: check.tip ?? null,
            ...(check.tax !== undefined ? { tax: check.tax } : {}),
            subtotalPreTax: check.subtotalPreTax === true,
            ...(check.taxRateUnread !== undefined ? { taxUnread: true } : {}),
            closedAt: typeof when.closedAt === "string" ? when.closedAt : null,
            openedAt: check.openedAt ?? null,
            lines: items.map((l, i) => ({
              qty: l.qty,
              price: l.price,
              category: l.category,
              inventoryId: l.inventory_id ?? null,
              ...(check.items[i]?.taxRate !== undefined
                ? { taxRate: check.items[i].taxRate as number }
                : {}),
            })),
          },
          tax.ctx,
        );
        // F-1624: a house that has answered reads the stored copy, so a check
        // written under an earlier answer is not re-stamped by a re-send. An
        // unset house reads nothing new (rule 1).
        let keepStamp = false;
        if (taxStamp.kind === "stamped") {
          if (
            storedCopy === null &&
            !(check.sourceVersion != null || check.sourceModifiedAt)
          ) {
            const stored = await this.readStoredCheck(
              restaurantId,
              source,
              check.externalCheckId,
            );
            if (!stored.ok) {
              errors.push(
                `${check.externalCheckId}: not imported, the copy already kept could not be read to tell whether its net was recorded under an earlier tax answer: ${stored.message}`,
              );
              continue;
            }
            storedCopy = stored.row;
          }
          keepStamp = keepsStoredStamp(
            {
              subtotal: check.subtotal ?? null,
              closedAt:
                typeof when.closedAt === "string" ? when.closedAt : null,
              openedAt: check.openedAt ?? null,
            },
            tax.ctx,
            storedCopy === null
              ? null
              : {
                  subtotal: storedCopy.subtotal ?? null,
                  gross_subtotal: storedCopy.gross_subtotal ?? null,
                  tax_basis: storedCopy.tax_basis ?? null,
                },
          );
        }
        if (taxStamp.kind === "stamped" && taxStamp.unresolved && !keepStamp) {
          netNotRecorded.set(
            taxStamp.unresolved,
            (netNotRecorded.get(taxStamp.unresolved) ?? 0) + 1,
          );
        }
        const row = {
          restaurant_id: restaurantId,
          source,
          external_check_id: check.externalCheckId,
          table_id: this.resolveTable(check.tableRef, source, tables),
          // ADR 0302: written only when the check names a channel the hub
          // knows, so a re-send that names none, or names one it does not
          // know, leaves a stored channel alone.
          ...(check.channel ? { channel: check.channel } : {}),
          server_external_id: check.serverExternalId ?? null,
          server_name: check.serverName ?? null,
          opened_at: check.openedAt,
          closed_at: when.closedAt,
          covers: check.covers ?? null,
          subtotal: check.subtotal ?? null,
          total: check.total ?? null,
          tip: check.tip ?? null,
          // Persisted from 2026-08-24. `voided` had driven stock reversal
          // (isVoid, below) since the contract was written, but was never
          // written to the row — and the column did not exist. A voided check
          // therefore returned its stock correctly and stayed revenue forever,
          // because every reader sums `total` with nothing to filter on.
          voided: check.voided === true,
          items: items.map(
            ({
              unmapped_drink: _u,
              size_unnamed: _s,
              cocktail_id: _c,
              ...line
            }) => line,
          ),
          raw: check.raw ?? null,
          // F-639: written only when the till said, so a copy that names
          // neither leaves the stored ones alone.
          ...(check.sourceVersion != null
            ? { source_version: check.sourceVersion }
            : {}),
          ...(check.sourceModifiedAt
            ? { source_modified_at: check.sourceModifiedAt }
            : {}),
          // F-1537: a house that stated its basis gets the pre-tax subtotal
          // and the row says how; an unset house gets nothing new. F-1612:
          // why net was not recorded, as a code the pages count by.
          ...(taxStamp.kind === "stamped"
            ? {
                subtotal: taxStamp.subtotal,
                gross_subtotal: taxStamp.gross_subtotal,
                tax_basis: taxStamp.tax_basis,
                tax_rate_version: taxStamp.tax_rate_version,
                net_not_recorded_reason: taxStamp.reason,
              }
            : {}),
        };
        // F-1624: kept as written; the upsert leaves these columns alone.
        if (keepStamp) {
          delete (row as Record<string, unknown>).subtotal;
          delete (row as Record<string, unknown>).gross_subtotal;
          delete (row as Record<string, unknown>).tax_basis;
          delete (row as Record<string, unknown>).tax_rate_version;
          delete (row as Record<string, unknown>).net_not_recorded_reason;
        }
        const { error } = await client.from("pos_checks").upsert(row, {
          onConflict: "restaurant_id,source,external_check_id",
        });
        if (error) {
          errors.push(`${check.externalCheckId}: ${error.message}`);
        } else {
          upserted++;
          // B18: only closed/paid checks deplete — an open check is
          // analytics-only until closedAt lands (possibly on a later replay
          // of the same externalCheckId, which the upsert above just handled).
          if (check.closedAt) {
            await this.applyStockEffects(
              restaurantId,
              source,
              check,
              items,
              stock,
              when,
            );
            if (AFTER_VOID.has(check)) olderCopies++;
          }
        }
      } catch (err: any) {
        errors.push(`${check.externalCheckId}: ${err?.message}`);
      }
    }

    if (refusedUnreadableDate > MAX_REFUSED_CHECK_LINES) {
      const more = refusedUnreadableDate - MAX_REFUSED_CHECK_LINES;
      errors.push(
        `${more} more check${more === 1 ? " was" : "s were"} not imported, ${CLOSED_AT_NOT_READABLE}; counted in refusedUnreadableDate, not named here`,
      );
    }
    // F-1537: checks written with net sales not recorded (subtotal null),
    // one line per reason; the dashboard counts them (0290 count-and-say).
    for (const [why, n] of netNotRecorded) {
      errors.push(
        `${n} check${n === 1 ? " was" : "s were"} stored with net sales not recorded: ${why}`,
      );
    }
    // Grouped, bounded: one line per (failure kind, item), not one per line.
    errors.push(...stock.errorLines());
    if (stock.needsCount.size > 0) {
      await this.fileNeedsCountNote(
        restaurantId,
        providerKey,
        stock.needsCount,
      );
    }
    const t = stock.tally;
    this.logger.log(
      `POS ingest [${providerKey}] r=${restaurantId}: ${upserted}/${checks.length} checks, ${refusedUnreadableDate} refused for an unreadable closed_at, ${olderCopies} older copies skipped, ${wineItems} wine items; ` +
        `stock booked ${t.booked}, already ${t.alreadyBooked}, counted before ${t.alreadyCounted}, queued ${t.queued.unmapped + t.queued.no_sale_volume}, failed ${t.failed}`,
    );
    // ADR 0281 (amended 2026-10-05): one bell note per import that refused a
    // check, after the loop, never per check. It never throws.
    const bellNote =
      refusedChecks.length > 0
        ? await fileRefusedChecksNote(
            {
              client,
              notifications: this.notifications,
              areaRouting: this.areaRouting,
              logger: this.logger,
            },
            { restaurantId, providerKey, refused: refusedChecks },
          )
        : null;
    return {
      provider: providerKey,
      storedUnder: source,
      received: checks.length,
      upserted,
      channels: channels.tally,
      wineItemsDetected: wineItems,
      refusedUnreadableDate,
      olderCopies,
      errors,
      stock: t,
      bellNote,
    };
  }

  /**
   * F-1436: "count this bottle and correct its stock by hand" reached only
   * errors[], which a webhook's till never reads. One inbox note per import
   * names the items, for the bar (ADR 0218's ladder: the bar's people, and
   * the owners and managers, are written to). Low priority: a row, no push,
   * since a count waits for the next shift. The same items on the same checks
   * sent again within a day add no second note (the group key). It never
   * throws: the import has already said it in errors[].
   */
  private async fileNeedsCountNote(
    restaurantId: string,
    providerKey: string,
    items: Map<string, string>,
  ): Promise<void> {
    const names = [...items.keys()].map((n) =>
      n.length > 40 ? `${n.slice(0, 40)}…` : n,
    );
    if (!this.notifications) {
      this.logger.warn(
        `POS_NEEDS_COUNT_NOTE_NOT_FILED r=${restaurantId} source=${providerKey} items=${names.length}: the bell is not wired on this server`,
      );
      return;
    }
    const one = names.length === 1;
    const shown = names.slice(0, 5);
    const more = names.length - shown.length;
    const list = shown.join(", ") + (more > 0 ? `, and ${more} more` : "");
    const digest = createHash("sha256")
      .update(
        [...items.entries()]
          .map(([name, checkId]) => `${name}\u0000${checkId}`)
          .sort()
          .join("\u0001"),
      )
      .digest("hex")
      .slice(0, 16);
    try {
      const { inserted } = await this.notifications.persistForRestaurant(
        restaurantId,
        {
          type: "inventory_needs_count",
          title: one
            ? `Count ${shown[0]}: a poured glass was taken back`
            : `Count ${names.length} bottles: poured glasses were taken back`,
          message:
            `${tillName(providerKey)} took back a glass or part of a bottle of ${list} after it was poured. ` +
            `A poured glass cannot go back on the shelf by itself, so count ${one ? "this bottle" : "these bottles"} and correct ${one ? "its" : "their"} stock by hand.`,
          priority: "low",
          actionUrl: "/inventory",
          actionLabel: "Open inventory",
          groupKey: `inventory_needs_count:${providerKey}:${digest}`,
          metadata: { items: names.length },
        },
        { dedupeWithinMinutes: 24 * 60, area: "bar" },
      );
      this.logger.log(
        `POS_NEEDS_COUNT_NOTE r=${restaurantId} source=${providerKey} items=${names.length} rows=${inserted}`,
      );
    } catch (err: any) {
      this.logger.error(
        `POS_NEEDS_COUNT_NOTE_NOT_FILED r=${restaurantId} source=${providerKey}: ${err?.message ?? String(err)}`,
      );
    }
  }

  /**
   * F-1195: the till a file import of checks backfills. Its checks are stored
   * under that till: the same check from the till's webhook and from the file
   * is then one check row (the upsert on restaurant_id, source,
   * external_check_id) and one booking of stock (the `pos:{source}:...`
   * keys). Under its own `csv_import` source it was stored twice and took
   * stock twice, and every takings and tips reader counted it twice.
   *
   * The till is the one the body names (`{"till": "square", "checks": [...]}`),
   * else the one till this house has taken checks from; null (stored under
   * `csv_import`) for a house with no till yet. Two tills and none named is
   * refused, as is a till that could not be read: guessing writes a second
   * copy of the same checks.
   */
  private async importTill(
    restaurantId: string,
    payload: unknown,
  ): Promise<string | null> {
    const named = (payload as { till?: unknown } | null | undefined)?.till;
    if (named !== undefined && named !== null && named !== "") {
      if (
        typeof named !== "string" ||
        named === "csv_import" ||
        !ADAPTERS[named]
      ) {
        throw new Error(
          `The file names a till this house cannot take checks from (${JSON.stringify(named).slice(0, 40)}). Name one of: ${IMPORT_TILLS.join(", ")}. Nothing was imported.`,
        );
      }
      return named;
    }
    const tills = await this.tillsWithChecks(restaurantId);
    if (tills.length > 1) {
      throw new Error(
        `This house takes checks from more than one till (${tills.map((t) => PROVIDER_BY_KEY[t]?.name ?? t).join(", ")}), so the file must say which one it came from, as "till": ${tills.map((t) => JSON.stringify(t)).join(" or ")}. Nothing was imported.`,
      );
    }
    return tills[0] ?? null;
  }

  /**
   * F-1195: the tills (every feed but the file import) this house holds a
   * check from. A read that fails throws: an unread till is not "no till",
   * and an import under `csv_import` beside it would store its checks twice.
   */
  private async tillsWithChecks(restaurantId: string): Promise<string[]> {
    const client = this.dbService.getClient();
    const found = await Promise.all(
      IMPORT_TILLS.map(async (till) => {
        const { data, error } = await client
          .from("pos_checks")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("source", till)
          .limit(1);
        if (error) {
          this.logger.error(
            `pos_checks till read failed for r=${restaurantId} src=${till}: ${error.message}`,
          );
          throw new HttpException(
            "Could not read which till this house takes checks from, so none were imported: a check the till already sent could have been stored twice. Try again shortly.",
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        return ((data as unknown[] | null) ?? []).length > 0 ? till : null;
      }),
    );
    return found.filter((t): t is string => t !== null);
  }

  /**
   * F-1238: a file import of checks made before this house's till sent any
   * is stored under `csv_import` (importTill finds no till). When the till
   * later sends one of those checks, its row is moved to the till's source
   * once, so the till's upsert lands on it rather than beside it: one check,
   * counted once. Moving a row that is not there moves nothing, so a re-send
   * is a no-op. When the till's own copy is already stored beside it (both
   * kept before F-1195), the import's row is left for a repair and the till's
   * copy is updated as before. Any other failure is returned: storing the
   * check anyway could store it twice.
   *
   * F-1324: a till reuses its check numbers, so the same number is not the
   * same check. The row is moved only when it falls on the same house day
   * (closed, else opened, on the house's clock, ADR 0296) and its total is
   * within a cent of the till's. Otherwise both rows are kept, each with its
   * own stock, and the pair is logged for someone to look at. A house with no
   * time zone has no house day to compare, so nothing is moved there either.
   */
  private async adoptImportedCheck(
    restaurantId: string,
    source: string,
    till: {
      externalCheckId: string;
      openedAt: string | null;
      closedAt: string | null;
      total: number | null;
    },
    houseZone: () => Promise<string | null>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const externalCheckId = till.externalCheckId;
    try {
      const imported = await this.dbService
        .getClient()
        .from("pos_checks")
        .select("opened_at, closed_at, total")
        .eq("restaurant_id", restaurantId)
        .eq("source", "csv_import")
        .eq("external_check_id", externalCheckId)
        .maybeSingle();
      if (imported.error) {
        return { ok: false, message: imported.error.message ?? "no message" };
      }
      if (!imported.data) return { ok: true };
      const zone = await houseZone();
      const row = imported.data as {
        opened_at: string | null;
        closed_at: string | null;
        total: number | string | null;
      };
      const importDay = zone ? houseDayOf(row, zone) : null;
      const tillDay = zone
        ? houseDayOf(
            { opened_at: till.openedAt, closed_at: till.closedAt },
            zone,
          )
        : null;
      const a = row.total === null ? null : Number(row.total);
      const b = till.total === null ? null : Number(till.total);
      const sameTotal =
        a === null || b === null
          ? a === b
          : Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= 1;
      if (importDay === null || importDay !== tillDay || !sameTotal) {
        this.logger.warn(
          `pos_checks ${externalCheckId} r=${restaurantId}: the ${source} check and the file-imported one share a number but not a day and total (import ${importDay ?? "no house day"}, ${a ?? "no total"}; till ${tillDay ?? "no house day"}, ${b ?? "no total"}); both are kept, for review`,
        );
        return { ok: true };
      }
      const { error } = await this.dbService
        .getClient()
        .from("pos_checks")
        .update({ source })
        .eq("restaurant_id", restaurantId)
        .eq("source", "csv_import")
        .eq("external_check_id", externalCheckId);
      if (!error) return { ok: true };
      if (error.code === "23505") {
        this.logger.warn(
          `pos_checks ${externalCheckId} r=${restaurantId} is stored under both csv_import and ${source}; the csv_import row is left for a repair`,
        );
        return { ok: true };
      }
      return { ok: false, message: error.message ?? "no message" };
    } catch (err: any) {
      return { ok: false, message: err?.message ?? String(err) };
    }
  }

  /**
   * F-639: the copy of this check the hub keeps, if any, for copyIsStale. A
   * read that fails is not "no copy": the caller refuses the check rather
   * than risk un-voiding it.
   */
  private async readStoredCheck(
    restaurantId: string,
    source: string,
    externalCheckId: string,
  ): Promise<
    { ok: true; row: StoredCheckCopy | null } | { ok: false; message: string }
  > {
    try {
      const { data, error } = await this.dbService
        .getClient()
        .from("pos_checks")
        .select(
          "voided, closed_at, source_version, source_modified_at, subtotal, gross_subtotal, tax_basis",
        )
        .eq("restaurant_id", restaurantId)
        .eq("source", source)
        .eq("external_check_id", externalCheckId)
        .maybeSingle();
      if (error) return { ok: false, message: error.message ?? "no message" };
      return { ok: true, row: (data as StoredCheckCopy | null) ?? null };
    } catch (err: any) {
      return { ok: false, message: err?.message ?? String(err) };
    }
  }

  /**
   * F-643: refuse a feed the house switched off. No pos_connections row is a
   * feed that was never switched, and is taken as before. A read that fails
   * refuses too: a house that unplugged its till must not have it written to
   * because a read failed.
   */
  async assertConnected(restaurantId: string, providerKey: string) {
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_connections")
      .select("enabled")
      .eq("restaurant_id", restaurantId)
      .eq("provider", providerKey)
      .maybeSingle();
    if (error) {
      throw new HttpException(
        `Could not check whether this restaurant still takes ${providerKey} checks, so none were taken. Send them again shortly.`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (data && data.enabled === false) {
      throw new HttpException(
        `This restaurant has disconnected ${providerKey}, so its checks are not taken. The owner can connect it again in Settings.`,
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * F-643: the owner switches a provider's feed off or on for the house.
   * Kept as one row per (house, provider), with who changed it and when.
   */
  async setConnection(
    restaurantId: string,
    providerKey: string,
    enabled: boolean,
    actorUserId: string,
  ) {
    if (!PROVIDER_BY_KEY[providerKey])
      throw new Error(`Unknown POS provider '${providerKey}'`);
    const row = {
      restaurant_id: restaurantId,
      provider: providerKey,
      enabled,
      changed_at: new Date().toISOString(),
      changed_by: actorUserId,
    };
    const { error } = await this.dbService
      .getClient()
      .from("pos_connections")
      .upsert(row, { onConflict: "restaurant_id,provider" });
    if (error) throw new Error(error.message ?? "no message");
    return row;
  }

  /**
   * F-914: whether the house takes each provider's feed, so the page can
   * offer Disconnect or Reconnect honestly. Only switched providers have a
   * row; a provider with none is taken (see assertConnected). A read that
   * fails throws: an unread switch must not be drawn as "taking checks".
   */
  async listConnections(restaurantId: string) {
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_connections")
      .select("provider, enabled, changed_at")
      .eq("restaurant_id", restaurantId);
    if (error) throw new Error(error.message ?? "no message");
    return {
      connections: ((data as any[] | null) ?? []).map((r) => ({
        provider: r.provider as string,
        providerName: PROVIDER_BY_KEY[r.provider]?.name ?? r.provider,
        enabled: r.enabled !== false,
        changedAt: (r.changed_at as string | null) ?? null,
      })),
    };
  }

  // =========================================================================
  // Item mappings (pos_item_mappings) + wine heuristic
  // =========================================================================

  /**
   * Same shape as `loadTables` below, for the same reason.
   *
   * A failed read here returned `[]`, and `resolveWine` finds nothing in an
   * empty array — so every line on every check ingested with
   * `inventory_id: null`, `is_wine` from the name heuristic only, and no
   * depletion. The ingest then reported `errors: []`. That is the mechanism
   * that manufactures "the POS bridge stopped mapping" as a silent condition.
   *
   * An empty mapping table is NOT an error (a restaurant that has mapped
   * nothing yet is normal) and is never reported as one; only a real failure
   * is, through the same `errors` channel a failed check upsert uses.
   */
  private async loadItemMappings(
    restaurantId: string,
    source: string,
  ): Promise<{ rows: any[]; error: string | null }> {
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_item_mappings")
      .select(
        "external_item_id, item_name, category, is_wine, master_wine_id, inventory_id, sale_unit, sale_volume_ml, cocktail_id",
      )
      .eq("restaurant_id", restaurantId)
      .in("source", [source, "*"]);
    if (error) {
      this.logger.error(
        `pos_item_mappings lookup failed for r=${restaurantId} src=${source} — ` +
          `every line will ingest unmapped rather than wrongly mapped: ${error.message}`,
      );
      return { rows: [], error: `pos_item_mappings: ${error.message}` };
    }
    return { rows: data || [], error: null };
  }

  /**
   * F-1329: the house's own cocktails by name, so a till line no mapping names
   * still finds its recipe when it is called exactly what the house calls the
   * cocktail. A name two cocktails share names neither. A failed read is
   * said; its lines are then imported as before, with no recipe.
   */
  private async loadHouseCocktails(
    restaurantId: string,
  ): Promise<{ byName: Map<string, string>; error: string | null }> {
    const byName = new Map<string, string>();
    try {
      const { data, error } = await this.dbService
        .getClient()
        .from("cocktails")
        .select("id, name, display_name, deleted_at")
        .eq("restaurant_id", restaurantId);
      if (error) {
        return {
          byName,
          error: `cocktails: ${error.message}; a till line was matched to no recipe by its name`,
        };
      }
      const shared = new Set<string>();
      for (const c of (Array.isArray(data) ? data : []) as any[]) {
        // A cocktail taken off the list sells nothing by its name.
        if (c.deleted_at) continue;
        for (const key of new Set(
          [c.name, c.display_name].filter(Boolean).map(cocktailNameKey),
        )) {
          if (byName.has(key) && byName.get(key) !== c.id) shared.add(key);
          else byName.set(key, c.id);
        }
      }
      for (const key of shared) byName.delete(key);
      return { byName, error: null };
    } catch (err: any) {
      return {
        byName,
        error: `cocktails: ${err?.message ?? String(err)}; a till line was matched to no recipe by its name`,
      };
    }
  }

  /**
   * F-1329: the linked lines of each cocktail's recipe, in recorded order. A
   * line that names no stock row is not linked and takes nothing. The stock
   * rows are checked against the house by the volume read, as a mapping's are.
   */
  private async loadRecipes(cocktailIds: string[]): Promise<{
    recipes: Map<string, RecipeStockLine[]>;
    error: string | null;
  }> {
    const recipes = new Map<string, RecipeStockLine[]>();
    if (!cocktailIds.length) return { recipes, error: null };
    const { data, error } = await this.dbService
      .getClient()
      .from("cocktail_ingredients")
      .select(
        "cocktail_id, inventory_id, free_text, quantity, unit, sort_order",
      )
      .in("cocktail_id", cocktailIds)
      .order("sort_order", { ascending: true });
    if (error) return { recipes, error: error.message ?? "no message" };
    for (const r of (Array.isArray(data) ? data : []) as any[]) {
      if (!r.inventory_id) continue;
      const list = recipes.get(r.cocktail_id) ?? [];
      list.push({
        inventoryId: r.inventory_id,
        freeText: r.free_text ?? null,
        quantity: r.quantity,
        unit: r.unit,
      });
      recipes.set(r.cocktail_id, list);
    }
    return { recipes, error: null };
  }

  /**
   * One batched read of every inventory row a check touches.
   *
   * Depletion needs `bottle_size_ml`/`pour_size_ml` to resolve a sale volume
   * (ADR 0011) and the consumption mirror needs `menu_price_current`; this
   * replaces the per-line `maybeSingle()` that mirror used to issue on its own,
   * so a 20-line check costs one query rather than twenty.
   */
  private async loadInventoryVolumes(
    restaurantId: string,
    inventoryIds: string[],
  ): Promise<{
    volumes: Map<string, InventoryVolumes>;
    /** F-1433: each row's last count of every shelf, as epoch ms. */
    countedAt: Map<string, number>;
    error: string | null;
  }> {
    const out = new Map<string, InventoryVolumes>();
    const countedAt = new Map<string, number>();
    if (!inventoryIds.length) return { volumes: out, countedAt, error: null };
    // ADR 0141, second correction 2026-09-12: SCOPED TO THE HOUSE. This read
    // had no restaurant filter, so it answered for another house's item as
    // readily as for this one's, and the caller poured whatever it returned.
    // An id it does not return is now, by construction, not this house's --
    // `applyStockEffects` queues it rather than pouring it.
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_inventory")
      .select(
        "id, bottle_size_ml, pour_size_ml, menu_price_current, last_counted_at",
      )
      .eq("restaurant_id", restaurantId)
      .in("id", inventoryIds);
    // An empty map is the safe degrade — resolveSaleVolume queues the line
    // rather than guessing a volume (ADR 0011) — but it must not be silent:
    // a failed read here queues an ENTIRE service as unresolved and looks
    // exactly like a restaurant whose inventory rows all vanished.
    if (error)
      this.logger.error(
        `restaurant_inventory volume lookup failed for ${inventoryIds.length} ` +
          `id(s) — every wine line on this check will queue as unresolved ` +
          `rather than deplete by a guessed volume: ${error.message}`,
      );
    for (const row of data || []) {
      out.set(row.id, inventoryVolumesFromRow(row));
      // F-1165: only a count of every shelf stamps last_counted_at, so a
      // shelf count (whose shelf a sale may not drain) never stands here.
      const counted = row.last_counted_at
        ? Date.parse(String(row.last_counted_at))
        : NaN;
      if (Number.isFinite(counted)) countedAt.set(row.id, counted);
    }
    return { volumes: out, countedAt, error: error ? error.message : null };
  }

  /**
   * Mapping-table-first resolution (decision B21): a `pos_item_mappings` hit
   * — by external id first, then exact name — is authoritative and is the
   * only source that can produce an `inventoryId`/`saleUnit`/`saleVolumeMl`
   * (decision B36: sale unit never inferred from the item name — and per ADR
   * 0011, neither is sale volume, even though `normalizeDescription()` could
   * read "1.5L magnum" out of a name. A POS catalog's size is the size of the
   * bottle a by-the-glass SKU is poured FROM, so parsing it would rebuild the
   * bottle default under a new name). WINE_WORDS is a
   * best-effort fallback used only to flag likely-wine items that have no
   * mapping yet, so they get queued in pos_unresolved_lines instead of
   * vanishing — it never has enough information to resolve a stock target.
   */
  private resolveWine(
    name: string,
    externalItemId: string | null | undefined,
    mappings: any[],
    modifierIds: string[] = [],
  ): {
    /** No mapping row names this line (F-640: queued unless food). */
    unmapped: boolean;
    /** F-641: the modifiers on this line when none of them is named by a
     *  mapping and the line resolved by its item alone; null otherwise. */
    sizeUnnamed: string[] | null;
    isWine: boolean;
    masterWineId: string | null;
    category: string | null;
    inventoryId: string | null;
    saleUnit: string | null;
    saleVolumeMl: number | null;
    /** F-1329: the cocktail this till button sells, when its mapping says. */
    cocktailId: string | null;
  } {
    const lower = (name || "").toLowerCase();
    // F-641: a mapping keyed `<item id>:<modifier id>` names one size of the
    // item (a glass, a bottle) and wins over the item's own mapping.
    const byModifier = externalItemId
      ? (modifierIds
          .map((mod) =>
            mappings.find(
              (m) =>
                m.external_item_id &&
                m.external_item_id === `${externalItemId}:${mod}`,
            ),
          )
          .find(Boolean) ?? null)
      : null;
    const byId =
      byModifier ??
      (externalItemId
        ? mappings.find(
            (m) => m.external_item_id && m.external_item_id === externalItemId,
          )
        : null);
    const byName =
      byId ??
      mappings.find(
        (m) => m.item_name && lower === String(m.item_name).toLowerCase(),
      );
    if (byName) {
      return {
        unmapped: false,
        sizeUnnamed: !byModifier && modifierIds.length > 0 ? modifierIds : null,
        isWine: byName.is_wine === true,
        masterWineId: byName.master_wine_id ?? null,
        category: byName.category ?? null,
        inventoryId: byName.inventory_id ?? null,
        saleUnit: (byName.sale_unit as string | null) ?? null,
        saleVolumeMl:
          byName.sale_volume_ml == null ? null : Number(byName.sale_volume_ml),
        cocktailId: byName.cocktail_id ?? null,
      };
    }
    const isWine =
      PosHubService.WINE_WORDS.some((w) => lower.includes(w)) ||
      [lower, (name || "").toLocaleLowerCase("tr")].some((l) =>
        l.split(/[^\p{L}]+/u).some((w) => PosHubService.DRINK_WORDS.has(w)),
      );
    return {
      unmapped: true,
      sizeUnnamed: null,
      isWine,
      masterWineId: null,
      category: null,
      inventoryId: null,
      saleUnit: null,
      saleVolumeMl: null,
      cocktailId: null,
    };
  }

  // =========================================================================
  // Stock effects (decision B13/B18/B19/B20) — closed checks only
  // =========================================================================

  private async applyStockEffects(
    restaurantId: string,
    source: string,
    check: CanonicalCheck,
    tillItems: Array<{
      name: string;
      external_item_id: string | null;
      qty: number;
      price: number | null;
      is_wine: boolean;
      inventory_id: string | null;
      sale_unit: string | null;
      sale_volume_ml: number | null;
      /** F-640: no mapping, no wine word, and no food category. */
      unmapped_drink?: boolean;
      /** F-641: modifiers no mapping names, on a line mapped by item. */
      size_unnamed?: string[] | null;
      /** F-1329: the cocktail this line sells; its recipe says what it takes. */
      cocktail_id?: string | null;
    }>,
    report: StockReport = new StockReport(),
    // ADR 0281: ingest() reads closed_at once, before it stores the check,
    // and hands that reading here so the check and its stock carry one
    // instant. The default serves the specs that call this method directly.
    when: SaleInstant = saleInstant(check.closedAt, Date.now()),
  ): Promise<StockTally> {
    // ADR 0281, F4: stock is dated only by a closed_at that was read. ingest()
    // never calls this for one that was not; a direct caller is refused here
    // rather than dated at import time.
    if (when.fellBack) {
      throw new Error(
        `closed_at ${quoteClosedAt(check.closedAt ?? null)} was not read, so check ${check.externalCheckId} moves no stock (ADR 0281)`,
      );
    }
    const db = this.dbService.getClient();
    const isVoid = check.voided === true;
    const affected = new Set<string>();
    const tally = report.tally;

    // ADR 0281: the stock and the consumption of this check are dated by when
    // it closed, not by when it reached the hub. A void is dated by the
    // closed_at the voided check carries: the sale's own instant only when
    // the till re-sends it, a later one when the till stamps the void itself.
    const booked = () => {
      tally.booked++;
      if (when.backdatedOver72h) tally.backdatedOver72h++;
    };

    // F-1329: the recipes of the cocktails this check sold. Read only when
    // a line sells one; a failed read takes nothing for those lines.
    const cocktailIds = [
      ...new Set(
        tillItems
          .filter((it) => it.cocktail_id && Number(it.qty) > 0)
          .map((it) => it.cocktail_id as string),
      ),
    ];
    const recipeRead = cocktailIds.length
      ? await this.loadRecipes(cocktailIds)
      : { recipes: new Map<string, RecipeStockLine[]>(), error: null };
    // Each linked line of a cocktail's recipe is a stock line of its own. The
    // till line stands for the first; the rest follow the check's own lines,
    // so no till line's position (its B15 key) moves.
    type StockItem = (typeof tillItems)[number] & {
      recipe?: { line: RecipeStockLine; lineNo: number; j: number };
      recipeError?: string;
    };
    const following: StockItem[] = [];
    const items: StockItem[] = tillItems.map((it, lineNo) => {
      if (!it.cocktail_id || !(Number(it.qty) > 0)) return it;
      if (recipeRead.error) return { ...it, recipeError: recipeRead.error };
      const recipe = recipeRead.recipes.get(it.cocktail_id) ?? [];
      // A recipe that links nothing: the line is imported exactly as before.
      if (recipe.length === 0) return it;
      for (let j = 1; j < recipe.length; j++) {
        following.push({ ...it, recipe: { line: recipe[j], lineNo, j } });
      }
      return { ...it, recipe: { line: recipe[0], lineNo, j: 0 } };
    });
    items.push(...following);

    // One read for the whole check (ADR 0011): resolving a sale volume needs
    // the inventory row's bottle/pour sizes before any RPC is issued.
    const inventoryRead = await this.loadInventoryVolumes(restaurantId, [
      ...new Set([
        ...items
          .filter((it) => it.is_wine && it.inventory_id)
          .map((it) => it.inventory_id as string),
        ...[...recipeRead.recipes.values()].flat().map((r) => r.inventoryId),
      ]),
    ]);
    const inventories = inventoryRead.volumes;
    // queueUnresolvedLine counts its own outcome into this check's report, so
    // the three queue call sites below stay exactly as they were.
    STOCK_REPORTS.set(check, report);
    tally.lines += items.length;
    const decidedBefore = decidedLines(tally);

    // Two passes (sim wave 8, F-393/F-394/F-395). The first resolves every
    // wine line to what it takes -- whole bottles, or ml -- and queues what
    // cannot be resolved, as before. The second compares the check with what
    // earlier imports of the SAME check already moved, and moves only the
    // difference. Until then each line was booked under its own key and the
    // RPC's early return was the only memory, so a check that first arrived
    // voided returned bottles nobody took (F-393), and a re-sent check that
    // lost or shrank a line never gave the stock back (F-395).
    const planned: PlannedStockLine[] = [];
    for (let lineNo = 0; lineNo < items.length; lineNo++) {
      const it = items[lineNo];
      // F-1329 (OD-113, founder S195): a cocktail takes each linked line of
      // its recipe off that line's stock row, by the recipe's amount times
      // the quantity sold, through the same pours and keys as a glass. A line
      // not linked to stock takes nothing.
      if (it.recipeError) {
        tally.failed++;
        report.noteFailure(
          "stock",
          it.name,
          `the cocktail's recipe could not be read, so nothing was taken: ${it.recipeError}`,
          check.externalCheckId,
        );
        continue;
      }
      if (it.recipe) {
        const line = this.planRecipeLine(
          source,
          check,
          it,
          it.recipe.lineNo,
          it.recipe.j,
          it.recipe.line,
          inventoryRead,
          inventories,
        );
        if (line === null) continue;
        if (typeof line === "string") {
          tally.failed++;
          report.noteFailure(
            "stock",
            `${it.name}: ${it.recipe.line.freeText ?? "a recipe line"}`,
            line,
            check.externalCheckId,
          );
          continue;
        }
        planned.push(line);
        continue;
      }
      // Stock-scoped skip only. The full line set — food included — was
      // already persisted verbatim to pos_checks.items at the upsert above
      // (ingest(), ~line 202), before this loop runs, and is already read by
      // TableAnalyticsService.getBasketAffinity() for wine/dish co-occurrence
      // with no is_wine filter. Do not read this line as "food is discarded" —
      // it isn't; only stock depletion (which food has no inventory row for)
      // is skipped here. See .planning/BEVERAGE_CATALOGUE_PLAN.md register A11.
      if (!it.is_wine) {
        // F-640: a line no mapping names, whose name has no drink word and
        // whose category does not say food, may be a drink the word lists do
        // not know ("Kavaklıdere Yakut 2022"). It is queued so someone says
        // what it is, never dropped. A line the till itself called not wine
        // (canonical is_wine: false) is taken at its word.
        if (it.unmapped_drink && Number(it.qty) > 0) {
          await this.queueUnresolvedLine(restaurantId, source, check, it, {
            reason: "unmapped",
            mappedInventoryId: null,
            detail:
              "no pos_item_mappings row says what this line is, and its name and category do not say it is food",
          });
        }
        continue;
      }

      // F-394: no rounding. A till that splits one bottle across two checks
      // sends 0.5 on each, and Math.round took a whole bottle for each half
      // (2 for 1), while a three-way split rounded to 0 and took nothing. A
      // part is carried as ml below.
      const qty = Number(it.qty);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      try {
        if (!it.inventory_id) {
          // B20: an unmapped wine line is queued for review, never dropped.
          await this.queueUnresolvedLine(restaurantId, source, check, it, {
            reason: "unmapped",
            mappedInventoryId: null,
            detail: "no pos_item_mappings row resolves this line to stock",
          });
          continue;
        }

        // ADR 0141, second correction 2026-09-12. `it.inventory_id` comes from
        // a mapping row read for this restaurant, but the row belonging here
        // does not make the item it names belong here -- the column is a plain
        // FK -- and `record_glass_pour` below takes no restaurant. A mapping
        // stored wrongly poured another house's shelf on every glass. Only an
        // id the house-scoped read above returned may move stock: anything
        // else is not this house's and is queued, never poured. A FAILED read
        // cannot say yes either, so it moves nothing and the queue says why.
        if (inventoryRead.error || !inventories.has(it.inventory_id)) {
          await this.queueUnresolvedLine(restaurantId, source, check, it, {
            reason: inventoryRead.error ? "no_sale_volume" : "unmapped",
            mappedInventoryId: null,
            detail: inventoryRead.error
              ? `could not confirm that inventory item ${it.inventory_id} belongs to this restaurant, so no stock was moved: ${inventoryRead.error}`
              : `the mapping names inventory item ${it.inventory_id}, which does not belong to this restaurant, so no stock was moved`,
          });
          continue;
        }

        // F-641: the till rang this line with a modifier (a "Glass" or
        // "Bottle" size) that no mapping names, and the item's one mapping
        // holds one volume. Depleting at it would take a bottle for a glass
        // or a glass for a bottle, so the line is queued until a mapping
        // names the size (`<item id>:<modifier id>`).
        if (it.size_unnamed && it.size_unnamed.length > 0) {
          await this.queueUnresolvedLine(restaurantId, source, check, it, {
            reason: "no_sale_volume",
            mappedInventoryId: it.inventory_id,
            detail: `the till sold this with an option (${it.size_unnamed.join(", ")}) that no mapping names, so whether it was a glass or a bottle is not known`,
          });
          continue;
        }

        // ADR 0011: sale_volume_ml → sale_unit + inventory → queue. There is
        // no `?? "bottle"` any more. Until 2026-08-25 this line read
        // `it.sale_unit ?? "bottle"`, and because upsertItemMapping never wrote
        // the column, all 92 production mappings took that branch: every
        // by-the-glass sale booked 750ml instead of 150.
        const inv = inventories.get(it.inventory_id) ?? null;
        const resolved = resolveSaleVolume(
          it.sale_volume_ml,
          it.sale_unit,
          inv,
        );
        if (resolved.mode === "unresolved") {
          // Fail closed, exactly as the unmapped branch above does. This
          // UNDER-depletes — stock reads high until a human works the queue —
          // which is the trade recorded in ADR 0011 against a default that
          // OVER-depleted by 5x with nothing to show for it.
          await this.queueUnresolvedLine(restaurantId, source, check, it, {
            reason: "no_sale_volume",
            mappedInventoryId: it.inventory_id,
            detail: resolved.reason,
          });
          continue;
        }

        const line: PlannedStockLine = {
          it,
          inventoryId: it.inventory_id,
          // B15: depletion idempotency key, for the first import of a check.
          idem: `pos:${source}:${check.externalCheckId}:${it.external_item_id ?? it.name}:${lineNo}`,
          // Reporting label only — never arithmetic (ADR 0011).
          label: it.sale_unit ?? resolved.mode,
          inv,
          qty,
          bottles: 0,
          pours: 0,
          pourMl: 0,
          part: false,
          consumed: resolved,
          consumedQty: qty,
        };
        if (Number.isInteger(qty) && resolved.mode === "whole_bottle") {
          line.bottles = qty;
        } else if (Number.isInteger(qty) && resolved.mode === "volume") {
          // record_glass_pour has taken an arbitrary p_pour_ml since the
          // baseline (baseline_from_production.sql:1132); the app layer was
          // the only binary part. It is passed explicitly rather than as null
          // so the ml that moves stock and the ml written to the consumption
          // log are the same number, decided here.
          line.pours = qty;
          line.pourMl = Math.round(resolved.ml);
        } else {
          // F-394: a part of a bottle (or of a pour) is one draw of that many
          // ml through record_glass_pour, which finishes open bottles first,
          // so two halves of one bottle open exactly one. It needs the
          // bottle's size: the RPC would assume 750ml for a missing one.
          const unitMl =
            resolved.mode === "volume" ? resolved.ml : (inv?.bottleMl ?? null);
          if (unitMl == null) {
            await this.queueUnresolvedLine(restaurantId, source, check, it, {
              reason: "no_sale_volume",
              mappedInventoryId: it.inventory_id,
              detail: `the till sold ${qty} of a bottle, and the inventory row carries no bottle_size_ml to say how much that is`,
            });
            continue;
          }
          line.part = true;
          line.pours = 1;
          line.pourMl = Math.round(qty * unitMl);
          if (line.pourMl < 1) continue;
          line.consumed = { mode: "volume", ml: line.pourMl };
          line.consumedQty = 1;
        }
        planned.push(line);
      } catch (err: any) {
        this.logger.warn(
          `Stock effect threw for ${it.name} on check ${check.externalCheckId}: ${err?.message}`,
        );
        tally.failed++;
        report.noteFailure(
          "stock",
          it.name,
          err?.message ?? String(err),
          check.externalCheckId,
        );
      }
    }

    // supabase-js resolves RPC failures as { error } rather than throwing, so
    // — as in the receiving-door bug this plan's spine repair fixed — the
    // error field must be checked explicitly or a failed depletion reports
    // success silently. A throw is folded into the same shape. The RPC is
    // named at each call below, with its arguments inline, so
    // scripts/check_stock_wrappers_check_ownership.py can read the house it
    // passes.
    const call = async (
      rpc: () => PromiseLike<{ error: { message?: string } | null }>,
    ): Promise<string | null> => {
      try {
        const { error } = await rpc();
        return error ? (error.message ?? "no message") : null;
      } catch (err: any) {
        return err?.message ?? String(err);
      }
    };
    const move = (
      inventoryId: string,
      delta: number,
      reason: string,
      key: string,
    ) =>
      call(() =>
        db.rpc("apply_stock_movement", {
          p_inventory_id: inventoryId,
          p_stock_state: "live",
          p_delta: delta,
          p_transaction_type: delta > 0 ? "return" : "sale",
          p_source: "pos",
          p_reason: reason,
          p_idempotency_key: key,
          // ADR 0141 — the house this check belongs to. `it.inventory_id`
          // comes from a `pos_item_mappings` row read for this restaurant;
          // the row belonging here does not make the item it names belong
          // here, and a mis-seeded mapping used to move another house's
          // shelf on every sale.
          p_restaurant_id: restaurantId,
          // ADR 0281: a sale and its void are both dated by the closed_at
          // their check carries. A void lands on the sale's day only when
          // the till re-sends the sale's closed_at on it; a till that
          // stamps the void with its own time dates the return then.
          p_occurred_at: when.at,
        }),
      );
    const pour = (
      inventoryId: string,
      pours: number,
      pourMl: number,
      reason: string,
      key: string,
    ) =>
      call(() =>
        db.rpc("record_glass_pour", {
          p_inventory_id: inventoryId,
          p_pours: pours,
          p_pour_ml: pourMl,
          p_location_id: null,
          p_source: "pos",
          p_reason: reason,
          p_idempotency_key: key,
          // ADR 0281: dated by the check, not by its arrival.
          p_occurred_at: when.at,
        }),
      );
    const fail = (name: string, message: string, lines: number) => {
      this.logger.warn(
        `Stock effect failed for ${name} on check ${check.externalCheckId}: ${message}`,
      );
      tally.failed += lines;
      for (let i = 0; i < Math.max(lines, 1); i++) {
        report.noteFailure("stock", name, message, check.externalCheckId);
      }
    };
    const consume = async (
      line: PlannedStockLine,
      consumed: ResolvedSaleVolume,
      qty: number,
      key: string,
    ): Promise<"logged" | "already" | "failed"> => {
      const consumption = await this.recordConsumption(
        restaurantId,
        line.it,
        consumed,
        line.inv,
        qty,
        key,
        when.at,
      );
      if (consumption === "failed") {
        tally.consumptionNotWritten++;
        report.noteFailure(
          "consumption",
          line.it.name,
          "the stock moved; see the gateway log for the database error",
          check.externalCheckId,
        );
      }
      return consumption;
    };
    // F-1197: a void or a correction that takes bottles back marks the
    // item's consumption rows on this check reversed. A negative row is not
    // written: ADR 0297 gives a negative bottle line no bottle figure, and
    // every reader refuses it. Readers leave a marked row out. Idempotent:
    // only unmarked rows are touched, never the row under `key` itself.
    const reverseConsumption = async (
      inventoryId: string,
      name: string,
      key: string,
      bottlesOnly: boolean,
    ): Promise<boolean> => {
      const pattern = `${checkLedgerPrefix(
        source,
        check.externalCheckId,
      ).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      let message: string | null;
      try {
        let q = db
          .from("wine_consumption_log")
          .update({ reversed_at: when.at, reversed_by_key: key })
          .eq("restaurant_id", restaurantId)
          .eq("inventory_id", inventoryId)
          .eq("source", "pos")
          .is("reversed_at", null)
          .neq("notes", key);
        if (bottlesOnly) q = q.eq("consumption_type", "bottle");
        const { error } = await q.like("notes", pattern);
        message = error ? (error.message ?? "no message") : null;
      } catch (err: any) {
        message = err?.message ?? String(err);
      }
      if (message === null) return true;
      this.logger.error(
        `wine_consumption_log reversal FAILED for ${name} ` +
          `(r=${restaurantId}, key=${key}): ${message} — the taken-back sale ` +
          `still counts as sold.`,
      );
      tally.consumptionNotWritten++;
      report.noteFailure(
        "consumption",
        name,
        "the stock moved; see the gateway log for the database error",
        check.externalCheckId,
      );
      return false;
    };

    const ledger =
      planned.length > 0
        ? await this.readCheckLedger(
            restaurantId,
            source,
            check.externalCheckId,
          )
        : null;
    // A replay moves no stock, but it still writes a consumption row an
    // earlier import failed to write, as the replay of the first import
    // always did. Only for a line its own key booked unchanged: a line a
    // correction added or changed was mirrored under the correction's key,
    // and writing it again under its own would count the sale twice.
    // A voided check never writes demand (main never did), even when its
    // sale's row once failed: the sale it would record did not stand.
    // F-1197: nor once a correction took bottles of the item back: its rows
    // were marked reversed and one row of what stands was written, which a
    // line's own row would count a second time.
    const replayConsumption = async (l: PlannedStockLine, amount: number) => {
      if (
        !isVoid &&
        ledger?.ok &&
        !ledger.cutBack.has(l.inventoryId) &&
        ledger.byKey.get(l.idem) === amount
      ) {
        await consume(l, l.consumed, l.consumedQty, l.idem);
      }
      tally.alreadyBooked++;
    };
    // F-1433: a sale that closed before the item's last count of every shelf
    // but reaches the hub after it (a nightly export at 03:00 for a bar
    // counted at 02:00, a till that synced late) is already in that count.
    // Taking it off again took it twice. It moves no stock; its consumption
    // row is written under the line's own key, so a replay writes it once,
    // and errors[] says so. A count of one shelf does not stand here (a sale
    // names no shelf), and a count at the sale's own instant or before it
    // does not either: that sale is taken as before.
    const saleMs = Date.parse(when.at);
    const countedAfterSale = (inventoryId: string): string | null => {
      const at = inventoryRead.countedAt.get(inventoryId);
      return at !== undefined && saleMs < at
        ? new Date(at).toISOString().slice(0, 16).replace("T", " ") + " UTC"
        : null;
    };
    const alreadyCounted = async (
      lines: PlannedStockLine[],
      countedAt: string,
    ) => {
      for (const l of lines) {
        tally.alreadyBooked++;
        tally.alreadyCounted++;
        report.noteFailure(
          "alreadyCounted",
          l.it.name,
          countedAt,
          check.externalCheckId,
        );
        await consume(l, l.consumed, l.consumedQty, l.idem);
      }
    };
    if (ledger && !ledger.ok) {
      // Fail closed: without knowing what this check already moved, a sale
      // could be taken twice and a void could return what was never taken.
      for (const line of planned) {
        fail(
          line.it.name,
          `could not read what earlier imports of this check moved, so nothing was moved: ${ledger.message}`,
          1,
        );
      }
    } else if (
      ledger &&
      ledger.voidBooked &&
      !isVoid &&
      !NEWER_THAN_VOID.has(check)
    ) {
      // F-639: this hub already returned this check's stock for a void, and
      // this copy says it is not voided without saying it is newer: a till's
      // late retry of the "closed" event. Taking the sale again would empty
      // the shelf of bottles the void put back, so nothing moves; ingest
      // counts the copy in olderCopies.
      AFTER_VOID.add(check);
      for (let i = 0; i < planned.length; i++) tally.alreadyBooked++;
    } else if (ledger && ledger.empty && isVoid) {
      // F-393: the check's first arrival is already voided (a nightly export
      // holding a check voided during service). Nothing was taken for it, so
      // nothing is returned; each line is notStock, and errors[] says why.
      for (const line of planned) {
        report.noteFailure(
          "neverTaken",
          line.it.name,
          null,
          check.externalCheckId,
        );
      }
      // F-1433: a sale already in a count took no stock but wrote its
      // consumption row; the void takes that row back (F-1197's mark). Only
      // an item with a count can hold one, so no other item is read.
      const prefix = checkLedgerPrefix(source, check.externalCheckId);
      for (const id of new Set(planned.map((l) => l.inventoryId))) {
        if (!inventoryRead.countedAt.has(id)) continue;
        const name = planned.find((l) => l.inventoryId === id)?.it.name ?? id;
        await reverseConsumption(id, name, `${prefix}${id}:void:0`, false);
      }
    } else if (ledger && ledger.empty) {
      // The first import of a closed check: each line under its own B15 key,
      // exactly as before, so a replay racing this import is still a no-op.
      for (const line of planned) {
        const counted = countedAfterSale(line.inventoryId);
        if (counted) {
          await alreadyCounted([line], counted);
          continue;
        }
        const reason = `POS sale (${line.label}): ${line.it.name}`;
        const error =
          line.bottles > 0
            ? await move(line.inventoryId, -line.bottles, reason, line.idem)
            : await pour(
                line.inventoryId,
                line.pours,
                line.pourMl,
                reason,
                line.idem,
              );
        if (error) {
          fail(line.it.name, error, 1);
          continue;
        }
        affected.add(line.inventoryId);
        const consumption = await consume(
          line,
          line.consumed,
          line.consumedQty,
          line.idem,
        );
        // The consumption row under this key exists, so an earlier import
        // booked this line; the RPC answered with that booking.
        if (consumption === "already") tally.alreadyBooked++;
        else booked();
      }
    } else if (ledger) {
      // A check this hub has moved stock for before: a replay, a correction
      // (a line removed, a quantity changed), or its void. Per item, the
      // check now asks for `want`; earlier imports took `had`; only the
      // difference moves, under a key named by how many rows this check
      // already holds for the item, so a second delivery of the same
      // correction is a no-op and a later, different one is not.
      const prefix = checkLedgerPrefix(source, check.externalCheckId);
      const ids = new Set<string>([
        ...planned.map((l) => l.inventoryId),
        ...ledger.bottles.keys(),
        ...ledger.ml.keys(),
      ]);
      for (const inventoryId of ids) {
        const lines = planned.filter((l) => l.inventoryId === inventoryId);
        const rows = ledger.rows.get(inventoryId) ?? 0;
        const name = lines[0]?.it.name ?? `inventory item ${inventoryId}`;
        const counted = countedAfterSale(inventoryId);

        // Whole bottles.
        const bottleLines = lines.filter((l) => l.bottles > 0);
        const hadBottles = ledger.bottles.get(inventoryId) ?? 0;
        const wantBottles = isVoid
          ? 0
          : bottleLines.reduce((n, l) => n + l.bottles, 0);
        const bottleDiff = wantBottles - hadBottles;
        if (bottleDiff === 0) {
          // Nothing to move: a replay, or a void already returned. A voided
          // line this hub never booked a sale for returns nothing (F-393).
          for (const l of bottleLines) {
            if (rows > 0) await replayConsumption(l, l.bottles);
            else
              report.noteFailure(
                "neverTaken",
                l.it.name,
                null,
                check.externalCheckId,
              );
          }
          // F-1241: the last correction returned the bottles, but its mark
          // (or its row of what stands) may have failed after the stock
          // moved. Retry both: only unmarked rows are marked, and the row
          // under the correction's key is written once.
          const cutKey = isVoid ? undefined : ledger.lastCut.get(inventoryId);
          if (
            cutKey &&
            (await reverseConsumption(inventoryId, name, cutKey, true)) &&
            wantBottles > 0 &&
            bottleLines[0]
          ) {
            await consume(
              bottleLines[0],
              { mode: "whole_bottle" },
              wantBottles,
              cutKey,
            );
          }
        } else if (bottleDiff > 0 && counted) {
          // F-1433: what this copy adds was sold before the count.
          await alreadyCounted(bottleLines, counted);
        } else {
          const kind = isVoid ? "void" : "bottles";
          const key = `${prefix}${inventoryId}:${kind}:${rows}`;
          const error = await move(
            inventoryId,
            -bottleDiff,
            `POS ${isVoid ? "void" : bottleDiff > 0 ? "sale" : "correction"} (bottle): ${name}`,
            key,
          );
          if (error) fail(name, error, bottleLines.length);
          else {
            affected.add(inventoryId);
            for (let i = 0; i < bottleLines.length; i++) booked();
            if (bottleDiff > 0 && bottleLines[0]) {
              // F-1244: an earlier correction down may have returned bottles
              // and failed its mark. This correction ends that cut's retry
              // (it is no longer the latest), so retry it first, before the
              // difference row exists for the mark to touch. Both idempotent.
              const cutKey = ledger.lastCut.get(inventoryId);
              if (
                cutKey &&
                (await reverseConsumption(inventoryId, name, cutKey, true)) &&
                hadBottles > 0
              ) {
                await consume(
                  bottleLines[0],
                  { mode: "whole_bottle" },
                  hadBottles,
                  cutKey,
                );
              }
              await consume(
                bottleLines[0],
                { mode: "whole_bottle" },
                bottleDiff,
                key,
              );
            } else if (
              bottleDiff < 0 &&
              !isVoid &&
              (await reverseConsumption(inventoryId, name, key, true)) &&
              wantBottles > 0 &&
              bottleLines[0]
            ) {
              // F-1197: what the check still holds, as one row under the
              // correction's key, in place of the rows just marked.
              await consume(
                bottleLines[0],
                { mode: "whole_bottle" },
                wantBottles,
                key,
              );
            }
          }
        }

        // Pours and parts of a bottle, in ml.
        const pourLines = lines.filter((l) => l.bottles === 0);
        if (isVoid) {
          for (const l of pourLines) {
            if (ledger.glassVoided.has(l.idem)) {
              tally.alreadyBooked++;
            } else if (
              ledger.pourKeys.has(l.idem) &&
              !l.part &&
              // F-1329: B19 covers a voided GLASS. A cocktail's recipe line
              // is not one, and returning a whole bottle per ingredient for
              // a 30 ml pour is not a reading of B19; it is poured, below.
              !l.it.ingredient
            ) {
              // B19 (unchanged, and wrong — see ADR 0011 Consequences): a
              // partial-volume void returns `qty` WHOLE BOTTLES because
              // record_glass_pour has no reversal mode. Voiding 5 glasses
              // returns 5 bottles. Left as it is because B19 is a recorded
              // decision; superseding it is the founder's call (OD-67).
              //
              // ADR 0093 D5 — the void's key is not the sale's key, or
              // apply_stock_movement's early return answers the void with the
              // sale's transaction and moves nothing. It is derived from the
              // sale's key so a replayed void stays idempotent.
              const error = await move(
                inventoryId,
                l.qty,
                `POS void (${l.label}): ${l.it.name}`,
                `${l.idem}:void`,
              );
              if (error) fail(l.it.name, error, 1);
              else {
                affected.add(inventoryId);
                booked();
              }
            } else if ((ledger.ml.get(inventoryId) ?? 0) > 0) {
              fail(l.it.name, POURED_CANNOT_RETURN, 1);
              report.askForCount(l.it.name, check.externalCheckId);
            } else {
              report.noteFailure(
                "neverTaken",
                l.it.name,
                null,
                check.externalCheckId,
              );
            }
          }
          // F-1197: a voided check holds no sale, so none of the item's
          // consumption rows on it count, bottle or glass.
          await reverseConsumption(
            inventoryId,
            name,
            `${prefix}${inventoryId}:void:${rows}`,
            false,
          );
          continue;
        }
        const hadMl = ledger.ml.get(inventoryId) ?? 0;
        const wantMl = pourLines.reduce((n, l) => n + l.pours * l.pourMl, 0);
        if (wantMl === hadMl) {
          for (const l of pourLines) {
            await replayConsumption(l, l.pours * l.pourMl);
          }
        } else if (wantMl > hadMl && counted) {
          // F-1433: what this copy adds was sold before the count.
          await alreadyCounted(pourLines, counted);
        } else if (wantMl > hadMl) {
          const key = `${prefix}${inventoryId}:ml:${rows}`;
          const error = await pour(
            inventoryId,
            1,
            wantMl - hadMl,
            `POS sale (ml): ${name}`,
            key,
          );
          if (error) fail(name, error, pourLines.length);
          else {
            affected.add(inventoryId);
            for (let i = 0; i < pourLines.length; i++) booked();
            await consume(
              pourLines[0],
              { mode: "volume", ml: wantMl - hadMl },
              1,
              key,
            );
          }
        } else {
          // The till took a pour back off a check after it was poured. A
          // poured glass has no automatic way back (B19 covers only a whole
          // voided check), so a person corrects it; errors[] says so.
          fail(name, POURED_CANNOT_RETURN, pourLines.length);
          report.askForCount(name, check.externalCheckId);
        }
      }
    }
    // Every line that reached no outcome above was skipped by design.
    tally.notStock += items.length - (decidedLines(tally) - decidedBefore);
    STOCK_REPORTS.delete(check);

    if (affected.size > 0) {
      this.logger.debug(
        `POS ${isVoid ? "void" : "close"} [${source}] check=${check.externalCheckId}: stock updated for ${affected.size} item(s)`,
      );
      // Real-time low-stock edge check for every wine this check touched —
      // the same call ToastService makes after its own depletion loop.
      // Without it only Toast raised par alerts, while the generic webhook
      // path (the documented bridge for every other POS in the registry)
      // depleted stock silently. Fire-and-forget: alerting must never slow
      // or block POS ingestion.
      if (this.lowStockAlerts) {
        void this.lowStockAlerts
          .evaluateInventoryItems(restaurantId, [...affected])
          .catch(() => undefined);
      }
    }
    return tally;
  }

  /**
   * F-1329: one linked recipe line of a cocktail sold, as a stock line: a pour
   * of its ml per serve, or whole units. A string is why nothing was taken
   * (the till's import report names it); null is nothing to take.
   *
   * Its key is the cocktail line's own B15 key with the recipe line's place
   * after it, so a replay of the check is a no-op and a void or correction
   * finds what the sale took, as for a glass.
   */
  private planRecipeLine(
    source: string,
    check: CanonicalCheck,
    it: {
      name: string;
      external_item_id: string | null;
      qty: number;
    },
    lineNo: number,
    j: number,
    r: RecipeStockLine,
    inventoryRead: { error: string | null },
    inventories: Map<string, InventoryVolumes>,
  ): PlannedStockLine | string | null {
    // ADR 0141: only a row the house-scoped read returned may move.
    if (inventoryRead.error) {
      return `could not confirm that stock row ${r.inventoryId} belongs to this restaurant, so nothing was taken: ${inventoryRead.error}`;
    }
    const inv = inventories.get(r.inventoryId);
    if (!inv) {
      return `the recipe names stock row ${r.inventoryId}, which does not belong to this restaurant, so nothing was taken`;
    }
    const m = recipeMeasure(r.quantity, r.unit);
    if (m.kind === "unread") {
      return `nothing was taken because ${m.reason} (fix it in the cocktail's recipe)`;
    }
    const qty = Number(it.qty);
    const line: PlannedStockLine = {
      it: {
        name: `${it.name}: ${r.freeText ?? "recipe line"}`,
        external_item_id: it.external_item_id,
        qty,
        price: null,
        inventory_id: r.inventoryId,
        ingredient: true,
      },
      inventoryId: r.inventoryId,
      idem: `pos:${source}:${check.externalCheckId}:${it.external_item_id ?? it.name}:${lineNo}:${j}`,
      label: "recipe",
      inv,
      qty,
      bottles: 0,
      pours: 0,
      pourMl: 0,
      part: false,
      consumed: { mode: "whole_bottle" },
      consumedQty: qty,
    };
    if (m.kind === "units") {
      const units = qty * m.units;
      if (Number.isInteger(units)) {
        line.bottles = units;
        line.consumedQty = units;
        return line;
      }
      if (inv.bottleMl == null) {
        return `the recipe takes ${units} of a bottle, and the stock row carries no bottle size to say how much that is`;
      }
      line.part = true;
      line.pours = 1;
      line.pourMl = Math.round(units * inv.bottleMl);
      if (line.pourMl < 1) return null;
      line.consumed = { mode: "volume", ml: line.pourMl };
      line.consumedQty = 1;
      return line;
    }
    // A pour comes out of one container, as for a glass (resolveSaleVolume).
    const capacity = inv.bottleMl ?? RPC_DEFAULT_BOTTLE_ML;
    if (m.ml > capacity) {
      return `one serve takes ${Math.round(m.ml)} ml, more than the ${capacity} ml bottle it pours from`;
    }
    if (Number.isInteger(qty)) {
      line.pours = qty;
      line.pourMl = Math.round(m.ml);
    } else {
      line.part = true;
      line.pours = 1;
      line.pourMl = Math.round(qty * m.ml);
      line.consumedQty = 1;
    }
    if (line.pourMl < 1) return null;
    line.consumed = { mode: "volume", ml: line.pourMl };
    return line;
  }

  /**
   * What earlier imports of this check moved (sim wave 8, F-393/F-395). Read
   * by the B15 key prefix, so rows written under a line's position before
   * this change count exactly as rows written after it. A read that fails, or
   * answers without a list, is not an empty ledger: the caller moves nothing.
   *
   * F-1238: for a till's check, the `csv_import` keys of the same check are
   * read too. A file import made before the house's till sent anything stored
   * the check under `csv_import` and booked its stock under those keys; once
   * that row is the till's (no `csv_import` row of it stands), the till's copy
   * is a replay of what the import took, not a second sale. While a
   * `csv_import` row of it still stands beside the till's, it is a check of
   * its own (stored twice before F-1195), and its keys are left to it.
   */
  private async readCheckLedger(
    restaurantId: string,
    source: string,
    externalCheckId: string,
  ): Promise<({ ok: true } & CheckLedger) | { ok: false; message: string }> {
    // LIKE treats `_` and `%` as wildcards and a till's check id may carry
    // either, so both (and the escape itself) are escaped.
    const pattern = (s: string) =>
      `${checkLedgerPrefix(s, externalCheckId).replace(
        /[\\%_]/g,
        (c) => `\\${c}`,
      )}%`;
    const tillPrefix = checkLedgerPrefix(source, externalCheckId);
    const importPrefix = checkLedgerPrefix("csv_import", externalCheckId);
    // F-1238: an import's pour key, named as the till's line would be, so a
    // void of the till's copy finds the pour the import booked.
    const asTill = (key: string) =>
      key.startsWith(importPrefix)
        ? `${tillPrefix}${key.slice(importPrefix.length)}`
        : key;
    try {
      const db = this.dbService.getClient();
      const read = (s: string) =>
        Promise.all([
          db
            .from("inventory_transactions")
            .select("idempotency_key, inventory_id, quantity_change")
            .eq("restaurant_id", restaurantId)
            .like("idempotency_key", pattern(s)),
          db
            .from("pour_events")
            .select("idempotency_key, inventory_id, pours, pour_ml")
            .eq("restaurant_id", restaurantId)
            .like("idempotency_key", pattern(s)),
        ]);
      const reads = await Promise.all(
        (source === "csv_import" ? [source] : [source, "csv_import"]).map(read),
      );
      const error = reads.flat().find((r) => r?.error)?.error;
      if (error) return { ok: false, message: error.message ?? "no message" };
      if (reads.flat().some((r) => !Array.isArray(r?.data))) {
        return { ok: false, message: "the stock read returned no list" };
      }
      const tx = { data: reads[0][0].data as any[] };
      const pours = { data: reads[0][1].data as any[] };
      const byImport = (r: any) =>
        String(r.idempotency_key).startsWith(importPrefix);
      const importTx = ((reads[1]?.[0].data ?? []) as any[]).filter(byImport);
      const importPours = ((reads[1]?.[1].data ?? []) as any[]).filter(
        byImport,
      );
      if (importTx.length + importPours.length > 0) {
        const stands = await this.importRowStands(
          restaurantId,
          externalCheckId,
        );
        if (!stands.ok) return stands;
        if (!stands.stands) {
          tx.data.push(...importTx);
          pours.data.push(...importPours);
        }
      }
      const ledger: CheckLedger = {
        empty: tx.data.length === 0 && pours.data.length === 0,
        bottles: new Map(),
        ml: new Map(),
        rows: new Map(),
        pourKeys: new Set(
          pours.data.map((r: any) => asTill(String(r.idempotency_key))),
        ),
        glassVoided: new Set(),
        byKey: new Map(),
        voidBooked: (tx.data as any[]).some((r: any) =>
          /:void(:\d+)?$/.test(String(r.idempotency_key)),
        ),
        cutBack: new Set(),
        lastCut: new Map(),
      };
      // F-1241: the latest correction of each item, by its row number.
      const lastBottles = new Map<string, { n: number; key: string }>();
      const add = (m: Map<string, number>, id: string, n: number) =>
        m.set(id, (m.get(id) ?? 0) + n);
      for (const r of tx.data as any[]) {
        const key = String(r.idempotency_key);
        const id = String(r.inventory_id);
        add(ledger.rows, id, 1);
        // A B19 glass void returns whole bottles under `${pourKey}:void`; it
        // reverses that pour, not a bottle sale.
        const voided = asTill(key).slice(0, -5);
        if (key.endsWith(":void") && ledger.pourKeys.has(voided)) {
          ledger.glassVoided.add(voided);
          continue;
        }
        add(ledger.bottles, id, -(Number(r.quantity_change) || 0));
        add(ledger.byKey, key, -(Number(r.quantity_change) || 0));
        if (/:bottles:\d+$/.test(key) && Number(r.quantity_change) > 0) {
          ledger.cutBack.add(id);
        }
        const n = /:bottles:(\d+)$/.exec(key);
        if (n && Number(n[1]) >= (lastBottles.get(id)?.n ?? -1)) {
          lastBottles.set(id, { n: Number(n[1]), key });
          if (Number(r.quantity_change) > 0) ledger.lastCut.set(id, key);
          else ledger.lastCut.delete(id);
        }
      }
      for (const r of pours.data as any[]) {
        const id = String(r.inventory_id);
        add(ledger.rows, id, 1);
        if (ledger.glassVoided.has(asTill(String(r.idempotency_key)))) continue;
        add(ledger.ml, id, (Number(r.pours) || 0) * (Number(r.pour_ml) || 0));
        add(
          ledger.byKey,
          String(r.idempotency_key),
          (Number(r.pours) || 0) * (Number(r.pour_ml) || 0),
        );
      }
      return { ok: true, ...ledger };
    } catch (err: any) {
      return { ok: false, message: err?.message ?? String(err) };
    }
  }

  /**
   * F-1238: whether a `csv_import` row of this check stands. A read that
   * fails is not "none": the caller moves nothing rather than read the
   * import's stock as the till's.
   */
  private async importRowStands(
    restaurantId: string,
    externalCheckId: string,
  ): Promise<{ ok: true; stands: boolean } | { ok: false; message: string }> {
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_checks")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("source", "csv_import")
      .eq("external_check_id", externalCheckId)
      .limit(1);
    if (error) return { ok: false, message: error.message ?? "no message" };
    if (!Array.isArray(data)) {
      return { ok: false, message: "the check read returned no list" };
    }
    return { ok: true, stands: data.length > 0 };
  }

  /**
   * Queue a line the pipeline refused to act on (decision B20, extended by
   * ADR 0011).
   *
   * `reason` is what makes the queue workable rather than a pile: "we don't
   * know what this item is" and "we know exactly what it is but not how much
   * one sale removes" need different questions asked of the reviewer, and the
   * second arrives already carrying its inventory row.
   *
   * supabase-js resolves with { error } rather than throwing on a constraint
   * violation, so the dedupe check happens on the result, not in a catch. The
   * partial unique index on (restaurant_id, source, external_check_id,
   * external_item_id, reason) WHERE NOT resolved means a 23505 here just means
   * it is already queued and open — not a real failure.
   *
   * ADR 0281: the outcome is returned, and counted into the import report of
   * the check when applyStockEffects is running one. A line that moved no
   * stock and also failed to queue is lost from every list a person reads, so
   * it is counted as failed, never as queued.
   */
  private async queueUnresolvedLine(
    restaurantId: string,
    source: string,
    check: CanonicalCheck,
    it: {
      name: string;
      external_item_id: string | null;
      qty: number;
      price: number | null;
    },
    opts: {
      reason: "unmapped" | "no_sale_volume";
      mappedInventoryId: string | null;
      detail: string;
    },
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const { error } = await this.dbService
      .getClient()
      .from("pos_unresolved_lines")
      .insert({
        restaurant_id: restaurantId,
        source,
        external_check_id: check.externalCheckId,
        external_item_id: it.external_item_id,
        item_name: it.name,
        qty: it.qty,
        price: it.price,
        reason: opts.reason,
        mapped_inventory_id: opts.mappedInventoryId,
        raw: { ...it, unresolved_detail: opts.detail },
      });
    const report = STOCK_REPORTS.get(check);
    if (error && error.code !== "23505") {
      this.logger.warn(
        `Failed to queue unresolved line ${it.name} (${opts.reason}): ${error.message}`,
      );
      if (report) {
        report.tally.failed++;
        report.noteFailure(
          "queue",
          it.name,
          error.message,
          check.externalCheckId,
        );
      }
      return { ok: false, message: error.message ?? "no message" };
    }
    if (report) report.tally.queued[opts.reason]++;
    return { ok: true };
  }

  /**
   * Mirror a depleting POS sale into `wine_consumption_log`.
   *
   * That table is the demand series behind essentially all of the
   * consumption-side analytics — velocity, XYZ classification, reorder point
   * and safety stock, the Holt-Winters forecast, consumption insights, goal
   * progress and the dashboard's pour panels all SELECT from it. Until now
   * nothing in the codebase ever INSERTed a row: POS sales landed only in
   * `inventory_transactions`, so every one of those surfaces read an empty
   * series and reported zero demand forever, for every restaurant. The
   * table's own CHECK constraint (`source IN ('manual','pos','ai_agent')`)
   * shows a POS writer was always the intent.
   *
   * Deliberately non-fatal and after the fact: stock depletion is the
   * contract of this path, and a analytics-mirror failure must never roll it
   * back or block the webhook. Voids are excluded — a voided line never
   * happened, so it is not consumption.
   */
  private async recordConsumption(
    restaurantId: string,
    item: {
      name: string;
      qty: number;
      price: number | null;
      inventory_id: string | null;
      ingredient?: boolean;
    },
    resolved: ResolvedSaleVolume,
    inv: InventoryVolumes | null,
    qty: number,
    idempotencyKey: string,
    occurredAt: string,
  ): Promise<"logged" | "already" | "failed"> {
    if (!item.inventory_id) return "failed";
    try {
      const db = this.dbService.getClient();

      // `consumption_type` stays 'bottle' | 'glass' — the column is
      // varchar(10) with a CHECK on exactly those two
      // (baseline_from_production.sql:6394), and wine_consumption_summary
      // branches on it. So it records the DEPLETION MODE, while
      // `pos_item_mappings.sale_unit` carries the human label ('magnum',
      // 'carafe') and `volume_ml` carries the truth. A 500ml carafe is a
      // 'glass' row of 500ml here — not a lie about the pour, because every
      // volume reader sums volume_ml.
      const volumeMl =
        resolved.mode === "volume"
          ? resolved.ml * qty
          : (inv?.bottleMl ?? RPC_DEFAULT_BOTTLE_ML) * qty;
      const unit = resolved.mode === "volume" ? "glass" : "bottle";
      // F-1198: a till price of 0 is a comped line and stays 0. Only a line
      // the till sent no price for falls back to the menu price; `||` used to
      // book a comp at the full menu price.
      const tillPrice =
        item.price === null || item.price === undefined
          ? null
          : Number(item.price);
      // F-1329: a cocktail's recipe line has no price of its own; the till's
      // is the cocktail's, and the row's menu price is a bottle's or glass's.
      const unitPrice = item.ingredient
        ? null
        : tillPrice !== null && Number.isFinite(tillPrice)
          ? tillPrice
          : (inv?.menuPrice ?? null);

      // Idempotent from 2026-08-24, matching the stock write it follows.
      //
      // The caller reaches here whenever apply_stock_movement returned no error
      // — but that RPC is idempotent and returns the EXISTING transaction for a
      // known key, so "no error" does not mean "this depleted just now". The
      // bare insert that used to be here therefore left stock correct and the
      // consumption log inflated: one check line replayed twice produced three
      // rows. Stock is the number a human checks; the log is the series behind
      // velocity, XYZ, reorder points, Holt-Winters and goal progress. Drifting
      // the invisible one is the worse failure.
      //
      // `ignoreDuplicates` needs the unique index from
      // 20260824190000_pos_voided_and_consumption_idempotency.sql — the
      // constraint lives in the database so a second caller cannot reintroduce
      // this by writing its own insert.
      //
      // `notes` is the idempotency key verbatim. It used to be `pos:${key}`
      // while the key already began with "pos:", rendering "pos:pos:…".
      //
      // Measured on the first ADR 0093 live day (2026-09-03): this was an
      // `upsert(..., { onConflict: "restaurant_id,notes" })`, and EVERY call
      // failed with 42P10 "there is no unique or exclusion constraint matching
      // the ON CONFLICT specification" — the index above is PARTIAL
      // (`where notes is not null and source = 'pos'`), and Postgres only
      // matches a partial index to a conflict target that repeats its
      // predicate, which PostgREST cannot express. So the mirror had written
      // zero rows for every POS sale since 2026-08-24 while the error was
      // logged and nothing else noticed. The honest shape is a plain INSERT
      // with the partial unique index as the backstop: a replay raises 23505,
      // which is the idempotent no-op the upsert was meant to be.
      const { error } = await db.from("wine_consumption_log").insert({
        restaurant_id: restaurantId,
        inventory_id: item.inventory_id,
        wine_name: item.name,
        consumption_type: unit,
        quantity: qty,
        volume_ml: volumeMl,
        unit_price: unitPrice,
        total_revenue: unitPrice != null ? unitPrice * qty : null,
        source: "pos",
        notes: idempotencyKey,
        // ADR 0281: the sale's instant, not the import's. Both columns, because
        // the readers of this series filter on created_at today and moving them
        // to recorded_at is another lane's change.
        recorded_at: occurredAt,
        created_at: occurredAt,
      });
      if (error?.code === "23505") {
        // Already mirrored under this key — a webhook replay. Nothing to add.
        return "already";
      }

      // This result used to be discarded, which made the comment above a claim
      // the code did not honour. supabase-js RESOLVES with `{ data, error }` on
      // a database error rather than throwing, so the `catch` below only ever
      // caught client/network faults — a rejected upsert vanished in silence.
      //
      // That is a SILENT OMISSION, not a corruption, and it is the harder of the
      // two to live with: a wrong row can be found and repaired by querying for
      // it, whereas a missing row leaves no trace at all. Nothing records that
      // the event failed to land, so the damage cannot be enumerated, bounded or
      // repaired — while velocity, XYZ, reorder points, Holt-Winters and goal
      // progress all quietly under-count over a ledger that looks complete.
      if (error) {
        this.logger.error(
          `wine_consumption_log insert FAILED for ${item.name} ` +
            `(r=${restaurantId}, key=${idempotencyKey}): ${error.message} ` +
            `[${error.code ?? "no-code"}] — the demand series is now short one ` +
            `event and nothing else records that.`,
        );
        return "failed";
      }
      return "logged";
    } catch (err: any) {
      this.logger.warn(
        `Consumption log write failed for ${item.name}: ${err?.message}`,
      );
      return "failed";
    }
  }

  async upsertItemMapping(restaurantId: string, mapping: any) {
    // sale_unit was missing from this row until 2026-08-24, and this is the ONLY
    // writer of the column — used by both auto-map and human approve. So all 92
    // production mappings carried sale_unit = null, the `?? "bottle"` fallback in
    // applyStockEffects fired unconditionally, and EVERY BY-THE-GLASS SALE
    // DEPLETED A WHOLE BOTTLE. Confirmed at runtime: a glass-priced item booked
    // volume_ml 750 instead of 150.
    //
    // ADR 0011 reopened the vocabulary. sale_unit is an OPEN human label —
    // 'glass', 'bottle', 'half_bottle', 'magnum', 'carafe', 'taster',
    // 'flight' — for reporting and the UI, never for arithmetic. Only the two
    // historical labels still carry a derivation, and only when
    // sale_volume_ml is absent. What is still rejected is malformed input:
    // a non-string, or a string that is empty or whitespace-only, is a bug in
    // the caller, not a label anyone chose. Stored trimmed, case preserved —
    // the derivation compares case-insensitively.
    const rawUnit = mapping.sale_unit ?? null;
    let saleUnit: string | null = null;
    if (rawUnit !== null) {
      if (typeof rawUnit !== "string" || rawUnit.trim() === "") {
        throw new Error(
          `sale_unit must be a non-empty label or null — got ${JSON.stringify(rawUnit)}`,
        );
      }
      if (rawUnit.trim().length > 32) {
        throw new Error("sale_unit must be 32 characters or fewer");
      }
      saleUnit = rawUnit.trim();
    }

    // sale_volume_ml is the number the depletion actually reads, so a wrong one
    // is a silent stock error. The plausibility band catches the mistake that
    // matters: 1.5 typed into an ml field meaning 1.5 LITRES would otherwise
    // pass as "positive" and pour 1.5ml per sale forever.
    const rawVolume = mapping.sale_volume_ml ?? null;
    let saleVolumeMl: number | null = null;
    if (rawVolume !== null) {
      const n =
        typeof rawVolume === "number"
          ? rawVolume
          : typeof rawVolume === "string" && rawVolume.trim() !== ""
            ? Number(rawVolume)
            : NaN;
      if (
        !Number.isFinite(n) ||
        n < MIN_PLAUSIBLE_SALE_ML ||
        n > MAX_PLAUSIBLE_SALE_ML
      ) {
        throw new Error(
          `sale_volume_ml must be a volume in millilitres between ${MIN_PLAUSIBLE_SALE_ML} and ${MAX_PLAUSIBLE_SALE_ML}, or null — got ${JSON.stringify(rawVolume)}`,
        );
      }
      saleVolumeMl = n;
    }

    const row = {
      restaurant_id: restaurantId,
      source: mapping.source || "*",
      external_item_id: mapping.external_item_id ?? "",
      item_name: mapping.item_name ?? "",
      category: mapping.category ?? null,
      is_wine: mapping.is_wine === true,
      master_wine_id: mapping.master_wine_id ?? null,
      inventory_id: mapping.inventory_id ?? null,
      sale_unit: saleUnit,
      sale_volume_ml: saleVolumeMl,
      // F-1329: the cocktail this button sells, written only when sent, so
      // an auto-map or a sale-unit review never unlinks one. The database
      // refuses another house's cocktail (till_cocktail_is_the_house_s).
      ...(mapping.cocktail_id !== undefined
        ? { cocktail_id: mapping.cocktail_id || null }
        : {}),
      updated_at: new Date().toISOString(),
    };
    if (!row.external_item_id && !row.item_name)
      throw new Error("Mapping needs external_item_id or item_name");
    // ADR 0141, second correction 2026-09-12. `inventory_id` is a plain FK to
    // restaurant_inventory: nothing ties the item's house to this row's. This
    // is the ONE writer of the column -- POST /pos-hub/mappings, the catalog
    // matcher's auto-map and approve, and the sale-unit review all come here --
    // and it stored whatever id it was handed, so a mapping could point a POS
    // button at another house's shelf and every sale of it poured from there.
    // Checked before the upsert, and only when an item is named: a mapping
    // with no inventory id moves no stock.
    if (row.inventory_id) {
      await assertInventoryBelongsToRestaurant(
        this.dbService.getClient(),
        restaurantId,
        row.inventory_id,
        "upsertItemMapping",
        this.logger,
      );
    }
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_item_mappings")
      .upsert(row, {
        onConflict: "restaurant_id,source,external_item_id,item_name",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async listItemMappings(restaurantId: string) {
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_item_mappings")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  // =========================================================================
  // Table resolution + status
  // =========================================================================

  /**
   * Returns the tables AND whether the lookup failed, because those are
   * different facts and the caller writes a row either way.
   *
   * supabase-js RESOLVES with `{ data, error }` on a database error rather than
   * throwing, so the previous `const { data } = await …; return data || []`
   * turned a failed query into an empty table list. Every check then resolved
   * `table_id: null` (`resolveTable` finds nothing in an empty array) while the
   * ingest reported success with zero errors — indistinguishable from a
   * restaurant that genuinely has no tables, and the mechanism that manufactures
   * the "table_id is null on every row" symptom the POS bridge was diagnosed on.
   *
   * An empty result is NOT an error and must not be reported as one; only a real
   * failure is. Conflating them would trade a silent failure for a false alarm.
   */
  private async loadTables(
    restaurantId: string,
  ): Promise<{ tables: any[]; error: string | null }> {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_tables")
      .select("id, label, pos_refs")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);

    if (error) {
      this.logger.error(
        `restaurant_tables lookup failed for r=${restaurantId} — checks will be ` +
          `written without a table_id rather than with a wrong one: ${error.message}`,
      );
      return { tables: [], error: `restaurant_tables: ${error.message}` };
    }
    return { tables: data || [], error: null };
  }

  private resolveTable(
    tableRef: string | null | undefined,
    source: string,
    tables: any[],
  ): string | null {
    if (!tableRef) return null;
    const ref = String(tableRef).toLowerCase();
    for (const t of tables) {
      const posRef = t.pos_refs?.[source];
      if (posRef && String(posRef).toLowerCase() === ref) return t.id;
    }
    const byLabel = tables.find(
      (t) =>
        String(t.label).toLowerCase() === ref ||
        `table ${String(t.label).toLowerCase()}` === ref,
    );
    return byLabel?.id ?? null;
  }

  /**
   * "Is my POS connection live?" — the one screen an operator opens to answer
   * exactly that.
   *
   * The `error` used to be discarded, so a failed `pos_checks` read returned
   * `totalChecks: 0, sources: []` and Settings → POS rendered
   * "Ingestion (30d): 0 checks from this source" — the same sentence a
   * genuinely idle integration produces. A status endpoint that cannot tell
   * "dead" from "quiet" is answering the wrong question, and it answers it in
   * the reassuring direction.
   *
   * Now it returns `unavailable: true` with `totalChecks: null`, which the
   * client renders as an em dash (ADR 0051). A real measured zero still
   * renders `0`.
   */
  async getStatus(restaurantId: string) {
    const client = this.dbService.getClient();
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    // Read whole or refused (ADR 0292, F-330). Unranged, this stopped at
    // PostgREST's 1,000 rows: a house with ~1,900 checks a month read "1000
    // checks", and "last check" came from whichever thousand came back.
    let rows: any[];
    try {
      rows = await readWholeWindow<any>(
        "The till checks of the last 30 days",
        () =>
          client
            .from("pos_checks")
            .select("id, source, opened_at, closed_at", { count: "exact" })
            .eq("restaurant_id", restaurantId)
            .gte("opened_at", since30),
      );
    } catch (err: any) {
      this.logger.error(
        `pos_checks status read failed for r=${restaurantId} — reporting ` +
          `UNAVAILABLE rather than "0 checks": ${err?.message ?? String(err)}`,
      );
      return {
        windowDays: 30,
        unavailable: true as const,
        totalChecks: null,
        sources: null,
        generatedAt: new Date().toISOString(),
      };
    }
    const bySource = new Map<
      string,
      { checks: number; open: number; latest: string | null }
    >();
    for (const r of rows) {
      const s = bySource.get(r.source) || { checks: 0, open: 0, latest: null };
      s.checks++;
      if (!r.closed_at) s.open++;
      if (!s.latest || r.opened_at > s.latest) s.latest = r.opened_at;
      bySource.set(r.source, s);
    }
    return {
      windowDays: 30,
      unavailable: false as const,
      totalChecks: rows.length,
      sources: Array.from(bySource.entries()).map(([source, s]) => ({
        source,
        providerName: PROVIDER_BY_KEY[source]?.name ?? source,
        ...s,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
