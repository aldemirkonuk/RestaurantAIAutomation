/**
 * `/calendar` must refresh when something else moves an event.
 *
 * `/calendar-classic` subscribed to `calendar_event_change` and refetched
 * (`Calendar.tsx:686-692` before ADR 0019 §B retired it); the modular page shipped
 * without it, so it only ever reflected its own mutations. A calendar left open on
 * the pass then showed a schedule that had already changed underneath it — the
 * calendar agent books a delivery, an order confirms an ETA, and the screen the
 * manager is reading says otherwise.
 *
 * `useCalendarEventsSubscription` was never deleted (`contexts/RealtimeContext.tsx:597`);
 * it listens for the window event `dispatchCalendarEvent` fires (`:432`). This test
 * drives that same event, so it fails if the hook is unwired OR if the event name
 * the two sides agree on ever drifts apart.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CalendarPage from './CalendarPage'

const refetch = vi.hoisted(() => vi.fn())

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'user-1', restaurantId: 'rest-1' },
    activeRestaurantId: 'rest-1',
  }),
}))

vi.mock('../../hooks/queries', () => ({
  useCalendarEvents: () => ({ data: [], isLoading: false, error: null, refetch }),
  useEventTypes: () => ({ data: [] }),
  useProviders: () => ({ data: [] }),
  useCreateCalendarEvent: () => ({ mutate: vi.fn() }),
  useUpdateCalendarEvent: () => ({ mutate: vi.fn() }),
  useDeleteCalendarEvent: () => ({ mutate: vi.fn() }),
  useUpdateEventType: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEventType: () => ({ mutate: vi.fn(), isPending: false }),
}))

describe('CalendarPage live refresh', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('refetches when another surface changes a calendar event', async () => {
    render(
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    )
    expect(refetch).not.toHaveBeenCalled()

    window.dispatchEvent(
      new CustomEvent('calendar_event_change', {
        detail: { action: 'created', eventId: 'evt-from-agent' },
      })
    )

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  })

  it('stops listening once the page unmounts', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    )
    unmount()

    window.dispatchEvent(new CustomEvent('calendar_event_change', { detail: {} }))

    expect(refetch).not.toHaveBeenCalled()
  })
})
