/**
 * The opening hours taken from the Places pick did not save (r109 onboarding g1).
 *
 * /get-started writes the house id here when the hours write after
 * `createFirstHouse` fails; /house reads it and says so with a Settings link.
 * Keyed by house, so another house in the same tab never sees the line.
 * Storage that throws (private mode, blocked) reads as "nothing to say".
 */
export const HOURS_UNSAVED_KEY = 'mudavym:house-hours-unsaved'

export function writeHoursUnsaved(houseId: string) {
  try {
    sessionStorage.setItem(HOURS_UNSAVED_KEY, JSON.stringify({ houseId }))
  } catch {
    /* storage blocked: /house cannot be told, Settings still shows the hours unset */
  }
}

export function readHoursUnsaved(houseId: string | null | undefined): boolean {
  if (!houseId) return false
  try {
    const raw = sessionStorage.getItem(HOURS_UNSAVED_KEY)
    if (!raw) return false
    return (JSON.parse(raw) as { houseId?: string }).houseId === houseId
  } catch {
    return false
  }
}

export function clearHoursUnsaved() {
  try {
    sessionStorage.removeItem(HOURS_UNSAVED_KEY)
  } catch {
    /* nothing to clear */
  }
}
