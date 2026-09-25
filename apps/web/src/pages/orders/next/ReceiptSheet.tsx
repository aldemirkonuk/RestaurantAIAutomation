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

import { useQuery } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { deliveriesApi } from '@/services/api/deliveries';
import { CanonicalDocumentPage } from '../../documents/next/CanonicalDocumentPage';
import { SANS } from './format';
import type { OrderRowVM } from './useOrdersNextData';

export const NO_RECEIPT_SENTENCE = 'No receipt has been attached to this order yet.';

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
      </div>
    </Sheet>
  );
}

export default ReceiptSheet;
