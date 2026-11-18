/**
 * Where the house's menu stands, from the house's setup record, for the
 * pages that speak when this tab holds no first proof (/house, /house/menu).
 *
 * r36 onboarding gap 3: both said "Your menu is read and kept." from
 * `menu_uploaded` alone, so a menu kept as a draft read as done, and the way
 * to make it current showed only in the tab that read it. Stock and prices
 * come only from the current menu.
 *
 * - `current`: the house has a current menu (`menu_current`).
 * - `draft`: a menu was read and the house says it is not current.
 * - `read`: a menu was read, and this gateway does not say whether it is
 *   current (`menu_current` absent). Never guessed either way.
 * - `none`: no menu read, or the record could not be read.
 */
export type MenuKept = 'current' | 'draft' | 'read' | 'none'

/** The two facts read; `menu_current` is served by the setup read since #1413. */
export interface MenuFacts {
  menu_uploaded?: boolean | null
  menu_current?: boolean | null
}

export function menuKept(progress: MenuFacts | null | undefined): MenuKept {
  if (!progress) return 'none'
  if (progress.menu_current === true) return 'current'
  if (!progress.menu_uploaded) return 'none'
  return progress.menu_current === false ? 'draft' : 'read'
}
