/**
 * DD-r108-10: folio 0 is the last invoice through the door (ADR 0144 §1). The
 * /house row is a real drop: one documentsApi.upload per paper, with the
 * session's house (the gateway reads it from the token, so the body names
 * none), nothing read back, and a skip that is recorded on the opening book.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  detail: vi.fn(),
  list: vi.fn(),
  skipFolio: vi.fn(),
  getOnboardingProgress: vi.fn(),
  role: 'owner' as string,
}))
vi.mock('../../services/api/documents', () => ({
  documentsApi: { upload: h.upload, detail: h.detail, list: h.list },
}))
vi.mock('../../services/api/arrival', () => ({ skipFolio: h.skipFolio }))
vi.mock('../../services/api/vendors', () => ({ addCustomProvider: vi.fn() }))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: h.getOnboardingProgress }))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency: vi.fn().mockResolvedValue(null) } }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: h.role } }) }))

import HouseContents from '../HouseContents'

const invoice = () => new File(['INVOICE 42'], 'last-invoice.pdf', { type: 'application/pdf' })
const page = () => render(<MemoryRouter><HouseContents /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  h.getOnboardingProgress.mockResolvedValue({ vendor_added: true, next_steps: { money_set: true } })
  h.upload.mockResolvedValue({ documentId: 'doc-1' })
  h.skipFolio.mockResolvedValue(undefined)
  h.role = 'owner'
})

describe('folio 0 on /house', () => {
  it('sends the chosen paper with one upload, for the session house, and reads back only that paper', async () => {
    page()
    fireEvent.change(screen.getByLabelText('Your last invoice'), { target: { files: [invoice()] } })
    expect(await screen.findByText(/Your last invoice is on Receipts\./)).toBeInTheDocument()
    expect(h.upload).toHaveBeenCalledTimes(1)
    const sent = h.upload.mock.calls[0][0]
    expect(sent).toEqual({
      contentBase64: btoa('INVOICE 42'),
      filename: 'last-invoice.pdf',
      mimeType: 'application/pdf',
      source: 'upload',
    })
    expect(sent).not.toHaveProperty('restaurantId')
    // r109 g2: the paper's own status is read back to propose its seller; no list.
    await waitFor(() => expect(h.detail).toHaveBeenCalledWith('doc-1'))
    expect(h.list).not.toHaveBeenCalled()
    expect(h.getOnboardingProgress).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'See it on Receipts' })).toHaveAttribute('href', '/receipts')
    expect(screen.getByText(/not read into the house's registers yet/)).toBeInTheDocument()
    expect(h.skipFolio).not.toHaveBeenCalled()
  })

  it('a second drop while the first is on its way sends nothing more', async () => {
    let land: (v: unknown) => void = () => {}
    h.upload.mockReturnValue(new Promise((resolve) => { land = resolve }))
    page()
    const zone = screen.getByTestId('house-paper-drop')
    // Both land in one frame, before the zone gives way to "Sending…".
    act(() => {
      fireEvent.drop(zone, { dataTransfer: { files: [invoice()] } })
      fireEvent.drop(zone, { dataTransfer: { files: [invoice()] } })
    })
    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1))
    await act(async () => { land({ documentId: 'doc-1' }) })
    expect(await screen.findByText(/Your last invoice is on Receipts\./)).toBeInTheDocument()
    expect(h.upload).toHaveBeenCalledTimes(1)
  })

  it('records the skip on the opening book and sends no paper', async () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(await screen.findByTestId('house-paper-skipped')).toBeInTheDocument()
    expect(h.skipFolio).toHaveBeenCalledTimes(1)
    expect(h.skipFolio).toHaveBeenCalledWith('evidence')
    expect(h.upload).not.toHaveBeenCalled()
    // #1649's link to Receipts stays as the secondary way.
    expect(screen.getByRole('link', { name: 'Receipts' })).toHaveAttribute('href', '/receipts')
  })

  it.each(['staff', 'waiter'])('a %s session is not offered the skip, which only an owner or a manager can record', (role) => {
    h.role = role
    page()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    // the drop stays: POST /procurement/documents is open to everyone
    expect(screen.getByLabelText('Your last invoice')).toBeInTheDocument()
    expect(h.skipFolio).not.toHaveBeenCalled()
  })

  it('says so when the skip could not be noted', async () => {
    h.skipFolio.mockRejectedValue(new Error('down'))
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not note the skip')
  })

  it('a refused upload says so and keeps the drop for another try', async () => {
    h.upload.mockRejectedValueOnce(Object.assign(new Error('422'), { response: { status: 422 } }))
    page()
    fireEvent.change(screen.getByLabelText('Your last invoice'), { target: { files: [invoice()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('could not send it just now')
    fireEvent.change(screen.getByLabelText('Your last invoice'), { target: { files: [invoice()] } })
    expect(await screen.findByText(/Your last invoice is on Receipts\./)).toBeInTheDocument()
    expect(h.upload).toHaveBeenCalledTimes(2)
  })

  it('a file over 10 MB is not sent', async () => {
    page()
    const big = invoice()
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 })
    fireEvent.change(screen.getByLabelText('Your last invoice'), { target: { files: [big] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('over 10 MB')
    expect(h.upload).not.toHaveBeenCalled()
  })
})
