/**
 * The first proof says which parts of the file a scan could not read
 * (ADR 0213 #17), one plain sentence each, under the reading count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HouseMenu, { proofPrice } from './HouseMenu'
import { formatMoney } from '../lib/currency'
import { settingsApi } from '../services/api/settings'

vi.mock('../services/api/settings', () => ({ settingsApi: { houseCurrency: vi.fn() } }))
const houseCurrency = vi.mocked(settingsApi.houseCurrency)
const lira = { restaurantId: 'r1', code: 'TRY', country: 'TR', readable: true, reason: null, statedAt: null }
import { writeProof } from '../lib/firstProof'
import type { MenuImportResult } from '../services/api/menus'

function proof(over: Partial<MenuImportResult> = {}): MenuImportResult {
  return {
    menuId: 'm1',
    itemsExtracted: 1,
    submissionsCreated: 0,
    items: [
      {
        menuItemId: 'i1',
        submissionId: null,
        name: 'Opus One',
        producer: null,
        category: 'red',
        vintage: null,
        region: null,
        grapeVariety: null,
        byGlassPrice: null,
        bottlePrice: 62,
        rawText: null,
        matched: true,
        needsReview: false,
      },
    ],
    ...over,
  }
}

function mount() {
  render(
    <MemoryRouter>
      <HouseMenu />
    </MemoryRouter>,
  )
}

afterEach(() => sessionStorage.clear())
beforeEach(() => {
  houseCurrency.mockReset()
  houseCurrency.mockResolvedValue(lira)
})

describe('HouseMenu, the first proof', () => {
  it('names the pages that were not read, one sentence each', () => {
    writeProof(
      proof({
        warnings: [
          { kind: 'chunk_failed', pages: { first: 13, last: 14 } },
          { kind: 'unreadable_reply', pages: null },
        ],
      }),
    )
    mount()
    const items = screen.getByTestId('first-proof-warnings').querySelectorAll('li')
    expect(Array.from(items).map((li) => li.textContent)).toEqual([
      'Pages 13–14 could not be read; send them again.',
      'The reading came back in a form that could not be read; send the file again.',
    ])
  })

  it('says nothing when the whole file was read', () => {
    writeProof(proof({ warnings: [] }))
    mount()
    expect(screen.getByText('Opus One')).toBeInTheDocument()
    expect(screen.queryByTestId('first-proof-warnings')).not.toBeInTheDocument()
  })
})

describe("HouseMenu, the proof's prices", () => {
  it('says a price in the house money, never a bare "1250 bottle" (r23 walk)', async () => {
    writeProof(proof({ items: [{ ...proof().items[0], byGlassPrice: 14, bottlePrice: 1250 }] }))
    mount()
    const want = `glass ${formatMoney(14, 'TRY')} · bottle ${formatMoney(1250, 'TRY')}`
    await waitFor(() => expect(document.body.textContent).toContain(want))
    expect(document.body.textContent).not.toContain('1250 bottle')
  })

  it('a failed read says the currency is not recorded, never a guessed sign', async () => {
    houseCurrency.mockRejectedValue(new Error('down'))
    writeProof(proof())
    mount()
    await waitFor(() => expect(document.body.textContent).toContain(`bottle ${formatMoney(62, null)}`))
    expect(document.body.textContent).toContain('(currency not recorded)')
  })

  it('while the currency is read, the figure stands alone, with no claim about the currency', () => {
    const p = proofPrice({ byGlassPrice: null, bottlePrice: 62 }, { read: false, code: null })
    expect(p).toMatch(/^bottle 62[.,]00$/)
    expect(proofPrice({ byGlassPrice: 9, bottlePrice: null }, { read: true, code: 'TRY' })).toBe(`glass ${formatMoney(9, 'TRY')}`)
  })
})
