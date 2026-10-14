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
  /**
   * ADR 0340 rule 4: with the split on (MENUS_SPLIT_BY_KIND), one read makes
   * one draft per kind it found, read together. Absent when the split is off.
   */
  drafts?: Array<{ menuId: string; kind: MenuKind | string | null; items?: unknown[] }>
  readTogetherId?: string | null
}

/**
 * The kinds a house keeps one live menu of (ADR 0340 rule 1). A legacy menu
 * type (full, bar, events) is never one of them and never goes live.
 */
export const MENU_KINDS = ['beverage', 'food', 'desserts'] as const
export type MenuKind = (typeof MENU_KINDS)[number]

/** A kind in the house's words: Drinks, Food, Desserts. Null for a kind it does not know. */
export function kindName(kind: string | null | undefined): string | null {
  if (kind === 'beverage') return 'Drinks'
  if (kind === 'food') return 'Food'
  if (kind === 'desserts') return 'Desserts'
  return null
}

export function isMenuKind(kind: unknown): kind is MenuKind {
  return typeof kind === 'string' && (MENU_KINDS as readonly string[]).includes(kind)
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
  /** A dish's one price (ADR 0340 rule 7); the gateway refuses it on a drink (F-1671). */
  | 'price'

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
  /** The linked wine is 86'd (an open stock-out, F-145); absent otherwise. */
  sold_out?: true
  /**
   * F-1474: a cocktail line is sold out because these recipe lines' stock is
   * 86'd, in the bar's words; absent otherwise.
   */
  sold_out_because?: string[]
  /** ADR 0340: the live menu this line is on, its kind, and its section. Absent from an older gateway. */
  menu_id?: string
  menu_type?: string | null
  section_id?: string | null
  line_kind?: 'drink' | 'dish' | null
  drink_category?: string | null
  /** A dish's own price (a dish has no bottle or glass). */
  price?: number | null
}

export interface ActiveMenu {
  menuId: string | null
  name: string | null
  status: string | null
  items: MenuLine[]
  /** false = this house's own prices could not be read, so no difference is marked. */
  housePricesReadable?: boolean
  housePricesReason?: string | null
  /** False when which drinks are sold out could not be read (F-145); none is marked then. */
  soldOutReadable?: boolean
  soldOutReason?: string | null
  /** Every live menu, one per kind, in Drinks, Food, Desserts order (ADR 0340 rule 25). */
  kinds?: Array<{ menuId: string; kind: string | null; name: string | null; status: string }>
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

/**
 * How many items the house carries now (F-1059) and its low-stock number as
 * saved, or the number new items get when none is saved (F-1414). Owner or
 * manager only. A number the gateway did not send is null, not a guess.
 */
export async function getLowStockSetting(): Promise<{ carried: number; defaultThresholdMin: number | null }> {
  const response = await apiClient.get<{ carried: number; default_threshold_min?: number | null }>(
    '/onboarding/threshold',
  )
  const saved = response.data?.default_threshold_min
  return {
    carried: Number(response.data?.carried ?? 0),
    defaultThresholdMin: typeof saved === 'number' && Number.isFinite(saved) ? saved : null,
  }
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
  /** ADR 0340: the menu's kind, and whether its carry wrote every line. Absent from an older gateway. */
  kind?: string | null
  carryFinished?: boolean
}

export interface MenuVersions {
  current: MenuVersion | null
  /** The live menu of each kind; null for a kind with none (ADR 0340 rule 1). */
  currentByKind?: Record<string, MenuVersion | null>
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
  /** Per menu of a batch (ADR 0340 rule 4). Absent from an older gateway. */
  menus?: Array<{
    menuId: string
    kind: string | null
    outcome: 'made_current' | 'already_current'
    madeCurrentAt: string | null
    recarried: boolean
    carryFinished: boolean
    lines: number
  }>
  /** How many conflicts the owner's picks answered. */
  picked?: number
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
  | 'cocktail'
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
  /** ADR 0340: the batch menu this line is on, its kind, line kind and section. Absent from an older gateway. */
  menuId?: string
  menuKind?: string | null
  lineKind?: string | null
  sectionId?: string | null
  /** A dish beside the same dish on its kind's live menu (by section key and name); display only. */
  dish?: { price: number | null; livePrice: number | null; changed: boolean } | null
}

/** One menu of a make-live batch, as the plan reads it (ADR 0340 rules 18, 20). */
export interface PlanMenu {
  menuId: string
  kind: string | null
  current: boolean
  partRead: string | null
  lines: number
  /** Unsure lines on it, and conflicts one of its lines is in. A current menu blocks nothing. */
  unsure: number
  conflicts: number
}

/** A live line no menu of the batch lists: it leaves unless kept (rule 18, "Gone"). */
export interface GoneLine {
  menuId: string
  menuItemId: string
  name: string
  kind: string | null
  sectionKey: string | null
}

export interface UnsureLine {
  menuId: string
  menuItemId: string
  name: string
  reason: 'kind_not_decided' | 'no_drink_category'
}

/** One wine at two prices of one price kind across what would be live (rule 19). */
export interface PriceConflict {
  wineLibraryId: string
  inventoryId: string | null
  kind: 'bottle' | 'glass'
  name: string
  prices: Array<{ price: number; menuId: string; menuItemId: string; live: boolean; menuKind: string | null }>
}

/** The owner's answer to one conflict: the one price the wine has, for one price kind. */
export interface PricePickAnswer {
  wineLibraryId: string
  kind: 'bottle' | 'glass'
  price: number
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
  // 'kitchen' (F-1297) is absent from a reply sent before kitchen lines had their own result,
  // and 'cocktail' (F-1470) from one sent before cocktails had theirs.
  counts: Record<Exclude<PlanResult, 'kitchen' | 'cocktail'>, number> & { kitchen?: number; cocktail?: number }
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
  retiring?: Array<{ menuId: string; name: string | null; lines: number; kind?: string | null }>
  /**
   * Why only part of this menu was read; null when it was read whole. The
   * gateway refuses to make it current unless the person confirms (F-1292).
   */
  partRead?: string | null
  namesReadable: boolean
  namesReason: string | null
  /** The house's IANA zone, for printing dates as the house's day (F-699). */
  timezone?: string | null
  /** ADR 0340: every menu of the batch (the URL's first), Gone, Unsure and conflicts. Absent from an older gateway. */
  menus?: PlanMenu[]
  gone?: GoneLine[]
  unsure?: UnsureLine[]
  conflicts?: PriceConflict[]
}

/**
 * What choosing this menu would do. Nothing is written. A failed read throws.
 * `otherIds` plans a batch, one menu per kind (ADR 0340 rule 20; at most three).
 */
export async function getMenuPlan(menuId: string, otherIds: string[] = []): Promise<MenuPlan> {
  const response = await apiClient.get<MenuPlan>(
    `/menu-versions/${menuId}/plan`,
    otherIds.length > 0 ? { params: { menuIds: otherIds.join(',') } } : undefined,
  )
  return response.data
}

/** Every menu this house has read (the house comes from the token). A failed read throws. */
export async function listMenuVersions(): Promise<MenuVersions> {
  const response = await apiClient.get<MenuVersions>('/menu-versions')
  return response.data
}

/**
 * Whether `menuId` is among the house's current menus: the live menu of any
 * kind (ADR 0340 rule 1), not only the one `current` names (Drinks, else the
 * first live kind). An older gateway that names only `current` is read by it.
 */
export function isAmongCurrentMenus(v: Pick<MenuVersions, 'current' | 'currentByKind'>, menuId: string | null | undefined): boolean {
  if (!menuId) return false
  if (v.current?.menuId === menuId) return true
  return Object.values(v.currentByKind ?? {}).some((m) => m?.menuId === menuId)
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
  batch?: MakeLiveBatch,
): Promise<MakeCurrentResult> {
  const response = await apiClient.post<MakeCurrentResult>(
    `/menu-versions/${menuId}/make-current`,
    makeCurrentBody(fingerprint, partReadAccepted, batch),
  )
  return response.data
}

/** What a make-live batch adds to the one-menu call (ADR 0340 rules 17, 19, 20). */
export interface MakeLiveBatch {
  /** The other menus of the batch; the URL's menu is always in it. */
  menuIds?: string[]
  picks?: PricePickAnswer[]
  partReadAcceptedKinds?: MenuKind[]
}

/**
 * The make-current body. One menu with no batch sends exactly what it always
 * sent; a batch field is sent only when it holds something, since any batch
 * field takes the gateway's batch path.
 */
export function makeCurrentBody(
  fingerprint: string,
  partReadAccepted: boolean,
  batch?: MakeLiveBatch,
): Record<string, unknown> {
  const body: Record<string, unknown> = { fingerprint }
  if (partReadAccepted) body.partReadAccepted = true
  if (batch?.menuIds && batch.menuIds.length > 0) body.menuIds = batch.menuIds
  if (batch?.picks && batch.picks.length > 0) body.picks = batch.picks
  if (batch?.partReadAcceptedKinds && batch.partReadAcceptedKinds.length > 0) {
    body.partReadAcceptedKinds = batch.partReadAcceptedKinds
  }
  return body
}

// ── Sections (ADR 0340 rules 10, 14-16; owner or manager) ──────────────────

export interface MenuSection {
  id: string
  menu_id: string
  parent_id: string | null
  position: number
  title: string
  title_as_read: string | null
  key: string | null
  drink_category: string | null
  suggested_kind: string | null
  suggested_category: string | null
  suggestion_confidence: number | null
  /** The live section this one carries over from: "Same as last time" (rule 18). */
  inherited_from_section_id: string | null
  confirmed_by: string | null
  confirmed_at: string | null
}

export async function listMenuSections(menuId: string): Promise<MenuSection[]> {
  const response = await apiClient.get<{ menuId: string; sections: MenuSection[] }>(
    `/menu-versions/${menuId}/sections`,
  )
  return response.data?.sections ?? []
}

export async function renameMenuSection(menuId: string, sectionId: string, title: string): Promise<unknown> {
  const response = await apiClient.patch(`/menu-versions/${menuId}/sections/${sectionId}`, { title })
  return response.data
}

/** Moves a draft section to the read's draft of another kind; a missing kind's draft is made (rule 10). */
export async function moveMenuSection(
  menuId: string,
  sectionId: string,
  kind: MenuKind,
): Promise<{ id: string; from_menu_id: string; menu_id: string; kind: string; created_menu: boolean; line_ids: string[]; resolved: number }> {
  const response = await apiClient.post(`/menu-versions/${menuId}/sections/${sectionId}/move`, { kind })
  return response.data
}

/** Confirms what a draft section's lines are: a drink of a category, or a dish (rule 15). */
export async function confirmMenuSection(
  menuId: string,
  sectionId: string,
  lineKind: 'drink' | 'dish',
  drinkCategory?: string,
): Promise<{ id: string; menu_id: string; line_kind: string; applied_line_ids: string[]; left_line_ids: string[]; resolved: number }> {
  const response = await apiClient.post(
    `/menu-versions/${menuId}/sections/${sectionId}/confirm`,
    drinkCategory ? { lineKind, drinkCategory } : { lineKind },
  )
  return response.data
}

/** Confirms one draft line's kind (the lines a section answer left). */
export async function confirmMenuLine(
  menuId: string,
  lineId: string,
  lineKind: 'drink' | 'dish',
  drinkCategory?: string,
): Promise<{ line_id: string; menu_id: string; line_kind: string; drink_category: string | null; resolved: number }> {
  const response = await apiClient.post(
    `/menu-versions/${menuId}/lines/${lineId}/confirm`,
    drinkCategory ? { lineKind, drinkCategory } : { lineKind },
  )
  return response.data
}

/** Keeps a live line the draft does not list: copies it onto the draft (rule 18, "Gone", Keep). */
export async function keepGoneLine(
  draftMenuId: string,
  liveLineId: string,
): Promise<{ line_id: string; menu_id: string; section_id: string | null; kept_from_line_id: string }> {
  const response = await apiClient.post(`/menu-versions/${draftMenuId}/lines/${liveLineId}/keep`, {})
  return response.data
}

/** Reorders the sections under one parent (null = the top level); allowed on a live menu (rule 9). */
export async function reorderMenuSections(menuId: string, parentId: string | null, ids: string[]): Promise<unknown> {
  const response = await apiClient.post(`/menu-versions/${menuId}/sections/order`, parentId ? { parentId, ids } : { ids })
  return response.data
}

// ── The Full menu (ADR 0340 rule 22) ──────────────────────────────────────

/** One section of the Full menu: its lines in the house's order, then its own sections. */
export interface FullMenuSection {
  id: string
  parentId: string | null
  title: string
  position: number
  drinkCategory: string | null
  lines: MenuLine[]
  sections: FullMenuSection[]
}

/** One live kind of the Full menu. */
export interface FullMenuKind {
  kind: string
  menuId: string
  name: string | null
  madeCurrentAt: string | null
  sections: FullMenuSection[]
  /** Lines in no section (a line added to a live menu lands here). */
  unsorted: MenuLine[]
}

/** Every live kind of the house as one document, composed by the gateway (§F10). */
export interface FullMenu {
  /** When the gateway read it: the "as of" an offline copy shows. */
  readAt: string
  /** The house's IANA zone, so a kept copy's "as of" is on the house's clock (F-1563). Null when unset. */
  timezone?: string | null
  /** The kinds in the house's order. */
  kindOrder: string[]
  kindOrderSet: boolean
  kinds: FullMenuKind[]
  /** Legacy dishes on the live Drinks menu, left off because a Food menu is live. */
  hiddenDishes: Array<{ id: string; name: string; menuId: string; onFood: boolean }>
  rawLineWithheld?: true
  soldOutReadable?: boolean
  soldOutReason?: string | null
}

/** The Full menu of this house. A failed read throws; it is never an empty menu. */
export async function getFullMenu(restaurantId: string): Promise<FullMenu> {
  const response = await apiClient.get<FullMenu>(`/menus/${restaurantId}/full`)
  return response.data
}

/** Sets the order of Drinks, Food and Desserts on the Full menu (owner or manager). */
export async function setMenuKindOrder(restaurantId: string, order: string[]): Promise<{ kindOrder: string[] }> {
  const response = await apiClient.patch<{ kindOrder: string[] }>(`/menus/${restaurantId}/kind-order`, { order })
  return response.data
}
