/**
 * New delivery → No order on file → When was this ordered? → Add to the books
 * (F-669, founder S198; ADR 0103 D5 as amended 2026-10-11).
 *
 * A truck turns up and nobody placed an order in the app: the manager phoned
 * it in, or the vendor sent it on a standing habit. The door says who brought
 * what and how much, answers "When was this ordered?" (Don't know is chosen
 * already, so the question never holds up the truck), and one tap writes the
 * order, already delivered, as "Logged at door" and counts it into stock.
 *
 * NO PRICES, as everywhere at the door: the money comes from the paper when a
 * manager checks it at the desk. One id per tap: pressing Add to the books
 * again after a dropped answer reuses the same order and never books twice.
 *
 * The id binds to what was said (F-1501): any edit mints a new one, and the
 * fields lock whenever the order may be on the books (written, or no answer
 * came back), so a spent id is never sent with different answers. A tap that
 * may be on the books is kept on this phone (F-1500): closing the sheet and
 * opening it again brings the same truck back under the same id to finish,
 * instead of a second order beside a stranded one.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { useAuth } from '@/contexts/AuthContext';
import { getErrorMessage, getErrorStatus, isUnconfirmedWrite } from '@/services/api/client';
import { receivingApi, type LogAtDoorRequest, type LogAtDoorResponse } from '@/services/api/receiving';
import { useInventory } from '@/hooks/queries/useInventoryQueries';
import { useProviders } from '@/hooks/queries/useProviderQueries';
import { EM, SANS } from './rc-format';

type OrderedOn = LogAtDoorRequest['orderedOn'];

const ORDERED_ON: Array<{ value: OrderedOn; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'unknown', label: 'Don’t know' },
];

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Older phones: a v4-shaped id from Math.random is still one id per tap.
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16),
    );
  }
}

/** A tap that may be on the books and is not finished, kept per house. */
interface PendingTap {
  key: string;
  providerId: string;
  inventoryId: string;
  quantity: string;
  unit: 'case' | 'bottle';
  bottlesPerCase: string;
  orderedOn: OrderedOn;
  initials: string;
  writtenOrderId: string | null;
}

const pendingSlot = (restaurantId: string) => `mudavym:door:no-order-pending:${restaurantId}`;

function readPending(restaurantId: string): PendingTap | null {
  try {
    const raw = localStorage.getItem(pendingSlot(restaurantId));
    const p = raw ? (JSON.parse(raw) as PendingTap) : null;
    return p && typeof p.key === 'string' && p.key !== '' ? p : null;
  } catch {
    return null;
  }
}

function writePending(restaurantId: string, p: PendingTap | null): void {
  if (!restaurantId) return;
  try {
    if (p) localStorage.setItem(pendingSlot(restaurantId), JSON.stringify(p));
    else localStorage.removeItem(pendingSlot(restaurantId));
  } catch {
    // Storage refused (private window): the sheet still works, it just cannot
    // bring an unfinished tap back after it is closed.
  }
}

/** One shelf line in the wine picker: name, producer, vintage, and the size
 *  when it is not a standard bottle, so two vintages never read the same. */
export function doorWineLabel(i: Record<string, any>): string {
  const name = String(i.wineName ?? EM);
  const producer = typeof i.wineProducer === 'string' ? i.wineProducer.trim() : '';
  const vintage = i.wineVintage != null && String(i.wineVintage).trim() !== '' ? String(i.wineVintage).trim() : '';
  const ml = Number(i.bottleSizeMl);
  const parts = [name];
  if (producer && !name.toLowerCase().includes(producer.toLowerCase())) parts.push(producer);
  if (vintage && !name.includes(vintage)) parts.push(vintage);
  if (Number.isFinite(ml) && ml > 0 && ml !== 750) parts.push(`${ml} ml`);
  return parts.join(' · ');
}

/** The phone's own date, `YYYY-MM-DD`: what "Today" means at this door. */
export function phoneToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const field: CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '0 10px',
  borderRadius: 10,
  border: '1px solid var(--rule, rgba(33,28,22,.18))',
  background: 'var(--paper-0, #FBF8F1)',
  color: 'var(--ink-1, #211C16)',
  fontFamily: SANS,
  fontSize: 14,
};
const caption: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-2, #4F473C)',
  margin: '14px 0 6px',
};

export function NoOrderOnFileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeRestaurantId, user } = useAuth();
  const restaurantId = activeRestaurantId || user?.restaurantId || '';
  const inventory = useInventory();
  const providers = useProviders(restaurantId);
  const queryClient = useQueryClient();

  const [providerId, setProviderId] = useState('');
  const [inventoryId, setInventoryId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<'case' | 'bottle'>('case');
  const [bottlesPerCase, setBottlesPerCase] = useState('');
  const [orderedOn, setOrderedOn] = useState<OrderedOn>('unknown');
  const [initials, setInitials] = useState('');
  const [key, setKey] = useState(newKey);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** Set once the order is written, even if the count did not land: the
   *  fields then hold still, so pressing again finishes the SAME order. */
  const [writtenOrderId, setWrittenOrderId] = useState<string | null>(null);
  /** No answer came back (a timeout, a dropped line, a 5xx): the order may be
   *  on the books, so the fields hold still and the same id goes again. */
  const [maybeWritten, setMaybeWritten] = useState(false);
  /** The id was already spent on different answers (409): pressing again
   *  would only repeat it, so the button goes away. */
  const [spent, setSpent] = useState(false);
  const [done, setDone] = useState<LogAtDoorResponse | null>(null);

  // Each opening is a new truck: fresh fields and a fresh tap id, unless a
  // tap from before may be on the books and is not finished. Then that same
  // truck comes back under the same id, to be finished, never booked again.
  useEffect(() => {
    if (!open) return;
    const pending = restaurantId ? readPending(restaurantId) : null;
    setProviderId(pending?.providerId ?? '');
    setInventoryId(pending?.inventoryId ?? '');
    setQuantity(pending?.quantity ?? '');
    setUnit(pending?.unit === 'bottle' ? 'bottle' : 'case');
    setBottlesPerCase(pending?.bottlesPerCase ?? '');
    setOrderedOn(pending?.orderedOn ?? 'unknown');
    setInitials(pending?.initials ?? '');
    setKey(pending?.key ?? newKey());
    setSending(false);
    setFailure(
      pending
        ? 'This delivery was started here and not finished: it may already be on the books. Tap Add to the books again to finish it. The same delivery is used and nothing is booked twice.'
        : null,
    );
    setWrittenOrderId(pending?.writtenOrderId ?? null);
    setMaybeWritten(pending !== null && !pending.writtenOrderId);
    setSpent(false);
    setDone(null);
  }, [open, restaurantId]);

  const vendors = useMemo(() => (providers.data ?? []) as Array<Record<string, any>>, [providers.data]);
  const shelf = useMemo(() => (inventory.data ?? []) as Array<Record<string, any>>, [inventory.data]);

  const qty = Number.parseInt(quantity, 10);
  const perCase = Number.parseInt(bottlesPerCase, 10);
  const qtyOk = Number.isInteger(qty) && qty >= 1 && String(qty) === quantity.trim();
  const perCaseOk = unit === 'bottle' || (Number.isInteger(perCase) && perCase >= 1 && String(perCase) === bottlesPerCase.trim());
  const ready = providerId !== '' && inventoryId !== '' && qtyOk && perCaseOk && !sending && !done && !spent;
  const locked = sending || writtenOrderId !== null || maybeWritten || spent || done !== null;
  /** The order may be on the books and is not finished. */
  const owed = !done && !spent && (writtenOrderId !== null || maybeWritten);

  /** An edit is a different delivery: it gets its own id. Only reachable
   *  while the fields are open, which is only when nothing can be written. */
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setKey(newKey());
    };

  const missing = !providerId
    ? 'Choose who brought it.'
    : !inventoryId
      ? 'Choose the drink.'
      : !qtyOk
        ? `Say how many ${unit === 'case' ? 'cases' : 'bottles'} came.`
        : !perCaseOk
          ? 'Say how many bottles are in each case.'
          : null;

  const add = async () => {
    if (!ready) return;
    setSending(true);
    setFailure(null);
    try {
      const out = await receivingApi.logAtDoor({
        key,
        providerId,
        inventoryId,
        quantity: qty,
        unit,
        ...(unit === 'case' ? { bottlesPerCase: perCase } : {}),
        orderedOn,
        phoneToday: phoneToday(),
        clientCapturedAt: new Date().toISOString(),
        ...(initials.trim() ? { signedByInitials: initials.trim() } : {}),
      });
      setDone(out);
      writePending(restaurantId, null);
      void queryClient.invalidateQueries();
    } catch (err) {
      const body = (err as { response?: { data?: { orderId?: unknown; reason?: unknown } } })?.response?.data;
      const keep = (written: string | null) =>
        writePending(restaurantId, {
          key,
          providerId,
          inventoryId,
          quantity,
          unit,
          bottlesPerCase,
          orderedOn,
          initials,
          writtenOrderId: written,
        });
      if (getErrorStatus(err) === 409) {
        // The id was spent on other answers: something IS on the books, the
        // server said what. Nothing is owed from this phone any more.
        setSpent(true);
        writePending(restaurantId, null);
        setFailure(getErrorMessage(err));
      } else if (typeof body?.orderId === 'string') {
        setWrittenOrderId(body.orderId);
        keep(body.orderId);
        setFailure(getErrorMessage(err));
      } else if (isUnconfirmedWrite(err) && body?.reason !== 'logged_order_unreadable') {
        setMaybeWritten(true);
        keep(writtenOrderId);
        setFailure(
          getErrorStatus(err) === null
            ? 'No answer came back, so this delivery may already be on the books. Tap Add to the books again: the same delivery is used and nothing is booked twice.'
            : `${getErrorMessage(err)} It may already be on the books, so the answers stay as they are and the same delivery is used.`,
        );
      } else {
        // A refusal: this tap wrote nothing. The fields are as open as they
        // were (still held if an earlier try may be on the books), and an
        // edit gets its own id.
        setFailure(getErrorMessage(err));
      }
    } finally {
      setSending(false);
    }
  };

  const unitWord = (n: number) =>
    unit === 'case' ? (n === 1 ? 'case' : 'cases') : n === 1 ? 'bottle' : 'bottles';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      dirty={sending || owed}
      label="Add a delivery that came with no order on file. Adding it writes the order as logged at the door and counts the bottles into stock. Leaving writes nothing."
      eyebrow="New delivery"
      title="No order on file"
      closeLabel={done ? 'Done' : 'Put it down'}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-4, #665D50)' }}>
            {done ? 'Added to the books.' : (missing ?? 'No prices here: the manager checks the paper at the desk.')}
          </span>
          {!done && !spent && (
            <button
              type="button"
              onClick={() => void add()}
              disabled={!ready}
              data-testid="logged-at-door-add"
              style={{
                fontFamily: SANS,
                fontSize: 13,
                fontWeight: 600,
                minHeight: 44,
                padding: '0 16px',
                borderRadius: 10,
                border: '1px solid var(--seal, #1A5E6B)',
                background: ready ? 'var(--seal, #1A5E6B)' : 'transparent',
                color: ready ? 'var(--paper-0, #FBF8F1)' : 'var(--ink-4, #665D50)',
                cursor: ready ? 'pointer' : 'not-allowed',
              }}
            >
              {sending ? 'Adding…' : owed ? 'Add to the books again' : 'Add to the books'}
            </button>
          )}
        </div>
      }
    >
      <div style={{ fontFamily: SANS }}>
        {done ? (
          <p role="status" data-testid="logged-at-door-done" style={{ fontSize: 14, color: 'var(--ink-1, #211C16)' }}>
            {`Logged at door${done.orderNumber ? ` as order ${done.orderNumber}` : ''}: ${qty} ${unitWord(qty)} counted into stock.`}
            {done.orderAlreadyWritten ? ' It had already been added, so nothing was booked twice.' : ''}
          </p>
        ) : (
          <>
            <label style={caption} htmlFor="lad-vendor">Who brought it?</label>
            <select
              id="lad-vendor"
              style={field}
              value={providerId}
              disabled={locked}
              onChange={(e) => edit(setProviderId)(e.target.value)}
            >
              <option value="">{providers.isLoading ? 'Loading vendors…' : 'Choose a vendor'}</option>
              {vendors.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {String(p.name ?? EM)}
                </option>
              ))}
            </select>
            {providers.isError && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '6px 0 0' }}>
                The vendor list did not load. Write the delivery down on paper and tell a manager.
              </p>
            )}

            <label style={caption} htmlFor="lad-wine">What came?</label>
            <select
              id="lad-wine"
              style={field}
              value={inventoryId}
              disabled={locked}
              onChange={(e) => edit(setInventoryId)(e.target.value)}
            >
              <option value="">{inventory.isLoading ? 'Loading the shelf…' : 'Choose a drink'}</option>
              {shelf.map((i) => (
                <option key={String(i.id)} value={String(i.id)}>
                  {doorWineLabel(i)}
                </option>
              ))}
            </select>
            {inventory.isError && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '6px 0 0' }}>
                The shelf list did not load. Write the delivery down on paper and tell a manager.
              </p>
            )}

            <span style={caption}>How many came?</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                aria-label="How many came"
                inputMode="numeric"
                style={{ ...field, flex: 1 }}
                value={quantity}
                disabled={locked}
                onChange={(e) => edit(setQuantity)(e.target.value)}
              />
              <select
                aria-label="Cases or bottles"
                style={{ ...field, flex: 1 }}
                value={unit}
                disabled={locked}
                onChange={(e) => edit(setUnit)(e.target.value === 'bottle' ? 'bottle' : 'case')}
              >
                <option value="case">Cases</option>
                <option value="bottle">Bottles</option>
              </select>
            </div>
            {unit === 'case' && (
              <>
                <label style={caption} htmlFor="lad-per-case">Bottles in each case</label>
                <input
                  id="lad-per-case"
                  inputMode="numeric"
                  style={field}
                  value={bottlesPerCase}
                  disabled={locked}
                  onChange={(e) => edit(setBottlesPerCase)(e.target.value)}
                />
              </>
            )}

            <span style={caption} id="lad-when">When was this ordered?</span>
            <div role="radiogroup" aria-labelledby="lad-when" style={{ display: 'flex', gap: 8 }}>
              {ORDERED_ON.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={orderedOn === o.value}
                  disabled={locked}
                  onClick={() => edit(setOrderedOn)(o.value)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 10,
                    fontFamily: SANS,
                    fontSize: 13,
                    border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                    background: orderedOn === o.value ? 'var(--seal, #1A5E6B)' : 'transparent',
                    color: orderedOn === o.value ? 'var(--paper-0, #FBF8F1)' : 'var(--ink-1, #211C16)',
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <label style={caption} htmlFor="lad-initials">Your initials (optional)</label>
            <input
              id="lad-initials"
              maxLength={8}
              style={field}
              value={initials}
              disabled={locked}
              onChange={(e) => edit(setInitials)(e.target.value)}
            />

            {failure && (
              <p role="alert" data-testid="logged-at-door-failure" style={{ fontSize: 12.5, color: 'var(--ink-1, #211C16)', marginTop: 14 }}>
                {failure}
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

export default NoOrderOnFileSheet;
