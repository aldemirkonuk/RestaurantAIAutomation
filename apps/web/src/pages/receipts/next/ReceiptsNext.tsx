/**
 * ReceiptsNext — the Mudavym redesign of `/receipts` (ADR 0045 §5 wave,
 * MAKEOVER-VERDICTS: KEEP+, "the most demanding brief in the set").
 *
 * The founder's four requirements, built:
 * 1. Everything from the orders is compressed into this surface — the
 *    review queue and the deliveries still WITHOUT paperwork share it.
 * 2. Backend integrated without overcrowding: one queue, one selected
 *    document, detail on demand.
 * 3. "Make sure it is the right invoice": the linked order rides above the
 *    lines, and the matcher's suggested pairings are shown with their
 *    plain-language reasons for one-tap confirmation — never auto-written.
 * 4. "We can edit, and we can just confirm it right away": qty / unit price
 *    / line total are editable in place (pre-verification only), the
 *    recomputed tie-out lands with the response, and confirmation is the
 *    swipe-up ceremony the founder named, asserting exactly what verify
 *    asserts: the transcription is faithful. Nothing here applies stock.
 *
 * Motions (06-pages/receipts.md §1b): swipe-up confirm (pour-rate fill,
 * tuck on early release); row settle for the doc open; ink micro-states.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wordmark } from '@/components/mudavym';
import {
  documentsApi,
  type ProcurementDocument,
  type ProcurementDocumentLine,
} from '../../../services/api/documents';
import { getOrder } from '../../../services/api/orders';
import { ink, settle } from '../../../lib/mudavym/motion';
import { EM, MONO, SANS, SERIF, fmtDate, fmtMoney, parseCell } from './rc2-format';
import { SwipeToConfirm } from './SwipeToConfirm';
import { useReceiptsNextData } from './useReceiptsNextData';

// The credit ledger has no Next lane yet; /credits lands here as
// ?tab=credits and must keep working with the flag ON (opus-correctness
// DEFECT 5) — that tab renders the legacy page until a credits lane exists.
const LegacyReceiptsPage = lazy(() =>
  import('../../ReceiptsPage').then((m) => ({ default: m.ReceiptsPage })),
);

const TYPE_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  packing_slip: 'Packing slip',
  delivery_receipt: 'Delivery receipt',
  credit_memo: 'Credit memo',
  purchase_order: 'Purchase order',
  statement: 'Statement',
  unknown: 'Document',
};

function TieOutLine({ doc }: { doc: ProcurementDocument }) {
  if (doc.ties_out === null)
    return (
      <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
        tie-out {EM} (no stated total to test against)
      </span>
    );
  if (doc.ties_out)
    return (
      <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--seal-deep, #14515C)' }}>
        ties out within tolerance
      </span>
    );
  return (
    <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
      off by {doc.tie_out_delta == null ? EM : fmtMoney(Math.abs(doc.tie_out_delta))}
    </span>
  );
}

/**
 * One editable money/number cell. Commits on blur or Enter; Escape reverts.
 * A non-nullable cell (qty) treats an emptied input as INVALID — silently
 * showing the unknown dash over a value the record still holds was the exact
 * false-unknown opus-honesty BLOCKER 1 describes. Locked cells are readOnly,
 * not disabled, so assistive tech can still reach the figures.
 */
function EditCell({
  value,
  ariaLabel,
  locked,
  nullable = true,
  onCommit,
}: {
  value: number | null;
  ariaLabel: string;
  locked: boolean;
  nullable?: boolean;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const shown = draft ?? (value == null ? '' : String(value));
  // The draft holds until the server round-trip moves `value` — clearing it
  // at commit time flashed the stale figure mid-flight (receipts-audit.md).
  useEffect(() => {
    setDraft(null);
  }, [value]);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseCell(draft);
    if (parsed === 'invalid' || (parsed === null && !nullable)) {
      setBad(true);
      return;
    }
    setBad(false);
    if (parsed !== value) onCommit(parsed);
    else setDraft(null);
  };
  return (
    <input
      aria-label={ariaLabel}
      aria-invalid={bad || undefined}
      value={shown}
      placeholder={EM}
      readOnly={locked}
      aria-readonly={locked || undefined}
      onChange={(e) => {
        setBad(false);
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(null);
          setBad(false);
        }
      }}
      style={{
        width: 72,
        fontFamily: MONO,
        fontSize: 11.5,
        textAlign: 'right',
        padding: '3px 6px',
        borderRadius: 6,
        border: bad
          ? '1px solid var(--ink-1, #211C16)'
          : '1px solid var(--paper-2, #EAE4D8)',
        background: locked ? 'transparent' : 'var(--paper-0, #FAF7F1)',
        color: 'var(--ink-1, #211C16)',
      }}
    />
  );
}

function DocView({ doc, onVerified }: { doc: ProcurementDocument; onVerified: () => void }) {
  const qc = useQueryClient();
  const detailQ = useQuery({
    queryKey: ['receipts-next', 'doc', doc.id],
    queryFn: () => documentsApi.detail(doc.id),
    staleTime: 30_000,
  });
  const orderQ = useQuery({
    queryKey: ['receipts-next', 'order', doc.order_id],
    queryFn: () => getOrder(doc.order_id!),
    enabled: !!doc.order_id,
    staleTime: 60_000,
  });
  const [matchResult, setMatchResult] = useState<Awaited<ReturnType<typeof documentsApi.match>> | null>(null);
  const [tieOut, setTieOut] = useState<{ tiesOut: boolean | null; tieOutDelta: number | null } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const editable = doc.status === 'needs_review' || doc.status === 'received';

  const edit = useMutation({
    mutationFn: (p: { lineId: string; patch: Record<string, number | null> }) =>
      documentsApi.editLine(doc.id, p.lineId, p.patch),
    onSuccess: (res) => {
      setEditError(null);
      setTieOut(res.tieOut);
      // Pairing suggestions were computed against the pre-edit lines — a
      // stale reason must not invite a stale confirmation.
      setMatchResult(null);
      qc.setQueryData(
        ['receipts-next', 'doc', doc.id],
        (cur: { document: ProcurementDocument; lines: ProcurementDocumentLine[]; links: unknown[] } | undefined) =>
          cur
            ? { ...cur, lines: cur.lines.map((l) => (l.id === res.line.id ? { ...l, ...res.line } : l)) }
            : cur,
      );
    },
    onError: (e) =>
      setEditError(e instanceof Error ? e.message : 'The correction did not save.'),
  });

  const runMatch = useMutation({
    mutationFn: () => documentsApi.match(doc.id),
    onSuccess: setMatchResult,
  });

  const confirmLink = useMutation({
    mutationFn: (p: { lineId: string; orderLineId: string }) =>
      documentsApi.linkLine(doc.id, p.lineId, p.orderLineId),
    onSuccess: (_res, p) => {
      setMatchResult((cur) =>
        cur ? { ...cur, suggested: cur.suggested.filter((s) => s.documentLineId !== p.lineId) } : cur,
      );
      void qc.invalidateQueries({ queryKey: ['receipts-next', 'doc', doc.id] });
    },
  });

  const verify = useMutation({
    mutationFn: () => documentsApi.verify(doc.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['receipts-next'] });
      onVerified();
    },
  });

  const shownTieOut: ProcurementDocument = tieOut ? { ...doc, ...tieOut, ties_out: tieOut.tiesOut, tie_out_delta: tieOut.tieOutDelta } : doc;

  return (
    <div
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 12,
        background: 'var(--paper-1, #F3EFE6)',
        padding: '18px 20px',
        animation: `rc-settle ${settle.ms}ms ${settle.easing} both`,
        fontFamily: SANS,
      }}
    >
      {/* the right invoice: what was ordered, above what the paper says */}
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--seal-deep, #14515C)',
            }}
          >
            {TYPE_LABELS[doc.doc_type] ?? doc.doc_type} · {doc.doc_number || EM} · {fmtDate(doc.doc_date)}
          </span>
          <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: '2px 0 0' }}>
            {doc.total == null ? 'No stated total' : fmtMoney(doc.total)}
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3, #7C7365)', marginLeft: 10 }}>
              <TieOutLine doc={shownTieOut} />
            </span>
          </h2>
          {doc.order_id ? (
            orderQ.data ? (
              <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '4px 0 0' }}>
                Against order {orderQ.data.orderNumber ?? doc.order_id.slice(0, 8)}
                {orderQ.data.providerName ? ` · ${orderQ.data.providerName}` : ''}
                {typeof (orderQ.data as { totalPrice?: number }).totalPrice === 'number'
                  ? ` · ordered ${fmtMoney((orderQ.data as { totalPrice?: number }).totalPrice ?? null)}`
                  : ''}
              </p>
            ) : orderQ.isError ? (
              <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '4px 0 0' }}>
                The linked order could not be read — the pairing is unverified, not wrong.
              </p>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)', margin: '4px 0 0' }}>
                Reading the linked order…
              </p>
            )
          ) : (
            <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '4px 0 0' }}>
              No order is linked to this document yet — pair it before trusting any line.
            </p>
          )}
        </div>
        {doc.imageUrl && (
          <a
            href={doc.imageUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
          >
            Open the paper ↗
          </a>
        )}
      </header>

      {/* the lines — editable in place while the document awaits review */}
      {detailQ.data === undefined ? (
        <p style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>Reading the lines…</p>
      ) : detailQ.data.lines.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
          No lines were extracted from this document.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3, #7C7365)' }}>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Line</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Unit</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Total</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Paired</th>
              </tr>
            </thead>
            <tbody>
              {detailQ.data.lines.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                  <td style={{ padding: '5px 6px', color: 'var(--ink-1, #211C16)', maxWidth: 260 }}>
                    {l.description || EM}
                    {l.vintage ? ` · ${l.vintage}` : ''}
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 6px' }}>
                    <EditCell
                      value={l.qty}
                      ariaLabel={`Quantity, line ${l.line_no}`}
                      locked={!editable}
                      nullable={false}
                      onCommit={(v) => v !== null && edit.mutate({ lineId: l.id, patch: { qty: v } })}
                    />
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 6px' }}>
                    <EditCell
                      value={l.unit_price}
                      ariaLabel={`Unit price, line ${l.line_no}`}
                      locked={!editable}
                      onCommit={(v) => edit.mutate({ lineId: l.id, patch: { unitPrice: v } })}
                    />
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 6px' }}>
                    <EditCell
                      value={l.line_total}
                      ariaLabel={`Line total, line ${l.line_no}`}
                      locked={!editable}
                      onCommit={(v) => edit.mutate({ lineId: l.id, patch: { lineTotal: v } })}
                    />
                  </td>
                  <td style={{ padding: '5px 6px', fontFamily: MONO, fontSize: 10, color: l.order_line_id ? 'var(--seal-deep, #14515C)' : 'var(--ink-3, #7C7365)' }}>
                    {l.order_line_id ? 'paired' : EM}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!editable && (
        <p style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', margin: '6px 0 0' }}>
          This document is verified — the record a dispute leans on. Lines are read-only.
        </p>
      )}
      {editError && (
        <p role="alert" style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
          {editError}
        </p>
      )}

      {/* the pairing check — suggestions carry their reasons, never auto-write */}
      <div className="mt-3 flex flex-wrap items-start gap-3">
        <button
          type="button"
          onClick={() => runMatch.mutate()}
          disabled={runMatch.isPending || !doc.order_id}
          className="rc-ink"
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '5px 12px',
            borderRadius: 8,
            border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
            background: 'transparent',
            color: doc.order_id ? 'var(--seal-deep, #14515C)' : 'var(--ink-3, #7C7365)',
            cursor: doc.order_id ? 'pointer' : 'not-allowed',
          }}
        >
          {runMatch.isPending ? 'Checking the pairing…' : 'Check line pairing'}
        </button>
        {!doc.order_id && (
          <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', alignSelf: 'center' }}>
            needs a linked order first
          </span>
        )}
        {matchResult && (
          <div style={{ flexBasis: '100%', fontSize: 12 }}>
            <p style={{ color: 'var(--ink-2, #4F473C)', margin: '2px 0 6px' }}>
              {matchResult.applied.length} paired with certainty · {matchResult.suggested.length} awaiting
              your confirmation · {matchResult.unmatchedDocumentLineIds.length} on the paper with no order
              line
            </p>
            {matchResult.suggested.map((s) => (
              <div key={s.documentLineId} className="flex flex-wrap items-center gap-2 py-1" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                <span style={{ color: 'var(--ink-2, #4F473C)' }}>
                  {s.reason}
                  {s.substitution ? ' — a substitution; accept it knowingly' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => confirmLink.mutate({ lineId: s.documentLineId, orderLineId: s.orderLineId })}
                  disabled={confirmLink.isPending}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 9px',
                    borderRadius: 6,
                    border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                    background: 'transparent',
                    color: 'var(--seal-deep, #14515C)',
                    cursor: 'pointer',
                  }}
                >
                  Confirm pairing
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* the ceremony — verify asserts the transcription, nothing more */}
      {editable && (
        <div className="mt-5">
          <SwipeToConfirm
            key={`swipe-${verify.failureCount}`}
            label="Swipe up to confirm"
            assertion="Confirms this transcription matches the paper. It does not accept charges or touch stock."
            disabled={verify.isPending}
            onConfirm={() => verify.mutate()}
          />
          {verify.isError && (
            <p role="alert" style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
              The confirmation did not reach the gateway — the document is still unverified.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReceiptsNext() {
  const data = useReceiptsNextData();
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showVerified, setShowVerified] = useState(false);
  const selected =
    data.queue.find((d) => d.id === selectedId) ??
    data.verified.find((d) => d.id === selectedId) ??
    null;

  if (searchParams.get('tab') === 'credits') {
    return (
      <Suspense fallback={null}>
        <LegacyReceiptsPage />
      </Suspense>
    );
  }

  return (
    <div
      className="mudavym min-h-screen"
      style={{ background: 'var(--paper-0, #FAF7F1)', color: 'var(--ink-1, #211C16)' }}
    >
      <style>{`
        @keyframes rc-settle { from { transform: translateY(-4px); opacity: 0 } to { transform: none; opacity: 1 } }
        .rc-row, .rc-ink { transition: background ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing} }
        .rc-ink:hover:not(:disabled) { background: var(--seal-tint, rgba(26,94,107,.10)) }
        .rc-ink:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: 2px }
        .rc-row:hover { background: var(--paper-1, #F3EFE6) }
        .rc-row:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: -2px }
        @media (prefers-reduced-motion: reduce) { .rc-row, [style*="rc-settle"] { animation: none !important; transition: none !important } }
      `}</style>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Wordmark size={13} />
            <h1 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '4px 0 0' }}>
              Receipts
            </h1>
          </div>
          <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>
            {data.queueKnown ? `${data.queue.length} awaiting review` : 'Reaching the gateway…'}
            {' · '}
            {data.verifiedCount === null ? EM : `${data.verifiedCapped ? '≥' : ''}${data.verifiedCount} verified`}
          </span>
        </header>

        {data.isError && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{ fontFamily: SANS, border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
              {data.queueKnown
                ? `The paper trail could not be refreshed (${data.errorMessage}) — what is below is the last answer, not the present.`
                : `The gateway could not be reached (${data.errorMessage}). The paper trail is unknown — nothing below is claimed.`}
            </span>
            <button
              type="button"
              onClick={data.refetch}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, border: '1px solid var(--seal-ring, rgba(26,94,107,.32))', background: 'transparent', color: 'var(--seal-deep, #14515C)', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        )}

        {/* deliveries the door counted that still have no paperwork — the
            orders side of the surface, so nothing waits invisibly elsewhere */}
        {data.deliveriesKnown && data.deliveriesWithoutPaper.length > 0 && (
          <div
            className="mb-4 rounded-xl px-4 py-3"
            style={{ fontFamily: SANS, border: '1px dashed var(--ink-3, #7C7365)', background: 'var(--paper-1, #F3EFE6)' }}
          >
            <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3, #7C7365)' }}>
              Counted at the door, no paperwork yet
            </span>
            <div style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', marginTop: 4 }}>
              {data.deliveriesWithoutPaper.map((d) => (
                <span key={d.orderId} style={{ marginRight: 16 }}>
                  {d.orderNumber ?? d.orderId.slice(0, 8)} · {d.countedQtyBottles} btl ·{' '}
                  {Math.round(d.ageHours)}h ago
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* the queue */}
          <section aria-label="Awaiting review">
            {data.queueKnown && data.queue.length === 0 && !data.isError ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
                Nothing awaits review — the paper trail is caught up.
              </p>
            ) : (
              <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                {data.queue.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    aria-pressed={selectedId === d.id}
                    className="rc-row block w-full text-left"
                    style={{
                      padding: '9px 8px',
                      // shorthand first: 'border: none' would clobber a
                      // longhand declared before it (receipts-audit.md)
                      border: 'none',
                      borderBottom: '1px solid var(--paper-2, #EAE4D8)',
                      borderLeft: selectedId === d.id ? '3px solid var(--seal, #1A5E6B)' : '3px solid transparent',
                      background: selectedId === d.id ? 'var(--paper-1, #F3EFE6)' : 'transparent',
                      cursor: 'pointer',
                      fontFamily: SANS,
                    }}
                  >
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
                      {TYPE_LABELS[d.doc_type] ?? d.doc_type} · {d.doc_number || EM}
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                      {fmtDate(d.doc_date)} · {fmtMoney(d.total)} ·{' '}
                      {d.ties_out === null ? `tie-out ${EM}` : d.ties_out ? 'ties out' : 'does not tie out'}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* the verified lane — the record, one click away, read-only
                (opus-fidelity R-1: "everything from all of the orders" must
                not shrink the verified book to a header integer) */}
            {data.verifiedKnown && data.verified.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => setShowVerified((v) => !v)}
                  aria-expanded={showVerified}
                  className="rc-ink"
                  style={{
                    fontFamily: MONO,
                    fontSize: 9.5,
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3, #7C7365)',
                    background: 'transparent',
                    border: 'none',
                    padding: '4px 0',
                    cursor: 'pointer',
                  }}
                >
                  Verified · {data.verifiedCapped ? '≥' : ''}{data.verified.length} {showVerified ? '▾' : '▸'}
                </button>
                {showVerified && (
                  <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                    {data.verified.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setSelectedId(d.id)}
                        aria-pressed={selectedId === d.id}
                        className="rc-row block w-full text-left"
                        style={{
                          padding: '7px 8px',
                          border: 'none',
                          borderBottom: '1px solid var(--paper-2, #EAE4D8)',
                          borderLeft: selectedId === d.id ? '3px solid var(--seal, #1A5E6B)' : '3px solid transparent',
                          background: selectedId === d.id ? 'var(--paper-1, #F3EFE6)' : 'transparent',
                          cursor: 'pointer',
                          fontFamily: SANS,
                        }}
                      >
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
                          {TYPE_LABELS[d.doc_type] ?? d.doc_type} · {d.doc_number || EM} · {fmtDate(d.doc_date)} · {fmtMoney(d.total)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* the selected document */}
          <section aria-label="Document detail">
            {selected ? (
              <DocView key={selected.id} doc={selected} onVerified={() => setSelectedId(null)} />
            ) : (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3, #7C7365)' }}>
                Choose a document from the queue — its lines, its order, and the confirm ceremony
                live here.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
