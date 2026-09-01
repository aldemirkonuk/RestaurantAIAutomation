/**
 * `/calendar?openModal=true&date=…` — the one deep link that already worked,
 * and the one value it could not survive.
 *
 * The dashboard's Quick Add and the "Add to Calendar" quick action both sent
 * the LITERAL string `today` (Dashboard.tsx:778, quickActions.ts:81). This
 * page did `new Date(dateStr)` on it, which is Invalid Date, so the create-
 * event modal opened with an empty required date field.
 *
 * Both emitters now send a real day (or none at all), and this page no longer
 * takes the value on trust.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CalendarPage from './CalendarPage'
import { formatLocalDateKey } from '../../lib/calendar-dates'
import { BUILTIN_QUICK_ACTIONS } from '../../data/quickActions'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'user-1', restaurantId: 'rest-1' },
    activeRestaurantId: 'rest-1',
  }),
}))

vi.mock('../../hooks/queries', () => ({
  useCalendarEvents: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useEventTypes: () => ({
    data: [
      { id: 'type-meeting', name: 'Meeting', color: '#3B82F6', icon: 'Calendar', isCustom: false },
    ],
  }),
  useProviders: () => ({ data: [] }),
  useCreateCalendarEvent: () => ({ mutate: vi.fn() }),
  useUpdateCalendarEvent: () => ({ mutate: vi.fn() }),
  useDeleteCalendarEvent: () => ({ mutate: vi.fn() }),
  useUpdateEventType: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEventType: () => ({ mutate: vi.fn(), isPending: false }),
}))

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CalendarPage />
    </MemoryRouter>,
  )
}

/** The modal's required "Start date" field, as an <input type="date">. */
function startDateValue(): string {
  const input = document.querySelector('input[type="date"]') as HTMLInputElement | null
  if (!input) throw new Error('the create-event modal did not open')
  return input.value
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('the create-event deep link', () => {
  it('opens on a real day for a well-formed date', () => {
    at('/calendar?openModal=true&date=2026-03-14')
    expect(screen.getByPlaceholderText('Event title')).toBeInTheDocument()
    // Parsed in LOCAL time: `new Date('2026-03-14')` is UTC midnight and would
    // render as the 13th in every timezone west of Greenwich.
    expect(startDateValue()).toBe('2026-03-14')
  })

  it('falls back to today rather than opening on Invalid Date', () => {
    at('/calendar?openModal=true&date=today')
    expect(screen.getByPlaceholderText('Event title')).toBeInTheDocument()
    expect(startDateValue()).toBe(formatLocalDateKey(new Date()))
  })

  it('defaults to today when the link carries no date at all', () => {
    at('/calendar?openModal=true')
    expect(startDateValue()).toBe(formatLocalDateKey(new Date()))
  })

  it('opens nothing without openModal', () => {
    at('/calendar')
    expect(screen.queryByPlaceholderText('Event title')).toBeNull()
  })
})

describe('the emitters', () => {
  it('no quick action ships the literal string `today` any more', () => {
    const addToCalendar = BUILTIN_QUICK_ACTIONS.find((a) => a.key === 'add_calendar')
    expect(addToCalendar).toBeDefined()
    expect(addToCalendar!.href).not.toContain('date=today')
    // A constant href cannot carry today's date, so it must carry none — the
    // page's documented default then applies.
    expect(addToCalendar!.href).toBe('/calendar?openModal=true')
  })
})
