/**
 * What the book knows, and the one thing it still wants — as pure functions of
 * the readout.
 *
 * Split out of `Arrival.tsx` because none of it renders anything: every claim
 * here is a claim about what a readout MEANS, and a claim about meaning should
 * be testable without mounting a page. `Arrival.tsx` keeps the drawing.
 */
import { arrivalApi, type Batch, type Book, type Folio } from './arrival-api'

export function folioState(
  book: Book,
  folio: Folio,
): { state: string; detail: string } {
  if (!book.folios.readable)
    return {
      state: 'unreadable',
      detail: 'The folio history could not be read.',
    }
  const saved = book.folios.data?.find((row) => row.folio === folio)
  const source =
    folio === 'evidence' || folio === 'assistant'
      ? book.batches
      : folio === 'pour'
        ? book.cellar
        : folio === 'notifications'
          ? book.preferences
          : book[folio]
  if (!source.readable)
    return {
      state: 'blocked',
      detail: source.reason ?? 'This register could not be read.',
    }
  if (saved?.state === 'skipped')
    return {
      state: 'skipped',
      detail: `Carried forward · ${new Date(saved.updated_at).toLocaleDateString()}`,
    }
  if (
    folio === 'currency' &&
    book.currency.data?.readable &&
    book.currency.data.code
  )
    return {
      state: 'posted',
      detail: `${book.currency.data.code} · already recorded`,
    }
  if (folio === 'currency' && book.currency.data?.readable === false)
    return {
      state: 'blocked',
      detail: book.currency.data.reason ?? 'Currency could not be read.',
    }
  if (folio === 'pour') {
    if (book.cellar.data?.sources.answers.readable === false)
      return {
        state: 'blocked',
        detail: 'The recorded registers could not be read.',
      }
    const registers = book.cellar.data?.registers ?? []
    const stated = registers.filter((row) =>
      ['manual', 'confirmed'].includes(row.decidedBy),
    ).length
    if (stated)
      return {
        state: stated === registers.length ? 'posted' : 'open',
        detail: `${stated} of ${registers.length} registers answered`,
      }
  }
  if (folio === 'vendors') {
    if (
      !book.vendors.data?.terms.sources.providers.readable ||
      !book.vendors.data?.terms.sources.statedTerms.readable
    )
      return {
        state: 'blocked',
        detail: 'The vendors or their stated terms could not be read.',
      }
    const vendors = book.vendors.data?.terms.vendors ?? []
    if (!vendors.length)
      return { state: 'blocked', detail: 'Add a vendor to open its terms.' }
    const answered = vendors.filter(
      (v) =>
        [
          v.deliveryWeekdays,
          v.leadTimeDays,
          v.minimumOrder,
          v.orderCutoff,
          v.paymentTerms,
        ].every(
          (cell) => cell.source === 'stated' || cell.source === 'vendor_record',
        ) &&
        book.vendors.data?.currencies.some(
          (c) => c.id === v.providerId && c.usual_currency,
        ),
    ).length
    return {
      state: answered === vendors.length ? 'posted' : 'open',
      detail: `${answered} of ${vendors.length} vendors fully answered`,
    }
  }
  if (folio === 'notifications' && book.preferences.data?.updatedAt)
    return { state: 'posted', detail: 'Your preferences are recorded' }
  if (folio === 'assistant') {
    const draft = book.batches.data?.find((batch) => batch.status === 'draft')
    if (draft?.rows.length)
      return {
        state: 'open',
        detail: `${draft.rows.filter((row) => row.status === 'pending').length} entries in pencil`,
      }
    if (
      book.batches.data?.some((batch) =>
        ['applying', 'undoing'].includes(batch.status),
      )
    )
      return {
        state: 'blocked',
        detail: 'A batch has an unresolved receipt. Read it here.',
      }
  }
  return {
    state: saved?.state ?? 'open',
    detail:
      saved?.state === 'posted'
        ? `Recorded · ${new Date(saved.updated_at).toLocaleDateString()}`
        : 'Not yet answered',
  }
}

/** Menu entries this house's last read left in pencil, unsealed. */
export function pencilMenuRows(book: Book): number {
  const draft = book.batches.data?.find((batch) => batch.status === 'draft')
  return (
    draft?.rows.filter(
      (row) => row.status === 'pending' && row.target === 'menu_item',
    ).length ?? 0
  )
}

/** Every entry in pencil, whatever it proposes. */
function pencilRows(book: Book): number {
  const draft = book.batches.data?.find((batch) => batch.status === 'draft')
  return draft?.rows.filter((row) => row.status === 'pending').length ?? 0
}

/**
 * The one line that asks — and the whole of this build's answer to "where does
 * 'what do I do next' live".
 *
 * There is NO guidance object. Every contents line already states what it
 * knows; this picks exactly one of them to also state what the book still
 * wants, and why. First match wins and the list is ranked, so two lines can
 * never ask at once — the failure mode a per-folio slip or a docket of every
 * act both have by construction.
 *
 * The ranking is the founder's own ordering of 2026-09-22: nothing stands in
 * front of the menu, so the menu asks first; a read that is still in pencil
 * asks next, because nothing it found counts until it is sealed; then the lines
 * the reader could not place, which is the only thing the book cannot answer
 * for itself. Currency and vendors are secondary by instruction, and the vendor
 * line says "optional" in the ask itself.
 *
 * A folio that was carried forward is never re-asked here — that is what
 * carrying forward MEANT. It stays on the contents with its date.
 */
export function nextAct(book: Book): { folio: Folio; want: string } | null {
  const skipped = (folio: Folio) => folioState(book, folio).state === 'skipped'
  const pencil = pencilRows(book)
  const menuItems = book.openingMenu.data?.items.length ?? 0
  const lines = book.cellar.data?.menuLines ?? null

  if (
    book.openingMenu.readable &&
    menuItems === 0 &&
    pencilMenuRows(book) === 0 &&
    !skipped('evidence')
  )
    return {
      folio: 'evidence',
      want: 'Nothing is written yet. Give the book a menu and it opens already written.',
    }

  if (pencil > 0)
    return {
      folio: 'assistant',
      want: `${pencil} ${pencil === 1 ? 'entry waits' : 'entries wait'} on one seal. Nothing they propose counts until you read them.`,
    }

  if (lines && lines.notPlaced > 0 && !skipped('pour'))
    return {
      folio: 'pour',
      want: `${lines.notPlaced} of the ${lines.read} lines read could not be placed on a register. That is the only thing the book cannot answer for itself.`,
    }

  if (
    book.currency.data?.readable &&
    !book.currency.data.code &&
    !skipped('currency')
  )
    return {
      folio: 'currency',
      want: 'No reporting currency is recorded, so nothing in this book can be totalled.',
    }

  const vendors = book.vendors.data?.terms.vendors ?? []
  if (vendors.length > 0 && !skipped('vendors')) {
    const state = folioState(book, 'vendors')
    if (state.state === 'open')
      return {
        folio: 'vendors',
        want: `${state.detail}. One vendor's written terms make a delivery argument checkable — optional.`,
      }
  }

  // The book states and asks nothing. That is a real outcome, not a gap to
  // fill with an invented suggestion.
  return null
}

/**
 * Turn a chosen file into the three arguments `/arrival/menu-evidence` takes.
 *
 * One implementation on purpose: the flyleaf and folio 00 offer the same act,
 * and two readers of the same file would drift the first time one of them
 * learned a new spreadsheet extension.
 */
export async function readMenuFile(
  file: File,
): Promise<{ method: 'scan' | 'csv'; content: string; binary: boolean }> {
  const csv = /\.csv$/i.test(file.name)
  const binary = /\.xlsx?$/i.test(file.name)
  const content = csv
    ? await file.text()
    : await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
  return { method: csv || binary ? 'csv' : 'scan', content, binary }
}

/**
 * Lines a person typed, as the one CSV column the reader needs. Every value is
 * quoted, because a drink named "Gin, Lime & Soda" is one line and an unquoted
 * comma would make it three.
 */
export function typedLinesToCsv(text: string): string {
  const rows = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `"${line.replace(/"/g, '""')}"`)
  return ['name', ...rows].join('\n')
}

/** Read a chosen menu file and stage its entries in pencil. Never writes. */
export async function stageMenuFile(file: File): Promise<Batch> {
  const read = await readMenuFile(file)
  return arrivalApi.menuEvidence(read.method, read.content, read.binary)
}

/** The largest menu file the reader accepts. */
export const MENU_FILE_LIMIT = 10_000_000
