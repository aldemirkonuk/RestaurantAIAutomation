import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type MeasurementUnit = 'ml' | 'oz'

interface RestaurantSettingsStore {
  measurementUnit: MeasurementUnit
  defaultPourMl: number
  setMeasurementUnit: (unit: MeasurementUnit) => void
  setDefaultPourMl: (ml: number) => void
}

const DEFAULT_POUR_ML = 150

export const useRestaurantSettingsStore = create<RestaurantSettingsStore>()(
  persist(
    (set) => ({
      measurementUnit: 'ml',
      defaultPourMl: DEFAULT_POUR_ML,
      setMeasurementUnit: (unit) => set({ measurementUnit: unit }),
      setDefaultPourMl: (ml) => set({ defaultPourMl: ml }),
    }),
    {
      name: 'restaurant-settings-storage',
      partialize: (state) => ({
        measurementUnit: state.measurementUnit,
        defaultPourMl: state.defaultPourMl,
      }),
    }
  )
)
