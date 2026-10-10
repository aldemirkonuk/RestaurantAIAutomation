import { holdsHouseMoney } from "../procurement/documents/document-money-gate";
import { parseSuppressionKey } from "./insights/suppression";

/**
 * THE HOUSE'S MONEY ON THE ANALYTICS READS STAFF CAN CALL (F-602, F-603).
 *
 * Staff see counts, never amounts (ADR 0145): prices paid, costs, values and
 * margins are the `money` class, and `holdsHouseMoney` is the one answer to
 * who holds it. These cuts run on the controller's answer, never inside the
 * engine, so the digest, the MCP reader and the stored cache stay the house's
 * one truth. Pure: no database, no Nest container.
 */
type Row = Record<string, any>;

/** What the house paid, and what follows from it. */
const SKU_MONEY = ["unitCost", "inventoryValue", "eoq"] as const;

function without(o: Row, keys: readonly string[]): Row {
  const out: Row = { ...o };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * The reorder register for this role (F-602). A reader who does not hold the
 * money gets each wine without `unitCost` and `inventoryValue`, and without
 * `eoq`: the order quantity is built from the cost (EOQ's holding term is a
 * fraction of it), so with the daily demand beside it the cost can be worked
 * back. Keys are OMITTED, never nulled -- a null here already means "no
 * recorded cost". Demand, cover, reorder point, stockout risk and the ABC
 * class (a rank, not an amount) stay. `amountsWithheld: true` says why.
 */
export function inventoryScienceForRole(sci: Row, role?: string | null): Row {
  if (holdsHouseMoney(role ?? null)) return sci;
  return {
    ...sci,
    amountsWithheld: true,
    skus: (sci.skus ?? []).map((s: Row) => without(s, SKU_MONEY)),
    reorderList: (sci.reorderList ?? []).map((s: Row) => without(s, SKU_MONEY)),
  };
}

/**
 * WHETHER AN ENTRY SAYS MONEY IS READ FROM ITS STRUCTURE (F-863).
 *
 * A currency sign in the words is not enough: the house's money prints as
 * "TRY 12,400" where the locale has no sign for it, after the figure in a
 * German house ("12.400 €"), and with no sign at all when the house recorded
 * no currency ("12,400") or on a price line. So an entry is money when it
 * says so: an insight measured in `currency`, a recommendation the engine
 * tagged `amounts: true`, or a stored act on a rule that prints money. The
 * words are still read, as a second net, for a sign or an ISO code beside a
 * figure.
 */
const SIGN_THEN_FIGURE = /\p{Sc}[\s\u00a0\u202f]?-?\d/u;
const FIGURE_THEN_SIGN = /\d[\s\u00a0\u202f]?\p{Sc}/u;
const CODE_BESIDE_FIGURE =
  /\b([A-Z]{3})[\s\u00a0\u202f]?-?\d|\d[\s\u00a0\u202f]?([A-Z]{3})\b/gu;

let isoCodes: Set<string> | null = null;
/** ISO 4217 codes this runtime knows, so "DOC 2019" on a label is not money. */
function isCurrencyCode(code: string): boolean {
  if (!isoCodes) {
    const list = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.("currency");
    isoCodes = new Set(list ?? []);
  }
  return isoCodes.has(code);
}

const wordsSayMoney = (t: string): boolean =>
  SIGN_THEN_FIGURE.test(t) ||
  FIGURE_THEN_SIGN.test(t) ||
  [...t.matchAll(CODE_BESIDE_FIGURE)].some((m) => isCurrencyCode(m[1] ?? m[2]));

const saysMoney = (...texts: unknown[]): boolean =>
  texts.some((t) => typeof t === "string" && wordsSayMoney(t));

/**
 * The rules whose words can print the house's money, for the stored copies of
 * their entries, which keep the words but not the engine's `amounts` tag. A
 * rule that restates an insight (the first four) prints money when that
 * insight is measured in money; a stored row cannot say which, so it is
 * treated as money. Keep in step with `recommendations.service.ts`: every
 * rule there that calls `money()`, `restated()` or sets `amounts`.
 */
export const RULES_THAT_PRINT_MONEY: ReadonlySet<string> = new Set([
  "sales_below_weekday_baseline",
  "weekly_demand_slide",
  "staff_spread",
  "pairing_promotion",
  "dead_stock_capital",
  "margin_to_target",
  "spend_acceleration",
]);

const ruleOf = (key: unknown): string =>
  typeof key === "string" ? parseSuppressionKey(key).ruleId : "";

/**
 * The insight feed for this role (F-603). A card measured in money (its
 * evidence unit is `currency`: sales, average check, spend) or whose sentence
 * prints an amount is left out for a reader who does not hold the money, and
 * `withheldForYourRole` counts them so the page can say so rather than read
 * as a shorter feed. A sentence cannot be rewritten without its figure and
 * still say what it found, so the card goes whole.
 */
export function insightsForRole<T extends Row>(
  answer: T,
  role?: string | null,
): T {
  if (holdsHouseMoney(role ?? null)) return answer;
  const list = (answer as Row).insights;
  if (!Array.isArray(list)) return answer;
  const kept = list.filter(
    (i: Row) => !(i?.evidence?.unit === "currency" || saysMoney(i?.sentence)),
  );
  return {
    ...answer,
    insights: kept,
    withheldForYourRole: list.length - kept.length,
  };
}

/**
 * The recommendations feed for this role (F-603). An entry the engine tagged
 * `amounts: true` (F-863), or whose observation, advice or reasoning shows an
 * amount ("$4,800 is locked in inventory…", "spend is up 12% ($9,310)"), is
 * left out for a reader who does not hold the money; `withheldForYourRole`
 * counts them.
 */
export function recommendationsForRole<T extends Row>(
  answer: T,
  role?: string | null,
): T {
  if (holdsHouseMoney(role ?? null)) return answer;
  const list = (answer as Row).recommendations;
  if (!Array.isArray(list)) return answer;
  const kept = list.filter(
    (r: Row) =>
      !(
        r?.amounts === true ||
        saysMoney(r?.observation, r?.recommendation, r?.rationale)
      ),
  );
  return {
    ...answer,
    recommendations: kept,
    withheldForYourRole: list.length - kept.length,
  };
}

/**
 * The stored copies of the same entries (F-603): the Snoozed, Dismissed and
 * Done tabs (`/actions`), the history (`/history`) and the caller's own
 * snoozes (`/snoozed-for-me`) each carry the observation and advice as they
 * were when someone acted on the card. A row of a rule that prints money
 * (`RULES_THAT_PRINT_MONEY`), or whose words show an amount, keeps its place (staff may still return their own act to the book) but
 * loses those words for a reader who does not hold the money:
 * `observation` and `recommendation` come back null and the row says
 * `withheldForYourRole: true`; the answer's `withheldForYourRole` counts them.
 */
export function actionRowsForRole<T extends Row>(
  items: T[],
  role?: string | null,
): { items: T[]; withheldForYourRole?: number } {
  if (holdsHouseMoney(role ?? null)) return { items };
  let withheld = 0;
  const out = items.map((r) => {
    const words = [r?.observation, r?.recommendation, r?.rationale];
    const money =
      words.some((w) => typeof w === "string" && w !== "") &&
      (RULES_THAT_PRINT_MONEY.has(ruleOf(r?.ruleKey)) || saysMoney(...words));
    if (!money) return r;
    withheld += 1;
    return {
      ...r,
      observation: null,
      recommendation: null,
      ...("rationale" in r ? { rationale: null } : {}),
      withheldForYourRole: true,
    };
  });
  return { items: out, withheldForYourRole: withheld };
}
