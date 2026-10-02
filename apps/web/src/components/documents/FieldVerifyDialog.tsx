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

import { HoldToApprove } from '../mudavym/HoldToApprove'
import { Panel } from '../mudavym/Sheet'
import { MONO } from './canonical-format'

export interface FieldVerifyDialogProps {
  /**
   * The field's key. Not shown: "seller.name" is the house's plumbing, not its
   * words (walk-through RECEIPTS-W33) — the label already names the field.
   */
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
  label,
  envelope,
  error,
  busy,
  onCancel,
  onChallenge,
  onConfirm,
}: FieldVerifyDialogProps) {
  const current = envelope?.value ?? null

  /*
   * THE HOUSE'S CENTRED PANEL (ADR 0112; walk-through RECEIPTS-W32, 2026-10-01).
   *
   * This dialog shipped on 2026-09-11 with `role="dialog" aria-modal="true"`, an
   * Escape handler on its own container, and no focus at all; the auditor gave
   * it Sheet's three parts by hand. Measured on 2026-10-01 it still let Tab out
   * at the second press and the page scroll behind the dim. `Panel` is the one
   * place focus, Tab, Escape, scroll lock, ground and motion live, so it now
   * carries all of them, and focus lands on Cancel — the control that writes
   * nothing — rather than on the hold that records a name for good.
   */
  return (
    <Panel
      open
      onClose={onCancel}
      label={`Confirm ${label}: holding records that you read it and stand behind it, permanently; leaving writes nothing.`}
      contract="This changes nothing about the value or where it came from. It records that you read it and stand behind it, permanently — which is why it takes a hold rather than a click."
      eyebrow="Stand behind one field"
      title={label}
      closeLabel="Cancel"
      className="cd-no-print"
      footer={
        <div data-testid="field-verify-submit">
          <HoldToApprove
            label={`Hold to stand behind ${label}`}
            approvedLabel={busy ? 'Recording…' : 'Checked'}
            disabled={!!busy}
            onChallenge={onChallenge}
            onApprove={(challenge) => onConfirm(challenge)}
          />
        </div>
      }
    >
      <div data-testid="field-verify-dialog" style={{ padding: '12px 16px 14px' }}>
        <p
          data-testid="field-verify-value"
          style={{ margin: 0, fontSize: 13, color: 'var(--ink-1, #211C16)' }}
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

        {error && (
          <p
            data-testid="field-verify-error"
            role="alert"
            style={{ margin: '8px 0 0', fontSize: 11, color: '#B0362C' }}
          >
            {error}
          </p>
        )}
      </div>
    </Panel>
  )
}

export default FieldVerifyDialog
