/**
 * Menus API Service
 *
 * Handles menu import and onboarding progress API calls.
 * All three import methods (scan, csv, manual) use the same POST endpoint.
 */

import { apiClient, getActiveRestaurantId } from './client'
import { houseGroupMark } from '../../hooks/useHouseGroupMark'

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
  priceSync?: 'changed' | 'unchanged' | 'stale' | 'locked' | 'no_price' | 'not_linked' | 'not_current' | 'failed'
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
  /** A CSV or workbook's column headings that were not read, as written (F-070). */
  unreadColumns?: string[]
  /** A spreadsheet read: the columns not read (as in unreadColumns), the rows skipped and why, the cells unread. */
  read?: MenuReadNotes | null
  /** Why a photo or PDF was read only in part; null or absent when it was read whole (F-1292). */
  partRead?: string | null
  /**
   * Client-only: when several files were sent at once, what each one gave (its
   * lines, or why it was not read). The lines of every read file are in `items`.
   */
  files?: MenuFileResult[]
}

export interface MenuReadNotes {
  ignoredColumns: string[]
  dropped: Array<{ row: number; reason: string }>
  unreadable: string[]
}

export type MenuFileResult =
  | { name: string; itemsExtracted: number; read?: MenuReadNotes | null; partRead?: string | null }
  | { name: string; failure: string }

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
  /** The house has a current menu (a draft read is not one, F-1061). */
  menu_current?: boolean
  /** menu_current AND threshold_configured — the soft-gate "done enough" signal. */
  activated: boolean
}

type MenuImportData =
  | { imageBase64: string; csvContent?: never; items?: never; fileBase64?: never }
  | { csvContent: string; imageBase64?: never; items?: never; fileBase64?: never }
  | { items: WineExtractItem[]; imageBase64?: never; csvContent?: never; fileBase64?: never }
  | { fileBase64: string; imageBase64?: never; csvContent?: never; items?: never }

/**
 * How long the web waits for a menu read. The gateway's model read alone may
 * run 180 s (scan-parser.service.ts: a 199-wine list measured 73 s), and the
 * read is kept and billed whether or not anyone is still waiting, so the
 * default 30 s gave up on reads that then landed, and each re-upload was
 * read, billed and kept again (F-567).
 */
export const MENU_IMPORT_TIMEOUT_MS = 300_000

export async function importMenu(
  method: 'scan' | 'csv' | 'manual',
  data: MenuImportData,
  labels: MenuReadLabels = {}
): Promise<MenuImportResult> {
  // The backend DTO requires restaurantId (@IsUUID(), no @IsOptional) with a
  // global forbidNonWhitelisted ValidationPipe — omitting it 400s before the
  // import ever runs. X-Restaurant-Id header alone is not read by the DTO.
  const restaurantId = getActiveRestaurantId()
  // F-947: a file's price like "1.250" is read by the house's mark when the
  // file itself does not settle it. Unknown is not sent, and is then refused.
  const groupMark = method === 'csv' ? await houseGroupMark() : null
  const response = await apiClient.post<MenuImportResult>('/menus/import', {
    method,
    data,
    restaurantId,
    // Sent only when the person gave them: a missing tag stays missing.
    ...(labels.cadence ? { cadence: labels.cadence } : {}),
    ...(labels.menuDate ? { menuDate: labels.menuDate } : {}),
    ...(groupMark ? { groupMark } : {}),
  }, { timeout: MENU_IMPORT_TIMEOUT_MS })
  return response.data
}

export async function reviewMenuItem(
  menuItemId: string,
  fieldName: EditableMenuItemField,
  newValue: string
): Promise<
  { menuItemId: string; fieldName: string; newValue: string } & Pick<
    MenuImportReviewItem,
    'priceSync' | 'priceSyncError' | 'priceHeld'
  >
> {
  const response = await apiClient.patch(`/menus/items/${menuItemId}`, { fieldName, newValue })
  return response.data
}

export async function addMenuItem(
  menuId: string,
  item: WineExtractItem
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
  /** Why the line is flagged, in the gateway's note (F-151); /menu says it in plain words. */
  review_notes?: string | null
  /** Blank menu price: the house kept its last known one, or had none either; a manager can change it. */
  price_flag?: 'blank_kept_last_known' | 'blank_no_house_price' | null
  price_flag_note?: string | null
  created_at: string
  /**
   * This house's own price for the linked wine (`menu_price_current` /
   * `menu_price_glass`) -- what Inventory, Reports and the till read. Absent
   * when the line links no wine of this house or the prices were not read;
   * null when the house has none. It can differ from the line's (F-618).
   */
  house_bottle_price?: number | null
  house_glass_price?: number | null
}

export interface ActiveMenu {
  menuId: string | null
  name: string | null
  status: string | null
  items: MenuLine[]
  /** false = this house's own prices could not be read, so no difference is marked. */
  housePricesReadable?: boolean
  housePricesReason?: string | null
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

/**
 * A line taken off the current menu. `prior_status` is what it goes back to
 * when it is put back; null means it was taken off before that was kept, and
 * it comes back as in review.
 */
export interface DiscardedLine extends Omit<MenuLine, 'status'> {
  status: 'discarded'
  prior_status: MenuLine['status'] | null
}

/** The lines taken off the current menu (F-268), for an owner or a manager. */
export async function getDiscardedLines(restaurantId: string): Promise<{ items: DiscardedLine[] }> {
  const response = await apiClient.get<{ items: DiscardedLine[] }>(`/menus/${restaurantId}/discarded`)
  return response.data
}

/** Puts a discarded line back on the menu, at the status it had (F-268). */
export async function restoreMenuItem(
  restaurantId: string,
  menuItemId: string
): Promise<{ menuItemId: string; status: MenuLine['status'] }> {
  const response = await apiClient.patch<{ menuItemId: string; status: MenuLine['status'] }>(
    `/menus/${restaurantId}/items/${menuItemId}/restore`,
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

/** How many items the house carries now — owner or manager only (F-1059). */
export async function getCarriedCount(): Promise<number> {
  const response = await apiClient.get<{ carried: number }>('/onboarding/threshold')
  return Number(response.data?.carried ?? 0)
}

/**
 * Saves the house's low-stock number. It reaches items added from now on;
 * `applyToCarried` also sets it on every item carried now (F-1059).
 */
export async function setDefaultThreshold(
  thresholdMin: number,
  applyToCarried = false,
): Promise<{ default_threshold_min: number; threshold_configured: true; applied_to_carried?: number }> {
  const restaurantId = getActiveRestaurantId()
  const response = await apiClient.patch('/onboarding/threshold', {
    restaurantId,
    thresholdMin,
    ...(applyToCarried ? { applyToCarried: true } : {}),
  })
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
  /** Why only part of this menu was read; null when it was read whole (F-1292). Optional only for an older gateway. */
  partRead?: string | null
  status: 'active' | 'draft' | 'archived' | string
  current: boolean
  cadence: MenuCadence | null
  menuDate: string | null
  menuDatePrecision: 'day' | 'month' | null
  sourceMethod: 'scan' | 'csv' | 'manual' | null
  source: { kept: boolean; mime: string | null; bytes: number | null; failure: string | null }
  linesExtracted: number | null
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
  /** The house's IANA zone: every date here is printed as the house's day (F-699). Null when unset. */
  timezone?: string | null
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
  | 'kitchen'
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
  // 'kitchen' (F-1297) is absent from a reply sent before kitchen lines had their own result.
  counts: Record<Exclude<PlanResult, 'kitchen'>, number> & { kitchen?: number }
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
  /**
   * The current menu this choice takes off, and how many lines leave with it
   * (F-696): the house has one current menu, so choosing this one ends that
   * one. Empty when this menu is already current or none is. Optional only
   * for an older gateway.
   */
  retiring?: Array<{ menuId: string; name: string | null; lines: number }>
  /**
   * Why only part of this menu was read; null when it was read whole. The
   * gateway refuses to make it current unless the person confirms (F-1292).
   */
  partRead?: string | null
  namesReadable: boolean
  namesReason: string | null
  /** The house's IANA zone, for printing dates as the house's day (F-699). */
  timezone?: string | null
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

/**
 * Make a kept menu the current one, naming the plan the person was shown.
 * Owner or manager; the gateway refuses anyone else (403), a missing
 * fingerprint (400) and a plan that changed since it was shown (409).
 */
export async function makeMenuCurrent(
  menuId: string,
  fingerprint: string,
  partReadAccepted = false,
): Promise<MakeCurrentResult> {
  const response = await apiClient.post<MakeCurrentResult>(
    `/menu-versions/${menuId}/make-current`,
    partReadAccepted ? { fingerprint, partReadAccepted } : { fingerprint },
  )
  return response.data
}
