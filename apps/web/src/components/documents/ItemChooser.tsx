import { useState } from 'react'

/**
 * ItemChooser — a line with no remembered pairing is paired by hand (#347).
 *
 * The memory only learns from a link, so the FIRST pairing for any vendor's
 * line can never come from it. This is the inline picker that was never built:
 * a text filter over the house's items, a few matches as buttons, and Cancel.
 * Inline rather than a modal, because a modal covers the paper the person is
 * reading the line from.
 *
 * A FAILED item read says so and offers nothing — an empty list there would
 * read as "this house has no such item" (ADR 0020).
 */

export interface ChooserItem {
  id: string
  wineName?: string | null
  displayName?: string | null
  bottleSizeMl?: number | null
}

export interface ItemChooserProps {
  items: ChooserItem[]
  /** The name a person recognises (the sheet's own `itemName`), or null. */
  itemLabel: (id: string) => string | null
  onPick: (inventoryId: string) => void
  onCancel: () => void
  busy?: boolean
  /** The house's items could not be read. */
  itemsFailed?: boolean
}

const MAX_MATCHES = 8

/** Lower-case, accents folded: "sarap" finds "Şarap". */
export function foldForSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').toLowerCase()
}

/** The words an item answers to: its label, else its display or wine name. */
export function chooserName(it: ChooserItem, itemLabel: (id: string) => string | null): string {
  return itemLabel(it.id) ?? it.displayName ?? it.wineName ?? ''
}

/** Items whose name contains the filter, accent- and case-insensitive. */
export function filterItems(
  items: ChooserItem[],
  filter: string,
  itemLabel: (id: string) => string | null,
): ChooserItem[] {
  const needle = foldForSearch(filter.trim())
  if (!needle) return []
  return items.filter((it) => {
    const name = chooserName(it, itemLabel)
    return name !== '' && foldForSearch(name).includes(needle)
  })
}

const BOX: React.CSSProperties = {
  marginTop: 4,
  padding: '4px 6px',
  border: '1px solid var(--rule, #D9D2C6)',
  borderRadius: 3,
  fontSize: 10.5,
  lineHeight: 1.35,
  color: 'var(--ink-4, #665D50)',
}
const BTN: React.CSSProperties = {
  border: '1px solid var(--rule, #D9D2C6)',
  background: 'transparent',
  borderRadius: 3,
  padding: '1px 6px',
  fontSize: 10.5,
  cursor: 'pointer',
  color: 'inherit',
}

export function ItemChooser({ items, itemLabel, onPick, onCancel, busy, itemsFailed }: ItemChooserProps) {
  const [filter, setFilter] = useState('')

  if (itemsFailed) {
    return (
      <div style={{ ...BOX, color: 'var(--warn, #946A1A)' }} data-testid="chooser-failed">
        <span>The house's items could not be read, so none can be chosen.</span>{' '}
        <button type="button" style={BTN} onClick={onCancel} data-testid="chooser-cancel">
          Cancel
        </button>
      </div>
    )
  }

  const matches = filterItems(items, filter, itemLabel)
  const shown = matches.slice(0, MAX_MATCHES)

  return (
    <div style={BOX} data-testid="chooser">
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span>Find the item</span>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ fontSize: 11, flex: 1, minWidth: 0 }}
          data-testid="chooser-input"
          autoFocus
        />
      </label>
      {filter.trim() !== '' && shown.length === 0 && (
        <div data-testid="chooser-empty" style={{ marginTop: 3 }}>
          No item matches “{filter.trim()}”. Add it on /inventory first.
        </div>
      )}
      {shown.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 3, alignItems: 'flex-start' }}>
          {shown.map((it) => (
            <button
              key={it.id}
              type="button"
              style={BTN}
              disabled={busy}
              onClick={() => onPick(it.id)}
              data-testid="chooser-match"
            >
              {chooserName(it, itemLabel)}
              {it.bottleSizeMl ? ` · ${it.bottleSizeMl} ml` : ''}
            </button>
          ))}
          {matches.length > shown.length && (
            <span data-testid="chooser-more">{matches.length - shown.length} more — type more to narrow.</span>
          )}
        </div>
      )}
      <div style={{ marginTop: 3 }}>
        <button type="button" style={BTN} onClick={onCancel} data-testid="chooser-cancel">
          Cancel
        </button>
      </div>
    </div>
  )
}
