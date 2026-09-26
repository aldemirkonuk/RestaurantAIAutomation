import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { getActiveRestaurantId } from '../../services/api/client'
import { receivingApi } from '../../services/api/receiving'
import { documentsApi, ProcurementDocument } from '../../services/api/documents'
import { HoldToApprove } from '../../components/mudavym/HoldToApprove'
import { BrandMark } from '../../components/brand/BrandMark'
import { turn } from '../../lib/mudavym/motion'
import { ArrivalField, formatValue } from './ArrivalField'
import {
  arrivalApi,
  arrivalError,
  Batch,
  Book,
  Folio,
  Vendor,
} from './arrival-api'
import {
  folioState,
  MENU_FILE_LIMIT,
  nextAct,
  pencilMenuRows,
  stageMenuFile,
  typedLinesToCsv,
} from './arrival-reading'
import '../../styles/mudavym.css'
import './arrival.css'

export const ARRIVAL_FOLIOS: Array<{
  id: Folio
  title: string
  purpose: string
  /**
   * Founder's instruction of 2026-09-22: "whom we buy from" stays and must be
   * skippable. No folio is a gate, so every folio is *technically* optional —
   * this flag is about the one the founder named, which has to LOOK optional
   * on the contents line, on the folio and on its controls, because a folio
   * that only reads as required defeats the instruction.
   */
  optional?: true
}> = [
  {
    id: 'evidence',
    title: 'The last invoice',
    purpose: 'Read the last paper through the door, or carry it forward.',
  },
  {
    id: 'currency',
    title: 'Currency',
    purpose:
      'The money this house reports in. Each invoice keeps its own currency.',
  },
  {
    id: 'pour',
    title: 'What we pour',
    purpose:
      'The registers this house carries, grounded in its own menu and cellar.',
  },
  {
    id: 'vendors',
    title: 'Whom we buy from',
    purpose:
      'Optional. Write only the terms somebody has told you. Most houses leave this until the first delivery argument — that is the right time for it.',
    optional: true,
  },
  {
    id: 'notifications',
    title: 'What we hear about',
    purpose: 'Your channels and quiet hours. These preferences belong to you.',
  },
  {
    id: 'assistant',
    title: 'The assistant',
    purpose:
      'Read what Mudavym put in pencil. One held seal records the batch.',
  },
]
/**
 * The flyleaf — and the one act it holds.
 *
 * A flyleaf is the leaf at the front of a book where the owner writes their
 * name. This house inscribes itself by handing over its menu, so the upload is
 * NOT a folio: it is the inscription, and nothing stands in front of it. No
 * currency, no vendor, no notifications, no checklist.
 *
 * Founder's decision of 2026-09-22: this is a STRONG DEFAULT, not a hard gate.
 * "Open the book without it" is present, works, and records nothing — so a read
 * that will not finish cannot trap a house on this leaf. It is drawn secondary,
 * not hidden.
 */
function Inscription({
  keeper,
  house,
  canManage,
  onRead,
  onSkip,
}: {
  keeper: string
  house: string
  canManage: boolean
  onRead: () => void
  onSkip: () => void
}) {
  const [reading, setReading] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [lines, setLines] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  async function stage(label: string, work: () => Promise<Batch>) {
    setMessage(null)
    setReading(label)
    try {
      const batch = await work()
      const entries = batch.rows.filter((row) => row.status === 'pending')
        .length
      setMessage(
        `${entries} ${entries === 1 ? 'entry is' : 'entries are'} in pencil. No menu, library or inventory row was created — read them, then hold one seal.`,
      )
      onRead()
    } catch (error) {
      setMessage(arrivalError(error))
    } finally {
      setReading(null)
    }
  }

  const way = (
    id: string,
    numeral: string,
    title: string,
    detail: string,
    control: ReactNode,
    primary?: true,
  ) => (
    <li className="ar-way" data-primary={primary}>
      <span className="ar-numeral">{numeral}</span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className="ar-way-control" id={`${id}-control`}>
        {control}
      </span>
    </li>
  )

  return (
    <section className="ar-flyleaf ar-inscribe">
      <p className="ar-meta">Opening entries</p>
      <h1>{house}’s book is empty.</h1>
      <p className="ar-lede">
        Kept by {keeper}. A book needs something written in it before it can be
        read back. Give it the menu and it will open already written.
      </p>

      {reading ? (
        /*
         * The wait is a page being written, not a spinner. Each row is a fact
         * that is true at the moment it is drawn — no percentage is invented,
         * no count is guessed ahead of the read, and nothing loops.
         */
        <div className="ar-writing" role="status">
          <div data-done>
            <span>{reading} taken in</span>
            <em>kept</em>
          </div>
          <div data-waiting>
            <span>Reading the lines that name a drink</span>
            <em>reading</em>
          </div>
          <div data-waiting>
            <span>Placing them on this house’s registers</span>
            <em>waits</em>
          </div>
          <p className="ar-note">
            Nothing is committed while this runs. You will read it before it
            counts.
          </p>
        </div>
      ) : (
        <ul className="ar-ways">
          {way(
            'ar-fly-photo',
            'i',
            'Photograph the menu',
            'Camera or an image from this machine. Best for a printed card.',
            <>
            <label className="ar-way-choose" htmlFor="ar-fly-photo">
              Read it →
            </label>
            <input
              id="ar-fly-photo"
              className="ar-file"
              type="file"
              aria-label="Photograph the menu"
              accept="image/*,application/pdf"
              capture="environment"
              disabled={!canManage}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                if (file.size > MENU_FILE_LIMIT) {
                  setMessage('Use a menu smaller than 10 MB.')
                  return
                }
                void stage(file.name, () => stageMenuFile(file))
              }}
            />
            </>,
            true,
          )}
          {way(
            'ar-fly-file',
            'ii',
            'Send a file',
            'PDF, CSV or a spreadsheet you already keep.',
            <>
            <label className="ar-way-choose" htmlFor="ar-fly-file">
              Read it →
            </label>
            <input
              id="ar-fly-file"
              className="ar-file"
              type="file"
              aria-label="Send a file"
              accept="application/pdf,.csv,.xlsx,.xls,image/*"
              disabled={!canManage}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                if (file.size > MENU_FILE_LIMIT) {
                  setMessage('Use a menu smaller than 10 MB.')
                  return
                }
                void stage(file.name, () => stageMenuFile(file))
              }}
            />
            </>,
          )}
          {way(
            'ar-fly-typed',
            'iii',
            'Write the lines yourself',
            'For a short list, or a house that keeps no file.',
            <button
              disabled={!canManage}
              onClick={() => setTyping((was) => !was)}
            >
              {typing ? 'Close the page' : 'Open a page'}
            </button>,
          )}
        </ul>
      )}

      {typing && !reading && (
        <div className="ar-typed">
          <label className="ar-meta" htmlFor="ar-fly-lines">
            One drink to a line. Nothing else is asked for.
          </label>
          <textarea
            id="ar-fly-lines"
            rows={6}
            value={lines}
            onChange={(event) => setLines(event.target.value)}
          />
          <button
            disabled={!lines.trim()}
            onClick={() =>
              void stage('The lines you wrote', () =>
                arrivalApi.menuEvidence('csv', typedLinesToCsv(lines), false),
              )
            }
          >
            Read these lines
          </button>
        </div>
      )}

      {message && (
        <p role="status" className="ar-message">
          {message}
        </p>
      )}

      <div className="ar-aside">
        <button className="ar-quiet" onClick={onSkip}>
          Open the book without it
        </button>
        <p className="ar-note">
          Skipping loses nothing and records nothing. The flyleaf stays here
          until a menu is read.
        </p>
      </div>
    </section>
  )
}

function SourceFailure({
  reason,
  retry,
}: {
  reason?: string | null
  retry: () => void
}) {
  return (
    <div className="ar-message" role="alert">
      <p>{reason ?? 'This part of the book could not be read.'}</p>
      <button onClick={retry}>Read again</button>
    </div>
  )
}

function VendorFolio({ book, refresh }: { book: Book; refresh: () => void }) {
  const [selected, setSelected] = useState('')
  const source = book.vendors
  if (!source.readable || !source.data)
    return <SourceFailure reason={source.reason} retry={refresh} />
  if (
    !source.data.terms.sources.providers.readable ||
    !source.data.terms.sources.statedTerms.readable
  )
    return (
      <SourceFailure
        reason="The vendors or their stated terms could not be read. No empty values have been substituted."
        retry={refresh}
      />
    )
  const vendors = source.data.terms.vendors
  const vendor = vendors.find((v) => v.providerId === selected) ?? vendors[0]
  if (!vendor)
    return (
      <div className="ar-message">
        <p>
          No vendor has been added to this house. Add one, then open its terms
          here.
        </p>
        <Link to="/providers">Open the vendor book</Link>
      </div>
    )
  const currency =
    source.data.currencies.find((v) => v.id === vendor.providerId)
      ?.usual_currency ?? null
  const field = (
    label: string,
    key: string,
    cell: keyof Vendor,
    kind: 'text' | 'terms' | 'days' | 'number' = 'text',
  ) => (
    <ArrivalField
      key={`${vendor.providerId}.${key}`}
      label={label}
      input={{
        target: 'vendor_terms',
        subjectId: vendor.providerId,
        field: key,
        value: (vendor[cell] as { value: unknown })?.value ?? null,
      }}
      kind={kind}
      source={
        (vendor[cell] as { source: string })?.source ?? 'Not yet answered'
      }
      disabled={!book.canManage}
      onRecorded={refresh}
    />
  )
  const cutoff = vendor.orderCutoff.value as {
    time?: string | null
    offsetDays?: number | null
  } | null
  return (
    <>
      <label className="ar-meta" htmlFor="ar-vendor">
        Vendor
      </label>
      <select
        id="ar-vendor"
        value={vendor.providerId}
        onChange={(e) => setSelected(e.target.value)}
      >
        {vendors.map((v) => (
          <option value={v.providerId} key={v.providerId}>
            {v.providerName}
          </option>
        ))}
      </select>
      {field('Delivery days', 'deliveryWeekdays', 'deliveryWeekdays', 'days')}
      {field('Lead time · days', 'leadTimeDays', 'leadTimeDays', 'number')}
      {field(
        `Minimum order · ${book.currency.data?.code ?? 'currency not recorded'}`,
        'minimumOrderAmount',
        'minimumOrder',
        'number',
      )}
      <ArrivalField
        label="Order cutoff"
        input={{
          target: 'vendor_terms',
          subjectId: vendor.providerId,
          field: 'orderCutoffTime',
          value: cutoff?.time ?? null,
        }}
        kind="time"
        source={vendor.orderCutoff.source}
        disabled={!book.canManage}
        onRecorded={refresh}
      />
      <ArrivalField
        label="Days before delivery"
        input={{
          target: 'vendor_terms',
          subjectId: vendor.providerId,
          field: 'orderCutoffOffsetDays',
          value: cutoff?.offsetDays ?? null,
        }}
        kind="number"
        source={vendor.orderCutoff.source}
        disabled={!book.canManage}
        onRecorded={refresh}
      />
      {field('Payment terms', 'paymentTerms', 'paymentTerms', 'terms')}
      <ArrivalField
        label="Usual invoice currency"
        input={{
          target: 'vendor_currency',
          subjectId: vendor.providerId,
          field: 'code',
          value: currency,
        }}
        kind="currency"
        source={currency ? 'Stated on the vendor profile' : 'Not yet answered'}
        disabled={!book.canManage}
        onRecorded={refresh}
      />
      <p className="ar-note">
        A vendor’s usual currency is offered when you order. It never determines
        the currency of an invoice. Payment terms are not extracted from
        invoices.
      </p>
    </>
  )
}

function EvidenceFolio({ book, refresh }: { book: Book; refresh: () => void }) {
  const documents = useQuery({
    queryKey: ['arrival-invoices', book.restaurantId],
    queryFn: () => documentsApi.list({ docType: 'invoice', limit: 30 }),
    enabled: book.canManage,
  })
  const [documentId, setDocumentId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  async function upload(file: File) {
    setMessage(null)
    if (file.size > 10_000_000) {
      setMessage('This paper is larger than 10 MB. Use a smaller image or PDF.')
      return
    }
    setBusy(true)
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const result = await receivingApi.uploadDocument({
        contentBase64,
        filename: file.name,
        mimeType: file.type,
        source: 'upload',
      })
      if (result.documentId) setDocumentId(result.documentId)
      await documents.refetch()
      setMessage(
        'The paper is stored. Read its extracted details before adding a configuration proposal.',
      )
    } catch (error) {
      setMessage(arrivalError(error))
    } finally {
      setBusy(false)
    }
  }
  async function propose() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await arrivalApi.evidence(
        documentId,
        providerId || undefined,
      )
      setMessage(
        result.reason ??
          'The supported entries are in pencil in The assistant. No configuration has been applied.',
      )
      refresh()
    } catch (error) {
      setMessage(arrivalError(error))
    } finally {
      setBusy(false)
    }
  }
  async function stageMenu(file: File) {
    if (file.size > MENU_FILE_LIMIT) {
      setMessage('Use a menu smaller than 10 MB.')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const batch = await stageMenuFile(file)
      setMessage(
        `${batch.rows.filter((row) => row.status === 'pending').length} supported entries are in pencil. No menu, library or inventory row was created. Read each entry in The assistant before sealing.`,
      )
      refresh()
    } catch (error) {
      setMessage(arrivalError(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <p>
        The latest invoice is a starting point, never a requirement. Extracted
        entries wait in the same batch as spoken entries. A person chooses the
        vendor; no name is silently matched.
      </p>
      {!book.canManage ? (
        <p className="ar-message">
          The house’s owner or manager can read an invoice and propose its
          configuration.
        </p>
      ) : (
        <>
          <label className="ar-meta" htmlFor="ar-invoice-file">
            Photograph or upload the last invoice
          </label>
          <input
            id="ar-invoice-file"
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
              e.target.value = ''
            }}
          />
          {documents.isLoading ? (
            <p role="status">Reading the papers…</p>
          ) : documents.isError ? (
            <SourceFailure
              reason="The invoice list could not be read."
              retry={() => void documents.refetch()}
            />
          ) : (
            <>
              <label className="ar-meta" htmlFor="ar-invoice">
                Or open a paper already here
              </label>
              <select
                id="ar-invoice"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
              >
                <option value="">Choose an invoice</option>
                {documents.data?.map((doc: ProcurementDocument) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.doc_number ?? doc.filename ?? 'Invoice'} ·{' '}
                    {doc.doc_date ?? 'date not recorded'} · {doc.status}
                  </option>
                ))}
              </select>
            </>
          )}
          <label className="ar-meta" htmlFor="ar-evidence-vendor">
            Which vendor sent it?
          </label>
          <select
            id="ar-evidence-vendor"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            disabled={!book.vendors.readable}
          >
            <option value="">Not matched yet — do not assume</option>
            {book.vendors.data?.terms.vendors.map((v) => (
              <option value={v.providerId} key={v.providerId}>
                {v.providerName}
              </option>
            ))}
          </select>
          <div className="ar-actions">
            <button
              disabled={!documentId || busy}
              onClick={() => void propose()}
            >
              {busy ? 'Reading the paper…' : 'Put supported entries in pencil'}
            </button>
            {documentId && (
              <Link to={`/documents/${documentId}`}>
                Read the original document
              </Link>
            )}
          </div>
          {message && (
            <p role="status" className="ar-message">
              {message}
            </p>
          )}
        </>
      )}
      <section className="ar-opening">
        <h3>The opening menu</h3>
        <p>
          Photograph or upload the beverage menu. Its interpreted entries stay
          in pencil until the same batch is sealed. Only then can the house’s
          items support proposals in What we pour.
        </p>
        {!book.openingMenu.readable ? (
          <SourceFailure reason={book.openingMenu.reason} retry={refresh} />
        ) : (
          <p>
            {book.openingMenu.data?.items.length
              ? `${book.openingMenu.data.items.length} menu items are in this house’s book.`
              : 'No active menu is recorded.'}
          </p>
        )}
        {book.canManage && (
          <>
            <label className="ar-meta" htmlFor="ar-menu-file">
              Menu evidence · image, PDF, CSV or spreadsheet
            </label>
            <input
              id="ar-menu-file"
              type="file"
              accept="image/*,application/pdf,.csv,.xlsx,.xls"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void stageMenu(file)
                event.target.value = ''
              }}
            />
            <p className="ar-note">
              This reader extracts beverage items. Food-menu configuration is
              not inferred from missing beverage rows.
            </p>
          </>
        )}
      </section>
    </>
  )
}

/**
 * The reveal — what the menu says this house pours.
 *
 * THREE THINGS THIS IS NOT, each of them a shape an earlier build had:
 *
 * 1. It is not a capability claim. It is a READING COUNT — lines read, lines
 *    placed, lines not placed (founder's decision, 2026-09-22: keep all three).
 *    Measured today most non-wine registers read `none` or `unknown` on a fresh
 *    upload, so a reveal that claimed capabilities would fail on a thin
 *    harvest. A reveal that reports "9 lines read, 2 placed, 7 not placed"
 *    still reports real work — and the not-placed figure is the only thing here
 *    that asks the house for anything.
 * 2. It is not seven pre-ticked checkboxes over a confirm button. Nothing is
 *    ticked, so nothing can be tick-approved: registers the books support are
 *    READ BACK as stated facts carrying the service's own `basis` sentence
 *    verbatim, and are not actionable. Only the un-evidenced ones can be acted
 *    on, one at a time.
 * 3. It is not a place where an un-evidenced register reads as a failure. The
 *    service already distinguishes "we read your books and found none" from
 *    "there were no books to read" (`cellar-registers.ts:31-38`) and prints the
 *    difference itself. This renders that sentence rather than flattening both
 *    into an empty row.
 */
function PourReveal({
  book,
  refresh,
  announce,
}: {
  book: Book
  refresh: () => void
  announce: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const data = book.cellar.data!
  const lines = data.menuLines
  const pencil = pencilMenuRows(book)
  const stated = data.registers.filter((row) => row.carried === true)
  const silent = data.registers.filter((row) => row.carried !== true)

  async function act(work: () => Promise<unknown>, said: string) {
    setBusy(true)
    try {
      await work()
      announce(said)
      refresh()
    } catch (error) {
      announce(arrivalError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {lines ? (
        <>
          {/* `role="group"` because a <dl> has no implicit role to hang the
              label on, and the three figures are one labelled statement. */}
          <dl className="ar-count" role="group" aria-label="The reading count">
            <div>
              <dt>Lines read</dt>
              <dd>{lines.read}</dd>
            </div>
            <div>
              <dt>Placed on a register</dt>
              <dd>{lines.placed}</dd>
            </div>
            <div data-open={lines.notPlaced > 0 ? '' : undefined}>
              <dt>Not placed</dt>
              <dd>{lines.notPlaced}</dd>
            </div>
          </dl>
          <p className="ar-note">
            A line is “placed” when the book can name the register it belongs
            to. These are the {lines.read} lines this house’s book holds, read
            by the same pass that wrote the registers below — not a count of
            what any file contained.
          </p>
        </>
      ) : (
        <p className="ar-message" role="alert">
          The menu could not be read, so there is no reading count. That is a
          failure to read, not an empty menu — no zero has been substituted for
          it.
        </p>
      )}

      {pencil > 0 && (
        <p className="ar-note">
          {pencil} menu {pencil === 1 ? 'entry is' : 'entries are'} still in
          pencil from the last read and {pencil === 1 ? 'is' : 'are'} not
          counted above. They join the reading when the batch is sealed in The
          assistant.
        </p>
      )}

      <div className="ar-registers">
        {stated.map((register) => (
          <div className="ar-register" key={register.id} data-read="">
            <h3>{register.id.replace(/_/g, ' ')}</h3>
            {/* The service's own sentence, verbatim. Never a template. */}
            <p>{register.basis}</p>
            <span className="ar-mark">{register.confidence}</span>
          </div>
        ))}
        {silent.map((register) => (
          <div className="ar-register" key={register.id} data-silent="">
            <h3>{register.id.replace(/_/g, ' ')}</h3>
            <p>{register.basis}</p>
            <button
              className="ar-ask"
              disabled={busy || !book.canManage}
              onClick={() =>
                void act(
                  () =>
                    arrivalApi.typed({
                      target: 'cellar',
                      field: register.id,
                      value: true,
                    }),
                  `${register.id.replace(/_/g, ' ')} is recorded as carried. What you switch by hand posts at once.`,
                )
              }
            >
              We pour this →
            </button>
          </div>
        ))}
      </div>

      <div className="ar-actions">
        <button
          disabled={!book.canManage || busy}
          onClick={() => {
            const rows = data.registers
              .filter(
                (row) =>
                  row.decidedBy === 'inferred' &&
                  row.carried !== null &&
                  (row.evidence.inventoryRows || row.evidence.menuRows),
              )
              .map((row) => ({
                target: 'cellar' as const,
                field: row.id,
                value: row.carried,
              }))
            if (!rows.length) {
              announce(
                'There are no supported register proposals yet. Add items to the menu or cellar, or state a register yourself.',
              )
              return
            }
            void act(
              () => arrivalApi.propose(rows, 'inferred'),
              'What the book read is in pencil in The assistant. Nothing is applied yet.',
            )
          }}
        >
          This reads right — put it in pencil
        </button>
      </div>
      <p className="ar-note">
        {lines && lines.notPlaced > 0
          ? `The ${lines.notPlaced} lines the reader could not place stay in this house’s menu book. /cellar lists them beside the registers; nothing is placed for you.`
          : 'Nothing above was ticked, so nothing here has been rubber-stamped. What the book read enters the ledger through one held seal; what you switch by hand posts at once.'}
      </p>

      <details className="ar-threshold">
        <summary>Not quite right? State a register yourself</summary>
        <p>
          A stored answer always wins over the books — a house that does not run
          a whiskey programme is describing its business, and the books are
          describing its shelves.
        </p>
        {data.registers.map((register) => (
          <ArrivalField
            key={register.id}
            label={register.id.replace(/_/g, ' ')}
            input={{
              target: 'cellar',
              field: register.id,
              value: register.decidedBy === 'inferred' ? null : register.carried,
            }}
            kind="boolean"
            source={`${register.decidedBy} · ${register.basis}`}
            disabled={!book.canManage}
            onRecorded={refresh}
          />
        ))}
      </details>

      <details className="ar-threshold">
        <summary>The existing low-stock setting</summary>
        <p>
          This changes the default copied when new inventory rows are imported.
          It does not rewrite existing item thresholds or the notification
          engine’s policy.
        </p>
        <ArrivalField
          label="Default minimum · bottles"
          input={{
            target: 'threshold',
            field: 'thresholdMin',
            value: book.house.data?.default_threshold_min ?? null,
          }}
          kind="number"
          source={
            book.house.data?.threshold_configured
              ? 'Previously configured'
              : 'Existing default · not yet confirmed'
          }
          disabled={!book.canManage}
          onRecorded={refresh}
        />
      </details>
    </>
  )
}

function BatchReceipt({
  batch,
  refresh,
  canManage,
  vendors,
}: {
  batch: Batch
  vendors: Vendor[]
  refresh: () => void
  canManage: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function act(work: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await work()
      refresh()
    } catch (e) {
      setError(arrivalError(e))
      refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="ar-batch">
      <h3>
        {batch.status === 'draft' ? 'Entries in pencil' : 'The batch receipt'}
      </h3>
      <p className="ar-meta">
        {batch.status} · {batch.id.slice(0, 8)}
      </p>
      <ul>
        {batch.rows.map((row) => (
          <li key={row.id}>
            <div>
              <strong>
                {row.subjectId
                  ? `${vendors.find((v) => v.providerId === row.subjectId)?.providerName ?? 'Vendor no longer readable'} · `
                  : ''}
                {row.target === 'menu_item'
                  ? String(
                      (row.value as { name?: string })?.name ?? 'Menu entry',
                    )
                  : ((
                      {
                        code:
                          row.target === 'vendor_currency'
                            ? 'Usual invoice currency'
                            : 'Reporting currency',
                        thresholdMin: 'Default minimum',
                        deliveryWeekdays: 'Delivery days',
                        orderCutoffTime: 'Order cutoff',
                        orderCutoffOffsetDays: 'Days before delivery',
                        minimumOrderAmount: 'Minimum order',
                        leadTimeDays: 'Lead time',
                        paymentTerms: 'Payment terms',
                      } as Record<string, string>
                    )[row.field] ??
                    row.field.replace(/([A-Z])/g, ' $1').replace(/[._]/g, ' '))}
              </strong>
              <span>
                Before: {formatValue(row.beforeValue)} → Proposed:{' '}
                {formatValue(row.value)}
              </span>
              <small>
                {row.provenance} · {row.status}
                {row.reason ? ` · ${row.reason}` : ''}
              </small>
            </div>
            {batch.status === 'draft' && (
              <button
                disabled={busy || !canManage}
                onClick={() =>
                  void act(() => arrivalApi.discard(batch, row.id))
                }
              >
                Leave out
              </button>
            )}
          </li>
        ))}
      </ul>
      {batch.status === 'draft' &&
        batch.rows.some((row) => row.status === 'pending') && (
          <>
            <p>
              One seal records these proposed entries, each through its own
              register. The receipt names any entry that could not be written.
              Your typed answers are already posted.
            </p>
            <HoldToApprove
              key={`${batch.id}:${batch.revision}:${error ?? ''}`}
              label={busy ? 'Recording…' : 'Hold to record this batch'}
              approvedLabel="Reading the receipt…"
              disabled={busy || !canManage}
              onChallenge={() => arrivalApi.mintApplySeal(batch.id)}
              onApprove={(challenge) =>
                void act(() => arrivalApi.apply(batch, challenge))
              }
            />
          </>
        )}
      {['applying', 'undoing'].includes(batch.status) && (
        <>
          <p className="ar-message">
            This batch has an unresolved write. It was not sent again
            automatically.
          </p>
          <HoldToApprove
            key={`resume:${batch.id}:${batch.revision}:${error ?? ''}`}
            label={busy ? 'Resuming…' : 'Hold to resume this batch'}
            approvedLabel="Reading the receipt…"
            disabled={busy || !canManage}
            onApprove={() =>
              void act(() =>
                batch.status === 'undoing'
                  ? arrivalApi.undo(batch)
                  : arrivalApi.apply(batch),
              )
            }
          />
        </>
      )}
      {batch.undo_until && (
        <p className="ar-note">
          {batch.status === 'undone' || batch.status === 'undone_with_issues'
            ? 'This undo attempt is recorded. Any entries marked written were retained; read their reasons.'
            : `Batch undo closes ${new Date(batch.undo_until).toLocaleString()}. Entries changed since the seal are left as they stand.`}{' '}
          For imported items, shared library identities are retained. Only
          unused house additions can be reversed.
        </p>
      )}
      {(batch.status === 'applied' || batch.status === 'applied_with_issues') &&
        batch.undo_until &&
        Date.parse(batch.undo_until) > Date.now() && (
          <button
            disabled={busy || !canManage}
            onClick={() => void act(() => arrivalApi.undo(batch))}
          >
            Undo this setup
          </button>
        )}
      {error && (
        <p role="alert" className="ar-message">
          {error}
        </p>
      )}
    </section>
  )
}

export default function Arrival() {
  const { user } = useAuth()
  const restaurantId = getActiveRestaurantId()
  const query = useQuery({
    queryKey: ['arrival', restaurantId, user?.userId],
    queryFn: arrivalApi.read,
    enabled: !!restaurantId,
    retry: 1,
  })
  const [folio, setFolio] = useState<Folio>('evidence')
  const [opened, setOpened] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = () => {
    void query.refetch()
  }
  async function skip() {
    setBusy(true)
    setMessage(null)
    try {
      await arrivalApi.skip(folio)
      setMessage('Carried forward. The skip is recorded; no setting changed.')
      refresh()
    } catch (error) {
      setMessage(arrivalError(error))
    } finally {
      setBusy(false)
    }
  }
  const book = query.data
  const active = ARRIVAL_FOLIOS.find((row) => row.id === folio)!
  /*
   * A house that has already given the book a menu never sees the flyleaf
   * again. The inscription is the act of a book that is empty; drawing it over
   * a book that is already written would be the gate the founder ruled against
   * (decision of 2026-09-22: strong default, not a hard gate).
   */
  const inscribed = book
    ? (book.openingMenu.data?.items.length ?? 0) > 0 ||
      pencilMenuRows(book) > 0 ||
      folioState(book, 'evidence').state === 'skipped'
    : false
  const asking = book ? nextAct(book) : null
  /*
   * The page names the ground it is already on. `.ar-page` paints
   * `background: var(--paper-0)`, but since ADR 0138 the bare `.mudavym`
   * selector redefines `--paper-0` to Warm Charcoal in every app theme, so the
   * literal paint says nothing about which ground actually renders — the two
   * selectors are both (0,1,0) and Vite decides which chunk's CSS is injected
   * first. `charcoal` is the documented synonym of that base
   * (styles/mudavym.css:40-46), so this changes no pixel; it makes the markup
   * state the ground instead of leaving it to injection order.
   */
  return (
    <main
      className="mudavym ar-page"
      data-ground="charcoal"
      data-testid="arrival-book"
      style={
        {
          '--ar-turn-duration': `${turn.ms}ms`,
          '--ar-turn-easing': turn.easing,
        } as CSSProperties
      }
    >
      <header className="ar-header">
        <Link to="/" aria-label="Mudavym home">
          <BrandMark size={28} className="ar-brand" />
        </Link>
        <span>The house’s book</span>
        <Link to="/settings">Settings</Link>
      </header>
      {!restaurantId ? (
        <div className="ar-flyleaf">
          <h1>Choose a house first.</h1>
          <Link to="/no-access">Open house access</Link>
        </div>
      ) : query.isLoading ? (
        <div className="ar-flyleaf" role="status">
          Opening the book…
        </div>
      ) : query.isError || !book ? (
        <div className="ar-flyleaf">
          <SourceFailure reason={arrivalError(query.error)} retry={refresh} />
        </div>
      ) : (
        <>
          {!opened && !inscribed ? (
            <Inscription
              keeper={user?.name ?? 'you'}
              house={book.house.data?.name ?? 'This house'}
              canManage={book.canManage}
              onRead={() => {
                /*
                 * The read opens the book on the reveal rather than on fo. 00.
                 * The legacy page already did this (`GetStarted.tsx:238-274`)
                 * and #414's book did not — it defaulted every action back to
                 * fo. 00, so the one thing the upload produced was the one
                 * thing the house had to go looking for.
                 */
                setFolio('pour')
                setOpened(true)
                refresh()
              }}
              onSkip={() => setOpened(true)}
            />
          ) : (
            <div className="ar-book">
              <aside aria-label="Contents">
                <p className="ar-meta">
                  Contents · {book.house.data?.name ?? 'House name unread'}
                </p>
                <ol>
                  {ARRIVAL_FOLIOS.map((row, index) => {
                    const state = folioState(book, row.id)
                    /*
                     * The contents page IS the guidance. Every line states what
                     * it knows; exactly one — never two — also states what the
                     * book still wants, and why. There is no separate guidance
                     * object to place, rank or keep from going stale, because
                     * the line that tells you is the line that records what was
                     * done.
                     */
                    const wants = asking?.folio === row.id
                    return (
                      <li key={row.id} data-state={state.state}>
                        <button
                          aria-current={folio === row.id ? 'page' : undefined}
                          data-asking={wants ? '' : undefined}
                          onClick={() => {
                            setFolio(row.id)
                            setMessage(null)
                          }}
                        >
                          <span className="ar-number">
                            {index === 0 ? '0' : `0${index}`}
                          </span>
                          <span>
                            {row.title}
                            {row.optional && (
                              <span className="ar-optional">Optional</span>
                            )}
                            <small>
                              {wants ? asking!.want : state.detail}
                            </small>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
                <Link to="/">Leave the book open</Link>
                <p className="ar-note">
                  No folio is a gate. One line asks at a time; the rest only
                  state. Recorded entries and carried-forward dates stay here.
                </p>
              </aside>
              <article key={folio} aria-labelledby="ar-title">
                <p className="ar-meta">
                  Folio {ARRIVAL_FOLIOS.findIndex((row) => row.id === folio)}
                </p>
                <h1 id="ar-title">
                  {active.title}
                  {active.optional && (
                    <span className="ar-optional">Optional</span>
                  )}
                </h1>
                <p className="ar-intro">{active.purpose}</p>
                {folio === 'evidence' && (
                  <EvidenceFolio book={book} refresh={refresh} />
                )}
                {folio === 'currency' &&
                  (!book.currency.readable || !book.currency.data?.readable ? (
                    <SourceFailure
                      reason={
                        book.currency.reason ?? book.currency.data?.reason
                      }
                      retry={refresh}
                    />
                  ) : (
                    <>
                      {book.currency.data.code ? (
                        <div className="ar-posted">
                          <p className="ar-meta">Already posted · stated</p>
                          <h2>{book.currency.data.code}</h2>
                          <p>
                            This house’s reporting currency is already recorded.
                            Nothing is asked twice.
                          </p>
                          <Link to="/settings?tab=currency">
                            Make a correcting entry in Settings
                          </Link>
                        </div>
                      ) : (
                        <ArrivalField
                          label="Reporting currency"
                          input={{
                            target: 'currency',
                            field: 'code',
                            value: null,
                          }}
                          kind="currency"
                          source="Not yet answered — no currency is assumed"
                          disabled={!book.canManage}
                          onRecorded={refresh}
                        />
                      )}
                    </>
                  ))}
                {folio === 'pour' &&
                  (!book.cellar.readable ||
                  !book.cellar.data?.sources.answers.readable ? (
                    <SourceFailure
                      reason={book.cellar.reason}
                      retry={refresh}
                    />
                  ) : (
                    <PourReveal
                      book={book}
                      refresh={refresh}
                      announce={setMessage}
                    />
                  ))}
                {folio === 'vendors' && (
                  <VendorFolio book={book} refresh={refresh} />
                )}
                {folio === 'notifications' &&
                  (!book.preferences.readable || !book.preferences.data ? (
                    <SourceFailure
                      reason={book.preferences.reason}
                      retry={refresh}
                    />
                  ) : (
                    <>
                      {(['email', 'push', 'sms'] as const).map((field) => (
                        <ArrivalField
                          key={field}
                          label={field}
                          input={{
                            target: 'notifications',
                            field,
                            value: book.preferences.data![field],
                          }}
                          kind="boolean"
                          source={
                            book.preferences.data!.updatedAt
                              ? 'Saved preferences; untouched fields keep their defaults'
                              : 'System default · not yet stated'
                          }
                          speechDisabled={!book.canManage}
                          onRecorded={refresh}
                        />
                      ))}
                      {Object.entries(book.preferences.data.categories).map(
                        ([field, value]) => (
                          <ArrivalField
                            key={field}
                            label={`${field} notices`}
                            input={{
                              target: 'notifications',
                              field: `categories.${field}`,
                              value,
                            }}
                            kind="boolean"
                            source="Your personal categories"
                            speechDisabled={!book.canManage}
                            onRecorded={refresh}
                          />
                        ),
                      )}
                      <ArrivalField
                        label="Quiet hours enabled"
                        input={{
                          target: 'notifications',
                          field: 'quietHours.enabled',
                          value: book.preferences.data.quietHours.enabled,
                        }}
                        kind="boolean"
                        source="Your personal quiet hours"
                        speechDisabled={!book.canManage}
                        onRecorded={refresh}
                      />
                      {(['startTime', 'endTime'] as const).map((field) => (
                        <ArrivalField
                          key={field}
                          label={
                            field === 'startTime' ? 'Quiet from' : 'Quiet until'
                          }
                          input={{
                            target: 'notifications',
                            field: `quietHours.${field}`,
                            value: book.preferences.data!.quietHours[field],
                          }}
                          kind="time"
                          source="Local clock time in your existing preferences"
                          speechDisabled={!book.canManage}
                          onRecorded={refresh}
                        />
                      ))}
                      <p className="ar-note">
                        These controls do not register a push subscription,
                        provision SMS, or switch a notification producer on.
                        Producer defaults remain unchanged.
                      </p>
                    </>
                  ))}
                {folio === 'assistant' &&
                  (!book.batches.readable ? (
                    <SourceFailure
                      reason={book.batches.reason}
                      retry={refresh}
                    />
                  ) : (
                    <>
                      <p>
                        Spoken fields, invoice evidence and inferred registers
                        meet here. Already stated values are kept out of the
                        batch. No roles, payment settings, connections or
                        autonomy switches can be proposed.
                      </p>
                      {book.batches.data?.length ? (
                        book.batches.data.map((batch) => (
                          <BatchReceipt
                            key={`${batch.id}:${batch.revision}`}
                            batch={batch}
                            vendors={book.vendors.data?.terms.vendors ?? []}
                            refresh={refresh}
                            canManage={book.canManage}
                          />
                        ))
                      ) : (
                        <div className="ar-message">
                          Nothing is in pencil yet. Speak a supported field,
                          read an invoice, or ask What we pour to propose from
                          the house’s items.
                        </div>
                      )}
                    </>
                  ))}
                {message && (
                  <p role="status" className="ar-message">
                    {message}
                  </p>
                )}
                {/*
                  * Skip is named and listed FIRST on an optional folio. A folio
                  * that is technically skippable but whose only control carries
                  * the same weight as every other folio's reads as a required
                  * step, which defeats the founder's instruction that "whom we
                  * buy from" stays skippable.
                  */}
                <footer className="ar-folio-footer">
                  <button
                    disabled={
                      busy ||
                      (!book.canManage &&
                        !['assistant', 'notifications'].includes(folio))
                    }
                    onClick={() => void skip()}
                  >
                    {busy
                      ? 'Recording…'
                      : active.optional
                        ? 'Not yet — carry it forward'
                        : 'Carry this folio forward'}
                  </button>
                  <span>
                    {active.optional
                      ? 'A recorded act, not an abandonment. The line stays on the contents with its date.'
                      : 'A dated skip. No setting changes.'}
                  </span>
                </footer>
              </article>
            </div>
          )}
        </>
      )}
    </main>
  )
}
