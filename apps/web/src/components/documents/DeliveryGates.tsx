/**
 * DeliveryGates — AGREED and VERIFIED, with the gate explained on screen.
 *
 * ADR 0103 D1 keeps the two apart and D6 makes both human. This component's job
 * is to make that legible BEFORE anyone presses anything:
 *
 *   AGREED    is about the DOCUMENT — both sides' positions are on the record,
 *             or this vendor's signed delivery ticket is final and one was
 *             signed. The screen says which of the two routes is available.
 *   VERIFIED  is about the GOODS and the BOOKS — a named person asserts they
 *             received them, and only from AGREED.
 *
 * THE SERVER'S REFUSAL IS SHOWN VERBATIM. When `agree` comes back 409 it names
 * exactly what is missing ("the vendor's position is not on the record — attach
 * the document they issued…"), and paraphrasing that into "cannot agree" would
 * throw away the only sentence that tells someone what to do next. Nothing here
 * re-implements D3: the gateway decides, this reports.
 *
 * WHAT A LAPSE SAYS. A LAPSED delivery prints what the LAW deems, in words, and
 * the sentence that inventory did not move — because a lapse is a measurable
 * failure of the venue's process (D9 clause 6) and the product must say so
 * rather than absorb it.
 */

import type { DeliveryEvent } from '../../services/api/deliveries'
import { MONO, SERIF, fmtStamp } from './canonical-format'

export interface DeliveryGatesProps {
  delivery: DeliveryEvent
  onAgree?: () => Promise<void>
  onVerify?: () => Promise<void>
  busy?: boolean
  /** The gateway's own words when it refused. Never paraphrased. */
  error?: string | null
}

const AGREE_RULES: Record<string, string> = {
  both_sides_recorded:
    'both sides were on the record and nothing was left open',
  signed_ticket_is_final:
    'the signed delivery ticket is final for this vendor, and one was signed at the door',
}

export function DeliveryGates({
  delivery,
  onAgree,
  onVerify,
  busy,
  error,
}: DeliveryGatesProps) {
  const agreed = !!delivery.agreedAt
  const verified = !!delivery.verifiedAt
  const lapsed = delivery.state === 'LAPSED' || delivery.state === 'LAPSED_AMENDED'

  return (
    <section
      data-testid="delivery-gates"
      aria-label="The two gates"
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 10,
        padding: '8px 11px',
        background: 'var(--paper-0, #FFFDF8)',
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
        Two gates, never one
      </span>

      {delivery.provenance === 'UNORDERED' && (
        <p
          data-testid="unordered-mark"
          style={{ margin: '3px 0 0', fontSize: 11, color: '#946612' }}
        >
          No order preceded this delivery. That mark is permanent — accepting it
          is a human decision, and reporting has to be able to say what share of
          spend was never ordered.
        </p>
      )}

      {lapsed && (
        <p
          data-testid="lapse-notice"
          style={{ margin: '3px 0 0', fontSize: 11, color: '#B0362C' }}
        >
          {delivery.lapseDeemed ??
            'A clock on this delivery expired and what the law deems was not recorded.'}{' '}
          Nothing was posted to inventory or cost.
          {delivery.amendedAt
            ? ' A later document has amended it; what was deemed on the lapse date still stands.'
            : ''}
        </p>
      )}

      <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
        <div>
          <h4 style={{ margin: 0, fontFamily: SERIF, fontSize: 12.5, fontWeight: 600 }}>
            Agreed — about the document
          </h4>
          <p style={{ margin: '1px 0 0', fontSize: 10.5, color: 'var(--ink-2, #4F473C)' }}>
            {agreed ? (
              <>
                Agreed {fmtStamp(delivery.agreedAt, delivery.jurisdiction)} because{' '}
                <strong data-testid="agreed-rule">
                  {AGREE_RULES[delivery.agreedRule ?? ''] ??
                    `the rule recorded is “${delivery.agreedRule ?? 'not recorded'}”`}
                </strong>
                .
              </>
            ) : (
              <>
                Needs the restaurant’s position AND the vendor’s on the record with
                nothing left open — or, where this vendor’s signed ticket is final,
                a signed door document. Vendor silence is never agreement here,
                whatever the law deems.
              </>
            )}
          </p>
          {!agreed && onAgree && (
            <button
              type="button"
              data-testid="agree-button"
              className="cd-no-print"
              disabled={busy}
              onClick={() => void onAgree()}
              style={primary}
            >
              {busy ? 'Checking the gate…' : 'Agree this delivery'}
            </button>
          )}
        </div>

        <div>
          <h4 style={{ margin: 0, fontFamily: SERIF, fontSize: 12.5, fontWeight: 600 }}>
            Verified — about the goods and the books
          </h4>
          <p style={{ margin: '1px 0 0', fontSize: 10.5, color: 'var(--ink-2, #4F473C)' }}>
            {verified ? (
              <>
                Verified {fmtStamp(delivery.verifiedAt, delivery.jurisdiction)} by a
                named person. Nothing was posted to inventory or cost by this step
                on this build.
              </>
            ) : agreed ? (
              'A named person asserts the goods arrived. This is not the same act as agreeing the document, and the two are never collapsed.'
            ) : (
              'Only an agreed delivery can be verified. Agreement is about the document; verification is about the goods.'
            )}
          </p>
          {agreed && !verified && onVerify && (
            <button
              type="button"
              data-testid="verify-button"
              className="cd-no-print"
              disabled={busy}
              onClick={() => void onVerify()}
              style={primary}
            >
              {busy ? 'Recording…' : 'I received these goods'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p
          data-testid="gate-error"
          role="alert"
          style={{ margin: '7px 0 0', fontSize: 11, color: '#B0362C' }}
        >
          {error}
        </p>
      )}
    </section>
  )
}

const primary: React.CSSProperties = {
  marginTop: 4,
  fontSize: 11.5,
  fontWeight: 600,
  padding: '4px 10px',
  borderRadius: 7,
  border: 0,
  background: 'var(--seal, #1A5E6B)',
  color: '#FFFDF8',
  cursor: 'pointer',
}

export default DeliveryGates
