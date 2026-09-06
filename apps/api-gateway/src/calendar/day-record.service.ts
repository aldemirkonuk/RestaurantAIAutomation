import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { WeatherService } from "../weather/weather.service";
import { RecordedDaysService, RecordedDay } from "./recorded-days.service";

/**
 * A passed day, holding both halves — ADR 0111 slice 3.
 *
 * The grid draws the past and the future at once, so the page admits it: right
 * of today a cell holds a forecast that names its issuer, left of today it
 * holds what the ledger recorded, AND the forecast that was made before the day
 * began. Keeping both is what turns slice 2 from a decoration into evidence.
 *
 * WHAT IS SCORED — AND WHAT STILL IS NOT (updated 2026-09-04)
 * -----------------------------------------------------------
 * Until 2026-09-04 nothing here was scored, for a stated reason: the weather
 * forecast is a TEMPERATURE claim, scoring it needs an OBSERVATION, and nothing
 * in this product recorded one. That is now false — `weather_observations`
 * records what the nearest station actually measured — so the score exists, and
 * it is exactly one thing:
 *
 *   **`accuracy_score` = the absolute error of the forecast daily HIGH against
 *   the observed daily high, in degrees CELSIUS. Lower is better.**
 *
 * Three things about that sentence are load-bearing:
 *
 *   1. **It is an ERROR, not a goodness.** The column is named `accuracy_score`
 *      and carries an index (`idx_prediction_accuracy`), so anything reading it
 *      as higher-is-better would read every row backwards. The metric is
 *      therefore stated IN WORDS in every row's `context.metric`, and the raw
 *      numbers on both sides are kept in `predicted_value` / `actual_value` so
 *      the score can always be recomputed rather than trusted.
 *   2. **The unit is stated because the two sides disagree.** NWS publishes its
 *      forecast in Fahrenheit and its station observations in Celsius (measured
 *      2026-09-04: MTR/91,89 vs KPAO). Celsius is chosen as the common unit
 *      because it is the observation's own — converting the measurement would
 *      put our arithmetic on the side of the comparison that is supposed to be
 *      ground truth.
 *   3. **It is withheld whenever either side is missing**, and the two absences
 *      are distinguished: no forecast stood before the day, or no station
 *      observed it. `accuracy_score` is NULL and `context.withheld` says which.
 *
 * The COVERS forecast is still unscored and still unbuilt: it is slice 9,
 * withheld below ninety observed service days, and the best-covered tenant had
 * twenty-two on 2026-09-03. So a row can carry a weather score and still carry
 * no claim whatever about trading — which is why the recorded covers travel in
 * `actual_value` unscored.
 *
 * `prediction_outcomes` already existed (20260805000000_baseline:4252) and had
 * never been written by anything in the gateway; the only other writer is
 * `services/self-evolution/main.py`, under different `agent_name` values.
 */

/** The `agent_name` this service stamps. Its own namespace, so nothing else's rows move. */
export const CALENDAR_LEDGER_AGENT = "mudavym.calendar.day_record";
/** The `prediction_type`. Named for what it is: a pairing, not a score. */
export const PAIRING_TYPE = "weather_forecast_vs_recorded_trading";

export interface ReconciledDay {
  businessDate: string;
  /** What the ledger recorded. Null fields are unknowns, never zeros. */
  recorded: {
    covers: number | null;
    sales: number | null;
    checkCount: number;
    excluded: boolean;
    exclusionReason: string | null;
  } | null;
  /** The forecast that stood BEFORE the day began, or null if none did. */
  forecastInAdvance: {
    issuer: string;
    issuedAt: string;
    /** Whole days between the issue time and the start of the day. */
    leadDays: number;
    temperatureHigh: number | null;
    temperatureLow: number | null;
    temperatureUnit: "C" | "F";
    precipitationProbability: number | null;
    shortForecast: string | null;
  } | null;
  /** What the nearest station actually measured, or null if none did. */
  observed: {
    stationId: string;
    stationName: string | null;
    observationCount: number;
    temperatureHigh: number | null;
    temperatureLow: number | null;
    temperatureUnit: "C" | "F";
    precipitationTotalMm: number | null;
  } | null;
  /**
   * The forecast's error on this day: absolute degrees CELSIUS between the
   * forecast high and the observed high. Null when either side is missing —
   * `scoreWithheld` says which.
   */
  forecastErrorC: number | null;
  /** Why there is no score, in words. Null when there is one. */
  scoreWithheld: string | null;
  /**
   * The one sentence the cell prints under the record.
   */
  line: string;
}

export interface DayRecordWindow {
  from: string;
  to: string;
  days: ReconciledDay[];
  /** Passed through from the ledger read; false means no POS has ever landed. */
  posConnected: boolean;
  /** The ledger's refusal, when it could not be read. */
  recordedRefusal: string | null;
  /** The weather register's refusal, when it could not be read. */
  weatherRefusal: string | null;
  /** Pairs actually written to `prediction_outcomes` on this call. */
  pairsWritten: number;
}

/** Fahrenheit → Celsius. The only unit conversion in this module. */
export function toCelsius(value: number, unit: "C" | "F"): number {
  return unit === "C" ? value : ((value - 32) * 5) / 9;
}

/**
 * The forecast's error on one day, in degrees Celsius, or the reason there is
 * none.
 *
 * Celsius because it is the OBSERVATION's own unit (NWS stations publish
 * `wmoUnit:degC`); converting the measurement instead would put our arithmetic
 * on the side of the comparison that is meant to be ground truth.
 *
 * Rounded to two decimals, which is finer than either issuer publishes and so
 * loses nothing; the unrounded inputs stay in the row.
 */
export function scoreForecast(
  forecastHigh: number | null | undefined,
  forecastUnit: "C" | "F" | undefined,
  observedHigh: number | null | undefined,
  observedUnit: "C" | "F" | undefined,
): { errorC: number | null; withheld: string | null } {
  if (forecastHigh === null || forecastHigh === undefined || !forecastUnit) {
    return {
      errorC: null,
      withheld: "no forecast high stood before this day",
    };
  }
  if (observedHigh === null || observedHigh === undefined || !observedUnit) {
    return {
      errorC: null,
      withheld: "no station observed a high for this day",
    };
  }
  const error =
    Math.abs(
      toCelsius(forecastHigh, forecastUnit) - toCelsius(observedHigh, observedUnit),
    );
  return { errorC: Math.round(error * 100) / 100, withheld: null };
}

/** Whole days from an issue time to the start of a business date. */
export function leadDaysFor(issuedAt: string, businessDate: string): number {
  const dayStart = Date.parse(`${businessDate}T00:00:00Z`);
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(dayStart) || !Number.isFinite(issued)) return 0;
  return Math.max(0, Math.floor((dayStart - issued) / 86_400_000));
}

/**
 * The sentence a past cell prints.
 *
 * Every branch is a different fact, and none of them is a zero. The order
 * matters: an excluded day says so first, because a closure that reads as a
 * quiet day is the most damaging thing this grid could show.
 */
export function reconciliationLine(
  recorded: RecordedDay | null,
  hadForecast: boolean,
  posConnected: boolean,
  /** The weather forecast's error in °C, when both sides existed. */
  forecastErrorC: number | null = null,
): string {
  if (recorded?.excluded) {
    return recorded.exclusionReason
      ? `Closed — ${recorded.exclusionReason}. Ruled out of the baselines.`
      : "Closed. Ruled out of the baselines.";
  }

  // The weather half is scoreable independently of the trading half, so it is
  // said first when it exists: it is the only number on this page that is a
  // measured error rather than a record.
  const weather =
    forecastErrorC === null
      ? ""
      : forecastErrorC < 0.05
        ? " The forecast called the high exactly."
        : ` The forecast was out by ${forecastErrorC.toFixed(1)} °C on the high.`;

  if (!posConnected) {
    return `No sales register is connected, so this day has no record.${weather}`;
  }
  if (!recorded || recorded.checkCount === 0) {
    return `Nothing was recorded on this day.${weather}`;
  }
  if (recorded.covers === null) {
    return hadForecast
      ? `Covers were not recorded on this day, so nothing here scores the day's trading.${weather}`
      : `Covers were not recorded on this day.${weather}`;
  }
  return hadForecast
    ? `The forecast that stood before this day is kept beside the record; no covers model exists yet to score the trading against.${weather}`
    : "No forecast was on file before this day began.";
}

@Injectable()
export class DayRecordService {
  private readonly logger = new Logger(DayRecordService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly recorded: RecordedDaysService,
    private readonly weather: WeatherService,
  ) {}

  async windowFor(
    restaurantId: string,
    from: string,
    to: string,
  ): Promise<DayRecordWindow> {
    const [ledger, weather] = await Promise.all([
      this.recorded.windowFor(restaurantId, from, to),
      this.weather.windowFor(restaurantId, from, to),
    ]);

    const recordedByDay = new Map(ledger.days.map((d) => [d.businessDate, d]));
    const advanceByDay = new Map(
      weather.forecastInAdvance.map((r) => [r.businessDate, r]),
    );
    const observedByDay = new Map(
      weather.observations.map((r) => [r.businessDate, r]),
    );

    const today = new Date().toISOString().slice(0, 10);
    const dates = [
      ...new Set([
        ...recordedByDay.keys(),
        ...advanceByDay.keys(),
        ...observedByDay.keys(),
      ]),
    ]
      .filter((d) => d < today) // A day still running has no record to hold.
      .sort();

    const days: ReconciledDay[] = dates.map((businessDate) => {
      const record = recordedByDay.get(businessDate) ?? null;
      const advance = advanceByDay.get(businessDate) ?? null;
      const observed = observedByDay.get(businessDate) ?? null;
      const { errorC, withheld } = scoreForecast(
        advance?.temperatureHigh,
        advance?.temperatureUnit,
        observed?.temperatureHigh,
        observed?.temperatureUnit,
      );
      return {
        businessDate,
        recorded: record
          ? {
              covers: record.covers,
              sales: record.sales,
              checkCount: record.checkCount,
              excluded: record.excluded,
              exclusionReason: record.exclusionReason,
            }
          : null,
        forecastInAdvance: advance
          ? {
              issuer: advance.issuer,
              issuedAt: advance.issuedAt,
              leadDays: leadDaysFor(advance.issuedAt, businessDate),
              temperatureHigh: advance.temperatureHigh,
              temperatureLow: advance.temperatureLow,
              temperatureUnit: advance.temperatureUnit,
              precipitationProbability: advance.precipitationProbability,
              shortForecast: advance.shortForecast,
            }
          : null,
        observed: observed
          ? {
              stationId: observed.stationId,
              stationName: observed.stationName,
              observationCount: observed.observationCount,
              temperatureHigh: observed.temperatureHigh,
              temperatureLow: observed.temperatureLow,
              temperatureUnit: observed.temperatureUnit,
              precipitationTotalMm: observed.precipitationTotalMm,
            }
          : null,
        forecastErrorC: errorC,
        scoreWithheld: withheld,
        line: reconciliationLine(
          record,
          advance !== null,
          ledger.posConnected,
          errorC,
        ),
      };
    });

    return {
      from,
      to,
      days,
      posConnected: ledger.posConnected,
      recordedRefusal: ledger.refusal,
      weatherRefusal: weather.refusal,
      pairsWritten: await this.keepPairs(restaurantId, days),
    };
  }

  /**
   * Keep every day that has BOTH halves, once.
   *
   * Idempotency is a read-then-insert rather than an upsert, deliberately:
   * `prediction_outcomes` carries no unique constraint but its primary key
   * (20260805000000_baseline:7340-7344), and adding one would reach across a
   * table `services/self-evolution/main.py` also writes. A concurrent double
   * read of the same window could therefore write one pair twice; that costs a
   * duplicated row in an evidence ledger, which is recoverable, where a unique
   * index on a shared table is not.
   */
  private async keepPairs(
    restaurantId: string,
    days: ReconciledDay[],
  ): Promise<number> {
    // A day is worth keeping when a forecast stood before it AND there is
    // something to hold it against — trading, or a station's measurement, or
    // both. A day with a forecast and neither is a row that would assert
    // nothing, so it is not written.
    const pairable = days.filter(
      (d) =>
        d.forecastInAdvance !== null &&
        ((d.recorded !== null &&
          !d.recorded.excluded &&
          d.recorded.checkCount > 0) ||
          d.observed !== null),
    );
    if (pairable.length === 0) return 0;

    const client = this.databaseService.supabase;

    const { data: existing, error: readError } = await client
      .from("prediction_outcomes")
      .select("prediction_made_at, context")
      .eq("restaurant_id", restaurantId)
      .eq("agent_name", CALENDAR_LEDGER_AGENT)
      .eq("prediction_type", PAIRING_TYPE);

    if (readError) {
      // Never write blind. A failed read here would otherwise duplicate every
      // pair on every page load.
      this.logger.warn(
        `prediction_outcomes unreadable for r=${restaurantId}: ${readError.message}`,
      );
      return 0;
    }

    const already = new Set(
      (existing ?? [])
        .map((row) => {
          const context = row.context as { businessDate?: string } | null;
          return context?.businessDate;
        })
        .filter((d): d is string => typeof d === "string"),
    );

    const rows = pairable
      .filter((d) => !already.has(d.businessDate))
      .map((d) => ({
        restaurant_id: restaurantId,
        agent_name: CALENDAR_LEDGER_AGENT,
        prediction_type: PAIRING_TYPE,
        predicted_value: {
          issuer: d.forecastInAdvance!.issuer,
          leadDays: d.forecastInAdvance!.leadDays,
          temperatureHigh: d.forecastInAdvance!.temperatureHigh,
          temperatureLow: d.forecastInAdvance!.temperatureLow,
          temperatureUnit: d.forecastInAdvance!.temperatureUnit,
          precipitationProbability:
            d.forecastInAdvance!.precipitationProbability,
        },
        actual_value: {
          covers: d.recorded?.covers ?? null,
          sales: d.recorded?.sales ?? null,
          checkCount: d.recorded?.checkCount ?? 0,
          // The measurement the score is computed against, kept beside the
          // trading so the number can always be recomputed from the row.
          observedTemperatureHigh: d.observed?.temperatureHigh ?? null,
          observedTemperatureLow: d.observed?.temperatureLow ?? null,
          observedTemperatureUnit: d.observed?.temperatureUnit ?? null,
          observedPrecipitationMm: d.observed?.precipitationTotalMm ?? null,
          observationStation: d.observed?.stationId ?? null,
          observationCount: d.observed?.observationCount ?? null,
        },
        // The forecast's absolute error on the daily high, in CELSIUS. Lower is
        // better — the column's name says "score" and this is an error, which
        // is why `context.metric` states it in words on every row. NULL
        // whenever either side was missing, with `context.withheld` saying
        // which side.
        accuracy_score: d.forecastErrorC,
        prediction_made_at: d.forecastInAdvance!.issuedAt,
        outcome_recorded_at: new Date().toISOString(),
        context: {
          businessDate: d.businessDate,
          metric:
            "accuracy_score = |forecast daily high - observed daily high|, in " +
            "degrees Celsius. LOWER IS BETTER. Celsius is the observation's own " +
            "unit (NWS stations publish degC while its forecasts publish degF), " +
            "so the forecast is the side converted.",
          withheld: d.scoreWithheld,
          note:
            d.scoreWithheld === null
              ? "The weather half of this day is scored. The TRADING half is " +
                "not: no covers model exists yet (ADR 0111 slice 9, gated on 90 " +
                "observed service days), so the covers in actual_value carry no " +
                "claim and nothing here predicts them."
              : "No score: " +
                d.scoreWithheld +
                ". The pair is kept anyway, because a forecast nobody kept " +
                "cannot be recovered later.",
        },
      }));

    if (rows.length === 0) return 0;

    const { error: writeError } = await client
      .from("prediction_outcomes")
      .insert(rows);

    if (writeError) {
      this.logger.warn(
        `prediction_outcomes insert failed for r=${restaurantId}: ${writeError.message}`,
      );
      return 0;
    }
    return rows.length;
  }
}
