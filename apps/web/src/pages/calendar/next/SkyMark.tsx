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
 * So: the issuer's name and issue time are on the title of every mark, and the
 * numbers are the issuer's own in the issuer's own unit.
 *
 * [OVERRULED 2026-09-22 by the founder after the preview review — "remove the
 *  'no reading' sign, leave blank". He chose blank knowing this rule. A cell
 *  with no reading now draws nothing; the reason stays on the page's sky line.
 *  The rule as it stood: "a cell with no reading prints a reason instead of
 *  nothing. A blank sky column would be indistinguishable from a week of clear
 *  weather — the absence-reported-as-health fault, on a grid."]
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
import { EM, takings, type HouseCurrency } from './cal-format';
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
}

/** The forecast mark on a future or current day; nothing when there is no reading. */
export function SkyMark({ reading }: SkyMarkProps) {
  if (!reading) return null;

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

/**
 * What a passed day TOOK, net — ADR 0287. Drawn in the day panel only.
 *
 * The founder's answers, 2026-10-04 (UTC): AW22 *"Day panel only
 * (Recommended)"*, so the month cell stays covers-only (ADR 0111 §2b) and this
 * mark lives beside `DayRecordMark` in `DayLedger` and nowhere else; and AW17
 * *"Net sales (Recommended)"*, so the figure is the sum of the checks'
 * subtotals, before tax and surcharge, and it says "net".
 *
 * Three states, none of them a zero:
 *   complete — every check carried a net figure: the amount, "net sales · recorded".
 *   partial  — some did not: the amount, "net sales · from N of M checks". The
 *              day took MORE than this, and the title says why.
 *   none     — no check carried one: the em dash, "net sales not recorded".
 *
 * It draws nothing for a day with no checks (the record mark beside it reads
 * "covers not recorded" and the line under it "Nothing was recorded on this
 * day."), and nothing when the payload carries no net figure at all: a gateway
 * from before ADR 0287 sent no such key, and "not recorded" would then be a
 * claim about a question nobody asked.
 *
 * And it draws nothing when the window says `takingsWithheld`: owners and
 * managers see the house's takings, nobody else does (ADR 0287 F1; the
 * founder, 2026-10-04 ~02:10Z: "authorized ones see everything others only
 * see actions"). The gateway already leaves the figure out; the flag is checked
 * here too, so a figure that reached this viewer anyway is still not drawn.
 */
export function TakingsMark({
  day,
  currency,
  withheld = false,
}: {
  day: ReconciledDay;
  currency: HouseCurrency | null | undefined;
  withheld?: boolean;
}) {
  if (withheld) return null;
  const record = day.recorded;
  if (!record || record.checkCount <= 0) return null;
  const { netSales, netSalesCheckCount: carried, checkCount } = record;
  if (netSales === undefined || typeof carried !== 'number') return null;

  const checks = (n: number) => `${n} check${n === 1 ? '' : 's'}`;

  if (netSales === null) {
    return (
      <span
        className="cn-record"
        data-takings="none"
        title={`None of this day's ${checks(checkCount)} came from the register with a net figure (before tax and surcharge), so the day's net sales are unknown.`}
      >
        <span className="cn-record-figure">{EM}</span>
        <span className="cn-record-tag">net sales not recorded</span>
      </span>
    );
  }

  const partial = carried < checkCount;
  return (
    <span
      className="cn-record"
      data-takings={partial ? 'partial' : 'complete'}
      title={
        partial
          ? `Net sales, before tax and surcharge, from ${carried} of this day's ${checks(checkCount)}. The other ${checks(checkCount - carried)} came from the register with no net figure, so the day took more than this.`
          : `Net sales, before tax and surcharge, from all ${checks(checkCount)} on this day.`
      }
    >
      <span className="cn-record-figure">{takings(netSales, currency)}</span>
      <span className="cn-record-tag">
        {partial ? `net sales · from ${carried} of ${checkCount} checks` : 'net sales · recorded'}
      </span>
    </span>
  );
}
