import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Arrival, { folioState } from './Arrival'
import { Book, arrivalApi } from './arrival-api'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      userId: 'person',
      name: 'A keeper',
      role: 'owner',
      restaurantId: 'house',
    },
  }),
}))
vi.mock('../../services/api/client', () => ({
  getActiveRestaurantId: () => 'house',
  apiClient: {},
}))
vi.mock('../../services/api/receiving', () => ({
  receivingApi: { uploadDocument: vi.fn() },
}))
vi.mock('../../services/api/documents', () => ({
  documentsApi: { list: vi.fn().mockResolvedValue([]) },
}))
vi.mock('./arrival-api', async () => {
  const actual =
    await vi.importActual<typeof import('./arrival-api')>('./arrival-api')
  return {
    ...actual,
    arrivalApi: {
      read: vi.fn(),
      skip: vi.fn(),
      typed: vi.fn(),
      propose: vi.fn(),
      apply: vi.fn(),
      discard: vi.fn(),
      undo: vi.fn(),
      menuEvidence: vi.fn(),
    },
  }
})
const source = <T,>(data: T) => ({ readable: true, data, reason: null })
function fixture(): Book {
  return {
    restaurantId: 'house',
    canManage: true,
    house: source({
      name: 'The fixture house',
      default_threshold_min: 3,
      threshold_configured: false,
    }),
    currency: source({
      code: 'TRY',
      readable: true,
      country: 'TR',
      reason: null,
      statedAt: null,
    }),
    cellar: source({
      registers: [
        {
          id: 'wines',
          carried: null,
          decidedBy: 'unknown',
          basis: 'No house evidence yet',
          evidence: { inventoryRows: 0, menuRows: 0 },
        },
      ],
      sources: {
        answers: { readable: true },
        inventory: { readable: true },
        menu: { readable: true },
      },
    }),
    vendors: source({
      terms: {
        vendors: [],
        sources: {
          providers: { readable: true },
          statedTerms: { readable: true },
        },
      },
      currencies: [],
    }),
    preferences: source({
      email: true,
      push: true,
      sms: false,
      categories: { inventory: true },
      quietHours: { enabled: false, startTime: '22:00', endTime: '08:00' },
      updatedAt: null,
    }),
    folios: source([]),
    batches: source([]),
    openingMenu: source({ menuId: null, items: [] }),
  }
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Arrival />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
async function open() {
  await screen.findByRole('button', { name: 'Open the book' })
  fireEvent.click(screen.getByRole('button', { name: 'Open the book' }))
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(arrivalApi.read).mockResolvedValue(fixture())
  vi.mocked(arrivalApi.skip).mockResolvedValue({ recorded: true })
  vi.mocked(arrivalApi.typed).mockResolvedValue({
    written: true,
    recorded: true,
    reason: null,
  })
})
describe('Arrival folios', () => {
  it('opens five independently addressable folios and the skippable evidence folio', async () => {
    mount()
    await open()
    expect(
      screen
        .getByRole('complementary', { name: 'Contents' })
        .querySelectorAll('li'),
    ).toHaveLength(6)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
  it('shows currency already posted and does not ask it twice', async () => {
    mount()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /01\s*Currency/ }))
    expect(
      await screen.findByText('TRY', { selector: 'h2' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Reporting currency'),
    ).not.toBeInTheDocument()
  })
  it('records a skip as an independent request without claiming a setting write', async () => {
    mount()
    await open()
    fireEvent.click(
      screen.getByRole('button', { name: 'Carry this folio forward' }),
    )
    await waitFor(() =>
      expect(arrivalApi.skip).toHaveBeenCalledWith('evidence'),
    )
    expect(arrivalApi.typed).not.toHaveBeenCalled()
    expect(
      await screen.findByText(
        'Carried forward. The skip is recorded; no setting changed.',
      ),
    ).toBeInTheDocument()
  })
  it('retains a failed skip as a refusal', async () => {
    vi.mocked(arrivalApi.skip).mockRejectedValue(
      new Error('Receipt unavailable'),
    )
    mount()
    await open()
    fireEvent.click(
      screen.getByRole('button', { name: 'Carry this folio forward' }),
    )
    expect(await screen.findByText('Receipt unavailable')).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Carried forward. The skip is recorded; no setting changed.',
      ),
    ).not.toBeInTheDocument()
  })
  it('persists a typed false answer without the batch seal', async () => {
    mount()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /02\s*What we pour/ }))
    fireEvent.change(screen.getByLabelText('wines'), {
      target: { value: 'false' },
    })
    await waitFor(() =>
      expect(arrivalApi.typed).toHaveBeenCalledWith({
        target: 'cellar',
        field: 'wines',
        value: false,
      }),
    )
    expect(arrivalApi.apply).not.toHaveBeenCalled()
  })
  it('does not turn failed history into unasked folios', () => {
    const book = fixture()
    book.folios = { readable: false, data: null, reason: 'db down' }
    expect(folioState(book, 'currency')).toEqual({
      state: 'unreadable',
      detail: 'The folio history could not be read.',
    })
  })
  it('keeps a missing vendor a reversible blocked folio', async () => {
    mount()
    await open()
    fireEvent.click(
      screen.getByRole('button', { name: /03\s*Whom we buy from/ }),
    )
    expect(
      screen.getByRole('link', { name: 'Open the vendor book' }),
    ).toHaveAttribute('href', '/providers')
    expect(
      screen.getByRole('button', { name: 'Carry this folio forward' }),
    ).toBeEnabled()
  })
  it('stages menu evidence without calling a writing import', async () => {
    vi.mocked(arrivalApi.menuEvidence).mockResolvedValue({
      id: 'batch',
      revision: 0,
      status: 'draft',
      rows: [
        {
          id: 'row',
          target: 'menu_item',
          field: 'item',
          value: { name: 'House red' },
          before: null,
          provenance: 'menu',
          status: 'pending',
          reason: null,
        },
      ],
      sealed_at: null,
      undo_until: null,
    })
    mount()
    await open()
    const file = new File(['name\nHouse red'], 'menu.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', {
      value: async () => 'name\nHouse red',
    })
    fireEvent.change(
      screen.getByLabelText('Menu evidence · image, PDF, CSV or spreadsheet'),
      { target: { files: [file] } },
    )
    await waitFor(() =>
      expect(arrivalApi.menuEvidence).toHaveBeenCalledWith(
        'csv',
        'name\nHouse red',
        false,
      ),
    )
    expect(arrivalApi.typed).not.toHaveBeenCalled()
    expect(arrivalApi.apply).not.toHaveBeenCalled()
    expect(
      await screen.findByText(/No menu, library or inventory row was created/),
    ).toBeInTheDocument()
  })
})
