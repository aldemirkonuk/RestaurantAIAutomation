/**
 * The scheduled fetch — DORMANT unless `PRICE_INDEX_FETCH_ENABLED` is armed.
 *
 * WHY IT DEFAULTS OFF (the allow-list, ADR 0117)
 * ----------------------------------------------
 * This is the one process in this module that makes outbound requests to
 * government endpoints in the house's name. It is off unless explicitly armed,
 * and armed by an allow-list ("true"/"1"), so a typo leaves it silent rather
 * than turning a live crawler on. When it is off the `@Cron` handler returns
 * immediately and writes nothing.
 *
 * WHAT IT DOES WHEN ARMED
 * -----------------------
 * For each fetchable source (California live, Iowa/Oregon from their datasets):
 *   1. fetch the published list, honouring its terms (see `fetchers.ts`);
 *   2. parse it — the SAME parser the tests run — counting every refused row;
 *   3. apply the staleness gate: if the newest issuer date is past the source's
 *      cadence, REFUSE the whole run and write nothing (the bh_fv020.txt case);
 *   4. upsert the survivors on (source_ref, content_hash), so a re-read of an
 *      unchanged posting is a no-op and a price change is a new row.
 * Every run's outcome — counts, refusals, why it was silent — is kept so the
 * status endpoint can report it. A run that wrote nothing says why it wrote
 * nothing; it is never reported as a healthy empty.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import {
  ParseRun,
  PostingSighting,
  contentHash,
  tally,
} from "./price-index.types";
import { SOURCES } from "./price-index.registry";
import { priceIndexFetchArmed, refuseStale, PRICE_INDEX_FETCH_FLAG } from "./staleness";
import {
  fetchCalifornia,
  fetchDefra,
  fetchIowa,
  fetchOregon,
  loadFixture,
} from "./fetchers";
import { DEFRA_SOURCE_KEY } from "./parse-defra";

const FETCH_CRON = "0 6 * * *"; // 06:00 daily; sources move at most monthly
const FETCH_JOB_NAME = "price-index-fetch";

export interface FetchOutcome {
  sourceKey: string;
  ranAt: string;
  rowsRead: number;
  written: number;
  refused: number;
  refusalsByReason: Record<string, number>;
  issuedAt: string | null;
  ageDays: number | null;
  silentBecause: string | null;
}

@Injectable()
export class PriceIndexFetchService {
  private readonly logger = new Logger(PriceIndexFetchService.name);
  private readonly lastRuns = new Map<string, FetchOutcome>();

  constructor(private readonly db: DatabaseService) {}

  lastRunFor(sourceKey: string): FetchOutcome | null {
    return this.lastRuns.get(sourceKey) ?? null;
  }

  allLastRuns(): FetchOutcome[] {
    return [...this.lastRuns.values()];
  }

  @Cron(FETCH_CRON, { name: FETCH_JOB_NAME })
  async scheduledSweep(): Promise<void> {
    if (!priceIndexFetchArmed(process.env[PRICE_INDEX_FETCH_FLAG])) {
      return; // OFF by default. No log spam, no outbound request, no write.
    }
    this.logger.log(`${FETCH_JOB_NAME}: armed, sweeping fetchable sources`);
    for (const source of Object.values(SOURCES)) {
      if (source.withheld || !source.parse) continue;
      try {
        await this.fetchOne(source.key);
      } catch (err) {
        this.logger.warn(
          `${FETCH_JOB_NAME}: ${source.key} failed: ${(err as Error).message}`,
        );
        this.record(source.key, {
          sourceKey: source.key,
          ranAt: new Date().toISOString(),
          rowsRead: 0,
          written: 0,
          refused: 0,
          refusalsByReason: {},
          issuedAt: null,
          ageDays: null,
          silentBecause: `fetch failed: ${(err as Error).message}`,
        });
      }
    }
  }

  /**
   * Fetch (or, offline, parse the fixture for) one source and write survivors.
   * Returns the outcome and records it for the status endpoint.
   */
  async fetchOne(
    sourceKey: string,
    opts: { offline?: boolean; today?: Date } = {},
  ): Promise<FetchOutcome> {
    const source = SOURCES[sourceKey];
    if (!source || !source.parse) {
      throw new Error(`No parseable source '${sourceKey}'`);
    }
    const ranAt = new Date().toISOString();
    const rows = opts.offline
      ? await loadFixture(source.fixture)
      : await this.fetchRows(sourceKey);
    const run: ParseRun = source.parse(rows, ranAt);

    // The staleness gate stands before any write. `today` is injectable so a
    // test pins it; production uses the real clock.
    const verdict = refuseStale(run.issuedAt, source.maxAgeDays, opts.today);
    if (verdict.stale) {
      const outcome: FetchOutcome = {
        sourceKey,
        ranAt,
        rowsRead: run.rowsRead,
        written: 0,
        refused: run.refusals.length,
        refusalsByReason: tally(run.refusals),
        issuedAt: run.issuedAt,
        ageDays: verdict.ageDays,
        silentBecause: `REFUSED (stale): ${verdict.reason}`,
      };
      this.record(sourceKey, outcome);
      return outcome;
    }

    const written = await this.writeSightings(run.sightings, ranAt);
    const outcome: FetchOutcome = {
      sourceKey,
      ranAt,
      rowsRead: run.rowsRead,
      written,
      refused: run.refusals.length,
      refusalsByReason: tally(run.refusals),
      issuedAt: run.issuedAt,
      ageDays: verdict.ageDays,
      silentBecause: run.sightings.length === 0
        ? "nothing survived the parser's checks"
        : null,
    };
    this.record(sourceKey, outcome);
    return outcome;
  }

  private async fetchRows(sourceKey: string): Promise<unknown[]> {
    switch (sourceKey) {
      case "california-abc-beer-price-posting":
        return fetchCalifornia();
      case "iowa-liquor-products":
        return fetchIowa();
      case "oregon-olcc-monthly-pricing":
        return fetchOregon();
      case DEFRA_SOURCE_KEY:
        return fetchDefra();
      default:
        throw new Error(`No fetcher for '${sourceKey}'`);
    }
  }

  private async writeSightings(
    sightings: PostingSighting[],
    fetchedAt: string,
  ): Promise<number> {
    if (sightings.length === 0) return 0;
    const rows = sightings.map((s) => ({
      source_key: s.sourceKey,
      source_class: s.sourceClass,
      state: s.state,
      region: s.region,
      issuer: s.issuer,
      issued_at: s.issuedAt,
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
    }));
    const { error } = await this.db.client
      .from("price_index_postings")
      .upsert(rows, { onConflict: "source_ref,content_hash", ignoreDuplicates: true });
    if (error) throw error;
    return rows.length;
  }

  private record(sourceKey: string, outcome: FetchOutcome): void {
    this.lastRuns.set(sourceKey, outcome);
  }
}
