/**
 * r28 onboarding gap 14: an owner whose house's menu is already current is not
 * offered "One last step · Your menu" again. The guide links (Learn & Help
 * "App usage guide", /help "The app guide") land on /get-started.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate, createFirstHouse, readHouseMenuStanding, auth } = vi.hoisted(() => ({
  navigate: vi.fn(),
  createFirstHouse: vi.fn(),
  readHouseMenuStanding: vi.fn(),
  auth: { user: null as Record<string, unknown> | null },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, loading: false, createFirstHouse, signInWithSession: vi.fn() }),
}))
vi.mock('../../lib/houseMenuStanding', () => ({ readHouseMenuStanding }))
vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))
vi.mock('../../services/api/settings', () => ({
  settingsApi: { houseCurrency: vi.fn().mockResolvedValue(null) },
}))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => false }))
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

const page = () => <MemoryRouter><GetStarted /></MemoryRouter>
const owner = { name: 'Selin Kaya', restaurantId: 'house-1', role: 'owner', emailVerified: true }
const DRAFT = /A menu read earlier is kept as a draft\. Choose it on Menu, or read another here\./

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = owner
  sessionStorage.clear()
})

describe('GetStarted: a house that already has a menu', () => {
  it('a current menu goes on to /house, with no second read offered', async () => {
    readHouseMenuStanding.mockResolvedValue('current')
    render(page())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/house', { replace: true }))
    expect(readHouseMenuStanding).toHaveBeenCalledTimes(1)
  })

  it('a kept draft is named, with the way to choose it on Menu, and the read stays offered', async () => {
    readHouseMenuStanding.mockResolvedValue('draft')
    render(page())
    const note = await waitFor(() => {
      const found = screen.getAllByRole('status').find((el) => DRAFT.test(el.textContent ?? ''))
      if (!found) throw new Error('no draft note')
      return found
    })
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/menu')
    expect(screen.getByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
    expect(screen.getByText('Drop the menu here')).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('no menu yet shows the menu step with no note', async () => {
    readHouseMenuStanding.mockResolvedValue('none')
    render(page())
    await waitFor(() => expect(readHouseMenuStanding).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.getByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(DRAFT)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('a failed read leaves the menu step as it was, never sends the owner on', async () => {
    readHouseMenuStanding.mockResolvedValue('unread')
    render(page())
    await waitFor(() => expect(readHouseMenuStanding).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.getByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(DRAFT)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('a house opened on this visit is not read: it has no menu yet', async () => {
    auth.user = { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true }
    createFirstHouse.mockResolvedValue({ detailsLoaded: true })
    readHouseMenuStanding.mockResolvedValue('current')
    render(page())
    fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Meyhane' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 House Street' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Istanbul' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Türkiye' }))
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect(await screen.findByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
    await Promise.resolve()
    expect(readHouseMenuStanding).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('staff and managers are never read for the menu: they go to the desk', () => {
    for (const role of ['staff', 'manager']) {
      navigate.mockClear()
      auth.user = { ...owner, role }
      const view = render(page())
      expect(navigate).toHaveBeenCalledWith('/', { replace: true })
      view.unmount()
    }
    expect(readHouseMenuStanding).not.toHaveBeenCalled()
  })
})
