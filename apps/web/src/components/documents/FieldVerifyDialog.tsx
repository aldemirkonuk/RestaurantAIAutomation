/**
 * FieldVerifyDialog — the per-field tick, behind a hold (ADR 0104 D5).
 *
 * ---------------------------------------------------------------------------
 * WHY THE TICK LEFT THE POPOVER
 * ---------------------------------------------------------------------------
 * "I have checked this" used to be a button inside `ProvenanceHover`, and it
 * wrote on one press. Since 2026-09-11 (founder, batch 69: *"Seal corrections
 * and fields/verify too"*) it takes a redeemed seal, and a seal needs a hold —
 * which cannot live in that popover: the popover closes on mouse-leave and on
 * blur, so a control the person has to hold for two thirds of a second would
 * vanish under their thumb. The popover keeps the affordance and this dialog
 * carries the gesture, exactly as "Correct this" already opens
 * `CorrectionDialog`.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ON SCREEN IS WHAT IS SEALED
 * ---------------------------------------------------------------------------
 * The value is printed here, large, because that is the whole content of the
 * assertion: a tick says a human looked at THIS number and stands behind it.
 * The gateway binds the seal to that value, so a tick begun while the field read
 * 142,00 is refused after somebody corrects it to 132,00 — in words, naming what
 * changed, rather than silently putting a name against a figure nobody read.
 *
 * The paper's own glyphs sit beside it when we kept them. A tick is a claim
 * about a transcription, and the person confirming one needs both halves.
 *
 * NOTHING HERE CHANGES THE VALUE, and the sentence says so: the field's `source`
 * stays whatever it was. An extracted number a manager confirmed is still an
 * extracted number, now with a name against it.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { HoldToApprove } from '../mudavym/HoldToApprove'
import { MONO, SERIF } from './canonical-format'

export interface FieldVerifyDialogProps {
  path: string
  label: string
  /**
   * Just the two parts this form shows — the same narrowing `CorrectionDialog`
   * makes, and for the same reason: no confidence number ever reaches a screen
   * (ADR 0104 D4), so this cannot show one by accident.
   */
  envelope: { value?: unknown; as_printed?: string | null } | null
  /** The gateway's own words when it refused. Shown verbatim. */
  error?: string | null
  busy?: boolean
  onCancel: () => void
  /** Mint the seal for this tick, at the moment the hold begins. */
  onChallenge?: () => Promise<string | null>
  onConfirm: (challenge?: string | null) => void
}

export function FieldVerifyDialog({
  path,
  label,
  envelope,
  error,
  busy,
  onCancel,
  onChallenge,
  onConfirm,
}: FieldVerifyDialogProps) {
  const current = envelope?.value ?? null
  const panelRef = useRef<HTMLDivElement>(null)

  /*
   * FOCUS AND ESCAPE ARE `Sheet`'s, NOT `CorrectionDialog`'s (auditor,
   * 2026-09-11).
   *
   * This dialog shipped with `role="dialog" aria-modal="true"` and an `Escape`
   * handler on its own container, and focused nothing — and it is opened from a
   * button inside `ProvenanceHover`, which then unmounts. Focus fell to
   * `<body>`, the keydown never reached the container, and Escape did nothing
   * at all. `CorrectionDialog` has the same container-scoped handler and works
   * only because it happens to focus its first input on mount, which is the
   * accident rather than the design.
   *
   * `Sheet` (components/mudavym/Sheet.tsx) is the house's answer and says why in
   * its own words: *"an overlay whose Esc only works while focus is inside is an
   * overlay you can get stuck behind"*. Its three parts are mirrored here —
   * remember the opener before focus moves in, put focus on the first operable
   * control, listen for Escape on the WINDOW — rather than inventing a third
   * pattern. The full Sheet is not used because this dialog predates that
   * migration; moving it wholesale is a rebuild, not a defect fix.
   */
  useLayoutEffect(() => {
    const opener = (document.activeElement as HTMLElement | null) ?? null
    return () => {
      // A page that navigated away no longer holds the opener; focusing a
      // detached node silently sends focus to <body>, so check first.
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const first = panel.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    ;(first ?? panel).focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Confirm ${label}`}
      data-testid="field-verify-dialog"
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
    >
      <div
        ref={panelRef}
        tabIndex={-1}
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
          Stand behind one field
        </span>
        <h2 style={{ margin: '2px 0 6px', fontFamily: SERIF, fontSize: 16, fontWeight: 600 }}>
          {label}
        </h2>

        <p
          data-testid="field-verify-value"
          style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--ink-1, #211C16)' }}
        >
          {current == null ? (
            'This field records nothing.'
          ) : (
            <span style={{ fontFamily: MONO, fontSize: 15 }}>{String(current)}</span>
          )}
          {envelope?.as_printed != null && (
            <>
              {' · '}
              <span style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)' }}>
                the paper printed{' '}
                <span style={{ fontFamily: MONO }}>“{envelope.as_printed}”</span>
              </span>
            </>
          )}
        </p>

        <p style={{ margin: '0 0 8px', fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
          {path}
        </p>

        {error && (
          <p
            data-testid="field-verify-error"
            role="alert"
            style={{ margin: '8px 0 0', fontSize: 11, color: '#B0362C' }}
          >
            {error}
          </p>
        )}

        <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--ink-3, #7C7365)' }}>
          This changes nothing about the value or where it came from. It records that you
          read it and stand behind it, permanently — which is why it takes a hold rather
          than a click.
        </p>

        <div style={{ marginTop: 10 }} data-testid="field-verify-submit">
          <HoldToApprove
            label={`Hold to stand behind ${label}`}
            approvedLabel={busy ? 'Recording…' : 'Checked'}
            disabled={!!busy}
            onChallenge={onChallenge}
            onApprove={(challenge) => onConfirm(challenge)}
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

export default FieldVerifyDialog
