/**
 * The review keeps the menu it was read from beside the lines (r109 g6): an
 * owner or manager sees it, staff do not; a sheet says it cannot be shown; the
 * room is held before the link resolves.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MenuReviewScreen } from './MenuReviewScreen'
import { getMenuSourceUrl, type MenuImportReviewItem } from '../../services/api/menus'

vi.mock('../../hooks/queries/useHouseCurrencyCode', () => ({ useHouseCurrencyCode: () => 'TRY' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRole: 'owner', user: { role: 'owner' } }) }))
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, getMenuSourceUrl: vi.fn(), makeMenuCurrent: vi.fn(), addMenuItem: vi.fn(), reviewMenuItem: vi.fn(), getMenuPlan: vi.fn() }
})

const css = readFileSync(join(__dirname, 'menu-review-source.css'), 'utf8')

const line: MenuImportReviewItem = {
  menuItemId: 'i1', submissionId: null, name: 'Adana Kebap', producer: null, category: 'mains', vintage: null,
  region: null, grapeVariety: null, byGlassPrice: null, bottlePrice: 450, rawText: null, matched: true, needsReview: false,
}

function mount(canChoose: boolean, source: { menuId: string; mime: string | null } | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <MenuReviewScreen
        embedded
        canChoose={canChoose}
        source={source}
        result={{ menuId: 'm9', itemsExtracted: 1, submissionsCreated: 0, items: [line] }}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
      />
    </QueryClientProvider>
  )
  return rtlRender(ui)
}

beforeEach(() => {
  vi.mocked(getMenuSourceUrl).mockReset()
  vi.mocked(getMenuSourceUrl).mockResolvedValue({ url: 'https://files.example/menu.jpg' } as never)
})

describe('the kept menu beside the review', () => {
  it('an owner or manager sees it, open by default for a photo, and the link is asked for', async () => {
    mount(true, { menuId: 'm9', mime: 'image/jpeg' })
    expect(screen.getByTestId('menu-source-pane')).toBeTruthy()
    await waitFor(() => expect(getMenuSourceUrl).toHaveBeenCalledWith('m9'))
    expect(await screen.findByAltText('The kept menu, as it was read')).toBeTruthy()
  })

  it('staff get no pane and no link is asked for', () => {
    mount(false, { menuId: 'm9', mime: 'image/jpeg' })
    expect(screen.queryByTestId('menu-source-pane')).toBeNull()
    expect(getMenuSourceUrl).not.toHaveBeenCalled()
  })

  it('no kept file, no pane', () => {
    mount(true, null)
    expect(screen.queryByTestId('menu-source-pane')).toBeNull()
  })

  it('a sheet says in words that it cannot be shown once asked', async () => {
    mount(true, { menuId: 'm9', mime: 'text/csv' })
    fireEvent.click(screen.getByRole('button', { name: /Show the kept menu/ }))
    expect(await screen.findByTestId('menu-source-unshown')).toHaveTextContent('a sheet cannot be shown here')
  })

  it('holds its 420 px room before the link resolves', () => {
    vi.mocked(getMenuSourceUrl).mockReturnValue(new Promise(() => {}))
    mount(true, { menuId: 'm9', mime: 'application/pdf' })
    expect(screen.getByRole('region', { name: 'The kept menu' }).style.minHeight).toBe('420px')
  })
})

describe('the layout and its motion', () => {
  it('a sticky right column of min(46%, 520px) from 900 px, a fold above the lines under it', () => {
    expect(css).toMatch(/@media \(min-width: 900px\)[\s\S]*position: sticky;[\s\S]*top: 16px;[\s\S]*width: min\(46%, 520px\)/)
    expect(css).toMatch(/grid-template-rows 280ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/)
    expect(css).toMatch(/transform 220ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/)
  })

  it('under reduced motion the fold and the chevron are instant', () => {
    const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(block).toMatch(/\.mdv-rsrc__fold,\s*\.mdv-rsrc__chev\s*\{\s*transition: none/)
  })
})
