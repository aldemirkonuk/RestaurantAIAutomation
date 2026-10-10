/**
 * F-645 (sim wave 21, 2026-10-09): the gateway returns what a count recorded —
 * the books' figure, the counted figure and the difference — and the panel
 * threw it away, saying only "Count recorded — <wine>: N bottles". The person
 * counting never saw how far off the books were.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const submitSpotCount = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/spotCountOutbox', () => ({
  submitSpotCount,
  newClientCountId: () => 'k-1',
}))
vi.mock('../../../services/api/inventory', () => ({ estimateCountFromPhoto: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../../../stores', () => ({ useNotificationStore: () => toast }))

import { SpotCountPanel, varianceSentence } from './SpotCountPanel'

const item = { inventoryId: 'inv-1', name: 'Yakut', liveStock: 12 } as any

beforeEach(() => vi.clearAllMocks())

describe('SpotCountPanel — the count is shown after it is saved', () => {
  it('shows books, counted and the difference, and stays open until Done', async () => {
    submitSpotCount.mockResolvedValue({
      synced: true,
      count: { expectedQty: 12, countedQty: 10, varianceQty: -2, replayed: false },
    })
    const onClose = vi.fn()
    const onCommitted = vi.fn()
    render(<SpotCountPanel item={item} onClose={onClose} onCommitted={onCommitted} />)
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '10' } })
    fireEvent.click(screen.getByText('Submit count'))

    const result = await screen.findByTestId('spot-count-result')
    expect(result.textContent).toContain('Books said12')
    expect(result.textContent).toContain('You counted10')
    expect(result.textContent).toContain('Difference-2')
    expect(result.textContent).toContain('2 bottles fewer than the books — the books now say 10.')
    expect(onCommitted).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Done'))
    expect(onClose).toHaveBeenCalled()
  })

  it('a queued count closes with "will sync", as before', async () => {
    submitSpotCount.mockResolvedValue({ synced: false })
    const onClose = vi.fn()
    render(<SpotCountPanel item={item} onClose={onClose} onCommitted={vi.fn()} />)
    fireEvent.click(screen.getByText('Submit count'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Count saved — will sync', expect.any(String))
    expect(screen.queryByTestId('spot-count-result')).toBeNull()
  })
})

describe('varianceSentence', () => {
  it('says an agreeing count agreed', () => {
    expect(varianceSentence({ expectedQty: 5, countedQty: 5, varianceQty: 0 })).toBe('The books were right.')
  })
  it('says a surplus in bottles', () => {
    expect(varianceSentence({ expectedQty: 0, countedQty: 1, varianceQty: 1 })).toBe(
      '1 bottle more than the books — the books now say 1.',
    )
  })
})
