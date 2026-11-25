import { listMenuVersions, type MenuVersions } from '../services/api/menus'

/**
 * Where a house's menu stands, for an owner who comes back to /get-started
 * (r28 onboarding gap 14: a house whose menu is already current was offered
 * "One last step · Your menu" again, and a read there made one more draft).
 * The help links ("App usage guide", "The app guide", "Open the
 * getting-started guide") all land on /get-started, so this is every owner
 * who asks for the guide after setup.
 *
 * - `current`: the house has a current menu. Nothing is left to read here.
 * - `draft`: a menu was read, with lines, and kept as a draft. It is chosen
 *   on /menu; a read here would make another draft beside it.
 * - `none`: nothing usable was read yet (or only an empty read).
 * - `unread`: the menus could not be read just now. The page goes on as it
 *   did before: never a guessed "current".
 */
export type HouseMenuStanding = 'current' | 'draft' | 'none' | 'unread'

/** Pure: the standing a menu history shows. */
export function standingOf(read: MenuVersions | null | undefined): HouseMenuStanding {
  if (!read || !Array.isArray(read.versions)) return 'unread'
  if (read.current) return 'current'
  const kept = read.versions.some(
    (version) =>
      (version.linesExtracted ?? 0) > 0 && !version.retiredAt && version.status !== 'archived',
  )
  return kept ? 'draft' : 'none'
}

/** One read of the house's menus (the house comes from the token). Never throws. */
export async function readHouseMenuStanding(): Promise<HouseMenuStanding> {
  try {
    return standingOf(await listMenuVersions())
  } catch {
    return 'unread'
  }
}
