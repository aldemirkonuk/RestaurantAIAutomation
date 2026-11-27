import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { readHistoryCsv } from "./history-import";

/** Upserts go in chunks, so no request carries more than this many rows. */
export const HISTORY_CHUNK = 500;

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
 * g3). Owner or manager only. The sales go to `pos_sales_history`, never to
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
      stockMoved: false as const,
      errors: [] as string[],
    };
    const today = houseDay(house.timezone, now);
    if (!today) {
      return { ...base, fileRefused: "The house's clock is not set, so its days cannot be read. Set it in Settings first." };
    }
    const currency = typeof house.currency === "string" && house.currency ? house.currency : null;
    const reading = readHistoryCsv(csv, { todayDay: today, moneySet: currency !== null });
    const answer: HistoryImportAnswer = {
      ...base,
      rowsRead: reading.rowsRead,
      refused: reading.refused,
      refusedCount: reading.refusedCount,
      netDropped: reading.netDropped,
      fileRefused: reading.fileRefused,
    };
    if (reading.fileRefused || reading.sales.length === 0) return answer;

    const savedDays = new Set<string>();
    for (let i = 0; i < reading.sales.length; i += HISTORY_CHUNK) {
      const chunk = reading.sales.slice(i, i + HISTORY_CHUNK);
      const rows = chunk.map((s) => ({
        restaurant_id: restaurantId,
        sale_date: s.saleDate,
        item_key: s.itemKey,
        item_name: s.itemName,
        qty: s.qty,
        net: s.net,
        currency: s.net === null ? null : currency,
        imported_by: userId,
        imported_at: now.toISOString(),
      }));
      const { error: writeError } = await client
        .from("pos_sales_history")
        .upsert(rows, { onConflict: "restaurant_id,sale_date,item_key" });
      if (writeError) {
        this.logger.warn(`history import r=${restaurantId}: a chunk of ${rows.length} was refused: ${writeError.message}`);
        answer.errors.push(`${rows.length} item-days were not saved just now. Send the file again; saved days are not doubled.`);
        continue;
      }
      answer.salesSaved += rows.length;
      for (const s of chunk) savedDays.add(s.saleDate);
    }
    answer.daysRead = savedDays.size;
    return answer;
  }
}
