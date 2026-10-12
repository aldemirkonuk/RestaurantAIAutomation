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
 */

/** How many changed rows of one kind a close lists before it says "and N more". */
export const CHANGED_AFTER_CLOSE_CAP = 200;
/** Mirrors `month_closes_till_csv_size`. */
const MAX_TILL_CSV_BYTES = 5 * 1024 * 1024;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// Not `TABLE`: the parity guard maps const names repo-wide, and the web's
// useSommelierQueries already has a `TABLE` (F-1112).
const MONTH_CLOSES_TABLE = "month_closes";
const ROW_COLUMNS =
  "id, restaurant_id, month, version, closed_by, closed_at, zone, figures";

/** The till's month, as the till reads it (`GoalsService.getPosRevenueWindow`). */
export interface TillFigures {
  posConnected: boolean;
  /** Sum of the month's non-voided checks; null when the till could not say. */
  revenue: number | null;
  checkCount: number | null;
  /** Only days that took money. */
  days: Array<{ date: string; revenue: number }>;
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
  figure: "till_revenue" | "till_checks" | "purchases" | "variance_net";
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

/** The till's word for a check, in plain terms. */
function checkLabel(c: {
  external_check_id?: unknown;
  voided?: unknown;
}): string {
  const ref =
    typeof c.external_check_id === "string" && c.external_check_id
      ? ` ${c.external_check_id}`
      : "";
  return c.voided === true
    ? `Check${ref} voided at the till`
    : `Check${ref} arrived from the till`;
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
        changes: { month, version },
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

  /** The house's closes, newest month first, every version. */
  async listCloses(restaurantId: string): Promise<{ closes: MonthCloseDto[] }> {
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
    const inMonth = (day: string | null) =>
      day !== null && day >= first && day <= last;

    const [till, stock, purchases] = await Promise.all([
      this.tillChanges(restaurantId, row, bounds, inMonth),
      this.stockChanges(restaurantId, row, bounds),
      this.purchaseChanges(restaurantId, row, bounds),
    ]);
    const currency = row.figures.currency ?? null;
    const { figures: now } = await this.readFigures(
      restaurantId,
      row.month,
      row.zone,
      currency,
      false,
    );

    const people = await this.peopleNames([
      row.closed_by,
      ...stock.rows.map((r) => r.who),
      ...purchases.rows.map((r) => r.who),
    ]);
    const named = (c: ChangedAfterClose): ChangedAfterClose =>
      c.kind === "till"
        ? c
        : { ...c, who: people.get(c.who) ?? "someone no longer on the team" };

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
  ): Promise<{ figures: MonthFigures; tillWindow: unknown }> {
    const { first, last } = monthDays(month);
    const bounds = houseDayBounds(first, last, zone);
    const [tillWindow, summary, orders, counts] = await Promise.all([
      this.goals.getPosRevenueWindow(restaurantId, 30, month),
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
            .gte("counted_at", bounds.startIso)
            .lt("counted_at", bounds.endIso) as never,
      ),
    ]);

    const totals = new Map<string | null, number>();
    let unpriced = 0;
    for (const o of orders) {
      const cost = orderSpend(o);
      if (cost === null) {
        unpriced += 1;
        continue;
      }
      // An order naming no currency is in the house's money (F-1052).
      const code = codeOf(o.currency) ?? currency;
      totals.set(code, (totals.get(code) ?? 0) + cost);
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
      till: {
        posConnected: tillWindow.posConnected,
        revenue: tillWindow.revenue,
        checkCount: tillWindow.checkCount,
        days: tillWindow.dailySeries,
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
      },
      variance: {
        counts: counts.length,
        netBottles,
        shortBottles,
        overBottles,
      },
    };
    return { figures, tillWindow };
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
   * Checks filed on the month's house days that reached the books, or that
   * the till changed (a void, a late close), after the close. `imported_at`
   * is the first arrival only: a later copy of the same check updates the
   * row and leaves it, so `source_modified_at` is read beside it.
   */
  private async tillChanges(
    restaurantId: string,
    row: CloseRow,
    bounds: { readFromIso: string; endIso: string },
    inMonth: (day: string | null) => boolean,
  ): Promise<{ rows: ChangedAfterClose[]; more: number }> {
    const { data, error, count } = await this.db
      .from("pos_checks")
      .select(
        "id, external_check_id, total, voided, opened_at, closed_at, imported_at, source_modified_at",
        {
          count: "exact",
        },
      )
      .eq("restaurant_id", restaurantId)
      .or(
        `imported_at.gt."${row.closed_at}",source_modified_at.gt."${row.closed_at}"`,
      )
      .gte("opened_at", bounds.readFromIso)
      .lt("opened_at", bounds.endIso)
      .order("imported_at", { ascending: false })
      .limit(CHANGED_AFTER_CLOSE_CAP);
    if (error)
      throw new Error(
        `The till's checks since the close could not be read: ${error.message}`,
      );
    const rows: ChangedAfterClose[] = [];
    for (const c of (data ?? []) as Array<Record<string, unknown>>) {
      const day = houseDayOf(
        c as { closed_at?: string | null; opened_at?: string | null },
        row.zone,
      );
      if (!inMonth(day)) continue;
      const total = finite(c.total);
      const arrived = String(c.imported_at);
      const changed =
        typeof c.source_modified_at === "string" ? c.source_modified_at : null;
      rows.push({
        kind: "till",
        at:
          changed !== null && Date.parse(changed) > Date.parse(arrived)
            ? changed
            : arrived,
        day: day as string,
        who: "The till",
        what: checkLabel(c),
        delta: c.voided === true ? (total === null ? null : -total) : total,
        unit: "money",
        currency: null,
      });
    }
    return { rows, more: Math.max(0, (count ?? 0) - CHANGED_AFTER_CLOSE_CAP) };
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
        "id, inventory_id, transaction_type, quantity_change, performed_by, transaction_date, created_at",
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
        who: typeof t.performed_by === "string" ? t.performed_by : "",
        what: `${MOVEMENT_WORDS[String(t.transaction_type)] ?? "Stock changed"}: ${wines.get(String(t.inventory_id)) ?? "a wine no longer listed"}`,
        delta: finite(t.quantity_change),
        unit: "bottles" as const,
        currency: null,
      })),
      more: Math.max(0, (count ?? 0) - CHANGED_AFTER_CLOSE_CAP),
    };
  }

  /** Orders delivered inside the month and changed after the close. */
  private async purchaseChanges(
    restaurantId: string,
    row: CloseRow,
    bounds: { startIso: string; endIso: string },
  ): Promise<{ rows: ChangedAfterClose[]; more: number }> {
    const { data, error, count } = await this.db
      .from("procurement_orders")
      .select(
        "id, order_number, total_cost, currency, status, delivered_at, updated_at, received_by, created_by",
        {
          count: "exact",
        },
      )
      .eq("restaurant_id", restaurantId)
      .gt("updated_at", row.closed_at)
      .gte("delivered_at", bounds.startIso)
      .lt("delivered_at", bounds.endIso)
      .order("updated_at", { ascending: false })
      .limit(CHANGED_AFTER_CLOSE_CAP);
    if (error)
      throw new Error(
        `The orders changed since the close could not be read: ${error.message}`,
      );
    return {
      rows: ((data ?? []) as Array<Record<string, unknown>>).map((o) => {
        const counted = (ORDER_SPEND_STATUSES as readonly string[]).includes(
          String(o.status),
        );
        return {
          kind: "purchase" as const,
          at: String(o.updated_at),
          day: houseDayOf(String(o.delivered_at), row.zone) ?? "",
          who:
            typeof o.received_by === "string"
              ? o.received_by
              : typeof o.created_by === "string"
                ? o.created_by
                : "",
          what: counted
            ? `Order ${String(o.order_number ?? "")} changed; it now stands at`
            : `Order ${String(o.order_number ?? "")} is no longer counted as delivered`,
          delta: counted ? orderSpend(o) : null,
          unit: "money" as const,
          currency: codeOf(o.currency),
        };
      }),
      more: Math.max(0, (count ?? 0) - CHANGED_AFTER_CLOSE_CAP),
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
      figures: row.figures,
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
      "till_revenue",
      "Taken through the till",
      kept.till.revenue,
      now.till.revenue,
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
