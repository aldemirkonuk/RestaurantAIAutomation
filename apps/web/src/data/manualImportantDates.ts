import type { ImportantDate } from '../components/dashboard/AddImportantDateModal'

const storageKey = (restaurantId: string) =>
  `wineops.dashboard.important_dates.${restaurantId || 'default'}`

/** Persistable fields only — icon is rehydrated from type on load. */
type StoredImportantDate = Omit<ImportantDate, 'icon'> & { iconName?: string }

export function loadManualImportantDates(restaurantId: string): StoredImportantDate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(restaurantId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveManualImportantDates(
  restaurantId: string,
  dates: Array<Omit<ImportantDate, 'icon'> & { icon?: unknown }>,
): void {
  if (typeof window === 'undefined') return
  try {
    const serializable = dates.map(({ icon: _icon, ...rest }) => rest)
    localStorage.setItem(storageKey(restaurantId), JSON.stringify(serializable))
  } catch {
    /* ignore */
  }
}
