import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MultiLocationCell } from './MultiLocationCell'
import type { StorageLocation } from '../../hooks/useStorageLocations'

const locations = [
  { id: 'cellar', name: 'Cellar', capacity: 500, currentCount: 0, color: '#be123c' },
  { id: 'rack-1', name: 'Rack 1', capacity: 50, currentCount: 0, color: '#be123c', parentId: 'cellar' },
  { id: 'bar', name: 'Bar', capacity: 100, currentCount: 0, color: '#f59e0b' },
] as unknown as StorageLocation[]

function renderCell(onTransfer = vi.fn().mockResolvedValue(undefined)) {
  render(
    <MultiLocationCell
      totalLive={8}
      breakdown={[
        { locationId: 'bar', qty: 2, wac: null },
        { locationId: 'rack-1', qty: 6, wac: null },
      ]}
      locations={locations}
      onTransfer={onTransfer}
    />,
  )
  return onTransfer
}

async function openMover() {
  await userEvent.click(screen.getByTitle('Click to move bottles between locations'))
  const [from, to] = screen.getAllByRole('combobox')
  return { from: from as HTMLSelectElement, to: to as HTMLSelectElement, qty: screen.getByLabelText('Bottles to move') as HTMLInputElement }
}

/**
 * F-1541: the field clamped every keystroke to at least 1, so it could not be
 * cleared, and typing after clearing put a 1 in front ("13" for 3).
 */
describe('MultiLocationCell — the bottles field (F-1541)', () => {
  it('[REVERT-FAILS] can be cleared and retyped, and sends what was typed', async () => {
    const onTransfer = renderCell()
    const { to, qty } = await openMover()
    await userEvent.selectOptions(to, 'bar')
    await userEvent.clear(qty)
    expect(qty.value).toBe('')
    await userEvent.type(qty, '3')
    expect(qty.value).toBe('3')
    await userEvent.click(screen.getByRole('button', { name: /move/i }))
    expect(onTransfer).toHaveBeenCalledWith('rack-1', 'bar', 3)
  })

  it('[REVERT-FAILS] starts From on the place holding the most, and says why Move is off', async () => {
    renderCell()
    const { from, to, qty } = await openMover()
    expect(from.value).toBe('rack-1')
    expect(screen.getByText('Pick where the bottles go.')).toBeInTheDocument()
    await userEvent.selectOptions(to, 'bar')
    await userEvent.clear(qty)
    await userEvent.type(qty, '9')
    expect(screen.getByText('Type how many bottles, from 1 to 6.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /move/i })).toBeDisabled()
  })
})

/**
 * F-1542: a place that holds other places was offered as a destination, and
 * bottles filed there can no longer be counted by shelf.
 */
describe('MultiLocationCell — bottles land on a shelf (F-1542)', () => {
  it('[REVERT-FAILS] offers no place that holds other places', async () => {
    renderCell()
    const { to } = await openMover()
    const offered = Array.from(to.options).map((o) => o.value)
    expect(offered).not.toContain('cellar')
    expect(offered).toContain('bar')
  })
})
