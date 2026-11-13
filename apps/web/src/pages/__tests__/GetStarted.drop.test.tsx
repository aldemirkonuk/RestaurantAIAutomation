/**
 * r28 onboarding gap 11: "Drop the menu here" read one dropped photo and threw
 * anything else away (a PDF, a spreadsheet, a second photo) with no word. One
 * photo is still read at once; anything else is handed to the file box.
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
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({
  MenuCsvUpload: ({ droppedFiles }: { droppedFiles?: File[] | null }) => (
    <div data-testid="file-box">{(droppedFiles ?? []).map((f) => f.name).join(' + ') || 'empty'}</div>
  ),
}))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import GetStarted from '../GetStarted'

const owner = { name: 'Selin Kaya', restaurantId: 'house-1', role: 'owner', emailVerified: true }
const page = () => <MemoryRouter><GetStarted /></MemoryRouter>
const drop = async (files: File[]) =>
  fireEvent.drop(await screen.findByText('Drop the menu here'), { dataTransfer: { files } })

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = owner
  importMenu.mockResolvedValue({ menuId: 'm-1', items: [] })
  sessionStorage.clear()
})

describe('GetStarted keeps what is dropped', () => {
  it('a dropped PDF is handed to the file box, named, and not read as a photo', async () => {
    render(page())
    await drop([new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })])
    expect(await screen.findByTestId('file-box')).toHaveTextContent('menu.pdf')
    expect(importMenu).not.toHaveBeenCalled()
  })

  it('the drop zone says it takes a PDF or a spreadsheet', async () => {
    render(page())
    expect(await screen.findByText('A photo, a PDF or a spreadsheet. Or click to photograph.')).toBeInTheDocument()
  })

  it('a dropped spreadsheet is handed to the file box', async () => {
    render(page())
    await drop([new File(['x'], 'wines.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })])
    expect(await screen.findByTestId('file-box')).toHaveTextContent('wines.xlsx')
  })

  it('two dropped photos go to the file box together, not one read and one lost', async () => {
    render(page())
    await drop([
      new File(['a'], 'page-1.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'page-2.jpg', { type: 'image/jpeg' }),
    ])
    expect(await screen.findByTestId('file-box')).toHaveTextContent('page-1.jpg + page-2.jpg')
    expect(importMenu).not.toHaveBeenCalled()
  })

  it('one dropped photo is still read at once', async () => {
    render(page())
    await drop([new File(['a'], 'menu.jpg', { type: 'image/jpeg' })])
    await waitFor(() => expect(importMenu).toHaveBeenCalledWith('scan', expect.objectContaining({ imageBase64: expect.any(String) })))
    expect(screen.queryByTestId('file-box')).toBeNull()
  })

  it('one dropped photo goes to the reader as bare base64, and the proof keeps it as a data URL', async () => {
    // r28 gap 12 / onboarding audit G5: the data URL went whole, prefix and
    // all, and the gateway hands that string to the model as base64.
    render(page())
    await drop([new File(['a'], 'menu.jpg', { type: 'image/jpeg' })])
    await waitFor(() => expect(importMenu).toHaveBeenCalledWith('scan', { imageBase64: 'YQ==' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/house/menu', { replace: true }))
    expect(sessionStorage.getItem('mudavym:first-proof-source')).toBe('data:image/jpeg;base64,YQ==')
  })

  it('choosing "Send a file" afresh starts with no dropped file', async () => {
    render(page())
    await drop([new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })])
    expect(await screen.findByTestId('file-box')).toHaveTextContent('menu.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Send a file' }))
    expect(screen.queryByTestId('file-box')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send a file' }))
    expect(screen.getByTestId('file-box')).toHaveTextContent('empty')
  })
})
