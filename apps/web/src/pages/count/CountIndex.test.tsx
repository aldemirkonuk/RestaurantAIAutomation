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
// useHouseCurrency reads the house through useContext(AuthContext) (F-1680),
// so the mock carries the context too, reading the same house.
vi.mock('@/contexts/AuthContext', async () => {
  const { createContext } = await import('react')
  return {
    useAuth: () => auth.value,
    AuthContext: createContext<unknown>({
      get activeRestaurantId() {
        return auth.value.activeRestaurantId
      },
    }),
  }
})

const api = vi.hoisted(() => ({
  listOpenCountSessions: vi.fn(),
  openCountSession: vi.fn(),
  abandonCountSession: vi.fn(),
  houseHoldingCount: vi.fn(),
}))
// The calls are mocked; the module's word helpers (periodWords) are its own.
vi.mock('@/services/api/countSessions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}))

// F-1680/F-1682: the house's zone and its way of writing figures and dates.
const zone = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@/lib/houseZone', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useHouseZone: () => zone.value,
}))
// The setup file stands the hook in for every page; here it is a spy, so the
// page is seen to read its house's way of writing itself.
const currencyHook = vi.hoisted(() => ({ useHouseCurrency: vi.fn(() => undefined) }))
vi.mock('@/hooks/useHouseCurrency', () => currencyHook)

import CountIndex from './CountIndex'
import { setHouseLocale } from '@/lib/houseCurrency'

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
  zone.value = null
  currencyHook.useHouseCurrency.mockClear()
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

describe('CountIndex -- choosing places, and the counts that ended (S227 owed)', () => {
  it('[REVERT-FAILS] a count of the places chosen sends them, says them first, and is its own start', async () => {
    api.listOpenCountSessions.mockResolvedValue({
      sessions: [],
      periods: { current: '2026-11', ended: null },
      zones: [
        { id: 'z-bar', name: 'Bar', shelves: 1 },
        { id: 'z-cellar', name: 'Cellar', shelves: 4 },
      ],
      ended: [],
    })
    show()
    const group = await screen.findByRole('group', { name: 'Which places does it count?' })
    expect(group.textContent).toContain('4 shelves')
    fireEvent.click(screen.getByRole('button', { name: /^Cellar/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Closing count' }))
    expect(screen.getByRole('alert').textContent).toContain('every shelf in Cellar at Kadıköy, Istanbul')
    fireEvent.click(screen.getByRole('button', { name: 'Start it' }))
    await waitFor(() => expect(api.openCountSession).toHaveBeenCalledTimes(1))
    expect(api.openCountSession.mock.calls[0][0]).toMatchObject({ kind: 'closing', zoneIds: ['z-cellar'] })
  })

  it('control: none chosen counts every shelf and names no place', async () => {
    api.listOpenCountSessions.mockResolvedValue({
      sessions: [],
      periods: { current: '2026-11', ended: null },
      zones: [
        { id: 'z-bar', name: 'Bar', shelves: 1 },
        { id: 'z-cellar', name: 'Cellar', shelves: 4 },
      ],
      ended: [],
    })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Full count' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start it' }))
    await waitFor(() => expect(api.openCountSession).toHaveBeenCalledTimes(1))
    expect(api.openCountSession.mock.calls[0][0]).not.toHaveProperty('zoneIds')
  })

  it('[REVERT-FAILS] lists the counts that ended, with the month, who and when', async () => {
    api.listOpenCountSessions.mockResolvedValue({
      sessions: [],
      periods: { current: '2026-11', ended: null },
      zones: [],
      ended: [
        {
          id: 'E1',
          kind: 'month_end',
          status: 'signed_off',
          openedAt: '2026-10-31T20:00:00Z',
          endedAt: '2026-11-01T01:00:00Z',
          endedBy: 'Selin',
          period: '2026-10',
        },
        {
          id: 'E2',
          kind: 'full',
          status: 'abandoned',
          openedAt: '2026-10-20T10:00:00Z',
          endedAt: '2026-10-20T11:00:00Z',
          endedBy: 'Selin',
          period: '2026-10',
        },
      ],
    })
    show()
    const list = await screen.findByRole('region', { name: 'Counts that ended' })
    expect(list.textContent).toContain('Month-end count')
    expect(list.textContent).toContain(`· ${october}`)
    expect(list.textContent).toContain('Signed off by Selin')
    expect(list.textContent).toContain('Stopped by Selin')
  })
})

describe('CountIndex -- the house\'s clock and its way of writing (F-1679, F-1680, F-1682)', () => {
  const endedList = {
    sessions: [],
    periods: { current: '2026-11', ended: null },
    zones: [],
    ended: [
      {
        id: 'E1',
        kind: 'month_end',
        status: 'signed_off',
        openedAt: '2026-10-31T20:00:00Z',
        endedAt: '2026-10-31T22:30:00Z',
        endedBy: 'Selin',
        period: '2026-10',
      },
    ],
  }

  it('[REVERT-FAILS] dates an ended count on the house clock and in its way of writing, not the phone\'s', async () => {
    zone.value = 'Europe/Istanbul'
    setHouseLocale('tr-TR')
    api.listOpenCountSessions.mockResolvedValue(endedList)
    try {
      show()
      const list = await screen.findByRole('region', { name: 'Counts that ended' })
      // 01:30 on 1 November in Istanbul; a phone in New York is still on 31 October.
      const house = new Date('2026-10-31T22:30:00Z').toLocaleString('tr-TR', {
        day: 'numeric',
        month: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Istanbul',
      })
      expect(list.textContent).toContain(`Signed off by Selin, ${house}`)
      expect(list.textContent).not.toMatch(/Signed off by Selin, [^0-9]*(Eki|Kas|Oct)/)
    } finally {
      setHouseLocale(null)
    }
  })

  it('[REVERT-FAILS] reads the house\'s own way of writing itself: /count is outside the shell (F-1680)', async () => {
    api.listOpenCountSessions.mockResolvedValue({ sessions: [], periods: { current: '2026-11', ended: null } })
    show()
    await screen.findAllByRole('button')
    expect(currencyHook.useHouseCurrency).toHaveBeenCalled()
  })
})
