/**
 * Does this address hold Team's invite sheet open? `/settings?invite=1` (the
 * first-menu page's "Invite your people", or the Invite someone button, which
 * sets the same param) opens it, and closing the sheet drops the param.
 *
 * The layout's one-time theme ask (`GroundFirstChoice`) reads this and waits,
 * so the person who asked to invite meets the terms (when due), then the
 * invite sheet, then the theme, one at a time (ADR 0112, one topmost overlay;
 * r109 onboarding walk Finding 1).
 */
export const INVITE_PARAM = 'invite';

export function opensInviteSheet(pathname: string, search: string): boolean {
  if (!pathname.startsWith('/settings')) return false;
  return new URLSearchParams(search).get(INVITE_PARAM) === '1';
}
