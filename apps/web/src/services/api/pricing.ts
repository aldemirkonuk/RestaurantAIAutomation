/**
 * A house's own price, its target margin, and advice toward it (ADR 0193).
 *
 * The founder, 2026-09-21: "... advise the manager or owner to increase
 * decrease the prices so that the profit margin is where it's needed. We don't
 * want market average because that will be already shown in another column."
 *
 * Every route here takes the house from the signed token; no restaurant id is
 * sent. The two writes are owner/manager only and the gateway refuses anyone
 * else (403) independently of any page.
 */
import { apiClient } from './client'

export type PriceKind = 'bottle' | 'glass'
export type AdviceState =
  | 'no_target'
  | 'pour_unconfirmed'
  | 'no_price'
  | 'no_cost'
  | 'on_target'
  | 'raise'
  | 'lower'

export interface PriceAdvice {
  kind: PriceKind
  state: AdviceState
  price: number | null
  unitCost: number | null
  currentMarginPct: number | null
  targetPct: number | null
  /** "Close enough", a PERCENT of the advised price (founder, 2026-09-21). */
  bandPct: number | null
  /** Set only for raise / lower: the exact price that reaches the target. */
  advisedPrice: number | null
  /** Today's price against the advised one, PERCENT of the advised price (negative = below). */
  gapPct: number | null
  sentence: string
  /**
   * ADR 0193 round 3: the lock that holds this price, when one does. A locked
   * price keeps its advice (a true margin is never hidden) but cannot be
   * accepted; it is changed only with "Change and keep locked" on /menu.
   */
  locked?: LockMark | null
}

/** Who holds a price, and since when. */
export interface LockMark {
  lockId: string
  lockedPrice: number
  lockedBy: string
  lockedAt: string
}

export interface WineAdvice {
  inventoryId: string
  wineName: string | null
  costBasis: string
  costBasisLabel: string
  bottleCost: number | null
  bottle: PriceAdvice | null
  glass: PriceAdvice | null
  /**
   * The pour the glass advice used (founder, 2026-09-21, round 6c: "Yes,
   * confirmed per wine"): the wine's own once an owner or manager confirmed
   * it, else the house's confirmed pour; null when neither is.
   */
  pour?: { ml: number | null; source: 'wine' | 'house' | null }
}

export interface HouseAdvice {
  restaurantId: string
  generatedAt: string
  target: {
    bottlePct: number | null
    glassPct: number | null
    bandPct: number | null
    set: boolean
    /** Glass advice waits until the house confirms its pour (founder, 2026-09-21). */
    pourConfirmed: boolean
    pourMl: number | null
  }
  wines: WineAdvice[]
  counts: Record<AdviceState, number>
  /** false = whether a price is locked is UNKNOWN (never "not locked"); accepting is refused. */
  locks?: { readable: boolean; reason: string | null; held: number }
}

export interface TargetMarginReadout {
  restaurantId: string
  bottlePct: number | null
  glassPct: number | null
  bandPct: number | null
  /** The house's pour: reported only once confirmed (before that it is the database's 150 ml default). */
  pour: {
    confirmed: boolean
    ml: number | null
    confirmedAt: string | null
    confirmedBy: { userId: string | null; name: string | null } | null
  }
  readable: boolean
  reason: string | null
  statedAt: string | null
  statedBy: { userId: string | null; name: string | null } | null
  audited?: boolean
  auditReason?: string | null
}

/** Per-wine advice. A failed read throws; the page says it could not be read. */
export async function getPriceAdvice(): Promise<HouseAdvice> {
  const { data } = await apiClient.get<HouseAdvice>('/pricing/advice')
  return data
}

/** One tap: apply the advice as shown. 409 when it is no longer what was shown. */
export async function acceptPriceAdvice(
  inventoryId: string,
  kind: PriceKind,
  advisedPrice: number
): Promise<{ outcome: 'changed' | 'unchanged' | 'stale'; kind: PriceKind; price: number; previousPrice: number | null }> {
  const { data } = await apiClient.post(`/pricing/advice/${inventoryId}/accept`, { kind, advisedPrice })
  return data
}

// ── One wine's own pour (founder, 2026-09-21, round 6c: "Yes, confirmed per wine") ──

export interface WinePourReadout {
  inventoryId: string
  wineName: string | null
  pour: { confirmed: boolean; ml: number | null; confirmedAt: string | null; confirmedBy: string | null }
  audited: boolean
  auditReason: string | null
}

/** Confirm this wine's pour in ml, or null to use the house's pour. Owner or manager. */
export async function confirmWinePour(inventoryId: string, pourMl: number | null): Promise<WinePourReadout> {
  const { data } = await apiClient.put<WinePourReadout>(`/pricing/wines/${inventoryId}/pour`, { pourMl })
  return data
}

// ── Price locks (ADR 0193 round 3; the founder, 2026-09-21: "add a section to
// that where you can lock price, but wha f that menu item disappears?") ──

/** A fact about an open lock, computed when it is read. Nothing expires on a timer. */
export type LockMarker =
  | 'off_target'
  | 'advice_unknown'
  | 'author_without_access'
  | 'not_on_current_menu'
  | 'no_current_menu'
  | 'wine_removed'
  | 'menu_differs'

export interface PriceLock {
  lockId: string
  inventoryId: string
  kind: PriceKind
  lockedPrice: number
  lockedAt: string
  ageDays: number
  note: string | null
  movedFromLockId: string | null
  lockedBy: { userId: string; name: string | null }
  wine: {
    name: string | null
    vintage: number | null
    masterWineId: string | null
    active: boolean | null
    housePrice: number | null
  }
  /**
   * Not on the current menu (or there is none). Kept, and applied again if the
   * wine comes back. null = unknown (the current menu or the wine could not be
   * read): in neither group, never guessed.
   */
  dormant: boolean | null
  menuPrice: number | null
  markers: LockMarker[]
  advice: { state: string; sentence: string; advisedPrice: number | null; gapPct: number | null } | null
  adviceUnknownReason: string | null
}

export interface LockReadout {
  restaurantId: string
  generatedAt: string
  /** false = the locks could not be read. Never "no locks". */
  readable: boolean
  reason: string | null
  scope: 'this house'
  currentMenus: Array<{ menuId: string; name: string | null }>
  locks: PriceLock[]
  counts: { open: number; onCurrentMenu: number; notOnCurrentMenu: number; toReview: number }
  namesReadable: boolean
  namesReason: string | null
  markersReadable: boolean
  markersReason: string | null
}

export interface LockActResult {
  outcome: 'locked' | 'released' | 'changed_and_locked' | 'moved' | 'unchanged'
  lock: { lockId: string; inventoryId: string; kind: PriceKind; lockedPrice: number }
  previousLockId: string | null
  housePrice: number | null
  /** One sentence the page shows as it is. */
  sentence: string
}

/** Every open lock of this house. A failed read answers readable:false, never an empty list. */
export async function listPriceLocks(): Promise<LockReadout> {
  const { data } = await apiClient.get<LockReadout>('/pricing/locks')
  return data
}

/** Hold this wine's price for one kind, as it is now. Owner or manager. */
export async function lockPrice(inventoryId: string, kind: PriceKind, note?: string): Promise<LockActResult> {
  const { data } = await apiClient.post<LockActResult>('/pricing/locks', {
    inventoryId,
    kind,
    ...(note ? { note } : {}),
  })
  return data
}

/** Release a lock. The price does not change. Owner or manager. */
export async function releasePriceLock(lockId: string, note?: string): Promise<LockActResult> {
  const { data } = await apiClient.post<LockActResult>(`/pricing/locks/${lockId}/release`, note ? { note } : {})
  return data
}

/** Change a locked price and keep it locked, in one act. Owner or manager. */
export async function changeLockedPrice(lockId: string, price: number, note?: string): Promise<LockActResult> {
  const { data } = await apiClient.post<LockActResult>(`/pricing/locks/${lockId}/change`, {
    price,
    ...(note ? { note } : {}),
  })
  return data
}

/** Move a lock to another wine of this house at a price the person names. Owner or manager. */
export async function movePriceLock(
  lockId: string,
  targetInventoryId: string,
  price: number,
  note?: string
): Promise<LockActResult> {
  const { data } = await apiClient.post<LockActResult>(`/pricing/locks/${lockId}/move`, {
    targetInventoryId,
    price,
    ...(note ? { note } : {}),
  })
  return data
}

export async function getTargetMargin(): Promise<TargetMarginReadout> {
  const { data } = await apiClient.get<TargetMarginReadout>('/pricing/target-margin')
  return data
}

export async function setTargetMargin(body: {
  bottlePct: number | null
  glassPct: number | null
  bandPct: number
}): Promise<TargetMarginReadout> {
  const { data } = await apiClient.put<TargetMarginReadout>('/pricing/target-margin', body)
  return data
}

/** Confirm the pour this house serves, once. Owner or manager; the gateway refuses anyone else. */
export async function confirmPourSize(pourMl: number): Promise<TargetMarginReadout> {
  const { data } = await apiClient.put<TargetMarginReadout>('/pricing/pour-size', { pourMl })
  return data
}
