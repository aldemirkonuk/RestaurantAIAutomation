/**
 * F-779: the grid reads a typed cost with the house's thousands mark, the same
 * way the price cell and the auction sheet do. Its running total used to read
 * "1.250" as 1.25 in a Turkish house while those fields read 1,250.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fmtMoney } from '../../pages/inventory/command/bits'
import { BatchReceiveGrid, type BatchReceiveRow } from './BatchReceiveGrid'

vi.mock('../../hooks/useStorageLocations', () => ({ useStorageLocations: () => ({ locations: [] }) }))
vi.mock('../../hooks/useHouseGroupMark', () => ({ useHouseGroupMark: () => '.' }))
// Cost and total show only to a manager (F-312/F-780); this test reads the total.
vi.mock('../../hooks/useMayActForTheHouse', () => ({ useMayActForTheHouse: () => true }))

const row: BatchReceiveRow = {
  key: 'r1',
  wineId: 'w1',
  name: 'Kavaklıdere',
  quantity: 2,
  cost: '1.250',
  isSample: false,
  selected: false,
}

describe('BatchReceiveGrid — the house group mark', () => {
  it('totals two bottles at "1.250" as 2,500 in a "."-grouping house', () => {
    render(<BatchReceiveGrid rows={[row]} onChange={() => {}} />)
    expect(screen.getByText(fmtMoney(2500))).toBeInTheDocument()
    expect(screen.queryByText(fmtMoney(2.5))).toBeNull()
  })
})
