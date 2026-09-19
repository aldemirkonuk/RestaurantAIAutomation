/**
 * Who may grant which role in a house. ADR 0162, the founder's words
 * 2026-09-18: "Managers grant manager or staff".
 *
 *   owner    grants owner, manager or staff
 *   manager  grants manager or staff, never owner
 *   staff    grants nothing
 *   anything else, or nothing, grants nothing and cannot be granted
 *
 * ONE rule for both doors a person comes in by: an invitation
 * (`AuthService.generateInvite`, POST /auth/invite) and being added directly
 * (`MembersService.addMember`). Until this record the two disagreed: the
 * invitation let a manager mint an owner's invite (v3.0-TECH-DEBT 44.1h), and
 * adding refused a manager who added a manager. Two copies of one rule is how
 * that happened, so there is one copy.
 *
 * The caller reads the granter's role IN THE HOUSE being granted into. This
 * file only ranks; it never decides which house.
 */

const STAFF = 1;
const MANAGER = 2;
const OWNER = 3;

/**
 * A Map, not an object literal. `rank["constructor"]` on a literal is a
 * function, not undefined, so an inherited key slips past a `??` default and
 * compares as NaN, which refuses nothing. `Map.get` answers only its own
 * entries.
 */
const ROLE_RANK: ReadonlyMap<string, number> = new Map([
  ["staff", STAFF],
  ["manager", MANAGER],
  ["owner", OWNER],
]);

function rankOf(role: unknown): number | null {
  return typeof role === "string" ? (ROLE_RANK.get(role) ?? null) : null;
}

/** The roles a granter of this rank may grant, highest first, as prose. */
function grantable(granterRank: number): string {
  const roles = [...ROLE_RANK]
    .filter(([, rank]) => rank <= granterRank)
    .sort(([, a], [, b]) => b - a)
    .map(([role]) => role);
  return roles.length > 1
    ? `${roles.slice(0, -1).join(", ")} or ${roles[roles.length - 1]}`
    : roles[0];
}

/**
 * Why `granter` may not grant `granted`, or null when they may.
 *
 * `granter` is the granter's role in the house, as the caller read it; a
 * missing or unknown one grants nothing. `act` only words the refusal.
 */
export function grantRefusal(
  granter: unknown,
  granted: unknown,
  act: "invite" | "add",
): string | null {
  const granterRank = rankOf(granter);
  if (granterRank === null || granterRank < MANAGER) {
    return `Only an owner or a manager of this house can ${act} someone.`;
  }
  const grantedRank = rankOf(granted);
  if (grantedRank === null || grantedRank > granterRank) {
    const not = grantedRank === null ? "" : `, not as ${String(granted)}`;
    return `As ${String(granter)} of this house you can ${act} someone as ${grantable(granterRank)}${not}.`;
  }
  return null;
}
