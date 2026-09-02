/**
 * ReceiptsNext — the Mudavym redesign of `/receipts` (ADR 0045 §5 wave,
 * MAKEOVER-VERDICTS: KEEP+, "the most demanding brief in the set").
 *
 * The founder's four requirements, built:
 * 1. Everything from the orders is compressed into this surface — the
 *    review queue and the deliveries still WITHOUT paperwork share it.
 * 2. Backend integrated without overcrowding: one queue, one selected
 *    document, detail on demand.
 * 3. "Make sure it is the right invoice": THE SCAN ITSELF sits beside the
 *    lines — a screen that asks a human to certify a transcription must show
 *    them the page it was transcribed from — the linked order rides above
 *    them, and the matcher's pairings are shown with their reasons and their
 *    confidences.
 *
 *    Correction: this docblock previously said the matcher's pairings are
 *    "never auto-written". That was false. `POST :id/match` WRITES every
 *    unambiguous vendor-SKU pairing before it answers (line-matcher.ts:282-296,
 *    documents.controller.ts:209-224) and returns them under `applied`; only
 *    `suggested` is withheld pending a human. The page now names the applied
 *    ones, shows their confidence, and offers Unlink for each — a comment that
 *    misdescribes the code is worse than no comment.
 * 4. "We can edit, and we can just confirm it right away": qty / unit price
 *    / line total are editable in place (pre-verification only), the
 *    recomputed tie-out lands with the response, and confirmation is the
 *    swipe-up ceremony the founder named, asserting exactly what verify
 *    asserts: the transcription is faithful. Nothing here applies stock.
 *
 * Motions (06-pages/receipts.md §1b): swipe-up confirm (pour-rate fill,
 * tuck on early release); row settle for the doc open; ink micro-states.
 */

import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wordmark } from '@/components/mudavym';
import {
  documentsApi,
  type DocumentLineMatch,
  type ProcurementDocument,
  type ProcurementDocumentLine,
} from '../../../services/api/documents';
import { getOrder } from '../../../services/api/orders';
import { ink, settle } from '../../../lib/mudavym/motion';
import {
  EM,
  GE,
  MONO,
  SANS,
  SERIF,
  fmtConfidence,
  fmtDate,
  fmtMoney,
  isSignedUrlExpired,
  parseCell,
  serverMessage,
} from './rc2-format';
import { SwipeToConfirm } from './SwipeToConfirm';
import {
  RECEIPTS_SERVER_WINDOWS,
  useActiveRestaurantId,
  useReceiptsNextData,
} from './useReceiptsNextData';

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

const PAPER_NOTE: CSSProperties = {
  fontSize: 11.5,
  color: 'var(--ink-2, #4F473C)',
  textAlign: 'center',
  padding: '0 10px',
  margin: 0,
};

/**
 * THE PAPER, beside the lines.
 *
 * This is the page's reason to exist. Before this, `imageUrl` was read off the
 * LIST row — where the gateway never sets it, because only the detail handler
 * signs one — so the "Open the paper ↗" link never rendered at all, and the
 * screen asked a person to certify that a transcription matched a page it
 * never showed them. The legacy page it replaces did show it inline
 * (ReceiptsPage.tsx:337-340); an adjudication surface must not regress on the
 * one thing being adjudicated.
 *
 * Every not-shown state says WHICH not-shown state it is. "This document has
 * no stored file" (an EDI or text-only channel keeps its content in the
 * payload), "the file exists but could not be signed", and "the link has aged
 * out" are three different facts, and only the first means the manager should
 * stop looking for a scan.
 */
export function PaperPane({
  doc,
  detailKnown,
  fetchedAt,
  onRefresh,
  refreshing,
}: {
  doc: ProcurementDocument;
  detailKnown: boolean;
  fetchedAt: number;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  // A ticking clock, so a link that ages out while the tab sits open turns
  // into the expiry notice instead of quietly becoming a broken image.
  const [now, setNow] = useState(() => Date.now());
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    setLoadFailed(false);
  }, [doc.imageUrl]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const expired = !!doc.imageUrl && isSignedUrlExpired(fetchedAt, now);
  const isPdf = /\.pdf$/i.test(doc.filename ?? '') || /\.pdf$/i.test(doc.storage_path ?? '');

  const frame = (children: ReactNode) => (
    <div
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 10,
        background: 'var(--paper-0, #FAF7F1)',
        minHeight: 260,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 10,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );

  const again = (label: string) => (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      className="rc-ink"
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        padding: '4px 11px',
        borderRadius: 7,
        border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
        background: 'transparent',
        color: 'var(--seal-deep, #14515C)',
        cursor: refreshing ? 'progress' : 'pointer',
      }}
    >
      {refreshing ? 'Fetching a fresh link…' : label}
    </button>
  );

  let body: ReactNode;
  if (!detailKnown) {
    body = <p style={PAPER_NOTE}>Reading the stored document…</p>;
  } else if (!doc.storage_path) {
    body = (
      <p style={PAPER_NOTE}>
        No file was stored for this document — it arrived by {doc.source_channel || 'an unrecorded channel'},
        and that channel keeps its content in the payload rather than as a scan.
      </p>
    );
  } else if (!doc.imageUrl) {
    body = (
      <>
        <p style={PAPER_NOTE}>
          A file is stored for this document, but a viewing link could not be created. The paper
          exists — this screen cannot reach it.
        </p>
        {again('Try again')}
      </>
    );
  } else if (expired) {
    body = (
      <>
        <p style={PAPER_NOTE}>
          The viewing link has aged out (they last an hour). The document has not changed.
        </p>
        {again('Fetch a fresh link')}
      </>
    );
  } else if (loadFailed) {
    body = (
      <>
        <p style={PAPER_NOTE}>The stored file did not load. This is the link failing, not the paper missing.</p>
        {again('Try again')}
      </>
    );
  } else if (isPdf) {
    body = (
      <object
        data={doc.imageUrl}
        type="application/pdf"
        aria-label="Stored document"
        style={{ width: '100%', height: '60vh', minHeight: 260, borderRadius: 8 }}
      >
        <p style={PAPER_NOTE}>
          This browser will not display the PDF inline. Open it in a new tab with the link below.
        </p>
      </object>
    );
  } else {
    body = (
      <img
        src={doc.imageUrl}
        alt="Stored document"
        onError={() => setLoadFailed(true)}
        style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 8 }}
      />
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          The paper
        </span>
        {doc.imageUrl && !expired && (
          <a
            href={doc.imageUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
          >
            Open the paper ↗
          </a>
        )}
      </div>
      {frame(body)}
    </div>
  );
}

/** Money/number fields the editor can move, and how they are labelled. */
const EDITABLE_FIELDS = [
  { key: 'qty', patch: 'qty', label: 'Quantity', nullable: false },
  { key: 'unit_price', patch: 'unitPrice', label: 'Unit price', nullable: true },
  { key: 'line_total', patch: 'lineTotal', label: 'Line total', nullable: true },
] as const;

type EditableKey = (typeof EDITABLE_FIELDS)[number]['key'];

/**
 * What the pairing badge means.
 *
 * The old column printed `paired` or `—` with no referent — so a reader could
 * not tell WHAT a line was paired to, and `—` did double duty for "not paired"
 * and "pairing unknown". These are three separate facts and get three separate
 * sentences.
 *
 * The named target is as specific as the live data allows. An order in this
 * system is one wine (`Order.wineId/quantity`, services/api/types.ts:251-268)
 * and the gateway exposes no per-order-line list, so the honest label is the
 * ordered wine, the ordered quantity, and the order-line reference — not an
 * invented line description. When the order query has not answered, the badge
 * says the target is unread rather than naming nothing.
 */
function PairedCell({
  line,
  order,
  orderUnread,
}: {
  line: ProcurementDocumentLine;
  order: { wineName?: string; quantity?: number } | undefined;
  orderUnread: boolean;
}) {
  if (!line.order_line_id)
    return (
      <span style={{ color: 'var(--ink-3, #7C7365)' }}>
        not paired
      </span>
    );
  const ref = `#${line.order_line_id.slice(0, 8)}`;
  const conf = fmtConfidence(line.match_confidence);
  const how = line.match_method === 'manual' ? 'confirmed by hand' : line.match_method ?? 'unrecorded method';
  return (
    <span style={{ color: 'var(--seal-deep, #14515C)' }}>
      {orderUnread
        ? `paired → order line ${ref} (the order could not be read, so the wine is unnamed)`
        : `paired → ${order?.wineName ?? 'the ordered wine is unnamed'} · ${
            order?.quantity == null ? EM : order.quantity
          } ordered · order line ${ref}`}
      {` · ${how} · confidence ${conf}`}
    </span>
  );
}

function DocView({ doc, onVerified }: { doc: ProcurementDocument; onVerified: () => void }) {
  const qc = useQueryClient();
  const rid = useActiveRestaurantId();
  const detailKey = ['receipts-next', 'doc', rid, doc.id];
  const detailQ = useQuery({
    queryKey: detailKey,
    queryFn: () => documentsApi.detail(doc.id),
    staleTime: 30_000,
  });
  const orderQ = useQuery({
    queryKey: ['receipts-next', 'order', rid, doc.order_id],
    queryFn: () => getOrder(doc.order_id!),
    enabled: !!doc.order_id,
    staleTime: 60_000,
  });
  const [matchResult, setMatchResult] = useState<Awaited<ReturnType<typeof documentsApi.match>> | null>(null);
  const [tieOut, setTieOut] = useState<{ tiesOut: boolean | null; tieOutDelta: number | null } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [collision, setCollision] = useState<string | null>(null);
  /**
   * What the extraction said BEFORE a human touched it, per line and field.
   *
   * The pre-edit value used to vanish the instant the PATCH succeeded, so the
   * person about to swear the transcription is faithful could no longer see
   * what they had changed it from. It is kept until verify (this component
   * unmounts on verify) and drives Undo.
   */
  const [originals, setOriginals] = useState<Record<string, number | null>>({});

  // The lines this view believes in, and the document as the DETAIL endpoint
  // returned it — the list row never carries `imageUrl`, `storage_path` or a
  // signed link, which is why the paper was invisible before.
  const detailDoc = detailQ.data?.document;
  const lines = detailQ.data?.lines;
  const shownDoc: ProcurementDocument = detailDoc ? { ...doc, ...detailDoc } : doc;

  const editable = doc.status === 'needs_review' || doc.status === 'received';

  const edit = useMutation({
    mutationFn: (p: { lineId: string; field: EditableKey; patch: Record<string, number | null> }) =>
      documentsApi.editLine(doc.id, p.lineId, p.patch),
    onSuccess: (res, vars) => {
      setEditError(null);
      setTieOut(res.tieOut);
      // Pairing suggestions were computed against the pre-edit lines — a
      // stale reason must not invite a stale confirmation.
      setMatchResult(null);
      /**
       * Last-write-wins is unavoidable here (the table has no `updated_at` to
       * precondition on — see documents.ts), but it does not have to be
       * SILENT. One field goes out per PATCH, so every OTHER field the server
       * echoes back should still equal what this tab last saw. If one moved,
       * somebody else edited this document, and the reviewer is told before
       * they certify a transcription that includes a stranger's correction.
       */
      const before = (qc.getQueryData(detailKey) as
        | { lines: ProcurementDocumentLine[] }
        | undefined)?.lines?.find((l) => l.id === res.line.id);
      if (before) {
        const moved = EDITABLE_FIELDS.filter(
          (f) => f.key !== vars.field && before[f.key] !== res.line[f.key],
        ).map((f) => f.label.toLowerCase());
        setCollision(
          moved.length
            ? `Someone else changed the ${moved.join(' and ')} on line ${res.line.line_no} while this was open. The figures below are the server's, not yours.`
            : null,
        );
      }
      qc.setQueryData(
        detailKey,
        (cur: { document: ProcurementDocument; lines: ProcurementDocumentLine[]; links: unknown[] } | undefined) =>
          cur
            ? { ...cur, lines: cur.lines.map((l) => (l.id === res.line.id ? { ...l, ...res.line } : l)) }
            : cur,
      );
    },
    onError: (e) => setEditError(serverMessage(e, 'The correction did not save.')),
  });

  /** Capture the extraction's own figure the first time a field is moved. */
  const commitEdit = (line: ProcurementDocumentLine, field: EditableKey, patchKey: string, next: number | null) => {
    const k = `${line.id}:${field}`;
    setOriginals((cur) => (k in cur ? cur : { ...cur, [k]: line[field] }));
    edit.mutate({ lineId: line.id, field, patch: { [patchKey]: next } });
  };

  const runMatch = useMutation({
    mutationFn: () => documentsApi.match(doc.id),
    onSuccess: (res) => {
      setMatchResult(res);
      // `applied` was WRITTEN by that call. The rows on screen are now stale.
      void qc.invalidateQueries({ queryKey: detailKey });
    },
  });

  const link = useMutation({
    mutationFn: (p: { lineId: string; orderLineId: string | null }) =>
      documentsApi.linkLine(doc.id, p.lineId, p.orderLineId),
    onSuccess: (_res, p) => {
      setMatchResult((cur) =>
        cur
          ? {
              ...cur,
              suggested: cur.suggested.filter((s) => s.documentLineId !== p.lineId),
              applied: cur.applied.filter((s) => s.documentLineId !== p.lineId),
            }
          : cur,
      );
      void qc.invalidateQueries({ queryKey: detailKey });
    },
    onError: (e) => setEditError(serverMessage(e, 'The pairing change did not save.')),
  });

  const verify = useMutation({
    mutationFn: () => documentsApi.verify(doc.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['receipts-next'] });
      onVerified();
    },
  });

  const shownTieOut: ProcurementDocument = tieOut
    ? { ...shownDoc, ties_out: tieOut.tiesOut, tie_out_delta: tieOut.tieOutDelta }
    : shownDoc;

  const orderUnread = !!doc.order_id && orderQ.data === undefined;

  const appliedByLine = useMemo(() => {
    const m = new Map<string, DocumentLineMatch>();
    for (const a of matchResult?.applied ?? []) m.set(a.documentLineId, a);
    return m;
  }, [matchResult]);

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
            {TYPE_LABELS[shownDoc.doc_type] ?? shownDoc.doc_type} · {shownDoc.doc_number || EM} ·{' '}
            {fmtDate(shownDoc.doc_date)}
          </span>
          <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: '2px 0 0' }}>
            {shownDoc.total == null ? 'No stated total' : fmtMoney(shownDoc.total)}
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3, #7C7365)', marginLeft: 10 }}>
              <TieOutLine doc={shownTieOut} />
            </span>
          </h2>
          {/*
            HOW GOOD THE READING IS, stated. This screen asks for trust in a
            transcription; hiding the model's own confidence in it made that
            an unqualified ask. `—` when the record holds no score: an
            unrecorded confidence is not a low one, and not a high one either.
          */}
          <p style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3, #7C7365)', margin: '3px 0 0' }}>
            extraction confidence {fmtConfidence(shownDoc.extraction_confidence)}
            {shownDoc.extraction_confidence == null ? ' (none recorded for this document)' : ''}
          </p>
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
      </header>

      {/* the paper beside the lines — the adjudication this page exists for */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
        <PaperPane
          doc={shownDoc}
          detailKnown={detailQ.data !== undefined}
          fetchedAt={detailQ.dataUpdatedAt}
          onRefresh={() => void detailQ.refetch()}
          refreshing={detailQ.isFetching}
        />

        <div>
          {/* the lines — editable in place while the document awaits review */}
          {detailQ.isError ? (
            /*
              A failed detail fetch used to fall into the same branch as an
              answered-but-empty one and render "No lines were extracted" — a
              dead endpoint reported as a blank invoice. It is now said in words.
            */
            <div role="alert">
              <p style={{ fontSize: 12, color: 'var(--ink-1, #211C16)', margin: 0 }}>
                {serverMessage(detailQ.error, 'This document could not be read.')} — its lines are
                unknown, not empty. Nothing here is claimed.
              </p>
              <button
                type="button"
                onClick={() => void detailQ.refetch()}
                className="rc-ink"
                style={{
                  marginTop: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: '4px 11px',
                  borderRadius: 7,
                  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                  background: 'transparent',
                  color: 'var(--seal-deep, #14515C)',
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
            </div>
          ) : lines === undefined ? (
            <p style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>Reading the lines…</p>
          ) : lines.length === 0 ? (
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
                    <th style={{ textAlign: 'left', padding: '4px 6px' }}>Paired with</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                      <td style={{ padding: '5px 6px', color: 'var(--ink-1, #211C16)', maxWidth: 260 }}>
                        {l.description || EM}
                        {l.vintage ? ` · ${l.vintage}` : ''}
                      </td>
                      {EDITABLE_FIELDS.map((f) => {
                        const k = `${l.id}:${f.key}`;
                        const was = k in originals ? originals[k] : undefined;
                        const changed = was !== undefined && was !== l[f.key];
                        return (
                          <td key={f.key} style={{ textAlign: 'right', padding: '5px 6px' }}>
                            <EditCell
                              value={l[f.key]}
                              ariaLabel={`${f.label}, line ${l.line_no}`}
                              locked={!editable}
                              nullable={f.nullable}
                              onCommit={(v) => {
                                if (v === null && !f.nullable) return;
                                commitEdit(l, f.key, f.patch, v);
                              }}
                            />
                            {changed && (
                              <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3, #7C7365)', marginTop: 2 }}>
                                <span>
                                  extracted {was == null ? EM : f.key === 'qty' ? was : fmtMoney(was)}
                                </span>{' '}
                                <button
                                  type="button"
                                  onClick={() => commitEdit(l, f.key, f.patch, was)}
                                  disabled={edit.isPending}
                                  aria-label={`Undo ${f.label.toLowerCase()} on line ${l.line_no}`}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    padding: 0,
                                    fontFamily: MONO,
                                    fontSize: 9.5,
                                    fontWeight: 600,
                                    textDecoration: 'underline',
                                    color: 'var(--seal-deep, #14515C)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  undo
                                </button>
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td style={{ padding: '5px 6px', fontFamily: MONO, fontSize: 10 }}>
                        <PairedCell
                          line={l}
                          order={orderQ.data as { wineName?: string; quantity?: number } | undefined}
                          orderUnread={orderUnread}
                        />
                        {appliedByLine.has(l.id) && (
                          <div style={{ color: 'var(--ink-2, #4F473C)', marginTop: 2 }}>
                            written by the matcher just now: {appliedByLine.get(l.id)!.reason}
                          </div>
                        )}
                        {l.order_line_id && editable && (
                          <button
                            type="button"
                            onClick={() => link.mutate({ lineId: l.id, orderLineId: null })}
                            disabled={link.isPending}
                            style={{
                              marginTop: 2,
                              border: 'none',
                              background: 'transparent',
                              padding: 0,
                              fontFamily: MONO,
                              fontSize: 9.5,
                              fontWeight: 600,
                              textDecoration: 'underline',
                              color: 'var(--seal-deep, #14515C)',
                              cursor: 'pointer',
                            }}
                          >
                            Unlink
                          </button>
                        )}
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
          {collision && (
            <p role="alert" style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
              {collision}
            </p>
          )}
          {editError && (
            <p role="alert" style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
              {editError}
            </p>
          )}

          {/* the pairing check — the matcher WRITES its certain half, so say so */}
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
            {runMatch.isError && (
              <span role="alert" style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', flexBasis: '100%' }}>
                {serverMessage(runMatch.error, 'The pairing check did not run.')}
              </span>
            )}
            {matchResult && (
              <div style={{ flexBasis: '100%', fontSize: 12 }}>
                <p style={{ color: 'var(--ink-2, #4F473C)', margin: '2px 0 6px' }}>
                  {matchResult.applied.length} written to the record by this check ·{' '}
                  {matchResult.suggested.length} awaiting your confirmation ·{' '}
                  {matchResult.unmatchedDocumentLineIds.length} on the paper with no order line
                </p>
                {matchResult.applied.length > 0 && (
                  <p style={{ color: 'var(--ink-2, #4F473C)', margin: '0 0 6px' }}>
                    The {matchResult.applied.length} above were saved without asking — the matcher
                    writes an unambiguous vendor-SKU pairing. They are marked in the table and each
                    one can be unlinked there.
                  </p>
                )}
                {matchResult.suggested.map((s) => (
                  <div key={s.documentLineId} className="flex flex-wrap items-center gap-2 py-1" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                    <span style={{ color: 'var(--ink-2, #4F473C)' }}>
                      {s.reason}
                      {s.substitution ? ' — a substitution; accept it knowingly' : ''}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
                      confidence {fmtConfidence(s.confidence)}
                    </span>
                    <button
                      type="button"
                      onClick={() => link.mutate({ lineId: s.documentLineId, orderLineId: s.orderLineId })}
                      disabled={link.isPending}
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
                  {serverMessage(
                    verify.error,
                    'The confirmation did not reach the gateway.',
                  )}{' '}
                  The document is still unverified.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
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
          <span
            style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}
            title={
              data.queueCapped || data.verifiedCapped
                ? `The gateway returns at most ${RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS} documents per list, so a count marked ${GE} is a floor.`
                : undefined
            }
          >
            {/*
              A WINDOW IS NOT A TOTAL. `queue.length` is what fits inside the
              gateway's `.limit()` (RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS,
              documents.controller.ts:117); at the cap it is a floor and must
              carry the `≥`, exactly as the verified count already did. ADR
              0051 clause 2.
            */}
            {data.queueKnown
              ? `${data.queueCapped ? GE : ''}${data.queue.length} awaiting review`
              : 'Reaching the gateway…'}
            {' · '}
            {data.verifiedCount === null ? EM : `${data.verifiedCapped ? GE : ''}${data.verifiedCount} verified`}
          </span>
        </header>

        {data.noRestaurant && (
          <div
            role="alert"
            className="mb-4 rounded-xl px-4 py-3"
            style={{ fontFamily: SANS, border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)', fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}
          >
            No restaurant is selected, so the tenant-scoped paper trail was never requested. Nothing
            below is claimed — this is not an empty queue.
          </div>
        )}

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
        {/*
            An unanswered uncounted-deliveries query used to render exactly like
            a caught-up door: `[]`. It is now `null` until it answers, and the
            unknown says so instead of hiding behind the absent strip.
        */}
        {data.deliveriesWithoutPaper === null && !data.noRestaurant && (
          <p
            className="mb-4"
            style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}
          >
            Deliveries counted at the door: unknown — that list has not answered, so this page is
            not claiming the door is caught up.
          </p>
        )}
        {data.deliveriesWithoutPaper !== null && data.deliveriesWithoutPaper.length > 0 && (
          <div
            className="mb-4 rounded-xl px-4 py-3"
            style={{ fontFamily: SANS, border: '1px dashed var(--ink-3, #7C7365)', background: 'var(--paper-1, #F3EFE6)' }}
          >
            <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3, #7C7365)' }}>
              Counted at the door, no paperwork yet
            </span>
            <div style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', marginTop: 4 }}>
              {(data.deliveriesWithoutPaper ?? []).map((d) => (
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
            {data.queueKnown && data.queue.length === 0 && !data.isError && !data.noRestaurant ? (
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
                      background: selectedId === d.id ? 'var(--paper-1, #F3EFE6)' : undefined,
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
                    border: 'none',
                    padding: '4px 0',
                    cursor: 'pointer',
                  }}
                >
                  Verified · {data.verifiedCapped ? GE : ''}{data.verified.length} {showVerified ? '▾' : '▸'}
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
                          background: selectedId === d.id ? 'var(--paper-1, #F3EFE6)' : undefined,
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
