/**
 * Where a verified session in a house goes next (r36 onboarding gap 3): a
 * current menu goes to the desk; a menu read and kept as a draft goes to
 * /menu, where it is made current (the desk used to take it as done); no
 * menu goes to /get-started. A gateway that names no current menu is read
 * as before (`menu_uploaded`).
 */
export function afterVerifyIn(
  progress: { menu_uploaded?: boolean | null; menu_current?: boolean | null } | null | undefined,
): '/' | '/menu' | '/get-started' {
  if (progress?.menu_current === true) return '/'
  if (!progress?.menu_uploaded) return '/get-started'
  return progress.menu_current === false ? '/menu' : '/'
}
