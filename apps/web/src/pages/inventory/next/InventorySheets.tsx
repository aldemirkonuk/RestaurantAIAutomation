/**
 * The five writes an /inventory row can start (inventory.md §15, "Build
 * rulings" 2): Record a count, Order more, Write off, and — behind More —
 * Transfer and Record a pour.
 *
 * WHY SHEETS AND NOT THE DROPDOWN
 * The row's dropdown is non-modal, and ADR 0112 F8 says a non-modal overlay is
 * never a form and never carries the seal. Every write that moves a bottle on
 * the books is sealed before it is sent (ADR 0112 F10), so each one opens its
 * own Sheet with its fields and a HoldToApprove, and the dropdown keeps only
 * the buttons that open them.
 *
 * Each sheet is mounted only while it is open, so its idempotency key is drawn
 * once per opening: a retry after a failure re-sends the same key (one
 * movement, not two), and a second write-off is a second opening.
 *
 * Reused, not rebuilt:
 *  - the count goes through the spot-count outbox (`submitSpotCount`), the
 *    path SpotCountPanel.tsx:187-195 writes through, with its photo estimate
 *    (SpotCountPanel.tsx:154-177) offered as a suggestion only;
 *  - Order more is /cellar's own order: the same POST /procurement/orders body
 *    and the same OrderCeremony as BottleLeaf.tsx:211-225 and :544-570;
 *  - Transfer and Record a pour call `transferStock` and `recordPour`.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CountInput, HoldToApprove, Select, Sheet } from '@/components/mudavym';
import { apiClient, getErrorStatus, isUnconfirmedWrite } from '../../../services/api/client';
import { estimateCountFromPhoto, recordPour, transferStock } from '../../../services/api/inventory';
import type { Provider } from '../../../services/api/providers';
import type { StorageLocation } from '../../../hooks/useStorageLocations';
import { useRecommendedProviders } from '../../../hooks/queries/useProviderQueries';
import { queryKeys } from '../../../lib/query-keys';
import { newClientCountId, submitSpotCount } from '../../../lib/spotCountOutbox';
import { SCAN_ACCEPT } from '../../../lib/uploadAccept';
import OrderCeremony from '../../cellar/next/OrderCeremony';
import OrderLetter from './OrderLetter';
import { useCellarSettings } from '../../cellar/next/useCellarNextData';
import { fmtCount, suggestedToPar, type InvRow } from './useInventoryNextData';
import { SAFE_RETRY, failureReason, writeFailure } from './iv-failure';

/** A whole number typed as a string, or null. "2.5", "" and "-1" are null. */
function wholeNumber(s: string): number | null {
  const t = s.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

function freshKey(prefix: string, id: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}:${uuid}`;
}

function titleOf(row: InvRow): string {
  return row.name ?? 'this title';
}

function useInvalidateStock() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    void queryClient.invalidateQueries({ queryKey: ['inventory-next'] });
  };
}

/** The line under a write once it has an answer. */
function Said({ children, alarm }: { children: ReactNode; alarm?: boolean }) {
  return (
    <p role={alarm ? 'alert' : 'status'} className={alarm ? 'iv-said iv-said-alarm' : 'iv-said'} style={{ marginTop: 12 }}>
      {children}
    </p>
  );
}

interface SheetProps {
  row: InvRow;
  onClose: () => void;
}

/* ── Record a count ─────────────────────────────────────────────────────── */

/** After a blind count: what the book said and how far the shelf was from it (INV-W22). */
export function countGapSentence(book: number | null, counted: number, title: string): string {
  const c = fmtCount(counted);
  if (book === null) return `Counted ${c}. The book could not be read before, so there is no gap to show; ${title} now reads ${c}.`;
  if (book === counted) return `Counted ${c}, the same as the book. ${title} still reads ${c}.`;
  const d = counted - book;
  return `Counted ${c}; the book said ${fmtCount(book)}, so the shelf is ${fmtCount(Math.abs(d))} ${d < 0 ? 'short' : 'over'}. ${title} now reads ${c}.`;
}

export function CountSheet({ row, onClose }: SheetProps) {
  const invalidate = useInvalidateStock();
  const [clientCountId] = useState(newClientCountId);
  // INV-W22 (founder, 2026-10-01): a blind count. The field starts empty and
  // the book's figure stays hidden until the seal, then the gap is said.
  const [qty, setQty] = useState('');
  const [book] = useState(row.stock);
  const [attempt, setAttempt] = useState(0);
  const [said, setSaid] = useState<{ text: string; alarm?: boolean } | null>(null);
  const [photo, setPhoto] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const fileRef = useRef<HTMLInputElement>(null);
  const counted = wholeNumber(qty);

  const count = useMutation({
    mutationFn: (countedQty: number) =>
      submitSpotCount({
        itemId: row.id,
        itemLabel: titleOf(row),
        body: { countedQty, clientCountId, reason: 'Spot count' },
      }),
    onSuccess: ({ synced }, countedQty) => {
      invalidate();
      setSaid({
        text: synced
          ? countGapSentence(book, countedQty, titleOf(row))
          : `Held on this device — not yet confirmed. The count of ${fmtCount(countedQty)} goes out when the connection returns; until then the book still reads what it read.`,
      });
    },
    onError: (e) => {
      setAttempt((n) => n + 1);
      // submitSpotCount holds a 5xx or an unanswered count on the device, so a
      // status here is a refusal. No status means the device could not hold it,
      // possibly after a send that landed (INV-W31).
      if (getErrorStatus(e) === null) {
        invalidate();
        setSaid({ text: `This device could not hold the count to send later, so it is not known whether it was recorded. ${SAFE_RETRY}`, alarm: true });
        return;
      }
      setSaid({ text: writeFailure(e, { refused: 'Nothing was recorded', act: 'the count was recorded', check: SAFE_RETRY }).text, alarm: true });
    },
  });

  const readPhoto = async (file: File) => {
    setPhoto({ busy: true, note: null });
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const s = String(reader.result);
          resolve(s.slice(s.indexOf(',') + 1));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const estimate = await estimateCountFromPhoto(row.id, base64);
      if (estimate.suggestedQty !== null) setQty(String(estimate.suggestedQty));
      setPhoto({
        busy: false,
        note:
          estimate.suggestedQty !== null
            ? `The photo suggests ${fmtCount(estimate.suggestedQty)} (${estimate.confidence} confidence). It only fills the field — check it before you seal. ${estimate.note}`
            : `The photo gave no confident count. ${estimate.note}`,
      });
    } catch (e) {
      setPhoto({ busy: false, note: `The photo could not be read — ${failureReason(e)}. Type the count instead.` });
    }
  };

  return (
    <Sheet
      open
      bodyClassName="iv-sheet-body"
      onClose={onClose}
      label={`Record a count of ${titleOf(row)}: what is on the shelf, sealed before the book changes`}
      eyebrow="Record a count"
      title={titleOf(row)}
      footer={<span>A count sets the book to what was counted and stamps the last-counted date.</span>}
    >
      <p className="iv-said">
        Count what is on the shelf, then hold to seal it. The book’s figure is shown after the seal, so it cannot steer the count.
      </p>
      <div className="iv-sheet-fields">
        <CountInput label="Bottles counted" value={qty} onChange={setQty} min={0} />
        <button
          type="button"
          className="iv-btn iv-focus"
          onClick={() => fileRef.current?.click()}
          disabled={photo.busy}
        >
          {photo.busy ? 'Reading the photo…' : 'Count from a photo'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={SCAN_ACCEPT}
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readPhoto(f);
          }}
        />
      </div>
      {photo.note ? <p className="iv-note">{photo.note}</p> : null}
      {qty !== '' && counted === null ? <p className="iv-note">A count is a whole number of bottles.</p> : null}
      <div style={{ marginTop: 14 }}>
        <HoldToApprove
          key={`count-${attempt}`}
          label={counted === null ? 'Type the count first' : `Hold to record ${fmtCount(counted)}`}
          approvedLabel="Count recorded"
          boundSummary={counted === null ? undefined : `${titleOf(row)}: ${fmtCount(counted)} counted`}
          disabled={counted === null || count.isPending || count.isSuccess}
          onApprove={() => (counted === null ? undefined : count.mutateAsync(counted))}
        />
      </div>
      {said ? <Said alarm={said.alarm}>{said.text}</Said> : null}
    </Sheet>
  );
}

/* ── Write off ──────────────────────────────────────────────────────────── */

/** The three ways a bottle leaves without a sale, and the ledger type each one is. */
export const WRITE_OFF_REASONS = [
  { value: 'breakage', label: 'Breakage', type: 'waste' },
  { value: 'comp', label: 'Comp (given away)', type: 'comp' },
  { value: 'return', label: 'Returned to the vendor', type: 'return' },
] as const;

export function WriteOffSheet({ row, onClose }: SheetProps) {
  const invalidate = useInvalidateStock();
  const [idempotencyKey] = useState(() => freshKey('writeoff', row.id));
  const [reason, setReason] = useState<string>('');
  const [qty, setQty] = useState('1');
  const [attempt, setAttempt] = useState(0);
  const [said, setSaid] = useState<{ text: string; alarm?: boolean } | null>(null);
  const n = wholeNumber(qty);
  // A blocked sheet never says the count, so a null one reads as nothing (INV-W33).
  const nText = n === null ? '' : fmtCount(n);
  const kind = WRITE_OFF_REASONS.find((r) => r.value === reason) ?? null;

  const writeOff = useMutation({
    mutationFn: async () => {
      if (!kind || n === null || !row.wineId) throw new Error('the write-off is not complete');
      const r = await apiClient.post('/inventory-ledger/transactions', {
        inventoryId: row.id,
        wineId: row.wineId,
        transactionType: kind.type,
        source: 'manual',
        quantityChange: -n,
        stockType: 'live',
        reason: kind.label,
        idempotencyKey,
      });
      return r.data;
    },
    onSuccess: () => {
      invalidate();
      setSaid({ text: `Written off: ${nText} × ${titleOf(row)}, as ${kind?.label.toLowerCase()}. The last-counted date is unchanged.` });
    },
    onError: (e) => {
      setAttempt((a) => a + 1);
      const f = writeFailure(e, { refused: 'Nothing was written off', act: 'the write-off was recorded', check: SAFE_RETRY });
      if (f.unknown) invalidate();
      setSaid({ text: f.text, alarm: true });
    },
  });

  const blocked = !row.wineId
    ? 'This row is not tied to an item in the house’s library, and the ledger needs one, so it cannot be written off from here.'
    : !kind
      ? 'Choose why the bottles left.'
      : n === null || n < 1
        ? 'Write off at least one whole bottle.'
        : row.stock !== null && n > row.stock
          ? `The book holds ${fmtCount(row.stock)}; a write-off cannot take it below zero. If the book is wrong, record a count first.`
          : null;

  return (
    <Sheet
      open
      bodyClassName="iv-sheet-body"
      onClose={onClose}
      label={`Write off bottles of ${titleOf(row)}: breakage, a comp or a return, sealed before the ledger changes`}
      eyebrow="Write off"
      title={titleOf(row)}
      footer={<span>Owners and managers only. A write-off is one ledger line; it never changes the last-counted date.</span>}
    >
      <div className="iv-sheet-fields">
        <Select
          label="Why they left"
          value={reason}
          onChange={setReason}
          placeholder="Choose a reason…"
          options={WRITE_OFF_REASONS.map((r) => ({ value: r.value, label: r.label }))}
        />
        <CountInput label="Bottles" value={qty} onChange={setQty} min={1} max={row.stock ?? 100_000} />
      </div>
      {blocked ? <p className="iv-note">{blocked}</p> : null}
      <div style={{ marginTop: 14 }}>
        <HoldToApprove
          key={`wo-${attempt}`}
          label={blocked ? 'Not ready to write off' : `Hold to write off ${nText}`}
          approvedLabel="Written off"
          boundSummary={blocked ? undefined : `${titleOf(row)}: −${nText}, ${kind?.label.toLowerCase()}`}
          disabled={blocked !== null || writeOff.isPending || writeOff.isSuccess}
          onApprove={() => writeOff.mutateAsync()}
        />
      </div>
      {said ? <Said alarm={said.alarm}>{said.text}</Said> : null}
    </Sheet>
  );
}

/* ── Transfer ───────────────────────────────────────────────────────────── */

const UNASSIGNED = '__unassigned__';

export function TransferSheet({
  row,
  onClose,
  locations,
  locationsUnavailable,
}: SheetProps & { locations: StorageLocation[]; locationsUnavailable: boolean }) {
  const invalidate = useInvalidateStock();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [qty, setQty] = useState('1');
  const [attempt, setAttempt] = useState(0);
  const [said, setSaid] = useState<{ text: string; alarm?: boolean } | null>(null);
  const n = wholeNumber(qty);
  // A blocked sheet never says the count, so a null one reads as nothing (INV-W33).
  const nText = n === null ? '' : fmtCount(n);

  const nameOf = (id: string | null) =>
    id === null ? 'Unassigned' : (locations.find((l) => l.id === id)?.name ?? 'a zone this page cannot name');
  const fromOptions = (row.zones ?? [])
    .filter((z) => z.qty > 0)
    .map((z) => ({ value: z.locationId ?? UNASSIGNED, label: `${nameOf(z.locationId)} · ${fmtCount(z.qty)}` }));
  const held = (row.zones ?? []).find((z) => (z.locationId ?? UNASSIGNED) === from)?.qty ?? null;
  const toOptions = [
    ...locations.map((l) => ({ value: l.id, label: l.name })),
    { value: UNASSIGNED, label: 'Unassigned' },
  ].filter((o) => o.value !== from);

  const move = useMutation({
    mutationFn: () =>
      transferStock(row.id, {
        fromLocationId: from === UNASSIGNED ? null : from,
        toLocationId: to === UNASSIGNED ? null : to,
        qty: n ?? 0,
        reason: 'Transfer',
      }),
    onSuccess: () => {
      invalidate();
      setSaid({ text: `Moved ${nText} from ${from === UNASSIGNED ? 'Unassigned' : nameOf(from)} to ${to === UNASSIGNED ? 'Unassigned' : nameOf(to)}.` });
    },
    onError: (e) => {
      setAttempt((a) => a + 1);
      // A transfer carries no key, so a second try after an unknown one can move the bottles twice.
      const f = writeFailure(e, {
        refused: 'Nothing moved',
        act: 'the bottles moved',
        check: 'Look at where the bottles are on the page before trying again, so they do not move twice.',
      });
      if (f.unknown) invalidate();
      setSaid({ text: f.text, alarm: true });
    },
  });

  // INV-W24: with no zones at all the only choice was Unassigned → nothing.
  const noZones = !locationsUnavailable && locations.length === 0;
  const blocked = locationsUnavailable
    ? 'The storage locations could not be read, so no zone can be named and nothing can be moved.'
    : noZones
      ? 'This house has no zones yet, so there is nowhere to move bottles to. Zones are added under Tools, in Storage locations.'
      : row.zones === null
      ? 'Where this title sits could not be read, so there is nothing to move from.'
      : fromOptions.length === 0
        ? 'No zone holds a bottle of this title.'
        : !from || !to
          ? 'Choose where the bottles come from and where they go.'
          : n === null || n < 1
            ? 'Move at least one whole bottle.'
            : held !== null && n > held
              ? `That zone holds ${fmtCount(held)}.`
              : null;

  return (
    <Sheet
      open
      bodyClassName="iv-sheet-body"
      onClose={onClose}
      label={`Move bottles of ${titleOf(row)} between zones, sealed before the books change`}
      eyebrow="Transfer"
      title={titleOf(row)}
      footer={<span>A transfer moves bottles between zones; the total on the book does not change.</span>}
    >
      {noZones ? null : (
        <div className="iv-sheet-fields">
          <Select label="From" value={from} onChange={setFrom} placeholder="Choose a zone…" options={fromOptions} disabled={fromOptions.length === 0} />
          <Select label="To" value={to} onChange={setTo} placeholder="Choose a zone…" options={toOptions} disabled={locationsUnavailable} />
          <CountInput label="Bottles" value={qty} onChange={setQty} min={1} max={held ?? 100_000} />
        </div>
      )}
      {blocked ? <p className="iv-note">{blocked}</p> : null}
      {noZones ? null : (
        <div style={{ marginTop: 14 }}>
          <HoldToApprove
            key={`tr-${attempt}`}
            label={blocked ? 'Not ready to move' : `Hold to move ${nText}`}
            approvedLabel="Moved"
            disabled={blocked !== null || move.isPending || move.isSuccess}
            onApprove={() => move.mutateAsync()}
          />
        </div>
      )}
      {said ? <Said alarm={said.alarm}>{said.text}</Said> : null}
    </Sheet>
  );
}

/* ── Record a pour ──────────────────────────────────────────────────────── */

export function PourSheet({ row, onClose }: SheetProps) {
  const invalidate = useInvalidateStock();
  const [idempotencyKey] = useState(() => freshKey('pour', row.id));
  const [pours, setPours] = useState('1');
  const [ml, setMl] = useState(row.pourMl === null ? '' : String(row.pourMl));
  const [attempt, setAttempt] = useState(0);
  const [said, setSaid] = useState<{ text: string; alarm?: boolean } | null>(null);
  const p = wholeNumber(pours);
  const m = wholeNumber(ml);
  // Said grouped, as every count on this page is (INV-W33).
  const pText = p === null ? '' : fmtCount(p);
  const mText = m === null ? '' : fmtCount(m);

  const pour = useMutation({
    mutationFn: () => recordPour(row.id, { pours: p ?? 1, pourMl: m, source: 'manual', reason: 'Recorded by hand', idempotencyKey }),
    onSuccess: () => {
      invalidate();
      setSaid({ text: `Recorded ${pText} pour${p === 1 ? '' : 's'} of ${mText} ml from ${titleOf(row)}.` });
    },
    onError: (e) => {
      setAttempt((a) => a + 1);
      const f = writeFailure(e, { refused: 'Nothing was recorded', act: 'the pour was recorded', check: SAFE_RETRY });
      if (f.unknown) invalidate();
      setSaid({ text: f.text, alarm: true });
    },
  });

  const blocked =
    p === null || p < 1
      ? 'Record at least one pour.'
      : m === null || m < 1
        ? row.pourMl === null
          ? 'This row has no pour size recorded. Say how many millilitres each pour was.'
          : 'A pour size is a whole number of millilitres.'
        : null;

  return (
    <Sheet
      open
      bodyClassName="iv-sheet-body"
      onClose={onClose}
      label={`Record glasses poured from ${titleOf(row)} by hand, sealed before the open bottle changes`}
      eyebrow="Record a pour"
      title={titleOf(row)}
      footer={<span>For a pour the till did not ring up. A rung-up pour is recorded by the till.</span>}
    >
      <div className="iv-sheet-fields">
        <CountInput label="Pours" value={pours} onChange={setPours} min={1} />
        <CountInput label="Millilitres each" value={ml} onChange={setMl} min={1} max={3000} />
      </div>
      {blocked ? <p className="iv-note">{blocked}</p> : null}
      <div style={{ marginTop: 14 }}>
        <HoldToApprove
          key={`pour-${attempt}`}
          label={blocked ? 'Not ready to record' : `Hold to record ${pText} × ${mText} ml`}
          approvedLabel="Pour recorded"
          disabled={blocked !== null || pour.isPending || pour.isSuccess}
          onApprove={() => pour.mutateAsync()}
        />
      </div>
      {said ? <Said alarm={said.alarm}>{said.text}</Said> : null}
    </Sheet>
  );
}

/* ── Order more ─────────────────────────────────────────────────────────── */

/**
 * What the hold did, in the order's own state (INV-W20). createOrder places a
 * pending order and contacts nobody; a person approves it on Orders and sends
 * the letter from there. When the vendor already had an open order for this
 * title the gateway changes that one instead and answers with its status.
 */
type PlacedOrder = { id?: string; status?: string; quantity?: number; requestedAt?: string };

/** An open order older than this when the answer came back was changed, not placed. */
export const MERGE_AGE_MS = 120_000;

/**
 * Whether the gateway changed an open order instead of placing one. The answer
 * carries no merged flag (`procurement.service.ts:1133-1201` returns the updated
 * row), so it is read from the row: a status past pending, or a request time
 * older than the place moment. The gateway flag is on the F-list.
 */
export function orderWasMerged(order: PlacedOrder | undefined, placedAt: number): boolean {
  const status = (order?.status ?? '').toLowerCase();
  if (status !== '' && status !== 'pending') return true;
  const asked = order?.requestedAt ? Date.parse(order.requestedAt) : NaN;
  return Number.isFinite(asked) && placedAt - asked > MERGE_AGE_MS;
}

export function placedSentence(order: PlacedOrder | undefined, asked: number | null, vendor: string, merged: boolean): string {
  const q = order?.quantity ?? asked;
  const qty = q == null ? null : fmtCount(q);
  const status = (order?.status ?? '').toLowerCase();
  // The sealed hold above already says "Placed on Orders" (INV-W32), so this says what was placed.
  if (!merged) return qty === null ? `From ${vendor}, waiting for approval.` : `${qty} ${q === 1 ? 'bottle' : 'bottles'} from ${vendor}, waiting for approval.`;
  const was = `${vendor} already had an open order for this title (${(status || 'pending').replace(/_/g, ' ')})`;
  // No quantity read back is said as such, never as "null" (INV-W33).
  return qty === null
    ? `${was}; Orders shows what it now asks for. Nothing new was sent from here.`
    : `${was}; it now asks for ${qty}. Nothing new was sent from here.`;
}

/** What the Order sheet says once the gateway has answered, and the email that follows (INV-W26). */
function Placed({
  order,
  asked,
  vendorName,
  merged,
  restaurantId,
}: {
  order: PlacedOrder;
  asked: number | null;
  vendorName: string;
  merged: boolean;
  restaurantId: string | null;
}) {
  return (
    <>
      <Said>{placedSentence(order, asked, vendorName, merged)}</Said>
      {merged ? (
        <p className="iv-note">
          No new email was drafted for this change. An email written when the order was first placed may still ask for
          the earlier quantity; read it on Orders before it goes.{' '}
          <Link to="/orders" className="iv-linkish iv-focus">
            Open Orders
          </Link>
        </p>
      ) : order.id ? (
        <OrderLetter orderId={order.id} vendorName={vendorName} needsApproval restaurantId={restaurantId} />
      ) : (
        <p className="iv-note">The server did not say which order this is, so its email is on Orders.</p>
      )}
    </>
  );
}

export function OrderSheet({
  row,
  onClose,
  providers,
  providersError,
  restaurantId,
}: SheetProps & { providers: Provider[] | null; providersError: string | null; restaurantId: string | null }) {
  const queryClient = useQueryClient();
  const settings = useCellarSettings();
  const recs = useRecommendedProviders(restaurantId ?? '', row.wineId ?? '');
  const [picked, setVendorId] = useState(row.providerId ?? '');
  // INV-W21: the row's usual vendor is only a choice while it is in the vendor
  // book; otherwise the hold would order from a vendor nobody can see here.
  const vendorId = providers?.some((p) => p.id === picked) ? picked : '';
  // INV-W21: the suggestion to par, or nothing. A made-up 6 was a default.
  const [qty, setQty] = useState(() => {
    const s = suggestedToPar(row);
    return s === null ? '' : String(s);
  });
  const n = wholeNumber(qty);
  // A blocked sheet never says the count, so a null one reads as nothing (INV-W33).
  const nText = n === null ? '' : fmtCount(n);
  const toPar = suggestedToPar(row);

  const recommendedIds = useMemo(() => {
    const s = new Set<string>();
    if (recs.data?.primary?.id) s.add(recs.data.primary.id);
    for (const p of recs.data?.alternatives ?? []) s.add(p.id);
    return s;
  }, [recs.data]);

  // The same write as BottleLeaf.tsx:211-225: one order is one title
  // (procurement_orders.inventory_id is NOT NULL), so there is no basket.
  const [placedAt, setPlacedAt] = useState(0);
  const order = useMutation({
    mutationFn: async (body: { inventoryId: string; providerId: string; quantity: number }) => {
      const r = await apiClient.post('/procurement/orders', { ...body, unitType: 'bottle' });
      return r.data as PlacedOrder;
    },
    onSuccess: () => {
      setPlacedAt(Date.now());
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });

  const orderUnknown = order.isError && isUnconfirmedWrite(order.error);
  const merged = order.isSuccess && orderWasMerged(order.data, placedAt);
  // Said once, on the seal; the sentence under it says what (INV-W32).
  const sealedLabel = merged ? 'Changed on Orders' : 'Placed on Orders';
  const vendorName = providers?.find((p) => p.id === vendorId)?.name ?? 'this vendor';
  const noVendors = !providersError && providers !== null && providers.length === 0;
  const blocked = providersError
    ? `The vendor book could not be read — ${providersError}. No vendor can be chosen, so nothing can be ordered from here.`
    : noVendors
      ? 'This house has no vendors on file yet, so there is no one to order from.'
      : !vendorId
        ? 'Choose the vendor this order goes to.'
        : qty.trim() === ''
          ? 'Type how many bottles to order.'
          : n === null || n < 1
            ? 'Order at least one whole bottle.'
            : null;

  return (
    <Sheet
      open
      bodyClassName="iv-sheet-body"
      onClose={onClose}
      label={`Order more of ${titleOf(row)} from one vendor; its email to the vendor is shown here to read before it goes`}
      eyebrow="Order more"
      title={titleOf(row)}
      footer={
        <span>
          One order is one title. Placing it has the AI draft the email to the vendor, shown here to read before it goes,
          unless this house has set that vendor to take order emails without review.
        </span>
      }
    >
      <p className="iv-said">
        {toPar !== null && row.par !== null
          ? `${fmtCount(toPar)} bring it back to par (${fmtCount(row.par)}).`
          : row.par === null || row.par <= 0
            ? 'No par is set on this row, so there is no suggested quantity.'
            : row.stock === null
              ? 'The stock could not be read, so there is no suggested quantity.'
              : 'It is at or above par, so there is no suggested quantity.'}
      </p>
      <div className="iv-sheet-fields">
        <Select
          label="Vendor"
          value={vendorId}
          onChange={setVendorId}
          placeholder={providers && providers.length > 0 ? 'Choose a vendor…' : 'No vendors on file'}
          disabled={!providers || providers.length === 0}
          options={(providers ?? []).map((p) => ({
            value: p.id,
            label: `${p.name}${recommendedIds.has(p.id) ? ' — recommended for this bottle' : ''}`,
          }))}
        />
        <CountInput label="Bottles" value={qty} onChange={setQty} min={1} />
      </div>
      {recs.isError ? (
        <p className="iv-note">The vendor recommendation could not be read — the list above is the plain roster, unranked.</p>
      ) : null}
      {blocked ? (
        <p className="iv-note">
          {blocked}
          {noVendors ? (
            <>
              {' '}
              <Link to="/vendors" className="iv-linkish iv-focus">
                Add a vendor
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      <div style={{ marginTop: 14 }}>
        {blocked ? (
          // The same not-ready track the other four sheets draw (format, 2026-10-01).
          <HoldToApprove label="Not ready to place" approvedLabel="Placed on Orders" disabled onApprove={() => undefined} />
        ) : (
          <OrderCeremony
            ceremony={settings.data.holdCeremony}
            label={order.isSuccess ? sealedLabel : `Hold to place ${nText} with ${vendorName}`}
            approvedLabel={sealedLabel}
            pending={order.isPending}
            // The seal stays on screen, faded, as on the other four sheets (INV-W32).
            // `sent` would swap it for /cellar's plain button. `disabled` keeps the
            // guard `sent` gives: a remount after success can never re-arm the hold,
            // and its label still reads the seal's words.
            sent={false}
            disabled={order.isSuccess}
            errorMessage={order.isError ? failureReason(order.error) : null}
            onApprove={() => order.mutateAsync({ inventoryId: row.id, providerId: vendorId, quantity: n ?? 0 })}
            words={{
              ask: 'Place it on Orders?',
              yes: 'Yes, place it',
              busy: 'Placing…',
              nothingSent: 'Nothing was placed. Try again when ready.',
              // A 5xx or no answer may have placed it (INV-W31). The gateway folds a
              // repeat into the open order, but that lookup fails open, so no promise.
              ...(orderUnknown
                ? { failedLead: 'It is not known whether the order was placed', after: 'Look on Orders before placing it again.' }
                : { failedLead: 'Nothing was placed' }),
            }}
          />
        )}
        {!blocked && !order.isSuccess ? (
          <p className="iv-note" style={{ marginTop: 6 }}>
            If {vendorName} already has an open order for this title, that order is changed to {nText}, not added to.
          </p>
        ) : null}
      </div>
      {order.isSuccess ? <Placed order={order.data} asked={n} vendorName={vendorName} merged={merged} restaurantId={restaurantId} /> : null}
    </Sheet>
  );
}
