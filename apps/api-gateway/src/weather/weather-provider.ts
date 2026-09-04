/**
 * The shape a weather issuer has to answer in, whoever it is.
 *
 * WHY AN INTERFACE FOR ONE IMPLEMENTATION
 * ---------------------------------------
 * The founder's decision on 2026-09-03 was "NWS now, behind a `WeatherProvider`
 * interface", and the reason is a licence rather than a preference. NWS
 * `api.weather.gov` is open data, free for any purpose, no key — and **United
 * States only** (<https://www.weather.gov/documentation/services-web-api>).
 * Open-Meteo is global and its keyless tier is CC-BY 4.0 and explicitly
 * non-commercial, naming subscription apps as commercial use
 * (<https://open-meteo.com/en/terms>); the commercial tier is ~$29/month
 * (<https://open-meteo.com/en/pricing>). So the day a house appears outside the
 * United States, the answer is a second class behind this interface and a
 * purchase — not a rewrite of the calendar.
 *
 * WHAT THE INTERFACE IS ALLOWED TO PROMISE
 * ----------------------------------------
 * Only transcription. No provider may compute, smooth, infer or fill. Every
 * field is either a number the issuer published or `null`, and `null` means
 * "the issuer did not publish this" — never zero, never a seasonal normal,
 * never the previous day. `issuedAt` is the issuer's own timestamp; a provider
 * that cannot supply one has to say so rather than substitute `now`, because
 * "issued four hours ago" and "issued this second" are the difference between a
 * usable reading and a fresh-looking stale one.
 */

/** One day of one issuer's forecast, as published. */
export interface WeatherDayReading {
  /** Local calendar date this row describes, `YYYY-MM-DD`. */
  businessDate: string;
  /** The window the issuer's periods for this date actually covered. */
  validFrom: string;
  validTo: string;
  /** Highest daytime temperature the issuer published; null if it published none. */
  temperatureHigh: number | null;
  /** Lowest overnight temperature the issuer published; null if none. */
  temperatureLow: number | null;
  /** The issuer's own unit. Never converted on the way in. */
  temperatureUnit: "C" | "F";
  /** Percent, 0-100, or null where the issuer published no probability. */
  precipitationProbability: number | null;
  /** Millimetres, or null. NWS's forecast periods publish no amount at all. */
  precipitationAmountMm: number | null;
  /** The issuer's own wind phrasing, verbatim. */
  windSummary: string | null;
  /** The issuer's own words for the day. */
  shortForecast: string | null;
  /** sha256 of the issuer's raw payload for this date. */
  rawHash: string;
}

/** An advisory the issuer has in force over the point. */
export interface WeatherAdvisory {
  /** The issuer's own headline, e.g. "Heat Advisory issued August 3". */
  headline: string;
  event: string;
  severity: string | null;
  onset: string | null;
  ends: string | null;
}

/**
 * One provider answer. `days` may legitimately be empty; `refusal` is the field
 * that separates "the issuer covered this point and had nothing for these dates"
 * from "we could not ask".
 */
export interface WeatherForecast {
  issuer: string;
  /** The office / grid / station that answered, when the issuer names one. */
  issuerDetail: string | null;
  /** The issuer's own generation time, ISO 8601. */
  issuedAt: string;
  days: WeatherDayReading[];
  /**
   * How far ahead this issuer publishes at all, in days. Stated so the page can
   * say "beyond the forecast" rather than drawing an empty cell that looks like
   * a failure. NWS's gridpoint forecast is seven days, not sixteen.
   */
  horizonDays: number;
  advisories: WeatherAdvisory[];
  /**
   * False when the advisory read failed on its own. A forecast that arrived
   * with an unreadable advisory feed is not the same as a point with no
   * advisories in force, and the page must not draw them the same.
   */
  advisoriesReadable: boolean;
}

/** Why a provider could not answer, in words a page can print unchanged. */
export class WeatherUnavailableError extends Error {
  constructor(
    message: string,
    /** Machine tag for the branch, for tests and logs. */
    readonly reason:
      | "outside-coverage"
      | "issuer-unreachable"
      | "issuer-refused"
      | "issuer-malformed",
  ) {
    super(message);
    this.name = "WeatherUnavailableError";
  }
}

/**
 * One day of what the weather ACTUALLY WAS, folded from an issuer's own
 * observations.
 *
 * This is the other half of ADR 0111 §2, and until 2026-09-04 the product had
 * none of it: NWS publishes forecasts, and nothing anywhere recorded what
 * happened, so a forecast's error was not computable at all and slice 3 wrote
 * `prediction_outcomes` with a NULL score for that reason. An observation is a
 * measurement somebody took at a named station, which is a different KIND of
 * fact from a forecast and is why it gets its own table rather than a `kind`
 * column on `weather_readings`.
 *
 * The same rule binds as everywhere else in this module: every field is either
 * a number the station published or `null`. Nothing is interpolated across a
 * gap in the record, and a day the station did not report is absent rather than
 * carried over from its neighbour.
 */
export interface WeatherDayObservation {
  /** Local calendar date, in the FORECAST POINT's zone. See `localDateInZone`. */
  businessDate: string;
  /** The station that measured it. */
  stationId: string;
  stationName: string | null;
  /** First and last observation actually used for this date. */
  firstObservedAt: string;
  lastObservedAt: string;
  /** How many observations backed this row. A day is not a single reading. */
  observationCount: number;
  temperatureHigh: number | null;
  temperatureLow: number | null;
  /**
   * The STATION's own unit. NWS observations publish `wmoUnit:degC` while its
   * forecasts publish Fahrenheit — measured, 2026-09-04, KPAO vs MTR/91,89 —
   * so the two sides of a comparison genuinely disagree about units and the
   * scorer has to convert and say which unit it compared in.
   */
  temperatureUnit: "C" | "F";
  /**
   * Millimetres summed over the hours that published a number, or `null` when
   * NOT ONE hour did. Measured at KPAO on 2026-09-04: all 42 observations
   * carried `precipitationLastHour.value === null`. A `0` here would report a
   * dry day at a station that simply does not report rainfall.
   */
  precipitationTotalMm: number | null;
  /** sha256 of the raw observations behind this date. */
  rawHash: string;
}

export interface WeatherObservations {
  issuer: string;
  stationId: string;
  stationName: string | null;
  /** The IANA zone the dates below are expressed in. */
  timeZone: string;
  days: WeatherDayObservation[];
}

export interface WeatherProvider {
  /** The name that travels with every reading this provider produces. */
  readonly issuer: string;

  /**
   * Ask for a forecast at one point.
   *
   * Throws `WeatherUnavailableError` — with words, not a code — when it cannot.
   * It must never return an empty forecast to mean a failure.
   */
  forecast(latitude: number, longitude: number): Promise<WeatherForecast>;

  /**
   * Ask what the weather actually WAS at one point, over a closed day range.
   *
   * Throws `WeatherUnavailableError` for the same reasons `forecast` does, plus
   * one of its own: a point inside the issuer's coverage may still have no
   * station reporting, which is `issuer-refused` with a sentence saying so —
   * never an empty day list standing in for a failure.
   */
  observations(
    latitude: number,
    longitude: number,
    from: string,
    to: string,
  ): Promise<WeatherObservations>;
}
