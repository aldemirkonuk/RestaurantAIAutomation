import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DatabaseService } from "../../database/database.service";
import { InsightGeneratorService } from "./insight-generator.service";
import { InsightCategory } from "./insight-catalog";

/**
 * InsightSchedulerService — manager-preference-driven refresh.
 *
 * Cadence lives in `analytics_insight_prefs` (per restaurant × category):
 *   hourly  — refresh every sweep
 *   daily   — refresh when local sweep hour == hour_of_day and not yet run today
 *   weekly  — same, Mondays only
 *   manual  — never auto-refresh (the UI's refresh button calls the API)
 *
 * A single hourly sweep walks all restaurants; categories with no pref row
 * default to daily @ 06:00. Failures are per-restaurant isolated.
 */
@Injectable()
export class InsightSchedulerService {
  private readonly logger = new Logger(InsightSchedulerService.name);
  private sweeping = false;

  constructor(
    private readonly dbService: DatabaseService,
    private readonly generator: InsightGeneratorService,
  ) {}

  static readonly ALL_CATEGORIES: InsightCategory[] = [
    "sales",
    "purchasing",
    "inventory",
    "efficiency",
    "tables",
    "staff",
    "basket",
    "risk",
    "forecast",
    "goals",
  ];

  @Cron(CronExpression.EVERY_HOUR)
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.runSweep(new Date());
    } catch (err: any) {
      this.logger.error(`Insight sweep failed: ${err?.message}`);
    } finally {
      this.sweeping = false;
    }
  }

  /** Exposed for tests and the manual "refresh all" admin path. */
  async runSweep(now: Date) {
    const client = this.dbService.getClient();
    const { data: restaurants } = await client
      .from("restaurants")
      .select("id")
      .limit(500);
    if (!restaurants?.length) return;

    const { data: prefRows } = await client
      .from("analytics_insight_prefs")
      .select("*");
    const prefs = new Map<string, any>();
    for (const p of prefRows || [])
      prefs.set(`${p.restaurant_id}:${p.category}`, p);

    const hour = now.getHours();
    const weekday = now.getDay();
    const todayStr = now.toISOString().substring(0, 10);

    for (const r of restaurants) {
      const due: InsightCategory[] = [];
      for (const category of InsightSchedulerService.ALL_CATEGORIES) {
        const p = prefs.get(`${r.id}:${category}`) ?? {
          cadence: "daily",
          hour_of_day: 6,
          enabled: true,
          last_run_at: null,
        };
        if (!p.enabled || p.cadence === "manual") continue;
        const lastRunDay = p.last_run_at
          ? String(p.last_run_at).substring(0, 10)
          : null;
        const ranToday = lastRunDay === todayStr;
        if (p.cadence === "hourly") due.push(category);
        else if (
          p.cadence === "daily" &&
          hour === (p.hour_of_day ?? 6) &&
          !ranToday
        )
          due.push(category);
        else if (
          p.cadence === "weekly" &&
          weekday === 1 &&
          hour === (p.hour_of_day ?? 6) &&
          !ranToday
        )
          due.push(category);
      }
      if (!due.length) continue;
      try {
        await this.generator.generate(r.id, {
          categories: due,
          persist: true,
        });
        await client.from("analytics_insight_prefs").upsert(
          due.map((category) => ({
            restaurant_id: r.id,
            category,
            cadence: prefs.get(`${r.id}:${category}`)?.cadence ?? "daily",
            hour_of_day: prefs.get(`${r.id}:${category}`)?.hour_of_day ?? 6,
            enabled: true,
            last_run_at: now.toISOString(),
            updated_at: now.toISOString(),
          })),
          { onConflict: "restaurant_id,category" },
        );
        this.logger.log(`Insights refreshed for ${r.id}: [${due.join(", ")}]`);
      } catch (err: any) {
        this.logger.warn(`Insight refresh failed for ${r.id}: ${err?.message}`);
      }
    }
  }

  // ---- prefs API -----------------------------------------------------------

  async getPrefs(restaurantId: string) {
    const { data } = await this.dbService
      .getClient()
      .from("analytics_insight_prefs")
      .select("*")
      .eq("restaurant_id", restaurantId);
    const byCat = new Map((data || []).map((p: any) => [p.category, p]));
    return InsightSchedulerService.ALL_CATEGORIES.map((category) => {
      const p: any = byCat.get(category);
      return {
        category,
        cadence: p?.cadence ?? "daily",
        hourOfDay: p?.hour_of_day ?? 6,
        enabled: p?.enabled ?? true,
        lastRunAt: p?.last_run_at ?? null,
      };
    });
  }

  async setPref(
    restaurantId: string,
    category: string,
    pref: { cadence?: string; hourOfDay?: number; enabled?: boolean },
  ) {
    if (
      !InsightSchedulerService.ALL_CATEGORIES.includes(
        category as InsightCategory,
      )
    )
      throw new Error(`Unknown category '${category}'`);
    const cadence = pref.cadence ?? "daily";
    if (!["hourly", "daily", "weekly", "manual"].includes(cadence))
      throw new Error(`Invalid cadence '${cadence}'`);
    const { data, error } = await this.dbService
      .getClient()
      .from("analytics_insight_prefs")
      .upsert(
        {
          restaurant_id: restaurantId,
          category,
          cadence,
          hour_of_day: Math.min(23, Math.max(0, pref.hourOfDay ?? 6)),
          enabled: pref.enabled ?? true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id,category" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
}
