/**
 * Every answer a house gave to "do your till prices include tax?", in order,
 * and the stretches of house days each one covers (F-1624 remainder, F-1588
 * remainder; ADR 0341).
 *
 * `restaurants.tax_basis` holds only the answer in force, so a house that
 * answered include, then "added on top", then include again showed one switch
 * day, the last. `house_tax_basis_answers` (migration
 * a_house_keeps_each_tax_basis_answer) keeps each answer with its moment; the
 * day an answer takes effect is the house day of that moment (`houseDayOf`,
 * ADR 0296), the rule ingest switches on, so there is one rule, not two.
 *
 * Nothing here restamps a stored check (ADR 0341 F2): a check keeps the
 * answer it was recorded under. These are readers' marks only.
 */

import { houseDayOf, shiftHouseDay } from "./house-day";
import { asHouseTaxBasis } from "./tax-basis";

/** The three answers; `unset` is the absence of one. */
export type TaxBasisAnswerKind =
  | "prices_include_tax"
  | "prices_exclude_tax"
  | "not_vat_charging";

export interface TaxBasisAnswer {
  basis: TaxBasisAnswerKind;
  /** The moment it was given (`tax_basis_confirmed_at` of that answer). */
  answeredAt: string;
  answeredBy: string | null;
}

/** The house days one answer covers, from `fromDay` to the next stretch. */
export interface TaxBasisStretch {
  basis: TaxBasisAnswerKind;
  answeredAt: string;
  /** The house day it took effect; null when the house has no time zone. */
  fromDay: string | null;
}

function asAnswer(v: unknown): TaxBasisAnswerKind | null {
  const b = asHouseTaxBasis(v);
  return b === null || b === "unset" ? null : b;
}

/**
 * The house's answers, oldest first. The answer in force on `restaurants`
 * is always among them: when the history does not hold its moment (a row the
 * trigger could not have written), it is added last, so a reader never shows
 * fewer answers than the house record holds. Throws on a failed read: a
 * history that could not be read is not one with no changes.
 */
export async function readTaxBasisHistory(
  client: { from: (table: string) => any },
  restaurantId: string,
  current: {
    basis: string | null;
    confirmedAt: string | null;
    confirmedBy?: string | null;
  },
): Promise<TaxBasisAnswer[]> {
  const { data, error } = await client
    .from("house_tax_basis_answers")
    .select("basis, answered_at, answered_by")
    .eq("restaurant_id", restaurantId)
    .order("answered_at", { ascending: true })
    .limit(500);
  if (error) {
    throw new Error(
      `The house's earlier tax answers could not be read: ${error.message ?? String(error)}`,
    );
  }
  const answers: TaxBasisAnswer[] = [];
  for (const r of (data as Record<string, unknown>[] | null) ?? []) {
    const basis = asAnswer(r.basis);
    if (basis === null || typeof r.answered_at !== "string") continue;
    answers.push({
      basis,
      answeredAt: r.answered_at,
      answeredBy: typeof r.answered_by === "string" ? r.answered_by : null,
    });
  }
  const now = asAnswer(current.basis);
  if (now !== null && current.confirmedAt) {
    const at = Date.parse(current.confirmedAt);
    if (!answers.some((a) => Date.parse(a.answeredAt) === at)) {
      answers.push({
        basis: now,
        answeredAt: current.confirmedAt,
        answeredBy: current.confirmedBy ?? null,
      });
    }
  }
  return answers;
}

/**
 * The stretches the answers cover on the house's days. Two answers on one
 * house day leave that day to the later one (ingest compares house days, not
 * instants); an answer that repeats the stretch before it extends it.
 */
export function taxBasisStretches(
  answers: readonly TaxBasisAnswer[],
  zone: string | null,
): TaxBasisStretch[] {
  const out: TaxBasisStretch[] = [];
  for (const a of answers) {
    const fromDay = zone ? houseDayOf(a.answeredAt, zone) : null;
    const prev = out[out.length - 1];
    if (prev && fromDay !== null && prev.fromDay === fromDay) out.pop();
    const before = out[out.length - 1];
    if (before && before.basis === a.basis) continue;
    out.push({ basis: a.basis, answeredAt: a.answeredAt, fromDay });
  }
  return out;
}

/** The answer in force on `day`; null before the first one (unset). */
export function stretchOn(
  stretches: readonly TaxBasisStretch[],
  day: string,
): TaxBasisStretch | null {
  let hit: TaxBasisStretch | null = null;
  for (const s of stretches)
    if (s.fromDay !== null && s.fromDay <= day) hit = s;
  return hit;
}

/**
 * The stretches that start inside `first`..`last` after its first day: the
 * switches a period spans. A switch on the first day leaves the whole period
 * on one answer.
 */
export function taxSwitchesIn(
  stretches: readonly TaxBasisStretch[],
  first: string,
  last: string,
): TaxBasisStretch[] {
  return stretches.filter(
    (s) => s.fromDay !== null && s.fromDay > first && s.fromDay <= last,
  );
}

/** "10 October 2026": a house day, in words (no clock involved). */
export function dayWords(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** What one answer means for net, in the owner's words. */
export function stretchWords(
  basis: TaxBasisAnswerKind | null,
  taxWord: string,
): string {
  switch (basis) {
    case "prices_include_tax":
      return `till prices include ${taxWord}, and net is without it`;
    case "prices_exclude_tax":
      return `${taxWord} is added on top of till prices, so net is as the till sent it`;
    case "not_vat_charging":
      return `the house charges no ${taxWord}, so net is as the till sent it`;
    default:
      return `nobody had said whether till prices include ${taxWord}, so net is as the till sent it`;
  }
}

/**
 * F-1588 / F-1624: the sentence a period's figures carry when the house
 * CHANGED its answer inside it (one answer replacing another, not the first
 * answer alone, which the switch-day line already says). Null when the period
 * is on one answer, or only the first answer falls in it.
 */
export function taxChangeNote(
  stretches: readonly TaxBasisStretch[],
  first: string,
  last: string,
  taxWord: string,
): string | null {
  const switches = taxSwitchesIn(stretches, first, last);
  const changed = switches.some((s) => stretches.indexOf(s) > 0);
  if (!changed) return null;
  const opening = stretchOn(stretches, first);
  const parts = [
    `Until ${dayWords(shiftHouseDay(switches[0].fromDay as string, -1))}, ${stretchWords(opening?.basis ?? null, taxWord)}.`,
    ...switches.map(
      (s) =>
        `From ${dayWords(s.fromDay as string)}, ${stretchWords(s.basis, taxWord)}.`,
    ),
  ];
  return `The house changed its answer about ${taxWord} during this period, so its net is not on one basis. ${parts.join(" ")} Checks already recorded keep the answer they were recorded under.`;
}
