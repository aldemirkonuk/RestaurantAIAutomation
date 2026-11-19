/**
 * The receipt for one order (founder, 2026-09-22: "click a line → that
 * order's receipt in a right-corner sheet").
 *
 * The document drawn is the canonical Mudavym document — `/documents/:id`,
 * ADR 0104 D13 (sketch 089 direction C leading, A's typeset sheet as the
 * frame) — mounted as it is, not re-laid out for the sheet. The order does not
 * carry a document id; the gateway's deliveries that fulfil the order do, so
 * the sheet asks for those (`deliveriesApi.receiptForOrder`).
 *
 * Three states, kept apart: a receipt, no receipt, and a read that failed. The
 * last is never shown as the second.
 *
 * SHAPE FOLLOWS THE ANSWER (r61, c2 need 4). A receipt is a document, so it
 * gets the wide right sheet. "No receipt" and "could not be read" are one
 * sentence each, and a 640 x 900 wall for one sentence is the wrong size: they
 * are a 360 px popover pointing back at the control that was pressed. While the
 * read is out the sheet shows a paper that is not there yet, not a line of
 * words that flashes and goes.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type RefObject } from 'react';
import { Popover, Sheet } from '@/components/mudavym';
import { EmptyState } from '@/components/mudavym/EmptyState';
import { GhostDocument } from '@/components/mudavym/emptyArt';
import { deliveriesApi } from '@/services/api/deliveries';
import { CanonicalDocumentPage } from '../../documents/next/CanonicalDocumentPage';
import type { OrderRowVM } from './useOrdersNextData';

export const NO_RECEIPT_SENTENCE = 'No receipt has been attached to this order yet.';
export const RECEIPT_UNREAD_SENTENCE =
  'The receipt could not be read, so this does not say whether one exists.';

/** How long the read may take before the wide sheet opens with its ghost paper. */
export const RECEIPT_SHEET_DELAY_MS = 120;

/** The popover's width: 360. sheet.css caps it at the phone's width less its two 16 px gutters. */
export const RECEIPT_POPOVER_WIDTH = 360;

export interface ReceiptSheetProps {
  open: boolean;
  onClose: () => void;
  row: OrderRowVM;
  /** The control that opened it. Without one the small answers stay in a sheet. */
  anchorRef?: RefObject<HTMLElement | null>;
}

export function ReceiptSheet({ open, onClose, row, anchorRef }: ReceiptSheetProps) {
  const q = useQuery({
    queryKey: ['order-receipt', row.id],
    queryFn: () => deliveriesApi.receiptForOrder(row.id),
    enabled: open,
    staleTime: 30_000,
  });

  // With a control to point back at, nothing wide opens until the read has
  // either answered "found" or has taken longer than a blink: an answer of
  // "none" would otherwise flash a 640 px sheet and then swap it for the popover.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!open || !q.isLoading) {
      setSlow(false);
      return undefined;
    }
    const t = setTimeout(() => setSlow(true), RECEIPT_SHEET_DELAY_MS);
    return () => clearTimeout(t);
  }, [open, q.isLoading]);

  const label = `The receipt for ${row.wineName ?? 'this order'}`;
  const found = !q.isLoading && !q.isError && q.data?.state === 'found';
  const small = !q.isLoading && !found; // no receipt, or a read that failed
  const canPoint = !!anchorRef?.current;

  const answer = q.isError ? (
    <div role="alert" data-testid="receipt-unread">
      <EmptyState
        compact
        art="receipt"
        sentence={RECEIPT_UNREAD_SENTENCE}
        action={{ label: 'Try again', onClick: () => void q.refetch() }}
      />
    </div>
  ) : (
    <div role="status" data-testid="receipt-none">
      <EmptyState compact art="receipt" sentence={NO_RECEIPT_SENTENCE} />
    </div>
  );

  return (
    <>
      <Sheet
        open={open && (canPoint ? found || (q.isLoading && slow) : !small || !canPoint)}
        onClose={onClose}
        wide={!small}
        label={label}
        eyebrow="Receipt"
        title={row.wineName ?? 'This order'}
        closeLabel="Close"
      >
        <div data-testid="receipt-sheet">
          {q.isLoading ? (
            <div role="status" aria-label="Reading the receipt">
              <GhostDocument />
            </div>
          ) : found && q.data?.state === 'found' ? (
            <CanonicalDocumentPage documentId={q.data.document.documentId} embedded />
          ) : (
            answer
          )}
        </div>
      </Sheet>
      {canPoint && anchorRef ? (
        <Popover
          open={open && small}
          onClose={onClose}
          anchorRef={anchorRef}
          width={RECEIPT_POPOVER_WIDTH}
          label={label}
          eyebrow="Receipt"
          title={row.wineName ?? 'This order'}
          closeLabel="Close"
        >
          <div data-testid="receipt-popover">{answer}</div>
        </Popover>
      ) : null}
    </>
  );
}

export default ReceiptSheet;
