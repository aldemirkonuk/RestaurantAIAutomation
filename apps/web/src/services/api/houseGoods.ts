import { apiClient, getActiveRestaurantId } from './client'

/** What `POST /inventory/:rid/house-items` hands back (#862). */
export interface HouseGood {
  id: string
  kind: string
  uom: string
  displayName: string
}

/**
 * Carry a good the wine library does not hold, from a paper line (r21). Its
 * own file so the receipts stack does not collide with the inventory stack's
 * `carryHouseItem` (same route, #862). A 409 carries `existingId`, which the
 * caller pairs with instead of adding a twin.
 */
export async function addHouseGood(
  body: { kind: string; uom: string; displayName: string },
  restaurantId?: string,
): Promise<HouseGood> {
  const id = restaurantId || getActiveRestaurantId()
  if (!id) throw new Error('No restaurant ID available')
  const response = await apiClient.post<HouseGood>(`/inventory/${id}/house-items`, body)
  return response.data
}

/** The id of the good a 409 says this house already carries, or null. */
export function existingGoodId(error: unknown): string | null {
  const r = (error as { response?: { status?: number; data?: { existingId?: unknown } } } | null)?.response
  return r?.status === 409 && typeof r.data?.existingId === 'string' ? r.data.existingId : null
}

/**
 * Carry the good, then pair the line with it. A 409 pairs with the good the
 * house already carries under that name (never a twin); any other refusal
 * pairs nothing and comes back as the sentence to show.
 */
export async function carryThenPair(
  body: { kind: string; uom: string; displayName: string },
  add: (b: { kind: string; uom: string; displayName: string }) => Promise<HouseGood>,
  pair: (goodId: string) => Promise<void>,
  why: (err: unknown) => string,
): Promise<{ refused: string | null; note: string | null }> {
  let goodId: string
  let note: string | null = null
  try {
    goodId = (await add(body)).id
  } catch (err) {
    const existing = existingGoodId(err)
    if (!existing) return { refused: `${body.displayName} was not added, and the line is not paired: ${why(err)}`, note: null }
    goodId = existing
    note = `This house already carries ${body.displayName}, so the line is paired with it.`
  }
  await pair(goodId)
  return { refused: null, note }
}
