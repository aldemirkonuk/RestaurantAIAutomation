import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { readHistoryCsv } from "./history-import";

/** Writes go in chunks of whole days, so no request carries more than this many rows (a day over it goes alone). */
export const HISTORY_CHUNK = 500;

/**
 * Cuts the sales into chunks that never split a day: the import replaces a
 * day whole, so a day sent in two calls would have its first part deleted by
 * the second.
 */
export function chunksByDay<T extends { saleDate: string }>(sales: T[], size: number): T[][] {
  const byDay = new Map<string, T[]>();
  for (const s of sales) {
    const day = byDay.get(s.saleDate);
    if (day) day.push(s);
    else byDay.set(s.saleDate, [s]);
  }
  const chunks: T[][] = [];
  let cur: T[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const rows = byDay.get(day) as T[];
    if (cur.length > 0 && cur.length + rows.length > size) {
      chunks.push(cur);
      cur = [];
    }
    cur = cur.concat(rows);
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

export interface HistoryImportAnswer {
  /** Days of sales the file carried that were saved. */
  daysRead: number;
  /** Item-days saved (one per day and item). */
  salesSaved: number;
  rowsRead: number;
  /** The first 50 rows not taken, each with why. */
  refused: string[];
  refusedCount: number;
  /** Net sales were in the file but the house's money is not set. */
  netDropped: boolean;
  /** Rows whose net was written in another currency than the house's: the net was left out, the quantity kept. */
  netForeign: string[];
  netForeignCount: number;
  /**
   * Days the till itself already reported (a check on that house-day), so
   * their history was not brought in: the house's own checks are that day's
   * record, and history beside them would count its takings twice
   * (DD-r109-22 (2), DD-r110-19). Sorted, at most 50.
   */
  daysHeldByChecks: string[];
  daysHeldByChecksCount: number;
  /** Those days in words, or null when there were none. */
  daysHeldByChecksSaid: string | null;
  /** Always false: history is not a sale the shelf saw (ADR 0281, amended 2026-11-27). */
  stockMoved: false;
  /** A refusal of the whole file, in words, or null. */
  fileRefused: string | null;
  errors: string[];
}

/** The house's day today, in its own zone, or null when the zone is unset or unknown. */
export function houseDay(timeZone: string | null | undefined, now: Date): string | null {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return null;
  }
}

/**
 * A till's last 90 days of item sales, brought in on day one (r109 onboarding
 * g3). Owner or manager only. The sales go to `pos_sales_history` through
 * `import_pos_sales_history`, which refuses a day the till already holds
 * (DD-r110-19); never to
 * `pos_checks`: an item-day is not a check, and the till's Checks and
 * Average, the recorded days and the record-day bell all count check rows.
 * Nothing here reaches `apply_stock_movement`, `record_glass_pour` or the
 * consumption mirror, because nothing here is in the ingest path at all.
 */
@Injectable()
export class PosHistoryImportService {
  private readonly logger = new Logger(PosHistoryImportService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  async importHistory(
    userId: string,
    restaurantId: string,
    csv: unknown,
    now: Date = new Date(),
  ): Promise<HistoryImportAnswer> {
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "bring the till's past sales into this house",
    );
    if (typeof csv !== "string" || csv.trim() === "") {
      throw new BadRequestException("Send the till's export as text, under csv.");
    }
    const client = this.dbService.getClient();
    const { data: house, error } = await client
      .from("restaurants")
      .select("timezone, currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error || !house) {
      throw new ServiceUnavailableException("The house could not be read just now, so nothing was read.");
    }
    const base = {
      daysRead: 0,
      salesSaved: 0,
      rowsRead: 0,
      refused: [] as string[],
      refusedCount: 0,
      netDropped: false,
      netForeign: [] as string[],
      netForeignCount: 0,
      daysHeldByChecks: [] as string[],
      daysHeldByChecksCount: 0,
      daysHeldByChecksSaid: null as string | null,
      stockMoved: false as const,
      errors: [] as string[],
    };
    const today = houseDay(house.timezone, now);
    if (!today) {
      return { ...base, fileRefused: "The house's clock is not set, so its days cannot be read. Set it in Settings first." };
    }
    const currency = typeof house.currency === "string" && house.currency ? house.currency : null;
    const reading = readHistoryCsv(csv, { todayDay: today, moneySet: currency !== null, currency });
    const answer: HistoryImportAnswer = {
      ...base,
      rowsRead: reading.rowsRead,
      refused: reading.refused,
      refusedCount: reading.refusedCount,
      netDropped: reading.netDropped,
      netForeign: reading.netForeign,
      netForeignCount: reading.netForeignCount,
      fileRefused: reading.fileRefused,
    };
    if (reading.fileRefused || reading.sales.length === 0) return answer;

    const savedDays = new Set<string>();
    const failedDays = new Set<string>();
    const heldDays = new Set<string>();
    for (const chunk of chunksByDay(reading.sales, HISTORY_CHUNK)) {
      const rows = chunk.map((s) => ({
        sale_date: s.saleDate,
        item_key: s.itemKey,
        item_name: s.itemName,
        qty: s.qty,
        net: s.net,
        currency: s.net === null ? null : currency,
        imported_by: userId,
        imported_at: now.toISOString(),
      }));
      // One transaction per chunk: each day takes the day lock a check takes,
      // and a day that already holds a check is refused, not saved.
      const { data: saved, error: writeError } = await client.rpc("import_pos_sales_history", {
        p_restaurant_id: restaurantId,
        p_rows: rows,
      });
      if (writeError) {
        this.logger.warn(`history import r=${restaurantId}: a chunk of ${rows.length} was refused: ${writeError.message}`);
        for (const s of chunk) failedDays.add(s.saleDate);
        answer.errors.push(`${rows.length} item-days were not saved just now. Send the file again; saved days are not doubled.`);
        continue;
      }
      const refusedHere = new Set<string>(Array.isArray(saved?.refused_days) ? saved.refused_days : []);
      answer.salesSaved += typeof saved?.saved === "number" ? saved.saved : 0;
      for (const s of chunk) (refusedHere.has(s.saleDate) ? heldDays : savedDays).add(s.saleDate);
    }
    // A day held by checks in any chunk keeps no history: a check's trigger
    // deleted what an earlier chunk of it saved, in the check's transaction.
    const held = [...heldDays].sort();
    answer.daysHeldByChecks = held.slice(0, 50);
    answer.daysHeldByChecksCount = held.length;
    if (held.length > 0) {
      answer.daysHeldByChecksSaid = (
        `${held.length === 1 ? "1 day already holds" : `${held.length} days already hold`} the till's own checks, so ${held.length === 1 ? "its" : "their"} history was not brought in and the checks stand: ${held.slice(0, 5).join(", ")}${held.length > 5 ? ` and ${held.length - 5} more` : ""}.`
      );
    }
    // A day with any item in a failed chunk is not whole, so it is not counted as read.
    answer.daysRead = [...savedDays].filter((d) => !failedDays.has(d) && !heldDays.has(d)).length;
    if (failedDays.size > 0) {
      const days = [...failedDays].sort();
      answer.errors.push(
        `Not every item was saved for ${days.length === 1 ? "this day" : "these days"}: ${days.slice(0, 5).join(", ")}${days.length > 5 ? ` and ${days.length - 5} more` : ""}.`,
      );
    }
    return answer;
  }
}
