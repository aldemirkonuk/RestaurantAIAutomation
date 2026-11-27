/** /get-started wears the one open book (AuthSpread): one Fraunces H1, the step on the folio, no literal colour. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, createFirstHouse } = vi.hoisted(() => ({
  auth: { user: null as Record<string, unknown> | null, loading: false },
  createFirstHouse: vi.fn(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...auth, createFirstHouse, signInWithSession: vi.fn(), logout: vi.fn() }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch: vi.fn() },
}))
vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => true }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ PlacesAutocomplete: () => null }))
vi.mock('../../components/ui/CountryCombobox', () => ({
  CountryCombobox: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('Türkiye')}>Choose Türkiye</button>
  ),
}))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import GetStarted from '../GetStarted'

beforeEach(() => {
  auth.user = { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true }
  auth.loading = false
  createFirstHouse.mockResolvedValue({ restaurantId: 'house-1', detailsLoaded: true })
  sessionStorage.clear()
  localStorage.clear()
})

describe('GetStarted on the open book', () => {
  it('draws the restaurant step as the book: one H1, the step on the folio, a main landmark', async () => {
    const { container } = render(<MemoryRouter><GetStarted /></MemoryRouter>)
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Your restaurant' })
    expect(h1).toHaveClass('mdv-spread-title')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(container.querySelector('.mdv-endpaper')).not.toBeNull()
    expect(screen.getByText('01 · Your restaurant')).toHaveClass('mdv-ep-folio')
    expect(screen.getByRole('main')).toHaveClass('mdv-spread')
    expect(screen.getByText(/Welcome, Selin\./)).toHaveClass('mdv-spread-lede')
  })

  it('says its source no longer sets a literal colour, a serif stack or a card of its own', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/GetStarted.tsx'), 'utf8')
    expect(src).toMatch(/from '..\/components\/brand\/AuthSpread'/)
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b|font-serif|BrandMark|<h1/)
  })

  it('brings a refusal into view, since under the plate it can be below the fold', async () => {
    const seen: string[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      seen.push(this.getAttribute('role') ?? '')
    }
    try {
      render(<MemoryRouter><GetStarted /></MemoryRouter>)
      fireEvent.click(await screen.findByRole('button', { name: 'This is us' }))
      await screen.findByRole('alert')
      expect(seen).toContain('alert')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('puts a refusal under the plate, so the fields and the plate do not move when it arrives', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    const plate = await screen.findByRole('button', { name: 'This is us' })
    fireEvent.click(plate)
    const alert = await screen.findByRole('alert')
    expect(plate.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows two steps as one 2 px hairline that fills on the turn curve and stands still when motion is reduced', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    const bar = await screen.findByRole('progressbar', { name: 'Set-up progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuetext', 'Step 1 of 2')
    // The fill is drawn by transform, never by width (DD-r102-6): the class says the step.
    const fill = screen.getByTestId('gs-progress-fill')
    expect(fill).not.toHaveClass('mdv-spread-progress__fill--full')
    expect(fill.getAttribute('style') ?? '').not.toMatch(/width/)
    const css = readFileSync(resolve(process.cwd(), 'src/components/brand/endpaper.css'), 'utf8')
    expect(css).toMatch(/\.mdv-spread-progress \{\s*height: 2px;/)
    expect(css).toMatch(/\.mdv-spread-progress__fill \{[^}]*width: 100%;[^}]*transform: scaleX\(0\.5\);[^}]*transform-origin: left;[^}]*transition: transform 320ms cubic-bezier\(0\.16, 1, 0\.3, 1\);/)
    expect(css).toMatch(/\.mdv-spread-progress__fill--full \{\s*transform: scaleX\(1\);/)
    expect(css).toMatch(/\[dir='rtl'\] \.mdv-spread-progress__fill \{\s*transform-origin: right;/)
    expect(css).not.toMatch(/transition: width/)
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[\s\S]*?\.mdv-spread-progress__fill \{\s*transition: none;/)
  })

  it('moves focus to the new step\'s heading when the step turns, and not on arrival', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    const first = await screen.findByRole('heading', { level: 1, name: 'Your restaurant' })
    expect(first).not.toHaveFocus()
    for (const [label, value] of [['Restaurant name', 'Meyhane'], ['Address', '1 House Street'], ['City', 'Istanbul']])
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Türkiye' }))
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    const second = await screen.findByRole('heading', { level: 1, name: 'Your menu' })
    await waitFor(() => expect(second).toHaveFocus())
    expect(second).toHaveAttribute('tabindex', '-1')
    expect(screen.getByTestId('gs-progress-fill')).toHaveClass('mdv-spread-progress__fill--full')
  })
})
