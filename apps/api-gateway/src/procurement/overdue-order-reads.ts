/**
 * The two facts `overdue-order.ts` needs about an order still out with the
 * vendor, read for a set of this house's orders: the "Not yet" answers the
 * house recorded, and whether a credit on it was settled `credited` (closed
 * with a credit).
 *
 * Read by the vendor scorecard, the analytics vendor scorecard and the
 * overdue-orders read, so the three ask the same question the same way.
 *
 * EVERY READ NAMES THE HOUSE. The gateway reads with the service-role client,
 * which bypasses RLS, so `.eq("restaurant_id", house)` on each query IS the
 * tenant boundary: an order id from another house finds nothing here.
 *
 * A FAILED READ IS NEVER AN EMPTY ONE. Either read failing answers
 * `{ ok: false, reason }`; a caller that scored the orders anyway would read
 * every confirmed order as unconfirmed, and every order closed with a credit
 * as still owed — absence reported as health.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArrivalAnswerRow } from "./overdue-order";

export const ARRIVAL_ANSWERS_TABLE = "procurement_order_arrival_answers";

const IN_CHUNK = 150;

export type OverdueContext =
  | {
      ok: true;
      answers: Map<string, ArrivalAnswerRow[]>;
      closedWithCredit: Set<string>;
    }
  | { ok: false; reason: string };

function reasonOf(
  error: { code?: string; message?: string } | null | undefined,
): string {
  if (!error) return "no reason given";
  return (
    [error.code, error.message].filter(Boolean).join(" ") || "no reason given"
  );
}

export async function readOverdueContext(
  client: SupabaseClient,
  house: string,
  orderIds: readonly string[],
): Promise<OverdueContext> {
  const answers = new Map<string, ArrivalAnswerRow[]>();
  const closedWithCredit = new Set<string>();
  const ids = [...new Set(orderIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const asked = await client
      .from(ARRIVAL_ANSWERS_TABLE)
      .select("order_id, answer, expected_date, answered_at")
      .eq("restaurant_id", house)
      .in("order_id", chunk);
    if (asked.error)
      return {
        ok: false,
        reason: `the arrival answers did not answer: ${reasonOf(asked.error)}`,
      };
    for (const r of (asked.data ?? []) as ArrivalAnswerRow[]) {
      const list = answers.get(r.order_id) ?? [];
      list.push(r);
      answers.set(r.order_id, list);
    }
    const credited = await client
      .from("procurement_credits")
      .select("order_id")
      .eq("restaurant_id", house)
      .eq("state", "credited")
      .in("order_id", chunk);
    if (credited.error)
      return {
        ok: false,
        reason: `the credits on these orders did not answer: ${reasonOf(credited.error)}`,
      };
    for (const r of (credited.data ?? []) as { order_id: string | null }[])
      if (r.order_id) closedWithCredit.add(r.order_id);
  }
  return { ok: true, answers, closedWithCredit };
}
