/** /get-started wears the one open book (AuthSpread): one Fraunces H1, the step on the folio, no literal colour. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth } = vi.hoisted(() => ({
  auth: { user: null as Record<string, unknown> | null, loading: false },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...auth, createFirstHouse: vi.fn(), signInWithSession: vi.fn(), logout: vi.fn() }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch: vi.fn() },
}))
vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => true }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ PlacesAutocomplete: () => null }))
vi.mock('../../components/ui/CountryCombobox', () => ({ CountryCombobox: () => null }))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import GetStarted from '../GetStarted'

beforeEach(() => {
  auth.user = { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true }
  auth.loading = false
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
})
