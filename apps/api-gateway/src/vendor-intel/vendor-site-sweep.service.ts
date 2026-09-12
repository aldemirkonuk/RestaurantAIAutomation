/**
 * The scheduled vendor-site sweep — the I/O shell.
 *
 * WHAT THIS IS, AND WHOSE DECISION IT IS
 * --------------------------------------
 * ADR 0117 §"Explicitly NOT decided here" left one question open: whether to
 * run the existing page extractor against the vendors that have a website.
 * The founder answered it on 2026-09-04: **"Run it, labelled tier 4, never
 * beside a quote."** This service is the "run it". The "labelled tier 4" is
 * `vendor-site-sighting.ts`. The "never beside a quote" is `comparisonClassOf`
 * in `price-below-average.ts`.
 *
 * IT IS OFF BY DEFAULT, AND THE REASON IS IN `isSweepArmed`
 * ---------------------------------------------------------
 * `VENDOR_SITE_SWEEP_ENABLED` is unset everywhere until someone sets it. See
 * `vendor-site-sweep.ts` for why a job that makes outbound requests in the
 * house's name, spends model tokens per page, and writes rows four readers act
 * on does not switch itself on by being deployed.
 *
 * ONE VENDOR'S FAILURE NEVER ENDS THE SWEEP
 * -----------------------------------------
 * Every vendor runs inside its own try/catch and its own status row. An
 * expired certificate, a WAF, a 500, a model timeout — each is recorded
 * against that vendor and the loop continues. This is not defensive polish: 23
 * active vendors have a website (`price-sources.md`, measured 2026-09-04) and
 * a sweep that stops at the first bad certificate would read one of them.
 *
 * WHAT SILENCE MEANS IS ALWAYS STATED
 * -----------------------------------
 * The standing fault in this codebase is a system reporting ABSENCE as HEALTH.
 * A vendor with no rows could mean the sweep is off, the vendor has no site,
 * robots forbids the page, the fetch failed, the page had no prices, or every
 * price on it was refused for missing a unit. Those are six different facts and
 * `status()` returns which one it is, per vendor, as a value and a sentence.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";

import { DatabaseService } from "../database/database.service";
import {
  ExtractionRunResult,
  ScrapeRefusalCounts,
  VendorPageExtractorService,
  emptyRefusalCounts,
} from "./vendor-page-extractor.service";
import {
  DEFAULT_HOST_INTERVAL_SECONDS,
  SILENCE_SENTENCE,
  SWEEP_ENABLED_FLAG,
  VendorSilenceReason,
  hostIntervalMs,
  hostOf,
  isSweepArmed,
  waitMsFor,
} from "./vendor-site-sweep";

/**
 * 04:20 daily. Off-peak for a US-centred estate, and deliberately not on the
 * hour: the gateway already runs jobs at :00 (`low-stock-alerts.service.ts`)
 * and a shared minute is how a scheduler brownout starts.
 */
export const SWEEP_CRON = "20 4 * * *";
export const SWEEP_JOB_NAME = "vendor-site-sweep";

/** What one vendor's last sweep did. Held in memory; see `status()`. */
export interface VendorSweepStatus {
  providerId: string;
  vendorName: string | null;
  restaurantId: string;
  website: string | null;
  /** null when this vendor has never been attempted in this process. */
  lastFetchAt: string | null;
  httpStatus: number | null;
  rowsWritten: number;
  flaggedOutliers: number;
  refusals: ScrapeRefusalCounts;
  /** Present whenever the vendor produced no sighting. Never absent silently. */
  silence: { reason: VendorSilenceReason; sentence: string } | null;
  /** The verbatim skip/failure text, when there was one. */
  detail: string | null;
  crawlDelaySeconds: number | null;
  pageStatedDate: string | null;
  /** True when `observed_at` is our fetch clock standing in for a page date. */
  undated: boolean | null;
}

export interface SweepRunSummary {
  armed: boolean;
  startedAt: string;
  finishedAt: string;
  restaurantsSwept: number;
  vendorsConsidered: number;
  vendorsFetched: number;
  rowsWritten: number;
  flaggedOutliers: number;
  refusals: ScrapeRefusalCounts;
  vendors: VendorSweepStatus[];
  /** Why nothing happened, when nothing happened. */
  note: string | null;
}

@Injectable()
export class VendorSiteSweepService {
  private readonly logger = new Logger(VendorSiteSweepService.name);

  /** host → epoch ms of the last request we made to it. The rate limiter. */
  private readonly lastRequestAt = new Map<string, number>();

  /**
   * host → the `Crawl-delay` that host asked for, learned from its robots.txt
   * on the previous visit.
   *
   * Stated honestly: the FIRST visit to a host in a process is paced at our own
   * interval, because the delay is only known once robots.txt has been read and
   * reading it is itself the first request. Every visit after that honours the
   * host's own number when it is larger. The alternative — a separate robots
   * probe before the pacing decision — costs one extra request to every host to
   * learn a number most of them do not publish.
   */
  private readonly hostCrawlDelay = new Map<string, number>();

  /** providerId → the last thing that happened to it. */
  private readonly statuses = new Map<string, VendorSweepStatus>();

  private lastRun: SweepRunSummary | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
    private readonly extractor: VendorPageExtractorService,
  ) {}

  armed(): boolean {
    return isSweepArmed(this.config.get<string>(SWEEP_ENABLED_FLAG));
  }

  private configuredIntervalSeconds(): number {
    const raw = this.config.get<string>("VENDOR_SITE_SWEEP_INTERVAL_SECONDS");
    const n = raw === undefined || raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_HOST_INTERVAL_SECONDS;
  }

  /** Overridable in tests so the rate limit can be proven without waiting. */
  protected now(): number {
    return Date.now();
  }
  protected sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((r) => setTimeout(r, ms));
  }

  @Cron(SWEEP_CRON, { name: SWEEP_JOB_NAME })
  async scheduled(): Promise<void> {
    if (!this.armed()) {
      // Logged at debug, not warn. A disarmed job is the intended state, and a
      // nightly warning trains people to ignore warnings.
      this.logger.debug(
        `${SWEEP_JOB_NAME} skipped: ${SWEEP_ENABLED_FLAG} is not set.`,
      );
      return;
    }
    try {
      await this.sweep({});
    } catch (err: any) {
      this.logger.error(
        `${SWEEP_JOB_NAME} failed: ${err?.message ?? "unknown"}`,
      );
    }
  }

  /**
   * Sweep every active provider with a website, per restaurant.
   *
   * PER RESTAURANT, not globally. `providers` is tenant-scoped
   * (`providers.restaurant_id`, `20260805000000_baseline_from_production.sql:4882`)
   * and a sighting is filed to the house it was read for, never with a null
   * `restaurant_id` — `belowTrailingAverage` reads
   * `restaurant_id.is.null OR restaurant_id.eq.<tenant>`
   * (`vendor-comparison.service.ts:341`), so one tenant-less row is read by
   * every house on the platform. ADR 0117 counted that as reason 5 for
   * refusing the Iowa load; it applies to a scrape identically.
   */
  async sweep(opts: {
    restaurantId?: string | null;
    limitPerRestaurant?: number;
    dryRun?: boolean;
  }): Promise<SweepRunSummary> {
    const startedAt = new Date().toISOString();
    const armed = this.armed();
    const refusals = emptyRefusalCounts();
    const vendors: VendorSweepStatus[] = [];

    const done = (note: string | null): SweepRunSummary => {
      const summary: SweepRunSummary = {
        armed,
        startedAt,
        finishedAt: new Date().toISOString(),
        restaurantsSwept: 0,
        vendorsConsidered: vendors.length,
        vendorsFetched: vendors.filter((v) => v.lastFetchAt !== null).length,
        rowsWritten: vendors.reduce((a, v) => a + v.rowsWritten, 0),
        flaggedOutliers: vendors.reduce((a, v) => a + v.flaggedOutliers, 0),
        refusals,
        vendors,
        note,
      };
      this.lastRun = summary;
      return summary;
    };

    if (!armed) {
      // Not an error and not a success. It is a stated state, and the caller
      // gets the sentence rather than an empty result it has to interpret.
      return done(SILENCE_SENTENCE.disarmed);
    }
    if (this.running) {
      return done(
        "A sweep is already running in this process; this call did nothing rather than doubling the request rate against every host.",
      );
    }
    this.running = true;

    try {
      const rows = await this.loadProviders(
        opts.restaurantId ?? null,
        opts.limitPerRestaurant ?? 50,
      );
      const restaurants = new Set(rows.map((r) => r.restaurant_id));

      for (const provider of rows) {
        const status = await this.sweepOne(provider, opts.dryRun ?? false);
        vendors.push(status);
        this.statuses.set(provider.id, status);
        for (const k of Object.keys(
          refusals,
        ) as (keyof ScrapeRefusalCounts)[]) {
          refusals[k] += status.refusals[k];
        }
      }

      const summary = done(null);
      summary.restaurantsSwept = restaurants.size;
      this.lastRun = summary;
      return summary;
    } finally {
      this.running = false;
    }
  }

  /**
   * One vendor, start to finish, and never throwing.
   *
   * The whole body is wrapped: a thrown error here would end the loop over the
   * other 22 vendors, and the thing that throws is out of our control (TLS,
   * DNS, a model timeout, a malformed URL).
   */
  private async sweepOne(
    provider: {
      id: string;
      name: string | null;
      website: string | null;
      restaurant_id: string;
    },
    dryRun: boolean,
  ): Promise<VendorSweepStatus> {
    const base: VendorSweepStatus = {
      providerId: provider.id,
      vendorName: provider.name,
      restaurantId: provider.restaurant_id,
      website: provider.website,
      lastFetchAt: null,
      httpStatus: null,
      rowsWritten: 0,
      flaggedOutliers: 0,
      refusals: emptyRefusalCounts(),
      silence: null,
      detail: null,
      crawlDelaySeconds: null,
      pageStatedDate: null,
      undated: null,
    };

    const host = hostOf(provider.website);
    if (!host) {
      return {
        ...base,
        silence: {
          reason: "no_website",
          sentence: SILENCE_SENTENCE.no_website,
        },
        detail: provider.website
          ? `The recorded website (${provider.website}) is not a URL this fetcher can parse.`
          : null,
      };
    }

    // The rate limit, honoured BEFORE the request rather than after it, so the
    // very first request to a host in a run is not exempt from a delay a
    // previous vendor on the same host already earned.
    await this.pace(host, this.hostCrawlDelay.get(host) ?? null);

    let result: ExtractionRunResult;
    try {
      result = await this.extractor.extractFromUrl({
        url: provider.website as string,
        providerId: provider.id,
        vendorName: provider.name,
        restaurantId: provider.restaurant_id,
        dryRun,
      });
    } catch (err: any) {
      // One vendor's failure is that vendor's row, never the sweep's end.
      this.logger.warn(
        `Vendor ${provider.name ?? provider.id} threw during the sweep: ${err?.message ?? "unknown"}`,
      );
      this.lastRequestAt.set(host, this.now());
      return {
        ...base,
        silence: {
          reason: "fetch_failed",
          sentence: SILENCE_SENTENCE.fetch_failed,
        },
        detail: String(err?.message ?? err),
      };
    }

    this.lastRequestAt.set(host, this.now());
    if (typeof result.crawlDelaySeconds === "number") {
      this.hostCrawlDelay.set(host, result.crawlDelaySeconds);
    }

    const refusalTotal = Object.values(result.refusals).reduce(
      (a, b) => a + b,
      0,
    );
    let silence: VendorSweepStatus["silence"] = null;
    if (result.skippedReason === "Disallowed by robots.txt") {
      silence = {
        reason: "robots_forbids",
        sentence: SILENCE_SENTENCE.robots_forbids,
      };
    } else if (!result.fetched) {
      silence = {
        reason: "fetch_failed",
        sentence: SILENCE_SENTENCE.fetch_failed,
      };
    } else if (result.observationsWritten === 0 && refusalTotal > 0) {
      silence = {
        reason: "all_refused",
        sentence: SILENCE_SENTENCE.all_refused,
      };
    } else if (result.observationsWritten === 0) {
      silence = {
        reason: "nothing_priced",
        sentence: SILENCE_SENTENCE.nothing_priced,
      };
    }

    return {
      ...base,
      lastFetchAt: result.fetched ? result.fetchedAt : null,
      httpStatus: result.httpStatus,
      rowsWritten: result.observationsWritten,
      flaggedOutliers: result.flaggedOutliers,
      refusals: result.refusals,
      silence,
      detail: result.skippedReason ?? (result.warnings.join("; ") || null),
      crawlDelaySeconds: result.crawlDelaySeconds,
      pageStatedDate: result.pageStatedDate,
      undated: result.fetched ? result.pageStatedDate === null : null,
    };
  }

  /** Wait out this host's interval. Pure arithmetic in `waitMsFor`. */
  private async pace(
    host: string,
    crawlDelaySeconds: number | null,
  ): Promise<void> {
    const intervalMs = hostIntervalMs({
      configuredSeconds: this.configuredIntervalSeconds(),
      crawlDelaySeconds,
    });
    const wait = waitMsFor({
      lastRequestAtMs: this.lastRequestAt.get(host) ?? null,
      nowMs: this.now(),
      intervalMs,
    });
    if (wait > 0) {
      this.logger.debug(`Pausing ${wait}ms before the next request to ${host}`);
      await this.sleep(wait);
    }
  }

  private async loadProviders(
    restaurantId: string | null,
    limitPerRestaurant: number,
  ): Promise<
    Array<{
      id: string;
      name: string | null;
      website: string | null;
      restaurant_id: string;
    }>
  > {
    let query = this.database.supabase
      .from("providers")
      .select("id, name, website, restaurant_id")
      .eq("is_active", true)
      .is("deleted_at", null)
      .not("website", "is", null)
      .not("restaurant_id", "is", null);
    if (restaurantId) query = query.eq("restaurant_id", restaurantId);

    const { data, error } = await query.limit(
      Math.max(1, limitPerRestaurant) * (restaurantId ? 1 : 50),
    );
    if (error) {
      // THROWN, not swallowed to an empty list. "No vendors have a website"
      // and "the provider table could not be read" are different facts and
      // must not both render as a sweep that did nothing.
      throw new Error(
        `Could not read providers for the sweep: ${error.message}`,
      );
    }
    return (data ?? []) as any[];
  }

  /**
   * What the sweep has done, per vendor — including the vendors it has NOT
   * done anything to, and why.
   *
   * The union matters. Returning only the vendors with a status row would make
   * a never-attempted vendor invisible, which is the absence-reported-as-health
   * fault: the reader would see three healthy vendors and no sign of the twenty
   * that were never read.
   */
  async status(restaurantId: string): Promise<{
    armed: boolean;
    flag: string;
    cron: string;
    hostIntervalSeconds: number;
    /** Null until a sweep has run in this process. Restarts clear it. */
    lastRun: SweepRunSummary | null;
    inMemoryOnly: true;
    vendors: VendorSweepStatus[];
  }> {
    const armed = this.armed();
    const providers = await this.loadProviders(restaurantId, 200);
    const vendors = providers.map((p) => {
      const seen = this.statuses.get(p.id);
      if (seen && seen.restaurantId === restaurantId) return seen;
      return {
        providerId: p.id,
        vendorName: p.name,
        restaurantId: p.restaurant_id,
        website: p.website,
        lastFetchAt: null,
        httpStatus: null,
        rowsWritten: 0,
        flaggedOutliers: 0,
        refusals: emptyRefusalCounts(),
        silence: armed
          ? {
              reason: "not_yet_swept" as VendorSilenceReason,
              sentence: SILENCE_SENTENCE.not_yet_swept,
            }
          : {
              reason: "disarmed" as VendorSilenceReason,
              sentence: SILENCE_SENTENCE.disarmed,
            },
        detail: null,
        crawlDelaySeconds: null,
        pageStatedDate: null,
        undated: null,
      } satisfies VendorSweepStatus;
    });

    return {
      armed,
      flag: SWEEP_ENABLED_FLAG,
      cron: SWEEP_CRON,
      hostIntervalSeconds:
        hostIntervalMs({
          configuredSeconds: this.configuredIntervalSeconds(),
          crawlDelaySeconds: null,
        }) / 1000,
      lastRun: this.lastRun,
      // Stated, not implied. This history lives in this process only: a deploy
      // or a restart empties it, and a reader must not mistake a fresh process
      // for a sweep that never ran.
      inMemoryOnly: true,
      vendors,
    };
  }
}
