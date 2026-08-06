import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { DatabaseService } from "../database/database.service";
import {
  ExtractedItem,
  htmlToText,
  isPathAllowed,
  normalizeExtraction,
} from "./vendor-page-extraction";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

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

export interface ExtractionRunResult {
  url: string;
  fetched: boolean;
  httpStatus: number | null;
  itemsFound: number;
  observationsWritten: number;
  rejected: number;
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
  private async isAllowed(target: URL): Promise<boolean> {
    try {
      const robotsUrl = `${target.origin}/robots.txt`;
      const res = await fetch(robotsUrl, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return true;
      const body = await res.text();
      return isPathAllowed(body, target.pathname, "WineOpsBot");
    } catch {
      return true;
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

    if (!(await this.isAllowed(target))) {
      result.skippedReason = "Disallowed by robots.txt";
      this.logger.log(`Skipping ${url} — robots.txt disallows it`);
      return result;
    }

    let html: string;
    try {
      const res = await fetch(target.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        signal: AbortSignal.timeout(20_000),
      });
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

    const apiKey = this.configService.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      result.skippedReason = "ANTHROPIC_API_KEY not configured";
      return result;
    }

    let rawText: string;
    try {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model(),
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        result.skippedReason = `Anthropic ${res.status}: ${detail.slice(0, 200)}`;
        return result;
      }
      const payload: any = await res.json();
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

    for (const r of extraction.rejected.slice(0, 10)) {
      this.logger.debug(`Rejected row from ${url}: ${r.reason}`);
    }

    if (dryRun || extraction.items.length === 0) return result;

    result.observationsWritten = await this.writeObservations(
      extraction.items,
      { ...params, contentHash, httpStatus: result.httpStatus },
    );
    return result;
  }

  /**
   * Persist items as website_scrape observations.
   *
   * Uses upsert on the (source_ref, content_hash) dedup index so a re-scrape
   * of an unchanged page is a no-op rather than a fresh observation. Without
   * that, a nightly job would "confirm" a stale price 30 times a month and the
   * consensus would treat repetition as corroboration.
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
    },
  ): Promise<number> {
    const rows = items.map((item) => ({
      restaurant_id: ctx.restaurantId ?? null,
      provider_id: ctx.providerId ?? null,
      vendor_catalogue_id: ctx.vendorCatalogueId ?? null,
      vendor_name_raw: ctx.vendorName ?? null,
      product_name_raw: item.name,
      source_type: "website_scrape",
      trust_tier: 4,
      // Per-item source_ref keeps the dedup index meaningful: the page is the
      // same, but each wine on it is a distinct observation.
      source_ref: `${ctx.url}#${item.name}`,
      source_url: ctx.url,
      raw_price: item.price,
      currency: item.currency,
      pack_size: item.packSize,
      unit_volume_ml: item.volumeMl,
      parse_confidence: item.parseConfidence,
      content_hash: ctx.contentHash,
      http_status: ctx.httpStatus,
      raw: {
        producer: item.producer,
        vintage: item.vintage,
        inStock: item.inStock,
        warnings: item.warnings,
      },
    }));

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
      return 0;
    }
    return (data ?? []).length;
  }

  /**
   * Sweep every active vendor in vendor_catalogue that has a website.
   *
   * Sequential with a delay, not parallel. Politeness is the reason, and so is
   * self-interest: twenty concurrent scrapes from one IP is the pattern that
   * gets a source blocked permanently, and a lost vendor costs more than a
   * slow sweep.
   */
  async sweepCatalogue(opts: { limit?: number; dryRun?: boolean } = {}) {
    const { limit = 25, dryRun = false } = opts;

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
          dryRun,
        }),
      );
      await new Promise((r) => setTimeout(r, 2000));
    }
    return results;
  }
}
