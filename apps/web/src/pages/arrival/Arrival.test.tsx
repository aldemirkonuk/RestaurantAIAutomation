import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Arrival from './Arrival'
import { folioState, nextAct, typedLinesToCsv } from './arrival-reading'
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
      mintApplySeal: vi.fn(),
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
          confidence: 'unknown',
          basis: 'No house evidence yet',
          evidence: { inventoryRows: 0, menuRows: 0 },
        },
      ],
      menuLines: { read: 0, placed: 0, notPlaced: 0 },
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
function draftBatch(target: 'menu_item' | 'cellar' = 'menu_item') {
  return {
    id: 'batch',
    revision: 0,
    status: 'draft' as const,
    rows: [
      {
        id: 'row',
        target,
        field: 'item',
        value: { name: 'House red' },
        before: null,
        provenance: 'menu' as const,
        status: 'pending' as const,
        reason: null,
      },
    ],
    sealed_at: null,
    undo_until: null,
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
/**
 * The flyleaf now holds the menu upload, so "open the book" is the ESCAPE from
 * it, not the act on it — a strong default, not a gate (founder, 2026-09-22).
 * Every folio test below still has to reach the contents, so it leaves by the
 * escape, which is exactly the path a house with a stuck upload takes.
 */
async function open() {
  const escape = await screen.findByRole('button', {
    name: 'Open the book without it',
  })
  fireEvent.click(escape)
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
    ).toHaveAttribute('href', '/vendors')
    // The vendor folio is the one the founder named as skippable, so its skip
    // is worded as an optional folio's ("Not yet — carry it forward") rather
    // than with every other folio's identical label.
    expect(
      screen.getByRole('button', { name: 'Not yet — carry it forward' }),
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
  it('mints the seal when the hold begins and carries it to apply (ADR 0113, codex-audit/C2-adopt.md #2)', async () => {
    const book = fixture()
    book.batches = source([
      {
        id: 'batch1',
        revision: 0,
        status: 'draft',
        rows: [
          {
            id: 'row1',
            target: 'cellar',
            field: 'wines',
            value: true,
            before: null,
            provenance: 'spoken',
            status: 'pending',
            reason: null,
          },
        ],
        sealed_at: null,
        undo_until: null,
      },
    ])
    vi.mocked(arrivalApi.read).mockResolvedValue(book)
    vi.mocked(arrivalApi.mintApplySeal).mockResolvedValue('the-challenge')
    mount()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /05\s*The assistant/ }))
    const hold = await screen.findByRole('button', {
      name: 'Hold to record this batch',
    })
    fireEvent.keyDown(hold, { key: 'Enter' }) // arm — mints the seal
    await waitFor(() =>
      expect(arrivalApi.mintApplySeal).toHaveBeenCalledWith('batch1'),
    )
    fireEvent.keyDown(hold, { key: 'Enter' }) // confirm
    await waitFor(() =>
      expect(arrivalApi.apply).toHaveBeenCalledWith(
        book.batches.data![0],
        'the-challenge',
      ),
    )
  })
  it('offers a resume, not just a message, for a batch a crash left unresolved (codex-audit/C2-adopt.md #3)', async () => {
    const book = fixture()
    book.batches = source([
      {
        id: 'batch1',
        revision: 2,
        status: 'applying',
        rows: [],
        sealed_at: 'then',
        undo_until: 'later',
      },
    ])
    vi.mocked(arrivalApi.read).mockResolvedValue(book)
    mount()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /05\s*The assistant/ }))
    const resume = await screen.findByRole('button', {
      name: 'Hold to resume this batch',
    })
    // No seal-challenge control on a resume: the hold that would have minted
    // one already spent it before the crash.
    expect(arrivalApi.mintApplySeal).not.toHaveBeenCalled()
    fireEvent.keyDown(resume, { key: 'Enter' })
    fireEvent.keyDown(resume, { key: 'Enter' })
    await waitFor(() =>
      expect(arrivalApi.apply).toHaveBeenCalledWith(book.batches.data![0]),
    )
  })
  it('offers "Undo this setup" for a batch that finished with issues, not only a clean applied one', async () => {
    const book = fixture()
    book.batches = source([
      {
        id: 'batch1',
        revision: 3,
        status: 'applied_with_issues',
        rows: [
          {
            id: 'row1',
            target: 'cellar',
            field: 'wines',
            value: true,
            before: null,
            provenance: 'spoken',
            status: 'written',
            reason: null,
          },
          {
            id: 'row2',
            target: 'cellar',
            field: 'beer',
            value: true,
            before: null,
            provenance: 'spoken',
            status: 'unconfirmed',
            reason:
              'The writer did not return a confirmed receipt. Read the setting before another attempt.',
          },
        ],
        sealed_at: 'then',
        undo_until: new Date(Date.now() + 86400000).toISOString(),
      },
    ])
    vi.mocked(arrivalApi.read).mockResolvedValue(book)
    mount()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /05\s*The assistant/ }))
    const undo = await screen.findByRole('button', { name: 'Undo this setup' })
    expect(undo).toBeEnabled()
    fireEvent.click(undo)
    await waitFor(() =>
      expect(arrivalApi.undo).toHaveBeenCalledWith(book.batches.data![0]),
    )
  })
  it('opens the reveal, not folio 00, once the flyleaf has read a menu', async () => {
    // #414 defaulted the book back to fo. 00 after every action, so the one
    // thing the upload produced was the one thing the house had to go looking
    // for. The legacy page already got this right (GetStarted.tsx:238-274).
    vi.mocked(arrivalApi.menuEvidence).mockResolvedValue(draftBatch())
    mount()
    await screen.findByLabelText('Send a file')
    const file = new File(['name\nHouse red'], 'menu.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', {
      value: async () => 'name\nHouse red',
    })
    fireEvent.change(screen.getByLabelText('Send a file'), {
      target: { files: [file] },
    })
    expect(
      await screen.findByRole('heading', { name: /What we pour/ }),
    ).toBeInTheDocument()
  })

  it('labels an undone_with_issues receipt with the undone note, not the days-remaining countdown', async () => {
    const book = fixture()
    book.batches = source([
      {
        id: 'batch1',
        revision: 5,
        status: 'undone_with_issues',
        rows: [],
        sealed_at: 'then',
        undo_until: 'later',
      },
    ])
    vi.mocked(arrivalApi.read).mockResolvedValue(book)
    mount()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /05\s*The assistant/ }))
    expect(
      // The note paragraph's trailing sentence ("For imported items…") is a
      // sibling text node in the same <p>, so Testing Library concatenates
      // it onto this one — match by substring, not full equality.
      await screen.findByText(
        /This undo attempt is recorded\. Any entries marked written were retained; read their reasons\./,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Batch undo closes/)).not.toBeInTheDocument()
  })
})

/**
 * The flyleaf holds one act. A flyleaf is where the owner writes their name;
 * this house inscribes itself by handing over its menu, so the upload is the
 * inscription and not a folio — nothing stands in front of it.
 */
describe('The flyleaf is the menu upload', () => {
  it('offers three ways in and nothing else before them', async () => {
    mount()
    expect(await screen.findByLabelText('Photograph the menu')).toBeEnabled()
    expect(screen.getByLabelText('Send a file')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open a page' })).toBeEnabled()
    // No currency, no vendor, no notification question, no checklist.
    expect(screen.queryByLabelText('Reporting currency')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Contents' })).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('is a strong default, not a gate: the escape works and records nothing', async () => {
    mount()
    await open()
    expect(
      screen.getByRole('complementary', { name: 'Contents' }),
    ).toBeInTheDocument()
    // Leaving the flyleaf is not a skip. Nothing was written to say it was.
    expect(arrivalApi.skip).not.toHaveBeenCalled()
    expect(arrivalApi.typed).not.toHaveBeenCalled()
  })

  it('never draws the flyleaf over a book that already holds menu lines', async () => {
    const book = fixture()
    book.openingMenu = source({ menuId: 'm', items: [{ id: 'i', name: 'Barolo' }] })
    vi.mocked(arrivalApi.read).mockResolvedValue(book)
    mount()
    expect(
      await screen.findByRole('complementary', { name: 'Contents' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Photograph the menu'),
    ).not.toBeInTheDocument()
  })

  it('draws the wait as facts landing, with no spinner and no invented count', async () => {
    let release: (batch: ReturnType<typeof draftBatch>) => void = () => {}
    vi.mocked(arrivalApi.menuEvidence).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    mount()
    const file = new File(['name\nHouse red'], 'menu.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: async () => 'name\nHouse red' })
    fireEvent.change(await screen.findByLabelText('Send a file'), {
      target: { files: [file] },
    })
    expect(await screen.findByText('menu.csv taken in')).toBeInTheDocument()
    expect(
      screen.getByText('Reading the lines that name a drink'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    // Nothing claims a number it cannot know yet.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    release(draftBatch())
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /What we pour/ })).toBeInTheDocument(),
    )
  })

  it('sends typed lines through the same reader, quoting a comma in a drink name', () => {
    // "Gin, Lime & Soda" is one line. An unquoted comma would make it three.
    expect(typedLinesToCsv('Gin, Lime & Soda\n\nHouse red  ')).toBe(
      'name\n"Gin, Lime & Soda"\n"House red"',
    )
  })
})

/**
 * The reveal is a reading count, not a capability claim — and it has no
 * checkboxes, so nothing in it can be rubber-stamped.
 */
describe('The reveal', () => {
  function withReading(
    menuLines: { read: number; placed: number; notPlaced: number } | null,
    registers = fixture().cellar.data!.registers,
  ) {
    const book = fixture()
    book.openingMenu = source({ menuId: 'm', items: [{ id: 'i', name: 'Barolo' }] })
    book.cellar = source({ ...book.cellar.data!, menuLines, registers })
    vi.mocked(arrivalApi.read).mockResolvedValue(book)
    return book
  }
  async function openPour() {
    await screen.findByRole('complementary', { name: 'Contents' })
    fireEvent.click(screen.getByRole('button', { name: /02\s*What we pour/ }))
  }

  it('prints lines read, placed and not placed', async () => {
    withReading({ read: 42, placed: 25, notPlaced: 17 })
    mount()
    await openPour()
    const count = await screen.findByRole('group', { name: 'The reading count' })
    expect(count).toHaveTextContent(/Lines read\s*42/)
    expect(count).toHaveTextContent(/Placed on a register\s*25/)
    expect(count).toHaveTextContent(/Not placed\s*17/)
  })

  it('reports a thin harvest as a real number rather than an empty page', async () => {
    withReading({ read: 9, placed: 2, notPlaced: 7 })
    mount()
    await openPour()
    const count = await screen.findByRole('group', { name: 'The reading count' })
    expect(count).toHaveTextContent(/Lines read\s*9/)
    expect(count).toHaveTextContent(/Not placed\s*7/)
    // Nine is a small number and the page says nine. No praise, no ring.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says a failed read failed instead of substituting three zeroes', async () => {
    withReading(null)
    mount()
    await openPour()
    expect(
      await screen.findByText(/failure to read, not an empty menu/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('group', { name: 'The reading count' }),
    ).not.toBeInTheDocument()
  })

  it('reads an evidenced register back as a stated fact with no control on it', async () => {
    withReading({ read: 42, placed: 25, notPlaced: 17 }, [
      {
        id: 'wines',
        carried: true,
        decidedBy: 'inferred',
        confidence: 'likely',
        basis:
          '18 menu lines name wines, though nothing of the kind is counted in the cellar.',
        evidence: { inventoryRows: 0, menuRows: 18 },
      },
    ])
    mount()
    await openPour()
    // The service's own sentence, verbatim — not a template with a hole in it.
    expect(
      await screen.findByText(
        '18 menu lines name wines, though nothing of the kind is counted in the cellar.',
      ),
    ).toBeInTheDocument()
    // Nothing is ticked, so nothing can be tick-approved.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'We pour this →' }),
    ).not.toBeInTheDocument()
  })

  it('gives an un-evidenced register the honest sentence and the one act', async () => {
    withReading({ read: 9, placed: 2, notPlaced: 7 }, [
      {
        id: 'whiskey',
        carried: false,
        decidedBy: 'inferred',
        confidence: 'none',
        basis: 'Nothing in this cellar and nothing on this menu names whiskey.',
        evidence: { inventoryRows: 0, menuRows: 0 },
      },
    ])
    mount()
    await openPour()
    expect(
      await screen.findByText(
        'Nothing in this cellar and nothing on this menu names whiskey.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'We pour this →' }))
    await waitFor(() =>
      expect(arrivalApi.typed).toHaveBeenCalledWith({
        target: 'cellar',
        field: 'whiskey',
        value: true,
      }),
    )
    // Stated by hand, posted at once — it does not wait on a batch seal.
    expect(arrivalApi.propose).not.toHaveBeenCalled()
    expect(arrivalApi.apply).not.toHaveBeenCalled()
  })

  it('keeps unsealed pencil entries out of the reading count and says so', async () => {
    const book = withReading({ read: 0, placed: 0, notPlaced: 0 })
    book.batches = source([draftBatch()])
    vi.mocked(arrivalApi.read).mockResolvedValue(book)
    mount()
    await openPour()
    expect(
      await screen.findByText(/still in pencil from the last read/),
    ).toBeInTheDocument()
  })
})

/**
 * The contents page IS the guidance. Exactly one line asks; the rest state.
 */
describe('nextAct — one line asks, never two', () => {
  it('asks for the menu first when nothing has been written', () => {
    expect(nextAct(fixture())).toEqual({
      folio: 'evidence',
      want: 'Nothing is written yet. Give the book a menu and it opens already written.',
    })
  })

  it('asks for the seal once a read left entries in pencil', () => {
    const book = fixture()
    book.batches = source([draftBatch()])
    expect(nextAct(book)?.folio).toBe('assistant')
    expect(nextAct(book)?.want).toMatch(/waits on one seal/)
  })

  it('asks about the lines it could not place before it asks about currency', () => {
    const book = fixture()
    book.openingMenu = source({ menuId: 'm', items: [{ id: 'i', name: 'Barolo' }] })
    book.cellar = source({
      ...book.cellar.data!,
      menuLines: { read: 42, placed: 25, notPlaced: 17 },
    })
    book.currency = source({
      code: null,
      readable: true,
      country: null,
      reason: null,
      statedAt: null,
    })
    expect(nextAct(book)).toEqual({
      folio: 'pour',
      want: '17 of the 42 lines read could not be placed on a register. That is the only thing the book cannot answer for itself.',
    })
  })

  it('never re-asks a folio that was carried forward', () => {
    const book = fixture()
    book.folios = source([
      {
        folio: 'evidence' as const,
        state: 'skipped' as const,
        actor_id: 'person',
        updated_at: '2026-09-22T10:00:00Z',
      },
    ])
    expect(nextAct(book)?.folio).not.toBe('evidence')
  })

  it('asks nothing at all rather than inventing a suggestion', () => {
    const book = fixture()
    book.openingMenu = source({ menuId: 'm', items: [{ id: 'i', name: 'Barolo' }] })
    book.cellar = source({
      ...book.cellar.data!,
      menuLines: { read: 42, placed: 42, notPlaced: 0 },
    })
    expect(nextAct(book)).toBeNull()
  })

  it('marks exactly one contents line as asking, and no more', async () => {
    mount()
    await open()
    const aside = screen.getByRole('complementary', { name: 'Contents' })
    expect(aside.querySelectorAll('button[data-asking]')).toHaveLength(1)
  })
})

describe('The optional folio looks optional', () => {
  it('marks whom-we-buy-from optional and names the skip as a recorded act', async () => {
    mount()
    await open()
    fireEvent.click(
      screen.getByRole('button', { name: /03\s*Whom we buy from/ }),
    )
    expect(
      screen.getByRole('heading', { name: /Whom we buy from\s*Optional/ }),
    ).toBeInTheDocument()
    const skip = screen.getByRole('button', {
      name: 'Not yet — carry it forward',
    })
    expect(skip).toBeEnabled()
    expect(
      screen.getByText(
        /A recorded act, not an abandonment. The line stays on the contents with its date./,
      ),
    ).toBeInTheDocument()
  })
})
