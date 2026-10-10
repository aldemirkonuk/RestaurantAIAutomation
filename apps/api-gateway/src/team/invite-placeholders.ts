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
 * - It has history (any row in `HISTORY_COLUMNS`: shifts, leave, wages,
 *   sales, credentials, availability, areas, crew notes, swaps, breaks) or it
 *   existed before the invite (an owner's own roster row the invite was
 *   attached to by email): it is kept, and only its link to the dead invite is
 *   cleared. Deleting it would take records with it — most of those tables
 *   still cascade from `team_members` — so whether such a person stays is the
 *   owner's call, made with Remove.
 *
 * Every write is pinned to `user_id IS NULL` and the same `invite_id`, so a
 * row that an acceptance claimed in the meantime is never touched. A failed
 * read or write is logged and leaves the row as it was: the stand-in staying
 * one more page load is better than a guess that deletes someone's record.
 *
 * Returns the ids of the rows it deleted.
 */

/**
 * Every column that holds a roster row's record. It is every foreign key to
 * `team_members` in `supabase/migrations` — the spec reads them and fails when
 * one is missing here — plus the four `member_id` columns that dropped or never
 * had theirs so the record outlives a removal (shifts and leave `20261201110200`,
 * credentials `20261201110210`, wages `20261201110000`).
 *
 * Each entry names its table a second time as a literal `.from("…")`, so
 * scripts/check_queried_tables_exist.py checks every one of them against the
 * migrations; a `.from(table)` over this list is a site that guard cannot read.
 * The spec fails if the two names in an entry ever differ.
 */
export const HISTORY_COLUMNS: ReadonlyArray<
  readonly [table: string, column: string, from: (sb: any) => any]
> = [
  ["shifts", "member_id", (sb) => sb.from("shifts")],
  ["time_off_requests", "member_id", (sb) => sb.from("time_off_requests")],
  ["team_member_wage_changes", "member_id", (sb) => sb.from("team_member_wage_changes")],
  ["team_certifications", "member_id", (sb) => sb.from("team_certifications")],
  // Cascade from team_members: a delete would take these with it.
  ["server_sales", "member_id", (sb) => sb.from("server_sales")],
  ["schedule_receipts", "member_id", (sb) => sb.from("schedule_receipts")],
  ["team_availability", "member_id", (sb) => sb.from("team_availability")],
  ["house_area_members", "member_id", (sb) => sb.from("house_area_members")],
  ["team_note_recipients", "member_id", (sb) => sb.from("team_note_recipients")],
  ["team_note_deliveries", "member_id", (sb) => sb.from("team_note_deliveries")],
  ["house_away_held", "member_id", (sb) => sb.from("house_away_held")],
  // Set to null by a delete: the record would lose who it was about.
  ["swap_requests", "from_member_id", (sb) => sb.from("swap_requests")],
  ["swap_requests", "to_member_id", (sb) => sb.from("swap_requests")],
  ["shift_breaks", "covered_by", (sb) => sb.from("shift_breaks")],
];

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
  for (const [, column, from] of HISTORY_COLUMNS) {
    const { count, error } = await from(sb)
      .select("*", { count: "exact", head: true })
      .eq(column, memberId);
    if (error || (count ?? 0) > 0) return true;
  }
  return false;
}
