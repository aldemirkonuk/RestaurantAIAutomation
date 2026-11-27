/**
 * ADR 0112: reduced motion = no animation. Every onboarding wait stops
 * spinning and says its state in words (r107 onboarding g1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Pending } from './Pending'
import { MenuScanUpload } from './MenuScanUpload'
import { MenuCsvUpload } from './MenuCsvUpload'
import { MenuManualEntry } from './MenuManualEntry'
import { MenuReviewScreen } from './MenuReviewScreen'
import { importMenu, reviewMenuItem } from '../../services/api/menus'

vi.mock('../scanner/CameraCapture', () => ({
  CameraCapture: ({ onFileUpload }: { onFileUpload: (b: string) => void }) => (
    <button onClick={() => onFileUpload('AAAA')}>send photo</button>
  ),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'owner', user: { role: 'owner' } }),
}))
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, importMenu: vi.fn(), reviewMenuItem: vi.fn(), getMenuPlan: vi.fn() }
})

function setReduced(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const noSpin = (c: HTMLElement) => expect(c.querySelector('.animate-spin')).toBeNull()

beforeEach(() => {
  vi.mocked(importMenu).mockReset()
  vi.mocked(importMenu).mockReturnValue(new Promise(() => {}))
  vi.mocked(reviewMenuItem).mockReturnValue(new Promise(() => {}))
})
afterEach(() => setReduced(false))

describe('Pending', () => {
  it('spins in normal motion', () => {
    setReduced(false)
    const { container } = render(<Pending label="Opening the house…" />)
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.getByText('Opening the house…')).toBeTruthy()
  })
  it('is still, with the words, under reduced motion; the ring keeps its box', () => {
    setReduced(false)
    const spin = render(<Pending size="lg" label="x" />).container.firstElementChild!.firstElementChild!.className
    setReduced(true)
    const { container } = render(<Pending size="lg" label="Opening the house…" />)
    noSpin(container)
    expect(screen.getByText('Opening the house…')).toBeTruthy()
    const still = container.firstElementChild!.firstElementChild!.className
    for (const c of ['w-12', 'h-12', 'border-4']) {
      expect(spin).toContain(c)
      expect(still).toContain(c)
    }
  })
})

describe('the four menu waits under reduced motion', () => {
  beforeEach(() => setReduced(true))

  it('MenuScanUpload', async () => {
    const { container } = render(<MenuScanUpload onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByText('send photo'))
    await screen.findByText('Reading your menu…')
    noSpin(container)
  })

  it('MenuManualEntry', async () => {
    const { container } = render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Château Margaux 2018 or Negroni'), { target: { value: 'Barolo' } })
    fireEvent.click(screen.getByRole('button', { name: /^Import/ }))
    await screen.findByText('Importing…')
    noSpin(container)
  })

  it('MenuCsvUpload', async () => {
    const { container } = render(<MenuCsvUpload onSuccess={vi.fn()} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['name,producer\nBarolo,Conterno\n'], 'wines.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [file] } })
    const go = await screen.findByRole('button', { name: /^Import/ })
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(go)
    await screen.findByText(/Importing/)
    noSpin(container)
  })

  it('MenuReviewScreen (a saving cell)', async () => {
    const client = new QueryClient()
    const result = {
      menuId: 'm1',
      itemsExtracted: 1,
      submissionsCreated: 0,
      items: [
        {
          menuItemId: 'i1', submissionId: null, name: 'Barolo', producer: null, category: null, vintage: null,
          region: null, grapeVariety: null, byGlassPrice: null, bottlePrice: null, rawText: null,
          matched: true, needsReview: true,
        },
      ],
    }
    const { container } = render(
      <QueryClientProvider client={client}>
        <MenuReviewScreen result={result as never} onConfirm={vi.fn()} onSkip={vi.fn()} />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByText('Barolo'))
    const box = container.querySelector('input') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'Barolo Riserva' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('Saving…')
    noSpin(container)
  })
})
