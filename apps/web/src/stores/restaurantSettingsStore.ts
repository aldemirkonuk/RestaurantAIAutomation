import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type MeasurementUnit = 'ml' | 'oz'

interface RestaurantSettingsStore {
  measurementUnit: MeasurementUnit
  defaultPourMl: number
  recipesEnabled: boolean
  recipeYieldUnit: MeasurementUnit
  setMeasurementUnit: (unit: MeasurementUnit) => void
  setDefaultPourMl: (ml: number) => void
  setRecipesEnabled: (enabled: boolean) => void
  setRecipeYieldUnit: (unit: MeasurementUnit) => void
}

const DEFAULT_POUR_ML = 150

export const useRestaurantSettingsStore = create<RestaurantSettingsStore>()(
  persist(
    (set) => ({
      measurementUnit: 'ml',
      defaultPourMl: DEFAULT_POUR_ML,
      recipesEnabled: false,
      recipeYieldUnit: 'ml',
      setMeasurementUnit: (unit) => set({ measurementUnit: unit }),
      setDefaultPourMl: (ml) => set({ defaultPourMl: ml }),
      setRecipesEnabled: (enabled) => set({ recipesEnabled: enabled }),
      setRecipeYieldUnit: (unit) => set({ recipeYieldUnit: unit }),
    }),
    {
      name: 'restaurant-settings-storage',
      partialize: (state) => ({
        measurementUnit: state.measurementUnit,
        defaultPourMl: state.defaultPourMl,
        recipesEnabled: state.recipesEnabled,
        recipeYieldUnit: state.recipeYieldUnit,
      }),
    }
  )
)
