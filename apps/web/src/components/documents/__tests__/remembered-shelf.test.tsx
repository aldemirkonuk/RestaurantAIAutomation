/**
 * The remembered shelf on a document line (ADR 0104 D12 slice 4).
 * EVERY name and id below is SYNTHETIC.
 *
 * The assertions the design is:
 *   · a remembered pairing is ONE TICK and ONE SENTENCE, and no number anywhere
 *   · the tick reports itself as `remembered`; choosing by hand as `chosen`
 *   · "not this one" un-links AND forgets — it does not re-rank or average
 *   · a memory that could not be READ says so; it never draws as "nothing
 *     remembered", although the two otherwise look identical
 *   · a line that already names a shelf offers no proposal
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RememberedShelf } from '../RememberedShelf'
import { printedVintageOf } from '../canonical-format'
import type { ResolvedLine } from '../../../services/api/canonical'

const line = (over: Partial<ResolvedLine>): ResolvedLine => ({
  lineIndex: 0,
  lineId: 'line-1',
  inventoryId: null,
  inventoryIdSource: null,
  proposedInventoryId: null,
  proposedSentence: null,
  proposalUnavailable: false,
  proposalUnavailableReason: null,
  masterWineId: null,
  canonicalUom: 'bottle',
  packSize: 1,
  qtyBottles: 12,
  matchMethod: null,
  matchConfidence: null,
  vintage: 2021,
  lot: null,
  ...over,
})

const names: Record<string, string> = {
  'item-A': 'SYNTHETIC Öküzgözü 2021 · 750 ml',
}
const itemName = (id: string) => names[id] ?? null

describe('RememberedShelf', () => {
  it('offers the remembered shelf as one tick with one sentence, and no number', () => {
    render(
      <RememberedShelf
        line={line({
          proposedInventoryId: 'item-A',
          proposedSentence:
            'Remembered from 3 earlier documents from this vendor, last confirmed by Ayşe on 2026-09-05.',
        })}
        itemName={itemName}
        onLink={vi.fn()}
      />,
    )
    const row = screen.getByTestId('shelf-proposed')
    expect(row).toHaveTextContent('SYNTHETIC Öküzgözü 2021')
    expect(row).toHaveTextContent('last confirmed by Ayşe on 2026-09-05')
    // Never a confidence to a person.
    expect(row.textContent ?? '').not.toMatch(/%|0\.\d/)
    // ONE action, not a ranked list to choose from.
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('records the tick as `remembered`, not as a fresh choice', async () => {
    const onLink = vi.fn().mockResolvedValue(undefined)
    render(
      <RememberedShelf
        line={line({ proposedInventoryId: 'item-A', proposedSentence: 'Remembered…' })}
        itemName={itemName}
        onLink={onLink}
      />,
    )
    await userEvent.click(screen.getByTestId('shelf-accept'))
    expect(onLink).toHaveBeenCalledWith('line-1', 'item-A', 'remembered')
  })

  it('un-links and forgets on "not this one"', async () => {
    const onLink = vi.fn().mockResolvedValue(undefined)
    render(
      <RememberedShelf
        line={line({ inventoryId: 'item-A', inventoryIdSource: 'line' })}
        itemName={itemName}
        onLink={onLink}
      />,
    )
    expect(screen.getByTestId('shelf-linked')).toHaveTextContent(
      'SYNTHETIC Öküzgözü 2021',
    )
    await userEvent.click(screen.getByTestId('shelf-unlink'))
    // null is the forgetting act. Not a lower rank, not a second opinion.
    expect(onLink).toHaveBeenCalledWith('line-1', null, 'chosen')
  })

  it('says the memory is UNAVAILABLE rather than drawing it as nothing remembered', () => {
    render(
      <RememberedShelf
        line={line({
          proposalUnavailable: true,
          proposalUnavailableReason: 'the mapping memory could not be read',
        })}
        itemName={itemName}
        onLink={vi.fn()}
      />,
    )
    const row = screen.getByTestId('shelf-unavailable')
    expect(row).toHaveTextContent('Memory unavailable')
    expect(row).toHaveTextContent('could not be read')
    // The two states are not the same element.
    expect(screen.queryByTestId('shelf-none')).toBeNull()
    expect(screen.queryByTestId('shelf-proposed')).toBeNull()
  })

  it('says plainly that nothing is remembered when the read succeeded', () => {
    render(<RememberedShelf line={line({})} itemName={itemName} onLink={vi.fn()} />)
    expect(screen.getByTestId('shelf-none')).toHaveTextContent('Names no shelf yet')
    expect(screen.queryByTestId('shelf-unavailable')).toBeNull()
  })

  it('shows a shelf inherited from the order line as inherited, not as a human link', () => {
    render(
      <RememberedShelf
        line={line({ inventoryId: 'item-A', inventoryIdSource: 'order' })}
        itemName={itemName}
        onLink={vi.fn()}
      />,
    )
    expect(screen.getByTestId('shelf-linked')).toHaveTextContent('From the order line')
  })

  it('proposes nothing on a line that already names a shelf', () => {
    render(
      <RememberedShelf
        line={line({
          inventoryId: 'item-A',
          inventoryIdSource: 'line',
          proposedInventoryId: 'item-B',
          proposedSentence: 'Remembered…',
        })}
        itemName={itemName}
        onLink={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('shelf-proposed')).toBeNull()
  })
})

describe('RememberedShelf — a remembered item of another vintage (walk-through W8)', () => {
  const proposed = line({ proposedInventoryId: 'item-A', proposedSentence: 'Remembered from 1 earlier document.' })

  it('says the years differ beside the tick, and keeps the tick', () => {
    render(
      <RememberedShelf
        line={proposed}
        itemName={itemName}
        onLink={vi.fn()}
        printedVintage={2023}
        itemVintage={() => 2022}
      />,
    )
    expect(screen.getByTestId('shelf-vintage-differs')).toHaveTextContent(
      'This line prints 2023; that item is the 2022.',
    )
    expect(screen.getByTestId('shelf-accept')).toBeEnabled()
  })

  it('says nothing when the years agree or either one is unknown', () => {
    const { rerender } = render(
      <RememberedShelf line={proposed} itemName={itemName} onLink={vi.fn()} printedVintage={2021} itemVintage={() => 2021} />,
    )
    expect(screen.queryByTestId('shelf-vintage-differs')).toBeNull()
    rerender(<RememberedShelf line={proposed} itemName={itemName} onLink={vi.fn()} printedVintage={null} itemVintage={() => 2022} />)
    expect(screen.queryByTestId('shelf-vintage-differs')).toBeNull()
    rerender(<RememberedShelf line={proposed} itemName={itemName} onLink={vi.fn()} printedVintage={2023} itemVintage={() => null} />)
    expect(screen.queryByTestId('shelf-vintage-differs')).toBeNull()
  })

  it('keeps saying so after the tick, beside the linked item (W15)', () => {
    // Pressing the tick on SYN-US-0114 (2026-10-01) made the note vanish, so a
    // wrong-year link read as settled.
    const linked = line({ inventoryId: 'item-A', inventoryIdSource: 'line' })
    const { rerender } = render(
      <RememberedShelf line={linked} itemName={itemName} onLink={vi.fn()} printedVintage={2023} itemVintage={() => 2022} />,
    )
    expect(screen.getByTestId('shelf-linked')).toHaveTextContent('This line prints 2023; that item is the 2022.')
    rerender(<RememberedShelf line={linked} itemName={itemName} onLink={vi.fn()} printedVintage={2022} itemVintage={() => 2022} />)
    expect(screen.queryByTestId('shelf-vintage-differs')).toBeNull()
  })

  it('reads a year from the printed name only when exactly one is there', () => {
    expect(printedVintageOf(2019, 'SYNTHETIC Sancerre 2023')).toBe(2019)
    expect(printedVintageOf(null, 'SYNTHETIC Sancerre 2023 · 750 ml')).toBe(2023)
    expect(printedVintageOf(null, '2022 Scribe Estate, Sonoma Valley')).toBe(2022)
    expect(printedVintageOf(null, 'SYNTHETIC Rioja 2015 / 2016')).toBeNull()
    expect(printedVintageOf(null, 'SYNTHETIC Champagne NV · 750 ml')).toBeNull()
    expect(printedVintageOf(null, null)).toBeNull()
  })
})
