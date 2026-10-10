import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DatabaseService } from "../../database/database.service";
import { InsightGeneratorService } from "./insight-generator.service";
import { InsightCategory } from "./insight-catalog";
import { GoalsService } from "../goals.service";
import { houseFrame } from "../../common/house-frame";
import { houseDayOf } from "../../common/house-day";
import { houseWallAt } from "../../notifications/low-stock-digest-clock";

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
 *
 * "Local" is the HOUSE's clock (F-329): the hour, the weekday and "today" are
 * read in its zone, so an LA house's 06:00 is 06:00 in Los Angeles, not 06:00
 * UTC (23:00 the evening before, mid-service). A house with no known zone
 * keeps the server's clock, as before.
 */
@Injectable()
export class InsightSchedulerService {
  private readonly logger = new Logger(InsightSchedulerService.name);
  private sweeping = false;

  constructor(
    private readonly dbService: DatabaseService,
    private readonly generator: InsightGeneratorService,
    // Optional only so the existing specs can construct this without it;
    // Nest always injects it (both live in AnalyticsModule).
    @Optional() private readonly goals?: GoalsService,
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
    // This is the widest blast radius in the swallowed-read class (ADR 0067):
    // the error was discarded, `restaurants` came back null, and the early
    // return no-opped the ENTIRE insight sweep — every category, every tenant,
    // every hour — while `sweep()` above logged nothing because supabase-js
    // resolves rather than throws, so its try/catch never fired. A tenant
    // list that cannot be read is not "there are no tenants"; throw, so the
    // hourly cron's own catch records a failed sweep.
    const { data: restaurants, error: restaurantsError } = await client
      .from("restaurants")
      .select("id, timezone, country")
      .limit(500);
    if (restaurantsError)
      throw new Error(
        `restaurants lookup failed, refusing to report a no-op sweep as a ` +
          `clean one: ${restaurantsError.code ?? "?"} ${restaurantsError.message}`,
      );
    if (!restaurants?.length) return;

    // A failed prefs read is survivable — every category falls back to the
    // default cadence below — but it silently ignores every operator's
    // configured schedule, so it is said out loud rather than absorbed.
    const { data: prefRows, error: prefsError } = await client
      .from("analytics_insight_prefs")
      .select("*");
    if (prefsError)
      this.logger.error(
        `analytics_insight_prefs read failed — this sweep will use DEFAULT ` +
          `cadences for all ${restaurants.length} restaurants, ignoring every ` +
          `configured schedule: ${prefsError.code ?? "?"} ${prefsError.message}`,
      );
    const prefs = new Map<string, any>();
    for (const p of prefRows || [])
      prefs.set(`${p.restaurant_id}:${p.category}`, p);

    // Rows produced by superseded arithmetic are not merely stale, they are
    // retracted claims — `getStored()` already refuses to serve them, but the
    // cadence gate below would leave them in the table for up to 24 hours (a
    // `daily @ 06:00` category refreshes once a day and not before). On
    // 2026-09-03 that gap was measured: a day after the observed-day fix
    // shipped, the demo tenant's cache still held "Tuesday sales came in 100%
    // lower than your average Tuesday ($0 vs $72)". So a stale version makes a
    // category due NOW, whatever its cadence says.
    //
    // A failed scan is said out loud rather than absorbed: it means this sweep
    // could not tell which tenants are carrying superseded rows, and those
    // rows will keep being withheld from readers (correct) but not replaced
    // (the thing this block exists to do).
    const staleByRestaurant = await this.generator.staleVersionCategories();
    if (staleByRestaurant === null)
      this.logger.error(
        `stale-version scan failed — this sweep refreshes on CADENCE ONLY, so ` +
          `any tenant still holding rows from superseded arithmetic keeps ` +
          `holding them until its normal schedule comes round`,
      );

    for (const r of restaurants) {
      const zone = houseFrame(r as any).zone;
      const wall = zone ? houseWallAt(now, zone) : null;
      const hour = wall ? Math.floor(wall.minutes / 60) : now.getHours();
      const todayStr = wall ? wall.dateKey : now.toISOString().substring(0, 10);
      const weekday = wall
        ? new Date(`${todayStr}T00:00:00Z`).getUTCDay()
        : now.getDay();
      // The stored goal values are refreshed every sweep, whatever the goals
      // category's cadence: progress reads no longer write them (F-264), and
      // the goals family, the recommendation goal rules and the goal lists
      // all read the stored column. Before the generator, so a goals insight
      // made this hour reads this hour's value.
      if (this.goals) {
        try {
          const { failed } = await this.goals.refreshStoredCurrentValues(r.id);
          if (failed)
            this.logger.warn(
              `${failed} stored goal value(s) not refreshed for ${r.id}`,
            );
        } catch (err: any) {
          this.logger.warn(
            `Stored goal values not refreshed for ${r.id}: ${err?.message}`,
          );
        }
      }
      const stale = staleByRestaurant?.get(r.id);
      const due: InsightCategory[] = [];
      for (const category of InsightSchedulerService.ALL_CATEGORIES) {
        const p = prefs.get(`${r.id}:${category}`) ?? {
          cadence: "daily",
          hour_of_day: 6,
          enabled: true,
          last_run_at: null,
        };
        // A superseded row is replaced even for a category the operator set to
        // `manual` or disabled: those preferences govern how often we look for
        // NEW findings, not whether the product may keep serving a sentence it
        // has retracted.
        if (stale?.has(category)) {
          due.push(category);
          continue;
        }
        if (!p.enabled || p.cadence === "manual") continue;
        const lastRunDay = p.last_run_at
          ? zone
            ? houseDayOf(String(p.last_run_at), zone)
            : String(p.last_run_at).substring(0, 10)
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
        const out = await this.generator.generate(r.id, {
          categories: due,
          persist: true,
        });
        // A refused write is not a refresh. Leave last_run_at alone so the
        // category stays due and the next sweep tries again.
        if (out?.persisted === false) {
          this.logger.error(
            `Insight refresh failed for ${r.id}: the new findings could not ` +
              `be saved [${due.join(", ")}]`,
          );
          continue;
        }
        // Stamp the run and nothing else. Writing cadence/hour/enabled here
        // turned a category refreshed only because it was stale back ON, and
        // after a failed prefs read wrote the default schedule over the
        // house's own. Columns left out keep their value; a new row takes the
        // table defaults.
        const { error: stampError } = await client
          .from("analytics_insight_prefs")
          .upsert(
            due.map((category) => ({
              restaurant_id: r.id,
              category,
              last_run_at: now.toISOString(),
              updated_at: now.toISOString(),
            })),
            { onConflict: "restaurant_id,category" },
          );
        if (stampError)
          this.logger.warn(
            `Insights refreshed for ${r.id} but the run time was not saved, ` +
              `so they may refresh again this hour: ${stampError.message}`,
          );
        this.logger.log(`Insights refreshed for ${r.id}: [${due.join(", ")}]`);
      } catch (err: any) {
        this.logger.warn(`Insight refresh failed for ${r.id}: ${err?.message}`);
      }
    }
  }

  // ---- prefs API -----------------------------------------------------------

  async getPrefs(restaurantId: string) {
    const { data, error } = await this.dbService
      .getClient()
      .from("analytics_insight_prefs")
      .select("*")
      .eq("restaurant_id", restaurantId);
    // Falling back to defaults on a failed read is worse than failing: the
    // panel would show the operator a schedule they never chose, and saving
    // from that screen would WRITE those defaults over their real settings.
    if (error)
      throw new ServiceUnavailableException(
        `analytics_insight_prefs read failed for r=${restaurantId}: ` +
          `${error.code ?? "?"} ${error.message}`,
      );
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
