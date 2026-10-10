/**
 * WineOps Insight Verbalizer — deterministic sentence rendering
 * =============================================================
 *
 * Turns computed insight evidence into the 1–2 sentence plain-language
 * conclusions the mobile/web boxes show ("This Tuesday's sales were 12%
 * lower than your average Tuesday"). 100% template-based: every number in a
 * sentence comes straight from the math, so insights are auditable and free
 * to render. The LLM consultant layer builds ON TOP of these — it never
 * replaces them.
 */

import { houseMoney, usableLocale } from "../../common/house-money";

export interface InsightEvidence {
  /** Entity display name (e.g. "Table 4", "Tuesday", "Caymus Cab"). */
  entity?: string;
  /** Measure display label ("sales", "average check"). */
  measureLabel: string;
  unit: "currency" | "count" | "percent" | "ratio" | "units";
  /**
   * The house's own currency code (`restaurants.currency`) for a `currency`
   * figure; null or absent prints the figure with no symbol, never as
   * dollars (F-341, ADR 0117 Q25).
   */
  currency?: string | null;
  /**
   * The house's formats tag (`houseFrame().locale`) for that figure's
   * grouping and decimal mark; null or absent keeps en-US (F-866).
   */
  locale?: string | null;
  value?: number;
  baseline?: number;
  deltaPct?: number | null;
  z?: number | null;
  direction?: "above" | "below" | "in_line" | "up" | "down" | "flat";
  rank?: number;
  peerCount?: number;
  windowLabel?: string; // "week", "30 days"
  /** Days open in both windows, when fewer than the window (F-707). */
  openDays?: number;
  trendPctPerWeek?: number;
  /** Calendar days a trend spans; `n` is how many of them were open (F-708). */
  spanDays?: number;
  date?: string;
  topShare?: number;
  topCount?: number;
  hhi?: number;
  r?: number;
  attribute?: string;
  attributeReading?: string;
  drivers?: Array<{ attribute: string; weight: number }>;
  pairA?: string;
  pairB?: string;
  lift?: number;
  forecastGapPct?: number;
  goalName?: string;
  goalProgressPct?: number;
  goalDaysLeft?: number;
  goalOnTrack?: boolean;
  surgeMinutes?: number;
  n?: number;
}

/**
 * `v` to exactly `digits` decimals with the house's decimal mark — "1,8σ" and
 * "r=0,62" in a lira house, as its money already reads (F-1058). Same digits as
 * `toFixed`, and no grouping, so only the mark changes.
 */
const fmtFixed = (v: number, digits: number, locale?: string | null) =>
  new Intl.NumberFormat(usableLocale(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(v);

const fmtNum = (v: number, locale?: string | null) =>
  Math.abs(v) >= 100
    ? fmtFixed(v, 0, locale)
    : Math.abs(v) >= 10
      ? fmtFixed(v, 1, locale)
      : fmtFixed(v, 2, locale);

export function fmtValue(
  v: number,
  unit: InsightEvidence["unit"],
  currency?: string | null,
  locale?: string | null,
): string {
  switch (unit) {
    case "currency":
      return houseMoney(v, currency, { compact: true, locale });
    case "percent":
      return `${fmtFixed(v * 100, 1, locale)}%`;
    default:
      return fmtNum(v, locale);
  }
}

export const fmtPct = (p: number) => `${Math.abs(p * 100).toFixed(0)}%`;

/**
 * Floor-geometry gloss appended to the top-table peer sentence.
 *
 * `r` is the correlation between a table attribute and average check, so its
 * SIGN alone decides the reading: r > 0 means more of the attribute goes with a
 * HIGHER check. The version this replaces (inline in the generator) paired the
 * direction word with an inverted verb — r = +0.90 on seat count rendered as
 * "farther-to-seat count tables average lower checks" — and ran
 * `.replace("distance to ", "")` over "seat count", which is not a distance at
 * all. Both defects surfaced together the first time real POS checks reached
 * the generator: the same run emitted this sentence and the `correlation`
 * template below, which read the identical r as "goes with higher average
 * check". Two contradictory sentences from one number.
 */
export function tableAttributeReading(
  attribute: string,
  r: number,
  locale?: string | null,
): string {
  const DIST = "distance to ";
  const higher = r > 0 ? "higher" : "lower";
  const phrase = attribute.startsWith(DIST)
    ? `tables farther from the ${attribute.slice(DIST.length)}`
    : `tables with more ${attribute === "seat count" ? "seats" : attribute}`;
  return `Across your floor, ${phrase} average ${higher} checks (r=${fmtFixed(r, 2, locale)}).`;
}

/** Render an insight sentence for a template family. Returns null if the
 * evidence is insufficient for that family (caller should skip). */
export function verbalize(template: string, e: InsightEvidence): string | null {
  const entity = e.entity ?? "Overall";
  switch (template) {
    case "baseline": {
      // `deltaPct == null` is the divide-by-a-zero-baseline case: a ratio
      // against nothing is not a percentage, and there is no honest sentence
      // to render from it. Returning null here is the second of two guards —
      // `groupBaseline` reports the same case as `in_line` and the generator
      // drops it — and it is asserted directly in `baseline-honesty.spec.ts`.
      if (e.deltaPct == null || e.baseline == null || e.value == null)
        return null;
      if (e.direction === "in_line")
        return `${entity} ${e.measureLabel} (${fmtValue(e.value, e.unit, e.currency, e.locale)}) is in line with the typical ${entity.toLowerCase()}.`;
      const dir = e.deltaPct > 0 ? "higher" : "lower";
      // `date` on a baseline means the day compared was NOT the newest day in
      // the series — the generator skipped back past days with no records. The
      // sentence has to carry that date, or "Wednesday" reads as yesterday.
      const when = e.date ? `${entity} ${e.date} ` : `${entity} `;
      // The support count travels with the claim. "12% lower than your average
      // Wednesday" is a different statement over four Wednesdays than over
      // three, and the reader is entitled to know which one they are reading.
      const support = e.n ? `, over ${e.n} past ${entity}s` : "";
      return `${when}${e.measureLabel} came in ${fmtPct(e.deltaPct)} ${dir} than your average ${entity} (${fmtValue(e.value, e.unit, e.currency, e.locale)} vs ${fmtValue(e.baseline, e.unit, e.currency, e.locale)}${support}).`;
    }
    case "period": {
      if (e.deltaPct == null || e.value == null || e.baseline == null)
        return null;
      const verb =
        e.deltaPct > 0 ? "rose" : e.deltaPct < 0 ? "fell" : "held flat";
      const prefix = e.entity ? `${e.entity} ` : "";
      // A comparison that left closed days out says so, or its two totals
      // read as whole weeks (F-707).
      const like = e.openDays
        ? `, counting only the ${e.openDays} days open in both`
        : "";
      return `${prefix}${e.measureLabel} ${verb} ${fmtPct(e.deltaPct)} vs the previous ${e.windowLabel ?? "period"}${like} (${fmtValue(e.value, e.unit, e.currency, e.locale)} vs ${fmtValue(e.baseline, e.unit, e.currency, e.locale)}).`;
    }
    case "trend": {
      if (e.trendPctPerWeek == null) return null;
      const dir = e.trendPctPerWeek > 0 ? "climbing" : "sliding";
      const prefix = e.entity ? `${e.entity} ` : "";
      // `n` counts open days; when the house closed some, the sentence names
      // both the open days and the calendar span they sit in (F-708).
      const over = !e.n
        ? ""
        : e.spanDays && e.n < e.spanDays
          ? ` over the ${e.n} open days in the last ${e.spanDays}`
          : ` over the last ${e.n} days`;
      return `${prefix}${e.measureLabel} has been ${dir} about ${fmtPct(e.trendPctPerWeek)} per week${over}.`;
    }
    case "anomaly": {
      if (e.z == null || e.value == null || !e.date) return null;
      const dir = e.z > 0 ? "above" : "below";
      return `${e.date} was unusual${e.entity ? ` for ${e.entity}` : ""}: ${e.measureLabel} of ${fmtValue(e.value, e.unit, e.currency, e.locale)} sits ${fmtFixed(Math.abs(e.z), 1, e.locale)}σ ${dir} typical.`;
    }
    case "peer": {
      if (e.rank == null || e.peerCount == null || e.value == null) return null;
      let s = `${entity} ranks #${e.rank} of ${e.peerCount} by ${e.measureLabel}`;
      if (e.deltaPct != null && Math.abs(e.deltaPct) >= 0.03)
        s += `, ${fmtPct(e.deltaPct)} ${e.deltaPct > 0 ? "above" : "below"} the group average`;
      s += ` (${fmtValue(e.value, e.unit, e.currency, e.locale)}).`;
      if (e.attributeReading) s += ` ${e.attributeReading}`;
      return s;
    }
    case "concentration": {
      if (e.topShare == null || e.topCount == null) return null;
      // One is "your top vendor holds", not "your top 1 vendors hold" (F-132).
      const plural = entity.toLowerCase();
      const who =
        e.topCount === 1
          ? `Your top ${plural.replace(/s$/, "")} holds`
          : `Your top ${e.topCount} ${plural} hold`;
      // "Worth watching" only where the index says so: below 1,500 the usual
      // reading is unconcentrated, and the sentence says that instead (F-132).
      const hhi10k = e.hhi != null ? e.hhi * 10000 : null;
      const reading =
        hhi10k === null
          ? ""
          : hhi10k >= 2500
            ? " — highly concentrated, worth watching"
            : hhi10k >= 1500
              ? " — moderately concentrated, worth watching"
              : " — well spread, not concentrated";
      return `${who} ${fmtPct(e.topShare)} of ${e.measureLabel}${hhi10k !== null ? ` (HHI ${hhi10k.toFixed(0)})` : ""}${reading}.`;
    }
    case "correlation": {
      if (e.r == null || !e.attribute) return null;
      const strength =
        Math.abs(e.r) >= 0.7
          ? "strong"
          : Math.abs(e.r) >= 0.4
            ? "moderate"
            : "weak";
      const dir = e.r > 0 ? "higher" : "lower";
      return `${strength.charAt(0).toUpperCase() + strength.slice(1)} link (r=${fmtFixed(e.r, 2, e.locale)}): ${e.attribute} goes with ${dir} ${e.measureLabel}.${e.attributeReading ? ` ${e.attributeReading}` : ""}`;
    }
    case "driver": {
      if (!e.drivers?.length) return null;
      const top = e.drivers
        .slice(0, 3)
        .map(
          (d) =>
            `${d.attribute} (${d.weight >= 0 ? "+" : "−"}${fmtFixed(Math.abs(d.weight), 2, e.locale)})`,
        )
        .join(", ");
      return `Biggest ${e.measureLabel} drivers right now: ${top} — weights learned from your own data.`;
    }
    case "basket": {
      if (!e.pairA || !e.pairB || e.lift == null) return null;
      return `${e.pairA} and ${e.pairB} land on the same check ${fmtFixed(e.lift, 1, e.locale)}× more than chance — a pairing worth promoting.`;
    }
    case "forecast": {
      if (e.forecastGapPct == null) return null;
      const dir = e.forecastGapPct > 0 ? "ahead of" : "behind";
      const prefix = e.entity ? `${e.entity} ` : "";
      return `${prefix}${e.measureLabel} is running ${fmtPct(e.forecastGapPct)} ${dir} forecast${e.windowLabel ? ` over the last ${e.windowLabel}` : ""}.`;
    }
    case "goal": {
      if (!e.goalName) return null;
      const days =
        e.goalDaysLeft != null ? ` with ${e.goalDaysLeft} days left` : "";
      // A level (average check, attach rate) or a "keep at most" goal has no
      // "of the way": it is said by its pace alone (F-383).
      if (e.goalProgressPct == null) {
        if (e.goalOnTrack == null) return null;
        return e.goalOnTrack
          ? `On "${e.goalName}"${days}, the current pace gets you there.`
          : `On "${e.goalName}"${days}, the current pace falls short — consider acting on the levers below.`;
      }
      const pace =
        e.goalOnTrack == null
          ? ""
          : e.goalOnTrack
            ? " Current pace gets you there."
            : " Current pace falls short — consider acting on the levers below.";
      return `You're ${fmtPct(e.goalProgressPct)} of the way to "${e.goalName}"${days}.${pace}`;
    }
    case "hot": {
      if (e.value == null || e.z == null) return null;
      return `${entity} is surging right now: ${fmtValue(e.value, e.unit, e.currency, e.locale)}${e.surgeMinutes ? ` in ${e.surgeMinutes} min` : ""}, ${fmtFixed(Math.abs(e.z), 1, e.locale)}σ above its normal pace — worth a visit from the floor manager.`;
    }
    default:
      return null;
  }
}
