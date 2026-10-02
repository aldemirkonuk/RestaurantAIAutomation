/**
 * OriginalPane — the original, fetched on demand (ADR 0104 D3).
 *
 * REUSES `PaperPane` from the receipts page rather than drawing a second viewer.
 * That component already distinguishes the four not-shown states from each other
 * — no file stored / stored but unsignable / the link aged out / the link failed
 * to load — and a second implementation would sooner or later report three of
 * them as the fourth. ADR 0104's consequence line is explicit that the receipts
 * pane and this page become the two faces of one component.
 *
 * ON DEMAND, NOT ON LOAD (D3). The pane is closed until a person asks for it:
 * the original lives in a private bucket behind a one-hour signed URL, and the
 * canonical document is meant to be enough on its own.
 *
 * A LINE CLICK MOVES THE BOX ONLY WHEN THERE IS A BOX. The envelope carries
 * `bbox` when the extractor kept one. When it did not, the pane says "no
 * position kept" — it never highlights an approximate rectangle, which would be
 * a fabricated citation of the paper.
 */

import { useState, type ReactNode } from 'react'
import { PaperPane } from '../../pages/receipts/next/ReceiptsNext'
import type { ProcurementDocument } from '../../services/api/documents'
import type { FieldEnvelope } from '../../services/api/canonical'
import { MONO } from './canonical-format'

/**
 * The stored file in words, not as a MIME type (walk-through W22,
 * 2026-10-01: "application/pdf — fetched only when you ask" read as machine
 * output).
 */
function fileKind(contentType: string | null | undefined): string {
  if (!contentType) return 'The stored file'
  if (contentType === 'application/pdf') return 'A PDF'
  if (contentType.startsWith('image/')) return 'A photo'
  return 'The stored file'
}

export interface OriginalPaneProps {
  documentId: string
  imageUrl: string | null
  /** Why there is no link, when there is none. */
  reason: string | null
  contentType: string | null
  filename: string | null
  storagePath: string | null
  sourceChannel: string | null
  /** When the response was read, so the pane can age the link out. */
  fetchedAt: number
  onRefresh: () => void
  refreshing: boolean
  /** The envelope of the line the sheet has selected, for the bbox note. */
  selectedEnvelope?: FieldEnvelope<unknown> | null
  selectedLabel?: string | null
}

/** The gateway's reason when no file was ever stored (`signOriginal`). */
const NOTHING_STORED = /^no original was stored/i

/**
 * A NAMED BOX, LIKE THE PROVENANCE UNDER IT (walk-through W11, 2026-10-01).
 * The founder: "every component and detail can be read easily … clear
 * divisions". Closed, the original was a loose sentence between the sheet and
 * the provenance box; it now carries the same border and label.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="The original"
      style={{ border: '1px solid var(--paper-2, #EAE4D8)', borderRadius: 10, padding: '8px 11px' }}
    >
      <span
        style={{
          display: 'block',
          fontFamily: MONO,
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-4, #665D50)',
          marginBottom: 4,
        }}
      >
        The original
      </span>
      {children}
    </section>
  )
}

export function OriginalPane({
  documentId,
  imageUrl,
  reason,
  contentType,
  filename,
  storagePath,
  sourceChannel,
  fetchedAt,
  onRefresh,
  refreshing,
  selectedEnvelope,
  selectedLabel,
}: OriginalPaneProps) {
  const [open, setOpen] = useState(false)

  // PaperPane reads a `ProcurementDocument`; this is the same document, shaped
  // for it. Only the fields it actually reads are supplied.
  const asDocument = {
    id: documentId,
    imageUrl,
    storage_path: storagePath,
    filename,
    source_channel: sourceChannel ?? '',
  } as unknown as ProcurementDocument

  // NOTHING TO BRING (walk-through W8, 2026-10-01). With no signed link the
  // button opened a pane that always said "No file was stored", even when a
  // file exists and only its link failed. So no button: the gateway's own
  // reason is the sentence, and a failure that may pass offers "Try again".
  if (!open && !imageUrl) {
    const why = reason ?? 'the original cannot be shown here'
    return (
      <Frame>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} data-testid="original-unavailable">
          <span style={{ fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
            {why.charAt(0).toUpperCase() + why.slice(1)}.
          </span>
          {!NOTHING_STORED.test(why) && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: '4px 11px',
                borderRadius: 7,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: refreshing ? 'progress' : 'pointer',
              }}
            >
              {refreshing ? 'Asking again…' : 'Try again'}
            </button>
          )}
        </div>
      </Frame>
    )
  }

  if (!open)
    return (
      <Frame>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            data-testid="open-original"
            onClick={() => setOpen(true)}
            style={{
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
            Bring the original
          </button>
          <span style={{ fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
            {reason ?? `${fileKind(contentType)}, fetched only when you ask, through a link that lasts one hour.`}
          </span>
        </div>
      </Frame>
    )

  return (
    <div data-testid="original-pane">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: '.13em',
            textTransform: 'uppercase',
            color: 'var(--ink-4, #665D50)',
          }}
        >
          The original · on demand
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Put the original away"
          style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--ink-4, #665D50)' }}
        >
          ×
        </button>
      </div>

      <PaperPane
        doc={asDocument}
        detailKnown
        fetchedAt={fetchedAt}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />

      {selectedLabel && (
        <p style={{ margin: '5px 0 0', fontSize: 10.5, color: 'var(--ink-2, #4F473C)' }}>
          {selectedEnvelope?.bbox
            ? `${selectedLabel} — page ${selectedEnvelope.page ?? '?'}, boxed on the scan.`
            : `${selectedLabel} — no position kept on the original, so nothing is boxed. The value is still traceable through its provenance.`}
        </p>
      )}
    </div>
  )
}

export default OriginalPane
