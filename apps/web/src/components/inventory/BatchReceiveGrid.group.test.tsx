/**
 * F-358 (tail): the grid read its rows with no house group mark, so in a
 * "."-grouping house a typed "1.250" cost showed (and its hosts sent) 1.25.
 * The grid now takes the mark its host reads with (useHouseGroupMark), so the
 * total on screen is the total the host saves.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../hooks/useStorageLocations', () => ({ useStorageLocations: () => ({ locations: [] }) }))
// Integration: since F-312/F-779 the grid shows the total only to those who may
// set cost, and reads the house mark itself; here the house mark is unknown.
vi.mock('../../hooks/useMayActForTheHouse', () => ({ useMayActForTheHouse: () => true }))
vi.mock('../../hooks/useHouseGroupMark', () => ({ useHouseGroupMark: () => null }))

import { BatchReceiveGrid, validateBatchRows, type BatchReceiveRow } from './BatchReceiveGrid'

const row: BatchReceiveRow = {
  key: 'r1',
  wineId: 'w1',
  name: 'Barolo',
  quantity: 2,
  cost: '1.250',
  isSample: false,
  selected: false,
}

describe('BatchReceiveGrid — the house group mark', () => {
  it('totals a lone "1.250" as 1250 a bottle in a "."-grouping house', () => {
    render(<BatchReceiveGrid rows={[row]} onChange={() => {}} group="." />)
    expect(screen.getByText('$2,500')).toBeInTheDocument()
  })

  it('still reads it as 1.25 where the house mark is not known', () => {
    render(<BatchReceiveGrid rows={[row]} onChange={() => {}} />)
    // 2 × 1.25, shown rounded to the whole unit.
    expect(screen.getByText('$3')).toBeInTheDocument()
    expect(screen.queryByText('$2,500')).not.toBeInTheDocument()
  })
})

/**
 * F-832: "1,250" in a "."-grouping house reads 1.25 while this screen prints
 * "$1,250". Neither reading is safe to save silently, so the row is held and
 * the question names both readings.
 */
describe('validateBatchRows — a cost that reads two ways', () => {
  const typed = { ...row, cost: '1,250' }

  it('holds the row when the house and the screen group with different marks', () => {
    const issues = validateBatchRows([typed], '.', ',')
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toMatch(/^cost “1,250” could be 1\.25 or 1,250\.00/)
  })

  it('holds it too when the house mark is not known', () => {
    expect(validateBatchRows([typed], null, ',')).toHaveLength(1)
  })

  it('passes "1,250" where the house and the screen both group with ","', () => {
    expect(validateBatchRows([typed], ',', ',')).toEqual([])
  })
})
