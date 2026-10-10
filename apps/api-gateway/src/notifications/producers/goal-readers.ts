import type { ProducerAudience } from "./producer-ledger.service";

/**
 * Who may hear a goal's figures: the house's owners and managers.
 *
 * The goal bells (`goal_reached`, `ceiling_held`) put the goal's money in the
 * sentence — "stands at ₺X against a target of ₺Y". The goals themselves are
 * kept for owners and managers (`assertMayReadGoals`, ADR 0164), so a bell that
 * went to the whole house would hand a server the figure the page refuses them
 * (F-782). Same shape as `AddedToolProducer.decidingAudience`: intersected with
 * the audience the sweep was handed, so the quiet-hours split still decides
 * delivery, and a failed role read THROWS — writing to everyone instead would
 * leak the figures, and writing to nobody would be a silent producer.
 */
export const GOAL_READING_ROLES = ["owner", "manager"];

/** The run row's reason when something was to be said and nobody may hear it. */
export const NO_GOAL_READER =
  "A goal had news, but no owner or manager was in this sweep's audience — the goal's figures are not sent to anyone else.";

export function noGoalReader(readers: ProducerAudience | null): boolean {
  return readers !== null && readers.ready.length + readers.deferred.length === 0;
}

export async function goalReaders(
  client: any,
  restaurantId: string,
  audience: ProducerAudience,
): Promise<ProducerAudience> {
  const { data, error } = await client
    .from("user_restaurant_access")
    .select("user_id, role")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .in("role", GOAL_READING_ROLES);
  if (error) {
    throw new Error(`could not read user_restaurant_access: ${error.message}`);
  }
  const readers = new Set(
    (data ?? [])
      .map((r: any) => String(r?.user_id ?? ""))
      .filter((id: string) => id.length > 0),
  );
  return {
    ready: audience.ready.filter((u) => readers.has(u)),
    deferred: audience.deferred.filter((u) => readers.has(u)),
  };
}
