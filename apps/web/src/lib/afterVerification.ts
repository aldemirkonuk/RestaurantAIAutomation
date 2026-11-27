/**
 * Where a freshly verified person goes, decided from what the server says
 * they hold (`GET /auth/houses`), never from the token alone: an account whose
 * invite join was held for an unproved address has no house in its token, and
 * sending it on to open a first house would make it the owner of a stray one.
 * The same rule as the phone (`routeAfterVerificationFromHouses`).
 *
 * The web has no `/open-house` page: a verified account with no house opens
 * its first one on `/get-started` (ADR 0213), which is where this sends it.
 */

export interface HouseRead {
  houses: unknown[]
  held: unknown[]
}

/**
 * The answer body of `GET /auth/houses`, or null when it is not that shape, so
 * the caller says the read failed instead of treating silence as "no houses"
 * (ADR 0020). An older gateway that sends no `held` has nothing waiting.
 */
export function readHouseAnswer(body: unknown): HouseRead | null {
  if (!body || typeof body !== 'object') return null
  const { houses, held } = body as { houses?: unknown; held?: unknown }
  if (!Array.isArray(houses)) return null
  return { houses, held: Array.isArray(held) ? held : [] }
}

/**
 * Nothing held and no house: open one. A session already in a house with
 * nothing waiting goes on as before (`null`: the caller reads the menu
 * progress). Everything else is the chooser, which is also where a held
 * membership is accepted.
 */
export function routeAfterVerificationFromHouses(
  read: HouseRead,
  sessionHasHouse: boolean,
): '/get-started' | '/choose-house' | null {
  if (read.houses.length === 0 && read.held.length === 0) return '/get-started'
  if (sessionHasHouse && read.held.length === 0) return null
  return '/choose-house'
}
