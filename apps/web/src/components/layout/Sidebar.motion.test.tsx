/**
 * ADR 0134 §5, locked by the founder 2026-09-21 ("Lock all four (Recommended)"): the sidebar,
 * split three ways.
 *
 *   (a) the reduced-motion guard goes in now, on every route and ungated,
 *       because it only ever removes motion — so a reader who has NOT asked
 *       for less must get byte-identical markup, and both halves are pinned;
 *   (b) the hover hint takes `ink` 160 in CSS, inside the house branch only;
 *   (c) the 260-to-72 collapse is left alone.
 *
 * The CSS half of (a) and (b) — what the attribute and the class actually do —
 * is pinned by `components/mudavym/motionRules0134.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'
import { useUIStore } from '../../stores/uiStore'

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react')
  return {
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Ada', role: 'manager', restaurantId: 'rest-1' },
      logout: vi.fn(),
    }),
  }
})

vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({
    progress: { completed_at: '2026-01-01', checklist_dismissed: true },
    update: vi.fn(),
  }),
}))

vi.mock('../../hooks/queries/useNotificationQueries', () => ({
  useUnreadCount: () => ({ data: 0 }),
}))

vi.mock('../../hooks/queries/useOrderQueries', () => ({
  usePendingOrdersCount: () => ({ data: 0 }),
}))

vi.mock('../../hooks/queries/useInventoryQueries', () => ({
  useLowStockItems: () => ({ data: [] }),
}))

/** Only the reduced-motion query answers; the rail is never in its phone form. */
function setReducedMotion(reduce: boolean) {
  const matchMedia = window.matchMedia as unknown as ReturnType<typeof vi.fn>
  matchMedia.mockImplementation(
    (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  )
}

const DASHBOARD_HINT = "Today's KPIs, alerts, and the actions worth doing first."

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  )
}

/** Hover the Dashboard row and wait out the rail's 320ms anti-strobe delay. */
function hoverDashboard(): HTMLElement {
  vi.useFakeTimers()
  try {
    fireEvent.mouseEnter(screen.getByRole('link', { name: /Dashboard/ }))
    act(() => {
      vi.advanceTimersByTime(320)
    })
  } finally {
    vi.useRealTimers()
  }
  const hint = screen.getByText(DASHBOARD_HINT).closest('[aria-hidden]') as HTMLElement | null
  if (!hint) throw new Error('the hint did not open')
  return hint
}

beforeEach(() => {
  setReducedMotion(false)
  resetMudavymShell()
})

afterEach(() => {
  resetMudavymShell()
  act(() => useUIStore.getState().setSidebarCollapsed(false))
})

/** Let framer-motion's frame loop run `n` animation frames. */
async function frames(n: number) {
  for (let i = 0; i < n; i += 1) {
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  }
}

/* The rail's own framer-motion: the 260-to-72 width (which names its own
   transition) and the labels that leave with it (which name none, so they take
   the rail's ReducedMotionScope). Each case has its full-motion control, so a guard
   that stopped every animation — or none — fails one of the pair. */
describe('§5(a) — the guard reaches the rail\'s framer-motion', () => {
  it('at full motion the collapse still takes its frames, and the label leaves on an exit', async () => {
    const { container } = renderSidebar()
    const rail = container.querySelector('aside') as HTMLElement
    expect(rail.style.width).toBe('260px')
    act(() => useUIStore.getState().setSidebarCollapsed(true))
    await frames(2)
    expect(rail.style.width).not.toBe('72px')
    expect(screen.getByText('Log Out')).toBeInTheDocument()
    await waitFor(() => expect(rail.style.width).toBe('72px'))
    await waitFor(() => expect(screen.queryByText('Log Out')).toBeNull())
  })

  it('under reduced motion the width lands and the label is gone with no frames between', async () => {
    setReducedMotion(true)
    const { container } = renderSidebar()
    const rail = container.querySelector('aside') as HTMLElement
    act(() => useUIStore.getState().setSidebarCollapsed(true))
    await frames(2)
    expect(rail.style.width).toBe('72px')
    expect(screen.queryByText('Log Out')).toBeNull()
  })
})

describe('§5(a) — the reduced-motion guard, ungated', () => {
  it('marks the rail only while the reader asks for less', () => {
    const { container, unmount } = renderSidebar()
    // Byte-identical for everyone else: the attribute is not there at all.
    expect(container.querySelector('aside')).not.toHaveAttribute('data-reduced-motion')
    unmount()

    setReducedMotion(true)
    const reduced = renderSidebar()
    expect(reduced.container.querySelector('aside')).toHaveAttribute('data-reduced-motion', 'true')
  })

  it('leaves the legacy hint exactly as it shipped when motion is allowed', () => {
    renderSidebar()
    const hint = hoverDashboard()
    // framer-motion paints `initial` inline on the first frame.
    expect(hint.style.opacity).toBe('0')
    expect(hint.style.transform).toContain('translateX(-4px)')
    expect(hint).not.toHaveClass('mdv-hint')
  })

  it('starts the legacy hint at its end state under reduced motion — no fade, no slide', () => {
    setReducedMotion(true)
    renderSidebar()
    const hint = hoverDashboard()
    expect(hint.style.opacity).toBe('1')
    expect(hint.style.transform).not.toContain('translateX(-4px)')
  })
})

describe('§5(b) — the house hint on `ink`, in CSS', () => {
  it('is a plain element carrying .mdv-hint, with no framer-motion styles and its shipped geometry', () => {
    claimMudavymShell(Symbol('test-page'), 'paper')
    renderSidebar()
    const hint = hoverDashboard()
    expect(hint).toHaveClass('mudavym', 'mdv-hint')
    // The motion is the stylesheet's now: nothing inline starts it or ends it.
    expect(hint.style.opacity).toBe('')
    expect(hint.style.transform).toBe('')
    // framer-motion's inline transform always overrode this class, so it never
    // applied; keeping it would lift the hint by half its height.
    expect(hint).not.toHaveClass('-translate-y-1/2')
  })

  it('is the same element under reduced motion — the stylesheet is what stops it', () => {
    claimMudavymShell(Symbol('test-page'), 'paper')
    setReducedMotion(true)
    renderSidebar()
    const hint = hoverDashboard()
    expect(hint).toHaveClass('mdv-hint')
    expect(hint.style.opacity).toBe('')
  })
})
