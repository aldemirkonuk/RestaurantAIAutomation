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
  /** "at_most": a ceiling to stay under, not a target to reach. */
  goalDirection?: "at_least" | "at_most";
  goalMet?: boolean;
  goalDaysLeft?: number;
  goalOnTrack?: boolean;
  /** The day the goal's reading was taken, when it was not today. */
  goalReadOn?: string;
  surgeMinutes?: number;
  n?: number;
  /**
   * The money every amount is in: the house's ISO 4217 code, `null` when none
   * is stated, absent when it could not be read (then a sentence with an
   * amount is withheld). Stored with the row, so the stored read can refuse
   * a sentence written in other money (`queryStored`). Was a fixed `$`: a
   * lira house read "($181)" on /reports (r7 browser check, 2026-11-12).
   */
  currency?: string | null;
}

/** Said once, at the end, when a money sentence has no stated currency. */
export const CURRENCY_NOT_RECORDED_SENTENCE =
  "The house's currency is not recorded.";

/** The amount alone: whole units, or thousands to one place ("10.8k"). */
const fmtAmount = (v: number) =>
  Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0);

/**
 * The mark for an ISO 4217 code: its narrow symbol where it has one ("₺", "$",
 * "£"), otherwise the code itself ("CHF"). A code `Intl` does not know is
 * printed as the code, never as another currency's symbol.
 */
function currencyMark(code: string): string {
  try {
    const mark = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value;
    return mark && mark !== "¤" ? mark : code;
  } catch {
    return code;
  }
}

/**
 * An amount in the house's money. A letter mark takes a space ("CHF 181"), a
 * symbol does not ("₺181"). With no stated currency the amount is printed
 * bare; `verbalize` then closes the sentence with
 * `CURRENCY_NOT_RECORDED_SENTENCE`, once, rather than a caveat beside every
 * figure.
 */
export function fmtMoney(v: number, currency: string | null): string {
  const amount = fmtAmount(v);
  if (currency === null || !/^[A-Z]{3}$/.test(currency)) return amount;
  const mark = currencyMark(currency);
  return /^[A-Za-z]/.test(mark) ? `${mark} ${amount}` : `${mark}${amount}`;
}

/**
 * A whole amount in the house's money, every digit kept ("₺12,345",
 * "CHF 12,345"), for a sentence that states one figure rather than a
 * comparison: the recommendations feed's dead stock and spend pace. The mark
 * is `fmtMoney`'s. With no stated currency the amount is bare and the caller
 * closes the sentence with `CURRENCY_NOT_RECORDED_SENTENCE`.
 */
export function fmtMoneyWhole(v: number, currency: string | null): string {
  const amount = Math.round(v).toLocaleString("en-US");
  if (currency === null || !/^[A-Z]{3}$/.test(currency)) return amount;
  const mark = currencyMark(currency);
  return /^[A-Za-z]/.test(mark) ? `${mark} ${amount}` : `${mark}${amount}`;
}

const fmtNum = (v: number) =>
  Math.abs(v) >= 100
    ? v.toFixed(0)
    : Math.abs(v) >= 10
      ? v.toFixed(1)
      : v.toFixed(2);

export function fmtValue(
  v: number,
  unit: InsightEvidence["unit"],
  currency: string | null,
): string {
  switch (unit) {
    case "currency":
      return fmtMoney(v, currency);
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
 * evidence is insufficient for that family (caller should skip).
 *
 * Every amount prints in `e.currency`. A sentence that would print an amount
 * whose currency could not be read (`e.currency` absent) is withheld: there is
 * no honest mark to put on it. The trend and forecast templates take a money
 * measure but print only a percentage, so they need no currency at all. */
export function verbalize(template: string, e: InsightEvidence): string | null {
  const code = e.currency ?? null;
  let printedMoney = false;
  const sentence = render(template, e, (v, unit) => {
    if (unit === "currency") printedMoney = true;
    return fmtValue(v, unit, code);
  });
  if (sentence === null) return null;
  if (printedMoney && e.currency === undefined) return null;
  // Bare amounts are said to be bare, once, at the end.
  const stated = code !== null && /^[A-Z]{3}$/.test(code);
  return printedMoney && !stated
    ? `${sentence} ${CURRENCY_NOT_RECORDED_SENTENCE}`
    : sentence;
}

function render(
  template: string,
  e: InsightEvidence,
  val: (v: number, unit: InsightEvidence["unit"]) => string,
): string | null {
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
        return `${entity} ${e.measureLabel} (${val(e.value, e.unit)}) is in line with the typical ${entity.toLowerCase()}.`;
      const dir = e.deltaPct > 0 ? "higher" : "lower";
      // `date` on a baseline means the day compared was NOT the newest day in
      // the series — the generator skipped back past days with no records. The
      // sentence has to carry that date, or "Wednesday" reads as yesterday.
      const when = e.date ? `${entity} ${e.date} ` : `${entity} `;
      // The support count travels with the claim. "12% lower than your average
      // Wednesday" is a different statement over four Wednesdays than over
      // three, and the reader is entitled to know which one they are reading.
      const support = e.n ? `, over ${e.n} past ${entity}s` : "";
      return `${when}${e.measureLabel} came in ${fmtPct(e.deltaPct)} ${dir} than your average ${entity} (${val(e.value, e.unit)} vs ${val(e.baseline, e.unit)}${support}).`;
    }
    case "period": {
      if (e.deltaPct == null || e.value == null || e.baseline == null)
        return null;
      const verb =
        e.deltaPct > 0 ? "rose" : e.deltaPct < 0 ? "fell" : "held flat";
      const prefix = e.entity ? `${e.entity} ` : "";
      return `${prefix}${e.measureLabel} ${verb} ${fmtPct(e.deltaPct)} vs the previous ${e.windowLabel ?? "period"} (${val(e.value, e.unit)} vs ${val(e.baseline, e.unit)}).`;
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
      return `${e.date} was unusual${e.entity ? ` for ${e.entity}` : ""}: ${e.measureLabel} of ${val(e.value, e.unit)} sits ${Math.abs(e.z).toFixed(1)}σ ${dir} typical.`;
    }
    case "peer": {
      if (e.rank == null || e.peerCount == null || e.value == null) return null;
      let s = `${entity} ranks #${e.rank} of ${e.peerCount} by ${e.measureLabel}`;
      if (e.deltaPct != null && Math.abs(e.deltaPct) >= 0.03)
        s += `, ${fmtPct(e.deltaPct)} ${e.deltaPct > 0 ? "above" : "below"} the group average`;
      s += ` (${val(e.value, e.unit)}).`;
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
      const days =
        e.goalDaysLeft != null ? ` with ${e.goalDaysLeft} days left` : "";
      const asOf = e.goalReadOn ? ` (read on ${e.goalReadOn})` : "";
      if (e.goalDirection === "at_most") {
        // A ceiling: the share of it used, and whether it still holds.
        const where =
          e.goalMet === false
            ? `"${e.goalName}" is over its ceiling: ${fmtPct(e.goalProgressPct)} of it${days}${asOf}.`
            : `"${e.goalName}" stands at ${fmtPct(e.goalProgressPct)} of its ceiling${days}${asOf}.`;
        const pace =
          e.goalOnTrack == null || e.goalMet === false
            ? ""
            : e.goalOnTrack
              ? " At this pace it stays under."
              : " At this pace it goes over — consider acting on the levers below.";
        return `${where}${pace}`;
      }
      if (e.goalMet === true)
        return `"${e.goalName}" is reached: ${fmtPct(e.goalProgressPct)} of its target${days}${asOf}.`;
      const pace =
        e.goalOnTrack == null
          ? ""
          : e.goalOnTrack
            ? " Current pace gets you there."
            : " Current pace falls short — consider acting on the levers below.";
      return `You're ${fmtPct(e.goalProgressPct)} of the way to "${e.goalName}"${days}${asOf}.${pace}`;
    }
    case "hot": {
      if (e.value == null || e.z == null) return null;
      return `${entity} is surging right now: ${val(e.value, e.unit)}${e.surgeMinutes ? ` in ${e.surgeMinutes} min` : ""}, ${Math.abs(e.z).toFixed(1)}σ above its normal pace — worth a visit from the floor manager.`;
    }
    default:
      return null;
  }
}
