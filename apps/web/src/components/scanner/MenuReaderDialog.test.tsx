/**
 * "Scan a menu" on /inventory and /cellar reaches the real menu reader
 * (founder 2026-11-07, MU-2: "Repoint to menu reader"). The old scanner
 * posted to an unmounted orchestrator route and said "No wines were detected"
 * (QA M2). The dialog is the Menu page's own reader: it reads through
 * POST /menus/import, keeps a draft, and writes nothing to stock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { MenuReaderDialog } from './MenuReaderDialog'
import { importMenu } from '../../services/api/menus'

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

describe('the menu reader dialog', () => {
  it('opens the menu reader, reads through /menus/import as a draft, and adds nothing to stock', async () => {
    mockImport.mockResolvedValue({ menuId: 'm1', current: false, itemsExtracted: 2, submissionsCreated: 0, items: [] })
    mount(<MenuReaderDialog isOpen onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Read a menu' })).toHaveTextContent('it never adds bottles to stock')
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }))
    await waitFor(() => expect(mockImport).toHaveBeenCalledTimes(1))
    expect(mockImport.mock.calls[0][0]).toBe('scan')
    expect(await screen.findByTestId('menu-read-result')).toHaveTextContent('It is not the current menu, and no price has changed.')
    expect(screen.getByRole('button', { name: 'Make this the current menu' })).toBeInTheDocument()
  })

  it('staff may read a menu but are not offered the current-menu choice', async () => {
    role = 'staff'
    mockImport.mockResolvedValue({ menuId: 'm1', current: false, itemsExtracted: 1, submissionsCreated: 0, items: [] })
    mount(<MenuReaderDialog isOpen onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }))
    expect(await screen.findByText(/An owner or a manager chooses whether it becomes the current menu/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make this the current menu' })).not.toBeInTheDocument()
  })

  it('closes on Close, on Escape and on the backdrop; renders nothing when shut', () => {
    const onClose = vi.fn()
    const { rerender } = mount(<MenuReaderDialog isOpen onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('menu-reader-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(3)
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <MenuReaderDialog isOpen={false} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
