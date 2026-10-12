import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { AnalyticsService } from "../../analytics/analytics.service";
import { GoalsService } from "../../analytics/goals.service";
import {
  houseDayBounds,
  houseDayOf,
  houseToday,
  readHouseZone,
} from "../../common/house-day";
import { houseFrame } from "../../common/house-frame";
import { readWholeWindow } from "../../common/read-whole-window";
import { OPENING_COUNT_SOURCE } from "../../inventory/stock-count-result";
import { ORDER_SPEND_STATUSES } from "../../procurement/order-status";
import { orderSpend } from "../../procurement/order-spend";
import {
  EXPORT_CUTTINGS,
  countWithheld,
} from "../exports/report-export-cuttings";
import { renderCsv } from "../exports/report-export-render";

/**
 * Month close — F-1013, the founder's ruling of 2026-10-11 (sim ledger S195):
 * option C, the SNAPSHOT close.
 *
 * An owner or manager closes a month of the house's calendar. The gateway
 * reads the month's figures once and keeps them in `month_closes`, a table
 * that refuses every edit (20270105600000): the till's month (and its file,
 * written as the export shelf writes it), the cellar's value, the purchases
 * delivered in the month and the count variance. That row is the record.
 *
 * Live data stays editable. Nothing here locks a write. Instead, reading a
 * close lists what changed inside its month AFTER it was closed — who, what,
 * by how much — and sets each figure as kept against the same figure read
 * now. There is no reopen: closing the month again keeps a new version beside
 * the old one, and the old one still says what it said.
 *
 * WHAT A CLOSE CAN AND CANNOT SAY
 * -------------------------------
 *  - Only a month that has ENDED on the house's clock can be closed: a close
 *    of a running month would be a record of half of it.
 *  - The month is cut on the house's own days (ADR 0296), from its zone. A
 *    house with no zone cannot be cut, and is told why.
 *  - The cellar's value is the value WHEN the month was closed. The product
 *    keeps no valuation per day, so a value "as of the last night of the
 *    month" cannot be rebuilt later; the close says when it was taken.
 *  - A figure the engine could not compute is kept as null, never as 0, and
 *    a read that fails refuses the close rather than keeping a short record.
 *  - The till's figure is NET sales, the checks' subtotal (ADR 0287 AW17,
 *    F-1494), as every owner sales figure is. The till file kept beside it is
 *    the export shelf's, written as that shelf writes it.
 *  - What changed after the close is found by setting the month as read now
 *    against a per-check and per-order snapshot kept with the figures, so the
 *    listed changes add up to each figure's move (F-1466, F-1467).
 */

/** How many changed rows of one kind a close lists before it says "and N more". */
export const CHANGED_AFTER_CLOSE_CAP = 200;
/** Said of a change whose record names nobody (F-1468). */
const NOT_RECORDED = "not recorded";
/** A users.user_id, as a change row carries it before it is named. */
const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mirrors `month_closes_till_csv_size`. */
const MAX_TILL_CSV_BYTES = 5 * 1024 * 1024;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// Not `TABLE`: the parity guard maps const names repo-wide, and the web's
// useSommelierQueries already has a `TABLE` (F-1112).
const MONTH_CLOSES_TABLE = "month_closes";
const ROW_COLUMNS =
  "id, restaurant_id, month, version, closed_by, closed_at, zone, figures";

/**
 * The till's month, NET (F-1494): ADR 0287 rule AW17 makes an owner's sales
 * figure the checks' `subtotal`, before tax and surcharge, labelled "net" —
 * never `total`, and never a fallback to it. Its rule 3 is followed here: the
 * subtotals that exist are summed, the checks they came from are counted, and
 * the figure is null, never 0, when no check carried one.
 */
export interface TillFigures {
  posConnected: boolean;
  /** Sum of `subtotal` over the month's non-voided checks; null when none carried one or the till could not say. */
  netSales: number | null;
  /** Checks whose subtotal is in `netSales`; below `checkCount` when some carried none. */
  netSalesCheckCount: number | null;
  checkCount: number | null;
  /** Only days with a net figure. */
  days: Array<{ date: string; netSales: number }>;
  /**
   * Each counted check's net figure at the close, by id (F-1467). A later void
   * or change is found by setting the month's checks against this, not by a
   * timestamp: a re-sent check keeps its first `imported_at`, and the till's
   * own `source_modified_at` is written only when the till sends one. Kept in
   * the record; never sent to the page.
   */
  kept?: Record<string, number | null>;
}

/** The cellar's value when the month was closed (`AnalyticsService.getFinancialSummary`). */
export interface ValuationFigures {
  /** Null unless every bottle on hand carries a cost (ADR 0051). */
  inventoryValue: number | null;
  /** The priced bottles' own total, beside how many wines it leaves out. */
  pricedInventoryValue: number | null;
  unpricedWines: number | null;
  valuedAt: string;
}

export interface MoneyTotal {
  /** ISO 4217; null when neither the order nor the house names one. */
  currency: string | null;
  total: number;
}

/** Orders delivered on the month's house days. */
export interface PurchaseFigures {
  orders: number;
  /** Orders with no price, left out of the totals and counted. */
  unpriced: number;
  /** One total per currency: there is no rate to add one to another. */
  totals: MoneyTotal[];
  /**
   * Each counted order's total and money at the close, by id (F-1466): an
   * order is listed as changed only when what it counts for moved. Kept in
   * the record; never sent to the page.
   */
  kept?: Record<string, { total: number | null; currency: string | null }>;
}

/** Shelf counts taken on the month's house days. */
export interface VarianceFigures {
  counts: number;
  /** Counted less expected, in bottles, over every count. */
  netBottles: number;
  /** Bottles found missing (counts below the books). */
  shortBottles: number;
  /** Bottles found over (counts above the books). */
  overBottles: number;
}

export interface MonthFigures {
  /** The house's money when the month was closed; null when none is recorded. */
  currency: string | null;
  till: TillFigures;
  valuation: ValuationFigures;
  purchases: PurchaseFigures;
  variance: VarianceFigures;
}

export interface MonthCloseDto {
  id: string;
  month: string;
  version: number;
  closedAt: string;
  /** Null when the person who closed it has since been removed. */
  closedBy: { id: string; name: string | null } | null;
  zone: string;
  figures: MonthFigures;
  /** True when the till's month file was kept with the record. */
  hasTillFile: boolean;
}

/** One change dated inside a closed month and made after it was closed. */
export interface ChangedAfterClose {
  kind: "till" | "stock" | "purchase";
  /** When the change reached the books. */
  at: string;
  /** The house day inside the month it is dated on. */
  day: string;
  /** Who made it, as plainly as the record says. */
  who: string;
  what: string;
  /** Bottles for stock; money for the till and purchases. */
  delta: number | null;
  unit: "bottles" | "money";
  /** For money: the code it is in; null is the house's money. */
  currency: string | null;
}

export interface FigureAgainstNow {
  figure: "till_net_sales" | "till_checks" | "purchases" | "variance_net";
  label: string;
  atClose: number | null;
  now: number | null;
  /** now − at close; null when either side is unknown. */
  delta: number | null;
  currency: string | null;
}

export interface MonthCloseDetailDto extends MonthCloseDto {
  changes: ChangedAfterClose[];
  /** Changes past the cap of each kind, not listed. */
  changesNotListed: number;
  againstNow: FigureAgainstNow[];
}

/** One check of the month, filed on its house day. */
interface TillCheck {
  id: string;
  ref: string;
  day: string;
  /** Its `subtotal`; null when the till sent none. */
  net: number | null;
  voided: boolean;
  imported_at: string | null;
  source_modified_at: string | null;
}

/** Money summed from floats, back to cents. */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

interface CloseRow {
  id: string;
  restaurant_id: string;
  month: string;
  version: number;
  closed_by: string | null;
  closed_at: string;
  zone: string;
  figures: MonthFigures;
  till_csv?: string | null;
}

/** "July 2026" for 2026-07. */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** First and last house day of a YYYY-MM month. */
function monthDays(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    first: `${month}-01`,
    last: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function finite(v: unknown): number | null {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

function codeOf(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null;
}

/** The figures as the page reads them: the per-check and per-order snapshot stays in the record. */
function withoutSnapshot(f: MonthFigures): MonthFigures {
  const { kept: _till, ...till } = f.till;
  const { kept: _orders, ...purchases } = f.purchases;
  return { ...f, till, purchases };
}

const MOVEMENT_WORDS: Record<string, string> = {
  sale: "Sale",
  purchase: "Delivery booked in",
  adjustment: "Stock adjusted",
  transfer: "Moved between shelves",
  waste: "Written off",
  return: "Returned",
  comp: "Given on the house",
  reconciliation: "Shelf count",
  initial: "Opening stock",
  correction: "Correction",
};

@Injectable()
export class MonthCloseService {
  private readonly logger = new Logger(MonthCloseService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly goals: GoalsService,
    private readonly analytics: AnalyticsService,
  ) {}

  private get db() {
    return this.databaseService.supabase;
  }

  /* ─────────────────────────────────────────────────────────── writes ── */

  async closeMonth(
    restaurantId: string,
    actorId: string | null,
    rawMonth: unknown,
  ): Promise<MonthCloseDto> {
    if (typeof rawMonth !== "string" || !MONTH_RE.test(rawMonth))
      throw new BadRequestException(
        "A month is written as year and month, like 2026-07.",
      );
    const month = rawMonth;
    const { zone } = await readHouseZone(this.db, restaurantId);
    if (!zone)
      throw new BadRequestException(
        "This house's time zone isn't set, so its month cannot be cut on the house's days. An owner or manager can set it in Settings, under Time zone.",
      );
    const thisMonth = houseToday(zone).slice(0, 7);
    if (month >= thisMonth)
      throw new BadRequestException(
        `${monthName(month)} is not over yet on this house's clock. A month can be closed once it has ended.`,
      );

    // F-1517: a month that ended before the house opened holds nothing of
    // it; closing one would keep today's cellar as that month's.
    const opened = await this.openedMonth(restaurantId);
    if (opened !== null && month < opened)
      throw new BadRequestException(
        `This house opened in ${monthName(opened)}, so there is nothing of ${monthName(month)} to close. Its first month to close is ${monthName(opened)}.`,
      );

    const house = await this.readHouse(restaurantId);
    const { figures, tillWindow } = await this.readFigures(
      restaurantId,
      month,
      zone,
      house.currency,
    );
    const tillCsv = this.tillFile(tillWindow, month, zone, house);

    const { data: last, error: lastError } = await this.db
      .from(MONTH_CLOSES_TABLE)
      .select("version")
      .eq("restaurant_id", restaurantId)
      .eq("month", month)
      .order("version", { ascending: false })
      .limit(1);
    if (lastError) {
      this.logger.error("Could not read the month's last close", {
        restaurantId,
        month,
        error: lastError.message,
      });
      throw lastError;
    }
    const version =
      (((last ?? [])[0] as { version?: number } | undefined)?.version ?? 0) + 1;

    const { data, error } = await this.db
      .from(MONTH_CLOSES_TABLE)
      .insert({
        restaurant_id: restaurantId,
        month,
        version,
        closed_by: actorId,
        zone,
        figures,
        till_csv: tillCsv,
      })
      .select(ROW_COLUMNS)
      .single();
    if (error || !data) {
      if (error && (error as { code?: string }).code === "23505")
        throw new ConflictException(
          `${monthName(month)} was closed by someone else at the same moment. Read the closes again.`,
        );
      this.logger.error("Failed to keep a month close", {
        restaurantId,
        month,
        error: error?.message,
      });
      throw (
        error ??
        new InternalServerErrorException("The month could not be closed.")
      );
    }
    const row = data as unknown as CloseRow;

    const { error: auditError } = await this.db
      .from("system_audit_log")
      .insert({
        actor_type: "user",
        actor_id: actorId,
        action: "month_closed",
        entity_type: "month_close",
        entity_id: row.id,
        // F-1513: /logs prints `subject`; without it the line named no month.
        changes: {
          subject: `${monthName(month)} (version ${version})`,
          month,
          version,
        },
        restaurant_id: restaurantId,
      });
    if (auditError)
      this.logger.error("Month closed but the audit row failed to write", {
        restaurantId,
        closeId: row.id,
        error: auditError.message,
      });

    const names = await this.peopleNames(actorId ? [actorId] : []);
    return this.toDto(row, tillCsv !== null, names);
  }

  /* ──────────────────────────────────────────────────────────── reads ── */

  /**
   * F-1517: the house's month (on its own clock) it was opened in, the first
   * month it can close. Null when the house names no zone or no opening time.
   */
  async openedMonth(restaurantId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("restaurants")
      .select("created_at, timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error)
      throw new Error(
        `When the house was opened could not be read: ${error.message}`,
      );
    const h = (data ?? {}) as Record<string, unknown>;
    const zone = houseFrame({
      timezone: typeof h.timezone === "string" ? h.timezone : null,
      country: typeof h.country === "string" ? h.country : null,
    }).zone;
    if (!zone || typeof h.created_at !== "string") return null;
    return houseDayOf(h.created_at, zone)?.slice(0, 7) ?? null;
  }

  /** The house's closes, newest month first, every version. */
  async listCloses(
    restaurantId: string,
  ): Promise<{ closes: MonthCloseDto[]; openedMonth: string | null }> {
    const { data, error } = await this.db
      .from(MONTH_CLOSES_TABLE)
      .select(`${ROW_COLUMNS}, till_csv`)
      .eq("restaurant_id", restaurantId)
      .order("closed_at", { ascending: false })
      .limit(120);
    if (error) {
      this.logger.error("Failed to list month closes", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }
    const rows = (data ?? []) as unknown as CloseRow[];
    const names = await this.peopleNames(rows.map((r) => r.closed_by));
    return {
      closes: rows.map((r) =>
        this.toDto(r, typeof r.till_csv === "string", names),
      ),
      // The page's earliest month; closeMonth refuses anything before it.
      openedMonth: await this.openedMonth(restaurantId),
    };
  }

  /** One close, with what changed inside its month after it was closed. */
  async getClose(
    restaurantId: string,
    closeId: string,
  ): Promise<MonthCloseDetailDto> {
    const row = await this.readRow(restaurantId, closeId, true);
    const { first, last } = monthDays(row.month);
    const bounds = houseDayBounds(first, last, row.zone);
    const currency = row.figures.currency ?? null;

    const [{ figures: now, checks }, stock] = await Promise.all([
      this.readFigures(restaurantId, row.month, row.zone, currency, false),
      this.stockChanges(restaurantId, row, bounds),
    ]);
    const till = this.tillChanges(row, checks);
    const purchases = await this.purchaseChanges(restaurantId, row, now);

    const people = await this.peopleNames([
      row.closed_by,
      ...stock.rows.map((r) => r.who),
      ...purchases.rows.map((r) => r.who),
    ]);
    // A user id is named, or said to be gone; a phrase ("The till", "not
    // recorded") is already the answer (F-1468).
    const named = (c: ChangedAfterClose): ChangedAfterClose =>
      USER_ID_RE.test(c.who)
        ? { ...c, who: people.get(c.who) ?? "someone no longer on the team" }
        : c;

    const changes = [
      ...till.rows,
      ...stock.rows.map(named),
      ...purchases.rows.map(named),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return {
      ...this.toDto(row, typeof row.till_csv === "string", people),
      changes,
      changesNotListed: till.more + stock.more + purchases.more,
      againstNow: againstNow(row.figures, now),
    };
  }

  async tillCsv(
    restaurantId: string,
    closeId: string,
  ): Promise<{ filename: string; body: string }> {
    const row = await this.readRow(restaurantId, closeId, true);
    if (typeof row.till_csv !== "string")
      throw new NotFoundException("No till file was kept with this close.");
    return {
      filename: `mudavym-till-${row.month}-closed-v${row.version}.csv`,
      body: row.till_csv,
    };
  }

  /* ────────────────────────────────────────────────────────── internals ── */

  private async readRow(
    restaurantId: string,
    closeId: string,
    withFile: boolean,
  ): Promise<CloseRow> {
    const { data, error } = await this.db
      .from(MONTH_CLOSES_TABLE)
      .select(withFile ? `${ROW_COLUMNS}, till_csv` : ROW_COLUMNS)
      .eq("id", closeId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error("Failed to read a month close", {
        restaurantId,
        closeId,
        error: error.message,
      });
      throw error;
    }
    if (!data)
      throw new NotFoundException("No such closed month for this house.");
    return data as unknown as CloseRow;
  }

  private async readHouse(restaurantId: string): Promise<{
    name: string | null;
    currency: string | null;
    timezone: string | null;
    country: string | null;
  }> {
    const { data, error } = await this.db
      .from("restaurants")
      .select("name, currency, timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) throw new Error(`The house could not be read: ${error.message}`);
    const h = (data ?? {}) as Record<string, unknown>;
    return {
      name: typeof h.name === "string" && h.name ? h.name : null,
      currency: codeOf(h.currency),
      timezone: typeof h.timezone === "string" ? h.timezone : null,
      country: typeof h.country === "string" ? h.country : null,
    };
  }

  /**
   * The month's figures, read once. `withValuation` false reads the three
   * figures that can be read again for the month later (the cellar's value
   * cannot: it is today's).
   */
  private async readFigures(
    restaurantId: string,
    month: string,
    zone: string,
    currency: string | null,
    withValuation = true,
  ): Promise<{
    figures: MonthFigures;
    tillWindow: unknown;
    checks: TillCheck[];
  }> {
    const { first, last } = monthDays(month);
    const bounds = houseDayBounds(first, last, zone);
    const [tillWindow, rawChecks, summary, orders, counts] = await Promise.all([
      this.goals.getPosRevenueWindow(restaurantId, 30, month),
      // The month's checks, voided ones too: the net figure is summed from
      // them, and a later read sets each against the one kept (F-1467).
      readWholeWindow<Record<string, unknown>>(
        "The till's checks in this month",
        () =>
          this.db
            .from("pos_checks")
            .select(
              "id, external_check_id, subtotal, voided, opened_at, closed_at, imported_at, source_modified_at",
              { count: "exact" },
            )
            .eq("restaurant_id", restaurantId)
            .gte("opened_at", bounds.readFromIso)
            .lt("opened_at", bounds.endIso) as never,
      ),
      withValuation
        ? this.analytics.getFinancialSummary(restaurantId, 0)
        : Promise.resolve(null),
      readWholeWindow<Record<string, unknown>>(
        "The orders delivered in this month",
        () =>
          this.db
            .from("procurement_orders")
            .select("id, total_cost, currency, delivered_at", {
              count: "exact",
            })
            .eq("restaurant_id", restaurantId)
            .in("status", ORDER_SPEND_STATUSES as unknown as string[])
            .gte("delivered_at", bounds.startIso)
            .lt("delivered_at", bounds.endIso) as never,
      ),
      readWholeWindow<Record<string, unknown>>(
        "The shelf counts taken in this month",
        () =>
          this.db
            .from("stock_counts")
            .select("id, expected_qty, counted_qty, variance_qty, counted_at", {
              count: "exact",
            })
            .eq("restaurant_id", restaurantId)
            // F-1514, ADR 0335 §2: an opening count is the first count
            // variance is measured from, never a variance itself.
            .neq("source", OPENING_COUNT_SOURCE)
            .gte("counted_at", bounds.startIso)
            .lt("counted_at", bounds.endIso) as never,
      ),
    ]);

    const totals = new Map<string | null, number>();
    const keptOrders: NonNullable<PurchaseFigures["kept"]> = {};
    let unpriced = 0;
    for (const o of orders) {
      const cost = orderSpend(o);
      // An order naming no currency is in the house's money (F-1052).
      const code = codeOf(o.currency) ?? currency;
      keptOrders[String(o.id)] = { total: cost, currency: code };
      if (cost === null) {
        unpriced += 1;
        continue;
      }
      totals.set(code, (totals.get(code) ?? 0) + cost);
    }

    // Net, by ADR 0287 AW17 (F-1494): the month's non-voided checks, filed
    // on the house's days.
    const checks: TillCheck[] = [];
    for (const c of rawChecks) {
      const day = houseDayOf(
        c as { closed_at?: string | null; opened_at?: string | null },
        zone,
      );
      if (day === null || day < first || day > last) continue;
      checks.push({
        id: String(c.id),
        ref: typeof c.external_check_id === "string" ? c.external_check_id : "",
        day,
        net: finite(c.subtotal),
        voided: c.voided === true,
        imported_at: typeof c.imported_at === "string" ? c.imported_at : null,
        source_modified_at:
          typeof c.source_modified_at === "string"
            ? c.source_modified_at
            : null,
      });
    }
    const keptChecks: Record<string, number | null> = {};
    const netByDay = new Map<string, number>();
    let netSales: number | null = null;
    let netSalesCheckCount = 0;
    let checkCount = 0;
    for (const c of checks) {
      if (c.voided) continue;
      checkCount += 1;
      keptChecks[c.id] = c.net;
      if (c.net === null) continue;
      netSales = (netSales ?? 0) + c.net;
      netSalesCheckCount += 1;
      netByDay.set(c.day, (netByDay.get(c.day) ?? 0) + c.net);
    }

    let netBottles = 0;
    let shortBottles = 0;
    let overBottles = 0;
    for (const c of counts) {
      const v =
        finite(c.variance_qty) ??
        (finite(c.counted_qty) ?? 0) - (finite(c.expected_qty) ?? 0);
      netBottles += v;
      if (v < 0) shortBottles += -v;
      else overBottles += v;
    }

    const s = (summary ?? {}) as Record<string, unknown>;
    const coverage = (s.costCoverage ?? {}) as Record<string, unknown>;
    const figures: MonthFigures = {
      currency,
      till: tillWindow.posConnected
        ? {
            posConnected: true,
            netSales: netSales === null ? null : cents(netSales),
            netSalesCheckCount,
            checkCount,
            days: [...netByDay.entries()]
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([date, net]) => ({ date, netSales: cents(net) })),
            kept: keptChecks,
          }
        : {
            posConnected: false,
            netSales: null,
            netSalesCheckCount: null,
            checkCount: null,
            days: [],
            kept: {},
          },
      valuation: {
        inventoryValue: finite(s.inventoryValue),
        pricedInventoryValue: finite(s.pricedInventoryValue),
        unpricedWines: finite(coverage.unpriced),
        valuedAt: new Date().toISOString(),
      },
      purchases: {
        orders: orders.length,
        unpriced,
        totals: [...totals.entries()]
          .map(([c, total]) => ({ currency: c, total }))
          .sort((a, b) => String(a.currency).localeCompare(String(b.currency))),
        kept: keptOrders,
      },
      variance: {
        counts: counts.length,
        netBottles,
        shortBottles,
        overBottles,
      },
    };
    return { figures, tillWindow, checks };
  }

  /** The till's month written up as the export shelf writes it, kept with the record. */
  private tillFile(
    payload: unknown,
    month: string,
    zone: string,
    house: {
      name: string | null;
      currency: string | null;
      timezone: string | null;
      country: string | null;
    },
  ): string | null {
    const spec = EXPORT_CUTTINGS.till;
    const doc = spec.write(payload, { days: null, currency: house.currency });
    const csv = renderCsv(doc, {
      houseName: house.name,
      currency: house.currency,
      title: spec.title,
      windowLabel: `${monthName(month)} of POS checks, by the house’s days, as closed`,
      writtenAt: new Date().toISOString(),
      timezone: zone,
      locale: houseFrame({ timezone: house.timezone, country: house.country })
        .locale,
      withheldCount: countWithheld(doc),
    });
    return Buffer.byteLength(csv, "utf8") <= MAX_TILL_CSV_BYTES ? csv : null;
  }

  /**
   * The month's checks set against the ones kept at the close (F-1467): a
   * check voided since, one whose net figure moved, one that arrived since,
   * and one kept that is no longer in the month. No timestamp decides it: a
   * re-sent check keeps its first `imported_at`, and `source_modified_at` is
   * the till's clock, written only when the till sends one, so a void from a
   * file import could change the figure and be listed nowhere. Each change
   * moves the net figure by its delta, so the list adds up to the figure.
   *
   * A close kept before the snapshot existed lists no check; the shelf then
   * says a figure moved without a listed change, never that nothing did.
   */
  private tillChanges(
    row: CloseRow,
    checks: TillCheck[],
  ): { rows: ChangedAfterClose[]; more: number } {
    const kept = row.figures.till?.kept;
    if (!kept) return { rows: [], more: 0 };
    const closed = Date.parse(row.closed_at);
    // When it reached the books, as well as the row says; never before the close.
    const at = (c: TillCheck) =>
      [c.source_modified_at, c.imported_at]
        .filter((t): t is string => t !== null && Date.parse(t) > closed)
        .sort((x, y) => Date.parse(y) - Date.parse(x))[0] ?? row.closed_at;
    const has = (id: string) => Object.prototype.hasOwnProperty.call(kept, id);
    const ref = (c: TillCheck) => (c.ref ? ` ${c.ref}` : "");
    const rows: ChangedAfterClose[] = [];
    const push = (c: TillCheck | null, what: string, delta: number | null) =>
      rows.push({
        kind: "till",
        at: c ? at(c) : row.closed_at,
        day: c ? c.day : row.month,
        who: "The till",
        what,
        delta: delta === null ? null : cents(delta),
        unit: "money",
        currency: null,
      });
    const seen = new Set<string>();
    for (const c of checks) {
      seen.add(c.id);
      const was = has(c.id) ? kept[c.id] : undefined;
      if (was !== undefined && c.voided)
        push(
          c,
          `Check${ref(c)} voided at the till`,
          was === null ? null : -was,
        );
      else if (was !== undefined && c.net !== was)
        push(
          c,
          `Check${ref(c)} changed at the till`,
          (c.net ?? 0) - (was ?? 0),
        );
      else if (was === undefined && !c.voided)
        push(c, `Check${ref(c)} arrived from the till`, c.net);
    }
    for (const id of Object.keys(kept))
      if (!seen.has(id))
        push(
          null,
          "A check kept at the close is no longer in this month",
          kept[id] === null ? null : -(kept[id] as number),
        );
    rows.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
    return {
      rows: rows.slice(0, CHANGED_AFTER_CLOSE_CAP),
      more: Math.max(0, rows.length - CHANGED_AFTER_CLOSE_CAP),
    };
  }

  /** Stock movements dated inside the month and recorded after the close. */
  private async stockChanges(
    restaurantId: string,
    row: CloseRow,
    bounds: { startIso: string; endIso: string },
  ): Promise<{ rows: ChangedAfterClose[]; more: number }> {
    const { data, error, count } = await this.db
      .from("inventory_transactions")
      .select(
        "id, inventory_id, transaction_type, source, quantity_change, performed_by, transaction_date, created_at",
        {
          count: "exact",
        },
      )
      .eq("restaurant_id", restaurantId)
      .gt("created_at", row.closed_at)
      .gte("transaction_date", bounds.startIso)
      .lt("transaction_date", bounds.endIso)
      .order("created_at", { ascending: false })
      .limit(CHANGED_AFTER_CLOSE_CAP);
    if (error)
      throw new Error(
        `The stock movements since the close could not be read: ${error.message}`,
      );
    const list = (data ?? []) as Array<Record<string, unknown>>;
    const wines = await this.wineNames(
      list.map((t) =>
        typeof t.inventory_id === "string" ? t.inventory_id : null,
      ),
    );
    return {
      rows: list.map((t) => ({
        kind: "stock" as const,
        at: String(t.created_at),
        day: houseDayOf(String(t.transaction_date), row.zone) ?? "",
        // F-1468: the till writes its sales and returns with no person on
        // them. That is the till, not someone who has left the team.
        who:
          typeof t.performed_by === "string"
            ? t.performed_by
            : t.source === "pos"
              ? "The till"
              : NOT_RECORDED,
        what: `${MOVEMENT_WORDS[String(t.transaction_type)] ?? "Stock changed"}: ${wines.get(String(t.inventory_id)) ?? "a wine no longer listed"}`,
        delta: finite(t.quantity_change),
        unit: "bottles" as const,
        currency: null,
      })),
      more: Math.max(0, (count ?? 0) - CHANGED_AFTER_CLOSE_CAP),
    };
  }

  /**
   * Orders whose counted money moved since the close (F-1466): the month's
   * delivered orders as read now, set against the ones kept. An order is
   * listed only when what it counts for changed — its total, its money, or
   * whether it counts at all — and by how much, so the list adds up to
   * "Bought (delivered)". Any other edit (a note, a verified price that left
   * the total where it was) is not a change to the month. The person named is
   * the one the order records for that change: who verified the invoice after
   * the close, or who received an order that came into the month; otherwise
   * it is not recorded, never the person at the door by default.
   */
  private async purchaseChanges(
    restaurantId: string,
    row: CloseRow,
    now: MonthFigures,
  ): Promise<{ rows: ChangedAfterClose[]; more: number }> {
    const kept = row.figures.purchases?.kept;
    if (!kept) return { rows: [], more: 0 };
    const current = now.purchases.kept ?? {};
    const moved = [
      ...new Set([...Object.keys(kept), ...Object.keys(current)]),
    ].filter((id) => {
      const a = kept[id];
      const b = current[id];
      return !a || !b || a.total !== b.total || a.currency !== b.currency;
    });
    if (moved.length === 0) return { rows: [], more: 0 };
    const listed = moved.slice(0, CHANGED_AFTER_CLOSE_CAP);
    const { data, error } = await this.db
      .from("procurement_orders")
      .select(
        "id, order_number, delivered_at, updated_at, received_by, match_verified_by, match_verified_at",
      )
      .eq("restaurant_id", restaurantId)
      .in("id", listed);
    if (error)
      throw new Error(
        `The orders changed since the close could not be read: ${error.message}`,
      );
    const byId = new Map(
      ((data ?? []) as Array<Record<string, unknown>>).map((o) => [
        String(o.id),
        o,
      ]),
    );
    const closed = Date.parse(row.closed_at);
    const after = (v: unknown) =>
      typeof v === "string" && Date.parse(v) > closed;
    const rows = listed.map((id): ChangedAfterClose => {
      const o = byId.get(id) ?? {};
      const a = kept[id];
      const b = current[id];
      const name = `Order${o.order_number ? ` ${String(o.order_number)}` : ""}`;
      let what: string;
      let delta: number | null;
      let currency: string | null;
      let who = NOT_RECORDED;
      if (a && b && a.currency !== b.currency) {
        what = `${name} is now in ${b.currency ?? "the house's money"}, not ${a.currency ?? "the house's money"}`;
        delta = null;
        currency = b.currency;
      } else if (a && b) {
        what =
          a.total === null
            ? `${name} now carries a price`
            : b.total === null
              ? `${name} no longer carries a price`
              : `${name} cost changed`;
        delta = cents((b.total ?? 0) - (a.total ?? 0));
        currency = b.currency;
      } else if (a) {
        what = `${name} is no longer counted as delivered in this month`;
        delta = a.total === null ? null : -a.total;
        currency = a.currency;
      } else {
        what = `${name} was counted as delivered in this month after the close`;
        delta = b.total;
        currency = b.currency;
        if (typeof o.received_by === "string") who = o.received_by;
      }
      if (
        a &&
        b &&
        typeof o.match_verified_by === "string" &&
        after(o.match_verified_at)
      )
        who = o.match_verified_by;
      return {
        kind: "purchase",
        at: after(o.updated_at) ? String(o.updated_at) : row.closed_at,
        day:
          typeof o.delivered_at === "string"
            ? (houseDayOf(o.delivered_at, row.zone) ?? row.month)
            : row.month,
        who,
        what,
        delta,
        unit: "money",
        currency,
      };
    });
    return {
      rows,
      more: Math.max(0, moved.length - CHANGED_AFTER_CLOSE_CAP),
    };
  }

  /** Names by user id. A failed read names nobody rather than failing the close. */
  private async peopleNames(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const wanted = [
      ...new Set(
        ids.filter((i): i is string => typeof i === "string" && i !== ""),
      ),
    ];
    const out = new Map<string, string>();
    if (wanted.length === 0) return out;
    const { data, error } = await this.db
      .from("users")
      .select("user_id, name")
      .in("user_id", wanted);
    if (error) {
      this.logger.error("Could not read who closed or changed a month", {
        error: error.message,
      });
      return out;
    }
    for (const u of (data ?? []) as Array<{
      user_id: string;
      name: string | null;
    }>)
      if (u.name) out.set(u.user_id, u.name);
    return out;
  }

  private async wineNames(
    ids: Array<string | null>,
  ): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((i): i is string => i !== null))];
    const out = new Map<string, string>();
    if (wanted.length === 0) return out;
    const { data, error } = await this.db
      .from("restaurant_inventory")
      .select("id, display_name, wine_name")
      .in("id", wanted);
    if (error) {
      this.logger.error("Could not read the wines a change names", {
        error: error.message,
      });
      return out;
    }
    for (const w of (data ?? []) as Array<{
      id: string;
      display_name: string | null;
      wine_name: string | null;
    }>) {
      const name = w.display_name || w.wine_name;
      if (name) out.set(w.id, name);
    }
    return out;
  }

  private toDto(
    row: CloseRow,
    hasTillFile: boolean,
    names: Map<string, string>,
  ): MonthCloseDto {
    return {
      id: row.id,
      month: row.month,
      version: row.version,
      closedAt: row.closed_at,
      closedBy: row.closed_by
        ? { id: row.closed_by, name: names.get(row.closed_by) ?? null }
        : null,
      zone: row.zone,
      figures: withoutSnapshot(row.figures),
      hasTillFile,
    };
  }
}

/** Each figure that can be read again for the month, as kept against as read now. */
export function againstNow(
  kept: MonthFigures,
  now: MonthFigures,
): FigureAgainstNow[] {
  const pair = (
    figure: FigureAgainstNow["figure"],
    label: string,
    atClose: number | null,
    nowV: number | null,
    currency: string | null,
  ): FigureAgainstNow => ({
    figure,
    label,
    atClose,
    now: nowV,
    delta: atClose === null || nowV === null ? null : nowV - atClose,
    currency,
  });
  const out: FigureAgainstNow[] = [
    pair(
      "till_net_sales",
      "Net sales through the till",
      // A close kept before F-1494 has no net figure: unknown, never NaN.
      kept.till.netSales ?? null,
      now.till.netSales,
      kept.currency,
    ),
    pair(
      "till_checks",
      "Checks",
      kept.till.checkCount,
      now.till.checkCount,
      null,
    ),
  ];
  const codes = new Set<string | null>([
    ...kept.purchases.totals.map((t) => t.currency),
    ...now.purchases.totals.map((t) => t.currency),
  ]);
  for (const code of codes) {
    const a =
      kept.purchases.totals.find((t) => t.currency === code)?.total ?? 0;
    const b = now.purchases.totals.find((t) => t.currency === code)?.total ?? 0;
    out.push(pair("purchases", "Bought (delivered)", a, b, code));
  }
  out.push(
    pair(
      "variance_net",
      "Count variance, bottles",
      kept.variance.netBottles,
      now.variance.netBottles,
      null,
    ),
  );
  return out;
}
