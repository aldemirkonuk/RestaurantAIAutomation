/**
 * j / k walk the lines that need a look (r109 g7): flagged first, then the clean
 * ones when their fold is open; Enter corrects, Escape returns to the row, a
 * save moves on; keys typed inside an input never walk.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MenuReviewScreen } from './MenuReviewScreen'
import { reviewMenuItem, type MenuImportReviewItem } from '../../services/api/menus'

vi.mock('../../hooks/queries/useHouseCurrencyCode', () => ({ useHouseCurrencyCode: () => 'TRY' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRole: 'owner', user: { role: 'owner' } }) }))
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, makeMenuCurrent: vi.fn(), addMenuItem: vi.fn(), reviewMenuItem: vi.fn(), getMenuPlan: vi.fn() }
})

const item = (id: string, over: Partial<MenuImportReviewItem> = {}): MenuImportReviewItem => ({
  menuItemId: id, submissionId: null, name: `Line ${id}`, producer: null, category: 'mains', vintage: null,
  region: null, grapeVariety: null, byGlassPrice: null, bottlePrice: 100, rawText: null, matched: true, needsReview: true, ...over,
})
const items = [item('a'), item('b'), item('c'), item('z', { needsReview: false })]

function pointer(fine: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: fine && q.includes('pointer: fine'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(
    <QueryClientProvider client={client}>
      <MenuReviewScreen embedded canChoose result={{ menuId: 'm9', itemsExtracted: 4, submissionsCreated: 0, items }} onConfirm={vi.fn()} onSkip={vi.fn()} />
    </QueryClientProvider>,
  )
}
const row = (id: string) => document.getElementById(`review-line-${id}`) as HTMLElement
const press = (key: string, over: KeyboardEventInit = {}, target: Element = document.body) => fireEvent.keyDown(target, { key, ...over })

beforeEach(() => {
  pointer(true)
  vi.mocked(reviewMenuItem).mockReset()
  vi.mocked(reviewMenuItem).mockResolvedValue(undefined as never)
})

describe('walking the lines by key', () => {
  it('j moves to the next line that needs a look, k back, and says where it is', () => {
    mount()
    press('j')
    expect(document.activeElement).toBe(row('a'))
    press('j')
    expect(document.activeElement).toBe(row('b'))
    expect(row('b').getAttribute('aria-current')).toBe('true')
    expect(row('a').getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('Line 2 of 3 to look at')
    press('k')
    expect(document.activeElement).toBe(row('a'))
  })

  it('Alt with the arrows does the same, and a plain arrow does nothing', () => {
    mount()
    press('ArrowDown')
    expect(document.activeElement).not.toBe(row('a'))
    press('ArrowDown', { altKey: true })
    press('ArrowDown', { altKey: true })
    expect(document.activeElement).toBe(row('b'))
    press('ArrowUp', { altKey: true })
    expect(document.activeElement).toBe(row('a'))
  })

  it('the clean lines follow the flagged ones once their fold is open', () => {
    mount()
    press('j')
    press('j')
    press('j')
    press('j')
    expect(document.activeElement).toBe(row('c'))
    fireEvent.click(screen.getByRole('button', { name: /more look good/ }))
    press('j')
    expect(document.activeElement).toBe(row('z'))
  })

  it('keys typed inside an input do not walk', () => {
    mount()
    press('j')
    press('Enter', {}, row('a'))
    const input = screen.getByRole('textbox')
    press('j', {}, input)
    press('k', {}, input)
    expect(document.activeElement).toBe(input)
    expect(row('a').getAttribute('aria-current')).toBe('true')
  })

  it('Enter on a row opens its first cell, and a save moves on to the next line', async () => {
    mount()
    press('j')
    press('Enter', {}, row('a'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Fixed' } })
    press('Enter', {}, input)
    await waitFor(() => expect(reviewMenuItem).toHaveBeenCalledWith('a', 'name', 'Fixed'))
    await waitFor(() => expect(document.activeElement).toBe(row('b')))
  })

  it('Escape returns to the row', async () => {
    mount()
    press('j')
    press('Enter', {}, row('a'))
    press('Escape', {}, screen.getByRole('textbox'))
    await waitFor(() => expect(document.activeElement).toBe(row('a')))
  })

  it('the hint shows only on a fine pointer', () => {
    mount()
    expect(screen.getByTestId('review-keys-hint').textContent).toBe('j / k to move, Enter to correct')
  })

  it('and not on a touch screen', () => {
    pointer(false)
    mount()
    expect(screen.queryByTestId('review-keys-hint')).toBeNull()
  })
})
