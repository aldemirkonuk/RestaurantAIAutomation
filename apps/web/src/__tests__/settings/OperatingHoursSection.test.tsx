import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OperatingHoursSection } from '../../components/settings/OperatingHoursSection'
import { restaurantsApi } from '../../services/api/restaurants'

/**
 * ADR 0093 D1 — the four states this editor must keep apart.
 *
 * `null` hours, a failed GET, an all-closed week and a real schedule are four
 * different facts. Three of them render as an empty grid if nobody is
 * watching, and an empty grid invites someone to "fix" hours that were never
 * read — whose save then overwrites the real ones.
 */

vi.mock('../../services/api/restaurants', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/api/restaurants')
  >('../../services/api/restaurants')
  return {
    ...actual,
    restaurantsApi: {
      getOperatingHours: vi.fn(),
      putOperatingHours: vi.fn(),
    },
  }
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const api = vi.mocked(restaurantsApi)

const BISTRO = {
  mon: [],
  tue: [{ open: '12:00', close: '23:00' }],
  wed: [{ open: '12:00', close: '23:00' }],
  thu: [{ open: '12:00', close: '23:00' }],
  fri: [{ open: '12:00', close: '23:30' }],
  sat: [{ open: '12:00', close: '23:30' }],
  sun: [{ open: '12:00', close: '22:00' }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OperatingHoursSection — null is not closed', () => {
  it('renders "Hours not set" for null, and no day grid', async () => {
    api.getOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: null,
      updatedAt: null,
    })

    render(<OperatingHoursSection restaurantId="r1" />)

    expect(await screen.findByTestId('operating-hours-not-set')).toBeInTheDocument()
    expect(screen.getByText(/Hours not set/i)).toBeInTheDocument()
    // The seven-row grid must NOT be showing: an all-closed grid over a null
    // column is the fabricated answer.
    expect(screen.queryByTestId('operating-hours-row-mon')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /set hours/i })).toBeInTheDocument()
  })

  it('shows the venue timezone read-only', async () => {
    api.getOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: null,
      updatedAt: null,
    })
    render(<OperatingHoursSection restaurantId="r1" />)
    expect(await screen.findByTestId('operating-hours-timezone')).toHaveTextContent(
      'America/Chicago',
    )
  })

  it('says the timezone is not set rather than assuming one', async () => {
    api.getOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: null,
      operatingHours: null,
      updatedAt: null,
    })
    render(<OperatingHoursSection restaurantId="r1" />)
    expect(await screen.findByTestId('operating-hours-timezone')).toHaveTextContent(
      /Timezone not set/i,
    )
  })

  it('renders a real week as seven rows with its ranges', async () => {
    api.getOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: BISTRO,
      updatedAt: '2026-09-02T00:00:00.000Z',
    })
    render(<OperatingHoursSection restaurantId="r1" />)

    expect(await screen.findByTestId('operating-hours-row-tue')).toBeInTheDocument()
    // Monday is genuinely closed in this week — and says so.
    expect(screen.getByTestId('operating-hours-row-mon')).toHaveTextContent('Closed')
    expect(
      screen.getByLabelText('Tuesday range 1 opens'),
    ).toHaveValue('12:00')
    expect(screen.queryByTestId('operating-hours-not-set')).not.toBeInTheDocument()
  })

  it('opening the editor on unknown hours does not arm a one-click all-closed save', async () => {
    api.getOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: null,
      updatedAt: null,
    })
    render(<OperatingHoursSection restaurantId="r1" />)

    await userEvent.click(await screen.findByRole('button', { name: /set hours/i }))
    expect(screen.getByTestId('operating-hours-row-mon')).toBeInTheDocument()
    // "Closed every day" is a real claim about the venue. It has to be made,
    // not fallen into.
    expect(screen.getByRole('button', { name: /save hours/i })).toBeDisabled()
    expect(api.putOperatingHours).not.toHaveBeenCalled()
  })
})

describe('OperatingHoursSection — a failed GET is a failure, not an empty editor', () => {
  it('renders the error text and no editor', async () => {
    api.getOperatingHours.mockRejectedValue(new Error('Network Error'))

    render(<OperatingHoursSection restaurantId="r1" />)

    const box = await screen.findByTestId('operating-hours-load-error')
    expect(box).toHaveTextContent(/could not be loaded/i)
    expect(box).toHaveTextContent('Network Error')
    // Neither the grid nor the "not set" copy: the venue is not being blamed
    // for the network.
    expect(screen.queryByTestId('operating-hours-row-mon')).not.toBeInTheDocument()
    expect(screen.queryByTestId('operating-hours-not-set')).not.toBeInTheDocument()
  })

  it('retries on demand', async () => {
    api.getOperatingHours.mockRejectedValueOnce(new Error('Network Error'))
    api.getOperatingHours.mockResolvedValueOnce({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: null,
      updatedAt: null,
    })

    render(<OperatingHoursSection restaurantId="r1" />)
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(await screen.findByTestId('operating-hours-not-set')).toBeInTheDocument()
  })
})

describe('OperatingHoursSection — the server lists every fault and so do we', () => {
  it('renders errors[] from a 400', async () => {
    api.getOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: BISTRO,
      updatedAt: null,
    })
    api.putOperatingHours.mockRejectedValue({
      response: {
        status: 400,
        data: {
          message: 'operating_hours invalid',
          errors: [
            'mon[0].close: not HH:MM (00:00–23:59): "25:00"',
            'tue: ranges overlap or are unsorted (11:00-15:00 then 14:00-22:00)',
          ],
        },
      },
    })

    render(<OperatingHoursSection restaurantId="r1" />)
    await screen.findByTestId('operating-hours-row-tue')

    // Make it dirty so Save is live, then save.
    await userEvent.click(screen.getByRole('button', { name: /remove tuesday range 1/i }))
    await userEvent.click(screen.getByRole('button', { name: /save hours/i }))

    const box = await screen.findByTestId('operating-hours-save-errors')
    expect(box).toHaveTextContent('not HH:MM')
    expect(box).toHaveTextContent('ranges overlap')
    expect(box.querySelectorAll('li')).toHaveLength(2)
  })

  it('a non-validation save failure still says something rather than nothing', async () => {
    api.getOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: BISTRO,
      updatedAt: null,
    })
    api.putOperatingHours.mockRejectedValue(new Error('Network Error'))

    render(<OperatingHoursSection restaurantId="r1" />)
    await screen.findByTestId('operating-hours-row-tue')
    await userEvent.click(screen.getByRole('button', { name: /remove tuesday range 1/i }))
    await userEvent.click(screen.getByRole('button', { name: /save hours/i }))

    expect(await screen.findByTestId('operating-hours-save-errors')).toHaveTextContent(
      'Network Error',
    )
  })

  it('a save sends the edited week, and null when the hours are cleared', async () => {
    api.getOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: BISTRO,
      updatedAt: null,
    })
    api.putOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: null,
      updatedAt: '2026-09-02T01:00:00.000Z',
    })

    render(<OperatingHoursSection restaurantId="r1" />)
    await screen.findByTestId('operating-hours-row-tue')
    await userEvent.click(screen.getByRole('button', { name: /clear hours/i }))
    await userEvent.click(screen.getByRole('button', { name: /save hours/i }))

    await waitFor(() =>
      expect(api.putOperatingHours).toHaveBeenCalledWith('r1', null),
    )
    expect(await screen.findByTestId('operating-hours-not-set')).toBeInTheDocument()
  })
})

describe('OperatingHoursSection — stored hours that do not parse', () => {
  it('are reported as invalid, not as "not set"', async () => {
    api.getOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: null,
      updatedAt: null,
      storedHoursErrors: ['missing keys: sun'],
    })

    render(<OperatingHoursSection restaurantId="r1" />)
    const box = await screen.findByTestId('operating-hours-stored-invalid')
    expect(box).toHaveTextContent('missing keys: sun')
  })
})

describe('OperatingHoursSection — staff see the hours but no controls', () => {
  it('renders the week read-only when canEdit is false', async () => {
    api.getOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'America/Chicago',
      operatingHours: BISTRO,
      updatedAt: null,
    })

    render(<OperatingHoursSection restaurantId="r1" canEdit={false} />)
    await screen.findByTestId('operating-hours-row-tue')

    expect(screen.getByLabelText('Tuesday range 1 opens')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /save hours/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /range$/i })).not.toBeInTheDocument()
  })
})
