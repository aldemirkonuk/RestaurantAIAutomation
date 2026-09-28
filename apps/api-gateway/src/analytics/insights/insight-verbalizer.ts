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

export interface InsightEvidence {
  /** Entity display name (e.g. "Table 4", "Tuesday", "Caymus Cab"). */
  entity?: string;
  /** Measure display label ("sales", "average check"). */
  measureLabel: string;
  unit: "currency" | "count" | "percent" | "ratio" | "units";
  value?: number;
  baseline?: number;
  deltaPct?: number | null;
  z?: number | null;
  direction?: "above" | "below" | "in_line" | "up" | "down" | "flat";
  rank?: number;
  peerCount?: number;
  windowLabel?: string; // "week", "30 days"
  trendPctPerWeek?: number;
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

const fmtMoney = (v: number) =>
  `$${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)}`;

const fmtNum = (v: number) =>
  Math.abs(v) >= 100
    ? v.toFixed(0)
    : Math.abs(v) >= 10
      ? v.toFixed(1)
      : v.toFixed(2);

export function fmtValue(v: number, unit: InsightEvidence["unit"]): string {
  switch (unit) {
    case "currency":
      return fmtMoney(v);
    case "percent":
      return `${(v * 100).toFixed(1)}%`;
    default:
      return fmtNum(v);
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
export function tableAttributeReading(attribute: string, r: number): string {
  const DIST = "distance to ";
  const higher = r > 0 ? "higher" : "lower";
  const phrase = attribute.startsWith(DIST)
    ? `tables farther from the ${attribute.slice(DIST.length)}`
    : `tables with more ${attribute === "seat count" ? "seats" : attribute}`;
  return `Across your floor, ${phrase} average ${higher} checks (r=${r.toFixed(2)}).`;
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
        return `${entity} ${e.measureLabel} (${fmtValue(e.value, e.unit)}) is in line with the typical ${entity.toLowerCase()}.`;
      const dir = e.deltaPct > 0 ? "higher" : "lower";
      // `date` on a baseline means the day compared was NOT the newest day in
      // the series — the generator skipped back past days with no records. The
      // sentence has to carry that date, or "Wednesday" reads as yesterday.
      const when = e.date ? `${entity} ${e.date} ` : `${entity} `;
      // The support count travels with the claim. "12% lower than your average
      // Wednesday" is a different statement over four Wednesdays than over
      // three, and the reader is entitled to know which one they are reading.
      const support = e.n ? `, over ${e.n} past ${entity}s` : "";
      return `${when}${e.measureLabel} came in ${fmtPct(e.deltaPct)} ${dir} than your average ${entity} (${fmtValue(e.value, e.unit)} vs ${fmtValue(e.baseline, e.unit)}${support}).`;
    }
    case "period": {
      if (e.deltaPct == null || e.value == null || e.baseline == null)
        return null;
      const verb =
        e.deltaPct > 0 ? "rose" : e.deltaPct < 0 ? "fell" : "held flat";
      const prefix = e.entity ? `${e.entity} ` : "";
      return `${prefix}${e.measureLabel} ${verb} ${fmtPct(e.deltaPct)} vs the previous ${e.windowLabel ?? "period"} (${fmtValue(e.value, e.unit)} vs ${fmtValue(e.baseline, e.unit)}).`;
    }
    case "trend": {
      if (e.trendPctPerWeek == null) return null;
      const dir = e.trendPctPerWeek > 0 ? "climbing" : "sliding";
      const prefix = e.entity ? `${e.entity} ` : "";
      return `${prefix}${e.measureLabel} has been ${dir} about ${fmtPct(e.trendPctPerWeek)} per week${e.n ? ` over the last ${e.n} days` : ""}.`;
    }
    case "anomaly": {
      if (e.z == null || e.value == null || !e.date) return null;
      const dir = e.z > 0 ? "above" : "below";
      return `${e.date} was unusual${e.entity ? ` for ${e.entity}` : ""}: ${e.measureLabel} of ${fmtValue(e.value, e.unit)} sits ${Math.abs(e.z).toFixed(1)}σ ${dir} typical.`;
    }
    case "peer": {
      if (e.rank == null || e.peerCount == null || e.value == null) return null;
      let s = `${entity} ranks #${e.rank} of ${e.peerCount} by ${e.measureLabel}`;
      if (e.deltaPct != null && Math.abs(e.deltaPct) >= 0.03)
        s += `, ${fmtPct(e.deltaPct)} ${e.deltaPct > 0 ? "above" : "below"} the group average`;
      s += ` (${fmtValue(e.value, e.unit)}).`;
      if (e.attributeReading) s += ` ${e.attributeReading}`;
      return s;
    }
    case "concentration": {
      if (e.topShare == null || e.topCount == null) return null;
      return `Your top ${e.topCount} ${entity.toLowerCase()} hold ${fmtPct(e.topShare)} of ${e.measureLabel}${e.hhi != null ? ` (HHI ${(e.hhi * 10000).toFixed(0)})` : ""} — concentration worth watching.`;
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
      return `${strength.charAt(0).toUpperCase() + strength.slice(1)} link (r=${e.r.toFixed(2)}): ${e.attribute} goes with ${dir} ${e.measureLabel}.${e.attributeReading ? ` ${e.attributeReading}` : ""}`;
    }
    case "driver": {
      if (!e.drivers?.length) return null;
      const top = e.drivers
        .slice(0, 3)
        .map(
          (d) =>
            `${d.attribute} (${d.weight >= 0 ? "+" : "−"}${Math.abs(d.weight).toFixed(2)})`,
        )
        .join(", ");
      return `Biggest ${e.measureLabel} drivers right now: ${top} — weights learned from your own data.`;
    }
    case "basket": {
      if (!e.pairA || !e.pairB || e.lift == null) return null;
      return `${e.pairA} and ${e.pairB} land on the same check ${e.lift.toFixed(1)}× more than chance — a pairing worth promoting.`;
    }
    case "forecast": {
      if (e.forecastGapPct == null) return null;
      const dir = e.forecastGapPct > 0 ? "ahead of" : "behind";
      const prefix = e.entity ? `${e.entity} ` : "";
      return `${prefix}${e.measureLabel} is running ${fmtPct(e.forecastGapPct)} ${dir} forecast${e.windowLabel ? ` over the last ${e.windowLabel}` : ""}.`;
    }
    case "goal": {
      if (e.goalProgressPct == null || !e.goalName) return null;
      const pace =
        e.goalOnTrack == null
          ? ""
          : e.goalOnTrack
            ? " Current pace gets you there."
            : " Current pace falls short — consider acting on the levers below.";
      const days =
        e.goalDaysLeft != null ? ` with ${e.goalDaysLeft} days left` : "";
      return `You're ${fmtPct(e.goalProgressPct)} of the way to "${e.goalName}"${days}.${pace}`;
    }
    case "hot": {
      if (e.value == null || e.z == null) return null;
      return `${entity} is surging right now: ${fmtValue(e.value, e.unit)}${e.surgeMinutes ? ` in ${e.surgeMinutes} min` : ""}, ${Math.abs(e.z).toFixed(1)}σ above its normal pace — worth a visit from the floor manager.`;
    }
    default:
      return null;
  }
}
