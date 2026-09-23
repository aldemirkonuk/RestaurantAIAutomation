/**
 * Focused regression test for the provider-health 403 fix (wave-5 IJ confirm, R5).
 *
 * Before this pass, fetchProviders' catch block reported every infra provider as
 * "Unknown" for ANY failure, including a 403 from OwnerOrPlatformOperatorGuard on
 * /api/v1/health/providers — the same guard fetchAgentMetrics's catch already names
 * elsewhere on this page. A manager without a platform-operator grant saw what looked
 * like a full infrastructure outage instead of a permission they simply do not hold.
 * This only covers the default "general" tab, where the providers fetch runs on mount;
 * the "agents" tab's own 403 message (already covered by its own status-code switch)
 * is not re-tested here.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    isAxiosError: (error: unknown): boolean =>
      !!error && typeof error === 'object' && (error as Record<string, unknown>).isAxiosError === true,
  },
}))

import axios from 'axios'
import AdminPanel from './AdminPanel'

const mockedGet = vi.mocked(axios.get)
const axiosError = (status: number) => Object.assign(new Error(`Request failed with status ${status}`), {
  isAxiosError: true,
  response: { status },
})

const open = () => render(<MemoryRouter><AdminPanel /></MemoryRouter>)

beforeEach(() => {
  mockedGet.mockReset()
})

/* No `vi.restoreAllMocks()` here: `__tests__/setup.ts` installs `matchMedia`,
   `ResizeObserver` and friends as `vi.fn()` implementations for every test in
   this file, and restoring would strip them after the first test — AdminPanel
   also renders `framer-motion` components elsewhere on this page, whose mount
   effect throws on a missing `matchMedia`. */

describe('AdminPanel infra providers', () => {
  it('shows measured provider status on a successful read', async () => {
    mockedGet.mockResolvedValue({
      data: { providers: [{ id: 'supabase', name: 'Database', desc: 'Supabase PostgreSQL', status: 'Configured', healthy: true }] },
    })
    open()
    await screen.findByText('Configured')
    expect(screen.queryByText('Permission needed')).not.toBeInTheDocument()
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  })

  it('names a 403 as a permission gap, not an outage (R5)', async () => {
    mockedGet.mockRejectedValue(axiosError(403))
    open()
    const labels = await screen.findAllByText('Permission needed')
    // One per hardcoded fallback provider (supabase, rabbitmq, redis, gemini, claude).
    expect(labels).toHaveLength(5)
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  })

  it('still reports "Unknown" for a non-permission failure', async () => {
    mockedGet.mockRejectedValue(new Error('Network error'))
    open()
    const labels = await waitFor(() => screen.getAllByText('Unknown'))
    expect(labels).toHaveLength(5)
    expect(screen.queryByText('Permission needed')).not.toBeInTheDocument()
  })
})
