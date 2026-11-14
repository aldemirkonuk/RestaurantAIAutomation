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
  /** False for a new read; a reopened read says whether it is current now. */
  current?: boolean
  /** The same file was read before: this is that read (gateway: same bytes reopen it). */
  reopened?: { readAt: string | null }
  /** How many photos this upload joined into the one menu. */
  pages?: number
  itemsExtracted: number
  submissionsCreated: number
  items: MenuImportReviewItem[]
  /** Client-only: the page photo from this session, if we still have it. */
  sourceImage?: string | null
  /** Whether the source file (photo, PDF, CSV) was kept, and why not when it was not. */
  source?: { kept: boolean; failure: string | null }
  /** The parts of the file a scan could not read (ADR 0213 #17). */
  warnings?: MenuReadWarning[]
  /** A file read's rows it could not take whole, and why (csv-parser.service.ts `CsvRowIssue`). */
  notes?: MenuReadNote[]
}

/** One row a CSV/XLSX read could not take whole. `row` is 1-based; the header is row 1. */
export interface MenuReadNote {
  row: number
  reason:
    | 'no_name'
    | 'no_name_column'
    | 'price_column_not_read'
    | 'price_column_read_as_bottle'
    | 'cell_error'
    | 'no_number'
    | 'two_readings'
    | 'unreadable'
  field?: string
  raw?: string
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
  /** Read this file again even though the house already read the same bytes. */
  readAgain?: boolean
  /** Told once the server has the file and is reading it in the background. */
  onReading?: (menuId: string) => void
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
  checklist_dismissed: boolean
  /** When the last of current menu, supplier and invite held; null while one is missing (derived, not remembered). */
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
  /** A live Gmail grant held for this house (sending or reading). */
  mailbox_connected: boolean | null
  /** "checked" once an invoice is verified, "waiting" while one is in, else "none". */
  invoice: 'none' | 'waiting' | 'checked' | null
}

type MenuImportData =
  | { imageBase64: string; csvContent?: never; items?: never; fileBase64?: never }
  /** Several photos of ONE menu, in page order: one menu, one version (at most 20). */
  | { images: string[]; imageBase64?: never; csvContent?: never; items?: never; fileBase64?: never }
  | { csvContent: string; imageBase64?: never; items?: never; fileBase64?: never }
  | { items: WineExtractItem[]; imageBase64?: never; csvContent?: never; fileBase64?: never }
  | { fileBase64: string; imageBase64?: never; csvContent?: never; items?: never }

/**
 * A refused or failed read in words: the gateway's sentence, then one sentence
 * per page it could not read (QA round 7a: the wizard said only the first).
 */
export function readRefusalWords(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: unknown; warnings?: unknown } }; message?: string }
  const m = e?.response?.data?.message
  const head = (typeof m === 'string' && m) || (Array.isArray(m) && m.length ? String(m[0]) : '') || e?.message || fallback
  const w = e?.response?.data?.warnings
  const tail = Array.isArray(w)
    ? (w as unknown[]).filter((x): x is MenuReadWarning => !!x && typeof x === 'object').map(readWarningSentence)
    : []
  return [head, ...tail].join(' ')
}

/** Where a background read stands (`GET /menu-versions/:id/read`). */
export interface MenuReadStatus {
  menuId: string
  state: 'reading' | 'done' | 'failed'
  failure: string | null
  warnings: MenuReadWarning[]
  reply: MenuImportResult | null
}

export async function readMenuStatus(menuId: string): Promise<MenuReadStatus> {
  const response = await apiClient.get<MenuReadStatus>(`/menu-versions/${menuId}/read`)
  return response.data
}

/**
 * A read that ended without a line, or with an error. Shaped like the
 * gateway's own 422 so every caller that already says `response.data.message`
 * and its `warnings` says this one too.
 */
export class MenuReadFailed extends Error {
  readonly response: { status: number; data: { message: string; warnings: MenuReadWarning[]; menuId: string } }
  constructor(menuId: string, message: string, warnings: MenuReadWarning[], status = 422) {
    super(message)
    this.name = 'MenuReadFailed'
    this.response = { status, data: { message, warnings, menuId } }
  }
}

/** How long the page waits on one read before it says the read goes on without it. */
export const READ_WAIT_MS = 20 * 60 * 1000

/** Polls in a row that may fail (network, 5xx, 408, 429) before the page stops waiting. */
export const MAX_MISSED_POLLS = 8

/**
 * Whether a failed poll can never succeed by asking again: any 4xx but a
 * timeout (408) or a throttle (429). A 401/403 (the session ended, or the
 * person is no longer in this house) and a 404 (the read is gone) end the
 * wait at once instead of leaving "Reading…" up for twenty minutes.
 */
function pollIsRefused(err: unknown): boolean {
  const code = (err as { response?: { status?: unknown } })?.response?.status
  return typeof code === 'number' && code >= 400 && code < 500 && code !== 408 && code !== 429
}

/** Wait on a background read until it is done or failed. Exported for tests. */
export async function waitForRead(
  menuId: string,
  opts: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<MenuImportResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const started = now()
  let missed = 0
  for (let i = 0; ; i++) {
    // Quick at first (a one-page photo takes seconds), then every few seconds.
    await sleep(i < 10 ? 1500 : 4000)
    let status: MenuReadStatus
    try {
      status = await readMenuStatus(menuId)
      missed = 0
    } catch (err) {
      // A refusal is said at once (the caller shows the gateway's words).
      if (pollIsRefused(err)) throw err
      // A missed poll is not the read's failure, but many in a row end the wait.
      missed += 1
      if (missed >= MAX_MISSED_POLLS || now() - started > READ_WAIT_MS) {
        throw new MenuReadFailed(
          menuId,
          'Lost touch with the read: the server did not answer several times in a row. The read goes on; it shows on the menu page when it is done.',
          [],
          202,
        )
      }
      continue
    }
    if (status.state === 'done') {
      return status.reply ?? { menuId, itemsExtracted: 0, submissionsCreated: 0, items: [], warnings: status.warnings }
    }
    if (status.state === 'failed') {
      throw new MenuReadFailed(menuId, status.failure ?? 'The read failed and gave no reason.', status.warnings)
    }
    if (now() - started > READ_WAIT_MS) {
      throw new MenuReadFailed(
        menuId,
        'Still reading after 20 minutes. The read goes on; it shows on the menu page when it is done.',
        [],
        202,
      )
    }
  }
}

export async function importMenu(
  method: 'scan' | 'csv' | 'manual',
  data: MenuImportData,
  labels: MenuReadLabels = {}
): Promise<MenuImportResult> {
  // The backend DTO requires restaurantId (@IsUUID(), no @IsOptional) with a
  // global forbidNonWhitelisted ValidationPipe — omitting it 400s before the
  // import ever runs. X-Restaurant-Id header alone is not read by the DTO.
  const restaurantId = getActiveRestaurantId()
  const response = await apiClient.post<MenuImportResult & { reading?: true }>('/menus/import', {
    method,
    data,
    restaurantId,
    // Sent only when the person gave them: a missing tag stays missing.
    ...(labels.cadence ? { cadence: labels.cadence } : {}),
    ...(labels.menuDate ? { menuDate: labels.menuDate } : {}),
    ...(labels.readAgain ? { readAgain: true } : {}),
  })
  // A scan is read in the background (founder 2026-11-07): the reply names the
  // version being read, and the page waits on it in short polls, so no read
  // is cut off by the client's 30-second timeout.
  if (!response.data.reading) return response.data
  labels.onReading?.(response.data.menuId)
  const done = await waitForRead(response.data.menuId)
  return { ...done, pages: response.data.pages ?? done.pages }
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
  /** Where its read stands; absent from an older gateway = done. */
  readState?: 'reading' | 'done' | 'failed'
  readFailure?: string | null
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
  /** The house's IANA zone its menu dates are said in; null = none (the reason says why). Absent on an older gateway. */
  timezone?: string | null
  timezoneReason?: string | null
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
  /**
   * r35 G10: each drink named to take off sale -- the price writer's outcome
   * per kind ("changed" is cleared), the locks that held, or why nothing is
   * known. Optional for an older gateway.
   */
  takenOff?: Array<{
    menuItemId: string
    name: string
    inventoryId: string
    bottle: string | null
    glass: string | null
    held: HeldKind[]
    error: string | null
  }>
}

/** What choosing a menu WOULD do, per line and per kind (ADR 0193 round 3, L13). */
export type PlanResult =
  | 'change'
  /**
   * A price someone set after this (current) menu was chosen: carrying the menu
   * again keeps it, because the carry is dated by the choice (L14; r31 w1 F2).
   */
  | 'kept_newer'
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
  /** The line's section (red, cocktail, beer…). Absent from a gateway older than the field. */
  category?: string | null
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
  /** The house's IANA zone the plan's dates are said in; null = none (the reason says why). */
  timezone?: string | null
  timezoneReason?: string | null
  generatedAt: string
  /** make-current requires it, and refuses (409) when the plan changed since. */
  fingerprint: string
  lines: PlanLine[]
  /** `kept_newer` is absent from an older gateway: read it as 0. */
  counts: Record<Exclude<PlanResult, 'kept_newer'>, number> & { kept_newer?: number }
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

/**
 * Make a kept menu current, naming the plan it was shown. `takeOff` names
 * drinks from the plan's "Not on this file" whose price is cleared once it is
 * current (r35 G10); none named, none changed (L12).
 */
export async function makeMenuCurrent(
  menuId: string,
  fingerprint: string,
  takeOff: readonly string[] = [],
): Promise<MakeCurrentResult> {
  // The switch commits before the prices are carried, so this call is never
  // cut off at the client's usual 30 s while the gateway is still writing
  // (r28 G1): a long menu gets its answer, whatever it is.
  const response = await apiClient.post<MakeCurrentResult>(
    `/menu-versions/${menuId}/make-current`,
    takeOff.length ? { fingerprint, takeOff: [...takeOff] } : { fingerprint },
    { timeout: MAKE_CURRENT_TIMEOUT_MS },
  )
  return response.data
}
