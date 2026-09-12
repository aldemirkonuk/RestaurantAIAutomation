import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The scenario page's honesty (ADR 0093 D6).
 *
 * The page exists to render a verdict, so the ways it can LIE are the tests:
 *
 *   • a failed verify rendering an empty table (which reads as "all clear")
 *   • `unverifiable` rendered as a fail, or as an empty cell
 *   • a server-capped list of runs rendered as a total
 *   • an empty state telling a reader with no terminal to run a command
 *
 * Layout is not asserted; behaviour is. Mirrors DevTruth.test.tsx, which is
 * the same discipline on the same kind of instrument.
 */

const listScenarioRuns = vi.fn()
const verifyScenarioRun = vi.fn()
const runLowStockSweep = vi.fn()
const generateInsights = vi.fn()

vi.mock('../services/api/simpos', () => ({
  simposApi: {
    listScenarioRuns: (...a: unknown[]) => listScenarioRuns(...a),
    verifyScenarioRun: (...a: unknown[]) => verifyScenarioRun(...a),
    runLowStockSweep: (...a: unknown[]) => runLowStockSweep(...a),
    generateInsights: (...a: unknown[]) => generateInsights(...a),
  },
}))

import SimposScenariosPage from '../pages/simpos/SimposScenariosPage'

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/simpos/r-sim/scenarios']}>
        <Routes>
          <Route
            path="/simpos/:restaurantId/scenarios"
            element={<SimposScenariosPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const run = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  scenario: 'random',
  seed: 7,
  service_date: '2026-09-02',
  timezone: 'America/Chicago',
  posted_at: '2026-09-02T19:05:00.000Z',
  created_at: '2026-09-02T19:05:00.000Z',
  totals: { checks: 9, wine_lines: 7, revenue: 412.5 },
  scenarios: [
    {
      id: 's1',
      title: 'Opening minute',
      story: 'A guest orders a coffee and a glass of wine.',
      check_ids: ['chk-1'],
    },
  ],
  ...over,
})

const verdict = (over: Record<string, unknown> = {}) => ({
  runId: 'run-1',
  restaurantId: 'r-sim',
  scenario: 'random',
  seed: 7,
  serviceDate: '2026-09-02',
  postedAt: '2026-09-02T19:05:00.000Z',
  verifiedAt: '2026-09-02T19:10:00.000Z',
  summary: { pass: 1, fail: 1, unverifiable: 1, total: 3 },
  checks: [
    {
      id: 'checks.landed',
      title: 'Every posted check reached pos_checks',
      status: 'pass',
      expected: 9,
      actual: 9,
      detail: 'all 9 posted check(s) present',
    },
    {
      id: 'stock.pours',
      title: 'One glass sale, one pour event',
      status: 'fail',
      expected: 7,
      actual: 6,
      detail: 'one glass line poured nothing',
    },
    {
      id: 'webhook.dropped',
      title: 'A dropped webhook',
      status: 'unverifiable',
      expected: ['chk-lost'],
      actual: 'absent',
      detail: 'absent as expected; no detector exists for a missed webhook',
    },
  ],
  reads: [{ table: 'pos_checks', ok: true, rows: 9 }],
  ...over,
})

beforeEach(() => {
  listScenarioRuns.mockReset()
  verifyScenarioRun.mockReset()
  runLowStockSweep.mockReset()
  generateInsights.mockReset()
})

describe('SimPOS scenarios page renders honestly', () => {
  it('shows a failed verify as a failure, with no verdict table behind it', async () => {
    listScenarioRuns.mockResolvedValue({
      runs: [run()],
      cap: 50,
      capped: false,
    })
    // Built at CALL time: an eagerly-created rejected promise is flagged as
    // unhandled before the component attaches a handler (see DevTruth.test.tsx).
    verifyScenarioRun.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('statement timeout'), {
          response: { data: { message: 'statement timeout' } },
        }),
      ),
    )

    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText(/verification request failed/i),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText(/statement timeout/i)).toBeInTheDocument()
    expect(
      screen.getByText(/this is a failure, not an empty result/i),
    ).toBeInTheDocument()
    // The table must not be there at all — an empty table over a failed
    // request is the exact thing that reads as "everything checked out".
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders unverifiable with its own label, distinct from pass and fail', async () => {
    listScenarioRuns.mockResolvedValue({
      runs: [run()],
      cap: 50,
      capped: false,
    })
    verifyScenarioRun.mockResolvedValue(verdict())

    renderPage()

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    const chipPass = screen.getByTestId('chip-pass')
    const chipFail = screen.getByTestId('chip-fail')
    const chipUnver = screen.getByTestId('chip-unverifiable')
    expect(chipPass).toHaveTextContent('Pass 1')
    expect(chipFail).toHaveTextContent('Fail 1')
    expect(chipUnver).toHaveTextContent('Unverifiable 1')
    // Its own colour: not the fail colour, and not a grey that reads as empty.
    expect(chipUnver.className).not.toBe(chipFail.className)
    expect(chipUnver.className).toContain('violet')
    expect(chipFail.className).toContain('rose')
    expect(chipUnver.className).not.toMatch(/text-gray-[456]00/)

    // And on the row itself, as a word rather than an empty cell.
    expect(screen.getAllByLabelText('Unverifiable').length).toBeGreaterThan(0)
    expect(
      screen.getByText(/no detector exists for a missed webhook/i),
    ).toBeInTheDocument()
  })

  it('renders a capped runs list as a floor, never as a total', async () => {
    const runs = Array.from({ length: 50 }, (_, i) =>
      run({ id: `run-${i}`, seed: i }),
    )
    listScenarioRuns.mockResolvedValue({ runs, cap: 50, capped: true })
    verifyScenarioRun.mockResolvedValue(verdict())

    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/showing 50 of ≥50/)).toBeInTheDocument(),
    )
  })

  it('states an uncapped count plainly, without a floor mark', async () => {
    listScenarioRuns.mockResolvedValue({
      runs: [run()],
      cap: 50,
      capped: false,
    })
    verifyScenarioRun.mockResolvedValue(verdict())

    renderPage()

    await waitFor(() => expect(screen.getByText('1 run')).toBeInTheDocument())
    expect(screen.queryByText(/≥/)).not.toBeInTheDocument()
  })

  it('the empty state names what creates runs and contains no terminal command', async () => {
    listScenarioRuns.mockResolvedValue({ runs: [], cap: 50, capped: false })

    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText(/no scenario runs recorded for this restaurant yet/i),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText(/open the order log/i)).toBeInTheDocument()
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/pnpm|npm run|yarn |python3 -m|cd apps\//)
    // No verdict is requested when there is nothing to verify.
    expect(verifyScenarioRun).not.toHaveBeenCalled()
  })

  it('a failed runs list is a failure, not an empty list', async () => {
    listScenarioRuns.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('permission denied'), {
          response: { data: { message: 'permission denied' } },
        }),
      ),
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/could not load the runs/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/no scenario runs recorded/i),
    ).not.toBeInTheDocument()
  })

  it('surfaces failed reads as the reason checks are unverifiable', async () => {
    listScenarioRuns.mockResolvedValue({
      runs: [run()],
      cap: 50,
      capped: false,
    })
    verifyScenarioRun.mockResolvedValue(
      verdict({
        reads: [
          { table: 'pos_checks', ok: false, error: 'statement timeout' },
          { table: 'notifications', ok: true, rows: 2 },
        ],
      }),
    )

    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText(/1 read failed — every check that depended on them/i),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByText(/pos_checks: statement timeout/),
    ).toBeInTheDocument()
  })
})
