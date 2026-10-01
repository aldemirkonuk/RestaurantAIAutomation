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
import { CountInput, HoldToApprove, Select, Sheet } from '@/components/mudavym';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import { estimateCountFromPhoto, recordPour, transferStock } from '../../../services/api/inventory';
import type { Provider } from '../../../services/api/providers';
import type { StorageLocation } from '../../../hooks/useStorageLocations';
import { useRecommendedProviders } from '../../../hooks/queries/useProviderQueries';
import { queryKeys } from '../../../lib/query-keys';
import { newClientCountId, submitSpotCount } from '../../../lib/spotCountOutbox';
import { SCAN_ACCEPT } from '../../../lib/uploadAccept';
import OrderCeremony from '../../cellar/next/OrderCeremony';
import { useCellarSettings } from '../../cellar/next/useCellarNextData';
import { EM, suggestedToPar, type InvRow } from './useInventoryNextData';

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
    <p role={alarm ? 'alert' : 'status'} className="iv-said" style={{ marginTop: 12, color: alarm ? 'var(--alarm)' : undefined }}>
      {children}
    </p>
  );
}

interface SheetProps {
  row: InvRow;
  onClose: () => void;
}

/* ── Record a count ─────────────────────────────────────────────────────── */

export function CountSheet({ row, onClose }: SheetProps) {
  const invalidate = useInvalidateStock();
  const [clientCountId] = useState(newClientCountId);
  const [qty, setQty] = useState(row.stock === null ? '' : String(row.stock));
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
          ? `Counted ${countedQty}. The book for ${titleOf(row)} now reads ${countedQty}.`
          : `Held on this device — not yet confirmed. The count of ${countedQty} goes out when the connection returns; until then the book still reads what it read.`,
      });
    },
    onError: (e) => {
      setAttempt((n) => n + 1);
      setSaid({ text: `Nothing was recorded — the gateway refused the count (${getErrorMessage(e)}).`, alarm: true });
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
            ? `The photo suggests ${estimate.suggestedQty} (${estimate.confidence} confidence). It only fills the field — check it before you seal. ${estimate.note}`
            : `The photo gave no confident count. ${estimate.note}`,
      });
    } catch (e) {
      setPhoto({ busy: false, note: `The photo could not be read (${getErrorMessage(e)}). Type the count instead.` });
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      label={`Record a count of ${titleOf(row)}: what is on the shelf, sealed before the book changes`}
      eyebrow="Record a count"
      title={titleOf(row)}
      footer={<span>A count sets the book to what was counted and stamps the last-counted date.</span>}
    >
      <p className="iv-said">
        The book reads {row.stock === null ? `${EM} (not read)` : row.stock}. Count what is on the shelf, then hold to seal it.
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
          label={counted === null ? 'Type the count first' : `Hold to record ${counted}`}
          approvedLabel="Count recorded"
          boundSummary={counted === null ? undefined : `${titleOf(row)}: ${counted} counted`}
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
      setSaid({ text: `Written off: ${n} × ${titleOf(row)}, as ${kind?.label.toLowerCase()}. The last-counted date is unchanged.` });
    },
    onError: (e) => {
      setAttempt((a) => a + 1);
      setSaid({ text: `Nothing was written off — the gateway refused it (${getErrorMessage(e)}).`, alarm: true });
    },
  });

  const blocked = !row.wineId
    ? 'This row is not tied to a library wine, and the ledger needs one, so it cannot be written off from here.'
    : !kind
      ? 'Choose why the bottles left.'
      : n === null || n < 1
        ? 'Write off at least one whole bottle.'
        : row.stock !== null && n > row.stock
          ? `The book holds ${row.stock}; a write-off cannot take it below zero. If the book is wrong, record a count first.`
          : null;

  return (
    <Sheet
      open
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
          label={blocked ? 'Not ready to write off' : `Hold to write off ${n}`}
          approvedLabel="Written off"
          boundSummary={blocked ? undefined : `${titleOf(row)}: −${n}, ${kind?.label.toLowerCase()}`}
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

  const nameOf = (id: string | null) =>
    id === null ? 'Unassigned' : (locations.find((l) => l.id === id)?.name ?? 'a zone this page cannot name');
  const fromOptions = (row.zones ?? [])
    .filter((z) => z.qty > 0)
    .map((z) => ({ value: z.locationId ?? UNASSIGNED, label: `${nameOf(z.locationId)} · ${z.qty}` }));
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
      setSaid({ text: `Moved ${n} from ${from === UNASSIGNED ? 'Unassigned' : nameOf(from)} to ${to === UNASSIGNED ? 'Unassigned' : nameOf(to)}.` });
    },
    onError: (e) => {
      setAttempt((a) => a + 1);
      setSaid({ text: `Nothing moved — the gateway refused the transfer (${getErrorMessage(e)}).`, alarm: true });
    },
  });

  const blocked = locationsUnavailable
    ? 'The storage locations could not be read, so no zone can be named and nothing can be moved.'
    : row.zones === null
      ? 'Where this title sits could not be read, so there is nothing to move from.'
      : fromOptions.length === 0
        ? 'No zone holds a bottle of this title.'
        : !from || !to
          ? 'Choose where the bottles come from and where they go.'
          : n === null || n < 1
            ? 'Move at least one whole bottle.'
            : held !== null && n > held
              ? `That zone holds ${held}.`
              : null;

  return (
    <Sheet
      open
      onClose={onClose}
      label={`Move bottles of ${titleOf(row)} between zones, sealed before the books change`}
      eyebrow="Transfer"
      title={titleOf(row)}
      footer={<span>A transfer moves bottles between zones; the total on the book does not change.</span>}
    >
      <div className="iv-sheet-fields">
        <Select label="From" value={from} onChange={setFrom} placeholder="Choose a zone…" options={fromOptions} disabled={fromOptions.length === 0} />
        <Select label="To" value={to} onChange={setTo} placeholder="Choose a zone…" options={toOptions} disabled={locationsUnavailable} />
        <CountInput label="Bottles" value={qty} onChange={setQty} min={1} max={held ?? 100_000} />
      </div>
      {blocked ? <p className="iv-note">{blocked}</p> : null}
      <div style={{ marginTop: 14 }}>
        <HoldToApprove
          key={`tr-${attempt}`}
          label={blocked ? 'Not ready to move' : `Hold to move ${n}`}
          approvedLabel="Moved"
          disabled={blocked !== null || move.isPending || move.isSuccess}
          onApprove={() => move.mutateAsync()}
        />
      </div>
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

  const pour = useMutation({
    mutationFn: () => recordPour(row.id, { pours: p ?? 1, pourMl: m, source: 'manual', reason: 'Recorded by hand', idempotencyKey }),
    onSuccess: () => {
      invalidate();
      setSaid({ text: `Recorded ${p} pour${p === 1 ? '' : 's'} of ${m} ml from ${titleOf(row)}.` });
    },
    onError: (e) => {
      setAttempt((a) => a + 1);
      setSaid({ text: `Nothing was recorded — the gateway refused the pour (${getErrorMessage(e)}).`, alarm: true });
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
          label={blocked ? 'Not ready to record' : `Hold to record ${p} × ${m} ml`}
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
  const [vendorId, setVendorId] = useState(row.providerId ?? '');
  const [qty, setQty] = useState(String(suggestedToPar(row) ?? 6));
  const n = wholeNumber(qty);

  const recommendedIds = useMemo(() => {
    const s = new Set<string>();
    if (recs.data?.primary?.id) s.add(recs.data.primary.id);
    for (const p of recs.data?.alternatives ?? []) s.add(p.id);
    return s;
  }, [recs.data]);

  // The same write as BottleLeaf.tsx:211-225: one order is one title
  // (procurement_orders.inventory_id is NOT NULL), so there is no basket.
  const order = useMutation({
    mutationFn: async (body: { inventoryId: string; providerId: string; quantity: number }) => {
      const r = await apiClient.post('/procurement/orders', { ...body, unitType: 'bottle' });
      return r.data as { id?: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });

  const vendorName = providers?.find((p) => p.id === vendorId)?.name ?? 'this vendor';
  const blocked = providersError
    ? `The vendor book could not be read (${providersError}) — no vendor can be chosen, so nothing can be ordered from here.`
    : !vendorId
      ? 'Choose the vendor this order goes to.'
      : n === null || n < 1
        ? 'Order at least one whole bottle.'
        : null;

  return (
    <Sheet
      open
      onClose={onClose}
      label={`Order more of ${titleOf(row)} from one vendor, held before it is sent`}
      eyebrow="Order more"
      title={titleOf(row)}
      footer={<span>One order is one title. It goes on Orders the moment it is sent.</span>}
    >
      <p className="iv-said">
        {suggestedToPar(row) !== null
          ? `${suggestedToPar(row)} bring it back to par (${row.par}).`
          : row.par === null || row.par <= 0
            ? 'No par is set on this row, so there is no suggested quantity.'
            : row.stock === null
              ? 'The stock could not be read, so there is no suggested quantity.'
              : 'It is at or above par.'}
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
        <p className="iv-note">The vendor recommendation could not be fetched — the list above is the plain roster, unranked.</p>
      ) : null}
      <div style={{ marginTop: 14 }}>
        {blocked ? (
          <>
            <button type="button" className="iv-btn" disabled>
              Order {n ?? EM}
            </button>
            <p className="iv-note" style={{ marginTop: 6 }}>
              {blocked}
            </p>
          </>
        ) : (
          <OrderCeremony
            ceremony={settings.data.holdCeremony}
            label={`Hold to order ${n} from ${vendorName}`}
            approvedLabel="Order sent"
            pending={order.isPending}
            sent={order.isSuccess}
            errorMessage={order.isError ? (order.error instanceof Error ? order.error.message : 'the gateway refused it') : null}
            onApprove={() => order.mutateAsync({ inventoryId: row.id, providerId: vendorId, quantity: n ?? 0 })}
          />
        )}
      </div>
      {order.isSuccess ? <Said>Order sent to {vendorName}. It is on Orders now.</Said> : null}
    </Sheet>
  );
}
