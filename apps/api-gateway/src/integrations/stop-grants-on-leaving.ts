import { InternalServerErrorException, Logger } from "@nestjs/common";

/**
 * A person who leaves a house stops being that house's mailbox (F-458).
 *
 * Every Google or Microsoft grant the person made while working in the house
 * (`integration_oauth_connections.restaurant_id` = the house) is stopped here,
 * locally: `revoked_at` is set and the stored tokens are wiped, so no letter
 * leaves from their mailbox and no reply is read from it in the house's name.
 * Before this, no removal door touched the table: a removed manager's Gmail
 * kept sending the house's letters and the inbox kept reading their mail
 * until an owner found the grant on /connections and stopped it by hand.
 *
 * The same doors and the same order as `calendar/stop-links-on-leaving.ts`
 * (ADR 0111, round 6t, the precedent this follows): each removal door calls
 * this AFTER its refusal checks and BEFORE its first membership write, so a
 * refused removal stops nothing, and a stop that fails throws before anything
 * else changed. `AuthService.leaveRestaurant` and `AuthService.deleteAccount`
 * both leave through `MembersService.removeMember`, so they are covered there.
 * A membership that ends anywhere else is caught at `getAccessToken`, which
 * refuses a grant whose owner no longer works in the house.
 *
 * WHAT IT DOES NOT DO, ON PURPOSE (decision note
 * `reconcile/member-removal-decisions.md`):
 *   - It does not call Google. Google's revoke ends the whole grant the person
 *     gave Mudavym's client, every scope, so it would also stop what they
 *     connected in another house. Wiping our copy of the tokens is what makes
 *     this house unable to use it; the person can still withdraw consent from
 *     their own Google account.
 *   - It does not run the raw-mail sweep `disconnect` runs (ADR 0118 D15). The
 *     person did not revoke anything; the house ended a membership. Deleting
 *     the house's mirrored mail on that is the stronger choice ADR 0118 Q9
 *     declined for the house's own cut-off; the D13 window sweep still applies.
 */

export interface GrantLeavingStop {
  /** The house left. */
  restaurantId: string;
  /** `public.users.user_id` of the person leaving. */
  userId: string;
  /** Whoever made them leave (themselves on a leave). */
  actorUserId: string | null;
  /** Which door, as it will read on the audit row. */
  via: string;
}

export interface GrantLeavingReceipt {
  stopped: number;
  audited: number;
}

/** The audit `reason` a leaving stop writes. */
export const GRANT_LEFT_HOUSE = "left_house";

export async function stopGrantsOnLeaving(
  sb: any,
  logger: Logger,
  stop: GrantLeavingStop,
  now: Date = new Date(),
): Promise<GrantLeavingReceipt> {
  const at = now.toISOString();
  const { data, error } = await sb
    .from("integration_oauth_connections")
    .update({
      revoked_at: at,
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      token_expires_at: null,
      updated_at: at,
    })
    .eq("user_id", stop.userId)
    .eq("restaurant_id", stop.restaurantId)
    .is("revoked_at", null)
    .select("id, integration_id, restaurant_id");

  if (error) {
    logger.error(
      `${stop.via}: could not stop the connected accounts of ${stop.userId} in ${stop.restaurantId}: ${error.message}`,
    );
    throw new InternalServerErrorException(
      "Could not stop the mailbox and files the person leaving connected for this restaurant, so nothing was changed. Try again.",
    );
  }

  const stopped = (data ?? []) as Array<{
    id: string;
    integration_id: string;
    restaurant_id: string;
  }>;
  let audited = 0;
  for (const row of stopped) {
    try {
      const { error: auditErr } = await sb.from("system_audit_log").insert({
        actor_type: stop.actorUserId ? "user" : "system",
        actor_id: stop.actorUserId,
        action: "integration_grant_stopped",
        entity_type: "integration_grant",
        entity_id: row.id,
        // Never a token.
        changes: {
          for_user_id: stop.userId,
          integration_id: row.integration_id,
          by: "leaving_house",
          via: stop.via,
        },
        restaurant_id: row.restaurant_id,
        reason: GRANT_LEFT_HOUSE,
      });
      if (auditErr) {
        logger.error(
          `grant ${row.id} was stopped (${stop.via}) but the audit row failed: ${auditErr.message}`,
        );
      } else {
        audited += 1;
      }
    } catch (err: unknown) {
      logger.error(
        `grant ${row.id} was stopped (${stop.via}) but the audit row threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return { stopped: stopped.length, audited };
}
