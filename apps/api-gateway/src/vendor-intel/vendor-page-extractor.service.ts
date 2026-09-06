import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { DatabaseService } from "../database/database.service";
import {
  ModelClientService,
  NfEventRef,
} from "../common/model-client/model-client.service";
import { NfVerdictService } from "../common/model-client/nf-verdict.service";
import { PARSE_YIELD_BASIS, parseYieldVerdict } from "./parse-yield-verdict";
import {
  ExtractedItem,
  htmlToText,
  isPathAllowed,
  normalizeExtraction,
  parseCrawlDelay,
} from "./vendor-page-extraction";
import {
  ScrapeRefusalReason,
  decideScrapeSighting,
  isOutlierAgainstPriors,
  readPageStatedDate,
} from "./vendor-site-sighting";
import {
  PageSizeEvidence,
  readBottleSize,
  readPageSizeEvidence,
} from "./bottle-size";
import { hashWineIdentity } from "./wine-identity";
import {
  SsrfBlockedError,
  assertPublicHttpTarget,
  safeFetch,
} from "../common/net/ssrf-guard";
// One enforcement point for the register's visibility rule (ADR 0117 addendum,
// 2026-09-05). The `.from()` keeps the table's name as a string literal so
// `check_read_columns_exist.py` still sees the columns this read names.
import {
  VENDOR_PRICE_OBSERVATIONS,
  scopePriceRegisterRead,
} from "../price-register/visibility";

/** Identifies us in request logs so a vendor can allow or block us deliberately. */
const USER_AGENT =
  "WineOpsBot/1.0 (+https://wineops.ai/bot; vendor price intelligence)";

const SYSTEM_PROMPT = `You read a wine vendor's web page and report the wines and prices you can SEE.

Return ONLY a JSON object: {"items": [...]}. Each item:
  name        (string, required) the product name as written
  producer    (string|null) winery/domaine if stated separately
  vintage     (number|null) 4-digit year ONLY if printed; null otherwise
  price       (number, required) the numeric price as printed
  currency    (string|null) 3-letter code if determinable
  packSize    (number|null) units per pack; 1 for a single bottle
  volumeMl    (number|null) bottle size in ml if stated
  inStock     (boolean|null)
  confidence  (number 0-1) how sure you are THIS ROW was read correctly

Rules:
- Report only what is on the page. Never infer a vintage, producer or volume
  that is not printed. null is always better than a guess.
- Do not convert currency, do not compute per-unit prices, do not judge whether
  a price is reasonable. Report the printed figure.
- If a price is a range or "from X", use X and lower confidence.
- If the page has no wine prices, return {"items": []}.`;

/** Refusal tallies, one key per reason. Zeroed, never absent — an absent key
 * and a zero count read identically to a caller, and only one of them means
 * "measured and none". */
export type ScrapeRefusalCounts = Record<ScrapeRefusalReason, number>;

export function emptyRefusalCounts(): ScrapeRefusalCounts {
  return {
    no_restaurant: 0,
    no_url: 0,
    no_product_name: 0,
    bad_price: 0,
    bad_pack: 0,
    no_bottle_volume: 0,
    volume_conflict: 0,
    unnormalisable: 0,
  };
}

export interface ExtractionRunResult {
  url: string;
  fetched: boolean;
  httpStatus: number | null;
  itemsFound: number;
  observationsWritten: number;
  /** Rows the PARSER rejected (`normalizeExtraction`) before any judgement. */
  rejected: number;
  /** Rows the SIGHTING judgement refused, by reason. ADR 0117's five legs. */
  refusals: ScrapeRefusalCounts;
  /** Rows written with `is_outlier` true. Written, never dropped. */
  flaggedOutliers: number;
  /**
   * Where each admitted row's bottle size was read, counted by source.
   * Zeroed, never absent: an absent key and a zero read identically and only
   * one of them means "measured and none".
   */
  volumeSources: Record<string, number>;
  /** When we fetched. Always stated, so `observed_at` can be read against it. */
  fetchedAt: string;
  /** The page's own stated date, or null — the `undated` flag's other half. */
  pageStatedDate: string | null;
  /** The delay this host's robots.txt asked for, if it asked for one. */
  crawlDelaySeconds: number | null;
  skippedReason?: string;
  warnings: string[];
}

/**
 * Fetches a vendor page and turns it into price observations.
 *
 * The judgement lives in ./vendor-page-extraction, which is pure and tested.
 * This class is the I/O shell: politeness, fetching, the model call, and the
 * write. It is deliberately thin — anything here that decided whether a number
 * was believable would be untestable without a network.
 */
@Injectable()
export class VendorPageExtractorService {
  private readonly logger = new Logger(VendorPageExtractorService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly modelClient: ModelClientService,
    private readonly nfVerdicts: NfVerdictService,
  ) {}

  private model(): string {
    return (
      this.configService.get<string>("ANTHROPIC_EXTRACTION_MODEL") ||
      "claude-haiku-4-5"
    );
  }

  /**
   * robots.txt check. Fails OPEN on a missing or unreachable robots.txt (the
   * standard reading: no robots file means no restrictions) but fails CLOSED
   * on an explicit Disallow. A vendor who bothered to write a rule gets it
   * honoured; a vendor with no opinion is not blocked by our caution.
   */
  private async readRobots(
    target: URL,
  ): Promise<{ allowed: boolean; crawlDelaySeconds: number | null }> {
    try {
      const robotsUrl = `${target.origin}/robots.txt`;
      // Guarded too, not just the page fetch below. This request is derived from
      // the same user-supplied host, so leaving it on bare `fetch` would keep a
      // blind SSRF open that merely returns less data (OD-54).
      const res = await safeFetch(robotsUrl, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { allowed: true, crawlDelaySeconds: null };
      const body = await res.text();
      return {
        allowed: isPathAllowed(body, target.pathname, "WineOpsBot"),
        crawlDelaySeconds: parseCrawlDelay(body, "WineOpsBot"),
      };
    } catch {
      return { allowed: true, crawlDelaySeconds: null };
    }
  }

  /**
   * Run one page end to end.
   *
   * Every early exit returns a populated result rather than throwing, because
   * this runs across the whole vendor_catalogue in a loop — one vendor with an
   * expired certificate must not end the sweep.
   */
  async extractFromUrl(params: {
    url: string;
    providerId?: string | null;
    vendorCatalogueId?: string | null;
    vendorName?: string | null;
    restaurantId?: string | null;
    dryRun?: boolean;
  }): Promise<ExtractionRunResult> {
    const { url, dryRun = false } = params;
    const result: ExtractionRunResult = {
      url,
      fetched: false,
      httpStatus: null,
      itemsFound: 0,
      observationsWritten: 0,
      rejected: 0,
      refusals: emptyRefusalCounts(),
      flaggedOutliers: 0,
      volumeSources: {},
      fetchedAt: new Date().toISOString(),
      pageStatedDate: null,
      crawlDelaySeconds: null,
      warnings: [],
    };

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      result.skippedReason = "Not a valid URL.";
      return result;
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      result.skippedReason = `Unsupported protocol ${target.protocol}`;
      return result;
    }

    // OD-54. robots.txt below is politeness, not a security control — it was the
    // only thing standing between a user-supplied URL and the cloud metadata
    // endpoint. Refused before the robots probe, so a blocked host costs no
    // outbound request at all.
    try {
      await assertPublicHttpTarget(target);
    } catch (err: any) {
      if (err instanceof SsrfBlockedError) {
        result.skippedReason = err.reason;
        this.logger.warn(`Refusing ${url} — ${err.reason}`);
        return result;
      }
      throw err;
    }

    const robots = await this.readRobots(target);
    result.crawlDelaySeconds = robots.crawlDelaySeconds;
    if (!robots.allowed) {
      result.skippedReason = "Disallowed by robots.txt";
      this.logger.log(`Skipping ${url} — robots.txt disallows it`);
      return result;
    }

    let html: string;
    try {
      // safeFetch re-validates every redirect hop. The pre-flight check above is
      // not enough on its own: a public URL that 302s to 169.254.169.254 defeats
      // it entirely, and that is the hole most SSRF fixes leave open.
      const res = await safeFetch(target.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        signal: AbortSignal.timeout(20_000),
      });
      result.fetchedAt = new Date().toISOString();
      result.httpStatus = res.status;
      if (!res.ok) {
        result.skippedReason = `HTTP ${res.status}`;
        return result;
      }
      html = await res.text();
      result.fetched = true;
    } catch (err: any) {
      result.skippedReason = `Fetch failed: ${err?.message ?? "unknown"}`;
      return result;
    }

    const text = htmlToText(html);
    if (text.length < 100) {
      result.skippedReason =
        "Page produced almost no text — likely a JS-rendered app this fetcher cannot see.";
      return result;
    }

    // content_hash is computed over the extracted TEXT, not the raw HTML: a
    // vendor's rotating banner or CSRF token changes the HTML on every request
    // while the catalogue is identical, and hashing the raw markup would make
    // every re-scrape look like new evidence.
    const contentHash = crypto.createHash("sha256").update(text).digest("hex");

    // The page's own claim about when its prices apply, if it makes one. Null
    // is the `undated` flag: see `readPageStatedDate` for why a bare date
    // elsewhere on the page is deliberately not picked up.
    result.pageStatedDate = readPageStatedDate(text);

    const apiKey = this.configService.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      result.skippedReason = "ANTHROPIC_API_KEY not configured";
      return result;
    }

    let rawText: string;
    // OD-59 / P3.0: this call grades itself. The ref carries the NF row id back
    // once the fire-and-forget emit lands, so the verdict below attaches to it
    // without the extraction ever waiting on the instrument.
    const eventRef = new NfEventRef();
    try {
      // P1 NF-A: model client owns transport (same 120s budget as before) and
      // emits the footprint row. HTTP errors throw as `Anthropic <status>: …`,
      // so skippedReason carries the same detail the old two-branch code did.
      const payload: any = await this.modelClient.call({
        body: {
          model: this.model(),
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        },
        timeoutMs: 120_000,
        nf: {
          subjectId: "VendorPageExtractor",
          taskType: "vendor_page_extraction",
          stimulus: "vendor_page",
          choice: "extracted_items",
          restaurantId: params.restaurantId ?? null,
          context: { url },
          eventRef,
        },
      });
      rawText =
        (payload.content || []).find((b: any) => b.type === "text")?.text ??
        "{}";
    } catch (err: any) {
      result.skippedReason = `Model call failed: ${err?.message ?? "unknown"}`;
      return result;
    }

    const extraction = normalizeExtraction(rawText);
    result.itemsFound = extraction.items.length;
    result.rejected = extraction.rejected.length;
    result.warnings = extraction.warnings;

    // The judgement already exists in `normalizeExtraction` — the >50%-rejected
    // warning has always said "treat this page's parser as broken". This only
    // carries it into the footprint, where until now a page that returned
    // unparseable text still recorded `success` because HTTP said 200.
    this.nfVerdicts.record(
      eventRef,
      PARSE_YIELD_BASIS,
      parseYieldVerdict(extraction),
    );

    for (const r of extraction.rejected.slice(0, 10)) {
      this.logger.debug(`Rejected row from ${url}: ${r.reason}`);
    }

    if (dryRun || extraction.items.length === 0) return result;

    const written = await this.writeObservations(extraction.items, {
      ...params,
      contentHash,
      httpStatus: result.httpStatus,
      fetchedAt: result.fetchedAt,
      pageStatedDate: result.pageStatedDate,
      // Read ONCE per page, off the markup rather than the model's text. See
      // `bottle-size.ts`: `htmlToText` drops the contents of <script>, so the
      // JSON-LD every serious merchant publishes has never reached the model.
      sizeEvidence: readPageSizeEvidence(html),
    });
    result.observationsWritten = written.written;
    result.refusals = written.refusals;
    result.flaggedOutliers = written.flaggedOutliers;
    result.volumeSources = written.volumeSources;
    for (const w of written.warnings) result.warnings.push(w);
    return result;
  }

  /**
   * Persist items as tier-4 `website_scrape` sightings.
   *
   * REWRITTEN 2026-09-04 on the founder's call ("run it, labelled tier 4,
   * never beside a quote"). What the old writer did wrong, measured against
   * ADR 0117 before it was changed:
   *
   *   * It defaulted nothing and refused nothing. `unit_volume_ml` went in as
   *     the model reported it — `null` on most pages — and `normalizeUnitPrice`
   *     skips the volume scaling entirely when it is absent
   *     (`vendor-price-consensus.ts:132`), so a 375ml bottle entered the ladder
   *     at half its true per-750ml price and topped it.
   *   * It wrote `observed_at` at the column's `DEFAULT now()`, with no record
   *     of whether the page had stated a date of its own. A price list last
   *     revised in 2024 arrived stamped today.
   *   * It wrote `is_outlier` at its `false` default — the exact gap
   *     `notifications.md` §13.25(b) names, and the one that matters most,
   *     because a scrape's parses are the dangerous ones.
   *   * `restaurant_id` was whatever the caller passed, i.e. `null` from
   *     `sweepCatalogue`, which publishes one house's reading into every other
   *     house's market box (`vendor-comparison.service.ts:341`).
   *
   * All four are now refusals or recorded facts, and every refusal is counted
   * by reason so a vendor whose page yields nothing says WHY rather than
   * looking like a vendor with no prices.
   *
   * Still an upsert on `(source_ref, content_hash)`
   * (`…vendor_price_observations.sql:141`): a re-scrape of an unchanged page is
   * a no-op rather than a fresh observation. Without that, a nightly job would
   * "confirm" a stale price 30 times a month and the consensus would read
   * repetition as corroboration.
   */
  private async writeObservations(
    items: ExtractedItem[],
    ctx: {
      url: string;
      providerId?: string | null;
      vendorCatalogueId?: string | null;
      vendorName?: string | null;
      restaurantId?: string | null;
      contentHash: string;
      httpStatus: number | null;
      fetchedAt: string;
      pageStatedDate: string | null;
      /** What the PAGE says about sizes, parsed once. See `bottle-size.ts`. */
      sizeEvidence?: PageSizeEvidence | null;
    },
  ): Promise<{
    written: number;
    refusals: ScrapeRefusalCounts;
    flaggedOutliers: number;
    volumeSources: Record<string, number>;
    warnings: string[];
  }> {
    const refusals = emptyRefusalCounts();
    const warnings: string[] = [];
    const volumeSources: Record<string, number> = {};

    const candidates = items.map((item) => ({
      item,
      signatureHash: hashWineIdentity({
        producer: item.producer,
        name: item.name,
        vintage: item.vintage,
      }),
    }));

    // Priors for the outlier test, read ONCE for the whole page rather than per
    // row. `isOutlierAgainstPriors` is imported from the own-paper writer, not
    // reimplemented: the two writers must be the same MAD test at the same
    // five-value floor or they will disagree about the same row.
    const priors = await this.loadPriorUnitPrices(
      candidates.map((c) => c.signatureHash).filter((h): h is string => !!h),
      ctx.restaurantId ?? null,
    );

    const rows: Record<string, unknown>[] = [];
    let flaggedOutliers = 0;

    for (const { item, signatureHash } of candidates) {
      // THE SIZE READ. The model is asked for `volumeMl` and reports it when
      // the page's TEXT prints one; this read looks at the markup as well, in
      // the precedence `bottle-size.ts` documents, and refuses on a
      // contradiction rather than picking. The model's own answer is kept as
      // the fallback for the manual `POST /vendor-intel/scrape` path, which
      // has no markup of its own, and it is used only when the markup read
      // found nothing at all — never to overrule the page.
      const reading = ctx.sizeEvidence
        ? readBottleSize(ctx.sizeEvidence, {
            productName: item.name,
            price: item.price,
          })
        : null;
      const conflict =
        reading && !reading.read && reading.reason === "volume_conflict"
          ? { message: reading.message, candidates: reading.candidates }
          : null;
      const readMl = reading && reading.read ? reading.ml : null;
      // A pack the size statement itself names ("6 x 75cl") corrects the
      // model's default of 1 — `validateItem` assigns 1 whenever the model
      // reported nothing, so a 1 carries no information. It never OVERRULES a
      // pack the model actually read; that disagreement is recorded instead.
      const packFromPage =
        reading && reading.read ? reading.packFromStatement : null;
      const packSize =
        packFromPage !== null && item.packSize === 1 ? packFromPage : item.packSize;

      const provisional = decideScrapeSighting({
        restaurantId: ctx.restaurantId,
        url: ctx.url,
        providerId: ctx.providerId ?? null,
        vendorCatalogueId: ctx.vendorCatalogueId ?? null,
        vendorName: ctx.vendorName ?? null,
        productName: item.name,
        signatureHash,
        price: item.price,
        currency: item.currency,
        packSize,
        unitVolumeMl: readMl ?? item.volumeMl,
        volume:
          reading && reading.read
            ? {
                source: reading.source,
                statement: reading.statement,
                locator: reading.locator,
                candidates: reading.candidates.map((c) => ({
                  source: c.source,
                  ml: c.ml,
                  statement: c.statement,
                  locator: c.locator,
                })),
                nonStandardFormat: reading.nonStandardFormat,
                notes: reading.notes,
              }
            : readMl === null && item.volumeMl
              ? {
                  source: "model_text",
                  statement: `${item.volumeMl}ml, as the model read the page text`,
                  locator: "extraction model",
                  notes: reading ? reading.notes : [],
                }
              : null,
        volumeConflict: conflict,
        pageStatedDate: ctx.pageStatedDate,
        fetchedAt: ctx.fetchedAt,
        contentHash: ctx.contentHash,
        httpStatus: ctx.httpStatus,
        parseConfidence: item.parseConfidence,
        raw: {
          producer: item.producer,
          vintage: item.vintage,
          inStock: item.inStock,
          warnings: item.warnings,
          // Both packs when they disagree, so the choice above is auditable.
          modelPackSize: item.packSize,
          packFromPageStatement: packFromPage,
        },
      });

      if (!provisional.write) {
        refusals[provisional.reason] += 1;
        this.logger.debug(provisional.message);
        continue;
      }

      // Decided a second time, now that the group is known. The judgement is
      // pure and cheap; running it twice is far less costly than threading a
      // half-built row through the outlier read.
      const isOutlier = signatureHash
        ? isOutlierAgainstPriors(
            priors.get(signatureHash) ?? [],
            provisional.normalizedUnitPrice,
          )
        : false;
      if (isOutlier) flaggedOutliers += 1;

      const source =
        reading && reading.read ? reading.source : item.volumeMl ? "model_text" : "none";
      volumeSources[source] = (volumeSources[source] ?? 0) + 1;

      rows.push({ ...provisional.row, is_outlier: isOutlier });
    }

    if (rows.length === 0)
      return { written: 0, refusals, flaggedOutliers, volumeSources, warnings };

    const { data, error } = await this.databaseService.supabase
      .from("vendor_price_observations")
      .upsert(rows, {
        onConflict: "source_ref,content_hash",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) {
      this.logger.error(
        `Failed to write vendor price observations for ${ctx.url}: ${error.message}`,
      );
      // A failed write is NOT "nothing was found". Say which, on the result.
      warnings.push(`Register write failed: ${error.message}`);
      return { written: 0, refusals, flaggedOutliers: 0, volumeSources, warnings };
    }
    return {
      written: (data ?? []).length,
      refusals,
      flaggedOutliers,
      volumeSources,
      warnings,
    };
  }

  /**
   * The unit prices already on the register for these products, for the
   * outlier test.
   *
   * Scoped exactly as `belowTrailingAverage` scopes its own read
   * (`vendor-comparison.service.ts:341`): market rows plus this tenant's, never
   * another tenant's. Judging a candidate against a group that includes rows
   * this house may not see would flag a row for a reason its owner cannot
   * inspect.
   *
   * A read failure returns EMPTY priors, which means `isOutlierAgainstPriors`
   * sees fewer than MIN_OUTLIER_SAMPLE values and returns false — the row is
   * written unflagged. That is the safe direction: a flag we could not compute
   * must not be asserted, and an unflagged row stays visible in the ladder
   * where a person can see it. The failure is logged rather than swallowed.
   */
  private async loadPriorUnitPrices(
    signatureHashes: string[],
    restaurantId: string | null,
  ): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    const unique = Array.from(new Set(signatureHashes));
    if (unique.length === 0) return out;

    const query = scopePriceRegisterRead(
      this.databaseService.supabase
        .from("vendor_price_observations")
        .select("signature_hash, normalized_unit_price"),
      VENDOR_PRICE_OBSERVATIONS,
      restaurantId
        ? { kind: "houseAndOpenMarket", restaurantId }
        : { kind: "openMarketOnly" },
    )
      .in("signature_hash", unique)
      .not("normalized_unit_price", "is", null)
      .limit(2000);

    const { data, error } = await query;
    if (error) {
      this.logger.warn(
        `Could not read prior sightings for the outlier test: ${error.message}. ` +
          `Rows from this page are written UNFLAGGED rather than flagged on a guess.`,
      );
      return out;
    }
    for (const r of (data ?? []) as any[]) {
      const v = Number(r.normalized_unit_price);
      if (!r.signature_hash || !Number.isFinite(v)) continue;
      const bucket = out.get(r.signature_hash) ?? [];
      bucket.push(v);
      out.set(r.signature_hash, bucket);
    }
    return out;
  }

  /**
   * Sweep every active vendor in vendor_catalogue that has a website.
   *
   * Sequential with a delay, not parallel. Politeness is the reason, and so is
   * self-interest: twenty concurrent scrapes from one IP is the pattern that
   * gets a source blocked permanently, and a lost vendor costs more than a
   * slow sweep.
   */
  async sweepCatalogue(
    opts: {
      limit?: number;
      dryRun?: boolean;
      restaurantId?: string | null;
    } = {},
  ) {
    const { limit = 25, dryRun = false, restaurantId = null } = opts;

    const { data: vendors, error } = await this.databaseService.supabase
      .from("vendor_catalogue")
      .select("id, name, website")
      .eq("is_active", true)
      .not("website", "is", null)
      .limit(limit);

    if (error)
      throw new Error(`Failed to load vendor catalogue: ${error.message}`);

    const results: ExtractionRunResult[] = [];
    for (const v of vendors ?? []) {
      results.push(
        await this.extractFromUrl({
          url: v.website,
          vendorCatalogueId: v.id,
          vendorName: v.name,
          // Added 2026-09-04. Without it every row this sweep produced would be
          // refused (`no_restaurant`) — and before the refusal existed, every
          // row it wrote carried a null `restaurant_id` and was therefore read
          // by every house on the platform.
          restaurantId,
          dryRun,
        }),
      );
      // The scheduled sweep (`vendor-site-sweep.service.ts`) paces per HOST at
      // a documented floor and honours each host's own Crawl-delay. This
      // manual path keeps its own flat pause between vendors; it is
      // owner-triggered, one run at a time, and the two must not share a
      // limiter that a hand-run could exhaust for the nightly job.
      await new Promise((r) => setTimeout(r, 2000));
    }
    return results;
  }
}
