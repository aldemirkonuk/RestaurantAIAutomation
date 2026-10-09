/**
 * F-358 (tail): the grid read its rows with no house group mark, so in a
 * "."-grouping house a typed "1.250" cost showed (and its hosts sent) 1.25.
 * The grid now takes the mark its host reads with (useHouseGroupMark), so the
 * total on screen is the total the host saves.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../hooks/useStorageLocations', () => ({ useStorageLocations: () => ({ locations: [] }) }))

import { BatchReceiveGrid, type BatchReceiveRow } from './BatchReceiveGrid'

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
