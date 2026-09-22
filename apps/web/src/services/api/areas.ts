/**
 * House areas, lead marks and Away (ADR 0218).
 *
 * Every route is scoped by the house on the signed token, never by a path or a
 * body field: switching venue re-issues the token, so the token is the house.
 * The types mirror `apps/api-gateway/src/areas/house-areas.service.ts`.
 */
import { apiClient } from './client'

export const AREA_KINDS = ['kitchen', 'bar', 'floor', 'cellar', 'receiving', 'management'] as const
export type AreaKind = (typeof AREA_KINDS)[number]
/** What an alert, recommendation or notification carries. `null` = house-wide. */
export type AreaLabel = AreaKind | null
export type HouseRole = 'owner' | 'manager' | 'staff'

export interface AreaView {
  kind: AreaKind
  name: string
  defaultName: string
  enabled: boolean
  members: number
  leads: number
}

export interface MembershipView {
  memberId: string
  userId: string | null
  kind: AreaKind
  lead: boolean
}

export interface AreasReadout {
  role: HouseRole
  canManage: boolean
  inUse: boolean
  areas: AreaView[]
  memberships: MembershipView[]
  mine: { memberId: string | null; areas: AreaKind[]; leadOf: AreaKind[] }
}

export interface AwayView {
  userId: string
  /** YYYY-MM-DD, house-local, inclusive. */
  from: string
  until: string
  activeNow: boolean
  /**
   * The person set it themselves. Absent on a colleague's window when the
   * reader is staff: who set someone's dates is not theirs to know.
   */
  setBySelf?: boolean
  /**
   * This house's roster name for them, so a reader with no roster (staff) can
   * draw a colleague's marker. `null` when no roster row names them or the
   * names could not be read (`AwayReadout.namesReadable`).
   */
  name?: string | null
}

export interface AwayReadout {
  today: string
  /** The reader's role in this house (older gateways omit it). */
  role?: HouseRole
  canManage: boolean
  /**
   * Every Away window in the house that has not ended — staff see a
   * colleague's too (the founder's round-2 answer 5, 2026-09-21), dates only.
   */
  windows: AwayView[]
  /** `false`: the names could not be read, so every `name` is unknown — not absent. */
  namesReadable?: boolean
}

/**
 * May the reader set or end this person's Away? The gateway decides
 * (`house-areas.service.ts` `mayChangeAway`); this only keeps a control off a
 * row the gateway would refuse. The person themselves always; owners anyone;
 * managers anyone but an owner (only an owner sets or ends an owner's Away,
 * the founder's round-2 answer 7); staff nobody else.
 */
export function mayChangeAway(
  reader: { role: HouseRole | null | undefined; self: boolean },
  targetRole: string | null | undefined,
): boolean {
  if (reader.self) return true
  if (reader.role === 'owner') return true
  if (reader.role === 'manager') return String(targetRole ?? '').toLowerCase() !== 'owner'
  return false
}

/** The house log's receipt for a change: was it filed, was the person told. */
export interface ChangeReceipt {
  audited: boolean
  notified: boolean
}

/**
 * An answer that is not the shape the page reads is a failed read, never an
 * empty house: a proxy's HTML page or an older gateway without these routes
 * must not render as "nobody is in any area" or "nobody is away".
 */
function shaped<T>(data: unknown, ok: (d: any) => boolean, what: string): T {
  if (data && typeof data === 'object' && ok(data)) return data as T
  throw new Error(`${what} came back in a shape this page cannot read`)
}

export async function getAreas(): Promise<AreasReadout> {
  const { data } = await apiClient.get<AreasReadout>('/house/areas')
  return shaped<AreasReadout>(
    data,
    (d) => Array.isArray(d.areas) && Array.isArray(d.memberships) && !!d.mine,
    'The areas',
  )
}

export async function setArea(kind: AreaKind, body: { name?: string; enabled?: boolean }) {
  const { data } = await apiClient.patch<{ changed: boolean; receipt: ChangeReceipt | null }>(
    `/house/areas/${kind}`,
    body,
  )
  return data
}

export async function setMembership(kind: AreaKind, memberId: string, body: { lead?: boolean } = {}) {
  const { data } = await apiClient.put<{ membership: MembershipView; receipts: ChangeReceipt[] }>(
    `/house/areas/${kind}/members/${memberId}`,
    body,
  )
  return data
}

export async function removeMembership(kind: AreaKind, memberId: string) {
  const { data } = await apiClient.delete<{ removed: true; receipt: ChangeReceipt }>(
    `/house/areas/${kind}/members/${memberId}`,
  )
  return data
}

export async function getAway(): Promise<AwayReadout> {
  const { data } = await apiClient.get<AwayReadout>('/house/away')
  return shaped<AwayReadout>(
    data,
    (d) => Array.isArray(d.windows) && typeof d.today === 'string',
    'Away dates',
  )
}

export async function setAway(userId: string, body: { from: string; until: string }) {
  const { data } = await apiClient.put<{ window: AwayView; receipt: ChangeReceipt | null }>(
    `/house/away/${userId}`,
    body,
  )
  return data
}

export async function endAway(userId: string) {
  const { data } = await apiClient.delete<{ ended: true; receipt: ChangeReceipt | null }>(
    `/house/away/${userId}`,
  )
  return data
}

/**
 * "Your areas first, the rest of the house below" — the web twin of the
 * gateway's `splitForViewer`. Nothing is removed. Owners, managers and anyone
 * in no area get the list back unchanged (`yours` empty).
 */
export function splitByMyAreas<T>(
  items: readonly T[],
  labelOf: (item: T) => AreaLabel,
  viewer: { role: HouseRole; areas: readonly AreaKind[] },
): { yours: T[]; rest: T[] } {
  if (viewer.role !== 'staff' || viewer.areas.length === 0) return { yours: [], rest: [...items] }
  const mine = new Set(viewer.areas)
  const yours: T[] = []
  const rest: T[] = []
  for (const item of items) {
    const label = labelOf(item)
    if (label !== null && mine.has(label)) yours.push(item)
    else rest.push(item)
  }
  return { yours, rest }
}
