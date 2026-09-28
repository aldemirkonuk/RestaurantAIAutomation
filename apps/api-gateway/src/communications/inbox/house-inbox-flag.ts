/**
 * The three facts about reading a house's mailbox that TWO services need, in a
 * file that depends on neither of them.
 *
 * WHY IT IS NOT A METHOD ON `HouseInboxService`
 * --------------------------------------------
 * `HouseSenderService` has to say, on the composer's sender line, whether this
 * house's replies are being read. `HouseInboxService` is the thing that reads
 * them — and it needs `HouseLettersService.book()` to bound its query, which in
 * turn needs `HouseSenderService`. Injecting the reader into the resolver
 * closes the ring `sender -> inbox -> letters -> sender`, and Nest would refuse
 * to build it.
 *
 * The alternative was a second copy of the flag read inside the resolver. That
 * is worse than a cycle: two fail-closed defaults that agree today, and one day
 * a sender line that says a house is being read when the reader has decided it
 * is not. A plain function over the Supabase client has no DI edge to close and
 * exactly one implementation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { SETTINGS_ROW_FLAG_NAME } from "../../settings/feature-flag-registry";

/**
 * The Gmail scope that permits reading a message body.
 *
 * Asserted against the catalogue in `gmail-read-asks-for-one-thing.spec.ts`
 * rather than trusted: this constant decides whether a stored grant counts and
 * the definition decides what is actually asked for. If they drift, either
 * every consenting house silently stops being read or one is read on a grant it
 * never gave.
 */
export const GMAIL_READ_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

/** The integration id a reading grant is recorded under. */
export const GMAIL_READ_INTEGRATION_ID = "gmail_read" as const;

/**
 * The per-restaurant switch. Column added by migration 20260905020000,
 * `NOT NULL DEFAULT false`.
 */
export const HOUSE_INBOX_FLAG = "enable_house_inbox_read";

/**
 * Is this restaurant's mailbox reading switched on?
 *
 * FAILS CLOSED on every uncertain path — no row, a read error, a thrown client.
 * The asymmetry is deliberate and is not the usual "be conservative": a read
 * that should not have happened cannot be taken back, while a read that was
 * skipped happens five minutes later. `enable_ai_negotiation` defaults the
 * other way for exactly the opposite reason (turning it off silently would stop
 * analysing vendor mail a house already relies on) — the default follows the
 * irreversible direction, never a house style.
 *
 * The `flag_name` filter is load-bearing. `restaurant_feature_flags` is an EAV
 * table that also holds rows written by self-evolution, so filtering on
 * restaurant alone makes `.maybeSingle()` fail as soon as a restaurant has two
 * rows — and that failure lands here, on the fallback.
 */
export async function isHouseInboxReadEnabled(
  client: SupabaseClient,
  restaurantId: string,
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("restaurant_feature_flags")
      .select(HOUSE_INBOX_FLAG)
      .eq("restaurant_id", restaurantId)
      .eq("flag_name", SETTINGS_ROW_FLAG_NAME)
      .maybeSingle();
    if (error || !data) return false;
    return (data as Record<string, unknown>)[HOUSE_INBOX_FLAG] === true;
  } catch {
    return false;
  }
}
