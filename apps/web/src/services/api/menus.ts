/**
 * Menus API Service
 *
 * Handles menu import and onboarding progress API calls.
 * All three import methods (scan, csv, manual) use the same POST endpoint.
 */

import { apiClient } from './client'

export interface WineExtractItem {
  name: string
  category?: string
  vintage?: string
  region?: string
  grape_variety?: string
  by_glass_price?: number
  bottle_price?: number
  raw_text?: string
}

export interface MenuImportResult {
  menuId: string
  itemsExtracted: number
}

export interface OnboardingProgress {
  id: string
  user_id: string
  restaurant_id: string
  menu_uploaded: boolean
  vendor_added: boolean
  team_member_invited: boolean
  checklist_dismissed: boolean
  completed_at: string | null
}

type MenuImportData =
  | { imageBase64: string; csvContent?: never; items?: never }
  | { csvContent: string; imageBase64?: never; items?: never }
  | { items: WineExtractItem[]; imageBase64?: never; csvContent?: never }

export async function importMenu(
  method: 'scan' | 'csv' | 'manual',
  data: MenuImportData
): Promise<MenuImportResult> {
  const response = await apiClient.post<MenuImportResult>('/menus/import', { method, data })
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
