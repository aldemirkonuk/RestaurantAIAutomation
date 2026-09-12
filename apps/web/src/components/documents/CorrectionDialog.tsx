/**
 * CorrectionDialog — the value and the reason (ADR 0104 D5, slice 3).
 *
 * TWO FIELDS AND NOTHING ELSE. What the paper says, and why you are changing it.
 * The reason is not decoration: the correction log is what a vendor dispute is
 * argued from, and a log of "142,00 became 132,00" with no reasons is a change
 * history, not evidence.
 *
 * WHAT WAS THERE BEFORE IS ON SCREEN WHILE YOU TYPE. The old value and the
 * paper's own glyphs sit above the input, because the commonest correction is
 * "the extraction misread this" and the person needs to see both to be sure
 * which one is wrong.
 *
 * THE GATEWAY IS THE AUTHORITY ON THE TYPE. This dialog GUESSES whether the
 * field is numeric — from the value it currently holds, and from a short list of
 * paths for the case where it holds none — so the keyboard on a phone is the
 * right one. A wrong guess is not a silent failure: the gateway answers 400 with
 * a sentence naming the type, and that sentence is shown verbatim below. The
 * closed list of correctable fields lives in one place
 * (`apps/api-gateway/src/procurement/canonical/correctable-paths.ts`) and is not
 * copied here.
 *
 * "CLEAR THIS FIELD" IS A REAL ACTION. `null` means the document states nothing
 * here — the correction an extraction that invented a figure needs — and it is
 * deliberately reachable rather than requiring an empty string that would be
 * stored as one.
 */

import { useEffect, useRef, useState } from 'react'
import { MONO, SERIF } from './canonical-format'

/**
 * Paths whose field is a number when the document stated nothing there.
 *
 * Only consulted when the envelope holds no value to read a type off. It steers
 * a keyboard, never a write.
 */
const NUMERIC_SUFFIXES = [
  'quantity',
  'netPrice',
  'netAmount',
  'priceBaseQuantity',
  'vintage',
  'formatMl',
  'freeGoodsQty',
  'vatRate',
  'linesNetTotal',
  'taxAmount',
  'taxInclusiveAmount',
]

export interface CorrectionDialogProps {
  path: string
  label: string
  /**
   * Just the two parts this form shows. Deliberately narrower than
   * `FieldEnvelope`: the dialog has no business with `confidence` (never a
   * number on screen, ADR 0104 D4) or with the revision, so it cannot show them
   * by accident.
   */
  envelope: { value?: unknown; as_printed?: string | null } | null
  /** The gateway's own words when it refused. Shown verbatim. */
  error?: string | null
  busy?: boolean
  onCancel: () => void
  onSubmit: (value: unknown, reason: string) => void
}

export function CorrectionDialog({
  path,
  label,
  envelope,
  error,
  busy,
  onCancel,
  onSubmit,
}: CorrectionDialogProps) {
  const current = envelope?.value ?? null
  const numeric =
    typeof current === 'number' ||
    (current == null && NUMERIC_SUFFIXES.some((s) => path.endsWith(s)))

  const [text, setText] = useState(current == null ? '' : String(current))
  const [reason, setReason] = useState('')
  const [clearIt, setClearIt] = useState(false)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.focus()
  }, [])

  const submit = () => {
    if (clearIt) return onSubmit(null, reason)
    if (numeric) {
      const n = Number(text.replace(',', '.'))
      // A number the browser cannot read is NOT sent as 0. The gateway would
      // take it, and a silent zero on a price is the most expensive kind of
      // wrong there is.
      if (text.trim() === '' || !Number.isFinite(n)) return
      return onSubmit(n, reason)
    }
    onSubmit(text, reason)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Correct ${label}`}
      data-testid="correction-dialog"
      className="cd-no-print"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(33,28,22,.34)',
        padding: 16,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div
        style={{
          width: 380,
          maxWidth: '100%',
          background: 'var(--paper-0, #FFFDF8)',
          border: '1px solid var(--paper-2, #EAE4D8)',
          borderRadius: 14,
          padding: '14px 16px',
          boxShadow: '0 18px 50px rgba(33,28,22,.22)',
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          Correct one field
        </span>
        <h2 style={{ margin: '2px 0 6px', fontFamily: SERIF, fontSize: 16, fontWeight: 600 }}>
          {label}
        </h2>

        <p
          data-testid="correction-before"
          style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--ink-2, #4F473C)' }}
        >
          {current == null
            ? 'Nothing is recorded here now.'
            : `Now: ${String(current)}`}
          {envelope?.as_printed != null && (
            <>
              {' · '}
              the paper printed <span style={{ fontFamily: MONO }}>“{envelope.as_printed}”</span>
            </>
          )}
        </p>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>
          What it should say
          <input
            ref={first}
            data-testid="correction-value"
            value={text}
            disabled={clearIt}
            inputMode={numeric ? 'decimal' : 'text'}
            onChange={(e) => setText(e.target.value)}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 3,
              padding: '6px 8px',
              fontFamily: numeric ? MONO : 'inherit',
              fontSize: 13,
              border: '1px solid var(--paper-2, #EAE4D8)',
              borderRadius: 8,
              background: clearIt ? 'var(--paper-1, #F3EFE6)' : 'var(--paper-0, #FFFDF8)',
            }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 6,
            fontSize: 11,
            color: 'var(--ink-2, #4F473C)',
          }}
        >
          <input
            type="checkbox"
            data-testid="correction-clear"
            checked={clearIt}
            onChange={(e) => setClearIt(e.target.checked)}
          />
          The document states nothing here
        </label>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginTop: 8 }}>
          Why
          <textarea
            data-testid="correction-reason"
            value={reason}
            rows={2}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. the paper says 132,00 — the reader misread the 3"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 3,
              padding: '6px 8px',
              fontSize: 12,
              border: '1px solid var(--paper-2, #EAE4D8)',
              borderRadius: 8,
              background: 'var(--paper-0, #FFFDF8)',
              resize: 'vertical',
            }}
          />
        </label>

        {error && (
          <p
            data-testid="correction-error"
            role="alert"
            style={{ margin: '8px 0 0', fontSize: 11, color: '#B0362C' }}
          >
            {error}
          </p>
        )}

        <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--ink-3, #7C7365)' }}>
          This does not edit the document. It appends a new revision and keeps what was
          there before, permanently.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 11px',
              borderRadius: 8,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'transparent',
              color: 'var(--ink-2, #4F473C)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="correction-submit"
            onClick={submit}
            disabled={busy}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 11px',
              borderRadius: 8,
              border: 0,
              background: 'var(--seal, #1A5E6B)',
              color: '#FFFDF8',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Recording…' : 'Record the correction'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CorrectionDialog
