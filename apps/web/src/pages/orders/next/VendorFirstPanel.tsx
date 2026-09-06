/**
 * "Add a vendor to place orders" — the owed guard on `/orders`.
 *
 * A question with two answers, so a Panel (census 102). It travels with the
 * new-order sheet: an order needs somebody to send it to, and a composer that
 * opens onto an empty vendor list is a dead end with a disabled button at the
 * bottom of it.
 *
 * TWO WAYS IN, AND THE SECOND IS THE ONE THAT MATTERS
 * ---------------------------------------------------
 *  1. BEFORE. The page knows the vendor list is empty and does not open the
 *     composer at all — the legacy desk's `openCreateOrderFlow` guard
 *     (`pages/Orders.tsx:296-302`), kept.
 *  2. AFTER. The gateway refuses the write with 403 `no_vendors`
 *     (`procurement.controller.ts:116-119`). The legacy desk caught exactly
 *     this and swapped the modals (`pages/Orders.tsx:1032-1041`), and it is the
 *     case a pre-flight read can never cover: the last vendor may be
 *     deactivated between the page loading and the order being placed.
 *
 * WHAT IT NEVER DOES. It never says "you have no vendors" when the vendor list
 * simply could not be READ. That state is a different sentence on the composer,
 * and this panel is not opened for it — an unreadable list drawn as an empty
 * one would send a person off to add a vendor they already have.
 */

import { useNavigate } from 'react-router-dom';
import { Panel } from '@/components/mudavym';
import { SANS } from './format';

export interface VendorFirstPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * Which way in. `refused` means the gateway turned a real write down, so the
   * panel says the order was NOT placed — the operator has to know that the
   * thing they pressed did not happen.
   */
  reason: 'before' | 'refused';
}

export function VendorFirstPanel({ open, onClose, reason }: VendorFirstPanelProps) {
  const navigate = useNavigate();

  return (
    <Panel
      open={open}
      onClose={onClose}
      /* The contract, as the accessible name. */
      label={
        reason === 'refused'
          ? 'The order was not placed: this house has no active vendor. This asks whether to go and add one. Leaving writes nothing and keeps the order you were writing.'
          : 'An order needs a vendor to send it to and this house has none. This asks whether to go and add one. Leaving writes nothing.'
      }
      eyebrow="Before an order"
      title="Add a vendor to place orders"
      closeLabel="Back to the order"
      footer={
        <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
          Nothing has been sent and nothing has been written.
        </span>
      }
    >
      <div style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2, #4F473C)' }}>
        <p data-testid="vendor-first-reason">
          {reason === 'refused'
            ? 'The order was not placed. The gateway refused it because this house has no active vendor — the one it was addressed to may have been deactivated since this page loaded. Nothing was written and the lines you wrote are still here.'
            : 'An order needs someone to send it to, and there is no vendor in the book yet. Add at least one distributor or supplier before writing an order.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="vendor-first-go"
            onClick={() => {
              onClose();
              navigate('/providers');
            }}
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 600,
              padding: '7px 14px',
              borderRadius: 3,
              border: '1px solid var(--seal, #1A5E6B)',
              background: 'var(--seal, #1A5E6B)',
              color: 'var(--paper-0, #FBF8F1)',
              cursor: 'pointer',
            }}
          >
            Go to the vendors
          </button>
        </div>
      </div>
    </Panel>
  );
}

export default VendorFirstPanel;
