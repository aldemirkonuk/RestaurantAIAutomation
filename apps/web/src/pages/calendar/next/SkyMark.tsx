/**
 * The sky on a day cell, and the record under a passed one — ADR 0111 slices
 * 2 and 3, drawn from sketch 098 (`month-overlay.html`).
 *
 * THE ONE RULE THIS FILE ENFORCES
 * ------------------------------
 * DESIGN-FOUNDATION §6 forbids "weather-driven forecasting on the grid — a
 * guess on a page whose virtue is that everything is a fact". The distinction
 * that answers it, and the reason every mark here carries an issuer:
 *
 *   A published meteorological forecast, attributed to its issuer and its
 *   issue time, is a citable observation about the future. Our covers number
 *   derived from it and drawn without its error is the guess.
 *
 * So: the issuer's name and issue time are on the title of every mark, the
 * numbers are the issuer's own in the issuer's own unit, and a cell with no
 * reading prints a reason instead of nothing. A blank sky column would be
 * indistinguishable from a week of clear weather — the absence-reported-as-
 * health fault, on a grid.
 *
 * Icons are lucide (`lucide-react`, already a dependency), chosen from the
 * issuer's own `shortForecast` words and sized by the house tokens. Ink only;
 * the seal appears in the rain bar and nowhere else.
 */

import {
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Cloud,
  CloudSun,
  Sun,
  Wind,
} from 'lucide-react';
import { EM } from './cal-format';
import type { ReconciledDay, WeatherReading } from './useCalendarNextData';

/**
 * The issuer's words → a lucide icon.
 *
 * Ordered most specific first, because NWS phrases compound conditions
 * ("Mostly Sunny then Chance Light Rain") and the RAIN is the operationally
 * interesting half of that sentence. The words stay on the mark's title, so the
 * choice is always checkable against what the issuer actually said.
 */
export function skyIcon(shortForecast: string | null) {
  const words = (shortForecast ?? '').toLowerCase();
  if (/thunder|t-storm|lightning/.test(words)) return CloudLightning;
  if (/snow|flurr|sleet|ice/.test(words)) return CloudSnow;
  if (/\brain\b|shower/.test(words)) return CloudRain;
  if (/drizzle|mist/.test(words)) return CloudDrizzle;
  if (/fog|haze|smoke/.test(words)) return CloudFog;
  if (/wind|breez|gust/.test(words)) return Wind;
  if (/partly sunny|partly cloudy|mostly sunny/.test(words)) return CloudSun;
  if (/cloud|overcast/.test(words)) return Cloud;
  if (/sunny|clear|fair/.test(words)) return Sun;
  return Cloud;
}

/** A temperature, in the issuer's own unit, or an em dash. */
function degrees(value: number | null, unit: 'C' | 'F'): string {
  return value === null ? EM : `${Math.round(value)}°${unit}`;
}

/**
 * The hover line: whose forecast this is and when they made it.
 *
 * Never omitted. The attribution is not decoration — it is the entire licence
 * under which this overlay exists at all.
 */
export function attribution(reading: WeatherReading): string {
  const issued = new Date(reading.issuedAt);
  const when = Number.isNaN(issued.getTime())
    ? reading.issuedAt
    : issued.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
  const parts = [
    reading.shortForecast,
    `${reading.issuer}${reading.issuerDetail ? ` ${reading.issuerDetail}` : ''}, issued ${when}`,
  ].filter(Boolean);
  if (reading.windSummary) parts.push(`wind ${reading.windSummary}`);
  if (reading.precipitationProbability !== null) {
    parts.push(`${reading.precipitationProbability}% chance of precipitation`);
  } else {
    parts.push('no chance of precipitation published');
  }
  return parts.join(' · ');
}

/**
 * Six bars of rain chance.
 *
 * NWS's forecast periods publish a PROBABILITY and no quantitative amount at
 * all, so this is a probability bar and it says so on hover. A null probability
 * draws the flat hairline reserved for "the issuer published none" — visibly
 * different from a published 0%, which draws one filled tick.
 */
function RainBar({ probability }: { probability: number | null }) {
  if (probability === null) {
    return <span className="cn-rain" data-none="true" aria-hidden />;
  }
  const filled = Math.round((probability / 100) * 6);
  return (
    <span className="cn-rain" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <i key={i} data-on={i < filled || undefined} />
      ))}
    </span>
  );
}

export interface SkyMarkProps {
  reading: WeatherReading | null;
  /**
   * Why there is no reading, when there is none. One of the gateway's own
   * sentences, shortened for a cell; the full one is on the page's notice.
   */
  absence: string | null;
}

/** The forecast mark on a future or current day. */
export function SkyMark({ reading, absence }: SkyMarkProps) {
  if (!reading) {
    // Never an empty node. A cell that simply omits the sky reads as fair
    // weather to anyone scanning the column.
    return absence ? (
      <span className="cn-sky" data-dark="true" title={absence}>
        {EM} no reading
      </span>
    ) : null;
  }

  const Icon = skyIcon(reading.shortForecast);
  return (
    <span className="cn-sky" title={attribution(reading)}>
      <Icon size={13} aria-hidden />
      <span className="cn-sky-hi">{degrees(reading.temperatureHigh, reading.temperatureUnit)}</span>
      <span className="cn-sky-lo">{degrees(reading.temperatureLow, reading.temperatureUnit)}</span>
      <RainBar probability={reading.precipitationProbability} />
    </span>
  );
}

/**
 * What a passed day held: the ledger's record, and the forecast that stood
 * before the day began.
 *
 * The reconciliation line comes from the gateway verbatim. It deliberately
 * never says "out by N": scoring the forecast would need either an observation
 * (nothing records one) or a covers model (slice 9, withheld below ninety
 * observed service days). The pair is kept; the score is not claimed.
 */
export function DayRecordMark({ day }: { day: ReconciledDay }) {
  const record = day.recorded;
  const advance = day.forecastInAdvance;

  return (
    <span className="cn-record" title={day.line}>
      <span className="cn-record-figure">
        {record?.excluded
          ? 'closed'
          : record && record.covers !== null
            ? record.covers
            : EM}
      </span>
      <span className="cn-record-tag">
        {record?.excluded
          ? 'ruled out'
          : record && record.covers !== null
            ? 'covers · recorded'
            : 'covers not recorded'}
      </span>
      {advance && (
        <span className="cn-record-said">
          forecast said {degrees(advance.temperatureHigh, advance.temperatureUnit)}
          {advance.leadDays > 0 ? `, ${advance.leadDays}d ahead` : ', same day'}
        </span>
      )}
    </span>
  );
}
