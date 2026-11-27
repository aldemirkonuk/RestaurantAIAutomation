/**
 * A correction the gateway refuses (or that never arrives) is SAID in the
 * cell, never dropped: the cell keeps the saved word and says why (ADR 0020).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MenuReviewScreen } from './MenuReviewScreen'
import { reviewMenuItem } from '../../services/api/menus'

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'owner', user: { role: 'owner' } }),
}))
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, makeMenuCurrent: vi.fn(), addMenuItem: vi.fn(), reviewMenuItem: vi.fn(), getMenuPlan: vi.fn() }
})

const mockReview = vi.mocked(reviewMenuItem)
const RESULT = {
  menuId: 'm9',
  itemsExtracted: 1,
  submissionsCreated: 0,
  items: [
    {
      menuItemId: 'mi-1',
      submissionId: null,
      name: 'Narince',
      producer: 'Kayra',
      category: null,
      vintage: null,
      region: null,
      grapeVariety: null,
      byGlassPrice: null,
      bottlePrice: null,
      rawText: null,
      matched: false,
      needsReview: true,
    },
  ],
}

beforeEach(() => mockReview.mockReset())

async function editName(to: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Narince' }))
  const box = screen.getByDisplayValue('Narince')
  fireEvent.change(box, { target: { value: to } })
  fireEvent.blur(box)
}

describe('MenuReviewScreen: a refused correction', () => {
  it("says the gateway's words and keeps the saved word", async () => {
    mockReview.mockRejectedValueOnce({ response: { data: { message: 'The name cannot be blank' } } })
    render(<MenuReviewScreen result={RESULT as never} onConfirm={vi.fn()} onSkip={vi.fn()} />)
    await editName('   ')
    expect(await screen.findByText('Not saved: The name cannot be blank')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Narince' })).toBeInTheDocument()
  })

  it('says a failed save plainly when nothing came back to read', async () => {
    mockReview.mockRejectedValueOnce(new Error('Network Error'))
    render(<MenuReviewScreen result={RESULT as never} onConfirm={vi.fn()} onSkip={vi.fn()} />)
    await editName('Emir')
    expect(await screen.findByText('Not saved: Network Error')).toBeInTheDocument()
  })

  it('clears the note when the cell is edited again and saves', async () => {
    mockReview.mockRejectedValueOnce({ response: { data: { message: ['too long'] } } })
    mockReview.mockResolvedValueOnce({ menuItemId: 'mi-1', fieldName: 'name', newValue: 'Emir' })
    render(<MenuReviewScreen result={RESULT as never} onConfirm={vi.fn()} onSkip={vi.fn()} />)
    await editName('x')
    expect(await screen.findByText('Not saved: too long')).toBeInTheDocument()
    await editName('Emir')
    await waitFor(() => expect(screen.queryByText(/Not saved/)).not.toBeInTheDocument())
    expect(await screen.findByRole('button', { name: 'Emir' })).toBeInTheDocument()
  })
})
