/**
 * StockReturnNotice — whether a rejected or cancelled delivery's stock went
 * back, and a way to give it back when it did not (r30, the web half of r28
 * invoices G2).
 *
 * A rejection gives back what the delivery's door count put on the shelf. When
 * that fails the gateway (#1388) still closes the delivery, says why in the
 * answer's `stockReturn`, notifies the house once, and offers
 * `POST /procurement/deliveries/:id/return-stock` to try again. Before this the
 * page dropped `stockReturn` on the floor: the bottles stayed counted as stock
 * and nothing on screen said so.
 *
 * WHAT IT SAYS, AND WHEN.
 * - A failed return: the gateway's sentence, as an alert, and (for an owner or a
 *   manager) a button that tries again.
 * - A return that went: one sentence. No count is printed, because the
 *   gateway's `bottlesReturned` adds each good's quantity in that good's own
 *   unit (bottles, millilitres, grams), so the sum is not a number of anything.
 * - A rejected or cancelled delivery opened later, with no answer in hand (the
 *   notification's link lands here): a button to make sure, because the page
 *   cannot read whether the stock went. The gateway's return is safe to repeat:
 *   an item already given back moves nothing.
 * - Any other delivery: nothing.
 */

import type { StockReturn } from '../../services/api/deliveries'

export interface StockReturnNoticeProps {
  /** The delivery's state, as the event read it. */
  state: string
  /** The last answer about the return, or null when none is in hand. */
  stockReturn: StockReturn | null
  /** Whether this person may give the stock back (owner, manager, admin). */
  settlesMoney: boolean
  busy?: boolean
  onReturn?: () => Promise<void>
}

const CLOSED = new Set(['REJECTED', 'CANCELLED'])

export function StockReturnNotice({
  state,
  stockReturn,
  settlesMoney,
  busy,
  onReturn,
}: StockReturnNoticeProps) {
  if (!CLOSED.has(state) && !stockReturn) return null

  const button = (label: string) =>
    settlesMoney && onReturn ? (
      <button
        type="button"
        data-testid="stock-return-retry"
        className="cd-no-print"
        disabled={busy}
        onClick={() => void onReturn()}
        style={{
          marginTop: 4,
          fontSize: 11.5,
          fontWeight: 600,
          padding: '4px 10px',
          borderRadius: 7,
          border: 0,
          background: 'var(--seal, #1A5E6B)',
          color: '#FFFDF8',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Giving it back…' : label}
      </button>
    ) : null

  const box: React.CSSProperties = {
    marginTop: 10,
    border: '1px solid var(--paper-2, #EAE4D8)',
    borderRadius: 10,
    padding: '8px 11px',
    background: 'var(--paper-0, #FFFDF8)',
    fontSize: 11.5,
  }

  if (stockReturn && !stockReturn.returned)
    return (
      <section style={box} aria-label="The delivery's stock">
        <p
          data-testid="stock-return-failed"
          role="alert"
          style={{ margin: 0, color: '#B0362C' }}
        >
          {stockReturn.error}
        </p>
        {settlesMoney ? null : (
          <p style={{ margin: '3px 0 0', color: 'var(--ink-2, #4F473C)' }}>
            An owner or a manager can give it back from this page.
          </p>
        )}
        {button('Give the stock back')}
      </section>
    )

  if (stockReturn && stockReturn.returned)
    return (
      <section style={box} aria-label="The delivery's stock">
        <p data-testid="stock-return-done" role="status" style={{ margin: 0 }}>
          {stockReturn.bottlesReturned > 0
            ? 'What this delivery’s door count put on the shelf went back off it.'
            : 'Nothing of this delivery was left on the shelf, so nothing moved.'}
        </p>
      </section>
    )

  return (
    <section style={box} aria-label="The delivery's stock">
      <p data-testid="stock-return-unknown" style={{ margin: 0, color: 'var(--ink-2, #4F473C)' }}>
        This delivery is {state === 'CANCELLED' ? 'cancelled' : 'rejected'}, so what its door
        count put on the shelf should have gone back. This page cannot read whether it did.
      </p>
      {button('Make sure its stock went back')}
    </section>
  )
}

export default StockReturnNotice
