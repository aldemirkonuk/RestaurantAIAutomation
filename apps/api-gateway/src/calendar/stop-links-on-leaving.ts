import { InternalServerErrorException, Logger } from "@nestjs/common";

/**
 * A person who leaves a house loses their calendar link there, for good
 * (ADR 0111, review trail 2026-09-21, round 6t).
 *
 * The founder, verbatim: *"Yes, revoke on leaving (Recommended)"* — both
 * removal flows, and any other path that ends membership, stop that person's
 * link for that house at once, with a `system_audit_log` row; a returning
 * person connects again; no dormant revival.
 *
 * Before this, leaving only stopped what the link SERVED (the feed reads the
 * person's role on every request, so no role meant the expired notice). The
 * row stayed live, so the owner/manager register still listed the leaver, and
 * if the same person was added back the same old address served again without
 * them doing anything. This function ends the row itself.
 *
 * THE DOORS THAT END A MEMBERSHIP, MEASURED 2026-09-21
 * ----------------------------------------------------
 * Every write in `apps/api-gateway/src` that deletes a `user_restaurant_access`
 * row, or stops `users.restaurant_id` naming a house, outside a failed
 * registration's rollback (which runs before any link can exist):
 *   - `MembersService.removeMember` — both branches (the access row, and a
 *     member known only by the `users` row);
 *   - `TeamService.deleteMember` — the Team page's remove;
 *   - `AuthService.leaveRestaurant` — a person leaving on their own;
 *   - `AuthService.deleteAccount` — every house at once (`restaurantId: null`).
 * Nothing in the gateway writes `is_active = false`, `deactivated_by` or
 * `valid_until` on an access row. A membership that ends OUTSIDE these doors
 * (a lapsed `valid_until`, a hand-run SQL delete) is caught by the feed: when a
 * live link's person has no role, `CalendarLinksService.renderFor` stops the
 * link the same way (actor `system`) before answering the notice.
 *
 * WHEN IT RUNS, AND WHAT A FAILURE MEANS
 * --------------------------------------
 * Each door calls this AFTER its refusal checks and BEFORE its first
 * membership write. So a refused removal stops nothing, and a stop that fails
 * throws before anything else changed: the person is still a member with a
 * live link, and the caller is told to try again. The other order could end
 * the membership and leave the link live — the dormant link this closes. If
 * the membership write fails AFTER the stop, the person keeps their
 * membership and has no link: the safe direction, and they can connect again.
 *
 * A plain function, not a provider, for the reason `team/access-audit.ts`
 * gives: the doors live in three Nest modules, and one shape of "stop it"
 * must serve all of them.
 */

export interface LeavingStop {
  /** The house left, or null for every house (the account is being deleted). */
  restaurantId: string | null;
  /** `public.users.user_id` of the person leaving. */
  userId: string;
  /**
   * `public.users.user_id` of whoever made them leave (themselves on a leave),
   * or null when the system found the membership already over.
   */
  actorUserId: string | null;
  /** Which door, as it will read on the audit row. */
  via:
    | "MembersService.removeMember"
    | "TeamService.deleteMember"
    | "AuthService.leaveRestaurant"
    | "AuthService.deleteAccount"
    | "feed_found_no_membership";
}

export interface LeavingStopReceipt {
  /** How many live links were stopped. */
  stopped: number;
  /** How many of those reached `system_audit_log`. */
  audited: number;
}

/** The `revoke_reason` a leaving stop writes (migration 20260921170700). */
export const LEFT_HOUSE = "left_house";

export async function stopCalendarLinksOnLeaving(
  sb: any,
  logger: Logger,
  stop: LeavingStop,
  now: Date = new Date(),
): Promise<LeavingStopReceipt> {
  let query = sb
    .from("calendar_feed_links")
    .update({
      revoked_at: now.toISOString(),
      revoked_by: stop.actorUserId,
      revoke_reason: LEFT_HOUSE,
    })
    .eq("user_id", stop.userId);
  if (stop.restaurantId !== null) {
    query = query.eq("restaurant_id", stop.restaurantId);
  }
  const { data, error } = await query
    .is("revoked_at", null)
    .select("id, restaurant_id");

  if (error) {
    logger.error(
      `${stop.via}: could not stop the calendar link of ${stop.userId}` +
        `${stop.restaurantId ? ` in ${stop.restaurantId}` : ""}: ${error.message}`,
    );
    throw new InternalServerErrorException(
      "Could not stop the calendar link of the person leaving, so nothing was changed. Try again.",
    );
  }

  const stopped = (data ?? []) as Array<{ id: string; restaurant_id: string }>;
  let audited = 0;
  for (const row of stopped) {
    try {
      const { error: auditErr } = await sb.from("system_audit_log").insert({
        actor_type: stop.actorUserId ? "user" : "system",
        actor_id: stop.actorUserId,
        action: "calendar_link_revoked",
        entity_type: "calendar_link",
        entity_id: row.id,
        // Never the secret or its hash.
        changes: {
          for_user_id: stop.userId,
          by: "leaving_house",
          via: stop.via,
        },
        restaurant_id: row.restaurant_id,
        reason: LEFT_HOUSE,
      });
      if (auditErr) {
        logger.error(
          `calendar link ${row.id} was stopped (${stop.via}) but the audit row failed: ${auditErr.message}`,
        );
      } else {
        audited += 1;
      }
    } catch (err: unknown) {
      logger.error(
        `calendar link ${row.id} was stopped (${stop.via}) but the audit row threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return { stopped: stopped.length, audited };
}
