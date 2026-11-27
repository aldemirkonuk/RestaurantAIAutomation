/**
 * Which house a letter to the shared Gmail mailbox was written to (QA round
 * 25, cross-tenant BLOCKER).
 *
 * The shared mailbox is one account for every house, so a letter carries no
 * house of its own. The bridge and the order agent used to find one by
 * looking the sender up across every house and taking the first row: a
 * letter to house A from a vendor address house B also lists was filed under
 * B's vendor and B's order, and B's manager was told. This module decides the
 * house once, at the door, and the event carries it; a consumer that gets an
 * event without a house attributes nothing.
 *
 * The rule, in order, and the first rule that speaks decides:
 *   1. thread — the Gmail thread holds rows of exactly one house (a house
 *      that wrote into it from this mailbox). Rows of two houses: no house.
 *   2. vendor — the parsed sender is the contact address of a live vendor of
 *      exactly one house. Two houses list it: no house.
 *   3. only house — no vendor anywhere has the address and there is exactly
 *      one house, so there is no other house it could be for.
 * Otherwise, or when any read fails, no house: the letter is kept for the
 * operator, unattributed, and never guessed into one.
 *
 * "Exactly one house" is read as two queries (one row, then any row of a
 * different house), never as "count the rows I fetched", so no row cap can
 * hide a second house.
 */
import { likeExactly, senderAddress } from "./inbound-headers";

export type ReceivingHouse =
  | { restaurantId: string; how: "thread" | "vendor" | "only_house" }
  | {
      restaurantId: null;
      how:
        | "thread_in_many_houses"
        | "vendor_in_many_houses"
        | "no_house"
        | "read_failed";
    };

type Supabase = { from: (table: string) => any };

class ReadFailed extends Error {}

async function rows(query: any): Promise<any[]> {
  const { data, error } = await query;
  if (error) throw new ReadFailed(error.message ?? String(error));
  return Array.isArray(data) ? data : [];
}

/**
 * The one house whose rows `narrow` selects, "many" when two houses have
 * such rows, or null when no row has a house.
 */
async function oneHouse(
  supabase: Supabase,
  table: string,
  narrow: (q: any) => any,
): Promise<string | "many" | null> {
  const first = await rows(
    narrow(supabase.from(table).select("restaurant_id"))
      .not("restaurant_id", "is", null)
      .limit(1),
  );
  const house: string | undefined = first[0]?.restaurant_id;
  if (!house) return null;
  const other = await rows(
    narrow(supabase.from(table).select("restaurant_id"))
      .not("restaurant_id", "is", null)
      .neq("restaurant_id", house)
      .limit(1),
  );
  return other.length ? "many" : house;
}

export async function receivingHouse(
  supabase: Supabase,
  letter: { from: string; gmailThreadId?: string | null },
): Promise<ReceivingHouse> {
  try {
    if (letter.gmailThreadId) {
      // Rows of this mailbox only: a thread id is unique within one Gmail
      // account, and a row a person's mirrored mailbox produced carries the
      // grant that read it (ADR 0118).
      const thread = await oneHouse(
        supabase,
        "procurement_conversations",
        (q) =>
          q
            .eq("gmail_thread_id", letter.gmailThreadId)
            .is("mirrored_by_grant_id", null),
      );
      if (thread === "many")
        return { restaurantId: null, how: "thread_in_many_houses" };
      if (thread) return { restaurantId: thread, how: "thread" };
    }

    const sender = senderAddress(letter.from);
    if (sender) {
      // Live vendors only, the same set tenant_isolation_report's
      // provider_email_cross_tenant counts, so that counter says how many
      // vendor addresses this rule sends to the operator.
      const vendor = await oneHouse(supabase, "providers", (q) =>
        q.ilike("contact_email", likeExactly(sender)).is("deleted_at", null),
      );
      if (vendor === "many")
        return { restaurantId: null, how: "vendor_in_many_houses" };
      if (vendor) return { restaurantId: vendor, how: "vendor" };
    }

    const houses = await rows(
      supabase.from("restaurants").select("id").limit(2),
    );
    if (houses.length === 1 && houses[0]?.id)
      return { restaurantId: houses[0].id, how: "only_house" };
    return { restaurantId: null, how: "no_house" };
  } catch {
    // A read that failed is not "no rows" (ADR 0067): no house, not a guess.
    return { restaurantId: null, how: "read_failed" };
  }
}
