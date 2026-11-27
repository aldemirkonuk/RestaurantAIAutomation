/** r107 onboarding g5: the /get-started fields carry autofill, keyboard and typing hints. */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { patch } = vi.hoisted(() => ({ patch: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true },
    loading: false,
    createFirstHouse: vi.fn(),
    signInWithSession: vi.fn(),
  }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch },
}))
vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => false }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ PlacesAutocomplete: () => null }))
vi.mock('../../components/ui/CountryCombobox', () => ({ CountryCombobox: () => null }))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import GetStarted from '../GetStarted'

const field = (label: string) => screen.getByLabelText(label)

beforeEach(() => {
  sessionStorage.clear()
  patch.mockResolvedValue({})
})

describe('GetStarted autofill', () => {
  it('names the person and the mobile', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(field('Your name')).toHaveAttribute('autocomplete', 'name')
    expect(field('Mobile')).toHaveAttribute('autocomplete', 'tel')
    expect(field('Mobile')).toHaveAttribute('inputmode', 'tel')
    expect(field('Mobile')).toHaveAttribute('enterkeyhint', 'done')
  })

  it('names the house fields', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByLabelText('Restaurant name')
    expect(field('Restaurant name')).toHaveAttribute('autocomplete', 'organization')
    expect(field('Address')).toHaveAttribute('autocomplete', 'address-line1')
    expect(field('City')).toHaveAttribute('autocomplete', 'address-level2')
    expect(field('Restaurant phone')).toHaveAttribute('autocomplete', 'tel')
    expect(field('Restaurant phone')).toHaveAttribute('inputmode', 'tel')
  })
})
