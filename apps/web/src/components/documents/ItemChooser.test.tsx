import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  it('names the size once: the sheet label already carries it', () => {
    render(
      <ItemChooser
        items={items}
        itemLabel={(id) => (id === '1' ? 'Şarap Kırmızı · 750 ml' : null)}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('chooser-input'), { target: { value: 'sarap' } })
    const shown = screen.getAllByTestId('chooser-match').map((b) => b.textContent)
    expect(shown).toEqual(['Şarap Kırmızı · 750 ml', 'Sarapnel'])
  })
  it('adds the size to a fallback name that lacks it', () => {
    render(<ItemChooser items={items} itemLabel={() => null} onPick={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('chooser-input'), { target: { value: 'raki' } })
    expect(screen.getByTestId('chooser-match').textContent).toBe('Rakı Yeni 700 · 700 ml')
  })
  it('says nothing matches, in words', () => {
    render(<ItemChooser items={items} itemLabel={() => null} onPick={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('chooser-input'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('chooser-empty').textContent).toBe(
      'No item matches “zzz”. Add it on /inventory first.',
    )
  })
})

describe('ItemChooser: add the line as a new good (r21)', () => {
  const line = { description: 'Zeytinyağı', uom: 'liter', formatMl: null }

  it('offers the line as a new good, kept in the unit its cost reads in, and sends that', async () => {
    const onCreate = vi.fn().mockResolvedValue(null)
    render(<ItemChooser items={items} itemLabel={() => null} onPick={vi.fn()} onCancel={vi.fn()} line={line} onCreate={onCreate} />)
    fireEvent.change(screen.getByTestId('chooser-input'), { target: { value: 'zeytin' } })
    expect(screen.getByTestId('chooser-empty').textContent).toMatch(/Add it as a new good below/)
    fireEvent.click(screen.getByTestId('new-good-open'))
    expect((screen.getByTestId('new-good-name') as HTMLInputElement).value).toBe('Zeytinyağı')
    expect((screen.getByTestId('new-good-unit') as HTMLSelectElement).value).toBe('ml')
    fireEvent.click(screen.getByTestId('new-good-add'))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ kind: 'food', uom: 'ml', displayName: 'Zeytinyağı' }))
  })

  it('says when the picked unit does not fit the line', () => {
    render(<ItemChooser items={items} itemLabel={() => null} onPick={vi.fn()} onCancel={vi.fn()} line={line} onCreate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('new-good-open'))
    fireEvent.change(screen.getByTestId('new-good-unit'), { target: { value: 'bottle' } })
    expect(screen.getByTestId('new-good-misfit').textContent).toMatch(/a liter is not a number of bottles/)
  })

  it('a wine is not added here: the button waits and the library is named', () => {
    const onCreate = vi.fn()
    render(<ItemChooser items={items} itemLabel={() => null} onPick={vi.fn()} onCancel={vi.fn()} line={line} onCreate={onCreate} />)
    fireEvent.click(screen.getByTestId('new-good-open'))
    fireEvent.change(screen.getByTestId('new-good-kind'), { target: { value: 'wine' } })
    expect(screen.getByTestId('new-good-why').textContent).toMatch(/wine library/)
    expect((screen.getByTestId('new-good-add') as HTMLButtonElement).disabled).toBe(true)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('shows the refusal the page hands back', async () => {
    const onCreate = vi.fn().mockResolvedValue('Zeytinyağı was not added, and the line is not paired: boom')
    render(<ItemChooser items={items} itemLabel={() => null} onPick={vi.fn()} onCancel={vi.fn()} line={line} onCreate={onCreate} />)
    fireEvent.click(screen.getByTestId('new-good-open'))
    fireEvent.click(screen.getByTestId('new-good-add'))
    await waitFor(() => expect(screen.getByTestId('new-good-said').textContent).toMatch(/not paired/))
  })

  it('with no line to read, the old pointer to /inventory stays', () => {
    render(<ItemChooser items={items} itemLabel={() => null} onPick={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('chooser-input'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('chooser-empty').textContent).toMatch(/Add it on \/inventory first/)
    expect(screen.queryByTestId('new-good-open')).toBeNull()
  })
})

