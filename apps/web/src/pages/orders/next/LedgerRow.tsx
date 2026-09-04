/**
 * One line of the order ledger.
 *
 * Motion contract (MOTIONS.md):
 * - expand/collapse is the `settle` token on grid-template-rows 0fr→1fr, and
 *   the chevron turns on the same token — one curve, one duration, one event;
 * - the expanded body shows the working for the total (qty × unit price, and
 *   the server's listed total when the two disagree — a disagreement is said,
 *   never averaged away);
 * - approving is the ceremony: HoldToApprove completing into the Seal landing
 *   on the stamp spring, wired to the REAL approve mutation. A refusal from
 *   the gateway is stated in place and the die resets — the row never
 *   pretends.
 *
 * Marking delivered is deliberately NOT a ceremony — the house spends its wax
 * on approval only; delivery confirmation is a plain button on `ink`.
 */

import { useState } from 'react';
import { HoldToApprove } from '@/components/mudavym';
import { ink, settle } from '@/lib/mudavym/motion';
import { useApproveOrder, useMarkOrderDelivered } from '@/hooks/queries/useOrderQueries';
import { EM, MONO, SANS, SERIF, fmtDate, fmtMoney } from './format';
import { STAGE_LABEL, type ApprovalGateRow, type OrderRowVM } from './useOrdersNextData';

export interface LedgerRowProps {
  row: OrderRowVM;
  expanded: boolean;
  onToggle: () => void;
  /** Bulk selection — only offered on pending rows. */
  selected: boolean;
  onSelectChange: (next: boolean) => void;
  /** True while a bulk run is executing, so per-row dies stay quiet. */
  bulkRunning: boolean;
  /**
   * This house's approval verdict for this row, from
   * `GET /procurement/order-approval-gate`.
   *
   * `undefined` means the gate has not answered — not "unrestricted". The
   * ceremony renders exactly as it did before ADR 0116 in that case, and the
   * gateway still refuses independently, which the row prints.
   */
  approval?: ApprovalGateRow;
  /** Why the gate could not be read. Said in words above the ceremony. */
  approvalGateError?: string | null;
}

const label = (text: string) => (
  <span
    style={{
      fontFamily: MONO,
      fontSize: 9,
      fontWeight: 500,
      letterSpacing: '0.12em',
      textTransform: 'uppercase' as const,
      color: 'var(--ink-3, #7C7365)',
    }}
  >
    {text}
  </span>
);

export function LedgerRow({
  row,
  expanded,
  onToggle,
  selected,
  onSelectChange,
  bulkRunning,
  approval,
  approvalGateError,
}: LedgerRowProps) {
  const approve = useApproveOrder();
  const deliver = useMarkOrderDelivered();
  // Bumped after a refused approval so the die (HoldToApprove) remounts armed.
  const [attempt, setAttempt] = useState(0);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [deliverError, setDeliverError] = useState<string | null>(null);

  const isPendingStage = row.stage === 'pending' && !row.recurring;
  // A verdict the gate actually gave. `undefined` is "not answered", which must
  // never disable the ceremony — the page is a courtesy, the gateway is the gate.
  const heldForApproval = approval ? !approval.mayApprove : false;
  const disagreement =
    row.listedTotal !== null &&
    row.computedTotal !== null &&
    Math.abs(row.listedTotal - row.computedTotal) > 0.005;

  const onApprove = () => {
    setApproveError(null);
    approve.mutate(row.id, {
      onError: (err) => {
        // Since ADR 0116 a refusal's `message` IS the explanation — which rule
        // fired, what the number was, who may sign (`services/api/orders.ts`
        // promotes the 403 body onto it). Wrapping that in "The gateway refused
        // (…)" would bury a sentence written to be read. A 403 is printed
        // verbatim; anything else keeps the old framing, because a network
        // error's message is not an explanation of anything.
        const status = (err as { response?: { status?: number } })?.response?.status;
        const msg = (err as { message?: string })?.message ?? 'request failed';
        setApproveError(
          status === 403
            ? msg
            : `The gateway refused (${msg}) — still pending, nothing approved.`,
        );
        setAttempt((a) => a + 1);
      },
    });
  };

  const onDeliver = () => {
    setDeliverError(null);
    deliver.mutate(
      { orderId: row.id },
      {
        onError: (err) => {
          const msg = (err as { message?: string })?.message ?? 'request failed';
          setDeliverError(`Not recorded — the gateway refused (${msg}).`);
        },
      },
    );
  };

  return (
    <div
      style={{
        borderBottom: '1px solid var(--paper-2, #EAE4D8)',
        background: expanded ? 'var(--paper-1, #F3EFE6)' : 'transparent',
        transition: `background ${settle.ms}ms ${settle.easing}`,
      }}
    >
      <div className="flex items-center gap-3 px-3">
        {isPendingStage ? (
          <input
            type="checkbox"
            aria-label={`Select ${row.wineName ?? 'order'} for bulk approval`}
            checked={selected}
            onChange={(e) => onSelectChange(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            style={{ accentColor: 'var(--seal, #1A5E6B)', width: 14, height: 14, flex: 'none' }}
          />
        ) : (
          <span aria-hidden style={{ width: 14, flex: 'none' }} />
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex flex-1 items-baseline gap-3 py-2.5 text-left"
          style={{ fontFamily: SANS, cursor: 'pointer', minWidth: 0 }}
        >
          <span className="min-w-0 flex-1">
            <span
              className="block truncate"
              style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}
            >
              {row.wineName ?? EM}
            </span>
            <span className="block truncate" style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
              {row.providerName ?? EM}
              {row.recurring ? ` · ${row.recurrenceLabel}` : ''}
            </span>
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: row.stage === 'pending' ? 'var(--seal, #1A5E6B)' : 'var(--ink-3, #7C7365)',
              border: `1px solid ${row.stage === 'pending' ? 'var(--seal-ring, rgba(26,94,107,.32))' : 'var(--paper-2, #EAE4D8)'}`,
              borderRadius: 3,
              padding: '2px 6px',
              flex: 'none',
            }}
          >
            {row.stage === 'cancelled' ? 'Cancelled' : STAGE_LABEL[row.stage]}
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 13,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--ink-1, #211C16)',
              flex: 'none',
              minWidth: 84,
              textAlign: 'right',
            }}
          >
            {fmtMoney(row.total)}
          </span>
          <span
            aria-hidden
            style={{
              flex: 'none',
              color: 'var(--ink-3, #7C7365)',
              fontSize: 11,
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: `transform ${settle.ms}ms ${settle.easing}`,
            }}
          >
            ›
          </span>
        </button>
      </div>

      {/* row expand = settle: 0fr→1fr, same token as the chevron above */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition: `grid-template-rows ${settle.ms}ms ${settle.easing}`,
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div className="grid gap-4 px-10 pb-4 pt-1 sm:grid-cols-[1fr_auto]" style={{ fontFamily: SANS }}>
            {/* the working — how the total is arrived at, stated in full */}
            <div>
              {label('The working')}
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 12.5,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--ink-2, #4F473C)',
                  marginTop: 4,
                  lineHeight: 1.7,
                }}
              >
                <div>
                  {row.quantity !== null ? row.quantity : EM} × {fmtMoney(row.unitPrice)}
                  <span style={{ color: 'var(--ink-3, #7C7365)' }}> = </span>
                  <span style={{ color: 'var(--ink-1, #211C16)', fontWeight: 600 }}>
                    {fmtMoney(row.computedTotal ?? row.listedTotal)}
                  </span>
                </div>
                {disagreement && (
                  <div style={{ color: 'var(--seal-deep, #14515C)' }}>
                    the ledger lists {fmtMoney(row.listedTotal)} — the two disagree; the listed figure is
                    what will be spent
                  </div>
                )}
                <div style={{ color: 'var(--ink-3, #7C7365)' }}>
                  requested {fmtDate(row.requestedAt)} · approved {fmtDate(row.approvedAt)} · delivered{' '}
                  {fmtDate(row.deliveredAt)}
                </div>
                <div style={{ color: 'var(--ink-3, #7C7365)' }}>
                  {row.orderNumber ? `no. ${row.orderNumber}` : `id ${row.id.slice(0, 8)}`}
                  {row.notes ? ` · ${row.notes}` : ''}
                </div>
              </div>
            </div>

            {/* the action column — one honest control per stage */}
            <div style={{ minWidth: 230 }}>
              {isPendingStage && (
                <>
                  {label(
                    heldForApproval
                      ? `Waiting on ${approval?.requiredRole === 'owner' ? 'an owner' : 'a manager'}`
                      : `Approve · ${row.providerName ?? 'vendor'}`,
                  )}
                  <div style={{ marginTop: 4 }}>
                    {/*
                      The ceremony is DISABLED, never hidden. A control that
                      disappears teaches nothing; a control that is visibly shut
                      with the rule beside it teaches who to ask.
                    */}
                    <HoldToApprove
                      key={`die-${row.id}-${attempt}`}
                      label={`Hold to approve · ${fmtMoney(row.total)}`}
                      approvedLabel="Approved"
                      disabled={bulkRunning || approve.isPending || heldForApproval}
                      onApprove={onApprove}
                    />
                  </div>
                  {heldForApproval && approval?.sentence && (
                    <p
                      style={{
                        marginTop: 5,
                        fontSize: 11,
                        lineHeight: 1.55,
                        color: 'var(--ink-2, #4F473C)',
                      }}
                      role="status"
                    >
                      {approval.sentence}
                    </p>
                  )}
                  {approval && approval.untestable.length > 0 && (
                    <p style={{ marginTop: 4, fontSize: 10.5, lineHeight: 1.5, color: 'var(--ink-3, #7C7365)' }}>
                      {approval.untestable.length === 1 ? 'One rule' : `${approval.untestable.length} rules`}{' '}
                      could not be tested on this order ({approval.untestable.join(', ')}), so{' '}
                      {approval.untestable.length === 1 ? 'it' : 'they'} did not fire. An
                      unknown is not a finding.
                    </p>
                  )}
                  {approvalGateError && (
                    <p style={{ marginTop: 4, fontSize: 10.5, lineHeight: 1.5, color: 'var(--ink-2, #4F473C)' }} role="status">
                      This house&rsquo;s approval rules could not be read ({approvalGateError}), so
                      nothing here says whether you may seal this. The gateway still decides, and
                      will say so if it refuses.
                    </p>
                  )}
                  {approveError && (
                    <p style={{ marginTop: 4, fontSize: 11, lineHeight: 1.55, color: 'var(--ink-2, #4F473C)' }} role="alert">
                      {approveError}
                    </p>
                  )}
                </>
              )}
              {row.stage === 'approved' && (
                <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', marginTop: 18 }}>
                  Sealed {fmtDate(row.approvedAt)} — the house places it with{' '}
                  {row.providerName ?? 'the vendor'}.
                </p>
              )}
              {row.stage === 'ordered' && (
                <>
                  {label('At the door?')}
                  <button
                    type="button"
                    onClick={onDeliver}
                    disabled={deliver.isPending}
                    style={{
                      display: 'block',
                      marginTop: 4,
                      width: '100%',
                      padding: '9px 14px',
                      borderRadius: 10,
                      border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                      background: 'var(--paper-0, #FAF7F1)',
                      color: 'var(--ink-1, #211C16)',
                      fontFamily: SANS,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: deliver.isPending ? 'default' : 'pointer',
                      opacity: deliver.isPending ? 0.6 : 1,
                      transition: `opacity ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing}`,
                    }}
                  >
                    {deliver.isPending ? 'Recording…' : 'Mark delivered'}
                  </button>
                  {deliverError && (
                    <p style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-2, #4F473C)' }} role="alert">
                      {deliverError}
                    </p>
                  )}
                </>
              )}
              {row.stage === 'delivered' && (
                <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', marginTop: 18 }}>
                  Delivered {fmtDate(row.deliveredAt)}. Verification lives on /receipts.
                </p>
              )}
              {row.stage === 'cancelled' && (
                <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', marginTop: 18 }}>
                  Cancelled — kept in the book, off the figures.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LedgerRow;
