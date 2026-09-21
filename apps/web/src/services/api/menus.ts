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
  matched: boolean
  needsReview: boolean
  /**
   * What this line did to the house's own bottle/glass price (ADR 0193:
   * a menu update changes the house price). `failed` carries the reason in
   * `priceSyncError`; the page says so rather than implying the price moved.
   */
  priceSync?: 'changed' | 'unchanged' | 'stale' | 'no_price' | 'not_linked' | 'not_current' | 'failed'
  priceSyncError?: string | null
  /** Set when a blank menu price kept the house's last known one (founder, 2026-09-21). */
  priceFlag?: 'blank_kept_last_known' | null
  priceFlagNote?: string | null
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
  /** Whether the source file (photo, PDF, CSV) was kept, and why not when it was not. */
  source?: { kept: boolean; failure: string | null }
}

export const MENU_CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly', 'none'] as const
export type MenuCadence = (typeof MENU_CADENCES)[number]

/** Optional labels a person may give a menu when it is read. Never defaulted. */
export interface MenuReadLabels {
  cadence?: MenuCadence
  /** A day (YYYY-MM-DD) or just a month (YYYY-MM). */
  menuDate?: string
}

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

export async function reviewMenuItem(
  menuItemId: string,
  fieldName: EditableMenuItemField,
  newValue: string
): Promise<{ menuItemId: string; fieldName: string; newValue: string }> {
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
  /** Blank menu price, house kept its last known one; a manager can change it. */
  price_flag?: 'blank_kept_last_known' | null
  price_flag_note?: string | null
  created_at: string
}

export interface ActiveMenu {
  menuId: string | null
  name: string | null
  status: string | null
  items: MenuLine[]
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
 * Soft-removes one line (status -> 'discarded'; migration 20260921112100).
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
}

export interface MakeCurrentResult {
  outcome: 'made_current' | 'already_current'
  menuId: string
  previousMenuIds: string[]
  lines: number
  priceSync: Record<string, number>
  flagged: number
  failed: Array<{ menuItemId: string; name: string; error: string }>
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

/** Make a kept menu the current one. Owner or manager; the gateway refuses anyone else (403). */
export async function makeMenuCurrent(menuId: string): Promise<MakeCurrentResult> {
  const response = await apiClient.post<MakeCurrentResult>(`/menu-versions/${menuId}/make-current`, {})
  return response.data
}
