import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../../database/database.service";
import { VendorComparisonService } from "../../vendor-intel/vendor-comparison.service";
import type { BelowAverageItem } from "../../vendor-intel/price-below-average";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import { money, percent } from "./producer-copy";
import {
  DROP_THRESHOLD_ENV,
  IMPLAUSIBLE_DROP_CEILING,
  MARKET_READ_LIMIT,
  MARKET_WINDOW_DAYS,
  MIN_BASELINE_OBSERVATIONS,
  SIGNAL_WINDOW_DAYS,
  decideSignal,
  readThreshold,
} from "./market-signal";

/**
 * "Product X is selling below its 30-day average."
 *
 * THE FOUNDER'S SENTENCE, VERBATIM (p4d brief, 2026-09-03)
 * -------------------------------------------------------
 *   "Add a section (maybe a box) that will endpoint to market price
 *    notifications eg. Prod X is now selling lower than 30 day avg. (buy it now
 *    sth like that)"
 *
 * THE BOX AND THE BOOK ARE TWO HALVES, AND THEY WERE BUILT BY TWO HANDS
 * --------------------------------------------------------------------
 * The BOX is `GET /vendor-intel/below-average` — `priceBelowAverage` for the
 * arithmetic, `VendorComparisonService.belowTrailingAverage` for the read,
 * `apps/web/src/pages/notifications/next/useMarketPrice.ts` for the consumer.
 * All three landed in this same pass, and that file's own header says the
 * producer that writes a drop into the book "belongs to a different pair of
 * hands". This is that producer, and it CALLS that read rather than repeating
 * it: two normalisations of the same bottle would let the box and the book
 * disagree on the same day, which is worse than either being slightly wrong.
 *
 * WHAT THIS ADDS THAT THE BOX DOES NOT HAVE
 * -----------------------------------------
 * 1. **It narrows to what this house buys.** `belowTrailingAverage` sweeps every
 *    observation in the window — tenant rows and public market rows alike
 *    (vendor-comparison.service.ts:334-343) — which is right for a browsable
 *    box and wrong for an interruption. A notification that a bottle this
 *    kitchen has never ordered is cheap is noise. The product set is the house's
 *    own purchase record: distinct `master_wine_id` on the items of this
 *    restaurant's orders, read through `procurement_orders` (whose
 *    `restaurant_id` is NOT NULL, baseline:4514) rather than through
 *    `procurement_order_items` (whose `restaurant_id` is NULLABLE,
 *    baseline:4505, so filtering it directly would silently drop every line that
 *    was never backfilled).
 * 2. **A floor worth interrupting for.** The box's own floor is 2%
 *    (price-below-average.ts:120). A notification asks for 10% by default; see
 *    `market-signal.ts` for the provenance and for the env override.
 * 3. **A ceiling.** See `market-signal.ts` — `is_outlier` has no writer anywhere
 *    in this repository, so the read's outlier filter excludes nothing, and the
 *    rows most likely to look like a bargain are the ones the engine would call
 *    bad parses. A drop past the ceiling is refused and named rather than sent.
 * 4. **Once per product per week.** A price sitting below its average all week
 *    is one row in the book, not seven.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not add a second read route. The brief offered
 * `GET /notifications/market-signals/:rid` or `vendor-intel`; the measurement is
 * that `vendor-intel` already owns it, already answers, and is already wired to
 * the page. `GET /notifications/producers/status` is the only new read, and it
 * is about the producers, not the market.
 */

const PRODUCER = "market_price";

@Injectable()
export class MarketPriceProducer {
  private readonly logger = new Logger(MarketPriceProducer.name);

  static readonly PRODUCER = PRODUCER;

  /** Recent orders scanned for the house's product list. */
  static readonly ORDER_CAP = 400;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly comparison: VendorComparisonService,
    private readonly ledger: ProducerLedgerService,
    private readonly configService: ConfigService,
  ) {}

  private threshold(): { value: number; source: "default" | "env" } {
    return readThreshold(
      this.configService.get<string>(DROP_THRESHOLD_ENV) ??
        process.env[DROP_THRESHOLD_ENV],
    );
  }

  thresholdPct(): number {
    return this.threshold().value;
  }

  thresholdSource(): "default" | "env" {
    return this.threshold().source;
  }

  async sweepTenant(
    restaurantId: string,
    _timeZone: string,
    audience: ProducerAudience,
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();
    const { value: threshold, source: thresholdSource } = this.threshold();

    // The same read the page's market box calls, with the same window and the
    // same minimum history. `limit` is the read's own ranking cap.
    const ranked = await this.comparison.belowTrailingAverage({
      restaurantId,
      windowDays: MARKET_WINDOW_DAYS,
      minObservations: MIN_BASELINE_OBSERVATIONS,
      limit: MARKET_READ_LIMIT,
    });

    const bought = await this.boughtProducts(restaurantId);
    tally.truncated = bought.truncated;

    if (bought.keys.size === 0) {
      tally.withheldReason =
        bought.linesWithoutIdentity > 0
          ? `This house has bought ${bought.linesWithoutIdentity} order line(s) that carry no library identity, so no price sighting can be joined to them. That is OD-113, the non-wine identity axis; nothing was guessed.`
          : "No order line with a library identity was found for this restaurant, so there is no product this house buys to watch a price for.";
      return tally;
    }

    // One read of this producer's own claims for the whole suppression window,
    // rather than one per product. The UNIQUE index still carries same-tick
    // correctness; this is what keeps it quiet between days.
    const alreadySaid = await this.ledger.claimedKeysSince(
      restaurantId,
      PRODUCER,
      new Date(now.getTime() - SIGNAL_WINDOW_DAYS * 86_400_000),
    );
    const saidProducts = new Set<string>();
    for (const key of alreadySaid) {
      // `product:<productKey>:<date>` — and `productKey` is itself
      // `wine:<uuid>`, so the product is everything between the first and last
      // colon rather than one segment.
      const first = key.indexOf(":");
      const last = key.lastIndexOf(":");
      if (first > -1 && last > first) saidProducts.add(key.slice(first + 1, last));
    }

    const day = now.toISOString().slice(0, 10);
    let notOurs = 0;
    let belowFloor = 0;
    let implausible = 0;
    let suppressed = 0;

    for (const item of ranked.items as BelowAverageItem[]) {
      if (!bought.keys.has(item.productKey)) {
        notOurs += 1;
        continue;
      }

      const decision = decideSignal(item.fractionBelow, threshold);
      if (decision.verdict === "implausible") {
        implausible += 1;
        this.logger.warn(
          `MARKET_SIGNAL_IMPLAUSIBLE restaurant=${restaurantId} product=${item.productKey} — ` +
            `${decision.reason} latest=${item.latest.unitPrice} average=${item.average.unitPrice} ` +
            `source=${item.latest.sourceType}.`,
        );
        continue;
      }
      if (decision.verdict === "below_floor") {
        belowFloor += 1;
        continue;
      }

      if (saidProducts.has(item.productKey)) {
        suppressed += 1;
        tally.alreadyClaimed += 1;
        continue;
      }

      const observedAt = new Date(item.latest.observedAt);
      const label =
        item.productName ?? bought.labels.get(item.productKey) ?? "A product";

      await this.ledger.emit(
        { restaurantId, producer: PRODUCER, audience, tally, now },
        {
          dedupeKey: `product:${item.productKey}:${day}`,
          occurredAt: Number.isFinite(observedAt.getTime()) ? observedAt : now,
          payload: {
            // `price_change` — already mapped to the "Orders" register
            // (nt-format.ts:103) and the type this page's note
            // §13.22 specifies for exactly this producer.
            type: "price_change",
            // The title is the record: the object and the measured fact, with no
            // verb of approval. The judgement lives in the message, qualified,
            // and in the action label, which is a control rather than a claim.
            title: `${label} is ${percent(item.fractionBelow)} below its ${MARKET_WINDOW_DAYS}-day average`,
            message: this.sentence(item, label),
            priority: "medium",
            actionUrl: `/vendor-prices?product=${encodeURIComponent(item.productKey)}`,
            actionLabel: "Compare vendors",  // a control, never a claim
            metadata: {
              productKey: item.productKey,
              productName: label,
              currency: item.currency,
              latestPrice: item.latest.unitPrice,
              latestObservedAt: item.latest.observedAt,
              latestVendor: item.latest.vendorName,
              latestSourceType: item.latest.sourceType,
              averagePrice: item.average.unitPrice,
              averageOfObservations: item.average.observations,
              averageFrom: item.average.from,
              averageTo: item.average.to,
              absoluteBelow: item.absoluteBelow,
              fractionBelow: item.fractionBelow,
              // The numbers that produced the sentence travel with it, so a
              // reader can check one against the other — Stripe's
              // `usage_threshold[gte]` is a field, not a hidden constant.
              thresholdPct: threshold,
              thresholdSource,
              implausibleCeiling: IMPLAUSIBLE_DROP_CEILING,
              windowDays: MARKET_WINDOW_DAYS,
              minObservations: MIN_BASELINE_OBSERVATIONS,
              suppressionDays: SIGNAL_WINDOW_DAYS,
              priceBasis:
                "price per 750ml-equivalent usable unit, from the engine's normalizeUnitPrice",
              averageBasis:
                "mean of the EARLIER sightings in the window, excluding the latest — vendor-intel/price-below-average.ts",
              scannedObservations: ranked.scanned.observations,
              scannedProducts: ranked.scanned.products,
            },
          },
        },
      );
    }

    if (tally.emitted === 0 && tally.withheldReason === null) {
      if (ranked.scanned.observations === 0) {
        // The distinction the whole page is being rebuilt around: an empty
        // register and a quiet market are not the same sentence. Measured
        // 2026-09-03, `vendor_price_observations` holds zero rows, so this is
        // the branch that actually fires today.
        tally.withheldReason =
          `The price register holds no sighting this restaurant can see in the last ${MARKET_WINDOW_DAYS} days — ` +
          "not 'nothing is cheap', but 'nothing has been observed'. This producer stays silent until a price is " +
          "recorded, by a scrape (POST /vendor-intel/scrape) or by hand (POST /vendor-intel/observations).";
        return tally;
      }
      const bits = [
        `${bought.keys.size} product(s) this house buys were matched against ${ranked.scanned.products} priced product(s) in the last ${MARKET_WINDOW_DAYS} days`,
      ];
      if (suppressed > 0) {
        bits.push(
          `${suppressed} already reported within the last ${SIGNAL_WINDOW_DAYS} days`,
        );
      }
      if (belowFloor > 0) {
        bits.push(
          `${belowFloor} below the ${(threshold * 100).toFixed(0)}% this house asks for`,
        );
      }
      if (implausible > 0) {
        bits.push(
          `${implausible} refused as a probable bad parse rather than reported`,
        );
      }
      if (notOurs > 0) {
        bits.push(`${notOurs} ranked product(s) this house has never bought`);
      }
      if (ranked.skipped.thinHistory > 0) {
        bits.push(
          `${ranked.skipped.thinHistory} product(s) have fewer than ${MIN_BASELINE_OBSERVATIONS} earlier sightings`,
        );
      }
      if (bought.linesWithoutIdentity > 0) {
        bits.push(
          `${bought.linesWithoutIdentity} bought line(s) carry no library identity and cannot be priced`,
        );
      }
      tally.withheldReason = `${bits.join("; ")}.`;
    }

    return tally;
  }

  /**
   * How many price sightings this restaurant can see in the window.
   *
   * `null` means the register could not be READ, which is not the same as zero
   * and must never be rendered as it. Used by
   * `GET /notifications/producers/status` to say plainly why this producer will
   * stay silent even once the deployment is armed.
   */
  async visibleObservationCount(
    restaurantId: string,
    now: Date = new Date(),
  ): Promise<number | null> {
    const since = new Date(
      now.getTime() - MARKET_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    const { count, error } = await this.databaseService
      .getClient()
      .from("vendor_price_observations")
      .select("id", { count: "exact", head: true })
      .gte("observed_at", since)
      .or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`);
    if (error) {
      this.logger.warn(
        `MARKET_SIGNAL_REGISTER_UNREADABLE restaurant=${restaurantId} — ${error.message}. ` +
          "The status read will say the register could not be read, never that it is empty.",
      );
      return null;
    }
    return typeof count === "number" ? count : null;
  }

  /** The founder's sentence, with the arithmetic and one honest qualifier. */
  private sentence(item: BelowAverageItem, label: string): string {
    const parts: string[] = [];
    parts.push(
      `${item.latest.vendorName ?? "A vendor"} is quoting ${money(item.latest.unitPrice, item.currency)} for ${label}, against a ${MARKET_WINDOW_DAYS}-day average of ${money(item.average.unitPrice, item.currency)} across ${item.average.observations} earlier sighting${item.average.observations === 1 ? "" : "s"}.`,
    );
    // The qualifier is not decoration. This compares the newest sighting with a
    // mean of earlier ones, and the engine's own header warns that shape "would
    // report vendor churn as price movement" (vendor-price-consensus.ts:386-391)
    // — a cheaper vendor appearing and a price falling are not the same event,
    // and only a person can tell which one matters here.
    parts.push(
      `Read from ${item.latest.sourceType.replace(/_/g, " ")}; it compares the newest sighting with the mean of the earlier ones, so a cheaper vendor appearing reads the same as a price falling.`,
    );
    parts.push("A good time to buy, on price alone.");
    return parts.join(" ");
  }

  /**
   * The products this house actually buys, keyed the way the market read keys
   * them.
   *
   * `priceBelowAverage` groups on `wine:<master_wine_id>` or
   * `sig:<signature_hash>` (price-below-average.ts:142-146). An order line
   * carries only `master_wine_id`, so this house's set is the `wine:` half; a
   * product the house buys that reaches the price register only under a
   * signature hash is invisible to this join and is counted as such rather than
   * silently dropped.
   */
  private async boughtProducts(restaurantId: string): Promise<{
    keys: Set<string>;
    labels: Map<string, string>;
    linesWithoutIdentity: number;
    truncated: boolean;
  }> {
    const client = this.databaseService.getClient();

    const { data: orders, error: orderError } = await client
      .from("procurement_orders")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(MarketPriceProducer.ORDER_CAP + 1);
    if (orderError) {
      // Throwing hands the tenant to `runPerTenant`. An empty set here would
      // silence the producer and look like a house that buys nothing.
      throw new Error(
        `could not read procurement_orders: ${orderError.message}`,
      );
    }

    const orderRows = (orders ?? []) as any[];
    const truncated = orderRows.length > MarketPriceProducer.ORDER_CAP;
    const orderIds = orderRows
      .slice(0, MarketPriceProducer.ORDER_CAP)
      .map((o) => o.id)
      .filter(Boolean);

    const keys = new Set<string>();
    const labels = new Map<string, string>();
    if (!orderIds.length) {
      return { keys, labels, linesWithoutIdentity: 0, truncated };
    }

    const { data: items, error: itemError } = await client
      .from("procurement_order_items")
      .select("master_wine_id, wine_name, producer")
      .in("order_id", orderIds);
    if (itemError) {
      throw new Error(
        `could not read procurement_order_items: ${itemError.message}`,
      );
    }

    let linesWithoutIdentity = 0;
    for (const item of (items ?? []) as any[]) {
      if (!item?.master_wine_id) {
        linesWithoutIdentity += 1;
        continue;
      }
      const key = `wine:${item.master_wine_id}`;
      keys.add(key);
      if (!labels.has(key)) {
        // The house's own words for it, from its own order line, preferred over
        // the scraped `product_name_raw` only when that is absent.
        const label = [item.producer, item.wine_name]
          .filter((s) => s && String(s).trim())
          .join(" ")
          .trim();
        if (label) labels.set(key, label);
      }
    }

    return { keys, labels, linesWithoutIdentity, truncated };
  }
}
