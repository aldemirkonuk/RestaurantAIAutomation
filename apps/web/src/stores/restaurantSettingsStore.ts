import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type MeasurementUnit = 'ml' | 'oz'

/**
 * How THIS browser writes volumes out. Nothing else lives here: the house's
 * pour is restaurants.default_pour_ml on the server (recipes walk G13), and
 * the "Enable recipes" / "Recipe yield unit" switches nothing read are gone
 * (G15). A browser that stored them under this key keeps the stale keys; the
 * partialize below never writes them again and nothing reads them.
 */
interface RestaurantSettingsStore {
  measurementUnit: MeasurementUnit
  setMeasurementUnit: (unit: MeasurementUnit) => void
}

export const useRestaurantSettingsStore = create<RestaurantSettingsStore>()(
  persist(
    (set) => ({
      measurementUnit: 'ml',
      setMeasurementUnit: (unit) => set({ measurementUnit: unit }),
    }),
    {
      name: 'restaurant-settings-storage',
      partialize: (state) => ({ measurementUnit: state.measurementUnit }),
    }
  )
)
