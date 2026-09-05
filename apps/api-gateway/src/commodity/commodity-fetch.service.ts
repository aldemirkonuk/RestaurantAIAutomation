/**
 * The scheduled reader for the index-series register. OFF BY DEFAULT.
 *
 * `COMMODITY_INDEX_FETCH_ENABLED` is an allow-list (`true` / `1`), parsed by
 * `price-index/staleness.ts`'s own parser rather than a second copy of it. The
 * asymmetry is the safety property: a typo leaves the fetch OFF, which is
 * silence and is recoverable, and never ON, which is a live outbound reader and
 * is not.
 *
 * WHAT IT WILL AND WILL NOT POINT AT
 * ----------------------------------
 * Only `fetchableSeries()` — a series whose `admission` is `fetch` and whose
 * `withheld` is null. Today that is FAO and ONS, both of whose `robots.txt`
 * were read BEFORE their data and both of which permit the path
 * (`p4-scratch/p4bb-fetch-log.md` rows 1-4, and independently
 * `p4as-fetch-log.md` rows 75-76). It will never point at
 * `www.ams.usda.gov`, whose robots.txt returns 403 — the registry marks that
 * series `upload_only` and this loop skips it by construction rather than by a
 * conditional somebody could delete.
 *
 * THE WRITE IS AN UPSERT ON THE DEDUP KEY, NOT A DELETE-AND-REPLACE
 * -----------------------------------------------------------------
 * `(series_id, period_start, source_ref, content_hash)` is UNIQUE, so a re-read
 * of an unchanged observation collides and is ignored, and a REVISED value
 * hashes differently and becomes its own row. That is deliberate and it is what
 * makes a fired alert auditable later: overwriting a preliminary value would
 * rewrite the history the alert fired on. BLS flagged `WPU0223` "Preliminary.
 * All indexes are subject to monthly revisions" for four consecutive months, so
 * this is a measured case rather than a hypothetical one.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { USER_AGENT } from "../price-index/fetchers";
import {
  COMMODITY_FETCH_FLAG,
  admitRun,
  commodityFetchArmed,
  type AdmissionVerdict,
} from "./commodity-admission";
import { fetchableSeries, SERIES, type SeriesEntry } from "./commodity.registry";
import { parseFao } from "./parse-fao";
import { parseOns } from "./parse-ons";
import { parseUsdaShellEgg } from "./parse-usda-shell-egg";
import type { SeriesParseRun } from "./commodity.types";

/** Reads one series' payload. Injected in tests so no test ever goes outbound. */
export type PayloadReader = (entry: SeriesEntry) => Promise<string>;

/** What one series' run did, whether or not anything was written. */
export interface SeriesRunOutcome {
  seriesKey: string;
  admission: AdmissionVerdict;
  rowsRead: number;
  observationsParsed: number;
  refusals: Record<string, number>;
  written: number;
  /** The words for a legitimate no-op. Never an empty result with no reason. */
  note: string | null;
}

/**
 * Which parser reads which series. Declared, never inferred from a URL.
 *
 * The USDA shell-egg entry HAS a parser here and is still not fetchable: the
 * two are separate facts and conflating them is what a `upload_only` series
 * exists to prevent. `runOne` refuses it on `admission` before this map is
 * consulted, and `fetchableSeries()` excludes it before that. The parser is
 * here so that the day a person's own download lands, the upload path has
 * something to call and NOTHING ELSE CHANGES (the founder's Q1 answer,
 * 2026-09-05).
 */
export function parserFor(
  entry: SeriesEntry,
): ((payload: string, opts: { seriesKey: string; fetchedAt: string }) => SeriesParseRun) | null {
  if (entry.seriesKey === SERIES["fao.food_price_index.all"]?.seriesKey) {
    return parseFao;
  }
  if (
    entry.seriesKey ===
    SERIES["ons.d7bu.cpi_food_and_non_alcoholic_beverages"]?.seriesKey
  ) {
    return parseOns;
  }
  if (entry.seriesKey === SERIES["usda_ams.shell_egg_index.national"]?.seriesKey) {
    return parseUsdaShellEgg;
  }
  return null;
}

@Injectable()
export class CommodityFetchService {
  private readonly logger = new Logger(CommodityFetchService.name);
  /** This process's last outcome per series, so a status route can say so. */
  private readonly lastRun = new Map<string, SeriesRunOutcome>();

  constructor(private readonly db: DatabaseService) {}

  armed(): boolean {
    return commodityFetchArmed(process.env[COMMODITY_FETCH_FLAG]);
  }

  lastRunFor(seriesKey: string): SeriesRunOutcome | null {
    return this.lastRun.get(seriesKey) ?? null;
  }

  /** The default reader. Never called when the flag is off. */
  private async readOverHttp(entry: SeriesEntry): Promise<string> {
    const res = await fetch(entry.sourceUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`${entry.sourceUrl} returned HTTP ${res.status}`);
    }
    return res.text();
  }

  /**
   * Read every fetchable series once.
   *
   * `read` is injectable so the tests parse the RECORDED FIXTURES through this
   * exact code path without a single outbound request.
   */
  async run(
    read?: PayloadReader,
    now: Date = new Date(),
  ): Promise<{ armed: boolean; note: string | null; outcomes: SeriesRunOutcome[] }> {
    if (!this.armed()) {
      return {
        armed: false,
        note: `${COMMODITY_FETCH_FLAG} is not armed, so nothing was fetched. This is a deliberate silence, not a failed read.`,
        outcomes: [],
      };
    }
    const reader = read ?? ((e: SeriesEntry) => this.readOverHttp(e));
    const outcomes: SeriesRunOutcome[] = [];
    for (const entry of fetchableSeries()) {
      const outcome = await this.runOne(entry, reader, now);
      this.lastRun.set(entry.seriesKey, outcome);
      outcomes.push(outcome);
    }
    return { armed: true, note: null, outcomes };
  }

  /**
   * One series. Public so a test can drive it with a fixture without arming a
   * flag — the flag guards `run()`, which is the only thing that goes outbound.
   */
  async runOne(
    entry: SeriesEntry,
    read: PayloadReader,
    now: Date = new Date(),
    write = true,
  ): Promise<SeriesRunOutcome> {
    const empty = (admission: AdmissionVerdict, note: string | null): SeriesRunOutcome => ({
      seriesKey: entry.seriesKey,
      admission,
      rowsRead: 0,
      observationsParsed: 0,
      refusals: {},
      written: 0,
      note,
    });

    if (entry.admission === "upload_only") {
      return empty(
        {
          admitted: false,
          reason: "upload_only",
          detail: entry.withheld?.reason ?? "This series may not be fetched.",
          ageDays: null,
        },
        entry.withheld?.reason ?? "This series may not be fetched.",
      );
    }

    const parse = parserFor(entry);
    if (!parse) {
      return empty(
        {
          admitted: false,
          reason: "no_observations",
          detail: `No parser is declared for ${entry.seriesKey}. Nothing was read; a series without a parser is not a series that published nothing.`,
          ageDays: null,
        },
        `No parser is declared for ${entry.seriesKey}.`,
      );
    }

    let payload: string;
    try {
      payload = await read(entry);
    } catch (err) {
      return empty(
        {
          admitted: false,
          reason: "no_observations",
          detail: `The payload could not be read: ${(err as Error).message}. This is unknown, not empty.`,
          ageDays: null,
        },
        `The payload could not be read: ${(err as Error).message}`,
      );
    }

    const fetchedAt = now.toISOString();
    const run = parse(payload, { seriesKey: entry.seriesKey, fetchedAt });
    const admission = admitRun(entry, run, now);
    const refusals: Record<string, number> = {};
    for (const r of run.refusals) refusals[r.reason] = (refusals[r.reason] ?? 0) + 1;

    const outcome: SeriesRunOutcome = {
      seriesKey: entry.seriesKey,
      admission,
      rowsRead: run.rowsRead,
      observationsParsed: run.observations.length,
      refusals,
      written: 0,
      note: admission.detail,
    };
    if (!admission.admitted || !write) return outcome;

    try {
      const seriesId = await this.ensureSeries(entry);
      const rows = run.observations.map((o) => ({
        series_id: seriesId,
        period_start: o.periodStart,
        period_grain: o.periodGrain,
        value: o.value,
        issued_at: o.issuedAt,
        issued_at_basis: o.issuedAtBasis,
        fetched_at: o.fetchedAt,
        vintage: o.vintage,
        source_ref: o.sourceRef,
        content_hash: o.contentHash,
      }));
      const { data, error } = await this.db.client
        .from("commodity_index_observations")
        .upsert(rows, {
          onConflict: "series_id,period_start,source_ref,content_hash",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) throw error;
      outcome.written = (data ?? []).length;
    } catch (err) {
      outcome.note = `The observations parsed and could not be written: ${(err as Error).message}. Nothing is claimed about the register's contents.`;
      this.logger.warn(outcome.note);
    }
    return outcome;
  }

  /**
   * The series row, created from the registry if it is not there.
   *
   * Every key is written EXPLICITLY — no conditional spread — because the
   * capture guard forbids one and because a spread is how a column silently
   * stops being written. The registry is the source of truth for the series'
   * terms; the derived thresholds are NOT touched here, so a calibration
   * somebody ran is never overwritten by a fetch.
   */
  private async ensureSeries(entry: SeriesEntry): Promise<string> {
    const { data, error } = await this.db.client
      .from("commodity_index_series")
      .upsert(
        {
          series_key: entry.seriesKey,
          issuer: entry.issuer,
          issuer_jurisdiction: entry.issuerJurisdiction,
          series_title: entry.seriesTitle,
          source_url: entry.sourceUrl,
          value_kind: entry.valueKind,
          unit: entry.unit,
          base_period: entry.basePeriod,
          currency: entry.currency,
          price_basis: entry.priceBasis,
          cadence: entry.cadence,
          max_age_days: entry.maxAgeDays,
          licence: entry.licence,
          attribution: entry.attribution,
          redistribution: entry.redistribution,
          admission: entry.admission,
          withheld_reason: entry.withheld?.reason ?? null,
          silent: entry.silent?.reason ?? null,
          measured_on: entry.withheld?.measuredOn ?? entry.silent?.measuredOn ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "series_key" },
      )
      .select("id")
      .single();
    if (error) throw error;
    return String((data as { id: string }).id);
  }
}
