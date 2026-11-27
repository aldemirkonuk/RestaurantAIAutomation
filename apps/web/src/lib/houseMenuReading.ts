/**
 * The menu still being read when the owner went on to the house (r109
 * onboarding g4). Get-started writes it; /house reads it and asks after that
 * menu's read. Kept for one tab only (sessionStorage), keyed by house: a note
 * left by another house is never read as this one's.
 */
export const MENU_READING_KEY = 'mudavym:house-menu-reading'

export interface MenuReadingNote {
  houseId: string
  menuId: string
  /** When the owner went on (ms since epoch): /house asks for 10 minutes from it. */
  at: number
}

export function writeMenuReading(note: MenuReadingNote): void {
  try {
    sessionStorage.setItem(MENU_READING_KEY, JSON.stringify(note))
  } catch {
    // A browser that keeps nothing: /house simply shows no reading line.
  }
}

export function readMenuReading(houseId: string): MenuReadingNote | null {
  try {
    const raw = sessionStorage.getItem(MENU_READING_KEY)
    if (!raw) return null
    const note = JSON.parse(raw) as Partial<MenuReadingNote>
    if (
      !houseId ||
      note.houseId !== houseId ||
      typeof note.menuId !== 'string' ||
      !note.menuId ||
      typeof note.at !== 'number'
    ) {
      return null
    }
    return { houseId: note.houseId, menuId: note.menuId, at: note.at }
  } catch {
    return null
  }
}

export function clearMenuReading(): void {
  try {
    sessionStorage.removeItem(MENU_READING_KEY)
  } catch {
    // Nothing to clear.
  }
}
