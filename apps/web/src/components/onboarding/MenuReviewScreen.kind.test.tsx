/**
 * The review says what each line is (r108 menu-g13): a dish is not a wine, its
 * price is shown (read-only, in the house's money), and what the page read the
 * line as is shown when the gateway sent it. Reduced motion drops the
 * transitions and the chevron swaps glyph instead of turning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render as rtlRender, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MenuReviewScreen } from './MenuReviewScreen'
import type { MenuImportReviewItem } from '../../services/api/menus'
import { formatMoney } from '../../lib/currency'

vi.mock('../../hooks/queries/useHouseCurrencyCode', () => ({ useHouseCurrencyCode: () => 'TRY' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRole: 'owner', user: { role: 'owner' } }) }))
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, makeMenuCurrent: vi.fn(), addMenuItem: vi.fn(), reviewMenuItem: vi.fn(), getMenuPlan: vi.fn() }
})

const shown = (s: string) => s.replace(/\s+/g, ' ')
const money = (n: number) => shown(formatMoney(n, 'TRY'))

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const item = (over: Partial<MenuImportReviewItem>): MenuImportReviewItem => ({
  menuItemId: 'i1',
  submissionId: null,
  name: 'Adana Kebap',
  producer: null,
  category: 'mains',
  vintage: null,
  region: null,
  grapeVariety: null,
  byGlassPrice: null,
  bottlePrice: 450,
  rawText: null,
  matched: true,
  needsReview: false,
  ...over,
})
const dish = item({ rawText: 'Adana Kebap 450 TL, hot pepper' })
const wine = item({ menuItemId: 'i2', name: 'Barolo', producer: 'Conterno', category: 'red', bottlePrice: 900, byGlassPrice: 150, needsReview: true })

const mount = (items: MenuImportReviewItem[]) =>
  render(<MenuReviewScreen result={{ menuId: 'm9', itemsExtracted: items.length, submissionsCreated: 0, items }} onConfirm={vi.fn()} onSkip={vi.fn()} embedded />)

/** Open the fold of lines that read cleanly. */
const open = () => fireEvent.click(screen.getByRole('button', { name: /more look good/ }))

function reduceMotion(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('prefers-reduced-motion'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia
}

const original = window.matchMedia
beforeEach(() => reduceMotion(false))
afterEach(() => {
  window.matchMedia = original
})

describe('the review names each line by its kind', () => {
  it('a dish read has no wine words, no producer cell, and shows its price in house money', () => {
    mount([dish])
    expect(screen.queryByText(/Wine name/)).not.toBeInTheDocument()
    expect(screen.queryByText('Producer')).not.toBeInTheDocument()
    expect(screen.queryByText(/Add a wine|wines read|Wine name/)).not.toBeInTheDocument()
    expect(screen.getByText(/All 1 dish read cleanly/)).toBeInTheDocument()
    expect(screen.getByText(/Add a dish/)).toBeInTheDocument()
    open()
    expect(shown(screen.getByTestId('review-line-meta').textContent ?? '')).toContain(money(450))
    expect(screen.getByTestId('review-line-meta')).toHaveTextContent('mains')
  })

  it('a wine keeps producer, vintage and region, and shows bottle and glass', () => {
    mount([wine])
    expect(screen.getByText('Conterno')).toBeInTheDocument()
    expect(screen.getByText('Vintage')).toBeInTheDocument()
    expect(screen.getByText('Region')).toBeInTheDocument()
    const meta = shown(screen.getByTestId('review-line-meta').textContent ?? '')
    expect(meta).toContain(`Bottle ${money(900)}`)
    expect(meta).toContain(`Glass ${money(150)}`)
  })

  it('a clean read of wines says wines, and a read of spirits does not call them wines', () => {
    const { unmount } = mount([{ ...wine, needsReview: false }])
    expect(screen.getByText(/All 1 wine read cleanly/)).toBeInTheDocument()
    expect(screen.getByText(/Add a wine/)).toBeInTheDocument()
    unmount()
    mount([item({ menuItemId: 'i5', name: 'Rakı', category: 'spirit' })])
    expect(screen.getByText(/All 1 line read cleanly/)).toBeInTheDocument()
    expect(screen.getByText(/Add a line/)).toBeInTheDocument()
  })

  it('a mixed read says lines, and an unpriced line says so', () => {
    mount([dish, item({ menuItemId: 'i3', name: 'Rakı', category: 'spirit', bottlePrice: null, needsReview: true })])
    open()
    expect(screen.getByText(/Add a line/)).toBeInTheDocument()
    expect(screen.getAllByTestId('review-line-meta').some((m) => /No price was read/.test(m.textContent ?? ''))).toBe(true)
  })

  it('shows what the line was read as when it is there, and says nothing when the reply withheld it', () => {
    mount([dish, item({ menuItemId: 'i4', name: 'Pide', rawText: null })])
    open()
    const raw = screen.getAllByTestId('review-line-raw')
    expect(raw).toHaveLength(1)
    expect(raw[0]).toHaveTextContent('Read as: Adana Kebap 450 TL, hot pepper')
    expect(raw[0].className).toContain('text-xs')
  })

  it('takes no hard-coded teal or gray', () => {
    mount([dish, wine])
    open()
    const html = document.body.innerHTML
    expect(html).not.toMatch(/#1A5E6B|#14515C/i)
    expect(html.match(/(?<![:\w-])(?:text|bg|border)-gray-\d+/g)).toBeNull()
  })
})

describe('the review under reduced motion', () => {
  it('with motion on, the chevron keeps 150 ms and turns to point down when the fold opens', () => {
    mount([dish])
    const toggle = screen.getByRole('button', { name: /more look good/ })
    const chev = () => toggle.querySelector('svg:last-of-type') as SVGElement
    expect(chev().getAttribute('class')).toContain('duration-150')
    expect(chev().getAttribute('class')).not.toContain('rotate-90')
    fireEvent.click(toggle)
    expect(chev().getAttribute('class')).toContain('rotate-90')
    expect(screen.getByRole('button', { name: 'Adana Kebap' }).className).toContain('transition-colors')
  })

  it('with reduce, the chevron and the cell carry no transition, and the glyph is swapped, not turned', () => {
    reduceMotion(true)
    mount([dish])
    const toggle = screen.getByRole('button', { name: /more look good/ })
    const chev = () => (toggle.querySelector('svg:last-of-type') as SVGElement).getAttribute('class') ?? ''
    const before = toggle.innerHTML
    expect(chev()).not.toMatch(/transition|duration|rotate/)
    fireEvent.click(toggle)
    expect(chev()).not.toMatch(/transition|duration|rotate/)
    expect(toggle.innerHTML).not.toBe(before)
    expect(screen.getByRole('button', { name: 'Adana Kebap' }).className).not.toMatch(/\btransition-colors\b/)
  })
})
