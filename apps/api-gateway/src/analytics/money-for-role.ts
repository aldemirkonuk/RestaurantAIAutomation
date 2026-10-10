import { holdsHouseMoney } from "../procurement/documents/document-money-gate";

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

/** A figure with a currency sign in front of it: "$1,240", "€ 38", "₺1.2k". */
const MONEY_IN_WORDS = /[$€£₺¥]\s?-?\d/;

const saysMoney = (...texts: unknown[]): boolean =>
  texts.some((t) => typeof t === "string" && MONEY_IN_WORDS.test(t));

/**
 * The insight feed for this role (F-603). A card measured in money (its
 * evidence unit is `currency`: sales, average check, spend) or whose sentence
 * prints an amount is left out for a reader who does not hold the money, and
 * `withheldForYourRole` counts them so the page can say so rather than read
 * as a shorter feed. A sentence cannot be rewritten without its figure and
 * still say what it found, so the card goes whole.
 */
export function insightsForRole<T extends Row>(answer: T, role?: string | null): T {
  if (holdsHouseMoney(role ?? null)) return answer;
  const list = (answer as Row).insights;
  if (!Array.isArray(list)) return answer;
  const kept = list.filter(
    (i: Row) => !(i?.evidence?.unit === "currency" || saysMoney(i?.sentence)),
  );
  return { ...answer, insights: kept, withheldForYourRole: list.length - kept.length };
}

/**
 * The recommendations feed for this role (F-603). An entry whose observation,
 * advice or reasoning prints an amount ("$4,800 is locked in inventory…",
 * "spend is up 12% ($9,310)") is left out for a reader who does not hold the
 * money; `withheldForYourRole` counts them.
 */
export function recommendationsForRole<T extends Row>(answer: T, role?: string | null): T {
  if (holdsHouseMoney(role ?? null)) return answer;
  const list = (answer as Row).recommendations;
  if (!Array.isArray(list)) return answer;
  const kept = list.filter(
    (r: Row) => !saysMoney(r?.observation, r?.recommendation, r?.rationale),
  );
  return { ...answer, recommendations: kept, withheldForYourRole: list.length - kept.length };
}

/**
 * The stored copies of the same entries (F-603): the Snoozed, Dismissed and
 * Done tabs (`/actions`), the history (`/history`) and the caller's own
 * snoozes (`/snoozed-for-me`) each carry the observation and advice as they
 * were when someone acted on the card. A row whose words print an amount
 * keeps its place (staff may still return their own act to the book) but
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
    if (!saysMoney(r?.observation, r?.recommendation, r?.rationale)) return r;
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
