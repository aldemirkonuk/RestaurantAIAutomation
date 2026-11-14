/**
 * Menus API Service
 *
 * Handles menu import and onboarding progress API calls.
 * All three import methods (scan, csv, manual) use the same POST endpoint.
 */

import { apiClient, getActiveRestaurantId } from './client'

export interface WineExtractItem {
  name: string
  producer?: string
  category?: string
  vintage?: string
  region?: string
  grape_variety?: string
  by_glass_price?: number
  bottle_price?: number
  raw_text?: string
}

export interface MenuImportReviewItem {
  menuItemId: string
  submissionId: string | null
  name: string
  producer: string | null
  category: string | null
  vintage: string | null
  region: string | null
  grapeVariety: string | null
  byGlassPrice: number | null
  bottlePrice: number | null
  rawText: string | null
  matched: boolean
  needsReview: boolean
  /** Present only when the extractor already returned a box. Never invented. */
  bbox?: {
    x: number
    y: number
    width: number
    height: number
    page?: number
    pageWidth?: number
    pageHeight?: number
  } | null
  /**
   * What this line did to the house's own bottle/glass price (ADR 0193:
   * a menu update changes the house price). `failed` carries the reason in
   * `priceSyncError`; the page says so rather than implying the price moved.
   */
  priceSync?: 'changed' | 'unchanged' | 'stale' | 'locked' | 'no_price' | 'not_linked' | 'not_current' | 'kitchen_line' | 'failed'
  priceSyncError?: string | null
  /**
   * Set when a blank menu price kept the house's last known one (founder,
   * 2026-09-21), or when the line shows no price for a wine the house has no
   * price for either (round 6c: "Flag it").
   */
  priceFlag?: 'blank_kept_last_known' | 'blank_no_house_price' | null
  priceFlagNote?: string | null
  /** ADR 0193 round 3: every kind a price lock held, with its lock. */
  priceHeld?: HeldKind[]
  /**
   * Set when two or more of the house's own goods fit this line (name, kind,
   * vintage and size): none was guessed, and the line went to the library
   * (r28 G21). An owner or a manager links it with linkMenuLineToHouseGood.
   */
  houseCandidates?: HouseCandidate[]
}

/** One of the house's own goods a read line fits (gateway `HouseCandidate`). */
export interface HouseCandidate {
  inventoryItemId: string
  name: string
  kind: string | null
}

/**
 * A menu read is KEPT as its own version, in draft (ADR 0193, menu versions):
 * it is not the current menu and has not touched the house's prices until an
 * owner or manager makes it current.
 */
export interface MenuImportResult {
  menuId: string
  current?: false
  itemsExtracted: number
  submissionsCreated: number
  items: MenuImportReviewItem[]
  /** Client-only: the page photo from this session, if we still have it. */
  sourceImage?: string | null
  /** Whether the source file (photo, PDF, CSV) was kept, and why not when it was not. */
  source?: { kept: boolean; failure: string | null }
  /** The parts of the file a scan could not read (ADR 0213 #17). */
  warnings?: MenuReadWarning[]
}

/**
 * Why a scan holds fewer lines than its file (gateway `MenuReadWarning`).
 * `pages` is 1-based, or null when no narrower range is known.
 */
export interface MenuReadWarning {
  kind: 'truncated' | 'chunk_failed' | 'page_cap' | 'unreadable_reply' | string
  pages: { first: number; last: number } | null
}

/** One plain sentence for one warning, naming its pages when they are known. */
export function readWarningSentence(w: MenuReadWarning): string {
  const p = w.pages
  const one = !!p && p.first === p.last
  const pages = p ? (one ? `Page ${p.first}` : `Pages ${p.first}–${p.last}`) : null
  const was = one ? 'was' : 'were'
  const them = one ? 'it' : 'them'
  switch (w.kind) {
    case 'chunk_failed':
      return pages
        ? `${pages} could not be read; send ${them} again.`
        : 'Part of this file could not be read; send it again.'
    case 'truncated':
      return pages
        ? `${pages} ${was} cut off partway, so some lines may be missing; send ${them} again as a smaller file.`
        : 'The reading was cut off partway, so some lines may be missing; send the menu again in smaller files.'
    case 'page_cap':
      return pages
        ? `${pages} ${was} not read, because only the first ${p!.first - 1} pages of a file are read; send ${them} as a file of ${them === 'it' ? 'its' : 'their'} own.`
        : 'Pages past the first 120 were not read; send them as a file of their own.'
    case 'unreadable_reply':
      return pages
        ? `${pages} came back in a form that could not be read; send ${them} again.`
        : 'The reading came back in a form that could not be read; send the file again.'
    default:
      return 'Part of this file may not have been read; send it again.'
  }
}

export const MENU_CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly', 'none'] as const
export type MenuCadence = (typeof MENU_CADENCES)[number]

/** Optional labels a person may give a menu when it is read. Never defaulted. */
export interface MenuReadLabels {
  cadence?: MenuCadence
  /** A day (YYYY-MM-DD) or just a month (YYYY-MM). */
  menuDate?: string
}

export type MenuImportSuccess = (
  result: MenuImportResult,
  source?: { image?: string | null },
) => void

export type EditableMenuItemField =
  | 'name'
  | 'producer'
  | 'category'
  | 'vintage'
  | 'region'
  | 'grape_variety'
  | 'by_glass_price'
  | 'bottle_price'

export interface OnboardingProgress {
  id: string
  user_id: string
  restaurant_id: string
  menu_uploaded: boolean
  vendor_added: boolean
  team_member_invited: boolean
  checklist_dismissed: boolean
  completed_at: string | null
  /** Whether restaurants.default_threshold_min has been explicitly confirmed. */
  threshold_configured: boolean
  /** menu_uploaded AND threshold_configured — the soft-gate "done enough" signal. */
  activated: boolean
}

type MenuImportData =
  | { imageBase64: string; csvContent?: never; items?: never; fileBase64?: never }
  | { csvContent: string; imageBase64?: never; items?: never; fileBase64?: never }
  | { items: WineExtractItem[]; imageBase64?: never; csvContent?: never; fileBase64?: never }
  | { fileBase64: string; imageBase64?: never; csvContent?: never; items?: never }

export async function importMenu(
  method: 'scan' | 'csv' | 'manual',
  data: MenuImportData,
  labels: MenuReadLabels = {}
): Promise<MenuImportResult> {
  // The backend DTO requires restaurantId (@IsUUID(), no @IsOptional) with a
  // global forbidNonWhitelisted ValidationPipe — omitting it 400s before the
  // import ever runs. X-Restaurant-Id header alone is not read by the DTO.
  const restaurantId = getActiveRestaurantId()
  const response = await apiClient.post<MenuImportResult>('/menus/import', {
    method,
    data,
    restaurantId,
    // Sent only when the person gave them: a missing tag stays missing.
    ...(labels.cadence ? { cadence: labels.cadence } : {}),
    ...(labels.menuDate ? { menuDate: labels.menuDate } : {}),
  })
  return response.data
}

/**
 * One field of one line, corrected. A price correction on the CURRENT menu also
 * moves the house's own price (ADR 0193) and says what happened in `priceSync`;
 * `newValue` is what was stored ("45,50" comes back "45.5").
 */
export interface MenuItemCorrection {
  menuItemId: string
  fieldName: string
  newValue: string
  priceSync?: MenuImportReviewItem['priceSync']
  priceSyncError?: string | null
  priceHeld?: HeldKind[]
}

export async function reviewMenuItem(
  menuItemId: string,
  fieldName: EditableMenuItemField,
  newValue: string
): Promise<MenuItemCorrection> {
  const response = await apiClient.patch(`/menus/items/${menuItemId}`, { fieldName, newValue })
  return response.data
}

export async function addMenuItem(
  menuId: string,
  // by_glass_typed / bottle_typed: a price as the person typed it, read by the
  // gateway's parseMenuPrice (r28 G7). Send these or the numbers, not both.
  item: WineExtractItem & { by_glass_typed?: string; bottle_typed?: string }
): Promise<MenuImportReviewItem> {
  const response = await apiClient.post<MenuImportReviewItem>('/menus/items', {
    menuId,
    ...item,
  })
  return response.data
}

/** One line of the active menu, as `GET /menus/:restaurantId` returns it. */
export interface MenuLine {
  id: string
  name: string
  producer: string | null
  category: string | null
  vintage: string | null
  region: string | null
  country: string | null
  grape_variety: string | null
  by_glass_price: number | null
  bottle_price: number | null
  wine_library_id: string | null
  inventory_item_id: string | null
  source: 'scan' | 'csv' | 'manual'
  status: 'approved' | 'flagged' | 'in_review'
  /** Blank menu price: the house kept its last known one, or had none either; a manager can change it. */
  price_flag?: 'blank_kept_last_known' | 'blank_no_house_price' | null
  price_flag_note?: string | null
  /**
   * Why `status` is 'flagged', from the gateway's own notes (menu-line-view.ts
   * `flagReasonOf`); null when it is not. Absent from an older gateway.
   */
  flag_reason?: 'corrected' | 'added_by_hand' | 'past_free_limit' | 'unknown' | null
  /** For a correction: the field a manager corrected. */
  flag_field?: string | null
  created_at: string
  /**
   * The gateway's kitchen split (menu-line-view.ts isKitchenLine), sent to every
   * member: a dish on the menu, never carried to the house. Absent from an older
   * gateway; the page then works it out with the same test.
   */
  kitchen_line?: boolean
  /**
   * The house's own price for the good this line is linked to (Inventory, Your
   * price), sent with the current menu only (r28 G11). It can differ from the
   * menu's printed price: changed on Inventory since, held by a lock, or not
   * carried. `removed`: the good is removed or inactive on Inventory. Absent on
   * a line with no link, and from an older gateway.
   */
  house_price?: { bottle: number | null; glass: number | null; removed: boolean }
}

export interface ActiveMenu {
  menuId: string | null
  name: string | null
  status: string | null
  items: MenuLine[]
  /**
   * How many MORE menus of this house are marked current (r28 G20): a house
   * can hold several from before choosing a menu archived the rest, and the
   * gateway shows the one made current last. Absent when there is one.
   */
  otherCurrent?: number
  /** Set when the house's own prices could not be read: no line then carries `house_price`. */
  housePricesUnreadable?: string
}

/**
 * The active menu and its items — `/menu`'s read path (ADR 0160 sec110 item
 * 7). `menuId: null` means this restaurant has no active menu row yet
 * (nothing has been imported or created) — a different fact from "an empty
 * menu", and the page distinguishes them.
 */
export async function getMenu(restaurantId: string): Promise<ActiveMenu> {
  const response = await apiClient.get<ActiveMenu>(`/menus/${restaurantId}`)
  return response.data
}

/**
 * Soft-removes one line (status -> 'discarded'; migration 20260922230100).
 * Never a DELETE — the row and what it cost stays in the record.
 */
export async function discardMenuItem(
  restaurantId: string,
  menuItemId: string
): Promise<{ menuItemId: string; status: 'discarded' }> {
  const response = await apiClient.patch<{ menuItemId: string; status: 'discarded' }>(
    `/menus/${restaurantId}/items/${menuItemId}/discard`,
    {}
  )
  return response.data
}

export async function getOnboardingProgress(): Promise<OnboardingProgress | null> {
  try {
    const response = await apiClient.get<OnboardingProgress>('/onboarding/progress')
    return response.data
  } catch (error: any) {
    if (error?.response?.status === 404) return null
    throw error
  }
}

export async function updateOnboardingProgress(
  update: Partial<OnboardingProgress>
): Promise<void> {
  await apiClient.patch('/onboarding/progress', update)
}

export async function getVendorEmail(): Promise<{ address: string | null }> {
  const response = await apiClient.get<{ address: string | null }>('/onboarding/vendor-email')
  return response.data
}

export async function setDefaultThreshold(
  thresholdMin: number
): Promise<{ default_threshold_min: number; threshold_configured: true }> {
  const restaurantId = getActiveRestaurantId()
  const response = await apiClient.patch('/onboarding/threshold', { restaurantId, thresholdMin })
  return response.data
}

// ── Menu versions (ADR 0193; founder, 2026-09-21) ─────────────────────────

export interface MenuPerson {
  userId: string
  name: string | null
}

/** One kept menu. Fields a legacy menu never recorded are null, never a guess. */
export interface MenuVersion {
  menuId: string
  name: string | null
  status: 'active' | 'draft' | 'archived' | string
  current: boolean
  cadence: MenuCadence | null
  menuDate: string | null
  menuDatePrecision: 'day' | 'month' | null
  sourceMethod: 'scan' | 'csv' | 'manual' | null
  source: { kept: boolean; mime: string | null; bytes: number | null; failure: string | null }
  linesExtracted: number | null
  /** null = read before warnings were recorded; [] = none of the four kinds happened. */
  readWarnings?: MenuReadWarning[] | null
  extractedAt: string | null
  extractedBy: MenuPerson | null
  madeCurrentAt: string | null
  madeCurrentBy: MenuPerson | null
  retiredAt: string | null
  retiredBy: MenuPerson | null
  createdAt: string | null
}

export interface MenuVersions {
  current: MenuVersion | null
  lastUsed: MenuVersion | null
  versions: MenuVersion[]
  /** false = who read or chose these menus could not be named (the reason says why). */
  namesReadable?: boolean
  namesReason?: string | null
}

/** A kind a price lock held, and the lock (ADR 0193 round 3). */
export interface HeldKind {
  kind: 'bottle' | 'glass'
  lockId: string
  lockedPrice: number | null
  lockedBy: string | null
  lockedAt: string | null
}

export interface MakeCurrentResult {
  outcome: 'made_current' | 'already_current'
  menuId: string
  previousMenuIds: string[]
  /** The moment of the choice: every price this menu set is dated by it. */
  madeCurrentAt?: string | null
  lines: number
  /** Lines per outcome. The page prints every key it receives, a key it does not know included. */
  priceSync: Record<string, number>
  flagged: number
  failed: Array<{ menuItemId: string; name: string; error: string }>
  /** Every kind a lock held, named (never only counted). */
  held?: Array<HeldKind & { menuItemId: string; name: string }>
  /** Locked wines that came back with this menu. */
  returned?: Array<{ menuItemId: string; name: string }>
}

/** What choosing a menu WOULD do, per line and per kind (ADR 0193 round 3, L13). */
export type PlanResult =
  | 'change'
  | 'unchanged'
  | 'held_by_lock'
  | 'blank_kept'
  | 'blank_never_priced'
  | 'not_linked'
  | 'new_wine'

export interface PlanPerson {
  userId: string | null
  name: string | null
}

export interface PlanKind {
  kind: 'bottle' | 'glass'
  menuPrice: number | null
  housePrice: number | null
  result: PlanResult
  lastSet: { by: PlanPerson; at: string | null; source: string | null } | null
  /**
   * A person set this wine's price (by hand, or by accepting advice) after
   * this menu was read. The founder, 2026-09-21: "The menu sets it, locks
   * keep" -- the menu replaces it, and the plan lists it first with a Keep.
   * Optional only for an older gateway; absent reads as false.
   */
  setAfterRead?: boolean
  lock: { lockId: string; lockedPrice: number; lockedBy: PlanPerson; lockedAt: string } | null
}

export interface PlanLine {
  menuItemId: string
  name: string
  producer: string | null
  vintage: string | null
  wineLibraryId: string | null
  inventoryId: string | null
  house: { wineName: string | null; vintage: number | null; active: boolean } | null
  bottle: PlanKind
  glass: PlanKind
  flag: 'blank_kept_last_known' | 'blank_no_house_price' | null
  returned: boolean
  vintageMismatch: boolean
}

export interface MenuPlan {
  menuId: string
  current: boolean
  /** When this menu was read; null when it is not recorded. Optional only for an older gateway. */
  readAt?: string | null
  generatedAt: string
  /** make-current requires it, and refuses (409) when the plan changed since. */
  fingerprint: string
  lines: PlanLine[]
  counts: Record<PlanResult, number>
  dormantLocks: Array<{
    lockId: string
    inventoryId: string
    kind: 'bottle' | 'glass'
    lockedPrice: number
    lockedBy: PlanPerson
    lockedAt: string
    wineName: string | null
    active: boolean | null
  }>
  namesReadable: boolean
  namesReason: string | null
  /**
   * Lines set aside as kitchen lines: they stay on the menu and are carried
   * nowhere (no wine, price or stock). Optional only for an older gateway.
   */
  kitchenLines?: Array<{ menuItemId: string; name: string }>
  /**
   * Wines on the menu being replaced that this menu does not carry ("not on this
   * file"). Shown only: choosing the menu leaves their price, row and locks as
   * they are (ADR 0193 L12). Optional only for an older gateway.
   */
  notOnThisFile?: Array<{
    menuItemId: string
    name: string
    producer: string | null
    vintage: string | null
    wineLibraryId: string | null
    inventoryId: string | null
    bottle: number | null
    glass: number | null
    locked: Array<'bottle' | 'glass'>
    /** False when the house deleted or set inactive its row; null with no row. Optional for an older gateway. */
    active?: boolean | null
  }>
}

/** What choosing this menu would do. Nothing is written. A failed read throws. */
export async function getMenuPlan(menuId: string): Promise<MenuPlan> {
  const response = await apiClient.get<MenuPlan>(`/menu-versions/${menuId}/plan`)
  return response.data
}

/** Every menu this house has read (the house comes from the token). A failed read throws. */
export async function listMenuVersions(): Promise<MenuVersions> {
  const response = await apiClient.get<MenuVersions>('/menu-versions')
  return response.data
}

/** A five-minute link to a kept menu's source file. 404 (with why) when none was kept. */
export async function getMenuSourceUrl(
  menuId: string
): Promise<{ url: string; expiresInSeconds: number; mime: string | null }> {
  const response = await apiClient.get(`/menu-versions/${menuId}/source`)
  return response.data
}

/** How long choosing a menu may take before the page stops waiting: two minutes. */
export const MAKE_CURRENT_TIMEOUT_MS = 120_000

/**
 * Make a kept menu the current one, naming the plan the person was shown.
 * Owner or manager; the gateway refuses anyone else (403), a missing
 * fingerprint (400) and a plan that changed since it was shown (409).
 */
/**
 * Link one line of a kept (not current) menu to one of the house's own goods
 * (r28 G21) -- owner or manager only. The menu's plan changes, so a plan shown
 * before is refused at make-current and is read again.
 */
export async function linkMenuLineToHouseGood(
  menuId: string,
  menuItemId: string,
  inventoryItemId: string,
): Promise<{ menuItemId: string; inventoryItemId: string; goodName: string }> {
  const response = await apiClient.patch<{ menuItemId: string; inventoryItemId: string; goodName: string }>(
    `/menu-versions/${menuId}/items/${menuItemId}/house-good`,
    { inventoryItemId },
  )
  return response.data
}

export async function makeMenuCurrent(menuId: string, fingerprint: string): Promise<MakeCurrentResult> {
  // The switch commits before the prices are carried, so this call is never
  // cut off at the client's usual 30 s while the gateway is still writing
  // (r28 G1): a long menu gets its answer, whatever it is.
  const response = await apiClient.post<MakeCurrentResult>(
    `/menu-versions/${menuId}/make-current`,
    { fingerprint },
    { timeout: MAKE_CURRENT_TIMEOUT_MS },
  )
  return response.data
}
