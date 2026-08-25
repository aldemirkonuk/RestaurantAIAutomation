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
}

export interface MenuImportResult {
  menuId: string
  itemsExtracted: number
  submissionsCreated: number
  items: MenuImportReviewItem[]
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
  data: MenuImportData
): Promise<MenuImportResult> {
  // The backend DTO requires restaurantId (@IsUUID(), no @IsOptional) with a
  // global forbidNonWhitelisted ValidationPipe — omitting it 400s before the
  // import ever runs. X-Restaurant-Id header alone is not read by the DTO.
  const restaurantId = getActiveRestaurantId()
  const response = await apiClient.post<MenuImportResult>('/menus/import', {
    method,
    data,
    restaurantId,
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
