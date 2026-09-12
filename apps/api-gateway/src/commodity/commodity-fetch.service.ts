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
import { buildKey, parseTuikSdmx } from "./parse-tuik-sdmx";
import {
  TUIK_KEY_ENV,
  TuikTokenHolder,
  scrubSecrets,
  type HttpPost,
} from "./tuik-token";
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
  /** When this process last actually read this source. Drives the interval. */
  readAt?: string;
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
  // Any SDMX series. Declared by the presence of `sdmx` on the entry rather
  // than by a key list, because the two TÜİK dataflows are read by one parser
  // and a third would be too.
  if (entry.sdmx) {
    return (payload: string, opts: { seriesKey: string; fetchedAt: string }) =>
      parseTuikSdmx(payload, {
        ...opts,
        expectDegisim: entry.sdmx!.degisim,
        expectCoicop: entry.sdmx!.coicop,
      });
  }
  return null;
}

/** The URL a scheduled read asks for, with the period bound that keeps it small. */
export function sdmxUrlFor(entry: SeriesEntry): string | null {
  if (!entry.sdmx) return null;
  const key = buildKey(entry.sdmx.key);
  return (
    `https://nsiws.tuik.gov.tr/rest/data/${entry.sdmx.dataflow}/${key}` +
    `?format=SDMX-CSV&startPeriod=${entry.sdmx.startPeriod}`
  );
}

@Injectable()
export class CommodityFetchService {
  private readonly logger = new Logger(CommodityFetchService.name);
  /** This process's last outcome per series, so a status route can say so. */
  private readonly lastRun = new Map<string, SeriesRunOutcome>();
  /**
   * One holder per process, holding one token for five minutes at a time.
   * Deliberately not a Nest provider: it holds a credential, and the fewer
   * things that can reach it, the fewer things that can leak it.
   */
  private readonly tuik: TuikTokenHolder;

  constructor(private readonly db: DatabaseService) {
    const post: HttpPost = async (url, body, headers) => {
      const res = await fetch(url, { method: "POST", body, headers });
      return { status: res.status, text: await res.text() };
    };
    this.tuik = new TuikTokenHolder(post);
  }

  /** For a status route: whether this environment holds the TÜİK credential. */
  tuikConfigured(): boolean {
    return this.tuik.configured();
  }

  armed(): boolean {
    return commodityFetchArmed(process.env[COMMODITY_FETCH_FLAG]);
  }

  lastRunFor(seriesKey: string): SeriesRunOutcome | null {
    return this.lastRun.get(seriesKey) ?? null;
  }

  /** The default reader. Never called when the flag is off. */
  private async readOverHttp(entry: SeriesEntry): Promise<string> {
    // A CREDENTIALLED source takes the other path. It is a different act: a
    // token is minted, a budget is spent, and no URL or error from it may carry
    // a secret into a log.
    if (entry.accessKeyRequired) return this.readWithToken(entry);
    const res = await fetch(entry.sourceUrl, {
      headers: { "User-Agent": entry.userAgent ?? USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`${entry.sourceUrl} returned HTTP ${res.status}`);
    }
    return res.text();
  }

  /**
   * Read one credentialled SDMX source.
   *
   * Three gates, in this order, and each says something different:
   *
   *   the BUDGET   ours, not the publisher's, because TÜİK states none.
   *                Checked FIRST so a misconfigured environment cannot spend
   *                the day's allowance discovering it is misconfigured.
   *   the TOKEN    minted from `TUIK_SDMX_API_KEY`; an unset variable refuses
   *                in words naming the variable, because the person reading
   *                that sentence is the person who can fix it.
   *   the READ     with `Authorization: Bearer`, and every failure message
   *                built from a STATUS rather than from a body.
   *
   * Nothing here logs the key, the token, or a response body.
   */
  private async readWithToken(entry: SeriesEntry): Promise<string> {
    const budget = entry.requestBudgetPerDay ?? 1;
    if (!this.tuik.spend(budget)) {
      const { day, spent } = this.tuik.spentSoFar();
      throw new Error(
        `This process has already used its self-imposed budget of ${budget} requests to ${entry.issuer} today (${spent} on ${day}), so nothing was read. The publisher states no rate limit; this ceiling is ours.`,
      );
    }

    const outcome = await this.tuik.get();
    if (!outcome.token) {
      // The refusal's own sentence, which is written to be safe to log.
      throw new Error(outcome.detail ?? "No token was obtained and no reason was recorded.");
    }

    const url = sdmxUrlFor(entry) ?? entry.sourceUrl;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${outcome.token}`,
          Accept: "text/csv",
          "User-Agent": entry.userAgent ?? USER_AGENT,
        },
      });
    } catch (err) {
      // Scrubbed: a fetch error can carry request headers in its message on
      // some runtimes, and the headers carry the bearer token.
      throw new Error(scrubSecrets((err as Error).message));
    }
    if (!res.ok) {
      // A 401 here means the token was refused, and the SENTENCE says what to
      // do about it rather than repeating a body that could echo a credential.
      throw new Error(
        res.status === 401
          ? `${entry.issuer} refused the token (HTTP 401). The credential in ${TUIK_KEY_ENV} may have been revoked or may not carry this dataflow; nothing was read and no part of the response is repeated here.`
          : `The SDMX read returned HTTP ${res.status}. Nothing was read.`,
      );
    }
    return res.text();
  }

  /**
   * Whether enough days have passed for this series to be read again.
   *
   * Only a series that declares `fetchIntervalDays` has one: TT09's unbounded
   * payload measured 7,532,768 bytes and its data is monthly, so going back
   * every sweep would be seven megabytes an hour for a number that moves once a
   * month. TT01, at 891 bytes, declares none and reads every sweep.
   */
  private dueFor(entry: SeriesEntry, now: Date): boolean {
    if (!entry.fetchIntervalDays) return true;
    const last = this.lastRun.get(entry.seriesKey);
    if (!last?.readAt) return true;
    const since = (now.getTime() - Date.parse(last.readAt)) / 86_400_000;
    return since >= entry.fetchIntervalDays;
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
      if (!this.dueFor(entry, now)) {
        // Said out loud, not skipped silently: a source that was deliberately
        // not read and a source that failed must never render alike.
        const held: SeriesRunOutcome = {
          seriesKey: entry.seriesKey,
          admission: {
            admitted: false,
            reason: "no_observations",
            detail: `Read at most once every ${entry.fetchIntervalDays} days, and this process read it more recently. Nothing was fetched and nothing is claimed about where it stands.`,
            ageDays: null,
          },
          rowsRead: 0,
          observationsParsed: 0,
          refusals: {},
          written: 0,
          note: `Not due: this source is read at most once every ${entry.fetchIntervalDays} days because its unbounded payload is measured in megabytes.`,
        };
        outcomes.push(held);
        continue;
      }
      const outcome = await this.runOne(entry, reader, now);
      this.lastRun.set(entry.seriesKey, { ...outcome, readAt: now.toISOString() });
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
          // Credential provenance travels onto the row so a status page can
          // say "this environment was never given the key" without reading the
          // registry -- and so the row itself never holds the key.
          access_key_required: entry.accessKeyRequired === true,
          key_env_var: entry.keyEnvVar ?? null,
          robots_reading: entry.robotsReading ?? null,
          user_agent: entry.userAgent ?? null,
          request_budget_per_day: entry.requestBudgetPerDay ?? null,
          licence_url: entry.licenceUrl ?? null,
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
