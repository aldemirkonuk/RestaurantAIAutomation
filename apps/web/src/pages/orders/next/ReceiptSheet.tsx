/**
 * The receipt for one order, in a right Sheet (founder, 2026-09-22: "click a
 * line → that order's receipt in a right-corner sheet").
 *
 * The document drawn is the canonical Mudavym document — `/documents/:id`,
 * ADR 0104 D13 (sketch 089 direction C leading, A's typeset sheet as the
 * frame) — mounted as it is, not re-laid out for the sheet. The order does not
 * carry a document id; the gateway's deliveries that fulfil the order do, so
 * the sheet asks for those (`deliveriesApi.receiptForOrder`).
 *
 * Three states, kept apart: a receipt, no receipt, and a read that failed. The
 * last is never shown as the second.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { apiClient, getErrorMessage, isUnconfirmedWrite } from '@/services/api/client';
import { deliveriesApi } from '@/services/api/deliveries';
import { queryKeys } from '@/lib/query-keys';
import { CanonicalDocumentPage } from '../../documents/next/CanonicalDocumentPage';
import { SANS } from './format';
import type { OrderRowVM } from './useOrdersNextData';

export const NO_RECEIPT_SENTENCE = 'No receipt has been attached to this order yet.';

export const CLOSE_SHORT_DONE =
  'Closed. The bottles that came stay counted, and the rest is no longer expected.';

/**
 * Close a partly received order for good (F-104): the bottles that came stay
 * counted and the rest is no longer expected. Before this, nothing a person
 * could do moved a short delivery out of "partly received", so the order sat
 * open forever. Shown only when bottles are still owed and the delivery has
 * been checked against its invoice (F-826, `closeShortOwed`); the server checks
 * the same again with the role, and its refusal is shown in its own words.
 */
function CloseShort({ orderId, owed }: { orderId: string; owed: number }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const done = said?.ok === true;

  const submit = async () => {
    const why = reason.trim();
    if (!why) {
      setSaid({ text: 'Say why the rest is not coming before closing the order.', ok: false });
      return;
    }
    setBusy(true);
    setSaid(null);
    try {
      await apiClient.post(`/procurement/orders/${orderId}/close-short`, { reason: why });
      setSaid({ text: CLOSE_SHORT_DONE, ok: true });
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
    } catch (err) {
      setSaid({
        text: isUnconfirmedWrite(err)
          ? 'We could not tell whether the order was closed. Reload the page before trying again.'
          : getErrorMessage(err),
        ok: false,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="close-short"
      style={{ fontFamily: SANS, fontSize: 13, borderTop: '1px solid var(--paper-2, #EAE4D8)', paddingTop: 12, marginTop: 16 }}
    >
      <p style={{ color: 'var(--ink-2, #4F473C)', margin: '0 0 8px' }}>
        {owed} {owed === 1 ? 'bottle is' : 'bottles are'} still to come on this order. If they
        are not coming, close the order: the bottles that came stay counted, and nothing more is
        expected from the vendor.
      </p>
      {!done && (
        <>
          <label style={{ display: 'block', color: 'var(--ink-2, #4F473C)' }}>
            Why is the rest not coming?
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              disabled={busy}
              style={{ display: 'block', width: '100%', marginTop: 4, fontFamily: SANS, fontSize: 13 }}
            />
          </label>
          <button type="button" onClick={submit} disabled={busy} style={{ marginTop: 8 }}>
            {busy ? 'Closing…' : 'Close short'}
          </button>
        </>
      )}
      {said && (
        <p role={said.ok ? 'status' : 'alert'} style={{ margin: '8px 0 0' }}>
          {said.text}
        </p>
      )}
    </section>
  );
}

export interface ReceiptSheetProps {
  open: boolean;
  onClose: () => void;
  row: OrderRowVM;
}

export function ReceiptSheet({ open, onClose, row }: ReceiptSheetProps) {
  const q = useQuery({
    queryKey: ['order-receipt', row.id],
    queryFn: () => deliveriesApi.receiptForOrder(row.id),
    enabled: open,
    staleTime: 30_000,
  });

  const note = (text: string, role?: 'alert' | 'status') => (
    <p role={role} style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2, #4F473C)' }}>
      {text}
    </p>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      label={`The receipt for ${row.wineName ?? 'this order'}`}
      eyebrow="Receipt"
      title={row.wineName ?? 'This order'}
      closeLabel="Close"
    >
      <div data-testid="receipt-sheet">
        {q.isLoading
          ? note('Reading the receipt…', 'status')
          : q.isError
            ? note(
                'The receipt could not be read, so this does not say whether one exists.',
                'alert',
              )
            : q.data?.state === 'found'
              ? <CanonicalDocumentPage documentId={q.data.document.documentId} embedded />
              : note(NO_RECEIPT_SENTENCE, 'status')}
        {row.closeShortOwedBottles != null && (
          <CloseShort orderId={row.id} owed={row.closeShortOwedBottles} />
        )}
      </div>
    </Sheet>
  );
}

export default ReceiptSheet;
