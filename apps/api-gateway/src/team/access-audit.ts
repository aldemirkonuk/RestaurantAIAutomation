import { Logger } from "@nestjs/common";

/**
 * A change to somebody's access files itself, and tells them.
 *
 * Two operations change what a person can see of a restaurant: removal
 * (`TeamService.deleteMember` — deletes their `user_restaurant_access` row) and
 * a role change (`MembersService.updateMemberRole` — two bare UPDATEs). Before
 * ADR 0088 neither left a trace: no audit row, no notice to the person, no
 * before/after capture. A manager could remove someone and nobody could later
 * find out who did it, and the person learned by discovering they were locked
 * out.
 *
 * The founder's decision was **record it, do not restrict it**: removal stays
 * manager-gated.
 *
 * WHY A PLAIN FUNCTION AND NOT A PROVIDER
 * ---------------------------------------
 * The two call sites live in different Nest modules. `RestaurantsModule`
 * imports only `DatabaseModule` and `AuthModule`, so a provider would mean
 * editing that module (and `TeamModule` exporting into it) to share five lines
 * of insert. A module-free function keeps both paths on ONE shape — which is
 * the whole point, since two implementations of "record the change" is the
 * defect this closes wearing a different hat.
 *
 * The cost, stated: the notification is written straight into `notifications`
 * rather than through `NotificationsService.createNotification`, so the live
 * websocket emit does not fire. The row is durable and the inbox shows it on
 * the next fetch. `NotificationsService` is not reachable from
 * `MembersService` without the module edit above, and one path with a socket
 * and one without would be the same two-paths fault.
 *
 * ACTOR IDENTITY
 * --------------
 * `actor_id` is `public.users.user_id` — the id the JWT carries.
 * `auth.users` and `public.users` are DISJOINT in this database (zero shared
 * ids), so an id taken from the other table would dangle and **CI could not
 * catch it**: a fresh test database has no rows to violate.
 * `system_audit_log.actor_id` carries no FK at all (baseline
 * `20260805000000_baseline_from_production.sql:13618` declares only
 * `restaurant_id`), so the wrong id would simply never resolve.
 */

export interface AccessChange {
  restaurantId: string;
  /** `public.users.user_id` of the person doing it. Never an `auth.users` id. */
  actorUserId: string;
  /** `public.users.user_id` of the person it happens to, when they have an account. */
  targetUserId: string | null;
  action: "team_member_removed" | "member_role_changed";
  entityType: "team_member" | "restaurant_member";
  entityId: string;
  /** Before → after, as it will be read back off the /logs timeline. */
  changes: Record<string, unknown>;
  /** One sentence for the person it happened to. Omitted → no notice sent. */
  notice?: { title: string; message: string };
}

export interface AccessChangeReceipt {
  /** The audit row reached `system_audit_log`. */
  audited: boolean;
  /** The person was told. `false` also when they have no account to tell. */
  notified: boolean;
}

/**
 * Write the audit row and the notice. Never throws: the access change itself
 * has already happened by the time this runs, and undoing it because the
 * paper failed would be worse than filing the failure loudly. The receipt is
 * returned to the caller **and returned to the client** so a failed record is
 * visible rather than inferred from an empty log.
 */
export async function recordAccessChange(
  sb: any,
  logger: Logger,
  change: AccessChange,
): Promise<AccessChangeReceipt> {
  const receipt: AccessChangeReceipt = { audited: false, notified: false };

  try {
    const { error } = await sb.from("system_audit_log").insert({
      actor_type: "user",
      actor_id: change.actorUserId,
      action: change.action,
      entity_type: change.entityType,
      entity_id: change.entityId,
      changes: change.changes,
      restaurant_id: change.restaurantId,
      reason: null,
    });
    if (error) {
      logger.error(
        `${change.action} happened but the audit row failed to write: ${error.message}`,
      );
    } else {
      receipt.audited = true;
    }
  } catch (err: any) {
    logger.error(
      `${change.action} happened but the audit row threw: ${err?.message}`,
    );
  }

  if (change.notice && change.targetUserId) {
    try {
      const { error } = await sb.from("notifications").insert({
        user_id: change.targetUserId,
        // Legacy NOT-NULL columns still on the live notifications table.
        recipient_id: change.targetUserId,
        notification_type: "system",
        channels: ["in_app"],
        restaurant_id: change.restaurantId,
        type: "system",
        title: change.notice.title.slice(0, 500),
        message: change.notice.message,
        priority: "high",
        status: "unread",
        action_url: null,
        action_label: null,
        metadata: { action: change.action, changes: change.changes },
        created_at: new Date().toISOString(),
      });
      if (error) {
        logger.error(
          `${change.action}: the person was not told — ${error.message}`,
        );
      } else {
        receipt.notified = true;
      }
    } catch (err: any) {
      logger.error(`${change.action}: the notice threw — ${err?.message}`);
    }
  }

  return receipt;
}
