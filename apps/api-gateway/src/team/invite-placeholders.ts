import { Logger } from "@nestjs/common";

/**
 * The roster row an invitation made, once the invitation can never be used.
 *
 * Minting an invite writes a `team_members` row with `invite_id` set and no
 * `user_id` (`AuthService.ensureTeamMemberForInvite`), so the person shows on
 * /team as "no account yet" before they accept. When the invite is revoked or
 * expires (on its own clock, or because its inviter was removed,
 * `cancel-house-invites.ts`), nothing took that row away, so /team kept
 * counting someone who will never arrive and let them be scheduled (F-580).
 *
 * What happens to the row, row by row:
 * - It was made FOR this invite (created at or after the invite) and has no
 *   history: it is deleted. It was only ever a stand-in.
 * - It has history (shifts, leave, wage changes, sales, credentials, schedule
 *   receipts) or it existed before the invite (an owner's own roster row the
 *   invite was attached to by email): it is kept, and only its link to the
 *   dead invite is cleared. Deleting it would take records with it —
 *   `server_sales` and `schedule_receipts` still cascade from `team_members`
 *   (baseline `:13462`, `:13478`) — so whether such a person stays is the
 *   owner's call, made with Remove.
 *
 * Every write is pinned to `user_id IS NULL` and the same `invite_id`, so a
 * row that an acceptance claimed in the meantime is never touched. A failed
 * read or write is logged and leaves the row as it was: the stand-in staying
 * one more page load is better than a guess that deletes someone's record.
 *
 * Returns the ids of the rows it deleted.
 */

/** Tables that hold a person's record by `member_id`. */
const HISTORY_TABLES = [
  "shifts",
  "time_off_requests",
  "team_member_wage_changes",
  "server_sales",
  "schedule_receipts",
  "team_certifications",
] as const;

export interface DeadInvite {
  id: string;
  created_at: string | null;
}

export async function retireInvitePlaceholders(
  sb: any,
  logger: Logger,
  restaurantId: string,
  invites: DeadInvite[],
): Promise<Set<string>> {
  const deleted = new Set<string>();
  for (const invite of invites) {
    const { data: rows, error } = await sb
      .from("team_members")
      .select("id, created_at")
      .eq("restaurant_id", restaurantId)
      .eq("invite_id", invite.id)
      .is("user_id", null);
    if (error) {
      logger.warn(
        `retireInvitePlaceholders could not read the roster rows of invite ` +
          `${invite.id} in ${restaurantId}, so they are left: ${error.message}`,
      );
      continue;
    }
    for (const row of rows ?? []) {
      const madeForInvite =
        !!invite.created_at &&
        !!row.created_at &&
        Date.parse(row.created_at) >= Date.parse(invite.created_at);
      const keep = !madeForInvite || (await hasHistory(sb, row.id));
      const scoped = (q: any) =>
        q
          .eq("id", row.id)
          .eq("restaurant_id", restaurantId)
          .eq("invite_id", invite.id)
          .is("user_id", null);
      const { error: writeErr } = keep
        ? await scoped(sb.from("team_members").update({ invite_id: null }))
        : await scoped(sb.from("team_members").delete());
      if (writeErr) {
        logger.warn(
          `retireInvitePlaceholders could not ${keep ? "unlink" : "remove"} ` +
            `roster row ${row.id} of invite ${invite.id}: ${writeErr.message}`,
        );
      } else if (!keep) {
        deleted.add(row.id);
      }
    }
  }
  return deleted;
}

/**
 * The roster rows whose invitation has lapsed — expired and never used — out of
 * a roster read, retired as above. A row whose invite cannot be found is left
 * alone: before F-580 a revoke deleted the invite outright, and with it the
 * date that says whether the row was made for it.
 */
export async function retireLapsedInvitePlaceholders(
  sb: any,
  logger: Logger,
  restaurantId: string,
  members: Array<{ id: string; invite_id?: string | null; user_id?: string | null }>,
): Promise<Set<string>> {
  const inviteIds = [
    ...new Set(
      members
        .filter((m) => m.invite_id && !m.user_id)
        .map((m) => m.invite_id as string),
    ),
  ];
  if (inviteIds.length === 0) return new Set();
  const { data: invites, error } = await sb
    .from("organization_invites")
    .select("id, created_at, expires_at, used_at")
    .eq("restaurant_id", restaurantId)
    .in("id", inviteIds);
  if (error) {
    logger.warn(
      `retireLapsedInvitePlaceholders could not read the invites of ` +
        `${restaurantId}, so their roster rows are left: ${error.message}`,
    );
    return new Set();
  }
  const now = Date.now();
  const lapsed = (invites ?? []).filter(
    (i: any) => !i.used_at && !!i.expires_at && Date.parse(i.expires_at) <= now,
  );
  return retireInvitePlaceholders(sb, logger, restaurantId, lapsed);
}

/** Any record held for this roster row. A read that fails counts as history. */
async function hasHistory(sb: any, memberId: string): Promise<boolean> {
  for (const table of HISTORY_TABLES) {
    const { count, error } = await sb
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("member_id", memberId);
    if (error || (count ?? 0) > 0) return true;
  }
  return false;
}
