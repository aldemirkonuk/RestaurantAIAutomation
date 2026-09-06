/**
 * CanonicalDocumentPage — every incoming document, rendered as ONE canonical
 * Mudavym document (ADR 0104, D12 slice 2; D13 locked C-led synthesis).
 *
 * THE ARRANGEMENT, AND WHY IT IS THIS ONE. The founder locked a synthesis, not a
 * direction: **C's delivery spine as the information architecture** (the unit of
 * record is the event, so N documents on one truck are cards, not new layouts),
 * **collapsed when the delivery has two or fewer documents** (C's cost is chrome
 * before the verdict, and an invoice-only US delivery must open as a sheet),
 * **A's typeset sheet as the selected frame** (the accountant's object, and the
 * only direction rigorous about per-field provenance and print), and **B's
 * verdict block on top** (the manager reads what differs before anything else).
 *
 * TWO WRITES, AND ONLY TWO (slice 3, ADR 0104 D5): correcting one layer-1 field
 * and ticking one field as verified. Neither EDITS anything — the gateway
 * appends a revision and an audit row that the database refuses to update or
 * delete, and this page re-reads the document afterwards rather than patching
 * what it is holding. The claims workflow and the mapping memory are slices 4
 * and 5; nothing else here writes.
 *
 * BEHIND THE GATE, OFF BY DEFAULT. `/documents/:id` renders through PageGate on
 * the `document` page name; a restaurant without `mudavym_design_document` is
 * sent to `/receipts`, which is where this view's second face already lives
 * (OD-106 keeps production brand builds gated).
 *
 * WHAT A FAILURE LOOKS LIKE. A failed fetch renders an error, never an empty
 * sheet. `deliveries: null` renders as "the delivery could not be read", never
 * as "this document is on no delivery". A document with no lines renders the
 * NOT EXTRACTED banner and the original (D6). Those three are the whole point of
 * the page: it is a screen about what a document says, so it must never be
 * confident about something it did not read.
 */

import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Wordmark } from '@/components/mudavym'
import {
  CanonicalSheet,
  CorrectionDialog,
  DegradedNotice,
  DeliverySpine,
  DoorFrame,
  MONO,
  OriginalPane,
  SANS,
  SERIF,
  VerdictBlock,
  degradedReasons,
  envelopeAt,
  sourceSentence,
} from '../../../components/documents'
import { canonicalApi } from '../../../services/api/canonical'
import './canonical-document.css'

type Tab = 'sheet' | 'door'

export function CanonicalDocumentPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  /**
   * `?view=door` opens the door frame directly (ADR 0104 S10). The door is a
   * phone at a doorway, and a phone arrives by LINK — from a notification, a
   * message, a QR on the delivery bay wall — not by finding a tab. The tab
   * itself still appears only where a door count exists or the document is one.
   */
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get('view') === 'door' ? 'door' : 'sheet')
  const [selectedLine, setSelectedLine] = useState<number | null>(null)
  /** The field a correction form is open on, or null. */
  const [correcting, setCorrecting] = useState<{ path: string; label: string } | null>(null)
  /**
   * The GATEWAY's own words when it refused, shown verbatim.
   *
   * It knows things this page deliberately does not — which fields are
   * correctable, what type each one is, whether somebody else's correction
   * landed first — and paraphrasing "`lines[9].quantity`: this document has 1
   * line" into "something went wrong" would throw away the only sentence that
   * tells the person what to do next.
   */
  const [writeError, setWriteError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)

  const q = useQuery({
    queryKey: ['canonical-document', id],
    queryFn: () => canonicalApi.document(id),
    enabled: !!id,
    staleTime: 30_000,
  })

  const fetchedAt = q.dataUpdatedAt || Date.now()
  const res = q.data
  const doc = res?.canonical

  /** The gateway's message, or the transport's when there is nothing better. */
  const messageFrom = (err: unknown): string => {
    const body = (err as { response?: { data?: { message?: unknown } } })?.response?.data
        ?.message
    if (typeof body === 'string' && body.length) return body
    const msg = (err as { message?: unknown })?.message
    return typeof msg === 'string' && msg.length
      ? msg
      : 'The correction could not be recorded, and the reason did not come back.'
  }

  const recordCorrection = async (value: unknown, reason: string) => {
    if (!correcting) return
    setWriting(true)
    setWriteError(null)
    try {
      await canonicalApi.correctField(id, {
        path: correcting.path,
        value,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      setCorrecting(null)
      // RE-READ, never patch in place. The correction moves the tie-out, the
      // bottle-equivalents and every invariant; the gateway recomputes all of
      // them, and a client that edited its own copy would show a corrected
      // number beside verdicts that still graded the old one.
      await q.refetch()
    } catch (err) {
      setWriteError(messageFrom(err))
    } finally {
      setWriting(false)
    }
  }

  const tickField = async (path: string) => {
    setWriteError(null)
    try {
      await canonicalApi.verifyField(id, path)
      await q.refetch()
    } catch (err) {
      setWriteError(messageFrom(err))
    }
  }

  const degraded = useMemo(
    () =>
      doc
        ? degradedReasons({
            lineCount: doc.layer1.lines.length,
            intakeVerdict: res?.intake.verdict,
            intakeReason: res?.intake.reason,
          })
        : [],
    [doc, res],
  )

  // Every field whose provenance is worth a numbered footnote on paper. Built
  // from the envelopes themselves, so a printed sheet cannot cite a field the
  // screen does not carry.
  const footnotes = useMemo(() => {
    if (!doc) return []
    const out: { n: number; text: string }[] = []
    const push = (label: string, env: { source: string; page?: number | null; as_printed?: string | null }) =>
      out.push({
        n: out.length + 1,
        text: `${label} — ${sourceSentence(env.source, env.page, env.as_printed)}`,
      })
    push('Document number', doc.layer1.documentNumber)
    push('Issue date', doc.layer1.issueDate)
    if (doc.layer1.seller.vatIdentifier.value)
      push('Seller VAT identifier', doc.layer1.seller.vatIdentifier)
    doc.layer1.lines.forEach((l, i) => push(`Unit price, line ${i + 1}`, l.netPrice))
    return out
  }, [doc])

  const shell = (children: React.ReactNode) => (
    <div
      className="mudavym cd-page"
      style={{
        background: 'var(--paper-1, #F3EFE6)',
        color: 'var(--ink-1, #211C16)',
        fontFamily: SANS,
        minHeight: '100%',
      }}
    >
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '18px 22px 40px' }}>
        <header
          className="cd-no-print"
          style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}
        >
          <Wordmark />
          <button
            type="button"
            onClick={() => navigate('/receipts')}
            style={{
              marginLeft: 'auto',
              fontSize: 11.5,
              fontWeight: 600,
              color: 'var(--seal-deep, #14515C)',
              background: 'none',
              border: 0,
              cursor: 'pointer',
            }}
          >
            ← Back to the documents
          </button>
        </header>
        {children}
      </div>
    </div>
  )

  if (q.isLoading) return shell(<p style={{ fontSize: 12 }}>Reading the document…</p>)

  if (q.isError || !res || !doc)
    return shell(
      <section
        role="alert"
        data-testid="canonical-error"
        style={{
          border: '1px solid rgba(176,54,44,.4)',
          background: 'rgba(176,54,44,.06)',
          borderRadius: 10,
          padding: '12px 14px',
        }}
      >
        <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 17, fontWeight: 600 }}>
          This document could not be read.
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 11.5 }}>
          Nothing is shown below on purpose. An empty sheet here would read as a
          document with no lines on it, and that is a different fact from a read
          that failed.
        </p>
        <p style={{ margin: '4px 0 0', fontFamily: MONO, fontSize: 10.5 }}>
          {(q.error as { message?: string } | null)?.message ?? 'the request did not complete'}
        </p>
        <button
          type="button"
          onClick={() => q.refetch()}
          style={{
            marginTop: 8,
            fontSize: 11.5,
            fontWeight: 600,
            padding: '4px 11px',
            borderRadius: 7,
            border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
            background: 'transparent',
            color: 'var(--seal-deep, #14515C)',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </section>,
    )

  const states = (res.deliveries ?? []).map((d) => d.state)
  const doorDelivery = (res.deliveries ?? []).find((d) =>
    d.documents.some((doc2) => doc2.role === 'door_count'),
  )
  const showDoorTab = doc.docType === 'receiving_advice' || !!doorDelivery

  return shell(
    <>
      {/* Things that are true of this READ, not of the document. */}
      {res.notes?.length ? (
        <p
          data-testid="read-notes"
          style={{
            fontSize: 10.5,
            lineHeight: 1.4,
            color: 'var(--ink-2, #4F473C)',
            border: '1px dashed var(--paper-2, #EAE4D8)',
            borderRadius: 8,
            padding: '6px 10px',
            marginBottom: 8,
          }}
        >
          {res.notes.join(' ')}
        </p>
      ) : null}

      {res.failedRead?.length ? (
        <p
          role="alert"
          data-testid="failed-read"
          style={{
            fontSize: 10.5,
            color: '#8A2F27',
            border: '1px solid rgba(176,54,44,.4)',
            borderRadius: 8,
            padding: '6px 10px',
            marginBottom: 8,
          }}
        >
          Part of this page could not be read: {res.failedRead.join(' · ')}
        </p>
      ) : null}

      {/* A write that failed says so ONCE, at the top, in the gateway's words —
          and stays until the next attempt, because a toast that has faded is
          indistinguishable from a correction that landed. */}
      {writeError && (
        <p
          data-testid="write-error"
          role="alert"
          style={{
            margin: '0 0 8px',
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid rgba(176,54,44,.35)',
            background: 'rgba(176,54,44,.06)',
            fontSize: 11.5,
            color: '#B0362C',
          }}
        >
          {writeError}
        </p>
      )}

      {/* ADR 0104 D5 — the log could not be READ. The sheet then offers no
          correction handles, and this says why rather than letting the absence
          of the affordance read as "this document cannot be corrected". */}
      {res.corrections === null && (
        <p
          data-testid="corrections-unreadable"
          style={{ margin: '0 0 8px', fontSize: 11.5, color: '#946612' }}
        >
          The correction history could not be read, so corrections are turned off on this
          screen. Nothing is missing from the document itself — but a field could otherwise
          be “corrected” twice by two people who each believed they were the first.
        </p>
      )}

      {/* B on top — the verdict, before anything else. */}
      <VerdictBlock doc={doc} states={states} />

      {/* C's spine — collapsed at ≤ 2 documents, absent at none. */}
      <div style={{ marginTop: 10 }}>
        <DeliverySpine
          deliveries={res.deliveries}
          failedRead={res.failedRead}
          selectedDocumentId={doc.documentId}
          onOpenDocument={(other) => navigate(`/documents/${other}`)}
        />
      </div>

      {showDoorTab && (
        <div className="cd-no-print" style={{ display: 'flex', gap: 8, margin: '10px 0 0' }}>
          {(['sheet', 'door'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 7,
                border: '1px solid var(--paper-2, #EAE4D8)',
                background: tab === t ? 'var(--seal-tint, rgba(26,94,107,.10))' : 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: 'pointer',
              }}
            >
              {t === 'sheet' ? 'The sheet' : 'The door'}
            </button>
          ))}
        </div>
      )}

      {/* D6 — degraded before the sheet, so nobody reads an empty table as a
          complete document. */}
      {degraded.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <DegradedNotice
            reasons={degraded}
            verdict={res.intake.verdict}
            verdictReason={res.intake.reason}
            lineCount={doc.layer1.lines.length}
          />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 320px)',
          gap: 14,
          marginTop: 10,
          alignItems: 'start',
        }}
      >
        <div className="cd-scroll-x">
          {tab === 'sheet' ? (
            <CanonicalSheet
              doc={doc}
              selectedLine={selectedLine}
              onSelectLine={(i) => setSelectedLine(i)}
              corrections={res.corrections}
              onCorrect={(path, label) => {
                setWriteError(null)
                setCorrecting({ path, label })
              }}
              onVerify={(path) => void tickField(path)}
            />
          ) : (
            <DoorFrame doc={doc} />
          )}

          {/* A's footnote column. Hidden on screen (the hover carries it) and
              revealed by @media print, where a hover cannot exist. */}
          <div className="cd-footnotes" style={{ display: 'none' }}>
            {footnotes.map((f) => (
              <p key={f.n} style={{ margin: 0 }}>
                <sup style={{ fontFamily: MONO }}>{f.n}</sup> {f.text}
              </p>
            ))}
          </div>
        </div>

        <aside style={{ display: 'grid', gap: 10 }}>
          <OriginalPane
            documentId={doc.documentId}
            imageUrl={res.original.imageUrl}
            reason={res.original.reason}
            contentType={res.original.contentType}
            filename={res.original.filename}
            /* The route only signs a path it found, so a signed URL implies one
               existed; `filename` is what PaperPane uses to spot a PDF. */
            storagePath={res.original.imageUrl ? (res.original.filename ?? 'stored') : null}
            sourceChannel={res.intake.sourceChannel}
            fetchedAt={fetchedAt}
            onRefresh={() => void q.refetch()}
            refreshing={q.isFetching}
            selectedEnvelope={
              selectedLine != null ? doc.layer1.lines[selectedLine]?.netPrice : null
            }
            selectedLabel={
              selectedLine != null ? `Line ${selectedLine + 1}` : null
            }
          />

          {/* The provenance footer — what read this, and what it hashed to. */}
          <section
            style={{
              border: '1px solid var(--paper-2, #EAE4D8)',
              borderRadius: 10,
              padding: '8px 11px',
              fontSize: 10.5,
              color: 'var(--ink-2, #4F473C)',
            }}
          >
            <span
              style={{
                display: 'block',
                fontFamily: MONO,
                fontSize: 8,
                fontWeight: 600,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-3, #7C7365)',
              }}
            >
              Provenance
            </span>
            <p style={{ margin: '2px 0 0' }}>
              Arrived by {res.intake.sourceChannel ?? 'an unrecorded channel'} ·{' '}
              {res.intake.extractionModel
                ? `read by ${res.intake.extractionModel}`
                : 'no extraction model is recorded — either none ran, or nobody recorded which'}
              .
            </p>
            <p style={{ margin: '2px 0 0', fontFamily: MONO, fontSize: 9.5 }}>
              revision {doc.revision} · sha256 {res.intake.sha256?.slice(0, 8) ?? '—'}… ·{' '}
              {doc.jurisdiction ?? 'jurisdiction not set'}
            </p>
            <button
              type="button"
              className="cd-no-print"
              onClick={() => window.print()}
              style={{
                marginTop: 6,
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--seal-deep, #14515C)',
                background: 'none',
                border: 0,
                padding: 0,
                cursor: 'pointer',
              }}
            >
              Print this document
            </button>
          </section>
        </aside>
      </div>

      {correcting && (
        <CorrectionDialog
          path={correcting.path}
          label={correcting.label}
          envelope={envelopeAt(doc.layer1, correcting.path)}
          error={writeError}
          busy={writing}
          onCancel={() => {
            setCorrecting(null)
            setWriteError(null)
          }}
          onSubmit={(value, reason) => void recordCorrection(value, reason)}
        />
      )}
    </>,
  )
}

export default CanonicalDocumentPage
