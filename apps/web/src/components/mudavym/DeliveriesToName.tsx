/**
 * Deliveries that booked nothing, waiting for an owner or a manager to name
 * their item — and the way to name it.
 *
 * The founder, 2026-09-22 (round 6u), verbatim pick: *"Deliver, flag to name
 * it (Recommended)"* — a delivery whose order names no house item or resolves
 * to zero bottles stays "delivered, nothing booked" and asks an owner or a
 * manager to name the item; naming it books the stock then, once (ADR 0192,
 * third amendment).
 *
 * MOVED HERE, AND REBUILT ON THE HOUSE CONTROLS — founder, 2026-09-22
 * (round 6z), verbatim pick 8: *"Queue it; Mudavym + hold (Recommended)"*.
 * This card lived at `pages/inventory/command/DeliveriesToName.tsx`, drawn
 * with a plain `<select>`, a plain text `<input>` and a plain `<button>` —
 * the E4 last call named the gap directly ("the /inventory card is not in
 * Mudavym components (components/mudavym has no select or count input) and
 * has no ADR 0134 motion"). It is now built on `Select`, `CountInput` (both
 * new, same file as this one's move) and `HoldToApprove` (ADR 0112 · 1d;
 * `lib/mudavym/motion.ts` — no separate motion file for this card, so its
 * one act, naming, gets the house's one hold-to-approve motion rather than a
 * bespoke transition of its own).
 *
 * - The item is chosen by its id (the house's own items), never typed as a
 *   name (`Select`, ADR 0141/0192).
 * - Only an owner or a manager is offered the form (`viewer.mayName`, from
 *   the gateway, which checks again). Anyone else is told who can.
 * - A failed read is said on the page, never shown as "nothing waiting".
 * - What the page says after naming is the gateway's own sentence, and it
 *   stays said after the refetched list drops the delivery it was about
 *   (the card holds it, not the row).
 * - A client-side refusal (no item chosen, a bad count) and a server
 *   refusal both keep `HoldToApprove` from sealing — it reverts to idle so
 *   naming can be tried again — and both are said in the card's own words,
 *   not just the control's generic "could not be confirmed" line
 *   (`copy.unconfirmed` is left blank here on purpose; this card's own
 *   paragraph is the one true message).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  fetchDeliveriesToName,
  nameDeliveredItem,
  type DeliveryToName,
} from '../../services/api/orders';
import { getErrorMessage } from '../../services/api/client';
import { HoldToApprove } from './HoldToApprove';
import { Select } from './Select';
import { CountInput } from './CountInput';

export const DELIVERIES_TO_NAME_KEY = ['procurement', 'items-to-name'] as const;

export interface NameableItem {
  inventoryId?: string;
  name?: string | null;
}

/** The most bottles one naming may book — mirrors NAMED_BOTTLES_MAX (delivery-item-to-name.ts); a typo guard, not a business rule. */
const NAMED_BOTTLES_MAX = 100_000;

function whatHappened(d: DeliveryToName): string {
  const order = d.orderNumber ?? 'An order';
  return d.why === 'zero_bottles'
    ? `${order} was delivered with no bottle count, so no stock was booked.`
    : `${order} was delivered naming no item, so no stock was booked.`;
}

function OneDelivery({
  delivery,
  items,
  mayName,
  highlighted,
  says,
  onNamed,
}: {
  delivery: DeliveryToName;
  items: NameableItem[];
  mayName: boolean;
  highlighted: boolean;
  /** The gateway's sentence once this delivery was named here; held by the card. */
  says: string | null;
  onNamed: (says: string) => void;
}) {
  const queryClient = useQueryClient();
  const fixedItem = delivery.orderInventoryId;
  const [itemId, setItemId] = useState<string>(fixedItem ?? '');
  const [bottles, setBottles] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const needsCount = delivery.bottlesResolved === 0;
  const itemName = (id: string | null | undefined) =>
    items.find((i) => i.inventoryId === id)?.name ?? 'the order’s item';

  /**
   * Called by `HoldToApprove` when the hold completes. Throws on ANY
   * refusal — an unfilled field as much as a server 409 — so the control
   * never seals over a booking that did not happen; `problem` carries the
   * words either way.
   */
  const save = async (): Promise<void> => {
    const inventoryId = fixedItem ?? itemId;
    if (!inventoryId) {
      setProblem('Choose the item this delivery was for.');
      throw new Error('no item chosen');
    }
    let count: number | undefined;
    if (needsCount) {
      count = Number(bottles);
      if (!Number.isInteger(count) || count < 1 || count > NAMED_BOTTLES_MAX) {
        setProblem('Write how many bottles came in, as a whole number.');
        throw new Error('bad count');
      }
    }
    setProblem(null);
    let out: { says: string };
    try {
      out = await nameDeliveredItem(delivery.orderId, {
        inventoryId,
        ...(count !== undefined ? { bottles: count } : {}),
      });
    } catch (e) {
      setProblem(getErrorMessage(e));
      throw e;
    }
    onNamed(out.says);
    await queryClient.invalidateQueries({ queryKey: DELIVERIES_TO_NAME_KEY });
    await queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  return (
    <li
      data-testid="delivery-to-name"
      className={`border-t border-amber-200 py-2 first:border-t-0 ${highlighted ? 'rounded-md bg-amber-100/70 px-2' : ''}`}
    >
      <p className="m-0">{whatHappened(delivery)}</p>
      {says ? (
        <p role="status" data-testid="delivery-to-name-says" className="m-0 mt-1 text-gray-600">
          {says}
        </p>
      ) : mayName ? (
        <div className="mt-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {fixedItem ? (
              <span className="text-gray-600">Item: {itemName(fixedItem)}</span>
            ) : (
              <Select
                id={`delivery-item-${delivery.orderId}`}
                label="The item this delivery was for"
                hideLabel
                value={itemId}
                onChange={setItemId}
                placeholder="Choose the item"
                options={items
                  .filter((i) => i.inventoryId)
                  .map((i) => ({ value: i.inventoryId as string, label: i.name ?? 'Unnamed item' }))}
              />
            )}
            {needsCount && (
              <CountInput
                id={`delivery-bottles-${delivery.orderId}`}
                label="Bottles that came in"
                hideLabel
                value={bottles}
                onChange={setBottles}
                placeholder="Bottles that came in"
                min={1}
                max={NAMED_BOTTLES_MAX}
              />
            )}
          </div>
          {/* HoldToApprove's track is full-width and 48px tall by design (the
              same control OneTapPanel uses inline) — it gets its own line
              rather than fighting the select/count row for space, and a max
              width so it does not stretch across the whole card. */}
          <div className="mt-2 max-w-[220px]">
            <HoldToApprove onApprove={save} label="Book the stock" approvedLabel="Booked" copy={{ unconfirmed: '' }} />
          </div>
        </div>
      ) : (
        <p className="m-0 mt-1 text-gray-500">Waiting for an owner or a manager to name it. Nothing was booked.</p>
      )}
      {problem && (
        <p role="alert" data-testid="delivery-to-name-problem" className="m-0 mt-1 text-rose-700">
          {problem}
        </p>
      )}
    </li>
  );
}

/** The card on /inventory. Nothing when nothing waits; a failed read is said. */
export function DeliveriesToName({ items }: { items: NameableItem[] }) {
  const [searchParams] = useSearchParams();
  const linked = searchParams.get('name-delivery');
  // What the gateway said per delivery named here. Held by the card, because
  // the refetch after naming drops the delivery's row from the list.
  const [named, setNamed] = useState<Array<{ orderId: string; says: string }>>([]);
  const list = useQuery({
    queryKey: DELIVERIES_TO_NAME_KEY,
    queryFn: fetchDeliveriesToName,
    staleTime: 60_000,
  });
  if (list.isError) {
    return (
      <div className="mb-3 text-xs">
        {named.map((n) => (
          <p key={n.orderId} role="status" data-testid="delivery-to-name-says" className="m-0 mb-1 text-gray-600">
            {n.says}
          </p>
        ))}
        <p role="status" data-testid="deliveries-to-name-unread" className="m-0 text-gray-500">
          Which deliveries wait for their item could not be read ({getErrorMessage(list.error)}). That is a failed read,
          not &ldquo;nothing waiting&rdquo;.
        </p>
      </div>
    );
  }
  const deliveries = list.data?.deliveries ?? [];
  const open = new Set(deliveries.map((d) => d.orderId));
  const namedGone = named.filter((n) => !open.has(n.orderId));
  if (deliveries.length === 0 && namedGone.length === 0) return null;
  const mayName = list.data?.viewer.mayName === true;
  return (
    <section
      aria-label="Deliveries waiting for their item"
      data-testid="deliveries-to-name"
      className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-xs text-gray-700"
    >
      <h2 className="m-0 mb-1 text-xs font-semibold text-gray-800">
        Deliveries waiting for their item · {deliveries.length}
      </h2>
      {!mayName && list.data?.viewer.mayNameReason && (
        <p className="m-0 mb-1 text-gray-500">{list.data.viewer.mayNameReason}</p>
      )}
      <ul className="m-0 list-none p-0">
        {deliveries.map((d) => (
          <OneDelivery
            key={d.orderId}
            delivery={d}
            items={items}
            mayName={mayName}
            highlighted={linked === d.orderId}
            says={named.find((n) => n.orderId === d.orderId)?.says ?? null}
            onNamed={(text) =>
              setNamed((prev) => [...prev.filter((n) => n.orderId !== d.orderId), { orderId: d.orderId, says: text }])
            }
          />
        ))}
        {namedGone.map((n) => (
          <li key={n.orderId} className="border-t border-amber-200 py-2 first:border-t-0">
            <p role="status" data-testid="delivery-to-name-says" className="m-0 text-gray-600">
              {n.says}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
