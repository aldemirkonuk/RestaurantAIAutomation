/**
 * r110 menu-r110-5 (r109 g3 web half, DD-r109-24): the review lists every
 * size a line prints, as printed, and says what does not move them. Sizes are
 * shown, never carried: choosing the menu sends the plan's own fingerprint
 * and nothing about a size.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MenuReviewScreen } from './MenuReviewScreen'
import { getMenuPlan, makeMenuCurrent, type MenuImportReviewItem } from '../../services/api/menus'
import { formatMoney } from '../../lib/currency'
import { SIZES_STAY } from '../../pages/menu/next/PrintedSizes'

vi.mock('../../hooks/queries/useHouseCurrencyCode', () => ({ useHouseCurrencyCode: () => 'TRY' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRole: 'owner', user: { role: 'owner' } }) }))
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, makeMenuCurrent: vi.fn(), addMenuItem: vi.fn(), reviewMenuItem: vi.fn(), getMenuPlan: vi.fn() }
})
const mockMake = vi.mocked(makeMenuCurrent)
const mockPlan = vi.mocked(getMenuPlan)
const shown = (s: string) => s.replace(/\s+/g, ' ')
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
const item = (over: Partial<MenuImportReviewItem> = {}): MenuImportReviewItem => ({
  menuItemId: 'mi-1', submissionId: null, name: 'Yeni Rakı', producer: null, category: 'spirits', vintage: null, region: null,
  grapeVariety: null, byGlassPrice: 450, bottlePrice: 1200, rawText: 'Yeni Rakı 20 cl 450 35 cl 700 70 cl 1200', matched: true, needsReview: true,
  ...over,
})
const SIZES = [
  { label: '20 cl', ml: 200, price: 450 },
  { label: '35 cl', ml: 350, price: 700 },
  { label: '70 cl', ml: 700, price: 1200 },
]

beforeEach(() => {
  mockMake.mockReset()
  mockPlan.mockReset()
  mockPlan.mockResolvedValue({
    menuId: 'm9', current: false, generatedAt: '2026-09-21T12:00:00Z', fingerprint: 'fp-m9', lines: [],
    counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, new_wine: 0 },
    dormantLocks: [], namesReadable: true, namesReason: null,
  })
})

describe('MenuReviewScreen -- every printed size, as printed', () => {
  it('lists each size with its label and price, in the printed order, and says what leaves them as they are', () => {
    render(<MenuReviewScreen result={{ menuId: 'm9', itemsExtracted: 1, submissionsCreated: 0, items: [item({ printedSizes: SIZES })] }} onConfirm={vi.fn()} onSkip={vi.fn()} />)
    const sizes = screen.getByTestId('menu-line-sizes')
    const said = SIZES.map((s) => `${s.label} ${formatMoney(s.price, 'TRY')}`)
    expect(shown(sizes.getAttribute('aria-label') ?? '')).toBe(shown(`Sizes as printed on the menu: ${said.join(', ')}`))
    expect(shown(sizes.textContent ?? '')).toContain(shown(said.join(' · ')))
    expect(within(sizes).getByText(SIZES_STAY)).toBeInTheDocument()
  })

  it('a line with one size or none shows no sizes, and claims nothing', () => {
    render(
      <MenuReviewScreen
        result={{ menuId: 'm9', itemsExtracted: 2, submissionsCreated: 0, items: [item({ printedSizes: [SIZES[0]] }), item({ menuItemId: 'mi-2', name: 'Efes', printedSizes: null })] }}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
      />,
    )
    expect(screen.getByText('Efes')).toBeInTheDocument()
    expect(screen.queryByTestId('menu-line-sizes')).toBeNull()
  })

  it('choosing the menu sends the plan fingerprint as given: no size enters it', async () => {
    mockMake.mockResolvedValue({ outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 1, priceSync: {}, flagged: 0, failed: [] })
    render(<MenuReviewScreen result={{ menuId: 'm9', itemsExtracted: 1, submissionsCreated: 0, items: [item({ printedSizes: SIZES })] }} onConfirm={vi.fn()} onSkip={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Make this the current menu/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }))
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m9', 'fp-m9'))
    expect(JSON.stringify(mockMake.mock.calls)).not.toMatch(/20 cl|700/)
  })
})
