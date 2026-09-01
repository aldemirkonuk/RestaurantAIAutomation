/**
 * `?focus=` ownership on /reports.
 *
 * This panel's deep-link effect fired on ANY `focus` value: it scrolled to the
 * insight list and then deleted the parameter. So `/reports?focus=revenue` —
 * the dashboard's "View full spend report →" (Dashboard.tsx:1162) — scrolled
 * to the wrong section AND consumed the parameter before the page that owns
 * the spend report could act on it. Two failures, one of them invisible.
 *
 * The contract now: this panel claims `focus=insights` and nothing else.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r-1' } }),
}))
vi.mock('../../../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
vi.mock('../../../../services/api/client', () => ({
  apiClient: {
    // Shapes the panel actually destructures: `{ insights: [] }` for the
    // insight list, a bare array for goals, `{ items: [] }` for disposition.
    get: vi.fn((url: string) => {
      if (url.includes('/goals/')) return Promise.resolve({ data: [] })
      if (url.includes('/actions')) return Promise.resolve({ data: { items: [] } })
      return Promise.resolve({ data: { insights: [] } })
    }),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  getErrorMessage: (e: unknown) => String(e),
}))

import { EngineInsightsPanel } from '../../organisms/EngineInsightsPanel'

/** Reports the live query string so the test can see what was consumed. */
function QueryProbe() {
  const [params] = useSearchParams()
  return <div data-testid="query">{params.toString()}</div>
}

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <QueryProbe />
      <div id="engine-insights">
        <EngineInsightsPanel />
      </div>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom implements no layout, so Element.scrollIntoView does not exist. The
  // panel calls it inside a requestAnimationFrame, where the throw escapes the
  // test body entirely and is only reported as an unhandled error.
  Element.prototype.scrollIntoView = vi.fn()
})

describe('EngineInsightsPanel and the focus parameter', () => {
  it('consumes focus=insights, which it does serve', async () => {
    at('/reports?focus=insights')
    await waitFor(() => expect(screen.getByTestId('query')).toHaveTextContent(''))
  })

  it('LEAVES focus=revenue alone for the page that owns the spend report', async () => {
    at('/reports?focus=revenue')
    // Give the mount effect every chance to run before asserting it did not.
    await waitFor(() => expect(screen.getByTestId('query')).toHaveTextContent('focus=revenue'))
  })

  it('still consumes openGoal on its own, without eating an unrelated focus', async () => {
    at('/reports?focus=revenue&openGoal=true')
    await waitFor(() => {
      const query = screen.getByTestId('query').textContent ?? ''
      expect(query).toContain('focus=revenue')
      expect(query).not.toContain('openGoal')
    })
  })
})
