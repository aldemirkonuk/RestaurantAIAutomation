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
 *
 * THE SUBMIT IS A HOLD, AND THE SEAL IS MINTED WHEN IT BEGINS (founder,
 * 2026-09-11, batch 69: *"Seal corrections and fields/verify too"*). A
 * correction appends revision n+1 carrying the whole corrected document to a
 * pair of tables that refuse UPDATE and DELETE by trigger, so it cannot be taken
 * back — and the gateway now refuses it without a redeemed seal. The value the
 * hold was begun over is CAPTURED at that moment and is what gets sent, so the
 * thing sealed and the thing written are the same by construction rather than by
 * timing: the keyboard path arms on Enter and commits on a second Enter up to
 * three seconds later, and a person can type in between.
 */

import { useEffect, useRef, useState } from 'react'
import { HoldToApprove } from '../mudavym/HoldToApprove'
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
  /**
   * Mint the seal for THIS correction, at the moment the hold begins.
   *
   * It takes the value because the seal is taken over the correction about to be
   * made, not over the field in general. If it resolves null or throws, the hold
   * does not approve and nothing is sent — `HoldToApprove` says so in its own
   * words. Absent = no seal is minted and the gateway's refusal is what the
   * person reads, which is the honest outcome rather than a silent unsealed post.
   */
  onChallenge?: (value: unknown) => Promise<string | null>
  onSubmit: (value: unknown, reason: string, challenge?: string | null) => void
}

export function CorrectionDialog({
  path,
  label,
  envelope,
  error,
  busy,
  onCancel,
  onChallenge,
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
  /**
   * The value the HOLD was begun over.
   *
   * Read once when the gesture starts and sent unchanged when it completes, so
   * what the seal was minted over and what is posted are the same object. The
   * two moments are genuinely apart — the keyboard path arms on Enter and
   * commits on a second Enter up to three seconds later — and re-reading the
   * input at the write would mean sealing one figure and writing another.
   */
  const held = useRef<unknown>(null)

  useEffect(() => {
    first.current?.focus()
  }, [])

  /**
   * What would be sent, or why it cannot be read.
   *
   * A number the browser cannot read is NOT sent as 0 — the gateway would take
   * it, and a silent zero on a price is the most expensive kind of wrong there
   * is. It used to be a submit handler that returned and did nothing, which is a
   * button that looks alive and is not; behind a hold it disables the control
   * and says why instead.
   */
  const reading = (): { ok: true; value: unknown } | { ok: false; why: string } => {
    if (clearIt) return { ok: true, value: null }
    if (numeric) {
      const n = Number(text.replace(',', '.'))
      if (text.trim() === '')
        return { ok: false, why: 'Type the figure the paper prints, or tick "states nothing here".' }
      if (!Number.isFinite(n))
        return { ok: false, why: `“${text}” is not a number this field can take.` }
      return { ok: true, value: n }
    }
    return { ok: true, value: text }
  }

  const read = reading()

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
            color: 'var(--ink-4, #7C7365)',
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

        <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--ink-4, #7C7365)' }}>
          This does not edit the document. It appends a new revision and keeps what was
          there before, permanently — which is why it takes a hold rather than a click.
        </p>

        {!read.ok && (
          <p
            data-testid="correction-unreadable"
            style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--ink-2, #4F473C)' }}
          >
            {read.why}
          </p>
        )}

        <div style={{ marginTop: 10 }} data-testid="correction-submit">
          <HoldToApprove
            label={
              read.ok
                ? `Hold to seal this correction to ${label}`
                : 'Type a value this field can take'
            }
            approvedLabel={busy ? 'Recording…' : 'Correction sealed'}
            disabled={!!busy || !read.ok}
            onChallenge={
              onChallenge
                ? () => {
                    const now = reading()
                    if (!now.ok) return Promise.resolve(null)
                    held.current = now.value
                    return onChallenge(now.value)
                  }
                : undefined
            }
            onApprove={(challenge) =>
              onSubmit(
                // The value the hold was begun over when a seal was minted;
                // otherwise whatever the form reads now, which is the unsealed
                // path the gateway refuses in words.
                onChallenge ? held.current : (reading() as { value: unknown }).value,
                reason,
                challenge,
              )
            }
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
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
        </div>
      </div>
    </div>
  )
}

export default CorrectionDialog
