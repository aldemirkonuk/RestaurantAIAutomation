/**
 * Onboarding Context
 * Manages state for the multi-step customer onboarding wizard
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

// Restaurant profile data
export interface RestaurantProfile {
  name: string
  address: string
  city: string
  state: string
  zipCode: string
  country: string
  timezone: string
  cuisineType: string
  seatingCapacity: number
  phone: string
  email: string
  website?: string
  logo?: string
  measurementUnit?: 'ml' | 'oz'
}

// Manager/user profile
export interface ManagerProfile {
  name: string
  email: string
  phone: string
  role: 'owner' | 'manager' | 'sommelier' | 'staff'
  notificationPreferences: {
    email: boolean
    sms: boolean
    push: boolean
    lowStockAlerts: boolean
    orderUpdates: boolean
    deliveryReminders: boolean
  }
}

// Team member invitation
export interface TeamMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'manager' | 'sommelier' | 'staff'
  status: 'pending' | 'invited' | 'active'
}

// Wine import item (from menu scan, CSV, or manual entry)
// Expanded to carry the full 3-layer schema from scan pipeline
export interface WineImportItem {
  id: string
  name: string
  producer?: string
  vintage?: number | string
  wineType?: 'red' | 'white' | 'sparkling' | 'rosé' | 'dessert' | 'fortified' | 'orange'
  country?: string
  region?: string
  subRegion?: string
  grapeVariety?: string
  appellation?: string
  appellationClass?: string
  price?: number
  priceCurrency?: string
  quantity?: number
  confidence: number
  fieldConfidences?: Record<string, number>
  fieldSources?: Record<string, string>
  warnings?: string[]
  libraryTier?: number  // 0-4 governance tier
  status: 'matched' | 'unknown' | 'pending_research' | 'confirmed'
  matchedWineId?: string
  source: 'menu_scan' | 'csv_import' | 'manual' | 'pdf_scan'
  // Deprecated aliases for backwards compat
  grape?: string
  type?: 'red' | 'white' | 'sparkling' | 'rosé' | 'dessert'
}

// Provider setup
export interface ProviderSetup {
  id: string
  name: string
  contactName?: string
  email?: string
  phone?: string
  deliveryDays?: string[]
  orderDeadline?: string
  isPreferred: boolean
}

// POS integration
export interface POSIntegration {
  provider: 'square' | 'toast' | 'clover' | 'lightspeed' | 'other' | 'none'
  connected: boolean
  apiKey?: string
  locationId?: string
}

// Complete onboarding data
export interface OnboardingData {
  restaurant: RestaurantProfile
  manager: ManagerProfile
  team: TeamMember[]
  wines: WineImportItem[]
  providers: ProviderSetup[]
  pos: POSIntegration
  completedSteps: number[]
  currentStep: number
}

// Onboarding steps
export type OnboardingStep = 
  | 'welcome'
  | 'restaurant'
  | 'manager'
  | 'team'
  | 'inventory'
  | 'providers'
  | 'pos'
  | 'review'
  | 'complete'

export const ONBOARDING_STEPS: { id: OnboardingStep; title: string; description: string }[] = [
  { id: 'welcome', title: 'Welcome', description: 'Get started with Mudavym' },
  { id: 'restaurant', title: 'Restaurant Profile', description: 'Tell us about your restaurant' },
  { id: 'manager', title: 'Your Profile', description: 'Set up your account preferences' },
  { id: 'team', title: 'Team Setup', description: 'Invite your team members' },
  { id: 'inventory', title: 'Wine Inventory', description: 'Import your wine list' },
  { id: 'providers', title: 'Providers', description: 'Set up your wine suppliers' },
  { id: 'pos', title: 'POS Integration', description: 'Connect your point of sale' },
  { id: 'review', title: 'Review', description: 'Review and confirm setup' },
  { id: 'complete', title: 'Complete', description: 'You\'re all set!' },
]

// Default values
const DEFAULT_RESTAURANT: RestaurantProfile = {
  name: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'USA',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  cuisineType: '',
  seatingCapacity: 0,
  phone: '',
  email: '',
}

const DEFAULT_MANAGER: ManagerProfile = {
  name: '',
  email: '',
  phone: '',
  role: 'manager',
  notificationPreferences: {
    email: true,
    sms: true,
    push: true,
    lowStockAlerts: true,
    orderUpdates: true,
    deliveryReminders: true,
  },
}

const DEFAULT_POS: POSIntegration = {
  provider: 'none',
  connected: false,
}

const DEFAULT_ONBOARDING_DATA: OnboardingData = {
  restaurant: DEFAULT_RESTAURANT,
  manager: DEFAULT_MANAGER,
  team: [],
  wines: [],
  providers: [],
  pos: DEFAULT_POS,
  completedSteps: [],
  currentStep: 0,
}

// Context type
interface OnboardingContextType {
  data: OnboardingData
  currentStep: OnboardingStep
  stepIndex: number
  isComplete: boolean
  progress: number
  
  // Navigation
  nextStep: () => void
  prevStep: () => void
  goToStep: (step: OnboardingStep) => void
  
  // Data updates
  updateRestaurant: (data: Partial<RestaurantProfile>) => void
  updateManager: (data: Partial<ManagerProfile>) => void
  addTeamMember: (member: Omit<TeamMember, 'id' | 'status'>) => void
  removeTeamMember: (id: string) => void
  addWine: (wine: Omit<WineImportItem, 'id'>) => void
  updateWine: (id: string, data: Partial<WineImportItem>) => void
  removeWine: (id: string) => void
  bulkAddWines: (wines: Omit<WineImportItem, 'id'>[]) => void
  addProvider: (provider: Omit<ProviderSetup, 'id'>) => void
  updateProvider: (id: string, data: Partial<ProviderSetup>) => void
  removeProvider: (id: string) => void
  updatePOS: (data: Partial<POSIntegration>) => void
  
  // Completion
  markStepComplete: (stepIndex: number) => void
  completeOnboarding: () => Promise<void>
  resetOnboarding: () => void
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined)

const STORAGE_KEY = 'wineops_onboarding_progress'

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<OnboardingData>(() => {
    if (typeof window === 'undefined') return DEFAULT_ONBOARDING_DATA
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) : DEFAULT_ONBOARDING_DATA
    } catch {
      return DEFAULT_ONBOARDING_DATA
    }
  })

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  const currentStep = ONBOARDING_STEPS[data.currentStep]?.id || 'welcome'
  const stepIndex = data.currentStep
  const isComplete = data.currentStep >= ONBOARDING_STEPS.length - 1
  const progress = Math.round((data.completedSteps.length / (ONBOARDING_STEPS.length - 2)) * 100)

  // Navigation
  const nextStep = useCallback(() => {
    setData(prev => ({
      ...prev,
      currentStep: Math.min(prev.currentStep + 1, ONBOARDING_STEPS.length - 1),
    }))
  }, [])

  const prevStep = useCallback(() => {
    setData(prev => ({
      ...prev,
      currentStep: Math.max(prev.currentStep - 1, 0),
    }))
  }, [])

  const goToStep = useCallback((step: OnboardingStep) => {
    const index = ONBOARDING_STEPS.findIndex(s => s.id === step)
    if (index !== -1) {
      setData(prev => ({ ...prev, currentStep: index }))
    }
  }, [])

  // Data updates
  const updateRestaurant = useCallback((updates: Partial<RestaurantProfile>) => {
    setData(prev => ({
      ...prev,
      restaurant: { ...prev.restaurant, ...updates },
    }))
  }, [])

  const updateManager = useCallback((updates: Partial<ManagerProfile>) => {
    setData(prev => ({
      ...prev,
      manager: { ...prev.manager, ...updates },
    }))
  }, [])

  const addTeamMember = useCallback((member: Omit<TeamMember, 'id' | 'status'>) => {
    setData(prev => ({
      ...prev,
      team: [...prev.team, { ...member, id: `tm-${Date.now()}`, status: 'pending' }],
    }))
  }, [])

  const removeTeamMember = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      team: prev.team.filter(m => m.id !== id),
    }))
  }, [])

  const addWine = useCallback((wine: Omit<WineImportItem, 'id'>) => {
    setData(prev => ({
      ...prev,
      wines: [...prev.wines, { ...wine, id: `wine-${Date.now()}` }],
    }))
  }, [])

  const updateWine = useCallback((id: string, updates: Partial<WineImportItem>) => {
    setData(prev => ({
      ...prev,
      wines: prev.wines.map(w => w.id === id ? { ...w, ...updates } : w),
    }))
  }, [])

  const removeWine = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      wines: prev.wines.filter(w => w.id !== id),
    }))
  }, [])

  const bulkAddWines = useCallback((wines: Omit<WineImportItem, 'id'>[]) => {
    setData(prev => ({
      ...prev,
      wines: [
        ...prev.wines,
        ...wines.map((w, i) => ({ ...w, id: `wine-${Date.now()}-${i}` })),
      ],
    }))
  }, [])

  const addProvider = useCallback((provider: Omit<ProviderSetup, 'id'>) => {
    setData(prev => ({
      ...prev,
      providers: [...prev.providers, { ...provider, id: `prov-${Date.now()}` }],
    }))
  }, [])

  const updateProvider = useCallback((id: string, updates: Partial<ProviderSetup>) => {
    setData(prev => ({
      ...prev,
      providers: prev.providers.map(p => p.id === id ? { ...p, ...updates } : p),
    }))
  }, [])

  const removeProvider = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      providers: prev.providers.filter(p => p.id !== id),
    }))
  }, [])

  const updatePOS = useCallback((updates: Partial<POSIntegration>) => {
    setData(prev => ({
      ...prev,
      pos: { ...prev.pos, ...updates },
    }))
  }, [])

  const markStepComplete = useCallback((stepIndex: number) => {
    setData(prev => ({
      ...prev,
      completedSteps: prev.completedSteps.includes(stepIndex)
        ? prev.completedSteps
        : [...prev.completedSteps, stepIndex],
    }))
  }, [])

  const completeOnboarding = useCallback(async () => {
    // POST onboarding data to backend
    const orchestratorUrl = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL
      || process.env.REACT_APP_ORCHESTRATOR_URL
      || 'http://localhost:8000'

    try {
      // Map wines from frontend format to backend format
      const winePayload = data.wines.map(w => ({
        name: w.name,
        producer: w.producer || null,
        vintage: typeof w.vintage === 'string' ? parseInt(w.vintage) || null : w.vintage || null,
        wine_type: w.wineType || w.type || null,
        country: w.country || null,
        region: w.region || null,
        sub_region: w.subRegion || null,
        grape_variety: w.grapeVariety || w.grape || null,
        appellation: w.appellation || null,
        price: w.price || null,
        price_currency: w.priceCurrency || 'USD',
        quantity: w.quantity || null,
        confidence: w.confidence || 0,
        field_confidences: w.fieldConfidences || {},
        field_sources: w.fieldSources || {},
        warnings: w.warnings || [],
        library_tier: w.libraryTier ?? null,
        status: w.status,
        matchedWineId: w.matchedWineId || null,
        source: w.source,
      }))

      const response = await fetch(`${orchestratorUrl}/api/v1/onboarding/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant: data.restaurant,
          manager: data.manager,
          team: data.team.map(m => ({ name: m.name, email: m.email, role: m.role })),
          wines: winePayload,
          providers: data.providers,
          pos: data.pos,
        }),
      })

      if (!response.ok) {
        console.error('Onboarding API failed:', response.status, await response.text())
        // Still proceed with local completion even if API fails
      } else {
        const result = await response.json()
        console.log('Onboarding complete:', result)
        // Store the restaurant_id for future API calls
        if (result.restaurant_id) {
          localStorage.setItem('wineops_restaurant_id', result.restaurant_id)
        }
      }
    } catch (error) {
      console.error('Failed to POST onboarding data:', error)
      // Continue — the onboarding wizard should complete even if backend is temporarily down
      // Data is still in localStorage and can be re-submitted
    }

    // Mark as complete in local state
    setData(prev => ({
      ...prev,
      currentStep: ONBOARDING_STEPS.length - 1,
      completedSteps: ONBOARDING_STEPS.map((_, i) => i),
    }))

    // Clear onboarding progress from storage
    localStorage.removeItem(STORAGE_KEY)

    // Set a flag indicating onboarding is complete
    localStorage.setItem('wineops_onboarding_complete', 'true')
  }, [data])

  const resetOnboarding = useCallback(() => {
    setData(DEFAULT_ONBOARDING_DATA)
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem('wineops_onboarding_complete')
  }, [])

  return (
    <OnboardingContext.Provider
      value={{
        data,
        currentStep,
        stepIndex,
        isComplete,
        progress,
        nextStep,
        prevStep,
        goToStep,
        updateRestaurant,
        updateManager,
        addTeamMember,
        removeTeamMember,
        addWine,
        updateWine,
        removeWine,
        bulkAddWines,
        addProvider,
        updateProvider,
        removeProvider,
        updatePOS,
        markStepComplete,
        completeOnboarding,
        resetOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const context = useContext(OnboardingContext)
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider')
  }
  return context
}

// Helper to check if onboarding is needed
export function isOnboardingComplete(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem('wineops_onboarding_complete') === 'true'
}
