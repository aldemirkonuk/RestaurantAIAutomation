import {
  houseMembersInRoles,
  OWNER_AND_MANAGER,
} from "../../common/tenant/live-membership";
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
 * leak the figures, and writing to nobody would be a silent producer. Read
 * through `houseMembersInRoles`, so a membership that has ended or not yet
 * begun hears nothing either (SEC-2026-09-28-WEBSOCKET-ROLE-GATE).
 */
export const GOAL_READING_ROLES = OWNER_AND_MANAGER;

/** The run row's reason when something was to be said and nobody may hear it. */
export const NO_GOAL_READER =
  "A goal had news, but no owner or manager was in this sweep's audience — the goal's figures are not sent to anyone else.";

export function noGoalReader(readers: ProducerAudience | null): boolean {
  return (
    readers !== null && readers.ready.length + readers.deferred.length === 0
  );
}

export async function goalReaders(
  client: any,
  restaurantId: string,
  audience: ProducerAudience,
): Promise<ProducerAudience> {
  const readers = new Set(
    await houseMembersInRoles(client, restaurantId, GOAL_READING_ROLES),
  );
  return {
    ready: audience.ready.filter((u) => readers.has(u)),
    deferred: audience.deferred.filter((u) => readers.has(u)),
  };
}
