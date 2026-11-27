/** r109 onboarding g3: /house brings the till's last 90 days, and says stock was not moved. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ importTillHistory: vi.fn(), role: 'owner' as string }))
vi.mock('../../services/api/posHub', () => ({ importTillHistory: h.importTillHistory }))
vi.mock('../../services/api/documents', () => ({ documentsApi: { upload: vi.fn() } }))
vi.mock('../../services/api/arrival', () => ({ skipFolio: vi.fn() }))
vi.mock('../../services/api/vendors', () => ({ addCustomProvider: vi.fn() }))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn().mockResolvedValue({ vendor_added: true }) }))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency: vi.fn().mockResolvedValue(null) } }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: h.role, restaurantId: 'h1' } }) }))

import HouseContents from '../HouseContents'

const CSV = 'Date,Item,Qty,Net Sales\n2026-11-20,Meze,3,30\n'
const exportFile = (body = CSV) => new File([body], 'item-sales.csv', { type: 'text/csv' })
const page = () => render(<MemoryRouter><HouseContents /></MemoryRouter>)
const drop = (file: File) => fireEvent.change(screen.getByLabelText("Your till's item sales export"), { target: { files: [file] } })
const answer = (over: Record<string, unknown> = {}) => ({
  daysRead: 2,
  salesSaved: 4,
  rowsRead: 6,
  refused: [],
  refusedCount: 0,
  netDropped: false,
  stockMoved: false,
  fileRefused: null,
  errors: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  h.role = 'owner'
  h.importTillHistory.mockResolvedValue(answer())
})

describe("/house: the till's last 90 days", () => {
  it('sends the export as text for the session house and says the days, and that stock was not moved', async () => {
    page()
    drop(exportFile())
    expect(await screen.findByText('2 days read; stock was not moved.')).toBeInTheDocument()
    expect(h.importTillHistory).toHaveBeenCalledWith('h1', CSV)
    expect(screen.getByText(/Stock is not moved|stock was not moved/)).toBeInTheDocument()
  })

  it('names the refused rows, five at most, and counts the rest', async () => {
    const refused = Array.from({ length: 7 }, (_, i) => `2026-11-2${i} Meze: not read, the quantity is 0 or less (a refund or a void)`)
    h.importTillHistory.mockResolvedValue(answer({ refused, refusedCount: 9 }))
    page()
    drop(exportFile())
    const list = await screen.findByTestId('house-till-refused')
    expect(list).toHaveTextContent('9 rows were not read:')
    expect(list.querySelectorAll('li')).toHaveLength(5)
    expect(list).toHaveTextContent('and 4 more.')
  })

  it('says the money was left out when the house has none', async () => {
    h.importTillHistory.mockResolvedValue(answer({ netDropped: true, daysRead: 1 }))
    page()
    drop(exportFile())
    expect(await screen.findByText('1 day read; stock was not moved.')).toBeInTheDocument()
    expect(screen.getByText(/The money was left out/)).toBeInTheDocument()
  })

  it("a file the gateway refuses whole says the gateway's words and keeps the drop", async () => {
    h.importTillHistory.mockResolvedValue(answer({ fileRefused: 'The file is over 5 MB.' }))
    page()
    drop(exportFile())
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is over 5 MB.')
    expect(screen.getByLabelText("Your till's item sales export")).toBeInTheDocument()
  })

  it('over 5 MB is refused before anything is sent', async () => {
    page()
    const big = exportFile()
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 })
    drop(big)
    expect(await screen.findByRole('alert')).toHaveTextContent('over 5 MB')
    expect(h.importTillHistory).not.toHaveBeenCalled()
  })

  it('a 403 says who may do it', async () => {
    h.importTillHistory.mockRejectedValue(Object.assign(new Error('no'), { response: { status: 403 } }))
    page()
    drop(exportFile())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Only an owner or a manager can bring the till's sales in."))
  })

  it('staff are not offered the row', () => {
    h.role = 'staff'
    page()
    expect(screen.queryByTestId('house-till-history')).not.toBeInTheDocument()
  })

  it('the drop control is at least 44 px', () => {
    page()
    expect(screen.getByLabelText("Your till's item sales export").closest('label')).toHaveClass('min-h-11')
  })
})
