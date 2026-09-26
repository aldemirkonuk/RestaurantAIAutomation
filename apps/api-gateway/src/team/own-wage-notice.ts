import { Logger } from "@nestjs/common";

/**
 * A manager who set their own wage tells the owner, and the trail says so
 * (founder, 2026-09-25, round 5 item 32: "a manager with pay access MAY set
 * their own wage, with a notification to the owner (and visible in the
 * report/audit trail)"; ADR 0215 item 21).
 *
 * Three records, each for a different reader:
 *
 *   team_member_wage_changes  the figures: old, new, currency, who, their role,
 *                             when. Written by the database trigger in the SAME
 *                             statement as the wage (migration 20260927150000),
 *                             so it cannot be skipped. Owner-read only.
 *   system_audit_log          `team_member_own_wage_set`: that it happened, who,
 *                             and whose row. It carries NO figure — the team
 *                             trail it feeds is readable by everyone in the
 *                             house, and a wage there would hand it to people
 *                             the money rule withholds it from.
 *   notifications             one in-app notice per active owner, WITH the
 *                             figures: an owner sees money always.
 *
 * Same shape and the same trade-off as `access-audit.ts`: a plain function,
 * never throws (the wage is already saved; the paper failing must not undo
 * it), and a receipt the caller returns to the client so a notice that did not
 * reach the owner is visible rather than assumed.
 */

export const OWN_WAGE_ACTION = "team_member_own_wage_set" as const;

export interface OwnWageChange {
  restaurantId: string;
  /** `public.users.user_id` of the manager who set it. */
  actorUserId: string;
  memberId: string;
  displayName: string | null;
  before: number | null;
  after: number | null;
  currency: string | null;
}

export interface OwnWageReceipt {
  /** The trail row reached `system_audit_log`. */
  audited: boolean;
  /** Owners told; 0 with `ownersFound: 0` means there was nobody to tell. */
  ownersNotified: number;
  /** Active owners of this house, or null when they could not be read. */
  ownersFound: number | null;
}

function money(v: number | null, currency: string | null): string {
  if (v == null) return "no wage";
  const n = Number(v).toFixed(2);
  return currency ? `${n} ${currency}` : n;
}

export async function recordOwnWageChange(
  sb: any,
  logger: Logger,
  change: OwnWageChange,
): Promise<OwnWageReceipt> {
  const receipt: OwnWageReceipt = {
    audited: false,
    ownersNotified: 0,
    ownersFound: null,
  };
  const who = change.displayName?.trim() || "A manager";

  try {
    const { error } = await sb.from("system_audit_log").insert({
      actor_type: "user",
      actor_id: change.actorUserId,
      action: OWN_WAGE_ACTION,
      entity_type: "team_member",
      entity_id: change.memberId,
      // A subject and no fields: the trail is house-wide, the figures are not.
      changes: { subject: `${who} (their own wage)` },
      restaurant_id: change.restaurantId,
      reason: null,
    });
    if (error) {
      logger.error(
        `${OWN_WAGE_ACTION} happened but the audit row failed to write: ${error.message}`,
      );
    } else {
      receipt.audited = true;
    }
  } catch (err: any) {
    logger.error(`${OWN_WAGE_ACTION}: the audit row threw — ${err?.message}`);
  }

  let owners: string[] = [];
  try {
    const { data, error } = await sb
      .from("user_restaurant_access")
      .select("user_id")
      .eq("restaurant_id", change.restaurantId)
      .eq("role", "owner")
      .eq("is_active", true);
    if (error) {
      logger.error(
        `${OWN_WAGE_ACTION}: the owners could not be read, so none was told — ${error.message}`,
      );
      return receipt;
    }
    owners = (data ?? [])
      .map((r: any) => r.user_id as string | null)
      .filter((id: string | null): id is string => !!id);
    receipt.ownersFound = owners.length;
  } catch (err: any) {
    logger.error(`${OWN_WAGE_ACTION}: the owners read threw — ${err?.message}`);
    return receipt;
  }

  const title = `${who} set their own wage`;
  const message = `${who} changed their own hourly wage on Team from ${money(change.before, change.currency)} to ${money(change.after, change.currency)}. A manager you allowed to see pay may do this; every wage change is kept with who made it.`;
  for (const ownerId of owners) {
    try {
      const { error } = await sb.from("notifications").insert({
        user_id: ownerId,
        // Legacy NOT-NULL columns still on the live notifications table.
        recipient_id: ownerId,
        notification_type: "system",
        channels: ["in_app"],
        restaurant_id: change.restaurantId,
        type: "system",
        title: title.slice(0, 500),
        message,
        priority: "high",
        status: "unread",
        action_url: "/team",
        action_label: "Open Team",
        metadata: {
          action: OWN_WAGE_ACTION,
          member_id: change.memberId,
          hourly_wage: { from: change.before, to: change.after },
          currency: change.currency,
        },
        created_at: new Date().toISOString(),
      });
      if (error) {
        logger.error(
          `${OWN_WAGE_ACTION}: owner ${ownerId} was not told — ${error.message}`,
        );
      } else {
        receipt.ownersNotified += 1;
      }
    } catch (err: any) {
      logger.error(`${OWN_WAGE_ACTION}: the notice threw — ${err?.message}`);
    }
  }
  return receipt;
}
