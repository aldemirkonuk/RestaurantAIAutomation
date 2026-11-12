import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ItemChooser, filterItems, foldForSearch } from './ItemChooser'

const items = [
  { id: '1', wineName: 'Şarap Kırmızı', bottleSizeMl: 750 },
  { id: '2', displayName: 'Rakı Yeni 700', bottleSizeMl: 700 },
  { id: '3', wineName: 'Sarapnel' },
]

describe('filterItems', () => {
  it('finds "Şarap" from "sarap": case- and accent-insensitive', () => {
    const got = filterItems(items, 'sarap', () => null).map((i) => i.id)
    expect(got).toEqual(['1', '3'])
  })
  it('folds the dotless i, and falls back to the display name', () => {
    expect(foldForSearch('RAKI')).toBe('raki')
    expect(filterItems(items, 'RAKI', () => null).map((i) => i.id)).toEqual(['2'])
  })
  it('an empty filter matches nothing, not everything', () => {
    expect(filterItems(items, '  ', () => null)).toEqual([])
  })
  it('prefers the sheet label when it has one', () => {
    expect(filterItems(items, 'house', (id) => (id === '1' ? 'House red' : null)).map((i) => i.id)).toEqual(['1'])
  })
})

describe('ItemChooser', () => {
  it('caps the matches at 8 and says how many more', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `m${i}`, wineName: `Merlot ${i}` }))
    render(<ItemChooser items={many} itemLabel={() => null} onPick={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('chooser-input'), { target: { value: 'merlot' } })
    expect(screen.getAllByTestId('chooser-match')).toHaveLength(8)
    expect(screen.getByTestId('chooser-more').textContent).toMatch(/3 more/)
  })
  it('says nothing matches, in words', () => {
    render(<ItemChooser items={items} itemLabel={() => null} onPick={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('chooser-input'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('chooser-empty').textContent).toBe(
      'No item matches “zzz”. Add it on /inventory first.',
    )
  })
})
