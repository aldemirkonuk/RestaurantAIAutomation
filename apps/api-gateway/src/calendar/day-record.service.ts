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
 * WHAT IS SCORED, AND WHAT IS DELIBERATELY NOT
 * --------------------------------------------
 * Nothing is scored. `accuracy_score` on every row this service writes is NULL,
 * and that is the honest value, not a gap:
 *
 *   - The weather forecast is a TEMPERATURE claim. Scoring it needs an
 *     OBSERVATION, and nothing in this product records one — NWS publishes
 *     forecasts, and the house's own thermometer is not a column anywhere in 89
 *     migrations (calendar.md §9.5).
 *   - The covers forecast, which the recorded covers WOULD score, does not
 *     exist: it is slice 9, withheld below ninety observed service days, and
 *     the best-covered tenant had twenty-two on 2026-09-03.
 *
 * So what this writes is the PAIR — the forecast that stood before the day, and
 * what the day turned out to be — with the score left open. That is precisely
 * the input slice 9 needs and cannot manufacture retroactively, because a
 * forecast nobody kept cannot be recovered later. Writing a number into
 * `accuracy_score` today would mean inventing the metric it scores.
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
  /**
   * The one sentence the cell prints under the record. It never asserts an
   * error, because nothing here is scoreable yet — see the class header.
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
): string {
  if (recorded?.excluded) {
    return recorded.exclusionReason
      ? `Closed — ${recorded.exclusionReason}. Ruled out of the baselines.`
      : "Closed. Ruled out of the baselines.";
  }
  if (!posConnected) {
    return "No sales register is connected, so this day has no record.";
  }
  if (!recorded || recorded.checkCount === 0) {
    return "Nothing was recorded on this day.";
  }
  if (recorded.covers === null) {
    return hadForecast
      ? "Covers were not recorded on this day, so the forecast beside it cannot be scored."
      : "Covers were not recorded on this day.";
  }
  return hadForecast
    ? "The forecast that stood before this day is kept beside the record; no covers model exists yet to score it against."
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

    const today = new Date().toISOString().slice(0, 10);
    const dates = [
      ...new Set([...recordedByDay.keys(), ...advanceByDay.keys()]),
    ]
      .filter((d) => d < today) // A day still running has no record to hold.
      .sort();

    const days: ReconciledDay[] = dates.map((businessDate) => {
      const record = recordedByDay.get(businessDate) ?? null;
      const advance = advanceByDay.get(businessDate) ?? null;
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
        line: reconciliationLine(record, advance !== null, ledger.posConnected),
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
    const pairable = days.filter(
      (d) =>
        d.forecastInAdvance !== null &&
        d.recorded !== null &&
        !d.recorded.excluded &&
        d.recorded.checkCount > 0,
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
          covers: d.recorded!.covers,
          sales: d.recorded!.sales,
          checkCount: d.recorded!.checkCount,
        },
        // NULL, and it stays NULL. See the class header: there is no covers
        // model to score against and no temperature observation to score with.
        accuracy_score: null,
        prediction_made_at: d.forecastInAdvance!.issuedAt,
        outcome_recorded_at: new Date().toISOString(),
        context: {
          businessDate: d.businessDate,
          note:
            "A kept pair, not a scored one. accuracy_score is NULL because no " +
            "covers model exists yet (ADR 0111 slice 9, gated on 90 observed " +
            "service days) and no temperature observation is recorded anywhere.",
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
