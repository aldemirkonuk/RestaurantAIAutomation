/**
 * `/count`: a count says which month it is for (F-1544 lane 5, the founder's
 * F1 b, 2026-10-12). Each case fails on the base, where a count named no
 * month and the page never asked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const HOUSES = [
  { id: 'h1', name: 'Kadıköy', city: 'Istanbul', chain_id: null, chain_name: null },
  { id: 'h2', name: 'Detroit', city: 'Detroit', chain_id: null, chain_name: null },
]
const auth = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }))

const api = vi.hoisted(() => ({
  listOpenCountSessions: vi.fn(),
  openCountSession: vi.fn(),
  abandonCountSession: vi.fn(),
  houseHoldingCount: vi.fn(),
}))
vi.mock('@/services/api/countSessions', () => api)

import CountIndex from './CountIndex'

const october = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
  new Date(Date.UTC(2026, 9, 1)),
)
const november = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
  new Date(Date.UTC(2026, 10, 1)),
)

function show() {
  return render(
    <MemoryRouter>
      <CountIndex />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.value = {
    activeRole: 'manager',
    activeRestaurantId: 'h1',
    availableRestaurants: HOUSES,
    setActiveRestaurantId: vi.fn().mockResolvedValue(true),
  }
  api.listOpenCountSessions.mockReset()
  api.openCountSession.mockReset().mockResolvedValue({ id: 'S9' })
})

describe('CountIndex -- which month a count is for', () => {
  it('asks in the 6 hours after a month ends, and sends the month chosen', async () => {
    api.listOpenCountSessions.mockResolvedValue({
      sessions: [],
      periods: { current: '2026-11', ended: '2026-10' },
    })
    show()
    const group = await screen.findByRole('group', { name: 'Which month is this count for?' })
    expect(group).toBeTruthy()
    // The month that ended is chosen until the manager taps the other.
    expect(screen.getByRole('button', { name: october }).getAttribute('aria-pressed')).toBe('true')
    // The first start's answer is lost (no signal): its key is kept for a retry.
    api.openCountSession.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Month-end count' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start it' }))
    await waitFor(() => expect(api.openCountSession).toHaveBeenCalledTimes(1))
    expect(api.openCountSession.mock.calls[0][0]).toMatchObject({ kind: 'month_end', period: '2026-10' })

    fireEvent.click(screen.getByRole('button', { name: november }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Month-end count' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Month-end count' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start it' }))
    await waitFor(() => expect(api.openCountSession).toHaveBeenCalledTimes(2))
    const second = api.openCountSession.mock.calls[1][0]
    expect(second).toMatchObject({ kind: 'month_end', period: '2026-11' })
    // A different month is a different start, never the first one's retry.
    expect(second.openKey).not.toBe(api.openCountSession.mock.calls[0][0].openKey)
  })

  it('does not ask, and names no month, the rest of the month', async () => {
    api.listOpenCountSessions.mockResolvedValue({
      sessions: [
        { id: 'S1', kind: 'closing', status: 'open', openedAt: '2026-11-12T21:00:00Z', period: '2026-11', shelves: 3, shelvesDone: 1 },
      ],
      periods: { current: '2026-11', ended: null },
    })
    show()
    // An open count says its month beside its kind.
    expect(await screen.findByText(`· ${november}`)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Which month is this count for?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Full count' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start it' }))
    await waitFor(() => expect(api.openCountSession).toHaveBeenCalledTimes(1))
    expect(api.openCountSession.mock.calls[0][0]).not.toHaveProperty('period')
  })
})

describe('CountIndex -- a start asks first and names the house (F-1617, F-1628)', () => {
  beforeEach(() => {
    api.listOpenCountSessions.mockResolvedValue({ sessions: [], periods: { current: '2026-11', ended: null } })
  })

  it('[REVERT-FAILS] a tap on Opening stock starts nothing until "Start it", and says what it does', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Opening stock' }))
    expect(api.openCountSession).not.toHaveBeenCalled()
    const said = screen.getByRole('alert').textContent ?? ''
    expect(said).toContain('every shelf of Kadıköy, Istanbul')
    expect(said).toContain('staff cannot count while it is open')
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(api.openCountSession).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Opening stock' })).toBeTruthy()
  })

  it('[REVERT-FAILS] names the house and offers the other one', async () => {
    show()
    expect((await screen.findByTestId('count-house')).textContent).toContain('Kadıköy, Istanbul')
    const pick = screen.getByRole('combobox', { name: 'Switch to another house' })
    fireEvent.change(pick, { target: { value: 'h2' } })
    await waitFor(() => expect(auth.value.setActiveRestaurantId).toHaveBeenCalledWith('h2'))
  })
})
