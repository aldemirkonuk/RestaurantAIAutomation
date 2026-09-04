import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { NwsWeatherProvider } from "./nws.provider";
import {
  WeatherAdvisory,
  WeatherProvider,
  WeatherUnavailableError,
} from "./weather-provider";

/**
 * The weather overlay's one service: read the house's coordinate, keep the
 * issuer's forecast, and answer the calendar grid.
 *
 * REFRESH POLICY — ON READ, WITH A MAX AGE. WHY NOT A CRON.
 * ---------------------------------------------------------
 * ADR 0111 §6 sketched slice 2 as refreshing under
 * `ScheduledTenantsService.runPerTenant` (ADR 0022). That is wrong for this
 * signal and the measurement says so: `runPerTenant` enumerates only tenants
 * carrying `restaurant_feature_flags.flag_name = 'scheduled_communications'` or
 * matching `DEFAULT_RESTAURANT_ID` (communications/scheduled-tenants.service.ts:88-125),
 * and production has one such tenant out of fourteen. A cron behind that gate
 * would leave thirteen houses with a permanently blank weather column and no
 * sentence explaining it — the absence-reported-as-health fault, delivered by
 * the very mechanism meant to prevent it.
 *
 * So the refresh happens on read: if the newest stored issuance for this house
 * is older than `MAX_AGE_MS`, ask the issuer once, keep what comes back, and
 * answer. Three consequences, all stated on the response:
 *
 *  - It costs one issuer call per house per hour of ACTUAL USE, which is
 *    strictly fewer than a cron would make.
 *  - The first read after an hour pays the issuer's latency. The provider has
 *    an 8 s timeout, and a failure never blanks the grid: the stored readings
 *    are returned with their age and `staleReason` says what went wrong.
 *  - A house nobody opens accumulates no history. That matters for slice 9's
 *    ninety-day floor and is recorded in the page note rather than papered over;
 *    a scheduled prefetch is the right answer once the ADR 0022 opt-in question
 *    is settled for reads as well as sends.
 *
 * NOTHING IS EVER COMPUTED HERE. The service selects, upserts and reports. The
 * only arithmetic is `Date.now() - fetchedAt`, which is an age.
 */

/** One hour: NWS updates its gridpoint forecast about hourly. */
const MAX_AGE_MS = 60 * 60 * 1000;

export interface WeatherReadingRow {
  businessDate: string;
  issuer: string;
  issuerDetail: string | null;
  issuedAt: string;
  fetchedAt: string;
  validFrom: string;
  validTo: string;
  temperatureHigh: number | null;
  temperatureLow: number | null;
  temperatureUnit: "C" | "F";
  precipitationProbability: number | null;
  precipitationAmountMm: number | null;
  windSummary: string | null;
  shortForecast: string | null;
}

export interface WeatherWindow {
  from: string;
  to: string;
  /** The point the readings were asked for; null when the house has none. */
  coordinate: { latitude: number; longitude: number } | null;
  /**
   * The newest issuance per day in the window. Empty is a real answer and must
   * be read together with `refusal` / `staleReason`, never on its own.
   */
  readings: WeatherReadingRow[];
  /**
   * What was forecast IN ADVANCE for each past day in the window — the earliest
   * issuance made before that day began. This is the half of the reconciliation
   * line that a cache would have destroyed.
   */
  forecastInAdvance: WeatherReadingRow[];
  /**
   * The whole overlay is dark, and this sentence says why. Rendered verbatim.
   * Null when readings are available.
   */
  refusal: string | null;
  /** Machine tag for `refusal`, for tests and for the page's branch. */
  refusalReason:
    | "no-coordinate"
    | "outside-coverage"
    | "issuer-unreachable"
    | "issuer-refused"
    | "issuer-malformed"
    | "store-unreadable"
    | null;
  /**
   * Set when the readings below are older than the max age because the refresh
   * failed. The readings are still real and still shown; this says how old.
   */
  staleReason: string | null;
  /** Age of the newest reading in minutes, or null when there are none. */
  ageMinutes: number | null;
  issuer: string;
  /** How far ahead this issuer publishes; a cell past it says so. */
  horizonDays: number | null;
  advisories: WeatherAdvisory[];
  advisoriesReadable: boolean;
}

interface DbRow {
  business_date: string;
  issuer: string;
  issuer_detail: string | null;
  issued_at: string;
  fetched_at: string;
  valid_from: string;
  valid_to: string;
  temperature_high: string | number | null;
  temperature_low: string | number | null;
  temperature_unit: string;
  precipitation_probability: number | null;
  precipitation_amount_mm: string | number | null;
  wind_summary: string | null;
  short_forecast: string | null;
}

function num(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toReading(row: DbRow): WeatherReadingRow {
  return {
    businessDate: String(row.business_date).slice(0, 10),
    issuer: row.issuer,
    issuerDetail: row.issuer_detail,
    issuedAt: row.issued_at,
    fetchedAt: row.fetched_at,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    temperatureHigh: num(row.temperature_high),
    temperatureLow: num(row.temperature_low),
    temperatureUnit: row.temperature_unit === "C" ? "C" : "F",
    precipitationProbability: row.precipitation_probability,
    precipitationAmountMm: num(row.precipitation_amount_mm),
    windSummary: row.wind_summary,
    shortForecast: row.short_forecast,
  };
}

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly provider: NwsWeatherProvider,
  ) {}

  /** The issuer currently configured. One today; the interface admits more. */
  private get issuerName(): string {
    return (this.provider as WeatherProvider).issuer;
  }

  private empty(
    from: string,
    to: string,
    refusal: string,
    reason: NonNullable<WeatherWindow["refusalReason"]>,
    coordinate: { latitude: number; longitude: number } | null = null,
  ): WeatherWindow {
    return {
      from,
      to,
      coordinate,
      readings: [],
      forecastInAdvance: [],
      refusal,
      refusalReason: reason,
      staleReason: null,
      ageMinutes: null,
      issuer: this.issuerName,
      horizonDays: null,
      advisories: [],
      advisoriesReadable: false,
    };
  }

  async windowFor(
    restaurantId: string,
    from: string,
    to: string,
  ): Promise<WeatherWindow> {
    const client = this.databaseService.supabase;

    const { data: restaurant, error: restaurantError } = await client
      .from("restaurants")
      .select("id, name, latitude, longitude")
      .eq("id", restaurantId)
      .single();

    if (restaurantError || !restaurant) {
      return this.empty(
        from,
        to,
        "This restaurant's record could not be read, so there is no location to " +
          "ask about.",
        "store-unreadable",
      );
    }

    const latitude = num(restaurant.latitude as never);
    const longitude = num(restaurant.longitude as never);
    if (latitude === null || longitude === null) {
      // The state all fourteen production rows were in on 2026-09-03. It is a
      // sentence with an action in it, never a blank column.
      return this.empty(
        from,
        to,
        "No location is set for this house, so no forecast can be read. Set the " +
          "address on Settings and the coordinate is captured with it.",
        "no-coordinate",
      );
    }

    const coordinate = { latitude, longitude };

    const stored = await this.readStored(restaurantId, from, to);
    if (stored === null) {
      return this.empty(
        from,
        to,
        "The weather register could not be read.",
        "store-unreadable",
        coordinate,
      );
    }

    const newest = stored.reduce<string | null>(
      (acc, row) => (acc === null || row.fetched_at > acc ? row.fetched_at : acc),
      null,
    );
    const ageMs = newest ? Date.now() - new Date(newest).getTime() : null;
    const fresh = ageMs !== null && ageMs < MAX_AGE_MS;

    let staleReason: string | null = null;
    let horizonDays: number | null = null;
    let advisories: WeatherAdvisory[] = [];
    let advisoriesReadable = false;
    let rows = stored;

    if (!fresh) {
      try {
        const forecast = await this.provider.forecast(latitude, longitude);
        horizonDays = forecast.horizonDays;
        advisories = forecast.advisories;
        advisoriesReadable = forecast.advisoriesReadable;
        await this.keep(restaurantId, coordinate, forecast);
        const refreshed = await this.readStored(restaurantId, from, to);
        if (refreshed !== null) rows = refreshed;
      } catch (error) {
        if (error instanceof WeatherUnavailableError) {
          if (rows.length === 0) {
            return this.empty(from, to, error.message, error.reason, coordinate);
          }
          // There are real readings; they are just old. Say how old rather than
          // discarding them, and never imply they are current.
          staleReason = error.message;
        } else {
          this.logger.error(
            `Weather refresh failed for r=${restaurantId}: ${(error as Error).message}`,
          );
          if (rows.length === 0) {
            return this.empty(
              from,
              to,
              "The forecast could not be read.",
              "issuer-unreachable",
              coordinate,
            );
          }
          staleReason = "The forecast could not be refreshed.";
        }
      }
    }

    const newestAfter = rows.reduce<string | null>(
      (acc, row) => (acc === null || row.fetched_at > acc ? row.fetched_at : acc),
      null,
    );

    return {
      from,
      to,
      coordinate,
      readings: newestPerDay(rows).map(toReading),
      forecastInAdvance: earliestPriorIssuancePerDay(rows).map(toReading),
      refusal: null,
      refusalReason: null,
      staleReason,
      ageMinutes: newestAfter
        ? Math.max(
            0,
            Math.round((Date.now() - new Date(newestAfter).getTime()) / 60000),
          )
        : null,
      issuer: this.issuerName,
      horizonDays,
      advisories,
      advisoriesReadable,
    };
  }

  /** Every issuance in the window, or null when the register is unreadable. */
  private async readStored(
    restaurantId: string,
    from: string,
    to: string,
  ): Promise<DbRow[] | null> {
    const { data, error } = await this.databaseService.supabase
      .from("weather_readings")
      .select(
        "business_date, issuer, issuer_detail, issued_at, fetched_at, " +
          "valid_from, valid_to, temperature_high, temperature_low, " +
          "temperature_unit, precipitation_probability, " +
          "precipitation_amount_mm, wind_summary, short_forecast",
      )
      .eq("restaurant_id", restaurantId)
      .gte("business_date", from)
      .lte("business_date", to)
      .order("business_date", { ascending: true })
      .order("issued_at", { ascending: true });

    if (error) {
      // Null, never []. An unreadable register and an empty one are different
      // answers and the caller has to be able to tell them apart.
      this.logger.warn(
        `weather_readings unreadable for r=${restaurantId}: ${error.message}`,
      );
      return null;
    }
    return (data ?? []) as unknown as DbRow[];
  }

  /**
   * Keep every day of one issuance.
   *
   * Upsert on `(restaurant_id, business_date, issued_at)`: re-reading the same
   * issuance is a no-op, and a NEW issuance is a new row beside the old one.
   * That accumulation is the point — see the migration header.
   */
  private async keep(
    restaurantId: string,
    coordinate: { latitude: number; longitude: number },
    forecast: Awaited<ReturnType<WeatherProvider["forecast"]>>,
  ): Promise<void> {
    if (forecast.days.length === 0) return;

    const payload = forecast.days.map((day) => ({
      restaurant_id: restaurantId,
      issuer: forecast.issuer,
      issuer_detail: forecast.issuerDetail,
      issued_at: forecast.issuedAt,
      fetched_at: new Date().toISOString(),
      valid_from: day.validFrom,
      valid_to: day.validTo,
      business_date: day.businessDate,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      temperature_high: day.temperatureHigh,
      temperature_low: day.temperatureLow,
      temperature_unit: day.temperatureUnit,
      precipitation_probability: day.precipitationProbability,
      precipitation_amount_mm: day.precipitationAmountMm,
      wind_summary: day.windSummary,
      short_forecast: day.shortForecast,
      raw_hash: day.rawHash,
    }));

    const { error } = await this.databaseService.supabase
      .from("weather_readings")
      .upsert(payload, {
        onConflict: "restaurant_id,business_date,issued_at",
      });

    if (error) {
      // A failed keep must not fail the read: the operator still gets the
      // forecast. It is logged loudly because a persistent failure here is
      // silently the end of slice 3's evidence.
      this.logger.error(
        `weather_readings upsert failed for r=${restaurantId}: ${error.message}`,
      );
    }
  }
}

/**
 * The newest issuance for each day. Rows arrive ordered by `issued_at` ascending,
 * so the last one wins.
 */
export function newestPerDay(rows: DbRow[]): DbRow[] {
  const latest = new Map<string, DbRow>();
  for (const row of rows) latest.set(String(row.business_date), row);
  return [...latest.values()].sort((a, b) =>
    String(a.business_date).localeCompare(String(b.business_date)),
  );
}

/**
 * What was forecast for each day BEFORE that day began.
 *
 * The earliest issuance whose `issued_at` precedes the day's own date. A day
 * whose only issuance was made during or after it has no advance forecast at
 * all, and is absent here rather than falling back to the same-day reading —
 * scoring a forecast against itself would manufacture perfect accuracy.
 */
export function earliestPriorIssuancePerDay(rows: DbRow[]): DbRow[] {
  const earliest = new Map<string, DbRow>();
  for (const row of rows) {
    const date = String(row.business_date).slice(0, 10);
    // Midnight UTC of the business date is a deliberate approximation of "before
    // the day began": the exact local boundary needs the restaurant's zone, and
    // erring towards UTC midnight can only make an advance forecast look LESS
    // advance, never more.
    if (new Date(row.issued_at).getTime() >= Date.parse(`${date}T00:00:00Z`)) {
      continue;
    }
    if (!earliest.has(date)) earliest.set(date, row);
  }
  return [...earliest.values()].sort((a, b) =>
    String(a.business_date).localeCompare(String(b.business_date)),
  );
}
