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
import {
  COUNT_PERIOD_GRACE_MS,
  filedMonth,
} from "../../inventory/count-period";
import { takeOffOnlyReason } from "../../inventory-ledger/inventory-ledger.service";
import { ORDER_ARRIVED_STATUSES } from "../../procurement/order-status";
import { ProcurementOrderStatus } from "../../procurement/dto/procurement.dto";
import { orderSpend } from "../../procurement/order-spend";
import {
  EXPORT_CUTTINGS,
  countWithheld,
} from "../exports/report-export-cuttings";
import {
  withheld,
  type Cell,
  type ExportDoc,
} from "../exports/report-export-doc";
import { houseSlug, writtenLabel } from "../exports/report-export-naming";
import { renderCsv } from "../exports/report-export-render";
import { taxWordFor } from "../../settings/house-tax-basis.service";
import {
  readTaxBasisHistory,
  stretchOn,
  stretchWords,
  taxBasisStretches,
  taxChangeNote,
} from "../../common/tax-basis-history";

/**
 * Month close — F-1013, the founder's ruling of 2026-10-11 (sim ledger S195):
 * option C, the SNAPSHOT close.
 *
 * An owner or manager closes a month of the house's calendar. The gateway
 * reads the month's figures once and keeps them in `month_closes`, a table
 * that refuses every edit (20270105600000): the till's month (and its file,
 * written as the export shelf writes it), the cellar's value, the purchases
 * delivered in the month, the count variance and the month's write-offs
 * (F-1609). That row is the record.
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
 *  - A stock-take's count is filed in the month its session states, when it
 *    was made within 6 hours after that month ended (F-1544 lane 5, the
 *    founder's F1 b, 2026-10-12 S224). Its counted moment is not moved; only
 *    the month it is filed in. Every other count is filed by its moment.
 *  - The month's write-offs (F-1609) are read from the typed stock movements:
 *    breakage, comps, staff pours and other bottles written off, each at the
 *    cost of the delivery lots it came off. A close kept before F-1609 has no
 *    write-off figure, and says so; it is never read as none.
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
  "id, restaurant_id, month, version, closed_by, closed_at, zone, figures, tax_basis";

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
   * F-1606: the tax inside the till's prices, gross less net (`gross_subtotal`
   * − `subtotal`), over the checks ingest made pre-tax for a house whose
   * prices include tax (ADR 0341): stamped `prices_include_tax`, carrying
   * both figures, and the two differ. A check whose till had already taken
   * the tax off carries the same figure twice and is not one of them. Null
   * when no check carries it. Absent on a close kept before F-1606.
   */
  taxInside?: number | null;
  /** Checks whose tax is in `taxInside`; the rest of `netSalesCheckCount` carry none. */
  taxInsideCheckCount?: number | null;
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
  /**
   * F-1652: wines whose cost covers only some of their bottles, and those
   * bottles; the priced total holds their costed bottles only. Absent on a
   * close kept before.
   */
  partlyCostedWines?: number | null;
  uncostedBottles?: number | null;
  /**
   * F-1654: of `unpricedWines`, those whose bottles carry a cost the house
   * typed in or an order's price, but no invoice. Absent on a close kept
   * before.
   */
  notInvoicedWines?: number | null;
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
   * Delivered on the month's house days but still open (F-1632): a backorder
   * still to come, or the invoice not checked yet (`PARTIALLY_RECEIVED`). Not
   * in `totals` — widening the spend statuses is a money-rule change (F-130 /
   * D6) — and said beside them at order total. Absent on a close kept before.
   */
  awaiting?: { orders: number; totals: MoneyTotal[] };
  /**
   * Each counted order's total and money at the close, by id (F-1466): an
   * order is listed as changed only when what it counts for moved. Kept in
   * the record; never sent to the page.
   */
  kept?: Record<string, { total: number | null; currency: string | null }>;
}

/**
 * Shelf counts filed in the month: taken on its house days, and a
 * stock-take's counts made within 6 hours after it ended (F-1544 lane 5).
 */
export interface VarianceFigures {
  counts: number;
  /** Counted less expected, in bottles, over every count. */
  netBottles: number;
  /** Bottles found missing (counts below the books). */
  shortBottles: number;
  /** Bottles found over (counts above the books). */
  overBottles: number;
  /**
   * Open bottles, in ml, over the counts that named them (F-1544, F3 a).
   * Absent on a close kept before lane 5: unknown, never 0.
   */
  openMl?: {
    /** Counts that named their open bottles. */
    counts: number;
    netMl: number;
    shortMl: number;
    overMl: number;
  };
}

/** Why bottles were written off, as the movement that took them off says. */
export type WriteOffReason = "breakage" | "comp" | "staff_pour" | "other";

export const WRITE_OFF_LABELS: Record<WriteOffReason, string> = {
  breakage: "Breakage",
  comp: "Comps",
  staff_pour: "Staff pours",
  other: "Other write-offs",
};

/** One reason's share of the month's write-offs. */
export interface WriteOffLine {
  /** Take-off movements. */
  movements: number;
  bottles: number;
  /**
   * The bottles' cost, from the delivery lots they came off, in the house's
   * money; null when none of them carried a cost. 0 only when nothing was
   * written off.
   */
  cost: number | null;
  /**
   * Bottles left out of `cost`: their lot carried no cost, or a cost in
   * another money than the house's.
   */
  uncostedBottles: number;
  /**
   * F-1653: of `uncostedBottles`, those whose cost is in another money than
   * the house's (a lot from an order in EUR, at a TRY house): nothing
   * converts, so it is never added in. Absent on a close kept before.
   */
  otherMoneyBottles?: number;
  /**
   * F-1653: of the bottles in `cost`, those whose cost is not from an invoice
   * — an order's price, a cost the house typed in, or one carried by a bottle
   * that came back. The cellar value counts only invoiced costs, so these are
   * said. Absent on a close kept before.
   */
  notInvoicedBottles?: number;
}

/**
 * Bottles taken off on purpose on the month's house days (F-1609): written
 * off (`waste`), given on the house (`comp`), and a manual adjustment that
 * names breakage, a comp or a staff pour. A shelf count is variance, a
 * correction is a data-entry fix and a return to the vendor comes back as
 * money, so none of those is a write-off.
 */
export interface WriteOffFigures extends WriteOffLine {
  /** Only reasons with a movement, in WRITE_OFF_LABELS order. */
  byReason: Array<WriteOffLine & { reason: WriteOffReason; label: string }>;
}

export interface MonthFigures {
  /** The house's money when the month was closed; null when none is recorded. */
  currency: string | null;
  /**
   * F-1606: the house day the house last stated its tax basis (ADR 0341's
   * switch day: checks from it on are net without tax, checks before it are
   * as the till sent them). Null when it never has. Absent on a close kept
   * before F-1606.
   */
  taxBasisSince?: string | null;
  /**
   * F-1624 / F-1588: when the house changed its tax answer inside the month
   * (include, then "added on top", then include again), one sentence naming
   * each stretch. Null when the month is on one answer. Absent on a close
   * kept before answers were kept. Also set when the whole month was on an
   * answer the house replaced after it, so the basis line (which names the
   * answer in force at the close) is never read as the month's own.
   */
  taxChangeNote?: string | null;
  /** How the house's country names its tax ("KDV", "sales tax", "tax"). */
  taxWord?: string;
  till: TillFigures;
  valuation: ValuationFigures;
  purchases: PurchaseFigures;
  variance: VarianceFigures;
  /** Absent on a close kept before F-1609: unknown, never none. */
  writeOffs?: WriteOffFigures;
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
  /**
   * F-1606: the house's tax basis when it was closed (ADR 0341). Null on a
   * close kept before the close recorded it: not stated, never guessed.
   */
  taxBasis: string | null;
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
  /** Bottles for stock; ml for open bottles counted; money for the till and purchases. */
  delta: number | null;
  unit: "bottles" | "ml" | "money";
  /** For money: the code it is in; null is the house's money. */
  currency: string | null;
}

export interface FigureAgainstNow {
  figure:
    | "till_net_sales"
    | "till_checks"
    | "purchases"
    | "variance_net"
    | "variance_open_ml"
    | "writeoffs_bottles"
    | "writeoffs_cost";
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
  /** F-1606: `gross_subtotal`, and the basis ingest wrote it under. */
  gross: number | null;
  taxBasis: string | null;
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
  tax_basis?: string | null;
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

/**
 * The write-off reason of one take-off movement, or null when it is not a
 * write-off (F-1609). A manual adjustment counts only when its reason is one
 * the ledger already holds to take bottles off (`takeOffOnlyReason`, F-1163).
 */
export function writeOffReasonOf(
  type: unknown,
  reason: unknown,
): WriteOffReason | null {
  const r = typeof reason === "string" ? reason : "";
  if (type !== "comp" && type !== "waste" && type !== "adjustment") return null;
  // The reason first (F-1614): /inventory files a staff pour as type "comp",
  // so reading the type first put every staff pour under Comps.
  const t = takeOffOnlyReason(r);
  if (t === "Breakage") return "breakage";
  if (t === "A comp") return "comp";
  if (t === "A staff pour") return "staff_pour";
  if (type === "comp") return "comp";
  if (type === "waste") return /breakage/i.test(r) ? "breakage" : "other";
  return null;
}

/**
 * What one take-off cost, from the lots it took (`metadata.lots_taken`, kept
 * by apply_stock_movement), else the row's own cost. A lot with no cost, or a
 * sample's (never a real cost), leaves its bottles uncosted.
 *
 * F-1653: a lot whose cost states another money than the house's is never
 * added into the house-money total; its bottles are uncosted and counted as
 * in another money. A cost not from an invoice (`estimated` order price,
 * `manual` typed cost, a row's own cost with no lot behind it) is added, and
 * its bottles are counted, so the page can say so.
 */
function takeOffCost(
  t: Record<string, unknown>,
  houseCurrency: string | null = null,
): {
  bottles: number;
  cost: number;
  uncosted: number;
  otherMoney: number;
  notInvoiced: number;
} {
  const bottles = Math.abs(finite(t.quantity_change) ?? 0);
  const meta = (t.metadata ?? {}) as Record<string, unknown>;
  const lots = Array.isArray(meta.lots_taken)
    ? (meta.lots_taken as Array<Record<string, unknown>>)
    : [];
  const house = codeOf(houseCurrency);
  let cost = 0;
  let costed = 0;
  let otherMoney = 0;
  let notInvoiced = 0;
  if (lots.length > 0) {
    for (const l of lots) {
      const qty = finite(l?.qty);
      const unit = finite(l?.unit_cost);
      if (qty === null || qty <= 0) continue;
      if (unit === null || l.cost_provenance === "sample") continue;
      // A lot that states no money (kept before the key) is the house's, as
      // the cellar reads one; one that states another is never added in.
      const money = codeOf(l.unit_cost_currency);
      if (money !== null && house !== null && money !== house) {
        otherMoney += qty;
        continue;
      }
      cost += qty * unit;
      costed += qty;
      if (l.cost_provenance !== "invoice") notInvoiced += qty;
    }
  } else {
    const total = finite(t.total_cost);
    const unit = finite(t.unit_cost);
    if (total !== null) {
      cost = Math.abs(total);
      costed = bottles;
    } else if (unit !== null) {
      cost = unit * bottles;
      costed = bottles;
    }
    // No lot names where this cost came from, so it is not an invoice's.
    notInvoiced = costed;
  }
  costed = Math.min(costed, bottles);
  return {
    bottles,
    cost,
    uncosted: bottles - costed,
    otherMoney: Math.min(otherMoney, bottles - costed),
    notInvoiced: Math.min(notInvoiced, costed),
  };
}

/** The month's take-off movements summed into the write-off figure. */
export function writeOffFigures(
  rows: Array<Record<string, unknown>>,
  houseCurrency: string | null = null,
): WriteOffFigures {
  const zero = (): WriteOffLine => ({
    movements: 0,
    bottles: 0,
    cost: 0,
    uncostedBottles: 0,
    otherMoneyBottles: 0,
    notInvoicedBottles: 0,
  });
  const all = zero();
  const by = new Map<WriteOffReason, WriteOffLine>();
  for (const t of rows) {
    if ((finite(t.quantity_change) ?? 0) >= 0) continue;
    const reason = writeOffReasonOf(t.transaction_type, t.reason);
    if (reason === null) continue;
    const { bottles, cost, uncosted, otherMoney, notInvoiced } = takeOffCost(
      t,
      houseCurrency,
    );
    const line = by.get(reason) ?? zero();
    by.set(reason, line);
    for (const l of [all, line]) {
      l.movements += 1;
      l.bottles += bottles;
      l.cost = (l.cost ?? 0) + cost;
      l.uncostedBottles += uncosted;
      l.otherMoneyBottles = (l.otherMoneyBottles ?? 0) + otherMoney;
      l.notInvoicedBottles = (l.notInvoicedBottles ?? 0) + notInvoiced;
    }
  }
  // A cost none of the bottles carried is unknown, never 0.
  const settle = (l: WriteOffLine): WriteOffLine => ({
    ...l,
    cost:
      l.bottles > 0 && l.uncostedBottles === l.bottles
        ? null
        : cents(l.cost ?? 0),
  });
  return {
    ...settle(all),
    byReason: (Object.keys(WRITE_OFF_LABELS) as WriteOffReason[])
      .filter((r) => by.has(r))
      .map((r) => ({
        reason: r,
        label: WRITE_OFF_LABELS[r],
        ...settle(by.get(r)!),
      })),
  };
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
    const { figures: read, tillWindow } = await this.readFigures(
      restaurantId,
      month,
      zone,
      house.currency,
    );
    // F-1606: the basis the month's net was on, and the day it was stated,
    // so a year of closes shows where the net stopped holding the tax.
    // F-1624: every answer the house gave, not only the last; a change inside
    // the month is named stretch by stretch. A history that cannot be read
    // refuses the close.
    const stretches = taxBasisStretches(
      await readTaxBasisHistory(this.db, restaurantId, {
        basis: house.taxBasis,
        confirmedAt: house.taxBasisConfirmedAt,
      }),
      zone,
    );
    const days = monthDays(month);
    const taxWord = taxWordFor(house.country);
    // taxBasisSince stays the day the answer in force took effect (F-1606):
    // the basis line pairs it with that answer, so the first answer's day
    // would read an earlier "added on top" stretch as net without tax.
    const current = stretches[stretches.length - 1];
    const opening = stretchOn(stretches, days.first);
    const figures: MonthFigures = {
      ...read,
      taxBasisSince:
        current && current.basis === house.taxBasis
          ? current.fromDay
          : house.taxBasisConfirmedAt
            ? houseDayOf(house.taxBasisConfirmedAt, zone)
            : null,
      taxChangeNote:
        taxChangeNote(stretches, days.first, days.last, taxWord) ??
        // The whole month on an answer the house replaced after it.
        (opening && opening !== current
          ? `All of this month, ${stretchWords(opening.basis, taxWord)}. The house changed its answer about ${taxWord} after the month; checks already recorded keep the answer they were recorded under.`
          : null),
      taxWord,
    };
    // F-1625: only a house whose prices include tax (or a month that took tax
    // out of some check) gets the line; a US or unset house's file is unchanged.
    const saysTaxInside =
      house.taxBasis === "prices_include_tax" ||
      (figures.till.taxInside ?? null) !== null;
    const tillCsv = this.tillFile(
      // The month's tax rides with the till's file (F-1606).
      tillWindow && typeof tillWindow === "object" && saysTaxInside
        ? {
            ...tillWindow,
            taxInside: figures.till.taxInside ?? null,
            taxInsideCheckCount: figures.till.taxInsideCheckCount ?? null,
            netSalesCheckCount: figures.till.netSalesCheckCount,
            taxWord: figures.taxWord,
          }
        : tillWindow,
      month,
      zone,
      house,
    );

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
        tax_basis: house.taxBasis,
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

    const [{ figures: now, checks, counts }, stock] = await Promise.all([
      this.readFigures(restaurantId, row.month, row.zone, currency, false),
      this.stockChanges(restaurantId, row, bounds),
    ]);
    const till = this.tillChanges(row, checks);
    const purchases = await this.purchaseChanges(restaurantId, row, now);
    const openMl = await this.openMlChanges(row, counts);

    const people = await this.peopleNames([
      row.closed_by,
      ...stock.rows.map((r) => r.who),
      ...purchases.rows.map((r) => r.who),
      ...openMl.rows.map((r) => r.who),
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
      ...openMl.rows.map(named),
      ...purchases.rows.map(named),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return {
      ...this.toDto(row, typeof row.till_csv === "string", people),
      changes,
      changesNotListed: till.more + stock.more + openMl.more + purchases.more,
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
    // Named for its house (F-1631). The kept file does not depend on the
    // name, so a failed name read gives the shelf's "house", not a refusal.
    const name = await this.readHouse(restaurantId).then(
      (h) => h.name,
      () => null,
    );
    return {
      filename: `mudavym-${houseSlug(name)}-till-${row.month}-closed-v${row.version}.csv`,
      body: row.till_csv,
    };
  }

  /**
   * The month's write-offs as they were kept at the close (F-1609), written
   * up as the export shelf writes a file. Drawn from the record only, so it
   * says what the close said however the books have moved since.
   */
  async writeOffsCsv(
    restaurantId: string,
    closeId: string,
  ): Promise<{ filename: string; body: string }> {
    const row = await this.readRow(restaurantId, closeId, false);
    const w = row.figures.writeOffs;
    if (!w)
      throw new NotFoundException(
        `${monthName(row.month)} was closed before write-offs were kept with a close. Close it again to keep them.`,
      );
    const house = await this.readHouse(restaurantId);
    const doc = writeOffsDoc(w, row);
    const csv = renderCsv(doc, {
      houseName: house.name,
      currency: row.figures.currency ?? null,
      title: "Write-offs",
      windowLabel: `${monthName(row.month)}, by the house’s days, as closed (version ${row.version})`,
      writtenAt: new Date().toISOString(),
      timezone: row.zone,
      locale: houseFrame({ timezone: house.timezone, country: house.country })
        .locale,
      withheldCount: countWithheld(doc),
    });
    return {
      filename: `mudavym-${houseSlug(house.name)}-writeoffs-${row.month}-closed-v${row.version}.csv`,
      body: csv,
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
    taxBasis: string | null;
    taxBasisConfirmedAt: string | null;
  }> {
    const { data, error } = await this.db
      .from("restaurants")
      .select(
        "name, currency, timezone, country, tax_basis, tax_basis_confirmed_at",
      )
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) throw new Error(`The house could not be read: ${error.message}`);
    const h = (data ?? {}) as Record<string, unknown>;
    return {
      name: typeof h.name === "string" && h.name ? h.name : null,
      currency: codeOf(h.currency),
      timezone: typeof h.timezone === "string" ? h.timezone : null,
      country: typeof h.country === "string" ? h.country : null,
      taxBasis: typeof h.tax_basis === "string" ? h.tax_basis : null,
      taxBasisConfirmedAt:
        typeof h.tax_basis_confirmed_at === "string"
          ? h.tax_basis_confirmed_at
          : null,
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
    /** The shelf counts filed in the month (F-1544 lane 5). */
    counts: Array<Record<string, unknown>>;
  }> {
    const { first, last } = monthDays(month);
    const bounds = houseDayBounds(first, last, zone);
    const [tillWindow, rawChecks, summary, orders, monthCounts, takeOffs] =
      await Promise.all([
        this.goals.getPosRevenueWindow(restaurantId, 30, month),
        // The month's checks, voided ones too: the net figure is summed from
        // them, and a later read sets each against the one kept (F-1467).
        readWholeWindow<Record<string, unknown>>(
          "The till's checks in this month",
          () =>
            this.db
              .from("pos_checks")
              .select(
                "id, external_check_id, subtotal, gross_subtotal, tax_basis, voided, opened_at, closed_at, imported_at, source_modified_at",
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
              .select("id, status, total_cost, currency, delivered_at", {
                count: "exact",
              })
              .eq("restaurant_id", restaurantId)
              // Spend statuses, and the still-open deliveries said beside them (F-1632).
              .in("status", ORDER_ARRIVED_STATUSES as unknown as string[])
              .gte("delivered_at", bounds.startIso)
              .lt("delivered_at", bounds.endIso) as never,
        ),
        readWholeWindow<Record<string, unknown>>(
          "The shelf counts taken in this month",
          () =>
            this.db
              .from("stock_counts")
              .select(
                "id, inventory_id, expected_qty, counted_qty, variance_qty, variance_open_ml, counted_by, counted_at, arrived_at, session_id",
                {
                  count: "exact",
                },
              )
              .eq("restaurant_id", restaurantId)
              // F-1514, ADR 0335 §2: an opening count is the first count
              // variance is measured from, never a variance itself.
              .neq("source", OPENING_COUNT_SOURCE)
              .gte("counted_at", bounds.startIso)
              .lt("counted_at", bounds.endIso) as never,
        ),
        // F-1609: the month's take-offs, written off on purpose; which of them
        // is a write-off is `writeOffReasonOf`'s call.
        readWholeWindow<Record<string, unknown>>(
          "The bottles written off in this month",
          () =>
            this.db
              .from("inventory_transactions")
              .select(
                "id, transaction_type, reason, quantity_change, unit_cost, total_cost, metadata, transaction_date",
                { count: "exact" },
              )
              .eq("restaurant_id", restaurantId)
              .in("transaction_type", ["waste", "comp", "adjustment"])
              .lt("quantity_change", 0)
              .gte("transaction_date", bounds.startIso)
              .lt("transaction_date", bounds.endIso) as never,
        ),
      ]);
    const counts = await this.countsFiledIn(
      restaurantId,
      month,
      zone,
      bounds,
      monthCounts,
    );

    const totals = new Map<string | null, number>();
    const keptOrders: NonNullable<PurchaseFigures["kept"]> = {};
    let unpriced = 0;
    const awaitingTotals = new Map<string | null, number>();
    let awaitingOrders = 0;
    let spendOrders = 0;
    for (const o of orders) {
      const cost = orderSpend(o);
      // An order naming no currency is in the house's money (F-1052).
      const code = codeOf(o.currency) ?? currency;
      if (o.status === ProcurementOrderStatus.PARTIALLY_RECEIVED) {
        awaitingOrders += 1;
        if (cost !== null)
          awaitingTotals.set(code, (awaitingTotals.get(code) ?? 0) + cost);
        continue;
      }
      spendOrders += 1;
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
        gross: finite(c.gross_subtotal),
        taxBasis: typeof c.tax_basis === "string" ? c.tax_basis : null,
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
    let taxInside: number | null = null;
    let taxInsideCheckCount = 0;
    for (const c of checks) {
      if (c.voided) continue;
      checkCount += 1;
      keptChecks[c.id] = c.net;
      if (c.net === null) continue;
      netSales = (netSales ?? 0) + c.net;
      netSalesCheckCount += 1;
      netByDay.set(c.day, (netByDay.get(c.day) ?? 0) + c.net);
      // F-1606: gross less net, only where ingest took tax out of the price.
      if (
        c.taxBasis === "prices_include_tax" &&
        c.gross !== null &&
        c.gross !== c.net
      ) {
        taxInside = (taxInside ?? 0) + (c.gross - c.net);
        taxInsideCheckCount += 1;
      }
    }

    let netBottles = 0;
    let shortBottles = 0;
    let overBottles = 0;
    const openMl = { counts: 0, netMl: 0, shortMl: 0, overMl: 0 };
    for (const c of counts) {
      const v =
        finite(c.variance_qty) ??
        (finite(c.counted_qty) ?? 0) - (finite(c.expected_qty) ?? 0);
      netBottles += v;
      if (v < 0) shortBottles += -v;
      else overBottles += v;
      // F-1544 F3 (a): a count that named its open bottles; null = not named.
      const ml = finite(c.variance_open_ml);
      if (ml === null) continue;
      openMl.counts += 1;
      openMl.netMl += ml;
      if (ml < 0) openMl.shortMl += -ml;
      else openMl.overMl += ml;
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
            taxInside: taxInside === null ? null : cents(taxInside),
            taxInsideCheckCount,
            kept: keptChecks,
          }
        : {
            posConnected: false,
            netSales: null,
            netSalesCheckCount: null,
            checkCount: null,
            days: [],
            taxInside: null,
            taxInsideCheckCount: null,
            kept: {},
          },
      valuation: {
        inventoryValue: finite(s.inventoryValue),
        pricedInventoryValue: finite(s.pricedInventoryValue),
        unpricedWines: finite(coverage.unpriced),
        partlyCostedWines: finite(coverage.partial),
        uncostedBottles: finite(coverage.uncostedBottles),
        notInvoicedWines: finite(s.notInvoicedWines),
        valuedAt: new Date().toISOString(),
      },
      purchases: {
        orders: spendOrders,
        unpriced,
        totals: [...totals.entries()]
          .map(([c, total]) => ({ currency: c, total }))
          .sort((a, b) => String(a.currency).localeCompare(String(b.currency))),
        awaiting: {
          orders: awaitingOrders,
          totals: [...awaitingTotals.entries()]
            .map(([c, total]) => ({ currency: c, total }))
            .sort((a, b) =>
              String(a.currency).localeCompare(String(b.currency)),
            ),
        },
        kept: keptOrders,
      },
      variance: {
        counts: counts.length,
        netBottles,
        shortBottles,
        overBottles,
        openMl,
      },
      writeOffs: writeOffFigures(takeOffs, currency),
    };
    return { figures, tillWindow, checks, counts };
  }

  /**
   * The stock-take months the month's counts and its 6-hour tail name, by
   * session id. A read that fails refuses, as every figure read does: a
   * count filed in the wrong month is a short record.
   */
  private async sessionPeriods(
    restaurantId: string,
    sessionIds: string[],
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const want = [...new Set(sessionIds)];
    if (want.length === 0) return out;
    const { data, error } = await this.db
      .from("stock_count_sessions")
      .select("id, attributed_period")
      .eq("restaurant_id", restaurantId)
      .in("id", want);
    if (error)
      throw new Error(
        `The stock-takes the counts belong to could not be read: ${error.message}`,
      );
    for (const s of (data ?? []) as Array<{
      id: string;
      attributed_period: string | null;
    }>)
      out.set(s.id, s.attributed_period ?? null);
    return out;
  }

  /**
   * F-1544 lane 5 (F1 b): the counts filed in the month. The month's own
   * counts, less a stock-take's counts made in the first 6 hours that its
   * session files in the month before; plus this month's stock-take counts
   * made in the 6 hours after it ended. A count with no session is filed by
   * its moment, exactly as before: the tail read asks only for session counts.
   */
  private async countsFiledIn(
    restaurantId: string,
    month: string,
    zone: string,
    bounds: { startIso: string; endIso: string },
    monthCounts: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    const tailEndIso = new Date(
      Date.parse(bounds.endIso) + COUNT_PERIOD_GRACE_MS,
    ).toISOString();
    const tail = await readWholeWindow<Record<string, unknown>>(
      "The stock-take counts made just after this month ended",
      () =>
        this.db
          .from("stock_counts")
          .select(
            "id, inventory_id, expected_qty, counted_qty, variance_qty, variance_open_ml, counted_by, counted_at, arrived_at, session_id",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId)
          .neq("source", OPENING_COUNT_SOURCE)
          .not("session_id", "is", null)
          .gte("counted_at", bounds.endIso)
          .lt("counted_at", tailEndIso) as never,
    );
    const sid = (c: Record<string, unknown>) =>
      typeof c.session_id === "string" ? c.session_id : null;
    const periods = await this.sessionPeriods(
      restaurantId,
      [...monthCounts.map(sid), ...tail.map(sid)].filter(
        (s): s is string => s !== null,
      ),
    );
    const filed = (c: Record<string, unknown>) =>
      filedMonth(
        typeof c.counted_at === "string" ? c.counted_at : null,
        periods.get(sid(c) ?? "") ?? null,
        zone,
      );
    return [
      // A month row is kept unless its session files it elsewhere.
      ...monthCounts.filter((c) => {
        if (sid(c) === null) return true;
        const m = filed(c);
        return m === null || m === month;
      }),
      ...tail.filter((c) => filed(c) === month),
    ];
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

  /**
   * Stock movements filed in the month and recorded after the close: those
   * dated inside it, and (F-1544 lane 5) a stock-take count's movement made
   * in the 6 hours after it ended that its session files in it. A stock-take
   * count's movement in the first 6 hours that its session files in the month
   * before is that month's change, not this one's.
   */
  private async stockChanges(
    restaurantId: string,
    row: CloseRow,
    bounds: { startIso: string; endIso: string },
  ): Promise<{ rows: ChangedAfterClose[]; more: number }> {
    const { elsewhere, here } = await this.sessionMovementsAcross(
      restaurantId,
      row,
      bounds,
    );
    let inMonth = this.db
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
      .lt("transaction_date", bounds.endIso);
    if (elsewhere.length > 0)
      inMonth = inMonth.not("id", "in", `(${elsewhere.join(",")})`);
    const { data, error, count } = await inMonth
      .order("created_at", { ascending: false })
      .limit(CHANGED_AFTER_CLOSE_CAP);
    if (error)
      throw new Error(
        `The stock movements since the close could not be read: ${error.message}`,
      );
    let late: Array<Record<string, unknown>> = [];
    if (here.length > 0) {
      const tail = await this.db
        .from("inventory_transactions")
        .select(
          "id, inventory_id, transaction_type, source, quantity_change, performed_by, transaction_date, created_at",
        )
        .eq("restaurant_id", restaurantId)
        .gt("created_at", row.closed_at)
        .in("id", here.slice(0, CHANGED_AFTER_CLOSE_CAP));
      if (tail.error)
        throw new Error(
          `The stock-take counts made just after this month could not be read: ${tail.error.message}`,
        );
      late = (tail.data ?? []) as Array<Record<string, unknown>>;
    }
    const all = [
      ...((data ?? []) as Array<Record<string, unknown>>),
      ...late,
    ].sort((x, y) =>
      String(x.created_at) < String(y.created_at)
        ? 1
        : String(x.created_at) > String(y.created_at)
          ? -1
          : 0,
    );
    const list = all.slice(0, CHANGED_AFTER_CLOSE_CAP);
    const lateIds = new Set(late.map((t) => String(t.id)));
    const total =
      (count ?? (data ?? []).length) +
      late.length +
      Math.max(0, here.length - CHANGED_AFTER_CLOSE_CAP);
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
        what: `${MOVEMENT_WORDS[String(t.transaction_type)] ?? "Stock changed"}: ${wines.get(String(t.inventory_id)) ?? "a wine no longer listed"}${lateIds.has(String(t.id)) ? " (counted just after the month ended; the count was for this month)" : ""}`,
        delta: finite(t.quantity_change),
        unit: "bottles" as const,
        currency: null,
      })),
      more: Math.max(0, total - CHANGED_AFTER_CLOSE_CAP),
    };
  }

  /**
   * S227 owed (F-1544 F3 a): each count filed in the month that named its
   * open bottles and reached the books after the close (`arrived_at`, so a
   * paper sheet or a queued phone line dated inside the month is found by
   * when it arrived, not by when it was counted). A count that agreed with
   * the books in whole bottles moves no stock, so the stock list cannot show
   * it; its open bottles still move the open-bottle figure. The listed ml add
   * up to that figure's move. A count with no `arrived_at` predates the
   * column, and so the close.
   */
  private async openMlChanges(
    row: CloseRow,
    counts: Array<Record<string, unknown>>,
  ): Promise<{ rows: ChangedAfterClose[]; more: number }> {
    const closed = Date.parse(row.closed_at);
    const late = counts
      .filter(
        (c) =>
          finite(c.variance_open_ml) !== null &&
          typeof c.arrived_at === "string" &&
          Date.parse(c.arrived_at) > closed,
      )
      .sort(
        (x, y) =>
          Date.parse(String(y.arrived_at)) - Date.parse(String(x.arrived_at)),
      );
    const list = late.slice(0, CHANGED_AFTER_CLOSE_CAP);
    const wines = await this.wineNames(
      list.map((c) =>
        typeof c.inventory_id === "string" ? c.inventory_id : null,
      ),
    );
    return {
      rows: list.map((c) => ({
        kind: "stock" as const,
        at: String(c.arrived_at),
        day: houseDayOf(String(c.counted_at), row.zone) ?? "",
        who: typeof c.counted_by === "string" ? c.counted_by : NOT_RECORDED,
        what: `Open bottles counted: ${wines.get(String(c.inventory_id)) ?? "an item no longer listed"}`,
        delta: finite(c.variance_open_ml),
        unit: "ml" as const,
        currency: null,
      })),
      more: Math.max(0, late.length - CHANGED_AFTER_CLOSE_CAP),
    };
  }

  /**
   * F-1544 lane 5: the movements of stock-take counts made within 6 hours
   * after a month line that their session files on the other side of it.
   * `elsewhere`: made in this month's first 6 hours, filed in the month
   * before. `here`: made in the 6 hours after this month, filed in it.
   * A count that moved no stock (it agreed with the books) has no movement.
   */
  private async sessionMovementsAcross(
    restaurantId: string,
    row: CloseRow,
    bounds: { startIso: string; endIso: string },
  ): Promise<{ elsewhere: string[]; here: string[] }> {
    const after = (iso: string) =>
      new Date(Date.parse(iso) + COUNT_PERIOD_GRACE_MS).toISOString();
    const read = async (fromIso: string) => {
      const { data, error } = await this.db
        .from("stock_counts")
        .select("id, counted_at, session_id, transaction_id")
        .eq("restaurant_id", restaurantId)
        .not("session_id", "is", null)
        .not("transaction_id", "is", null)
        .gte("counted_at", fromIso)
        .lt("counted_at", after(fromIso));
      if (error)
        throw new Error(
          `The stock-take counts at the month's edges could not be read: ${error.message}`,
        );
      return (data ?? []) as Array<Record<string, unknown>>;
    };
    const [head, tail] = await Promise.all([
      read(bounds.startIso),
      read(bounds.endIso),
    ]);
    const sid = (c: Record<string, unknown>) =>
      typeof c.session_id === "string" ? c.session_id : null;
    const periods = await this.sessionPeriods(
      restaurantId,
      [...head, ...tail].map(sid).filter((s): s is string => s !== null),
    );
    const filed = (c: Record<string, unknown>) =>
      filedMonth(
        typeof c.counted_at === "string" ? c.counted_at : null,
        periods.get(sid(c) ?? "") ?? null,
        row.zone,
      );
    const tx = (c: Record<string, unknown>) =>
      typeof c.transaction_id === "string" ? [c.transaction_id] : [];
    return {
      elsewhere: head
        .filter((c) => sid(c) !== null && filed(c) !== row.month)
        .flatMap(tx),
      here: tail
        .filter((c) => sid(c) !== null && filed(c) === row.month)
        .flatMap(tx),
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
      taxBasis: row.tax_basis ?? null,
      hasTillFile,
    };
  }
}

/** The kept write-offs as an export document (F-1609). */
export function writeOffsDoc(
  w: WriteOffFigures,
  row: Pick<CloseRow, "closed_at" | "zone">,
): ExportDoc {
  const noCost =
    "none of these bottles came off stock with a cost in the house's money";
  const notKept = "not counted when this month was closed";
  const cost = (l: WriteOffLine): Cell =>
    l.cost === null ? withheld(noCost) : l.cost;
  return {
    say: null,
    figures: [
      { label: "Bottles written off", value: w.bottles, unit: "bottles" },
      { label: "Take-offs", value: w.movements, unit: "count" },
      { label: "Written off, at cost", value: cost(w), unit: "money" },
      {
        label: "Bottles with no recorded cost",
        value: w.uncostedBottles,
        unit: "bottles",
      },
      // F-1653: said beside the total, never folded into it. A close kept
      // before these were counted withholds them rather than saying 0.
      {
        label: "Of them, at a cost in another money",
        value:
          w.otherMoneyBottles === undefined
            ? withheld(notKept)
            : w.otherMoneyBottles,
        unit: "bottles",
      },
      {
        label: "Bottles at a cost not from an invoice",
        value:
          w.notInvoicedBottles === undefined
            ? withheld(notKept)
            : w.notInvoicedBottles,
        unit: "bottles",
      },
    ],
    tables: [
      {
        title: "By reason",
        columns: [
          { label: "Reason", unit: "text" },
          { label: "Take-offs", unit: "count" },
          { label: "Bottles", unit: "bottles" },
          { label: "At cost", unit: "money" },
          { label: "Bottles with no recorded cost", unit: "bottles" },
        ],
        rows: w.byReason.map((l) => [
          l.label,
          l.movements,
          l.bottles,
          cost(l),
          l.uncostedBottles,
        ]),
        note:
          w.byReason.length === 0
            ? "Nothing was written off in this month."
            : undefined,
      },
    ],
    notes: [
      `Kept when the month was closed, ${writtenLabel(row.closed_at, row.zone)}.`,
    ],
    basis: [
      "Write-offs are the bottles taken off on purpose on the month's house days: written off, given on the house, and a stock adjustment for breakage, a comp or a staff pour. Shelf-count differences, corrections and returns to the vendor are not write-offs.",
      "Each bottle is at the cost of the stock it came off: an invoice's, an order's price, a cost the house typed in, or the cost a bottle that came back carried. Bottles at a cost that is not an invoice's are counted beside the total. A bottle with no cost, or with a cost in another money than the house's, is counted, and left out of the cost.",
    ],
  };
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
    // F-1609: a close kept before write-offs were kept has none to set
    // against now: unknown, never 0.
    pair(
      "writeoffs_bottles",
      "Written off, bottles",
      kept.writeOffs?.bottles ?? null,
      now.writeOffs?.bottles ?? null,
      null,
    ),
    pair(
      "writeoffs_cost",
      "Written off, at cost",
      kept.writeOffs?.cost ?? null,
      now.writeOffs?.cost ?? null,
      kept.currency,
    ),
  );
  // F-1544 F3 (a): open bottles, once either side has a count that named
  // them. A close kept before lane 5 has no figure: unknown, never 0.
  const keptMl = kept.variance.openMl;
  const nowMl = now.variance.openMl;
  if ((keptMl?.counts ?? 0) > 0 || (nowMl?.counts ?? 0) > 0)
    out.push(
      pair(
        "variance_open_ml",
        "Count variance, open bottles, ml",
        keptMl ? keptMl.netMl : null,
        nowMl ? nowMl.netMl : null,
        null,
      ),
    );
  return out;
}
