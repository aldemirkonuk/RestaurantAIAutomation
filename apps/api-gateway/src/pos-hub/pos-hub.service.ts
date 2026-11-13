import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from "@nestjs/common";
import * as crypto from "crypto";
import { DatabaseService } from "../database/database.service";
import { assertInventoryBelongsToRestaurant } from "../common/tenant/assert-inventory-belongs-to-restaurant";
import { LowStockAlertsService } from "../notifications/low-stock-alerts.service";
import { CanonicalCheck, CheckChannel } from "./pos-types";
import { ADAPTERS } from "./pos-adapters";
import {
  PROVIDER_BY_KEY,
  POS_PROVIDERS,
  registrySummary,
} from "./pos-provider.registry";
import { NotificationsService } from "../notifications/notifications.service";
import { AreaRoutingService } from "../areas/area-routing.service";
import {
  fileRefusedChecksNote,
  type RefusedCheck,
  type RefusedChecksNote,
} from "./refused-checks-note";

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
 * - a date alone is UTC midnight, which is how ECMAScript reads a date-only
 *   form;
 * - a date and time with no zone is `Date.parse`'s reading in the gateway's
 *   own zone, kept only when it lies within 14 hours of the written wall
 *   clock.
 *
 * Anything else is NaN: saleInstant falls back, and ingest() refuses the
 * check.
 */
function readClosedAt(raw: string): number {
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
  if (hh === undefined || zone === "Z") return wallMs;
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

/**
 * Date a closed check's stock by when it closed, not by when it arrived.
 *
 * The string is read once, here, by readClosedAt, and only the result
 * travels. Handing a string the gateway has read to Postgres as well would
 * have it read a second time, and where the two readings differ (a zone-less
 * string when the gateway's zone and the database session's differ; measured
 * in the ADR 0090 audit of PR #603 at 01ac04eaa) the ledger, the consumption
 * row and the check could land on different days. So a zone-less string is
 * read in the gateway's own zone for all of them. A value readClosedAt does
 * not read (a dotted or slashed date such as "03.10.2026" or
 * "10/03/2026 3:00 PM", a two-digit year such as "1/1/50", a POSIX-looking
 * "UTC+3", RFC 2822, "12", "2026-02-30", a number) falls back here, and
 * ingest() refuses its check: the founder ruled that such a date is not
 * imported rather than guessed at (ADR 0281, F4).
 *
 * Pure, so the boundaries are tested without a database. `nowMs` is the
 * import's clock, read once per check.
 */
export function saleInstant(closedAt: unknown, nowMs: number): SaleInstant {
  const raw = typeof closedAt === "string" ? closedAt.trim() : "";
  const parsed = raw ? readClosedAt(raw) : NaN;
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
 * that moved stock.
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
   * pos_checks.items for the analytics that read it), or a quantity that
   * rounds to zero.
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

type StockFailureKind = "stock" | "queue" | "consumption";

/**
 * What saving a mapping did to its item's sales that arrived before it
 * (POS-2), in POS lines. `unavailable`: the queue could not be read, so the
 * counts are unknown (null), not zeros (ADR 0020).
 */
export interface PastSalesReplay {
  status: "done" | "unavailable";
  /** Stock moved now. */
  applied: number | null;
  /** Already moved (a re-sent check); cleared, not moved again. */
  already_applied: number | null;
  /** Nothing to move: a voided check, or mapped as not stock. */
  cleared_without_stock: number | null;
  /** Still queued: no volume yet, or no stored check to replay from. */
  still_waiting: number | null;
  /** The stock write failed; still queued, the next save retries. */
  failed: number | null;
  /** Moved, but the queue row could not be cleared. */
  not_cleared: number | null;
  /** More were queued than one save replays. */
  truncated: boolean;
  message: string;
}

type PastSalesCount = {
  [K in Exclude<
    keyof PastSalesReplay,
    "status" | "message" | "truncated"
  >]: number;
} & { truncated: boolean };

type MappingIdentity = {
  source?: string | null;
  external_item_id?: string | null;
  item_name?: string | null;
} | null;

/**
 * Lines one save books (stock moved, or had moved); a refused line uses none
 * (QA round 11b). The rest wait for the next save.
 */
const REPLAY_LINE_LIMIT = 500;
/**
 * Lines one save tries, booked or not: what bounds a save's work when the
 * rows ahead keep failing or keep waiting (QA round 11b). Checked between
 * checks, so a save can pass it by one check's lines less one.
 */
const REPLAY_TRY_LIMIT = 2000;
/** Open queue rows read per page while a save gathers its item's rows. */
const REPLAY_PAGE_ROWS = 500;
/** Most open queue rows one read gathers; past it the save says more wait. */
const REPLAY_SCAN_ROWS = 5000;
/**
 * Most ids per `.in()` read: 500 made a 17 KB URL, past the 16 KB limit
 * (QA round 2, U-1). 100, as PR #803 chose for GET /wines?ids=.
 */
const REPLAY_IDS_PER_READ = 100;

/** What one save has left: lines to book, and lines to try (QA round 11b). */
type ReplayBudget = { left: number; tries: number };
const spent = (b: ReplayBudget) => b.left <= 0 || b.tries <= 0;
const NOTHING_TRIED = { tried: 0, booked: 0 } as const;

const emptyPastSales = (): PastSalesCount => ({
  applied: 0,
  already_applied: 0,
  cleared_without_stock: 0,
  still_waiting: 0,
  failed: 0,
  not_cleared: 0,
  truncated: false,
});

const sales = (n: number) => `${n} past sale${n === 1 ? "" : "s"}`;

function finishPastSales(c: PastSalesCount): PastSalesReplay {
  const said: Array<[number, string]> = [
    [c.applied, "of this item came off stock."],
    [c.already_applied, "had already come off stock; none was taken twice."],
    [
      c.cleared_without_stock,
      "needed no stock (a voided check, or not a stock item).",
    ],
    [
      c.still_waiting,
      "stayed in the unmatched list: the item needs a pour size, or the check could not be found.",
    ],
    [
      c.failed,
      "could not be taken off stock and stayed in the unmatched list; save the mapping again to retry.",
    ],
    [
      c.not_cleared,
      "came off stock but stayed listed as unmatched because the list could not be updated; saving again will not take them twice.",
    ],
  ];
  const parts = said.filter(([n]) => n > 0).map(([n, t]) => `${sales(n)} ${t}`);
  if (c.truncated)
    parts.push("More sales are waiting; save the mapping again to apply them.");
  if (!parts.length) parts.push("No past sales of this item were waiting.");
  return { status: "done", ...c, message: parts.join(" ") };
}

const pastSalesUnavailable = (): PastSalesReplay => ({
  status: "unavailable",
  applied: null,
  already_applied: null,
  cleared_without_stock: null,
  still_waiting: null,
  failed: null,
  not_cleared: null,
  truncated: false,
  message:
    "The mapping is saved, but its earlier sales could not be read or replayed. Save it again to finish; no sale is taken twice.",
});

/**
 * A PostgREST `ilike` pattern for `s` that matches it, case aside, and never
 * matches less. It can match MORE: PostgREST reads every `*` in a like
 * pattern as `%` before Postgres sees it, and no escape survives that, so a
 * `*` is sent as `_` (any one character). The caller re-checks equality.
 */
function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "_");
}

/**
 * Whether `found` (a pos_item_mappings row resolveWine would use) is the
 * mapping just saved: the columns of its unique key, the house aside.
 */
function sameMapping(found: any | null, saved: MappingIdentity): boolean {
  if (!found || !saved) return false;
  return (
    String(found.external_item_id ?? "") ===
      String(saved.external_item_id ?? "") &&
    String(found.item_name ?? "") === String(saved.item_name ?? "")
  );
}

/**
 * The import report a check's stock effects count into (ADR 0281), keyed by
 * the check object, so two imports running at once never share one. Module
 * scope rather than an instance field, so a service built without its
 * constructor (as several specs build it) still has it.
 */
const STOCK_REPORTS = new WeakMap<object, StockReport>();

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
): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  return `${providerKey}:${restaurantId}.${body}`;
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
 * :{lineNo}` (decision B15) for every stock write, so webhook replays and
 * re-imports are safe.
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
  ];

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
   * `"<provider>:<restaurantId>." + rawBody`, so a signature minted for one
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

    try {
      const signedPayload =
        resolved.source === "legacy_global"
          ? rawBody
          : scopedSignedPayload(providerKey, restaurantId, rawBody);

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
        received: 0,
        upserted: 0,
        channels: tallyChannels([], providerKey).tally,
        wineItemsDetected: 0,
        refusedUnreadableDate: 0,
        errors: ["No recognizable checks in payload"],
        stock: stock.tally,
        bellNote: null,
      };

    const [mappingLookup, tableLookup] = await Promise.all([
      this.loadItemMappings(restaurantId, providerKey),
      this.loadTables(restaurantId),
    ]);
    const mappings = mappingLookup.rows;
    if (mappingLookup.error) errors.push(mappingLookup.error);
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
    let wineItems = 0;
    let refusedUnreadableDate = 0;
    const refusedChecks: RefusedCheck[] = [];
    const client = this.dbService.getClient();

    for (const check of checks) {
      try {
        // ADR 0281: the one reading of this check's closed_at, taken before
        // the check is stored. The check row and every stock and consumption
        // row below are dated from it (see SaleInstant).
        const when = saleInstant(check.closedAt, Date.now());
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
        const items = check.items.map((it) => {
          const mapped = this.resolveWine(it.name, it.externalItemId, mappings);
          const is_wine =
            typeof it.is_wine === "boolean" ? it.is_wine : mapped.isWine;
          if (is_wine) wineItems++;
          return {
            name: it.name,
            external_item_id: it.externalItemId ?? null,
            category: it.category ?? mapped.category ?? null,
            qty: it.qty,
            price: it.price,
            is_wine,
            master_wine_id: it.master_wine_id ?? mapped.masterWineId ?? null,
            inventory_id: mapped.inventoryId,
            sale_unit: mapped.saleUnit,
            sale_volume_ml: mapped.saleVolumeMl,
          };
        });

        const row = {
          restaurant_id: restaurantId,
          source: providerKey,
          external_check_id: check.externalCheckId,
          table_id: this.resolveTable(check.tableRef, providerKey, tables),
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
          items,
          raw: check.raw ?? null,
        };
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
              providerKey,
              check,
              items,
              stock,
              when,
            );
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
    // Grouped, bounded: one line per (failure kind, item), not one per line.
    errors.push(...stock.errorLines());
    const t = stock.tally;
    this.logger.log(
      `POS ingest [${providerKey}] r=${restaurantId}: ${upserted}/${checks.length} checks, ${refusedUnreadableDate} refused for an unreadable closed_at, ${wineItems} wine items; ` +
        `stock booked ${t.booked}, already ${t.alreadyBooked}, queued ${t.queued.unmapped + t.queued.no_sale_volume}, failed ${t.failed}`,
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
      received: checks.length,
      upserted,
      channels: channels.tally,
      wineItemsDetected: wineItems,
      refusedUnreadableDate,
      errors,
      stock: t,
      bellNote,
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
        "external_item_id, item_name, category, is_wine, master_wine_id, inventory_id, sale_unit, sale_volume_ml",
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
  ): Promise<{ volumes: Map<string, InventoryVolumes>; error: string | null }> {
    const out = new Map<string, InventoryVolumes>();
    if (!inventoryIds.length) return { volumes: out, error: null };
    // ADR 0141, second correction 2026-09-12: SCOPED TO THE HOUSE. This read
    // had no restaurant filter, so it answered for another house's item as
    // readily as for this one's, and the caller poured whatever it returned.
    // An id it does not return is now, by construction, not this house's --
    // `applyStockEffects` queues it rather than pouring it.
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_inventory")
      .select("id, bottle_size_ml, pour_size_ml, menu_price_current")
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
    }
    return { volumes: out, error: error ? error.message : null };
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
  private findMapping(
    name: string,
    externalItemId: string | null | undefined,
    mappings: any[],
  ): any | null {
    const lower = (name || "").toLowerCase();
    const byId = externalItemId
      ? mappings.find(
          (m) => m.external_item_id && m.external_item_id === externalItemId,
        )
      : null;
    return (
      byId ??
      mappings.find(
        (m) => m.item_name && lower === String(m.item_name).toLowerCase(),
      ) ??
      null
    );
  }

  private resolveWine(
    name: string,
    externalItemId: string | null | undefined,
    mappings: any[],
  ): {
    isWine: boolean;
    masterWineId: string | null;
    category: string | null;
    inventoryId: string | null;
    saleUnit: string | null;
    saleVolumeMl: number | null;
  } {
    const lower = (name || "").toLowerCase();
    const byName = this.findMapping(name, externalItemId, mappings);
    if (byName) {
      return {
        isWine: byName.is_wine === true,
        masterWineId: byName.master_wine_id ?? null,
        category: byName.category ?? null,
        inventoryId: byName.inventory_id ?? null,
        saleUnit: (byName.sale_unit as string | null) ?? null,
        saleVolumeMl:
          byName.sale_volume_ml == null ? null : Number(byName.sale_volume_ml),
      };
    }
    const isWine = PosHubService.WINE_WORDS.some((w) => lower.includes(w));
    return {
      isWine,
      masterWineId: null,
      category: null,
      inventoryId: null,
      saleUnit: null,
      saleVolumeMl: null,
    };
  }

  // =========================================================================
  // Stock effects (decision B13/B18/B19/B20) — closed checks only
  // =========================================================================

  private async applyStockEffects(
    restaurantId: string,
    source: string,
    check: CanonicalCheck,
    items: Array<{
      name: string;
      external_item_id: string | null;
      qty: number;
      price: number;
      is_wine: boolean;
      inventory_id: string | null;
      sale_unit: string | null;
      sale_volume_ml: number | null;
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

    // One read for the whole check (ADR 0011): resolving a sale volume needs
    // the inventory row's bottle/pour sizes before any RPC is issued.
    const inventoryRead = await this.loadInventoryVolumes(restaurantId, [
      ...new Set(
        items
          .filter((it) => it.is_wine && it.inventory_id)
          .map((it) => it.inventory_id as string),
      ),
    ]);
    const inventories = inventoryRead.volumes;
    // queueUnresolvedLine counts its own outcome into this check's report, so
    // the three queue call sites below stay exactly as they were.
    STOCK_REPORTS.set(check, report);
    tally.lines += items.length;
    const decidedBefore = decidedLines(tally);

    for (let lineNo = 0; lineNo < items.length; lineNo++) {
      const it = items[lineNo];
      // Stock-scoped skip only. The full line set — food included — was
      // already persisted verbatim to pos_checks.items at the upsert above
      // (ingest(), ~line 202), before this loop runs, and is already read by
      // TableAnalyticsService.getBasketAffinity() for wine/dish co-occurrence
      // with no is_wine filter. Do not read this line as "food is discarded" —
      // it isn't; only stock depletion (which food has no inventory row for)
      // is skipped here. See .planning/BEVERAGE_CATALOGUE_PLAN.md register A11.
      if (!it.is_wine) continue;

      const qty = Math.max(0, Math.round(Number(it.qty) || 0));
      if (qty <= 0) continue;

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

        // B15: depletion idempotency key.
        const idem = `pos:${source}:${check.externalCheckId}:${it.external_item_id ?? it.name}:${lineNo}`;
        // Reporting label only — never arithmetic (ADR 0011).
        const label = it.sale_unit ?? resolved.mode;

        // supabase-js resolves RPC failures as { error } rather than
        // throwing, so — as in the receiving-door bug this plan's spine
        // repair fixed — the error field must be checked explicitly or a
        // failed depletion reports success silently.
        let rpcError: { message?: string } | null = null;
        if (resolved.mode === "volume" && !isVoid) {
          // record_glass_pour has taken an arbitrary p_pour_ml since the
          // baseline (baseline_from_production.sql:1132); the app layer was
          // the only binary part. It is passed explicitly rather than as null
          // so the ml that moves stock and the ml written to the consumption
          // log are the same number, decided here.
          ({ error: rpcError } = await db.rpc("record_glass_pour", {
            p_inventory_id: it.inventory_id,
            p_pours: qty,
            p_pour_ml: Math.round(resolved.ml),
            p_location_id: null,
            p_source: "pos",
            p_reason: `POS sale (${label}): ${it.name}`,
            p_idempotency_key: idem,
            // ADR 0281: dated by the check, not by its arrival.
            p_occurred_at: when.at,
          }));
        } else if (isVoid) {
          // A void gives back what its sale (`idem`) BOOKED, in the unit it was
          // booked in -- ml of a glass sale, bottles of a bottle sale -- not by
          // today's mapping, and at most once across every void of that sale.
          // No booked sale is an error, never a quiet 0 (QA 8c; ADR 0011).
          //
          // ADR 0093 D5 -- THE VOID'S KEY IS NOT THE SALE'S KEY. Reusing `idem`
          // hit the sale's idempotent early return and moved nothing.
          // `${idem}:void` is derived from it, so a replayed void stays a no-op
          // (pos-hub.void-idempotency.spec.ts).
          const { data: back, error } = await db.rpc("return_glass_pour", {
            p_restaurant_id: restaurantId,
            p_inventory_id: it.inventory_id,
            p_sale_key: idem,
            p_pours: qty,
            p_idempotency_key: `${idem}:void`,
            p_occurred_at: when.at,
          });
          rpcError = error;
          if (!error && Number((back as any)?.overflow_ml) > 0) {
            this.logger.warn(
              `Void of ${it.name}: ${(back as any).overflow_ml} ml not added back (${(back as any).reason})`,
            );
          }
        } else {
          // Whole-bottle sales.
          ({ error: rpcError } = await db.rpc("apply_stock_movement", {
            p_inventory_id: it.inventory_id,
            p_stock_state: "live",
            p_delta: -qty,
            p_transaction_type: "sale",
            p_source: "pos",
            p_reason: `POS sale (${label}): ${it.name}`,
            p_idempotency_key: idem,
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
          }));
        }

        if (rpcError) {
          this.logger.warn(
            `Stock effect failed for ${it.name} (${label}) on check ${check.externalCheckId}: ${rpcError.message}`,
          );
          tally.failed++;
          report.noteFailure(
            "stock",
            it.name,
            rpcError.message,
            check.externalCheckId,
          );
        } else {
          affected.add(it.inventory_id);
          if (!isVoid) {
            const consumption = await this.recordConsumption(
              restaurantId,
              it,
              resolved,
              inv,
              qty,
              idem,
              when.at,
            );
            if (consumption === "already") {
              // The consumption row under this key exists, so an earlier
              // import booked this line; the RPC answered with that booking.
              tally.alreadyBooked++;
            } else {
              booked();
              if (consumption === "failed") {
                tally.consumptionNotWritten++;
                report.noteFailure(
                  "consumption",
                  it.name,
                  "the stock moved; see the gateway log for the database error",
                  check.externalCheckId,
                );
              }
            }
          } else {
            booked();
          }
        }
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
      price: number;
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
      price: number;
      inventory_id: string | null;
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
      const unitPrice = Number(item.price) || inv?.menuPrice || null;

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
    // POS-2: replay this item's queued sales; the reply says what moved.
    const pastSales = await this.replayUnresolvedLines(restaurantId, data);
    return { ...data, past_sales: pastSales };
  }

  /**
   * Replay the open `pos_unresolved_lines` of a mapping's item through the
   * live depletion path (POS-2).
   *
   * Lines are replayed from the stored check (`pos_checks.items`), not the
   * queue row: the queue keeps one row per (check, item, reason), so two
   * lines of one wine on a check share a row. Every line keeps its position
   * and only this item's lines count as stock, so each carries the live key
   * `pos:{source}:{check}:{item}:{lineNo}`. That key makes it idempotent per
   * line: the stock RPCs and the consumption log answer a seen key by moving
   * nothing, so a line replayed twice, or replayed then re-sent by the till,
   * depletes once. Every read and the clearing write are scoped to
   * `restaurant_id`. Never throws: the mapping is saved already, and a replay
   * that cannot run says so (ADR 0020).
   */
  async replayUnresolvedLines(
    restaurantId: string,
    mapping: MappingIdentity,
  ): Promise<PastSalesReplay> {
    try {
      return await this.replayUnresolvedLinesOrThrow(restaurantId, mapping);
    } catch (err: any) {
      this.logger.error(
        `Replaying queued POS lines failed for r=${restaurantId}: ${err?.message ?? err}`,
      );
      return pastSalesUnavailable();
    }
  }

  private async replayUnresolvedLinesOrThrow(
    restaurantId: string,
    mapping: MappingIdentity,
  ): Promise<PastSalesReplay> {
    const out = emptyPastSales();
    if (!mapping) return finishPastSales(out);
    const db = this.dbService.getClient();
    const source = mapping.source || "*";
    const externalId = (mapping.external_item_id ?? "").trim();
    const name = (mapping.item_name ?? "").trim();
    if (!externalId && !name) return finishPastSales(out);

    // As resolveWine finds a mapping: by item id, or by name without case.
    // Every open row in turn, a page at a time (QA 8c, QA round 15): see
    // sendToTheBack. A fixed order let rows that never settle hide the rest.
    const readAll = async (
      byName: boolean,
    ): Promise<{ rows: any[]; error: string | null; capped: boolean }> => {
      const all: any[] = [];
      for (let from = 0; ; from += REPLAY_PAGE_ROWS) {
        let q = db
          .from("pos_unresolved_lines")
          .select(
            "id, created_at, replay_tried_at, source, external_check_id, external_item_id, item_name, reason, qty, raw",
          )
          .eq("restaurant_id", restaurantId)
          .eq("resolved", false);
        if (source !== "*") q = q.eq("source", source);
        q = byName
          ? q.ilike("item_name", escapeLikePattern(name))
          : q.eq("external_item_id", externalId);
        const { data, error } = await q
          .order("replay_tried_at", { ascending: true, nullsFirst: true })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + REPLAY_PAGE_ROWS - 1);
        if (error) return { rows: all, error: error.message, capped: false };
        const page = data || [];
        all.push(...page);
        if (page.length < REPLAY_PAGE_ROWS)
          return { rows: all, error: null, capped: false };
        // Bounded (QA round 11b): rows past it wait for a later save.
        if (all.length >= REPLAY_SCAN_ROWS)
          return { rows: all, error: null, capped: true };
      }
    };
    const reads: Array<{ byName: boolean }> = [];
    if (externalId) reads.push({ byName: false });
    if (name) reads.push({ byName: true });
    const results = await Promise.all(reads.map((r) => readAll(r.byName)));
    const rows = new Map<string, any>();
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.capped) out.truncated = true;
      if (r.error) {
        this.logger.error(
          `pos_unresolved_lines read failed for r=${restaurantId}: ${r.error}`,
        );
        return pastSalesUnavailable();
      }
      for (const row of r.rows) {
        // The name read can over-match (escapeLikePattern): keep only the
        // equality resolveWine itself uses.
        if (
          reads[i].byName &&
          String(row.item_name ?? "").toLowerCase() !== name.toLowerCase()
        )
          continue;
        rows.set(String(row.id), row);
      }
    }
    if (!rows.size) return finishPastSales(out);

    const bySource = new Map<string, any[]>();
    // The read's own order, kept across the two reads (QA round 15).
    const inTurn = [...rows.values()].sort(
      (a, b) =>
        Number(a.replay_tried_at != null) - Number(b.replay_tried_at != null) ||
        String(a.replay_tried_at ?? "").localeCompare(
          String(b.replay_tried_at ?? ""),
        ) ||
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
        String(a.id).localeCompare(String(b.id)),
    );
    // Every row this save looks at; the ones it leaves open go to the back.
    const looked = new Set<string>();
    for (const row of inTurn) {
      const list = bySource.get(row.source) ?? [];
      list.push(row);
      bySource.set(row.source, list);
    }

    // Every mapping read comes first: without one, which rows belong to this
    // mapping is unknown, so nothing is replayed and the reply says so.
    const mappingsBySource = new Map<string, any[]>();
    for (const lineSource of bySource.keys()) {
      const mappingRead = await this.loadItemMappings(restaurantId, lineSource);
      if (mappingRead.error) {
        this.logger.error(
          `Replay could not read the mappings for r=${restaurantId} src=${lineSource}: ${mappingRead.error}`,
        );
        return pastSalesUnavailable();
      }
      mappingsBySource.set(lineSource, mappingRead.rows);
    }

    // A row that cannot replay (no stored check, no close) uses neither.
    const budget: ReplayBudget = {
      left: REPLAY_LINE_LIMIT,
      tries: REPLAY_TRY_LIMIT,
    };
    for (const [lineSource, fetched] of bySource) {
      const mappings = mappingsBySource.get(lineSource) ?? [];
      // Only the rows a live sale would now book under the mapping just
      // saved. A till often names its glass and its bottle SKU alike; the
      // name read returns both, and the other SKU's row answers to its own
      // mapping, not this one.
      const sourceRows = fetched.filter((r) =>
        sameMapping(
          this.findMapping(
            String(r.item_name ?? ""),
            r.external_item_id ?? null,
            mappings,
          ),
          mapping,
        ),
      );
      // A hub row always carries is_wine. A Toast-door row holds the Toast
      // selection and is booked under that door's own key (QA 8c).
      const hubRows = sourceRows.filter(
        (r) => r.raw && r.raw.is_wine === true && r.external_check_id,
      );
      const toastRows =
        lineSource === "toast"
          ? sourceRows.filter((r) => !(r.raw && r.raw.is_wine === true))
          : [];
      out.still_waiting +=
        sourceRows.length - hubRows.length - toastRows.length;
      // Looked at here: another mapping's row, or nothing to replay from.
      const replayable = new Set([...hubRows, ...toastRows]);
      for (const r of fetched)
        if (!replayable.has(r)) looked.add(String(r.id));
      if (toastRows.length)
        await this.replayToastDoorRows(
          restaurantId,
          toastRows,
          externalId,
          mappings,
          out,
          budget,
          looked,
        );
      if (!hubRows.length) continue;

      const checkIds = [
        ...new Set(hubRows.map((r) => String(r.external_check_id))),
      ];
      // REPLAY_IDS_PER_READ ids per read: 500 in one URL passed 16 KB.
      for (let i = 0; i < checkIds.length; i += REPLAY_IDS_PER_READ) {
        if (spent(budget)) {
          out.truncated = true;
          break;
        }
        const ids = checkIds.slice(i, i + REPLAY_IDS_PER_READ);
        const { data: checks, error: checksError } = await db
          .from("pos_checks")
          .select("external_check_id, closed_at, voided, items")
          .eq("restaurant_id", restaurantId)
          .eq("source", lineSource)
          .in("external_check_id", ids);
        if (checksError) {
          const unread = hubRows.filter((r) =>
            ids.includes(String(r.external_check_id)),
          );
          out.failed += unread.length;
          for (const r of unread) looked.add(String(r.id));
          this.logger.error(
            `Replay could not read pos_checks for r=${restaurantId} src=${lineSource}: ${checksError.message}`,
          );
          continue;
        }
        const checkById = new Map<string, any>(
          (checks || []).map((c: any) => [String(c.external_check_id), c]),
        );
        for (let k = 0; k < ids.length; k++) {
          if (spent(budget)) {
            out.truncated = true;
            break;
          }
          const queued = hubRows.filter(
            (r) => String(r.external_check_id) === ids[k],
          );
          const used = await this.replayOneCheck(
            restaurantId,
            lineSource,
            checkById.get(ids[k]) ?? null,
            queued,
            mappings,
            out,
          );
          for (const r of queued) looked.add(String(r.id));
          budget.tries -= used.tried;
          budget.left -= used.booked;
        }
      }
    }
    await this.sendToTheBack(restaurantId, [...looked]);
    return finishPastSales(out);
  }

  /**
   * QA round 15: stamp `replay_tried_at` on the open rows a save looked at.
   * The next save reads rows no save has looked at first, then the ones
   * looked at longest ago, so a row that keeps failing goes to the back.
   * It only orders: a failed stamp moves no stock and loses no row.
   */
  private async sendToTheBack(
    restaurantId: string,
    ids: string[],
  ): Promise<void> {
    const at = new Date().toISOString();
    const db = this.dbService.getClient();
    for (let i = 0; i < ids.length; i += REPLAY_IDS_PER_READ) {
      const { error } = await db
        .from("pos_unresolved_lines")
        .update({ replay_tried_at: at })
        .eq("restaurant_id", restaurantId)
        .eq("resolved", false)
        .in("id", ids.slice(i, i + REPLAY_IDS_PER_READ));
      if (error)
        this.logger.error(
          `Could not stamp replay_tried_at on ${ids.length} queued line(s) for r=${restaurantId}: ${error.message}`,
        );
    }
  }

  /**
   * Replay Toast-door rows (QA 8c). That door (toast.service.ts
   * applyOrderSaleEffects) stores no check and books once per (order, menu
   * item) under `toast_sale_{order}_{menuGuid}`; the replay uses that key and
   * those RPCs, so it, a second save and a Toast re-send move stock once. As
   * the door does, it matches by item id and reads no sale unit as a bottle
   * (B36). The order's `events` stand in for the check: voided is cleared
   * with no stock, a sale is dated by toast_closed_at (ADR 0281), and no
   * readable close stays queued.
   */
  private async replayToastDoorRows(
    restaurantId: string,
    rows: any[],
    externalId: string,
    mappings: any[],
    out: PastSalesCount,
    budget: ReplayBudget,
    looked: Set<string>,
  ): Promise<void> {
    const db = this.dbService.getClient();
    // The door matches by guid alone; a name-only match never books live.
    const own = externalId
      ? rows.filter((r) => String(r.external_item_id ?? "") === externalId)
      : [];
    out.still_waiting += rows.length - own.length;
    const isOwn = new Set(own);
    for (const r of rows) if (!isOwn.has(r)) looked.add(String(r.id));
    if (!own.length) return;
    const m = this.findMapping(
      String(own[0].item_name ?? ""),
      externalId,
      mappings,
    );
    if (!m?.inventory_id) {
      for (const r of own) looked.add(String(r.id));
      if (m?.is_wine === false) {
        if (await this.clearQueuedLines(restaurantId, own, null))
          out.cleared_without_stock += own.length;
        else out.still_waiting += own.length;
      } else out.still_waiting += own.length;
      return;
    }
    // ADR 0141: record_glass_pour takes no house, so the item is asserted
    // to be this house's first (the save asserted it too; a read that fails
    // here makes the whole replay say it could not run).
    await assertInventoryBelongsToRestaurant(
      db,
      restaurantId,
      m.inventory_id,
      "replayToastDoorRows",
      this.logger,
    );
    const glass = m.sale_unit === "glass";
    const orders = [...new Set(own.map((r) => String(r.external_check_id)))];
    for (let i = 0; i < orders.length; i += REPLAY_IDS_PER_READ) {
      if (spent(budget)) {
        out.truncated = true;
        return;
      }
      const ids = orders.slice(i, i + REPLAY_IDS_PER_READ);
      const chunkRows = own.filter((r) =>
        ids.includes(String(r.external_check_id)),
      );
      const keyOf = (r: any) =>
        `toast_sale_${r.external_check_id}_${r.external_item_id}`;
      const { data: events, error: eventsError } = await db
        .from("events")
        .select("event_type, payload")
        .eq("restaurant_id", restaurantId)
        .in("event_type", [
          "pos_order_closed",
          "pos_order_paid",
          "pos_order_voided",
        ])
        .in("payload->>toast_order_guid", ids);
      // A bottle sale's RPC answers a seen key with the old id, so the key
      // is looked up first to tell a new sale from one already booked.
      const seen = glass
        ? { data: [], error: null }
        : await db
            .from("inventory_transactions")
            .select("idempotency_key")
            .eq("restaurant_id", restaurantId)
            .in("idempotency_key", chunkRows.map(keyOf));
      if (eventsError || seen.error) {
        out.failed += chunkRows.length;
        for (const r of chunkRows) looked.add(String(r.id));
        this.logger.error(
          `Replay could not read the Toast orders for r=${restaurantId}: ${(eventsError ?? seen.error)?.message}`,
        );
        continue;
      }
      const booked = new Set(
        (seen.data || []).map((t: any) => String(t.idempotency_key)),
      );
      const settled: Array<{ row: any; kind: "applied" | "already" | "none" }> =
        [];
      // Checked per row, so a chunk never runs past either limit; what has
      // settled is still cleared below.
      let stopped = false;
      for (const r of chunkRows) {
        if (spent(budget)) {
          out.truncated = true;
          stopped = true;
          break;
        }
        looked.add(String(r.id));
        const mine = (events || []).filter(
          (e: any) =>
            String(e.payload?.toast_order_guid) === String(r.external_check_id),
        );
        if (mine.some((e: any) => e.event_type === "pos_order_voided")) {
          settled.push({ row: r, kind: "none" });
          continue;
        }
        const closedAt = mine.find(
          (e: any) => e.payload?.toast_closed_at != null,
        )?.payload?.toast_closed_at;
        const when = saleInstant(closedAt, Date.now());
        const qty = Math.max(0, Math.round(Number(r.qty) || 0));
        if (!mine.length || when.fellBack || qty <= 0) {
          out.still_waiting++;
          continue;
        }
        budget.tries--;
        const key = keyOf(r);
        const { data, error } = glass
          ? await db.rpc("record_glass_pour", {
              p_inventory_id: m.inventory_id,
              p_pours: qty,
              p_pour_ml: null,
              p_location_id: null,
              p_source: "pos",
              p_reason: `POS sale: ${r.item_name}`,
              p_idempotency_key: key,
              p_occurred_at: when.at,
            })
          : await db.rpc("apply_stock_movement", {
              p_inventory_id: m.inventory_id,
              p_stock_state: "live",
              p_delta: -qty,
              p_transaction_type: "sale",
              p_source: "pos",
              p_reason: `POS sale: ${r.item_name}`,
              p_idempotency_key: key,
              p_restaurant_id: restaurantId,
              p_occurred_at: when.at,
            });
        if (error) {
          out.failed++;
          this.logger.warn(
            `Replay of Toast order ${r.external_check_id} failed for r=${restaurantId}: ${error.message}`,
          );
          continue;
        }
        const already = glass ? data?.idempotent === true : booked.has(key);
        budget.left--;
        settled.push({ row: r, kind: already ? "already" : "applied" });
      }
      if (!settled.length) {
        if (stopped) return;
        continue;
      }
      const cleared = await this.clearQueuedLines(
        restaurantId,
        settled.map((s) => s.row),
        m.inventory_id,
      );
      for (const s of settled) {
        if (s.kind === "none") {
          if (cleared) out.cleared_without_stock++;
          else out.still_waiting++;
          continue;
        }
        if (s.kind === "applied") out.applied++;
        else out.already_applied++;
        if (!cleared) out.not_cleared++;
      }
      if (stopped) return;
    }
  }

  /**
   * One stored check's share of a replay; counts its outcome into `out`.
   *
   * Outcomes are per line, then per queue row: each queued line is replayed
   * on its own, so a line that moves counts as applied whatever its
   * neighbours do, and a row is cleared only when every one of its own lines
   * moved, had moved already, or needs no stock. Lines are counted, except
   * where no line can be read (no stored check, or a check that dropped the
   * line): those count their rows. Returns the lines it tried and the lines
   * it booked (QA round 11b): a failed or requeued line is tried, not booked.
   */
  private async replayOneCheck(
    restaurantId: string,
    source: string,
    stored: any | null,
    queued: any[],
    mappings: any[],
    out: PastSalesCount,
  ): Promise<{ tried: number; booked: number }> {
    if (!stored) {
      out.still_waiting += queued.length;
      return NOTHING_TRIED;
    }
    // A voided check never happened: its line moved nothing on the sale or
    // the void, so clearing it is the whole replay.
    if (stored.voided === true) {
      if (await this.clearQueuedLines(restaurantId, queued, null))
        out.cleared_without_stock += queued.length;
      else out.still_waiting += queued.length;
      return NOTHING_TRIED;
    }
    // ADR 0281: dated by the check's close, never by the replay.
    const when = saleInstant(stored.closed_at, Date.now());
    if (when.fellBack) {
      out.still_waiting += queued.length;
      return NOTHING_TRIED;
    }

    const lines = (Array.isArray(stored.items) ? stored.items : []).map(
      (line: any) => ({
        name: String(line?.name ?? ""),
        external_item_id: line?.external_item_id ?? null,
        qty: Number(line?.qty) || 0,
        price: Number(line?.price) || 0,
      }),
    );
    const rowsOf = (line: { name: string; external_item_id: string | null }) =>
      queued.filter(
        (r) =>
          (r.external_item_id ?? null) === line.external_item_id &&
          String(r.item_name) === line.name,
      );
    const targets = lines
      .map((line: any, i: number) => i)
      .filter((i: number) => rowsOf(lines[i]).length > 0);
    // The till re-sent the check without the line: it stays queued for a
    // person rather than being cleared on a guess.
    if (!targets.length) {
      out.still_waiting += queued.length;
      return NOTHING_TRIED;
    }

    type LineOutcome = {
      kind: "applied" | "already" | "none" | "requeued" | "failed";
      /** Set when kind is "requeued": the question the line waits on now. */
      reason?: "unmapped" | "no_sale_volume";
      /** What the line resolved to; recorded on the row it settles. */
      inventoryId: string | null;
    };
    const outcomes = new Map<number, LineOutcome>();
    const check = {
      externalCheckId: String(stored.external_check_id),
      openedAt: "",
      closedAt: when.closedAt as string,
      voided: false,
      items: [],
    } as CanonicalCheck;

    for (const lineNo of targets) {
      const m = this.resolveWine(
        lines[lineNo].name,
        lines[lineNo].external_item_id,
        mappings,
      );
      // Every other line keeps its position (its key) and moves nothing.
      const items = lines.map((line: any, i: number) =>
        i === lineNo
          ? {
              ...line,
              is_wine: m.isWine,
              inventory_id: m.inventoryId,
              sale_unit: m.saleUnit,
              sale_volume_ml: m.saleVolumeMl,
            }
          : {
              ...line,
              is_wine: false,
              inventory_id: null,
              sale_unit: null,
              sale_volume_ml: null,
            },
      );
      const report = new StockReport();
      try {
        await this.applyStockEffects(
          restaurantId,
          source,
          check,
          items,
          report,
          when,
        );
      } catch (err: any) {
        outcomes.set(lineNo, { kind: "failed", inventoryId: null });
        this.logger.warn(
          `Replay of check ${check.externalCheckId} line ${lineNo} threw for r=${restaurantId}: ${err?.message}`,
        );
        continue;
      }
      const t = report.tally;
      const inventoryId = m.inventoryId;
      if (t.failed > 0) {
        // Keyed: the next save finishes it, moving nothing twice.
        outcomes.set(lineNo, { kind: "failed", inventoryId });
        this.logger.warn(
          `Replay of check ${check.externalCheckId} for r=${restaurantId}: ${report.errorLines().join("; ")}`,
        );
      } else if (t.queued.no_sale_volume > 0)
        outcomes.set(lineNo, {
          kind: "requeued",
          reason: "no_sale_volume",
          inventoryId,
        });
      else if (t.queued.unmapped > 0)
        outcomes.set(lineNo, {
          kind: "requeued",
          reason: "unmapped",
          inventoryId,
        });
      else if (t.booked > 0)
        outcomes.set(lineNo, { kind: "applied", inventoryId });
      else if (t.alreadyBooked > 0)
        outcomes.set(lineNo, { kind: "already", inventoryId });
      // Mapped as not stock, or a quantity that rounds to nothing.
      else outcomes.set(lineNo, { kind: "none", inventoryId });
    }

    // A row is settled when none of its own lines is still refused under
    // the row's own question or failed. A row whose question was answered
    // (`unmapped`, now asking `no_sale_volume`) is settled too: the line
    // waits on the narrower row the replay just queued.
    const settled = new Map<string | null, any[]>();
    const rowLines = new Map<string, number[]>();
    for (const row of queued) {
      const own = targets.filter((i: number) => rowsOf(lines[i]).includes(row));
      rowLines.set(String(row.id), own);
      if (!own.length) continue;
      const open = own.some((i: number) => {
        const o = outcomes.get(i)!;
        return (
          o.kind === "failed" ||
          (o.kind === "requeued" && o.reason === (row.reason ?? "unmapped"))
        );
      });
      if (open) continue;
      const inventoryId =
        own
          .map((i: number) => outcomes.get(i)!.inventoryId)
          .find((id: string | null) => id != null) ?? null;
      settled.set(inventoryId, [...(settled.get(inventoryId) ?? []), row]);
    }
    const clearedRows = new Set<string>();
    for (const [inventoryId, rows] of settled) {
      if (await this.clearQueuedLines(restaurantId, rows, inventoryId))
        for (const r of rows) clearedRows.add(String(r.id));
    }
    // A row with no line on the check stays for a person, as above.
    for (const row of queued)
      if (!rowLines.get(String(row.id))!.length) out.still_waiting++;

    for (const lineNo of targets) {
      const o = outcomes.get(lineNo)!;
      const rowsCleared = rowsOf(lines[lineNo]).every((r) =>
        clearedRows.has(String(r.id)),
      );
      switch (o.kind) {
        case "applied":
        case "already":
          // The stock moved and is keyed, so it counts as applied even when
          // its queue row could not be cleared.
          if (o.kind === "applied") out.applied++;
          else out.already_applied++;
          if (!rowsCleared) out.not_cleared++;
          break;
        case "none":
          if (rowsCleared) out.cleared_without_stock++;
          else out.still_waiting++;
          break;
        case "requeued":
          out.still_waiting++;
          break;
        case "failed":
          out.failed++;
          break;
      }
    }
    const booked = targets.filter((i: number) => {
      const kind = outcomes.get(i)!.kind;
      return kind === "applied" || kind === "already";
    }).length;
    return { tried: targets.length, booked };
  }

  /**
   * Mark replayed rows resolved, only while still open and only in this
   * house. False when the write failed: the stock is keyed, so an open row
   * costs a second look, never a second movement.
   */
  private async clearQueuedLines(
    restaurantId: string,
    rows: any[],
    inventoryId: string | null,
  ): Promise<boolean> {
    const { error } = await this.dbService
      .getClient()
      .from("pos_unresolved_lines")
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_inventory_id: inventoryId,
      })
      .eq("restaurant_id", restaurantId)
      .eq("resolved", false)
      .in(
        "id",
        rows.map((r) => String(r.id)),
      );
    if (error) {
      this.logger.warn(
        `Clearing ${rows.length} replayed queue row(s) failed for r=${restaurantId}: ${error.message}`,
      );
      return false;
    }
    return true;
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
    const { data, error } = await client
      .from("pos_checks")
      .select("source, opened_at, closed_at")
      .eq("restaurant_id", restaurantId)
      .gte("opened_at", since30);
    if (error) {
      this.logger.error(
        `pos_checks status read failed for r=${restaurantId} — reporting ` +
          `UNAVAILABLE rather than "0 checks": ${error.code ?? "?"} ${error.message}`,
      );
      return {
        windowDays: 30,
        unavailable: true as const,
        totalChecks: null,
        sources: null,
        generatedAt: new Date().toISOString(),
      };
    }
    const rows = data || [];
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
