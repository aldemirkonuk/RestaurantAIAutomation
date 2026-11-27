/**
 * "Scan a menu" on /inventory and /cellar reaches the real menu reader
 * (founder 2026-11-07, MU-2: "Repoint to menu reader"). The old scanner
 * posted to an unmounted orchestrator route and said "No wines were detected"
 * (QA M2); these tests prove both buttons open the reader, the inventory one
 * reports nothing as added to stock, and the cellar keeps its next step.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { MenuScannerFlow } from '../scanner/MenuScannerFlow'
import { MenuScannerModal, lineToDetected, unmatchedLines } from './MenuScannerModal'
import { importMenu, type MenuImportResult, type MenuImportReviewItem } from '../../services/api/menus'

let role = 'manager'
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, activeRole: role, user: null }),
}))
vi.mock('../../stores', () => ({
  useAuthStore: (sel: (s: { activeRestaurantId: string }) => unknown) => sel({ activeRestaurantId: 'r1' }),
}))
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, importMenu: vi.fn(), getMenuPlan: vi.fn(), makeMenuCurrent: vi.fn() }
})
const mockImport = vi.mocked(importMenu)

function item(over: Partial<MenuImportReviewItem>): MenuImportReviewItem {
  return {
    menuItemId: 'i1', submissionId: null, name: 'Barolo Cannubi', producer: 'Brezza', category: 'red',
    vintage: '2019', region: 'Piedmont', grapeVariety: 'Nebbiolo', byGlassPrice: null, bottlePrice: 90,
    rawText: null, matched: false, needsReview: true, ...over,
  }
}

function mount(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  role = 'manager'
  mockImport.mockReset()
})

describe('Scan a menu on /inventory', () => {
  it('opens the menu reader, and never reports bottles as added to stock', async () => {
    mockImport.mockResolvedValue({ menuId: 'm1', current: false, itemsExtracted: 2, submissionsCreated: 0, items: [] })
    const onWinesAdded = vi.fn()
    mount(<MenuScannerFlow isOpen onClose={() => {}} onWinesAdded={onWinesAdded} />)
    expect(screen.getByRole('dialog', { name: 'Read a menu' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }))
    expect(await screen.findByTestId('menu-read-result')).toBeInTheDocument()
    expect(mockImport.mock.calls[0][0]).toBe('scan')
    expect(onWinesAdded).not.toHaveBeenCalled()
  })
})

describe('Scan a menu on /cellar', () => {
  it('after a read, hands only the lines the library does not know to the cellar questions', async () => {
    mockImport.mockResolvedValue({
      menuId: 'm1', current: false, itemsExtracted: 3, submissionsCreated: 2,
      items: [item({ menuItemId: 'a' }), item({ menuItemId: 'b', matched: true, name: 'Known' }), item({ menuItemId: 'c', name: 'Champagne Brut', producer: 'Krug', vintage: 'NV' })],
    })
    const onWinesDetected = vi.fn()
    mount(<MenuScannerModal isOpen onClose={() => {}} onWinesDetected={onWinesDetected} />)
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }))
    expect(await screen.findByTestId('menu-reader-cellar-step')).toHaveTextContent('2 lines are not in the wine library yet')
    fireEvent.click(screen.getByRole('button', { name: 'Ask about these 2 in the cellar' }))
    expect(onWinesDetected).toHaveBeenCalledWith([
      { name: 'Barolo Cannubi', producer: 'Brezza', vintage: 2019, region: 'Piedmont', grapeVariety: 'Nebbiolo' },
      { name: 'Champagne Brut', producer: 'Krug', vintage: null, region: 'Piedmont', grapeVariety: 'Nebbiolo' },
    ])
  })

  it('closing the dialog drops the cellar step: a reopened dialog does not offer the last menu', async () => {
    mockImport.mockResolvedValue({
      menuId: 'm1', current: false, itemsExtracted: 1, submissionsCreated: 0, items: [item({ menuItemId: 'a' })],
    })
    const onWinesDetected = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = (open: boolean) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MenuScannerModal isOpen={open} onClose={() => {}} onWinesDetected={onWinesDetected} />
        </MemoryRouter>
      </QueryClientProvider>
    )
    const { rerender } = render(ui(true))
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }))
    expect(await screen.findByTestId('menu-reader-cellar-step')).toBeInTheDocument()
    rerender(ui(false))
    rerender(ui(true))
    expect(screen.getByRole('dialog', { name: 'Read a menu' })).toBeInTheDocument()
    expect(screen.queryByTestId('menu-reader-cellar-step')).toBeNull()
  })

  it('a new read drops the last read\'s step at once, and a failed one leaves none', async () => {
    mockImport.mockResolvedValueOnce({
      menuId: 'm1', current: false, itemsExtracted: 1, submissionsCreated: 0, items: [item({ menuItemId: 'a' })],
    })
    mount(<MenuScannerModal isOpen onClose={() => {}} onWinesDetected={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }))
    expect(await screen.findByTestId('menu-reader-cellar-step')).toBeInTheDocument()
    mockImport.mockRejectedValueOnce({ response: { status: 422, data: { message: 'No line could be read.' } } })
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [new File(['%PDF'], 'b.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }))
    expect(await screen.findByText(/No line could be read/)).toBeInTheDocument()
    expect(screen.queryByTestId('menu-reader-cellar-step')).toBeNull()
  })

  it('a dish is never handed to the cellar: answering for it would put a dessert in the wine library', () => {
    const read = {
      items: [
        item({ menuItemId: 'w', name: 'Barolo Cannubi' }),
        item({ menuItemId: 'k', name: 'Tiramisu', category: 'food', producer: null, vintage: null, region: null, grapeVariety: null }),
        item({ menuItemId: 'm', name: 'Opus One', matched: true }),
      ],
    } as unknown as MenuImportResult
    expect(unmatchedLines(read).map((i) => i.menuItemId)).toEqual(['w'])
  })

  it('a line with no producer is not offered to the cellar, and the step says why (browser walk 2026-11-12)', async () => {
    mockImport.mockResolvedValue({
      menuId: 'm1', current: false, itemsExtracted: 2, submissionsCreated: 0,
      items: [item({ menuItemId: 'h', name: 'House Red', producer: null, vintage: null }), item({ menuItemId: 't', name: 'Tiramisu', category: 'Desserts', producer: null, vintage: null, region: null, grapeVariety: null })],
    })
    mount(<MenuScannerModal isOpen onClose={() => {}} onWinesDetected={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }))
    expect(await screen.findByTestId('menu-reader-cellar-unnamed')).toHaveTextContent(
      '1 line is not in the wine library and names no producer, so the cellar has nothing to ask about it.',
    )
    expect(screen.queryByTestId('menu-reader-cellar-step')).toBeNull()
    expect(screen.queryByRole('button', { name: /in the cellar$/ })).toBeNull()
  })

  it('beside lines it can ask about, the step counts the ones it leaves out', async () => {
    mockImport.mockResolvedValue({
      menuId: 'm1', current: false, itemsExtracted: 2, submissionsCreated: 0,
      items: [item({ menuItemId: 'a' }), item({ menuItemId: 'h', name: 'House Red', producer: ' ', vintage: null })],
    })
    const onWinesDetected = vi.fn()
    mount(<MenuScannerModal isOpen onClose={() => {}} onWinesDetected={onWinesDetected} />)
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }))
    expect(await screen.findByTestId('menu-reader-cellar-step')).toHaveTextContent(
      '1 line is not in the wine library yet. The cellar can ask about it one at a time; nothing is written until you answer. 1 more names no producer, so it is left out.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ask about it in the cellar' }))
    expect(onWinesDetected).toHaveBeenCalledWith([expect.objectContaining({ name: 'Barolo Cannubi', producer: 'Brezza' })])
  })

  it('a line with no producer goes over with an empty one (the cellar drops it, never guesses)', () => {
    expect(lineToDetected(item({ producer: null, vintage: null })).producer).toBe('')
  })
})
