/**
 * The first proof says which parts of the file a scan could not read
 * (ADR 0213 #17), one plain sentence each, under the reading count.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HouseMenu from './HouseMenu'
import { writeProof } from '../lib/firstProof'
import type { MenuImportResult } from '../services/api/menus'

// The proof asks who is reading to decide whether to offer the current-menu
// choice (HouseMenu.makeCurrent.test.tsx covers that choice).
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'staff', user: { role: 'staff' } }),
}))

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
