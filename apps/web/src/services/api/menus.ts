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

/**
 * The setup of the house the session is in (OB-1). The house facts are read
 * from the house's own tables on every GET; only `checklist_dismissed` is the
 * person's own. An invitee with no row of their own still gets the house's
 * facts (id null), never a 404.
 */
export interface OnboardingProgress {
  /** The person's own row, or null when they have none yet (most invitees). */
  id: string | null
  user_id: string
  restaurant_id: string
  /** A kept menu (not archived) with at least one live line. */
  menu_uploaded: boolean
  /** The house's CURRENT menu has at least one live line. */
  menu_current: boolean
  vendor_added: boolean
  team_member_invited: boolean
  /** This person answered "No team yet" and the house has no invite. Absent from an older gateway. */
  no_team_yet?: boolean
  checklist_dismissed: boolean
  /** When the last of current menu, supplier and invite (or, with none, this person's "No team yet") held; null while one is missing (derived, not remembered). */
  completed_at: string | null
  /** Reported only; it no longer gates activation (no screen sets it). */
  threshold_configured: boolean
  /** The house has a current menu with a live line: stock and prices come from it. */
  activated: boolean
  /**
   * What leads past the menu to the house's costs (r28 gap 3). Never part of
   * setup: they decide neither `completed_at` nor `activated`. `null` = that
   * read failed (not "not done"). Absent from an older gateway.
   */
  next_steps?: OnboardingNextSteps
}

export interface OnboardingNextSteps {
  /** An active good on the house's list. */
  goods_listed: boolean | null
  /**
   * An active good someone has counted. The first current menu puts its
   * drinks on the list uncounted, so this, not goods_listed, is the count
   * step. Absent from an older gateway.
   */
  goods_counted?: boolean | null
  /** A live Gmail grant held for this house (sending or reading). */
  mailbox_connected: boolean | null
  /**
   * A live Gmail grant to send, held for this house: a letter written in
   * Mail leaves from the house's address. Orders do not (they leave from
   * Mudavym's mailbox in the house's name). Absent from an older gateway.
   */
  mailbox_sends?: boolean | null
  /**
   * The house's mailbox is read: a live Gmail reading grant held for this
   * house AND its reading switch on. Then what the house's vendors send to
   * that address comes into Mail. Absent from an older gateway; null when
   * its read failed.
   */
  mailbox_reads?: boolean | null
  /** "checked" once an invoice is verified, "waiting" while one is in, else "none". */
  invoice: 'none' | 'waiting' | 'checked' | null
  /**
   * The house states its money. With none, an invoice that names no money
   * and comes with no order puts no cost on. Absent from an older gateway;
   * null when its read failed.
   */
  money_set?: boolean | null
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
  /** Blank menu price: the house kept its last known one, or had none either; a manager can change it. */
  price_flag?: 'blank_kept_last_known' | 'blank_no_house_price' | null
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
export async function makeMenuCurrent(menuId: string, fingerprint: string): Promise<MakeCurrentResult> {
  const response = await apiClient.post<MakeCurrentResult>(`/menu-versions/${menuId}/make-current`, { fingerprint })
  return response.data
}
