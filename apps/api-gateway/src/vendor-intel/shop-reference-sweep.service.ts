/**
 * The merchant-shop sweep — the I/O shell.
 *
 * WHOSE DECISION, AND WHAT CHANGED
 * --------------------------------
 * ADR 0117 Q9 recorded that the vendor sweep is pointed at the wrong
 * population: it reads `providers`, and none of the 23 vendors with a website
 * publishes a price. The founder answered on 2026-09-05: **"Point it at
 * merchant shops, as their own class."** This service is the instrument. It
 * does NOT replace `VendorSiteSweepService` — that one still reads a house's
 * own vendors and writes class-A-adjacent tier-4 sightings to
 * `vendor_price_observations`. This one reads public retail shops and writes
 * class-D postings to `price_index_postings`, the register ADR 0117 names for
 * D and E. Two registers, two readers, and no code path from a shelf price to
 * `belowTrailingAverage`.
 *
 * OFF BY DEFAULT, TWICE
 * ---------------------
 * `PRICE_REFERENCE_SHOP_SWEEP_ENABLED` says this job may run at all;
 * `PRICE_REFERENCE_SHOPS_ARMED` names which shops it may touch. Both are
 * allow-lists, so a typo leaves it silent rather than live. Nothing in this
 * file has ever run against a shop in production, and this session ran no live
 * sweep: the measurements below and in ADR 0117 come from recorded fixtures.
 *
 * POLITENESS IS THE HOST'S RULE, NOT OURS
 * ---------------------------------------
 *   robots.txt   fetched first, per host, with the identifying agent; an
 *                explicit Disallow is honoured and nothing is fetched.
 *   Crawl-delay  the host's own number replaces our floor whenever it is larger
 *                (`hostIntervalMs`, imported from the vendor sweep).
 *   Visit-time   honoured. www.bbr.com states `Visit-time: 0200-0700`; outside
 *                it the shop is skipped with the reason, not fetched anyway.
 *
 * WHAT IS DELIBERATELY NOT BUILT: CATALOGUE ENUMERATION.
 * A run reads the pages it is given. It does not walk a shop's sitemap, and
 * the reason is not politeness but honesty: the index register carries the
 * product identity AS POSTED and has no join to a house's own wines, so a
 * thousand enumerated rows would be a thousand prices nobody asked about, and
 * the cost of getting them is a thousand requests to a shop that gains nothing
 * from us. The permitted enumeration routes ARE recorded in the registry (Hi
 * Time's `/xmlsitemap.php?type=products` returned 1.15 MB of product URLs on
 * 2026-09-05) so that whoever answers the identity question does not have to
 * find them again.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { DatabaseService } from "../database/database.service";
import {
  SsrfBlockedError,
  assertPublicHttpTarget,
  safeFetch,
} from "../common/net/ssrf-guard";
import { isPathAllowed, parseCrawlDelay } from "./vendor-page-extraction";
import { readPageSizeEvidence } from "./bottle-size";
import { PostingSighting, contentHash } from "../price-index/price-index.types";
import { IssuedAtBasis } from "../price-index/staleness";
import {
  SHOPS,
  SHOP_ARMED_KEYS_FLAG,
  SHOP_SWEEP_ENABLED_FLAG,
  ShopEntry,
  armedShopKeys,
} from "./price-reference-shops";
import {
  OfferSource,
  ShopRefusalReason,
  decideShopPosting,
  emptyShopRefusalCounts,
} from "./shop-reference-posting";
import {
  SHOP_SILENCE_SENTENCE,
  ShopSilenceReason,
  isShopSweepArmed,
  parseVisitTime,
  visitWindowOf,
  withinVisitWindow,
} from "./shop-reference-sweep";
import { hostIntervalMs, hostOf, waitMsFor } from "./vendor-site-sweep";

/** Identifies us in a shop's request log so it can block us deliberately. */
const USER_AGENT =
  "WineOpsBot/1.0 (+https://wineops.ai/bot; vendor price intelligence)";

/** The most pages one run will read from one shop, whatever it is asked for. */
export const MAX_PAGES_PER_SHOP = 25;

export interface ShopSweepStatusRow {
  shopKey: string;
  shopName: string;
  jurisdiction: string;
  armed: boolean;
  /** null when this shop has never been attempted in this process. */
  lastFetchAt: string | null;
  pagesRead: number;
  rowsWritten: number;
  refusals: Record<ShopRefusalReason, number>;
  /** Where each admitted price was read. Zeroed, never absent. */
  offerSources: Record<string, number>;
  silence: { reason: ShopSilenceReason; sentence: string } | null;
  detail: string | null;
  crawlDelaySeconds: number | null;
  visitTimeUtc: string | null;
}

export interface ShopSweepRunSummary {
  armed: boolean;
  startedAt: string;
  finishedAt: string;
  shopsConsidered: number;
  shopsFetched: number;
  pagesRead: number;
  rowsWritten: number;
  refusals: Record<ShopRefusalReason, number>;
  shops: ShopSweepStatusRow[];
  /** Why nothing happened, when nothing happened. */
  note: string | null;
}

@Injectable()
export class ShopReferenceSweepService {
  private readonly logger = new Logger(ShopReferenceSweepService.name);

  /** host -> epoch ms of the last request we made to it. The rate limiter. */
  private readonly lastRequestAt = new Map<string, number>();
  /** host -> the Crawl-delay it asked for, learned on the previous visit. */
  private readonly hostCrawlDelay = new Map<string, number>();
  private readonly statuses = new Map<string, ShopSweepStatusRow>();
  private lastRun: ShopSweepRunSummary | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  armed(): boolean {
    return isShopSweepArmed(this.config.get<string>(SHOP_SWEEP_ENABLED_FLAG));
  }

  private armedKeys() {
    return armedShopKeys(this.config.get<string>(SHOP_ARMED_KEYS_FLAG));
  }

  private configuredIntervalSeconds(): number {
    const raw = this.config.get<string>("PRICE_REFERENCE_SHOP_INTERVAL_SECONDS");
    const n = raw === undefined || raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : 10;
  }

  /** Overridable in tests so the pacing can be proven without waiting. */
  protected now(): number {
    return Date.now();
  }
  protected sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Read the named pages of the named shops and file what survives as class D.
   *
   * `pages` maps a shop key to the URLs to read. A shop armed with no pages is
   * reported with `no_urls_given` rather than skipped in silence: "we were
   * given nothing to read" and "we read it and found nothing" are different
   * facts and only one of them is about the shop.
   */
  async sweep(opts: {
    pages: Record<string, string[]>;
    dryRun?: boolean;
  }): Promise<ShopSweepRunSummary> {
    const startedAt = new Date().toISOString();
    const armed = this.armed();
    const refusals = emptyShopRefusalCounts();
    const shops: ShopSweepStatusRow[] = [];

    const done = (note: string | null): ShopSweepRunSummary => {
      const summary: ShopSweepRunSummary = {
        armed,
        startedAt,
        finishedAt: new Date().toISOString(),
        shopsConsidered: shops.length,
        shopsFetched: shops.filter((s) => s.lastFetchAt !== null).length,
        pagesRead: shops.reduce((a, s) => a + s.pagesRead, 0),
        rowsWritten: shops.reduce((a, s) => a + s.rowsWritten, 0),
        refusals,
        shops,
        note,
      };
      this.lastRun = summary;
      return summary;
    };

    if (!armed) return done(SHOP_SILENCE_SENTENCE.disarmed);
    if (this.running) {
      return done(
        "A shop sweep is already running in this process; this call did nothing rather than doubling the request rate against every host.",
      );
    }
    this.running = true;
    try {
      const { armed: keys, unknown, refused } = this.armedKeys();
      for (const key of keys) {
        const shop = SHOPS[key];
        const urls = (opts.pages[key] ?? []).slice(0, MAX_PAGES_PER_SHOP);
        const row = await this.sweepShop(shop, urls, opts.dryRun ?? false);
        shops.push(row);
        this.statuses.set(key, row);
        for (const k of Object.keys(refusals) as ShopRefusalReason[]) {
          refusals[k] += row.refusals[k];
        }
      }
      const notes: string[] = [];
      if (unknown.length) {
        notes.push(
          `${SHOP_ARMED_KEYS_FLAG} names ${unknown.length} shop key(s) this registry does not have: ${unknown.join(", ")}.`,
        );
      }
      for (const r of refused) {
        notes.push(`${r.key} is registered and unarmed (${r.reason}): ${r.detail}`);
      }
      return done(notes.length ? notes.join(" ") : null);
    } finally {
      this.running = false;
    }
  }

  /** One shop, start to finish, and never throwing. */
  private async sweepShop(
    shop: ShopEntry,
    urls: string[],
    dryRun: boolean,
  ): Promise<ShopSweepStatusRow> {
    const base: ShopSweepStatusRow = {
      shopKey: shop.key,
      shopName: shop.shopName,
      jurisdiction: shop.jurisdiction,
      armed: true,
      lastFetchAt: null,
      pagesRead: 0,
      rowsWritten: 0,
      refusals: emptyShopRefusalCounts(),
      offerSources: {},
      silence: null,
      detail: null,
      crawlDelaySeconds: shop.robots.crawlDelaySeconds,
      visitTimeUtc: shop.robots.visitTimeUtc,
    };
    if (urls.length === 0) {
      return {
        ...base,
        silence: {
          reason: "no_urls_given",
          sentence: SHOP_SILENCE_SENTENCE.no_urls_given,
        },
      };
    }

    // The registry's recorded window is the first gate, so a host outside its
    // stated hours costs no request at all — not even a robots probe.
    const registryWindow = visitWindowOf(shop.robots.visitTimeUtc);
    if (!withinVisitWindow(registryWindow, new Date(this.now()))) {
      return {
        ...base,
        silence: {
          reason: "outside_visit_window",
          sentence: SHOP_SILENCE_SENTENCE.outside_visit_window,
        },
        detail: `${shop.shopName} asks to be read between ${shop.robots.visitTimeUtc} UTC.`,
      };
    }

    const rows: Record<string, unknown>[] = [];
    let lastFetchAt: string | null = null;
    let detail: string | null = null;
    let crawlDelaySeconds = shop.robots.crawlDelaySeconds;
    let anyFetched = false;

    for (const url of urls) {
      const host = hostOf(url);
      if (!host) {
        base.refusals.no_offer += 1;
        detail = `${url} is not a URL this fetcher can parse.`;
        continue;
      }
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        base.refusals.no_offer += 1;
        continue;
      }
      try {
        await assertPublicHttpTarget(target);
      } catch (err: any) {
        if (err instanceof SsrfBlockedError) {
          detail = err.reason;
          continue;
        }
        throw err;
      }

      await this.pace(host, this.hostCrawlDelay.get(host) ?? crawlDelaySeconds);
      const robots = await this.readRobots(target);
      this.lastRequestAt.set(host, this.now());
      if (robots.crawlDelaySeconds !== null) {
        this.hostCrawlDelay.set(host, robots.crawlDelaySeconds);
        crawlDelaySeconds = robots.crawlDelaySeconds;
      }
      // The LIVE window wins over the recorded one: the registry's note is a
      // measurement from a day that has passed, and the host may have changed
      // its mind since.
      if (!withinVisitWindow(robots.visitWindow, new Date(this.now()))) {
        return {
          ...base,
          crawlDelaySeconds,
          lastFetchAt,
          silence: {
            reason: "outside_visit_window",
            sentence: SHOP_SILENCE_SENTENCE.outside_visit_window,
          },
          detail: `Its robots.txt states ${robots.visitRaw ?? "a visit window"} and now is outside it.`,
        };
      }
      if (!robots.allowed) {
        return {
          ...base,
          crawlDelaySeconds,
          lastFetchAt,
          silence: {
            reason: "robots_forbids",
            sentence: SHOP_SILENCE_SENTENCE.robots_forbids,
          },
          detail: `robots.txt disallows ${target.pathname} for our agent.`,
        };
      }

      await this.pace(host, crawlDelaySeconds);
      let html: string;
      let fetchedAt: string;
      try {
        const res = await safeFetch(target.toString(), {
          headers: { "user-agent": USER_AGENT, accept: "text/html" },
          signal: AbortSignal.timeout(20_000),
        });
        this.lastRequestAt.set(host, this.now());
        fetchedAt = new Date().toISOString();
        if (!res.ok) {
          detail = `HTTP ${res.status} on ${url}`;
          continue;
        }
        html = await res.text();
        anyFetched = true;
        lastFetchAt = fetchedAt;
      } catch (err: any) {
        this.lastRequestAt.set(host, this.now());
        detail = `Fetch failed for ${url}: ${err?.message ?? "unknown"}`;
        continue;
      }

      base.pagesRead += 1;
      const decision = decideShopPosting({
        shop,
        url,
        html,
        sizeEvidence: readPageSizeEvidence(html),
        fetchedAt,
      });
      if (!decision.write) {
        base.refusals[decision.reason] += 1;
        this.logger.debug(decision.message);
        continue;
      }
      const src: OfferSource = decision.offerSource;
      base.offerSources[src] = (base.offerSources[src] ?? 0) + 1;
      rows.push(toRow(decision.sighting, fetchedAt, decision.issuedAtBasis));
    }

    let written = 0;
    if (rows.length > 0 && !dryRun) {
      written = await this.writePostings(rows);
    }

    const refusalTotal = Object.values(base.refusals).reduce((a, b) => a + b, 0);
    let silence: ShopSweepStatusRow["silence"] = null;
    if (!anyFetched) {
      silence = {
        reason: "fetch_failed",
        sentence: SHOP_SILENCE_SENTENCE.fetch_failed,
      };
    } else if (rows.length === 0 && refusalTotal > 0) {
      silence = {
        reason: "all_refused",
        sentence: SHOP_SILENCE_SENTENCE.all_refused,
      };
    }

    return {
      ...base,
      lastFetchAt,
      rowsWritten: written,
      crawlDelaySeconds,
      silence,
      detail,
    };
  }

  /**
   * robots.txt for one host.
   *
   * Fails OPEN on a missing or unreachable file (the standard reading) and
   * CLOSED on an explicit Disallow — the same rule the vendor extractor
   * applies, deliberately identical so the two crawlers cannot disagree about
   * what a shop permitted.
   */
  private async readRobots(target: URL): Promise<{
    allowed: boolean;
    crawlDelaySeconds: number | null;
    visitWindow: { startMinute: number; endMinute: number } | null;
    visitRaw: string | null;
  }> {
    try {
      const res = await safeFetch(`${target.origin}/robots.txt`, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return { allowed: true, crawlDelaySeconds: null, visitWindow: null, visitRaw: null };
      }
      const body = await res.text();
      const visit = parseVisitTime(body);
      return {
        allowed: isPathAllowed(body, target.pathname, "WineOpsBot"),
        crawlDelaySeconds: parseCrawlDelay(body, "WineOpsBot"),
        visitWindow: visit ? { startMinute: visit.startMinute, endMinute: visit.endMinute } : null,
        visitRaw: visit?.raw ?? null,
      };
    } catch {
      return { allowed: true, crawlDelaySeconds: null, visitWindow: null, visitRaw: null };
    }
  }

  private async pace(host: string, crawlDelaySeconds: number | null): Promise<void> {
    const intervalMs = hostIntervalMs({
      configuredSeconds: this.configuredIntervalSeconds(),
      crawlDelaySeconds,
    });
    const wait = waitMsFor({
      lastRequestAtMs: this.lastRequestAt.get(host) ?? null,
      nowMs: this.now(),
      intervalMs,
    });
    if (wait > 0) await this.sleep(wait);
  }

  /**
   * Write the postings, deduping on the register's own uniqueness.
   *
   * A failed write is NOT "nothing was found": the error is logged and zero is
   * returned with the reason on the run, never swallowed into a silent success.
   */
  private async writePostings(rows: Record<string, unknown>[]): Promise<number> {
    const { data, error } = await this.database.supabase
      .from("price_index_postings")
      .upsert(rows, {
        onConflict: "source_ref,content_hash",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      this.logger.error(
        `Failed to write ${rows.length} retail reference posting(s): ${error.message}`,
      );
      return 0;
    }
    return (data ?? []).length;
  }

  /**
   * What the sweep has done, per shop — including the shops it has NOT done
   * anything to, and why. The union is the point: returning only the shops
   * with a status row would make a never-read shop invisible, which is the
   * absence-reported-as-health fault.
   */
  status(): {
    armed: boolean;
    flag: string;
    keysFlag: string;
    register: "price_index_postings";
    sourceClass: "retail_reference";
    lastRun: ShopSweepRunSummary | null;
    inMemoryOnly: true;
    shops: ShopSweepStatusRow[];
  } {
    const armed = this.armed();
    const { armed: keys, refused, unknown } = this.armedKeys();
    const armedSet = new Set(keys);
    const shops = Object.values(SHOPS).map((shop) => {
      const seen = this.statuses.get(shop.key);
      if (seen) return seen;
      const reason: ShopSilenceReason = shop.unarmed
        ? "registered_unarmed"
        : !armed
          ? "disarmed"
          : armedSet.has(shop.key)
            ? "not_yet_swept"
            : "not_armed_for_this_shop";
      return {
        shopKey: shop.key,
        shopName: shop.shopName,
        jurisdiction: shop.jurisdiction,
        armed: armedSet.has(shop.key),
        lastFetchAt: null,
        pagesRead: 0,
        rowsWritten: 0,
        refusals: emptyShopRefusalCounts(),
        offerSources: {},
        silence: { reason, sentence: SHOP_SILENCE_SENTENCE[reason] },
        detail: shop.unarmed
          ? `${shop.unarmed.detail} (measured ${shop.unarmed.measuredOn})`
          : null,
        crawlDelaySeconds: shop.robots.crawlDelaySeconds,
        visitTimeUtc: shop.robots.visitTimeUtc,
      } satisfies ShopSweepStatusRow;
    });
    if (unknown.length) {
      this.logger.warn(
        `${SHOP_ARMED_KEYS_FLAG} names unknown shop key(s): ${unknown.join(", ")}`,
      );
    }
    void refused;
    return {
      armed,
      flag: SHOP_SWEEP_ENABLED_FLAG,
      keysFlag: SHOP_ARMED_KEYS_FLAG,
      register: "price_index_postings",
      sourceClass: "retail_reference",
      lastRun: this.lastRun,
      // Stated, not implied: this history lives in this process only.
      inMemoryOnly: true,
      shops,
    };
  }
}

/**
 * A `PostingSighting` as the register's columns.
 *
 * Every key is written explicitly — no conditional spread — so the capture
 * guard can read the shape and a column can never go missing because a value
 * happened to be undefined.
 */
export function toRow(
  s: PostingSighting,
  fetchedAt: string,
  issuedAtBasis: IssuedAtBasis,
): Record<string, unknown> {
  return {
    source_key: s.sourceKey,
    source_class: s.sourceClass,
    state: s.state,
    region: s.region,
    issuer: s.issuer,
    issued_at: s.issuedAt,
    // Whose clock the line above came from. Never omitted and never defaulted:
    // a NULL here would mean "written before a basis was recorded", which is a
    // claim about history, and this writer has no history to claim.
    issued_at_basis: issuedAtBasis,
    fetched_at: fetchedAt,
    price_basis: s.priceBasis,
    product_name: s.productName,
    brand: s.brand,
    producer: s.producer,
    package_desc: s.packageDesc,
    container_type: s.containerType,
    size_value: s.sizeValue,
    size_unit: s.sizeUnit,
    price: s.price,
    currency: s.currency,
    price_unit: s.priceUnit,
    pack: s.pack,
    container_charge: s.containerCharge,
    is_promotion: s.isPromotion,
    source_status: s.sourceStatus,
    attribution: s.attribution,
    source_url: s.sourceUrl,
    source_ref: s.sourceRef,
    content_hash: contentHash(s),
    external_ids: s.externalIds,
    raw: s.raw,
  };
}
