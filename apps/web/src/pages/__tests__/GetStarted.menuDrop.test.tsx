/**
 * The arrival's menu drop zone (sim ledger F-010, F-012).
 *
 * F-010: a drop took only files[0] and lost the rest in silence, and a PDF
 * bounced to another panel to be picked again. F-012: "click to photograph"
 * opened a second panel with its own button, two targets for one job.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const importMenu = vi.fn()

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'Selin Kaya', emailVerified: true },
    createFirstHouse: vi.fn().mockResolvedValue({ detailsLoaded: true }),
  }),
}))
vi.mock('../../services/api/client', () => ({
  apiClient: { patch: vi.fn().mockResolvedValue({}) },
}))
vi.mock('../../services/api/menus', () => ({
  importMenu: (...args: unknown[]) => importMenu(...args),
}))
vi.mock('../../lib/firstProof', () => ({ writeProof: vi.fn() }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => true }))
vi.mock('../../components/brand/BrandMark', () => ({
  BrandMark: () => <span>Mudavym</span>,
}))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({
  PlacesAutocomplete: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Find your restaurant" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('../../components/ui/CountryCombobox', () => ({
  CountryCombobox: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Country" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({
  MenuScanUpload: () => <div data-testid="camera-panel" />,
}))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({
  MenuCsvUpload: () => <div data-testid="file-panel" />,
}))

import GetStarted from '../GetStarted'

async function toMenuStep() {
  render(
    <MemoryRouter>
      <GetStarted />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Your restaurant' })
  fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Tuzlu Rüzgar' } })
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 Kordon' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'İzmir' } })
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Turkey' } })
  fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
  await screen.findByRole('heading', { name: 'Your menu' })
}

const dropZone = () => screen.getByText('Drop the menu here').closest('button')!
const drop = (files: File[]) => fireEvent.drop(dropZone(), { dataTransfer: { files } })
const png = (name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' })

describe('GetStarted — the menu drop zone', () => {
  beforeEach(() => {
    importMenu.mockReset()
    importMenu.mockResolvedValue({ menuId: 'm1', items: [] })
  })

  it('two pages dropped are not read one and lost after it: nothing is read, and the owner is told the way through', async () => {
    await toMenuStep()
    drop([png('page-1.png'), png('page-2.png')])
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /That was 2 files, and none of them was read.*one PDF, where every page is read/,
    )
    expect(importMenu).not.toHaveBeenCalled()
  })

  it('one photo is read, sent as its own bytes without a data-URL prefix', async () => {
    await toMenuStep()
    drop([png('page-1.png')])
    await waitFor(() => expect(importMenu).toHaveBeenCalledTimes(1))
    const [method, data] = importMenu.mock.calls[0]
    expect(method).toBe('scan')
    expect(data.imageBase64).toBe('iVBORw==')
  })

  it('a dropped PDF is read here, not bounced to another panel', async () => {
    await toMenuStep()
    drop([new File(['%PDF-1.7'], 'menu.pdf', { type: 'application/pdf' })])
    await waitFor(() => expect(importMenu).toHaveBeenCalledTimes(1))
    expect(importMenu.mock.calls[0][1].imageBase64).toBe(btoa('%PDF-1.7'))
    expect(screen.queryByTestId('file-panel')).toBeNull()
  })

  it('a dropped spreadsheet opens Send a file and says why', async () => {
    await toMenuStep()
    drop([new File(['name,glass\n'], 'drinks.csv', { type: 'text/csv' })])
    expect(await screen.findByTestId('file-panel')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/"drinks.csv" is a spreadsheet\. Choose it under Send a file/)
    expect(importMenu).not.toHaveBeenCalled()
  })

  it('clicking the drop zone opens the file picker, not a second panel with its own button', async () => {
    await toMenuStep()
    const picker = screen.getByLabelText('Choose the menu') as HTMLInputElement
    const click = vi.spyOn(picker, 'click')
    fireEvent.click(dropZone())
    expect(click).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('camera-panel')).toBeNull()
    expect(screen.getByRole('button', { name: /Use the camera/ })).toBeInTheDocument()
  })
})
