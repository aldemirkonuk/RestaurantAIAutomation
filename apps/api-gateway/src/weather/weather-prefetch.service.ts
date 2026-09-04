import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { WeatherService } from "./weather.service";

/**
 * One weather refresh per house per hour, for every house that has a
 * coordinate — ADR 0111, amended 2026-09-04.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The overlay refreshes on read (`weather.service.ts`), which is correct for a
 * house somebody opens and useless for one nobody does: no reads means no
 * `weather_readings` and no `weather_observations`, and slice 9's ninety-day
 * floor counts days of HISTORY, not days of existence. A house that is quiet
 * for two months would arrive at day sixty with nothing to model. The founder's
 * answer is a prefetch, so the record accumulates whether or not anyone looks.
 *
 * WHY IT DOES NOT GO THROUGH `ScheduledTenantsService.runPerTenant`
 * ----------------------------------------------------------------
 * That scheduler (ADR 0022) enumerates tenants carrying
 * `restaurant_feature_flags.flag_name = 'scheduled_communications'` or matching
 * `DEFAULT_RESTAURANT_ID` — one house of fourteen in production
 * (`communications/scheduled-tenants.service.ts:88-125`, measured 2026-09-03).
 * Routing this through it would leave thirteen houses accumulating nothing,
 * which is the exact fault the prefetch exists to prevent.
 *
 * ADR 0022's opt-in protects tenants from things that LEAVE THE HOUSE — mail,
 * messages, pushes — and this sends nothing to anybody. It reads two public
 * endpoints of a US government weather service and stores the answers against
 * the restaurant that asked. The amendment on ADR 0022 names exactly that and
 * nothing else; any future scheduled work that reaches a person still goes
 * through `runPerTenant`.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 *  - It never fetches for a house with no coordinate. There is nothing to ask
 *    about, and asking would be a call spent to be told so.
 *  - It never re-fetches a house whose reading is younger than the max age. The
 *    skip is not implemented here: it delegates to `WeatherService.windowFor`,
 *    which is the same path the page takes, so the cron and the page cannot
 *    drift about what "fresh" means.
 *  - It never lets one house's failure stop another's. Each is caught, logged
 *    in words, and the sweep continues.
 *  - It never runs two houses at once. NWS asks callers to be reasonable rather
 *    than publishing a hard limit, so the houses are walked one at a time with
 *    a pause between them, on top of the provider's own 8-second timeout.
 */

/** Top of every hour. NWS republishes its gridpoint forecast about hourly. */
const PREFETCH_CRON = "0 * * * *";
const PREFETCH_JOB_NAME = "weather-prefetch";

/**
 * Pause between houses, milliseconds.
 *
 * Not a rate limit NWS publishes — they ask for reasonable use and a
 * descriptive User-Agent rather than naming a number. At fourteen houses this
 * spreads the sweep over about twenty seconds, which is unmistakably reasonable
 * and costs nothing that matters.
 */
const PAUSE_BETWEEN_HOUSES_MS = 1500;

/** How far ahead to prefetch. The issuer's own horizon is seven days. */
const PREFETCH_DAYS = 7;

/** How far back to ask for observations, so a missed sweep still backfills. */
const PREFETCH_LOOKBACK_DAYS = 3;

export interface PrefetchRunSummary {
  startedAt: string;
  finishedAt: string;
  /** Houses with a coordinate, i.e. the ones this job can serve at all. */
  eligible: number;
  /** Houses the issuer was actually asked about. */
  fetched: number;
  /** Houses skipped because their reading was still fresh. */
  skippedFresh: number;
  /** Houses that refused in words — no coverage, issuer down, and so on. */
  refused: number;
  /** Houses that threw. Never allowed to stop the sweep. */
  failed: number;
  /** Set when the register of restaurants itself could not be read. */
  error: string | null;
}

@Injectable()
export class WeatherPrefetchService {
  private readonly logger = new Logger(WeatherPrefetchService.name);

  /** The last sweep, for a status surface to read. Null until one has run. */
  private lastRun: PrefetchRunSummary | null = null;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly weather: WeatherService,
  ) {}

  /**
   * The switch.
   *
   * Default ON, which is the opposite of `CALENDAR_REMINDERS_ENABLED` and for a
   * stated reason: that job writes to every member's inbox and phone, so it
   * must be armed deliberately. This one reads a public weather service and
   * writes two of its own tables. Shipping it off by default would mean the
   * history the founder asked for silently never accumulates — the failure
   * mode the prefetch exists to close.
   */
  private get enabled(): boolean {
    const raw = (process.env.WEATHER_PREFETCH_ENABLED ?? "").trim().toLowerCase();
    return !(raw === "false" || raw === "0" || raw === "off");
  }

  status(): { armed: boolean; cron: string; lastRun: PrefetchRunSummary | null } {
    return { armed: this.enabled, cron: PREFETCH_CRON, lastRun: this.lastRun };
  }

  @Cron(PREFETCH_CRON, { name: PREFETCH_JOB_NAME })
  async sweep(): Promise<PrefetchRunSummary> {
    const startedAt = new Date().toISOString();
    const summary: PrefetchRunSummary = {
      startedAt,
      finishedAt: startedAt,
      eligible: 0,
      fetched: 0,
      skippedFresh: 0,
      refused: 0,
      failed: 0,
      error: null,
    };

    if (!this.enabled) {
      this.logger.log(
        "Weather prefetch is switched off (WEATHER_PREFETCH_ENABLED); no house " +
          "will accumulate forecast history from a schedule this hour.",
      );
      summary.finishedAt = new Date().toISOString();
      this.lastRun = summary;
      return summary;
    }

    const houses = await this.eligibleHouses();
    if (houses === null) {
      // Never an empty list standing in for a failed read: a sweep that served
      // nobody because the register was unreachable must not look like a sweep
      // with nobody to serve.
      summary.error =
        "The restaurant register could not be read, so no house was served.";
      summary.finishedAt = new Date().toISOString();
      this.logger.error(`Weather prefetch: ${summary.error}`);
      this.lastRun = summary;
      return summary;
    }

    summary.eligible = houses.length;
    if (houses.length === 0) {
      this.logger.log(
        "Weather prefetch: no restaurant carries a coordinate, so there is " +
          "nothing to ask the weather service about. Set an address and the " +
          "coordinate is captured with it.",
      );
      summary.finishedAt = new Date().toISOString();
      this.lastRun = summary;
      return summary;
    }

    const today = new Date();
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - PREFETCH_LOOKBACK_DAYS);
    const to = new Date(today);
    to.setUTCDate(to.getUTCDate() + PREFETCH_DAYS);
    const day = (d: Date) => d.toISOString().slice(0, 10);

    for (const house of houses) {
      try {
        // The page's own path, deliberately: `windowFor` decides freshness,
        // fetches when stale, keeps what comes back, and returns words when it
        // cannot. Re-implementing any of that here would let the cron and the
        // page drift apart about what this house's weather is.
        const window = await this.weather.windowFor(house.id, day(from), day(to));

        if (window.refusal) {
          summary.refused += 1;
          this.logger.warn(
            `Weather prefetch: ${house.name} was not served — ${window.refusal}`,
          );
        } else if (!window.askedTheIssuer) {
          // `windowFor` answered from the register because the reading was
          // still inside the max age. It reports that as a fact rather than
          // leaving this loop to infer it from elapsed time.
          summary.skippedFresh += 1;
          this.logger.log(
            `Weather prefetch: ${house.name} already had a reading from ` +
              `${window.ageMinutes ?? "?"} minutes ago; the issuer was not asked.`,
          );
        } else {
          summary.fetched += 1;
          this.logger.log(
            `Weather prefetch: ${house.name} refreshed — ` +
              `${window.readings.length} forecast day(s), ` +
              `${window.observations.length} observed day(s)` +
              (window.staleReason ? `; ${window.staleReason}` : "") +
              (window.observationRefusal
                ? `; observations: ${window.observationRefusal}`
                : "") +
              ".",
          );
        }
      } catch (error) {
        // One house's failure never stops the sweep. That is the whole reason
        // this loop is a loop and not a Promise.all.
        summary.failed += 1;
        this.logger.error(
          `Weather prefetch: ${house.name} failed — ${(error as Error).message}. ` +
            "The sweep continues with the next house.",
        );
      }

      if (house !== houses[houses.length - 1]) {
        await new Promise((resolve) =>
          setTimeout(resolve, PAUSE_BETWEEN_HOUSES_MS),
        );
      }
    }

    summary.finishedAt = new Date().toISOString();
    this.logger.log(
      `Weather prefetch finished: ${summary.eligible} house(s) with a ` +
        `coordinate, ${summary.fetched} refreshed, ${summary.skippedFresh} ` +
        `already fresh, ${summary.refused} refused, ${summary.failed} failed.`,
    );
    this.lastRun = summary;
    return summary;
  }

  /**
   * The houses this job can serve: active, not deleted, and carrying BOTH
   * coordinate axes.
   *
   * Returns null — never `[]` — when the register cannot be read, so the caller
   * can tell "nobody to serve" from "could not find out".
   */
  private async eligibleHouses(): Promise<
    Array<{ id: string; name: string }> | null
  > {
    const { data, error } = await this.databaseService.supabase
      .from("restaurants")
      .select("id, name, latitude, longitude")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      this.logger.warn(
        `Weather prefetch could not read the restaurant register: ${error.message}`,
      );
      return null;
    }

    return (data ?? []).map((r) => ({
      id: r.id as string,
      name: (r.name as string) || (r.id as string),
    }));
  }
}
