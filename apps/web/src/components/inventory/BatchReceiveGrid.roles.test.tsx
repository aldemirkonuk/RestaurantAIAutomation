/**
 * F-312 (2026-10-08): what the house paid for a wine is an owner's or a
 * manager's to set, and the gateway refuses a batch naming a cost or a free
 * sample from staff. The grid does not offer staff the cost cells, the bulk
 * cost fill or the free-sample ticks; a manager keeps all of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BatchReceiveGrid, type BatchReceiveRow } from './BatchReceiveGrid'

const mayAct = vi.hoisted(() => ({ value: true }))
vi.mock('../../hooks/useMayActForTheHouse', () => ({
  useMayActForTheHouse: () => mayAct.value,
}))
vi.mock('../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => ({ locations: [] }),
}))

const row: BatchReceiveRow = {
  key: 'r1',
  wineId: 'w1',
  name: 'Tsantali Rapsani',
  producer: 'Tsantali',
  vintage: 2019,
  quantity: 6,
  cost: '',
  isSample: false,
  selected: false,
}

function draw() {
  render(<BatchReceiveGrid rows={[row]} onChange={() => {}} />)
}

beforeEach(() => {
  mayAct.value = true
})

describe('BatchReceiveGrid — the cost is a manager\'s (F-312)', () => {
  it('[REVERT-FAILS] does not offer staff a cost, a bulk cost or a free sample', () => {
    mayAct.value = false
    draw()
    expect(screen.queryByLabelText('Cost per bottle for Tsantali Rapsani')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Cost per bottle for bulk fill')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as free samples' })).not.toBeInTheDocument()
    expect(screen.queryByText('Free sample')).not.toBeInTheDocument()
    expect(screen.getByTestId('batch-cost-held')).toHaveTextContent(
      'What the house paid is entered by a manager or an owner',
    )
    // The rest of the receipt stays theirs.
    expect(screen.getByLabelText('Quantity for Tsantali Rapsani')).toBeInTheDocument()
    expect(screen.getByLabelText('Storage location for Tsantali Rapsani')).toBeInTheDocument()
  })

  it('offers a manager the cost, the bulk cost and the free samples', () => {
    draw()
    expect(screen.getByLabelText('Cost per bottle for Tsantali Rapsani')).toBeInTheDocument()
    expect(screen.getByLabelText('Cost per bottle for bulk fill')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark as free samples' })).toBeInTheDocument()
    expect(screen.queryByTestId('batch-cost-held')).not.toBeInTheDocument()
  })
})
