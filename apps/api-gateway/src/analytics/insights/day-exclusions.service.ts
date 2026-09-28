import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";

export interface DayExclusionRow {
  businessDate: string;
  reason: string | null;
  createdAt: string | null;
}

/**
 * What the engine's baselines were told to ignore.
 *
 * `readable: false` means the store could not be read AT ALL — not that there
 * are no exclusions. The two are different facts and the difference matters:
 * an unreadable exclusion list means every baseline on the page was computed
 * over days the manager may have already ruled out, and the surface has to say
 * so rather than present the numbers as clean. (ADR 0020 / the standing rule
 * that a system reporting on itself must prove presence, never infer health
 * from absence.)
 */
export interface DayExclusions {
  dates: Set<string>;
  readable: boolean;
  /** Why it could not be read, when it could not. */
  problem: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * DayExclusionsService — the engine's one hook for "do not count this day".
 *
 * There was no such hook before this file. `InsightGeneratorService.toDaily`
 * bucketed rows by day and filled every gap with a literal 0, so a closure, a
 * POS outage and a genuinely dead Wednesday were the same number to every
 * baseline downstream. That is what produced the sentence the founder quoted —
 * "Wednesday sales came in 100% lower than your average Wednesday" — on a day
 * with no records at all.
 *
 * Two separate repairs follow from that, and they are deliberately NOT the same
 * mechanism:
 *   1. a day with no rows is now UNOBSERVED, not zero, and the generator
 *      withholds rather than misstates (see `insight-generator.service.ts`);
 *   2. a day the manager marks — a closure, a private buyout, a fire drill —
 *      is excluded here, and the engine drops it from the series entirely so it
 *      cannot drag an average either way.
 *
 * (1) is the engine refusing to invent data. (2) is the manager's judgement.
 * Storing them together would make it impossible to tell which is which later.
 */
@Injectable()
export class DayExclusionsService {
  private readonly logger = new Logger(DayExclusionsService.name);

  constructor(private readonly dbService: DatabaseService) {}

  /** The set the engine consults. Never throws — but never lies either. */
  async load(restaurantId: string): Promise<DayExclusions> {
    try {
      const { data, error } = await this.dbService
        .getClient()
        .from("analytics_day_exclusions")
        .select("business_date")
        .eq("restaurant_id", restaurantId);
      if (error) throw new Error(error.message);
      const dates = new Set<string>();
      for (const r of data || []) {
        const d = String((r as { business_date?: unknown }).business_date ?? "");
        if (ISO_DAY.test(d)) dates.add(d);
        else if (d.length >= 10 && ISO_DAY.test(d.slice(0, 10)))
          dates.add(d.slice(0, 10));
      }
      return { dates, readable: true, problem: null };
    } catch (err: any) {
      const problem = err?.message || "the exclusion list could not be read";
      this.logger.warn(`day exclusions unreadable: ${problem}`);
      return { dates: new Set<string>(), readable: false, problem };
    }
  }

  async list(restaurantId: string): Promise<{
    items: DayExclusionRow[];
    readable: boolean;
    problem: string | null;
  }> {
    try {
      const { data, error } = await this.dbService
        .getClient()
        .from("analytics_day_exclusions")
        .select("business_date, reason, created_at")
        .eq("restaurant_id", restaurantId)
        .order("business_date", { ascending: false });
      if (error) throw new Error(error.message);
      return {
        items: (data || []).map((r: any) => ({
          businessDate: String(r.business_date ?? "").slice(0, 10),
          reason: r.reason ?? null,
          createdAt: r.created_at ?? null,
        })),
        readable: true,
        problem: null,
      };
    } catch (err: any) {
      return {
        items: [],
        readable: false,
        problem: err?.message || "the exclusion list could not be read",
      };
    }
  }

  /**
   * Exclude a day. Throws on a bad date or a failed write — a caller must not
   * be able to believe a day was excluded when nothing was stored.
   */
  async exclude(
    restaurantId: string,
    businessDate: string,
    reason?: string | null,
    createdBy?: string | null,
  ): Promise<DayExclusionRow> {
    const date = (businessDate || "").slice(0, 10);
    if (!ISO_DAY.test(date))
      throw new Error(`businessDate must be YYYY-MM-DD, got '${businessDate}'`);
    const row: Record<string, unknown> = {
      restaurant_id: restaurantId,
      business_date: date,
      reason: reason ?? null,
    };
    if (createdBy) row.created_by = createdBy;
    const { data, error } = await this.dbService
      .getClient()
      .from("analytics_day_exclusions")
      .upsert(row, { onConflict: "restaurant_id,business_date" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return {
      businessDate: String((data as any)?.business_date ?? date).slice(0, 10),
      reason: (data as any)?.reason ?? null,
      createdAt: (data as any)?.created_at ?? null,
    };
  }

  /** Put the day back into the analysis. Throws if the delete did not run. */
  async include(restaurantId: string, businessDate: string): Promise<void> {
    const date = (businessDate || "").slice(0, 10);
    if (!ISO_DAY.test(date))
      throw new Error(`businessDate must be YYYY-MM-DD, got '${businessDate}'`);
    const { error } = await this.dbService
      .getClient()
      .from("analytics_day_exclusions")
      .delete()
      .eq("restaurant_id", restaurantId)
      .eq("business_date", date);
    if (error) throw new Error(error.message);
  }
}
