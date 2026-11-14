/**
 * r33 walk w1 F7: on the menu step, a refusal left by one way in stayed on
 * screen beside the next way's own. A dropped .docx opened the file box with
 * "not a spreadsheet…", and a photo dropped next showed its reader error
 * under it; a refused photo's error stayed above the typed lines or the file
 * box chosen after it. One way speaks at a time.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate, importMenu, auth } = vi.hoisted(() => ({
  navigate: vi.fn(),
  importMenu: vi.fn(),
  auth: { user: null as Record<string, unknown> | null, loading: false },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...auth, createFirstHouse: vi.fn(), signInWithSession: vi.fn(), logout: vi.fn() }),
}))
vi.mock('../../services/api/menus', () => ({ importMenu }))
vi.mock('../../services/api/settings', () => ({
  settingsApi: { houseCurrency: vi.fn().mockResolvedValue({ readable: false, code: null }) },
}))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => false }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ PlacesAutocomplete: () => null }))
// The file box says its own refusal for a kind it does not take, as the real one does.
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({
  MenuCsvUpload: ({ droppedFiles }: { droppedFiles?: File[] | null }) => (
    <div data-testid="file-box">
      {(droppedFiles ?? []).map((f) => (f.name.endsWith('.docx') ? `"${f.name}" is not a spreadsheet, CSV, PDF, or image.` : f.name)).join(' + ') || 'empty'}
    </div>
  ),
}))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => <div data-testid="photo-box" /> }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => <div data-testid="typed-box" /> }))

import GetStarted from '../GetStarted'

const owner = { name: 'Selin Kaya', restaurantId: 'house-1', role: 'owner', emailVerified: true }
const page = () => <MemoryRouter><GetStarted /></MemoryRouter>
const drop = async (files: File[]) =>
  fireEvent.drop(await screen.findByText('Drop the menu here'), { dataTransfer: { files } })
const docx = () => new File(['x'], 'menu.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
const photo = () => new File(['a'], 'menu.jpg', { type: 'image/jpeg' })
const REFUSED = 'We could not find a menu in that photo. Try a clearer photo, or send a file.'

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = owner
  importMenu.mockRejectedValue(Object.assign(new Error('Request failed'), { response: { status: 400, data: {} } }))
  sessionStorage.clear()
})

/** A dropped photo the reader refuses: its sentence is on screen. */
async function refusedPhoto() {
  await drop([photo()])
  expect(await screen.findByRole('alert')).toHaveTextContent(REFUSED)
}

describe('GetStarted: one way in speaks at a time', () => {
  it('a photo dropped after a refused file closes the file box and its refusal', async () => {
    render(page())
    await drop([docx()])
    expect(await screen.findByTestId('file-box')).toHaveTextContent('"menu.docx" is not a spreadsheet')
    await refusedPhoto()
    expect(screen.queryByTestId('file-box')).toBeNull()
    expect(screen.queryByText(/is not a spreadsheet/)).toBeNull()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('a photo dropped while lines are being typed leaves the typed lines open', async () => {
    render(page())
    fireEvent.click(await screen.findByRole('button', { name: /Type a few lines/ }))
    expect(screen.getByTestId('typed-box')).toBeInTheDocument()
    await refusedPhoto()
    expect(screen.getByTestId('typed-box')).toBeInTheDocument()
  })

  it('choosing typed lines after a refused photo clears the photo’s sentence', async () => {
    render(page())
    await refusedPhoto()
    fireEvent.click(screen.getByRole('button', { name: /Type a few lines/ }))
    expect(screen.getByTestId('typed-box')).toBeInTheDocument()
    expect(screen.queryByText(REFUSED)).toBeNull()
  })

  it('choosing "Send a file" after a refused photo clears it and opens an empty box', async () => {
    render(page())
    await refusedPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Send a file' }))
    expect(screen.getByTestId('file-box')).toHaveTextContent('empty')
    expect(screen.queryByText(REFUSED)).toBeNull()
  })

  it('clicking to photograph after a refused photo clears it and opens the photo box', async () => {
    render(page())
    await refusedPhoto()
    fireEvent.click(screen.getByRole('button', { name: /Drop the menu here/ }))
    expect(screen.getByTestId('photo-box')).toBeInTheDocument()
    expect(screen.queryByText(REFUSED)).toBeNull()
  })

  it('a photo the reader takes still opens the proof', async () => {
    importMenu.mockResolvedValue({ menuId: 'm-1', items: [] })
    render(page())
    await drop([docx()])
    await drop([photo()])
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/house/menu', { replace: true }))
  })
})
