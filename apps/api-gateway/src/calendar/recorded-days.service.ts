import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

/**
 * What the ledger actually recorded, day by day — slice 3 of ADR 0111.
 *
 * THE RULE THE WHOLE SLICE TURNS ON
 * ---------------------------------
 * "Left of today a cell holds what the ledger recorded; right of today it holds
 * a forecast that names its issuer; when a day passes the cell keeps both and
 * states the error." This service is the first half of that sentence, and it is
 * deliberately the dullest code in the calendar: it sums two columns and counts
 * rows. There is no model here, no fill, no smoothing.
 *
 * WHY IT IS NOT `GET /analytics/pos-revenue`
 * ------------------------------------------
 * That endpoint answers a WINDOW — one revenue figure and a sparse
 * `dailySeries` of revenue only (analytics/goals.service.ts `getPosRevenueWindow`,
 * exposed at analytics.controller.ts:738). The calendar needs covers per day,
 * which no endpoint in the gateway returns, and it needs the days a house was
 * SHUT distinguished from the days nothing landed.
 *
 * THE THREE STATES A DAY CAN BE IN, AND WHY THEY MAY NEVER COLLAPSE
 * -----------------------------------------------------------------
 *   recorded  — checks landed. `covers` may still be null on a check, so the
 *               day's covers is null when NO check on it carried one; summing
 *               nulls as zero would report "nobody came" for a POS that simply
 *               does not send cover counts.
 *   excluded  — the house was shut and a human said so
 *               (`analytics_day_exclusions`, 20260903091000). Drawn hatched,
 *               never as a zero, because a closure counted as a zero is the
 *               single most damaging input a demand model can be given.
 *   silent    — no checks and no exclusion. This is genuinely unknown: the
 *               house may have been shut, or the POS may have been down, and
 *               nothing in the database can tell the two apart. The cell says
 *               "nothing recorded", never "0 covers".
 *
 * `posConnected: false` is the fourth answer and it is about the RESTAURANT,
 * not the window: a house that has never had a check land has no ledger at all,
 * and every day in the window is `unknown` rather than `silent`.
 */

/** One day the ledger can speak about. */
export interface RecordedDay {
  businessDate: string;
  /** Non-voided checks that closed on this day. */
  checkCount: number;
  /** Sum of `pos_checks.total`. Null only when no check carried a total. */
  sales: number | null;
  /** Sum of `pos_checks.covers`. NULL when no check on the day carried one. */
  covers: number | null;
  /** True when a human ruled this day out of the baselines. */
  excluded: boolean;
  /** The reason they gave, when they gave one. */
  exclusionReason: string | null;
}

export interface RecordedWindow {
  from: string;
  to: string;
  /**
   * False when this restaurant has never had a POS check land. Every day is
   * then unknown, and no cell may draw a zero.
   */
  posConnected: boolean;
  /** Only days with something to say. A day absent here is `silent`. */
  days: RecordedDay[];
  /**
   * The sentence to print when the register could not be read at all. Null on
   * success — including the success where the answer is "nothing yet".
   */
  refusal: string | null;
}

interface CheckRow {
  opened_at: string | null;
  closed_at: string | null;
  total: string | number | null;
  covers: number | null;
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The business date of a check.
 *
 * `closed_at` where present, else `opened_at` — the same rule
 * `goals.service.ts:752` applies, quoted here so the calendar and goal progress
 * can never disagree about which day a check belongs to. The date is taken off
 * the timestamp's leading ten characters, which is UTC; the restaurant's own
 * midnight would need its zone, and that refinement is filed rather than
 * guessed (calendar.md §13).
 */
export function checkBusinessDate(row: CheckRow): string | null {
  const stamp = row.closed_at || row.opened_at;
  return typeof stamp === "string" && stamp.length >= 10
    ? stamp.slice(0, 10)
    : null;
}

/**
 * Fold checks onto days.
 *
 * Exported for its own spec: this is the only arithmetic in the file, so it is
 * the only place a fabrication could hide.
 */
export function foldChecksToDays(rows: CheckRow[]): Map<string, RecordedDay> {
  const days = new Map<string, RecordedDay>();

  for (const row of rows) {
    const date = checkBusinessDate(row);
    if (!date) continue;

    const day = days.get(date) ?? {
      businessDate: date,
      checkCount: 0,
      sales: null,
      covers: null,
      excluded: false,
      exclusionReason: null,
    };

    day.checkCount += 1;

    const total = num(row.total);
    if (total !== null) day.sales = (day.sales ?? 0) + total;

    // Null covers stay null. A POS that does not send cover counts must not
    // produce a day reading "0 covers" beside a day of real trading.
    if (typeof row.covers === "number" && Number.isFinite(row.covers)) {
      day.covers = (day.covers ?? 0) + row.covers;
    }

    days.set(date, day);
  }

  return days;
}

@Injectable()
export class RecordedDaysService {
  private readonly logger = new Logger(RecordedDaysService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async windowFor(
    restaurantId: string,
    from: string,
    to: string,
  ): Promise<RecordedWindow> {
    const client = this.databaseService.supabase;

    // The window is inclusive of both ends; `lt` on the day after `to` is what
    // makes a check closing at 23:30 on the last day count.
    const until = new Date(`${to}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + 1);
    const untilIso = until.toISOString();

    const { data: checks, error: checksError } = await client
      .from("pos_checks")
      .select("opened_at, closed_at, total, covers")
      .eq("restaurant_id", restaurantId)
      // Voided checks are not trading. The same filter goal progress applies
      // (goals.service.ts:740), so the two readers cannot drift.
      .eq("voided", false)
      .gte("opened_at", `${from}T00:00:00Z`)
      .lt("opened_at", untilIso);

    if (checksError) {
      // Never `days: []`. An unreadable register and a quiet month are the
      // same empty array to a caller reading only `data`, which is the exact
      // defect ADR 0020 exists to prevent.
      this.logger.warn(
        `pos_checks unreadable for r=${restaurantId}: ${checksError.message}`,
      );
      return {
        from,
        to,
        posConnected: false,
        days: [],
        refusal: "The sales register could not be read.",
      };
    }

    const rows = (checks ?? []) as CheckRow[];
    const days = foldChecksToDays(rows);

    // Whether this house has EVER had a check land. A window with no rows in a
    // house that trades is a quiet fortnight; the same window in a house with
    // no POS is a register that does not exist, and the cells say different
    // things.
    let posConnected = rows.length > 0;
    if (!posConnected) {
      const { data: any, error: anyError } = await client
        .from("pos_checks")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .limit(1);
      if (anyError) {
        return {
          from,
          to,
          posConnected: false,
          days: [],
          refusal: "The sales register could not be read.",
        };
      }
      posConnected = (any ?? []).length > 0;
    }

    const { data: exclusions, error: exclusionError } = await client
      .from("analytics_day_exclusions")
      .select("business_date, reason")
      .eq("restaurant_id", restaurantId)
      .gte("business_date", from)
      .lte("business_date", to);

    if (exclusionError) {
      // `analytics_day_exclusions` is on this branch and NOT in production
      // (calendar.md §9.9 — a select against it answers 42P01 live today). A
      // missing table must not take the recorded ledger down with it, so the
      // failure is logged and the days lose only their hatching.
      this.logger.warn(
        `analytics_day_exclusions unreadable for r=${restaurantId}: ${exclusionError.message}`,
      );
    }

    for (const row of exclusions ?? []) {
      const date = String(row.business_date).slice(0, 10);
      const day = days.get(date) ?? {
        businessDate: date,
        checkCount: 0,
        sales: null,
        covers: null,
        excluded: false,
        exclusionReason: null,
      };
      day.excluded = true;
      day.exclusionReason = (row.reason as string | null) ?? null;
      days.set(date, day);
    }

    return {
      from,
      to,
      posConnected,
      days: [...days.values()].sort((a, b) =>
        a.businessDate.localeCompare(b.businessDate),
      ),
      refusal: null,
    };
  }
}
