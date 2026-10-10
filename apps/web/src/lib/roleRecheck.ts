/**
 * Ask the session to read its role in this house again (F-930).
 *
 * The role is read once per house (AuthContext). An owner who demotes or
 * promotes someone mid-shift changed it on the server, and the API already
 * answers per request from the database, but the open page kept the old desk
 * until a reload. Three things now say "your role may have changed", and each
 * one only asks; AuthContext decides when to read:
 *
 *  - a 403 refusal that is not about the house or the email (those have their
 *    own codes and their own pages): the server said no to something this page
 *    offered, which is what a changed role looks like from here;
 *  - the "Your role in this restaurant changed" notice arriving
 *    (`member_role_changed`, members.service.ts);
 *  - the tab being shown again (AuthContext listens for that itself).
 */

export const ROLE_RECHECK_EVENT = 'mudavym:role-recheck';

/** The 403 codes that already have their own answer, and are not a role. */
const NOT_A_ROLE_REFUSAL = new Set(['HOUSE_REQUIRED', 'EMAIL_NOT_VERIFIED']);

export function askRoleRecheck(): void {
  try {
    window.dispatchEvent(new Event(ROLE_RECHECK_EVENT));
  } catch {
    // No window (a test without a DOM): nothing on screen to correct.
  }
}

/**
 * A 403 that may mean the person's role changed under the page. The role read
 * itself is left out, so a refused read cannot ask for itself again.
 */
export function isRoleRefusal(error: {
  response?: { status?: number; data?: unknown };
  config?: { url?: string };
}): boolean {
  if (error.response?.status !== 403) return false;
  if (error.config?.url?.includes('/auth/me/role')) return false;
  const code = (error.response.data as { code?: unknown } | undefined)?.code;
  return !(typeof code === 'string' && NOT_A_ROLE_REFUSAL.has(code));
}

/** The action the gateway files on the notice a person gets when their role changes. */
export const ROLE_CHANGED_NOTICE = 'member_role_changed';

/**
 * True when these notices hold a role-change notice not seen before; the ones
 * seen are remembered in `seen`, so a notice left unread asks once, not on
 * every poll.
 */
export function newRoleChangeNotice(
  rows: ReadonlyArray<{ id?: string; metadata?: Record<string, unknown> | null }>,
  seen: Set<string>,
): boolean {
  let fresh = false;
  for (const r of rows) {
    if (r?.metadata?.action !== ROLE_CHANGED_NOTICE || !r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    fresh = true;
  }
  return fresh;
}
