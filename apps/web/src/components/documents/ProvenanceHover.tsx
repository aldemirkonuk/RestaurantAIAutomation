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

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CorrectionLogEntry, FieldEnvelope } from '../../services/api/canonical'
import { MONO, confidenceWord, correctionSentence, sourceSentence } from './canonical-format'

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
  /**
   * The layer-1 path this field is, e.g. `lines[3].netPrice`. Present only when
   * the field is correctable — the gateway holds the closed list, and a field
   * with no path here simply offers no correction affordance.
   */
  path?: string
  /** Every correction and tick on THIS field, newest first (ADR 0104 D5). */
  log?: CorrectionLogEntry[]
  /** Opens the correction form. Absent = this screen is read-only. */
  onCorrect?: (path: string, label: string) => void
  /** The per-field `verified_by` tick. Absent = read-only. */
  onVerify?: (path: string, label: string) => void
  /** Read from the document, so the log's stamps print in its own convention. */
  jurisdiction?: string | null
  currency?: string | null
}

export function ProvenanceHover({
  label,
  envelope,
  children,
  footnote,
  path,
  log,
  onCorrect,
  onVerify,
  jurisdiction,
  currency,
}: ProvenanceHoverProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const word = confidenceWord(envelope.confidence)
  /**
   * REACHABLE BY KEYBOARD (walk-through RECEIPTS-W30, 2026-10-01). Measured:
   * Tab from the field went to "Correct this", the field's blur closed the
   * popover, the focused button was unmounted, and focus fell to <body>. And a
   * mouse crossing the 4px gap below the field closed it before it arrived.
   * So: a popover that holds actions is a disclosure (a labelled group the
   * field expands), focus moving INSIDE it keeps it open, Escape closes it and
   * gives focus back to the field, and the gap is padding the pointer can cross.
   * A popover with nothing to press stays a tooltip.
   */
  const actionable = !!path && !!(onCorrect || onVerify)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  /** Set while Escape hands focus back to the field, so that focus does not reopen it. */
  const returningRef = useRef(false)
  const focusInsidePopover = () => {
    const a = typeof document === 'undefined' ? null : document.activeElement
    return !!a && a !== triggerRef.current && !!wrapRef.current?.contains(a)
  }
  /**
   * An action opens a dialog that gives focus back to whatever held it. The
   * button pressed is about to unmount, so the field holds it instead
   * (walk-through RECEIPTS-W31). The dialog then takes focus, and the field's
   * blur closes this popover.
   */
  const act = (fn: (path: string, label: string) => void, p: string) => {
    triggerRef.current?.focus()
    fn(p, label)
  }

  /*
   * KEPT INSIDE WHAT CLIPS IT (walk-through RECEIPTS-W36, 2026-10-01). The line
   * table scrolls inside its own box, and that box cuts off anything that hangs
   * past its edge. Measured: the line total's popover started at the field and
   * ran 260px right, so 181 of its 260px were hidden at 1600px and at 1024px,
   * and on a 375px phone "Correct this" was cut in half. On open it measures
   * the nearest box that clips it (or the screen), moves left just far enough
   * to fit, narrows if even that is not enough, and opens upward when there is
   * no room below. It stays inside the field's own markup, so hover, focus and
   * the keyboard behave exactly as before.
   */
  const popRef = useRef<HTMLSpanElement>(null)
  const [place, setPlace] = useState({ dx: 0, width: 260, up: false })
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!open || !wrap || typeof window === 'undefined') return
    let clip: HTMLElement | null = wrap.parentElement
    while (clip && clip !== document.body) {
      const cs = getComputedStyle(clip)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') break
      clip = clip.parentElement
    }
    const box =
      clip && clip !== document.body
        ? clip.getBoundingClientRect()
        : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight }
    const left = Math.max(box.left, 0)
    const right = Math.min(box.right, window.innerWidth)
    const r = wrap.getBoundingClientRect()
    const width = Math.max(0, Math.min(260, right - left))
    const dx = Math.max(left - r.left, Math.min(0, right - width - r.left))
    const h = popRef.current?.getBoundingClientRect().height ?? 0
    const up = r.bottom + h > box.bottom && r.top - h >= box.top
    setPlace((p) => (p.dx === dx && p.width === width && p.up === up ? p : { dx, width, up }))
    // Width in the deps: the height read above is at the previous width, so a
    // narrower box measures once more and then settles.
  }, [open, place.width])

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        // Never unmount the button the keyboard is standing on.
        if (!focusInsidePopover()) setOpen(false)
      }}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        setOpen(false)
        if (focusInsidePopover()) {
          returningRef.current = true
          triggerRef.current?.focus()
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={open && !actionable ? id : undefined}
        aria-expanded={actionable ? open : undefined}
        aria-controls={actionable && open ? id : undefined}
        aria-label={`Where ${label} came from`}
        onFocus={() => {
          if (returningRef.current) {
            returningRef.current = false
            return
          }
          setOpen(true)
        }}
        /**
         * OPENS, never toggles. A click focuses the button first, so a toggle
         * here would close the popover the focus had just opened — which is
         * exactly what a touch user does, and they would see nothing at all.
         * Blur (out of the whole field), Escape and mouse-leave close it.
         */
        onClick={() => setOpen(true)}
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
          ref={popRef}
          id={id}
          role={actionable ? 'group' : 'tooltip'}
          aria-label={actionable ? `Where ${label} came from` : undefined}
          className="cd-provenance-pop"
          data-place={place.up ? 'up' : 'down'}
          style={{
            position: 'absolute',
            zIndex: 20,
            // Padding, not margin: the pointer crosses it without leaving the field.
            ...(place.up ? { bottom: '100%', paddingBottom: 4 } : { top: '100%', paddingTop: 4 }),
            left: place.dx,
            width: place.width,
            display: 'block',
          }}
        >
          <span
            style={{
              display: 'block',
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
                color: 'var(--ink-4, #665D50)',
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

            {/* ADR 0104 D5 — the log, per field, in the popover that already
                explains where the number came from. A correction that is only
                visible on a separate audit screen is a correction nobody reads. */}
            {(log ?? []).map((entry) => (
              <span
                key={`${entry.revision}-${entry.correctedAt}`}
                data-testid="provenance-correction"
                style={{
                  display: 'block',
                  fontSize: 10.5,
                  marginTop: 3,
                  color: 'var(--ink-2, #4F473C)',
                }}
              >
                {correctionSentence(entry, jurisdiction, currency)}
                {entry.reason ? ` — ${entry.reason}` : ''}
              </span>
            ))}

            {path && (onCorrect || onVerify) && (
              <span
                className="cd-no-print"
                style={{ display: 'flex', gap: 10, marginTop: 5 }}
              >
                {onCorrect && (
                  <button
                    type="button"
                    data-testid="correct-field"
                    onMouseDown={(e) => {
                      // MOUSE DOWN, not click: the popover closes on blur, and a
                      // click handler fires after the button below has already
                      // lost focus — so the affordance would appear and do
                      // nothing, which is worse than not offering it.
                      e.preventDefault()
                      act(onCorrect, path)
                    }}
                    // The keyboard: Enter and Space click with detail 0. A mouse
                    // click (detail >= 1) already acted on mouse-down above.
                    onClick={(e) => {
                      if (e.detail === 0) act(onCorrect, path)
                    }}
                    style={{
                      font: 'inherit',
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: 'var(--seal-deep, #14515C)',
                      background: 'none',
                      border: 0,
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    Correct this
                  </button>
                )}
                {onVerify && !envelope.verified_by && (
                  <button
                    type="button"
                    data-testid="verify-field"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      act(onVerify, path)
                    }}
                    // The keyboard: Enter and Space click with detail 0. A mouse
                    // click (detail >= 1) already acted on mouse-down above.
                    onClick={(e) => {
                      if (e.detail === 0) act(onVerify, path)
                    }}
                    style={{
                      font: 'inherit',
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: 'var(--ink-2, #4F473C)',
                      background: 'none',
                      border: 0,
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    I have checked this
                  </button>
                )}
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  )
}

export default ProvenanceHover
