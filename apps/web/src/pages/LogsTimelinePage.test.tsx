/**
 * /logs honesty contracts (ADR 0086).
 *
 * The endpoint catches each of its six sources individually and still returns
 * 200, so a register that 500s used to reach this page as a shorter feed and a
 * chip reading `POS 0` — a fabricated zero indistinguishable from a quiet
 * restaurant. These tests pin the four claims that replace it: a failed source
 * is named in words and shows `—`; a source that was never queried says so
 * rather than reporting none; an undated row renders `—` and not "Invalid
 * Date"; and a gateway that reports neither field makes the page fall SILENT
 * rather than claim health — absence is unknown, never all-clear.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

const api = vi.hoisted(() => ({
  response: {} as unknown,
  reject: false,
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}))

vi.mock('../components/layout/Header', () => ({
  Header: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

vi.mock('../services/api/client', () => ({
  apiClient: {
    get: () =>
      api.reject
        ? Promise.reject(new Error('timeline down'))
        : Promise.resolve({ data: api.response }),
  },
}))

import { LogsTimelinePage } from './LogsTimelinePage'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
}

const ALL_SIX = [
  'pos_checks',
  'decision_log',
  'inventory_transactions',
  'procurement_documents',
  'system_audit_log',
  'event_store',
]

/** The chip pill for a source, found by its short label. */
function chip(label: string): HTMLElement {
  const el = screen
    .getAllByText((_, node) => (node?.textContent ?? '').trim().startsWith(`${label} `))
    .filter((n) => n.tagName === 'SPAN' && n.className.includes('rounded-full'))
  expect(el.length).toBeGreaterThan(0)
  return el[0]
}

beforeEach(() => {
  api.reject = false
  api.response = { events: [], correlationId: null }
})

describe('/logs — a lost source is said in words', () => {
  it('names the sources that could not be read, and shows — instead of a count', async () => {
    api.response = {
      events: [
        {
          id: 'e1',
          source: 'decision_log',
          occurredAt: '2026-09-02T10:00:00.000Z',
          correlationId: null,
          summary: 'agent did a thing',
          detail: {},
        },
      ],
      correlationId: null,
      sourcesQueried: ALL_SIX,
      failedSources: ['pos_checks', 'system_audit_log'],
    }

    render(<LogsTimelinePage />, { wrapper })

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('2 registers could not be read')
    expect(banner).toHaveTextContent('POS checks')
    expect(banner).toHaveTextContent('the audit log')

    // The fabricated zero is gone: a register that failed reports no count.
    expect(chip('POS').textContent).toContain('—')
    expect(chip('POS').textContent).not.toContain('0')
    expect(chip('Audit').textContent).toContain('—')
    // A register that answered still shows its real count.
    expect(chip('Agent').textContent).toContain('1')
  })

  it('states a source that was never queried rather than reporting none', async () => {
    api.response = {
      events: [],
      correlationId: null,
      // event_store is not restaurant-scoped: unfiltered, it is not read.
      sourcesQueried: ALL_SIX.filter((s) => s !== 'event_store'),
      failedSources: [],
    }

    render(<LogsTimelinePage />, { wrapper })

    await waitFor(() => expect(screen.getByText(/Read 5 of 6 registers/)).toBeTruthy())
    expect(screen.getByText(/not read: the event store/)).toBeTruthy()
    expect(chip('Event').textContent).toContain('—')
    // Nothing failed, so no alarm is raised.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('makes no claim at all when the gateway reports neither field', async () => {
    api.response = {
      events: [
        {
          id: 'e1',
          source: 'pos_checks',
          occurredAt: '2026-09-02T10:00:00.000Z',
          correlationId: null,
          summary: 'POS check 42 closed (toast)',
          detail: {},
        },
      ],
      correlationId: null,
    }

    render(<LogsTimelinePage />, { wrapper })

    await waitFor(() => expect(screen.getByText(/POS check 42 closed/)).toBeTruthy())
    // Absent is UNKNOWN: the page must not report an all-clear it was not told.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/registers/)).toBeNull()
    expect(chip('POS').textContent).toContain('1')
  })

  it('says a total failure is a failure, not a quiet restaurant', async () => {
    api.reject = true

    render(<LogsTimelinePage />, { wrapper })

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('The timeline could not be read')
    expect(screen.getByText('The timeline is unavailable')).toBeTruthy()
    expect(screen.queryByText(/^No events/)).toBeNull()
    // No register was reached, so none of them reports a count.
    expect(chip('POS').textContent).toContain('—')
  })

  it('shows a source it has not mirrored rather than a blank badge or a tally the chips contradict', async () => {
    // The page restates the gateway's TimelineSource union rather than importing
    // it, so the gateway can grow a seventh source this file has never heard of.
    // Two ways that used to go wrong: the tally counted it while the chip row
    // did not show it, and the event's own badge rendered EMPTY because the
    // label lookup returned undefined — an unknown printed as nothing.
    api.response = {
      events: [
        {
          id: 'w1',
          source: 'webhook_log',
          occurredAt: '2026-09-02T10:00:00.000Z',
          correlationId: null,
          summary: 'webhook delivered',
          detail: {},
        },
      ],
      correlationId: null,
      sourcesQueried: [...ALL_SIX, 'webhook_log'],
      failedSources: [],
    }

    render(<LogsTimelinePage />, { wrapper })

    await waitFor(() => expect(screen.getByText('webhook delivered')).toBeTruthy())
    // The tally counts seven and the chip row shows seven — they cannot disagree.
    expect(screen.getByText(/Read 7 of 7 registers/)).toBeTruthy()
    expect(chip('webhook_log').textContent).toContain('1')
    // The event's own badge names the raw key rather than rendering blank. It
    // used to be `<span class="…rounded…"></span>` — an unknown printed as
    // nothing — because SOURCE_LABEL['webhook_log'] is undefined.
    const badge = screen
      .getAllByText('webhook_log')
      .find((n) => n.tagName === 'SPAN' && n.className.includes('rounded'))
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toBe('webhook_log')
    // Nothing was skipped and nothing failed, so no alarm.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/not read:/)).toBeNull()
  })
})

describe('/logs — an undated row says so', () => {
  it('renders a null occurredAt as — rather than "Invalid Date"', async () => {
    api.response = {
      events: [
        {
          id: 'd1',
          source: 'procurement_documents',
          occurredAt: null,
          correlationId: null,
          summary: 'invoice #7 → received',
          detail: {},
        },
      ],
      correlationId: null,
      sourcesQueried: ALL_SIX,
      failedSources: [],
    }

    render(<LogsTimelinePage />, { wrapper })

    await waitFor(() => expect(screen.getByText(/invoice #7/)).toBeTruthy())
    expect(screen.queryByText(/Invalid Date/)).toBeNull()
    expect(screen.getByTitle('This row records no timestamp').textContent).toBe('—')
  })

  it('renders an unparseable timestamp as — too', async () => {
    api.response = {
      events: [
        {
          id: 'a1',
          source: 'system_audit_log',
          occurredAt: 'not-a-date',
          correlationId: null,
          summary: 'user updated wine',
          detail: {},
        },
      ],
      correlationId: null,
      sourcesQueried: ALL_SIX,
      failedSources: [],
    }

    render(<LogsTimelinePage />, { wrapper })

    await waitFor(() => expect(screen.getByText(/user updated wine/)).toBeTruthy())
    expect(screen.queryByText(/Invalid Date/)).toBeNull()
  })
})
