/**
 * F-682 (sim wave 23): several files sent at once from /get-started kept only
 * the last file's result, and the "k of n failed" message was set just before
 * the step moved on, so the owner never saw it. Every file's result now goes on
 * to the proof, failures included; when none was read, the step stays and
 * says why. The first proof then says what each file gave and what a read
 * kept back: columns not read, rows skipped, cells unread (F-017, F-684).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MenuCsvUpload } from './MenuCsvUpload'
import HouseMenu from '../../pages/HouseMenu'
import { importMenu } from '../../services/api/menus'
import { FIRST_PROOF_KEY } from '../../lib/firstProof'
import { setHouseLocale } from '../../lib/houseCurrency'

vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, importMenu: vi.fn() }
})

// HouseMenu reads the proof kept for the house in view (F-273); none here.
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: null }) }))

const mockImport = vi.mocked(importMenu)
const line = (id: string, name: string) =>
  ({ menuItemId: id, name, category: 'red', matched: true, needsReview: false }) as any

function pick(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

beforeEach(() => mockImport.mockReset())

describe('MenuCsvUpload: several files at once (F-682)', () => {
  it("hands every file's lines and every failure to the proof", async () => {
    mockImport
      .mockResolvedValueOnce({ menuId: 'm1', itemsExtracted: 2, submissionsCreated: 0, items: [line('a', 'Yakut'), line('b', 'Syrah')] })
      .mockRejectedValueOnce({ response: { data: { message: 'Nothing was read from this file, so nothing was kept.' } } })
      .mockResolvedValueOnce({ menuId: 'm3', itemsExtracted: 1, submissionsCreated: 0, items: [line('c', 'Raki')] })
    const onSuccess = vi.fn()
    const { container } = render(<MenuCsvUpload onSuccess={onSuccess} />)
    pick(container, [
      new File(['name,bottle\nYakut,850\nSyrah,90\n'], 'reds.csv', { type: 'text/csv' }),
      new File(['Etiket;Bağ\n'], 'cover.csv', { type: 'text/csv' }),
      new File(['name,bottle\nRaki,40\n'], 'spirits.csv', { type: 'text/csv' }),
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Import 3 files' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    const [result] = onSuccess.mock.calls[0]
    expect(result.menuId).toBe('m1')
    expect(result.itemsExtracted).toBe(3)
    expect(result.items.map((i: any) => i.name)).toEqual(['Yakut', 'Syrah', 'Raki'])
    expect(result.files).toEqual([
      { name: 'reds.csv', itemsExtracted: 2, read: null },
      { name: 'cover.csv', failure: 'Nothing was read from this file, so nothing was kept.' },
      { name: 'spirits.csv', itemsExtracted: 1, read: null },
    ])
  })

  it('when no file was read, stays on the step and says why for each file', async () => {
    mockImport
      .mockRejectedValueOnce({ response: { data: { message: 'We could not find a column for the drink\'s name.' } } })
      .mockRejectedValueOnce({ response: { data: { message: 'We could not open this spreadsheet.' } } })
    const onSuccess = vi.fn()
    const { container } = render(<MenuCsvUpload onSuccess={onSuccess} />)
    pick(container, [
      new File(['Etiket;Bağ\n'], 'a.csv', { type: 'text/csv' }),
      new File(['Etiket;Bağ\n'], 'b.csv', { type: 'text/csv' }),
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Import 2 files' }))
    expect(await screen.findByText(/a\.csv: We could not find a column.*b\.csv: We could not open this spreadsheet/)).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('MenuCsvUpload: one file (F-684)', () => {
  it('previews a semicolon file in its columns', async () => {
    const { container } = render(<MenuCsvUpload onSuccess={vi.fn()} />)
    pick(container, [new File(['Ad;Şişe\nYakut;850\n'], 'menu.csv', { type: 'text/csv' })])
    expect(await screen.findByRole('columnheader', { name: 'Şişe' })).toBeInTheDocument()
    // The count on the button stays the preview's (MenuImportReads.test.tsx pins it).
    expect(screen.getByRole('button', { name: 'Import 1 line' })).toBeInTheDocument()
  })

  // F-1294: Turkish Excel's default CSV is Windows-1254; read as UTF-8 its
  // headers went unread and its names were stored garbled.
  it('reads a Turkish Excel CSV in a Turkish house, and refuses a file it cannot read', async () => {
    setHouseLocale('tr-TR')
    const { container } = render(<MenuCsvUpload onSuccess={vi.fn()} />)
    // "Ad;Şişe\nYakut;850\n" as Windows-1254 bytes.
    const bytes = new Uint8Array([0x41, 0x64, 0x3b, 0xde, 0x69, 0xfe, 0x65, 0x0a, 0x59, 0x61, 0x6b, 0x75, 0x74, 0x3b, 0x38, 0x35, 0x30, 0x0a])
    pick(container, [new File([bytes], 'menu.csv', { type: 'text/csv' })])
    expect(await screen.findByRole('columnheader', { name: 'Şişe' })).toBeInTheDocument()
    pick(container, [new File(['Ad;\uFFFD\n'], 'bad.csv', { type: 'text/csv' })])
    expect(await screen.findByText(/CSV UTF-8/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument()
    setHouseLocale('en-US')
  })
})

const proofLine = (id: string, name: string) => ({
  menuItemId: id,
  name,
  category: 'red',
  matched: true,
  needsReview: false,
})

function mountProof(proof: object) {
  sessionStorage.setItem(FIRST_PROOF_KEY, JSON.stringify(proof))
  render(
    <MemoryRouter>
      <HouseMenu />
    </MemoryRouter>,
  )
}

describe('the first proof (HouseMenu): what the read kept back', () => {
  beforeEach(() => sessionStorage.clear())

  it('names the columns not read and the rows skipped', () => {
    mountProof({
      menuId: 'm1',
      itemsExtracted: 1,
      submissionsCreated: 0,
      items: [proofLine('a', 'Yakut')],
      read: {
        ignoredColumns: ['Notes'],
        dropped: [
          { row: 2, reason: '"KIRMIZI ŞARAPLAR" looks like a heading (no price)' },
          { row: 4, reason: 'no name' },
        ],
        unreadable: ['row 3, column B: the cell shows #DIV/0!'],
      },
    })
    const notes = screen.getByTestId('proof-read-notes')
    expect(notes).toHaveTextContent('Columns we did not read: Notes.')
    expect(notes).toHaveTextContent(
      '2 rows skipped: row 2 ("KIRMIZI ŞARAPLAR" looks like a heading (no price)); row 4 (no name).',
    )
    expect(notes).toHaveTextContent('Cells we could not read: row 3, column B: the cell shows #DIV/0!.')
  })

  it("lists every file sent at once, the one that was not read included", () => {
    mountProof({
      menuId: 'm1',
      itemsExtracted: 2,
      submissionsCreated: 0,
      items: [proofLine('a', 'Yakut'), proofLine('c', 'Raki')],
      files: [
        { name: 'reds.csv', itemsExtracted: 1, read: { ignoredColumns: ['Cost'], dropped: [], unreadable: [] } },
        { name: 'cover.csv', failure: 'Nothing was read from this file, so nothing was kept.' },
        { name: 'spirits.csv', itemsExtracted: 1, read: null },
      ],
    })
    const notes = screen.getByTestId('proof-read-notes')
    expect(notes).toHaveTextContent('reds.csv: 1 line read.')
    expect(notes).toHaveTextContent('Columns we did not read: Cost.')
    expect(notes).toHaveTextContent('cover.csv: not read. Nothing was read from this file, so nothing was kept.')
    expect(notes).toHaveTextContent('spirits.csv: 1 line read.')
  })

  it('says nothing extra when nothing was kept back', () => {
    mountProof({ menuId: 'm1', itemsExtracted: 1, submissionsCreated: 0, items: [proofLine('a', 'Yakut')] })
    expect(screen.queryByTestId('proof-read-notes')).not.toBeInTheDocument()
  })
})
