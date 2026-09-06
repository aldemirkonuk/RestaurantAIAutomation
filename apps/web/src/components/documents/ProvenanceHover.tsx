/**
 * ProvenanceHover — where one field's value came from (ADR 0104 D1, D13).
 *
 * Direction B's grammar, made explicit rather than typographic: B carried
 * provenance in the weight and colour of a number, which the ADR itself records
 * as "easy to miss". So the marker is a dotted underline the reader can see, the
 * detail is a real popover, and the same sentence prints as a footnote (A's
 * form) when the page is printed.
 *
 * NOTHING IS INVENTED HERE. When `as_printed` is null the popover says
 * "as printed: not kept" — it never re-renders our own parsed value as though
 * the paper had printed it, which would turn the provenance trail into a second
 * copy of our own answer.
 *
 * NO CONFIDENCE NUMBER, EVER (D4). A low-confidence read is a WORD
 * ("read with difficulty"); a null confidence prints nothing at all, because
 * EDI, a signed XML and a human typing genuinely have no notion of one.
 */

import { useId, useState, type ReactNode } from 'react'
import type { FieldEnvelope } from '../../services/api/canonical'
import { MONO, confidenceWord, sourceSentence } from './canonical-format'

export interface ProvenanceHoverProps {
  /** What this field IS, in words — "Unit price, line 4". */
  label: string
  envelope: Pick<
    FieldEnvelope<unknown>,
    'source' | 'confidence' | 'page' | 'as_printed' | 'verified_by' | 'verified_at'
  >
  children: ReactNode
  /** Footnote number, when the sheet is numbering its provenance (print). */
  footnote?: number
}

export function ProvenanceHover({
  label,
  envelope,
  children,
  footnote,
}: ProvenanceHoverProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const word = confidenceWord(envelope.confidence)

  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={`Where ${label} came from`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        /**
         * OPENS, never toggles. A click focuses the button first, so a toggle
         * here would close the popover the focus had just opened — which is
         * exactly what a touch user does, and they would see nothing at all.
         * Blur and mouse-leave are what close it.
         */
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        style={{
          font: 'inherit',
          color: 'inherit',
          background: 'none',
          border: 0,
          padding: 0,
          cursor: 'help',
          borderBottom: '1px dotted var(--seal, #1A5E6B)',
        }}
      >
        {children}
      </button>
      {footnote != null && (
        <sup
          className="cd-footnote-mark"
          style={{ fontFamily: MONO, fontSize: 8, color: 'var(--seal-deep, #14515C)' }}
        >
          {footnote}
        </sup>
      )}
      {open && (
        <span
          id={id}
          role="tooltip"
          className="cd-provenance-pop"
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            marginTop: 4,
            width: 260,
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid var(--paper-2, #EAE4D8)',
            background: 'var(--paper-0, #FFFDF8)',
            boxShadow: '0 6px 22px rgba(33,28,22,.10)',
            textAlign: 'left',
            whiteSpace: 'normal',
          }}
        >
          <span
            style={{
              display: 'block',
              fontFamily: MONO,
              fontSize: 8,
              fontWeight: 600,
              letterSpacing: '0.11em',
              textTransform: 'uppercase',
              color: 'var(--ink-3, #7C7365)',
            }}
          >
            Provenance · {label}
          </span>
          <span style={{ display: 'block', fontSize: 11.5, lineHeight: 1.35, marginTop: 2 }}>
            {sourceSentence(envelope.source, envelope.page, envelope.as_printed)}
          </span>
          {word && (
            <span
              style={{
                display: 'block',
                fontSize: 10.5,
                marginTop: 3,
                color: 'var(--ink-2, #4F473C)',
              }}
            >
              {word} — check it against the original.
            </span>
          )}
          {envelope.verified_by && (
            <span
              style={{
                display: 'block',
                fontSize: 10.5,
                marginTop: 3,
                color: 'var(--seal-deep, #14515C)',
              }}
            >
              Verified by {envelope.verified_by}
              {envelope.verified_at ? ` · ${envelope.verified_at.slice(0, 10)}` : ''}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

export default ProvenanceHover
