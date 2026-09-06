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

import { useState } from 'react'
import { PaperPane } from '../../pages/receipts/next/ReceiptsNext'
import type { ProcurementDocument } from '../../services/api/documents'
import type { FieldEnvelope } from '../../services/api/canonical'
import { MONO } from './canonical-format'

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

  if (!open)
    return (
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
        <span style={{ fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
          {reason ??
            `${contentType ?? 'the stored file'} — fetched only when you ask, through a one-hour link.`}
        </span>
      </div>
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
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          The original · on demand
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Put the original away"
          style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--ink-3, #7C7365)' }}
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
