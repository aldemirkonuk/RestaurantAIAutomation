/**
 * Reading the index-series register: which series speak for this house, what
 * each one's newest observation says, and which of this house's items a person
 * has mapped to it.
 *
 * ONE RULE, AND IT IS THE WHOLE POINT OF THE CONTEXT LINE
 * -------------------------------------------------------
 * **This service never makes a claim.** It returns a series' latest observation
 * with its issuer, its period, its base and its unit, and — where a person has
 * asserted one — the house item that person mapped to it. It does not say the
 * house's price will rise, it does not compare the series to a vendor quote, it
 * does not convert anything, and it does not rank. The founder's call of
 * 2026-09-05 was *"both: the line now, the alert behind a flag"*, and this is
 * the line.
 *
 * The alert is `commodity-alert.service.ts` and it is dark.
 *
 * THE JURISDICTION RESOLVER IS IMPORTED, NOT REWRITTEN
 * ----------------------------------------------------
 * `normalizeJurisdiction` comes from `price-index/price-index.registry.ts` —
 * the same free-text-to-ISO reading, including the province-then-country
 * fallback that the Antalya house forced on 2026-09-05. A second normaliser
 * would mean `/price-index/me` and this endpoint could disagree about which
 * country a house is in, which is worse than either being wrong.
 *
 * A WORLD SERIES SPEAKS FOR A HOUSE WITH NO JURISDICTION AT ALL, and that is
 * deliberate: the FAO index is not scoped to anywhere, so a house whose address
 * this register cannot place still gets a real line rather than a silence about
 * a fact that does not depend on its address.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { normalizeJurisdiction } from "../price-index/price-index.registry";
import { refuseStale } from "../price-index/staleness";
import {
  SERIES,
  seriesForJurisdiction,
  type SeriesEntry,
} from "./commodity.registry";
import { COMMODITY_FETCH_FLAG, commodityFetchArmed } from "./commodity-admission";
import { derivability } from "./duty";

/**
 * The columns this service reads, named explicitly so
 * `scripts/check_read_columns_exist.py` can verify every one against
 * `supabase/migrations/`.
 */
const SERIES_COLUMNS =
  "id, series_key, issuer, issuer_jurisdiction, series_title, source_url, value_kind, unit, base_period, currency, price_basis, cadence, max_age_days, licence, attribution, redistribution, admission, rise_threshold, step_guard, threshold_window_from, threshold_window_to, threshold_window_n_obs, threshold_computed_at, armed, armed_by_label, armed_at, armed_proposal_hash, armed_note, withheld_reason, silent, measured_on";

const OBSERVATION_COLUMNS =
  "id, series_id, period_start, period_grain, value, issued_at, issued_at_basis, fetched_at, vintage, source_ref, content_hash";

const EXPOSURE_COLUMNS =
  "id, restaurant_id, house_item_id, series_id, pass_through, pass_through_basis, lag_days, lag_basis, asserted_by, asserted_at, note, retired_at";

/** One observation, as the register holds it. */
export interface SeriesObservationLine {
  periodStart: string;
  periodGrain: string;
  value: number;
  issuedAt: string;
  /** Only `issuer_stated` may ever be rendered as the word "issued". */
  issuedAtBasis: string;
  fetchedAt: string;
  vintage: string | null;
}

/** One house item a PERSON has mapped to this series. Never an inference. */
export interface ExposureLine {
  id: string;
  houseItemId: string;
  /** Null with basis `unset` is the common case and it is said out loud. */
  passThrough: number | null;
  passThroughBasis: string;
  lagDays: number | null;
  lagBasis: string;
  note: string | null;
}

/** One series, with everything the panel needs to draw its context line. */
export interface CommoditySeriesLine {
  seriesKey: string;
  issuer: string;
  issuerJurisdiction: string;
  seriesTitle: string;
  sourceUrl: string;
  valueKind: string;
  unit: string;
  basePeriod: string | null;
  currency: string | null;
  priceBasis: string | null;
  cadence: string;
  licence: string;
  attribution: string | null;
  redistribution: string;
  admission: string;
  /**
   * TRUE when this series' only route in is a person's own download and that
   * download has not happened. The parser exists and has never seen real bytes,
   * so no surface may report the series as working (the founder's Q1 answer).
   */
  awaitingHumanDownload: boolean;
  /** A rate's instrument, in the issuer's own citation. Null for anything else. */
  statute: string | null;
  /** The date the issuer says a rate is in force from. */
  effectiveFrom: string | null;
  /**
   * For a rate: whether a per-bottle duty line can EVER be derived from it, and
   * the sentence saying why or why not. "This product cannot yet show you a
   * duty for your bottle" and "this publisher does not say what its number is
   * per" are different facts, and only the first is fixable by typing something.
   */
  duty: { supported: boolean; sentence: string } | null;
  /** Armed for ALERTING. Never for fetching, which only a flag can arm. */
  armed: boolean;
  /** Who armed it, when, and on which numbers. Null on an unarmed series. */
  armedBy: { label: string; at: string; proposalHash: string } | null;
  /** Unreadable versus read-but-unusable, kept apart as the registry keeps them. */
  withheld: { reason: string; measuredOn: string } | null;
  silent: { reason: string; measuredOn: string } | null;
  /**
   * The newest observation, or null. Null is NOT "the series is flat": it means
   * this register holds no observation for it, and `note` says which.
   */
  latest: SeriesObservationLine | null;
  /** Whether the newest observation is inside the series' cadence bound. */
  stale: boolean | null;
  staleReason: string | null;
  observationCount: number | null;
  exposures: ExposureLine[];
  /** The endpoint's own words when there is nothing to draw. Never a zero. */
  note: string | null;
}

export interface HouseCommodityResult {
  requested: string | null;
  jurisdiction: string | null;
  series: CommoditySeriesLine[];
  /** Whether a scheduled reader is armed at all. Off by default and by design. */
  fetchArmed: boolean;
  /** The endpoint's own sentence for a silent register. Never paraphrased. */
  silence: string | null;
  /**
   * True when the house has no exposure mapped to ANY series. The panel shows
   * the series list and a sentence, rather than pretending the mapping exists.
   */
  noExposureRecorded: boolean;
}

@Injectable()
export class CommodityService {
  private readonly logger = new Logger(CommodityService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * The series register for the CALLER's own house.
   *
   * Province first, then country. Both are free text on `restaurants`
   * (`'CA'` / `'California'` / `'Muğla'` / `'Türkiye'`), and reading only the
   * province was measured wrong on this estate: the Antalya house records no
   * province and country `'Türkiye'`.
   */
  async forHouse(restaurantId: string | null): Promise<HouseCommodityResult> {
    const fetchArmed = commodityFetchArmed(process.env[COMMODITY_FETCH_FLAG]);
    let requested: string | null = null;
    let jurisdiction: string | null = null;

    if (restaurantId) {
      let rawState: string | null = null;
      let rawCountry: string | null = null;
      try {
        const { data, error } = await this.db.client
          .from("restaurants")
          .select("state_province, country")
          .eq("id", restaurantId)
          .single();
        if (error) throw error;
        const row = data as {
          state_province: string | null;
          country: string | null;
        } | null;
        rawState = row?.state_province ?? null;
        rawCountry = row?.country ?? null;
      } catch (err) {
        // A read that failed is NOT a house with no address. Both leave
        // `jurisdiction` null, so the reason is logged and the WORLD series
        // still answers, which it can do without knowing where the house is.
        this.logger.warn(
          `could not read this house's jurisdiction for the commodity register: ${(err as Error).message}`,
        );
      }
      requested = rawState?.trim() || rawCountry?.trim() || null;
      jurisdiction =
        (rawState && normalizeJurisdiction(rawState)) ||
        (rawCountry && normalizeJurisdiction(rawCountry)) ||
        null;
    }

    const entries = seriesForJurisdiction(jurisdiction);
    const lines: CommoditySeriesLine[] = [];
    let anyExposure = false;

    for (const entry of entries) {
      const line = await this.lineFor(entry, restaurantId);
      if (line.exposures.length > 0) anyExposure = true;
      lines.push(line);
    }

    return {
      requested,
      jurisdiction,
      series: lines,
      fetchArmed,
      silence:
        lines.length === 0
          ? "No index series in this register speaks for this house's jurisdiction, and none speaks for everywhere either. That is a register with nothing in it for you, not a market that is quiet."
          : null,
      noExposureRecorded: !anyExposure,
    };
  }

  /** One series' line: the registry's facts, plus whatever the register holds. */
  private async lineFor(
    entry: SeriesEntry,
    restaurantId: string | null,
  ): Promise<CommoditySeriesLine> {
    const base: CommoditySeriesLine = {
      seriesKey: entry.seriesKey,
      issuer: entry.issuer,
      issuerJurisdiction: entry.issuerJurisdiction,
      seriesTitle: entry.seriesTitle,
      sourceUrl: entry.sourceUrl,
      valueKind: entry.valueKind,
      unit: entry.unit,
      basePeriod: entry.basePeriod,
      currency: entry.currency,
      priceBasis: entry.priceBasis,
      cadence: entry.cadence,
      licence: entry.licence,
      attribution: entry.attribution,
      redistribution: entry.redistribution,
      admission: entry.admission,
      awaitingHumanDownload: entry.awaitingHumanDownload === true,
      statute: entry.statute ?? null,
      effectiveFrom: entry.effectiveFrom ?? null,
      duty:
        entry.valueKind === "rate"
          ? derivability({
              valueKind: entry.valueKind,
              denominator: entry.dutyDenominator ?? "unstated",
              issuer: entry.issuer,
            })
          : null,
      armed: false,
      armedBy: null,
      withheld: entry.withheld,
      silent: entry.silent,
      latest: null,
      stale: null,
      staleReason: null,
      observationCount: null,
      exposures: [],
      note: null,
    };

    let seriesId: string | null = null;
    try {
      const { data, error } = await this.db.client
        .from("commodity_index_series")
        .select(SERIES_COLUMNS)
        .eq("series_key", entry.seriesKey)
        .maybeSingle();
      if (error) throw error;
      const row = data as Record<string, unknown> | null;
      if (row) {
        seriesId = String(row.id);
        base.armed = row.armed === true;
        // Read together or not at all: the CHECK on the table says an armed
        // series names all three, so a partial read here would be a row that
        // cannot exist.
        base.armedBy =
          row.armed === true &&
          typeof row.armed_by_label === "string" &&
          typeof row.armed_at === "string" &&
          typeof row.armed_proposal_hash === "string"
            ? {
                label: row.armed_by_label,
                at: row.armed_at,
                proposalHash: row.armed_proposal_hash,
              }
            : null;
      }
    } catch (err) {
      // supabase-js resolves `{ data, error }` and never throws on a refused
      // read, so this branch is the ERROR being rethrown above. A failed read
      // is never reported as an empty one.
      this.logger.warn(
        `commodity_index_series read failed for ${entry.seriesKey}: ${(err as Error).message}`,
      );
      base.note =
        "The index-series register could not be read. This series is unknown, not absent.";
      return base;
    }

    if (!seriesId) {
      base.note = entry.awaitingHumanDownload
        ? `This series is registered and waits for a person's own download. ${entry.withheld?.reason ?? ""} Nothing here fetches it, and nothing may report it as working until the file lands.`.trim()
        : entry.withheld
          ? `This series is registered and is not fetched: ${entry.withheld.reason}`
          : "This series is registered and this register holds no observation of it yet. Nothing is claimed about where it stands.";
      return base;
    }

    try {
      const { data, error } = await this.db.client
        .from("commodity_index_observations")
        .select(OBSERVATION_COLUMNS)
        .eq("series_id", seriesId)
        .order("period_start", { ascending: false })
        .order("fetched_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] as Record<string, unknown> | undefined;
      if (row) {
        base.latest = {
          periodStart: String(row.period_start).slice(0, 10),
          periodGrain: String(row.period_grain),
          value: Number(row.value),
          issuedAt: String(row.issued_at),
          issuedAtBasis: String(row.issued_at_basis),
          fetchedAt: String(row.fetched_at),
          vintage: row.vintage === null ? null : String(row.vintage),
        };
        // Aged from the OBSERVATION'S OWN PERIOD, never from the HTTP status
        // and never from the issuer's release date: four ONS series return 200
        // with a fresh releaseDate and a last observation of 2025 JAN.
        const verdict = refuseStale(
          base.latest.periodStart,
          entry.maxAgeDays,
          new Date(),
        );
        base.stale = verdict.stale;
        base.staleReason = verdict.reason;
      }
    } catch (err) {
      this.logger.warn(
        `commodity_index_observations read failed for ${entry.seriesKey}: ${(err as Error).message}`,
      );
      base.note =
        "This series' observations could not be read. Where it stands is unknown, not unchanged.";
      return base;
    }

    try {
      const { count, error } = await this.db.client
        .from("commodity_index_observations")
        .select("id", { count: "exact", head: true })
        .eq("series_id", seriesId);
      if (error) throw error;
      base.observationCount = typeof count === "number" ? count : null;
    } catch (err) {
      // Null, not zero. `observationCount === null` renders as "not counted".
      this.logger.warn(
        `commodity_index_observations count failed for ${entry.seriesKey}: ${(err as Error).message}`,
      );
      base.observationCount = null;
    }

    if (restaurantId) {
      try {
        const { data, error } = await this.db.client
          .from("house_item_commodity_exposure")
          .select(EXPOSURE_COLUMNS)
          .eq("restaurant_id", restaurantId)
          .eq("series_id", seriesId)
          .is("retired_at", null);
        if (error) throw error;
        base.exposures = (data ?? []).map((r) => {
          const row = r as Record<string, unknown>;
          return {
            id: String(row.id),
            houseItemId: String(row.house_item_id),
            passThrough:
              row.pass_through === null ? null : Number(row.pass_through),
            passThroughBasis: String(row.pass_through_basis),
            lagDays: row.lag_days === null ? null : Number(row.lag_days),
            lagBasis: String(row.lag_basis),
            note: row.note === null ? null : String(row.note),
          };
        });
      } catch (err) {
        this.logger.warn(
          `house_item_commodity_exposure read failed for ${entry.seriesKey}: ${(err as Error).message}`,
        );
        base.note =
          "This house's mapping to this series could not be read. Whether one exists is unknown, not \"none\".";
      }
    }

    if (!base.latest && !base.note) {
      base.note =
        "This register holds no observation of this series yet. Nothing is claimed about where it stands.";
    }
    return base;
  }

  /** Every registered series, with no house scoping. For the status route. */
  status(): {
    fetchArmed: boolean;
    flag: string;
    series: Array<{
      seriesKey: string;
      issuer: string;
      admission: string;
      redistribution: string;
      cadence: string;
      maxAgeDays: number;
      withheld: { reason: string; measuredOn: string } | null;
    }>;
  } {
    return {
      fetchArmed: commodityFetchArmed(process.env[COMMODITY_FETCH_FLAG]),
      flag: COMMODITY_FETCH_FLAG,
      series: Object.values(SERIES).map((s) => ({
        seriesKey: s.seriesKey,
        issuer: s.issuer,
        admission: s.admission,
        redistribution: s.redistribution,
        cadence: s.cadence,
        maxAgeDays: s.maxAgeDays,
        withheld: s.withheld,
      })),
    };
  }
}
