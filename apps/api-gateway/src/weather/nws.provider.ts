import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import {
  WeatherAdvisory,
  WeatherDayObservation,
  WeatherDayReading,
  WeatherForecast,
  WeatherObservations,
  WeatherProvider,
  WeatherUnavailableError,
} from "./weather-provider";

/**
 * The United States National Weather Service, `api.weather.gov`.
 *
 * Open data, free for any purpose, no key — the whole reason it is the first
 * issuer (<https://www.weather.gov/documentation/services-web-api>). Two things
 * their terms ask of a caller and this file honours:
 *
 *  1. **A descriptive `User-Agent`.** NWS states plainly that a generic agent
 *     may be blocked, and asks for something identifying the application and a
 *     contact. `NWS_USER_AGENT` overrides the default for a deployment that
 *     wants its own contact address on the record.
 *  2. **Cache the point lookup.** `/points/{lat},{lon}` resolves a coordinate to
 *     a forecast office and a grid square, and that mapping does not move. NWS
 *     asks callers not to re-resolve it on every request, so it is held in
 *     process for a week, keyed on the coordinate rounded to four decimals
 *     (~11 m, far finer than a 2.5 km grid cell).
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * No arithmetic beyond folding the issuer's own day/night periods onto a
 * calendar date: the high is the maximum of the periods NWS itself marked
 * daytime, the low the minimum of the ones it marked night. Nothing is
 * interpolated, nothing is filled forward, and a date NWS did not publish is
 * simply absent rather than carried over from its neighbour.
 *
 * The gridpoint forecast runs **seven days**, not the sixteen an Open-Meteo
 * response would carry. That is reported as `horizonDays` rather than hidden,
 * so a cell past the horizon can say why it is empty.
 */

const NWS_BASE = "https://api.weather.gov";
const POINTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;
/** How far down the ranked station list to walk before giving up. */
const MAX_STATION_ATTEMPTS = 4;

interface PointsResolution {
  forecastUrl: string;
  gridHandle: string | null;
  /** `properties.observationStations` — a URL to the station LIST, not an id. */
  stationsUrl: string | null;
  /** `properties.timeZone`, the zone the point's local dates are expressed in. */
  timeZone: string | null;
  resolvedAt: number;
}

interface NwsQuantity {
  value?: number | null;
  unitCode?: string;
  qualityControl?: string;
}

interface NwsObservation {
  timestamp?: string;
  stationId?: string;
  temperature?: NwsQuantity | null;
  precipitationLastHour?: NwsQuantity | null;
}

interface NwsPeriod {
  startTime?: string;
  endTime?: string;
  isDaytime?: boolean;
  temperature?: number;
  temperatureUnit?: string;
  probabilityOfPrecipitation?: { value?: number | null } | null;
  windSpeed?: string;
  shortForecast?: string;
}

@Injectable()
export class NwsWeatherProvider implements WeatherProvider {
  private readonly logger = new Logger(NwsWeatherProvider.name);

  readonly issuer = "NOAA/NWS";

  /** Coordinate → forecast endpoint. See the header on why this is cached. */
  private readonly points = new Map<string, PointsResolution>();

  private userAgent(): string {
    return (
      process.env.NWS_USER_AGENT ||
      "Mudavym/1.0 (restaurant operations; ops@mudavym.com)"
    );
  }

  private async getJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": this.userAgent(),
          // NWS's own documented media type; it pins the schema version.
          Accept: "application/geo+json",
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw new WeatherUnavailableError(
        `The weather service could not be reached (${(error as Error).message}).`,
        "issuer-unreachable",
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      // NWS answers 404 for a coordinate outside its coverage. That is a fact
      // about the point, not a fault, and it is the sentence a non-US house has
      // to be shown.
      throw new WeatherUnavailableError(
        "The National Weather Service does not cover this location — it serves " +
          "the United States only.",
        "outside-coverage",
      );
    }

    if (!response.ok) {
      throw new WeatherUnavailableError(
        `The weather service answered ${response.status}.`,
        "issuer-refused",
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new WeatherUnavailableError(
        `The weather service's answer could not be read (${(error as Error).message}).`,
        "issuer-malformed",
      );
    }
  }

  private async resolvePoint(
    latitude: number,
    longitude: number,
  ): Promise<PointsResolution> {
    const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const cached = this.points.get(key);
    if (cached && Date.now() - cached.resolvedAt < POINTS_TTL_MS) return cached;

    const body = (await this.getJson(`${NWS_BASE}/points/${key}`)) as {
      properties?: {
        forecast?: string;
        gridId?: string;
        gridX?: number;
        gridY?: number;
        observationStations?: string;
        timeZone?: string;
      };
    };

    const forecastUrl = body?.properties?.forecast;
    if (typeof forecastUrl !== "string" || !forecastUrl.startsWith("http")) {
      throw new WeatherUnavailableError(
        "The weather service resolved this location but named no forecast to read.",
        "issuer-malformed",
      );
    }

    const props = body.properties!;
    const resolution: PointsResolution = {
      forecastUrl,
      gridHandle:
        props.gridId && props.gridX != null && props.gridY != null
          ? `${props.gridId}/${props.gridX},${props.gridY}`
          : null,
      // NWS does not put a station ID on /points; it puts a URL to the ranked
      // station LIST for the grid square (measured 2026-09-04: 53 stations for
      // MTR/91,89, nearest first — KPAO, Palo Alto Airport). One more hop, and
      // it is cached with the rest of the point resolution.
      stationsUrl:
        typeof props.observationStations === "string"
          ? props.observationStations
          : null,
      timeZone: typeof props.timeZone === "string" ? props.timeZone : null,
      resolvedAt: Date.now(),
    };
    this.points.set(key, resolution);
    return resolution;
  }

  /**
   * Best effort, and it says so.
   *
   * The advisory feed failing must not take the forecast down with it, but the
   * page must also not read "no advisories" off a failed call — hence a tuple
   * rather than an empty array.
   */
  private async readAdvisories(
    latitude: number,
    longitude: number,
  ): Promise<{ advisories: WeatherAdvisory[]; readable: boolean }> {
    try {
      const body = (await this.getJson(
        `${NWS_BASE}/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`,
      )) as {
        features?: Array<{
          properties?: {
            headline?: string;
            event?: string;
            severity?: string;
            onset?: string;
            ends?: string;
          };
        }>;
      };

      const advisories = (body?.features ?? [])
        .map((feature) => feature?.properties)
        .filter((p): p is NonNullable<typeof p> => !!p && !!p.event)
        .map((p) => ({
          headline: p.headline || p.event!,
          event: p.event!,
          severity: p.severity ?? null,
          onset: p.onset ?? null,
          ends: p.ends ?? null,
        }));

      return { advisories, readable: true };
    } catch (error) {
      this.logger.warn(
        `NWS advisory read failed: ${(error as Error).message}`,
      );
      return { advisories: [], readable: false };
    }
  }

  async forecast(
    latitude: number,
    longitude: number,
  ): Promise<WeatherForecast> {
    const point = await this.resolvePoint(latitude, longitude);

    const body = (await this.getJson(point.forecastUrl)) as {
      properties?: {
        updateTime?: string;
        generatedAt?: string;
        periods?: NwsPeriod[];
      };
    };

    const props = body?.properties;
    const periods = Array.isArray(props?.periods) ? props!.periods! : null;
    if (!periods) {
      throw new WeatherUnavailableError(
        "The weather service returned a forecast with no periods in it.",
        "issuer-malformed",
      );
    }

    // The issuer's own time. `updateTime` is when the forecaster last touched
    // the grid; `generatedAt` is when this response was assembled — the two
    // differed by 35 minutes in the live 2026-09-03 read of MTR/91,89. Prefer
    // `updateTime`: it is the fact that answers "how old is this forecast",
    // where `generatedAt` would refresh to "now" on every poll and make a
    // twelve-hour-old forecast read as new.
    const issuedAt = props?.updateTime || props?.generatedAt;
    if (!issuedAt) {
      throw new WeatherUnavailableError(
        "The weather service published a forecast with no issue time, so how " +
          "old it is cannot be stated.",
        "issuer-malformed",
      );
    }

    const { advisories, readable } = await this.readAdvisories(
      latitude,
      longitude,
    );

    return {
      issuer: this.issuer,
      issuerDetail: point.gridHandle,
      issuedAt: new Date(issuedAt).toISOString(),
      days: foldPeriodsToDays(periods),
      // The gridpoint forecast covers 7 days as 14 day/night periods.
      horizonDays: 7,
      advisories,
      advisoriesReadable: readable,
    };
  }

  /**
   * What the weather actually WAS, from the nearest reporting station.
   *
   * Three hops, two of them cached with the point: `/points` names the station
   * LIST for the grid square, the list is ranked nearest-first, and the first
   * station that returns usable observations for the window is the one used.
   * Walking past a silent station matters — a grid square's nearest station can
   * be an amateur unit that reports nothing for days, and giving up on it would
   * report "no observations" for a point with a staffed airport two miles away.
   * It walks at most `MAX_STATION_ATTEMPTS`, so a dead grid costs a bounded
   * number of calls rather than 53.
   */
  async observations(
    latitude: number,
    longitude: number,
    from: string,
    to: string,
  ): Promise<WeatherObservations> {
    const point = await this.resolvePoint(latitude, longitude);

    if (!point.stationsUrl) {
      throw new WeatherUnavailableError(
        "The weather service names no observing station for this location, so " +
          "there is nothing to record what the weather actually was.",
        "issuer-refused",
      );
    }
    if (!point.timeZone) {
      // Without the point's zone an observation timestamped in UTC cannot be
      // filed under the right local day, and filing it under the wrong one
      // would score a forecast against the following morning.
      throw new WeatherUnavailableError(
        "The weather service named no time zone for this location, so an " +
          "observation cannot be placed on a calendar day.",
        "issuer-malformed",
      );
    }

    const stationsBody = (await this.getJson(point.stationsUrl)) as {
      features?: Array<{
        properties?: { stationIdentifier?: string; name?: string };
      }>;
    };
    const stations = (stationsBody?.features ?? [])
      .map((f) => f?.properties)
      .filter(
        (p): p is { stationIdentifier: string; name?: string } =>
          !!p && typeof p.stationIdentifier === "string",
      );

    if (stations.length === 0) {
      throw new WeatherUnavailableError(
        "The weather service lists no observing station for this location.",
        "issuer-refused",
      );
    }

    // The window, widened to whole UTC days so a local-evening observation on
    // the last day is inside it.
    const start = `${from}T00:00:00Z`;
    const endAt = new Date(`${to}T00:00:00Z`);
    endAt.setUTCDate(endAt.getUTCDate() + 2);

    let lastError: string | null = null;
    for (const station of stations.slice(0, MAX_STATION_ATTEMPTS)) {
      const url =
        `${NWS_BASE}/stations/${encodeURIComponent(station.stationIdentifier)}` +
        `/observations?start=${encodeURIComponent(start)}` +
        `&end=${encodeURIComponent(endAt.toISOString())}&limit=500`;
      try {
        const body = (await this.getJson(url)) as {
          features?: Array<{ properties?: NwsObservation }>;
        };
        const rows = (body?.features ?? [])
          .map((f) => f?.properties)
          .filter((o): o is NwsObservation => !!o);

        const days = foldObservationsToDays(
          rows,
          point.timeZone,
          station.stationIdentifier,
          station.name ?? null,
        );
        // A station that answered with nothing usable is not a failure of the
        // point; try the next one down the ranked list.
        if (days.length === 0) {
          lastError = `${station.stationIdentifier} reported nothing for this window`;
          continue;
        }

        return {
          issuer: this.issuer,
          stationId: station.stationIdentifier,
          stationName: station.name ?? null,
          timeZone: point.timeZone,
          days,
        };
      } catch (error) {
        if (error instanceof WeatherUnavailableError) {
          lastError = `${station.stationIdentifier}: ${error.message}`;
          continue;
        }
        throw error;
      }
    }

    throw new WeatherUnavailableError(
      "No station near this location reported the weather for these days" +
        (lastError ? ` (${lastError})` : "") + ".",
      "issuer-refused",
    );
  }
}

/**
 * An ISO instant → the calendar date it falls on **in `timeZone`**.
 *
 * Deliberately different from `localDateOf` below, and the difference is a
 * measured fact rather than a style choice: NWS stamps forecast periods with
 * the forecast point's own offset (`2026-09-03T18:00:00-07:00`), so their local
 * date can be read straight off the string. It stamps station observations in
 * **UTC** (`2026-09-04T18:47:00+00:00`, measured at KPAO), so the same trick
 * would file a 5pm Pacific reading under the following day. This resolves the
 * date in the point's own zone instead.
 */
export function localDateInZone(iso: string, timeZone: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    // `en-CA` formats as YYYY-MM-DD, which is the shape we want.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return null;
  }
}

/**
 * Whether a station's own quality-control flag says its number is usable.
 *
 * NWS marks each observed quantity: `V` validated, `C` coarse pass, `S`
 * subjectively good, `Z` preliminary/no value, `X` failed, `Q` questionable.
 * Only `X` and `Q` are rejections the issuer itself is making, so those are
 * the two dropped; anything else is taken at the issuer's word, and a null
 * value is absent regardless of flag. (All 42 observations in the recorded
 * KPAO fixture carry `V`.)
 */
export function usableQuantity(q: NwsQuantity | null | undefined): number | null {
  if (!q || typeof q.value !== "number" || !Number.isFinite(q.value)) return null;
  const flag = (q.qualityControl || "").toUpperCase();
  if (flag === "X" || flag === "Q") return null;
  return q.value;
}

/**
 * Hourly station observations → one row per calendar date.
 *
 * The only arithmetic: a max, a min, a conditional sum and a count. Nothing is
 * interpolated across a gap, and a date with no usable temperature keeps a null
 * high and low rather than borrowing its neighbour's.
 */
export function foldObservationsToDays(
  observations: NwsObservation[],
  timeZone: string,
  stationId: string,
  stationName: string | null,
): WeatherDayObservation[] {
  const byDate = new Map<
    string,
    {
      temps: number[];
      precip: number[];
      stamps: string[];
      unit: "C" | "F" | null;
      raw: unknown[];
    }
  >();

  for (const o of observations) {
    if (!o?.timestamp) continue;
    const date = localDateInZone(o.timestamp, timeZone);
    if (!date) continue;

    const entry = byDate.get(date) ?? {
      temps: [],
      precip: [],
      stamps: [],
      unit: null,
      raw: [],
    };

    const temp = usableQuantity(o.temperature);
    if (temp !== null) {
      entry.temps.push(temp);
      const code = (o.temperature?.unitCode || "").toLowerCase();
      if (code.includes("degf")) entry.unit = "F";
      else if (code.includes("degc")) entry.unit = "C";
    }

    // Summed only over the hours that actually published a number. An hour
    // reporting nothing contributes nothing — it does not contribute zero.
    const rain = usableQuantity(o.precipitationLastHour);
    if (rain !== null) entry.precip.push(rain);

    entry.stamps.push(o.timestamp);
    entry.raw.push(o);
    byDate.set(date, entry);
  }

  const out: WeatherDayObservation[] = [];
  for (const [businessDate, entry] of byDate) {
    const stamps = [...entry.stamps].sort();
    out.push({
      businessDate,
      stationId,
      stationName,
      firstObservedAt: stamps[0],
      lastObservedAt: stamps[stamps.length - 1],
      observationCount: entry.raw.length,
      temperatureHigh: entry.temps.length ? Math.max(...entry.temps) : null,
      temperatureLow: entry.temps.length ? Math.min(...entry.temps) : null,
      // NWS observations publish Celsius; the fallback is recorded rather than
      // assumed, and it is the opposite of the forecast's default for a reason.
      temperatureUnit: entry.unit ?? "C",
      // NULL when NOT ONE hour published a number — not 0. Measured at KPAO on
      // 2026-09-04: 42 of 42 observations carried a null value here.
      precipitationTotalMm: entry.precip.length
        ? Math.round(entry.precip.reduce((a, b) => a + b, 0) * 100) / 100
        : null,
      rawHash: crypto
        .createHash("sha256")
        .update(JSON.stringify(entry.raw))
        .digest("hex"),
    });
  }

  return out.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}

/**
 * `2026-08-03T06:00:00-07:00` → `2026-08-03`.
 *
 * Read off the string rather than through `Date`, because NWS already stamps
 * each period with the LOCAL offset of the forecast point, and parsing it into
 * a Date and formatting it back would re-express that local date in the
 * gateway's own zone — the same defect the iCal feed carried until today.
 */
export function localDateOf(isoWithOffset: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(isoWithOffset);
  return match ? match[1] : null;
}

/**
 * NWS's fourteen day/night periods → one row per calendar date.
 *
 * Exported for its own spec: this is the only place in the weather path where
 * anything is combined at all, so it is the only place a fabrication could hide.
 */
export function foldPeriodsToDays(periods: NwsPeriod[]): WeatherDayReading[] {
  const byDate = new Map<
    string,
    {
      highs: number[];
      lows: number[];
      pops: number[];
      unit: "C" | "F" | null;
      from: string;
      to: string;
      wind: string | null;
      words: string | null;
      raw: unknown[];
    }
  >();

  for (const period of periods) {
    if (!period?.startTime) continue;
    const date = localDateOf(period.startTime);
    if (!date) continue;

    const entry = byDate.get(date) ?? {
      highs: [],
      lows: [],
      pops: [],
      unit: null,
      from: period.startTime,
      to: period.endTime || period.startTime,
      wind: null,
      words: null,
      raw: [],
    };

    if (typeof period.temperature === "number") {
      // `isDaytime` is the ISSUER's classification, not ours. A period NWS did
      // not classify contributes to neither extreme rather than being guessed
      // into one.
      if (period.isDaytime === true) entry.highs.push(period.temperature);
      else if (period.isDaytime === false) entry.lows.push(period.temperature);
    }
    const unit = period.temperatureUnit;
    if (unit === "F" || unit === "C") entry.unit = unit;

    const pop = period.probabilityOfPrecipitation?.value;
    if (typeof pop === "number") entry.pops.push(pop);

    // The daytime period's words and wind are the ones a day cell shows; fall
    // back to whatever period came first when there is no daytime one (the
    // current day, read in the evening).
    if (period.isDaytime === true || entry.words === null) {
      entry.words = period.shortForecast ?? entry.words;
      entry.wind = period.windSpeed ?? entry.wind;
    }

    if (period.startTime < entry.from) entry.from = period.startTime;
    if ((period.endTime || period.startTime) > entry.to) {
      entry.to = period.endTime || period.startTime;
    }
    entry.raw.push(period);
    byDate.set(date, entry);
  }

  const out: WeatherDayReading[] = [];
  for (const [businessDate, entry] of byDate) {
    out.push({
      businessDate,
      validFrom: entry.from,
      validTo: entry.to,
      temperatureHigh: entry.highs.length ? Math.max(...entry.highs) : null,
      temperatureLow: entry.lows.length ? Math.min(...entry.lows) : null,
      // NWS publishes Fahrenheit for US locations. When a period carried no
      // unit at all the issuer's documented default is what stands; it is
      // recorded rather than converted.
      temperatureUnit: entry.unit ?? "F",
      // The day's chance of rain is the highest the issuer published across its
      // own periods — a max, not a mean: averaging a 0% morning with an 80%
      // evening produces 40%, a number nobody published and nobody can act on.
      precipitationProbability: entry.pops.length ? Math.max(...entry.pops) : null,
      // NWS's forecast periods carry no quantitative amount. Null, always, and
      // the column comment says why.
      precipitationAmountMm: null,
      windSummary: entry.wind,
      shortForecast: entry.words,
      rawHash: crypto
        .createHash("sha256")
        .update(JSON.stringify(entry.raw))
        .digest("hex"),
    });
  }

  return out.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}
