/**
 * `team_members.position` is the person's job title, never their access role
 * (coordinator call, sim wave 68: F-931, F-932). The access role lives on
 * `user_restaurant_access.role` and the roster prints it next to the title, so
 * a title copied from the role says the same thing twice, and the two drift
 * apart the first time the role changes ("Staff · manager").
 */

/**
 * The words the roster used to copy from the access role into `position`.
 * A position still holding the old role's word is that copy, not a title
 * anyone chose, and a role change clears it (`MembersService.updateMemberRole`).
 */
export function roleWordPosition(
  role: string | null | undefined,
): string | null {
  switch ((role ?? "").trim().toLowerCase()) {
    case "owner":
      return "Owner";
    case "manager":
      return "Manager";
    case "staff":
      return "Staff";
    default:
      return null;
  }
}

/**
 * The role a person tapped on arrival (`user_restaurant_access.job_role`,
 * F-899), in the words of the chip they tapped (`GetStarted.tsx`). Nothing
 * tapped is no title, never a title made from the access role.
 */
export function positionFromJobRole(
  jobRole: string | null | undefined,
): string | null {
  switch (jobRole) {
    case "owner":
      return "Owner";
    case "general_manager":
      return "General manager";
    case "beverage_lead":
      return "Beverage lead";
    case "chef":
      return "Chef";
    default:
      return null;
  }
}
