import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * The dev/truth instruments exist to make three claims checkable. If they
 * themselves render a missing number as 0, or an error as emptiness, they
 * commit the defect they were built to expose — so the behaviours asserted
 * here are the ones that matter, not the layout.
 *
 * Live end-to-end against a running gateway was NOT performed (that needs
 * production credentials locally); this is the durable substitute and it runs
 * in CI, which a screenshot would not.
 */

const mockGet = vi.fn()
vi.mock('../services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => mockGet(...a) },
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r-1' } }),
}))

import DevTruth from '../pages/DevTruth'

const renderAt = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/dev/truth${search}`]}>
      <DevTruth />
    </MemoryRouter>,
  )

beforeEach(() => {
  // BLOCK body on purpose. With an expression body this returns the mock, and
  // vitest calls a function returned from a hook as TEARDOWN — which invokes
  // mockGet() after the test, producing a rejected promise nothing is listening
  // for. It surfaces as an unhandled error on the rejection test only, which
  // looks like a bug in the component rather than in this line.
  mockGet.mockReset()
})

describe('dev/truth renders honestly', () => {
  it('shows a failed request as a failure, never as an empty screen', async () => {
    // Created at CALL time, not eagerly: mockRejectedValue builds the rejected
    // promise immediately, and nothing has attached a handler in that tick, so
    // the runtime flags it as unhandled before the component ever sees it.
    mockGet.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('statement timeout'), {
          response: { data: { message: 'statement timeout' } },
        }),
      ),
    )
    renderAt()
    await waitFor(() =>
      expect(screen.getByText(/request failed/i)).toBeInTheDocument(),
    )
    // The distinction the whole surface is about, stated on screen.
    expect(
      screen.getByText(/This is a failure, not an empty result/i),
    ).toBeInTheDocument()
  })

  it('renders an unreadable row count as an em dash, not as zero', async () => {
    mockGet.mockResolvedValue({
      data: {
        total: 573,
        reachedByPresence: 386,
        presencePct: 67.4,
        reachedBySufficiency: 132,
        sufficiencyPct: 23,
        overstatement: 254,
        sources: [
          {
            requirement: 'checks',
            table: 'pos_checks',
            rows: null, // could not be read
            error: 'statement timeout',
            presenceFlag: false,
            sufficientThreshold: 30,
            sufficientFlag: false,
          },
        ],
        leverage: [],
        unreadable: ['pos_checks'],
        note: 'n',
      },
    })
    renderAt()
    await waitFor(() => expect(screen.getByText('pos_checks')).toBeInTheDocument())
    expect(screen.getByTitle('could not be read')).toBeInTheDocument()
    // A zero here would be the exact lie this page exists to expose.
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('puts the reported number next to the sufficiency number', async () => {
    mockGet.mockResolvedValue({
      data: {
        total: 573,
        reachedByPresence: 386,
        presencePct: 67.4,
        reachedBySufficiency: 132,
        sufficiencyPct: 23,
        overstatement: 254,
        sources: [],
        leverage: [],
        unreadable: [],
        note: 'n',
      },
    })
    renderAt()
    // Both claims on one screen is the entire point of the surface.
    await waitFor(() => expect(screen.getByText('386')).toBeInTheDocument())
    expect(screen.getByText('132')).toBeInTheDocument()
    expect(screen.getByText('−254')).toBeInTheDocument()
    expect(screen.getByText(/what the product reports/i)).toBeInTheDocument()
  })

  it('distinguishes BROKEN from GENUINELY EMPTY on the swallow grid', async () => {
    mockGet.mockResolvedValue({
      data: {
        rows: [
          { table: 'pos_checks', rows: 66, errorCode: null, state: 'HAS ROWS' },
          {
            table: 'wine_consumption_log',
            rows: 0,
            errorCode: null,
            state: 'GENUINELY EMPTY',
          },
          {
            table: 'providers',
            rows: null,
            errorCode: '57014',
            state: 'BROKEN',
          },
        ],
        note: 'n',
      },
    })
    renderAt('?tab=swallow')
    await waitFor(() => expect(screen.getByText('BROKEN')).toBeInTheDocument())
    expect(screen.getByText('GENUINELY EMPTY')).toBeInTheDocument()
    expect(screen.getByText('HAS ROWS')).toBeInTheDocument()
    // Both read as "[]" to a caller that discards the error; the grid's job is
    // to make them different words.
    expect(screen.getByText('57014')).toBeInTheDocument()
  })

  it('states what the as-of screen cannot do, rather than implying it can', async () => {
    mockGet.mockResolvedValue({
      data: {
        cutoff: '2026-09-01T00:00:00.000Z',
        error: null,
        known: { checks: 40, revenue: 1200, covers: 90, firstAt: null, lastAt: null },
        happened: { checks: 26, revenue: 800, covers: 60 },
        limits: ['Truncates on pos_checks.opened_at only — not a general as-of engine.'],
      },
    })
    renderAt('?tab=asof')
    await waitFor(() =>
      expect(screen.getByText(/what this screen cannot do/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/not a general as-of engine/i)).toBeInTheDocument()
  })
})
