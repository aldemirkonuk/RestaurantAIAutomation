/**
 * /calendar reminders must actually be scheduled.
 *
 * The reminder UI on this page used to be decorative: `handleModalSave` never read
 * `data.reminders`, and the calendar API drops the field, so the page reported
 * success and nothing was ever scheduled. Reminders fire when
 * `startReminderScheduler` (booted in `main.tsx`) drains the localStorage queue
 * these tests inspect — that is the only mechanism in the product that fires one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CalendarPage from './CalendarPage'
import { getScheduledReminders, scheduleReminder } from '../../lib/reminder-scheduler'
import { formatLocalDateKey } from '../../lib/calendar-dates'

const SCHEDULED_REMINDERS_KEY = 'wineops_scheduled_reminders'

const createMutate = vi.hoisted(() => vi.fn())
const updateMutate = vi.hoisted(() => vi.fn())
const deleteMutate = vi.hoisted(() => vi.fn())
/** Events the mocked query hook hands back; set per test before rendering. */
const state = vi.hoisted(() => ({ events: [] as Record<string, unknown>[] }))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'user-1', restaurantId: 'rest-1' },
    activeRestaurantId: 'rest-1',
  }),
}))

vi.mock('../../hooks/queries', () => ({
  // Consumed by useCalendarPage
  useCalendarEvents: () => ({
    data: state.events,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useEventTypes: () => ({
    data: [
      { id: 'type-meeting', name: 'Meeting', color: '#3B82F6', icon: 'Calendar', isCustom: false },
    ],
  }),
  useProviders: () => ({ data: [] }),
  // CalendarPage mutations — echo an id back through onSuccess like the real hook.
  useCreateCalendarEvent: () => ({
    mutate: (vars: Record<string, unknown>, opts?: { onSuccess?: (d: unknown) => void }) => {
      createMutate(vars)
      opts?.onSuccess?.({ id: 'evt-created', ...vars })
    },
  }),
  useUpdateCalendarEvent: () => ({
    mutate: (vars: Record<string, unknown>, opts?: { onSuccess?: (d: unknown) => void }) => {
      updateMutate(vars)
      opts?.onSuccess?.({ ...vars })
    },
  }),
  useDeleteCalendarEvent: () => ({ mutate: deleteMutate }),
  // EventModal's custom event-type management
  useUpdateEventType: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEventType: () => ({ mutate: vi.fn(), isPending: false }),
}))

/** An event already on the calendar, dated today so it lands in the month grid. */
const EXISTING_EVENT = {
  id: 'evt-existing',
  title: 'Barbaresco tasting',
  type: 'tasting',
  date: formatLocalDateKey(new Date()),
  startTime: '18:00',
  allDay: false,
  color: '#EC4899',
  status: 'pending',
  restaurantId: 'rest-1',
}

function renderCalendar(events: Record<string, unknown>[] = []) {
  state.events = events
  return render(
    <MemoryRouter>
      <CalendarPage />
    </MemoryRouter>
  )
}

/** Open the create modal from the toolbar CTA (the mobile FAB shares the label). */
async function openCreateModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /^new event$/i })[0])
  expect(await screen.findByPlaceholderText('Event title')).toBeInTheDocument()
}

/** Click the existing event's pill in the month grid; the modal opens read-only. */
async function openExistingEvent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: new RegExp(EXISTING_EVENT.title) }))
  expect(await screen.findByRole('button', { name: 'Edit event' })).toBeInTheDocument()
}

describe('CalendarPage reminders', () => {
  beforeEach(() => {
    localStorage.clear()
    state.events = []
    vi.clearAllMocks()
  })

  it('persists a reminder set in the event modal so the scheduler can fire it', async () => {
    const user = userEvent.setup()
    renderCalendar()

    await openCreateModal(user)
    await user.type(screen.getByPlaceholderText('Event title'), 'Barolo tasting')
    // Pick a non-default offset so the stored default cannot pass this by accident.
    await user.click(screen.getByRole('button', { name: '1 day' }))
    await user.click(screen.getByRole('button', { name: 'Create Event' }))

    expect(createMutate).toHaveBeenCalledTimes(1)

    const stored = getScheduledReminders()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      eventId: 'evt-created',
      title: 'Barolo tasting',
      reminderType: '1day',
      status: 'pending',
    })
    // It must be readable straight off the key the scheduler drains.
    expect(JSON.parse(localStorage.getItem(SCHEDULED_REMINDERS_KEY) as string)).toHaveLength(1)
  })

  it('fires the reminder one day before the event, not at the event time', async () => {
    const user = userEvent.setup()
    renderCalendar()

    await openCreateModal(user)
    await user.type(screen.getByPlaceholderText('Event title'), 'Delivery window')
    await user.click(screen.getByRole('button', { name: '1 day' }))
    await user.click(screen.getByRole('button', { name: 'Create Event' }))

    const [reminder] = getScheduledReminders()
    const [year, month, day] = reminder.date.split('-').map(Number)
    const [hours, minutes] = (reminder.startTime ?? '09:00').split(':').map(Number)
    const eventAt = new Date(year, month - 1, day, hours, minutes, 0, 0).getTime()

    expect(reminder.scheduledAt).toBe(eventAt - 1440 * 60 * 1000)
  })

  it('shows the reminder that is actually scheduled when the event is reopened', async () => {
    scheduleReminder({
      eventId: EXISTING_EVENT.id,
      title: EXISTING_EVENT.title,
      eventType: 'tasting',
      date: new Date(2030, 0, 15),
      startTime: '18:00',
      reminderType: '1week',
    })

    const user = userEvent.setup()
    renderCalendar([EXISTING_EVENT])

    await openExistingEvent(user)
    await user.click(screen.getByRole('button', { name: 'Edit event' }))

    // The "1 week" preset is highlighted; the create-mode default (1 hr) is not.
    expect(screen.getByRole('button', { name: '1 week' })).toHaveClass('font-bold')
    expect(screen.getByRole('button', { name: '1 hr' })).not.toHaveClass('font-bold')

    // Saving must not silently replace it with the default.
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(updateMutate).toHaveBeenCalledTimes(1)

    const stored = getScheduledReminders()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ eventId: EXISTING_EVENT.id, reminderType: '1week' })
  })

  it('drops pending reminders when the event is deleted', async () => {
    scheduleReminder({
      eventId: EXISTING_EVENT.id,
      title: EXISTING_EVENT.title,
      eventType: 'tasting',
      date: new Date(2030, 0, 15),
      startTime: '18:00',
      reminderType: '1hour',
    })
    scheduleReminder({
      eventId: 'evt-other',
      title: 'Untouched',
      eventType: 'meeting',
      date: new Date(2030, 0, 16),
      startTime: '10:00',
      reminderType: '1hour',
    })
    expect(getScheduledReminders()).toHaveLength(2)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderCalendar([EXISTING_EVENT])

    await openExistingEvent(user)
    await user.click(screen.getByRole('button', { name: 'Delete event' }))

    expect(deleteMutate).toHaveBeenCalledWith(EXISTING_EVENT.id)
    const remaining = getScheduledReminders()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].eventId).toBe('evt-other')
    confirmSpy.mockRestore()
  })
})
