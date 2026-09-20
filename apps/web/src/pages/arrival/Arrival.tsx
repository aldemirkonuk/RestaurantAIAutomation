import { useState, type CSSProperties } from 'react'
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
import '../../styles/mudavym.css'
import './arrival.css'

export const ARRIVAL_FOLIOS: Array<{
  id: Folio
  title: string
  purpose: string
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
    purpose: 'Write only the terms somebody has told you.',
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
    if (file.size > 10_000_000) {
      setMessage('Use a menu smaller than 10 MB.')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
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
      const batch = await arrivalApi.menuEvidence(
        csv || binary ? 'csv' : 'scan',
        content,
        binary,
      )
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
          {!opened ? (
            <section className="ar-flyleaf">
              <p className="ar-meta">Opening entries</p>
              <h1>{book.house.data?.name ?? 'This house’s book'}</h1>
              <p>
                Kept by {user?.name ?? 'you'}. Open any folio, write what you
                know, and carry the rest forward. This book remembers between
                sittings.
              </p>
              <p>
                What you type is recorded when you press Record. What Mudavym
                interprets stays in pencil until you read it and hold the seal.
              </p>
              <button onClick={() => setOpened(true)}>Open the book</button>
              <Link to="/">Return to the house</Link>
            </section>
          ) : (
            <div className="ar-book">
              <aside aria-label="Contents">
                <p className="ar-meta">
                  Contents · {book.house.data?.name ?? 'House name unread'}
                </p>
                <ol>
                  {ARRIVAL_FOLIOS.map((row, index) => {
                    const state = folioState(book, row.id)
                    return (
                      <li key={row.id} data-state={state.state}>
                        <button
                          aria-current={folio === row.id ? 'page' : undefined}
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
                            <small>{state.detail}</small>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
                <Link to="/">Leave the book open</Link>
                <p className="ar-note">
                  No folio is a gate. Recorded entries and carried-forward dates
                  stay here.
                </p>
              </aside>
              <article key={folio} aria-labelledby="ar-title">
                <p className="ar-meta">
                  Folio {ARRIVAL_FOLIOS.findIndex((row) => row.id === folio)}
                </p>
                <h1 id="ar-title">{active.title}</h1>
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
                    <>
                      {book.cellar.data.registers.map((register) => (
                        <ArrivalField
                          key={register.id}
                          label={register.id.replace(/_/g, ' ')}
                          input={{
                            target: 'cellar',
                            field: register.id,
                            value:
                              register.decidedBy === 'inferred'
                                ? null
                                : register.carried,
                          }}
                          kind="boolean"
                          source={`${register.decidedBy} · ${register.basis}`}
                          disabled={!book.canManage}
                          onRecorded={refresh}
                        />
                      ))}
                      <button
                        disabled={!book.canManage || busy}
                        onClick={() => {
                          const rows = book.cellar
                            .data!.registers.filter(
                              (row) =>
                                row.decidedBy === 'inferred' &&
                                row.carried !== null &&
                                (row.evidence.inventoryRows ||
                                  row.evidence.menuRows),
                            )
                            .map((row) => ({
                              target: 'cellar' as const,
                              field: row.id,
                              value: row.carried,
                            }))
                          if (!rows.length) {
                            setMessage(
                              'There are no supported register proposals yet. Add items to the menu or cellar, or type your answers.',
                            )
                            return
                          }
                          setBusy(true)
                          void arrivalApi
                            .propose(rows, 'inferred')
                            .then(() => {
                              setMessage(
                                'Supported register proposals are in The assistant. Nothing is applied yet.',
                              )
                              refresh()
                            })
                            .catch((error) => setMessage(arrivalError(error)))
                            .finally(() => setBusy(false))
                        }}
                      >
                        Put the house’s inferred registers in pencil
                      </button>
                      <details className="ar-threshold">
                        <summary>The existing low-stock setting</summary>
                        <p>
                          This changes the default copied when new inventory
                          rows are imported. It does not rewrite existing item
                          thresholds or the notification engine’s policy.
                        </p>
                        <ArrivalField
                          label="Default minimum · bottles"
                          input={{
                            target: 'threshold',
                            field: 'thresholdMin',
                            value:
                              book.house.data?.default_threshold_min ?? null,
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
                <footer className="ar-folio-footer">
                  <button
                    disabled={
                      busy ||
                      (!book.canManage &&
                        !['assistant', 'notifications'].includes(folio))
                    }
                    onClick={() => void skip()}
                  >
                    {busy ? 'Recording…' : 'Carry this folio forward'}
                  </button>
                  <span>A dated skip. No setting changes.</span>
                </footer>
              </article>
            </div>
          )}
        </>
      )}
    </main>
  )
}
