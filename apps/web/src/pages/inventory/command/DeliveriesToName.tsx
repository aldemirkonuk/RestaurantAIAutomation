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
 * - The item is chosen by its id (the house's own items), never typed as a
 *   name. A zero-bottle delivery also asks how many bottles came in.
 * - Only an owner or a manager is offered the form (`viewer.mayName`, from the
 *   gateway, which checks again). Anyone else is told who can.
 * - A failed read is said on the page, never shown as "nothing waiting".
 * - What the page says after naming is the gateway's own sentence, and it
 *   stays said after the refetched list drops the delivery it was about
 *   (the card holds it, not the row).
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  fetchDeliveriesToName,
  nameDeliveredItem,
  type DeliveryToName,
} from '../../../services/api/orders'
import { getErrorMessage } from '../../../services/api/client'

export const DELIVERIES_TO_NAME_KEY = ['procurement', 'items-to-name'] as const

export interface NameableItem {
  inventoryId?: string
  name?: string | null
}

function whatHappened(d: DeliveryToName): string {
  const order = d.orderNumber ?? 'An order'
  return d.why === 'zero_bottles'
    ? `${order} was delivered with no bottle count, so no stock was booked.`
    : `${order} was delivered naming no item, so no stock was booked.`
}

function OneDelivery({
  delivery,
  items,
  mayName,
  highlighted,
  says,
  onNamed,
}: {
  delivery: DeliveryToName
  items: NameableItem[]
  mayName: boolean
  highlighted: boolean
  /** The gateway's sentence once this delivery was named here; held by the card. */
  says: string | null
  onNamed: (says: string) => void
}) {
  const queryClient = useQueryClient()
  const fixedItem = delivery.orderInventoryId
  const [itemId, setItemId] = useState<string>(fixedItem ?? '')
  const [bottles, setBottles] = useState('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const needsCount = delivery.bottlesResolved === 0
  const itemName = (id: string | null | undefined) =>
    items.find((i) => i.inventoryId === id)?.name ?? 'the order’s item'

  const save = async () => {
    const inventoryId = fixedItem ?? itemId
    if (!inventoryId) {
      setProblem('Choose the item this delivery was for.')
      return
    }
    let count: number | undefined
    if (needsCount) {
      count = Number(bottles)
      if (!Number.isInteger(count) || count < 1 || count > 100000) {
        setProblem('Write how many bottles came in, as a whole number.')
        return
      }
    }
    setSaving(true)
    setProblem(null)
    try {
      const out = await nameDeliveredItem(delivery.orderId, {
        inventoryId,
        ...(count !== undefined ? { bottles: count } : {}),
      })
      onNamed(out.says)
      await queryClient.invalidateQueries({ queryKey: DELIVERIES_TO_NAME_KEY })
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
    } catch (e) {
      setProblem(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

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
        <form
          className="mt-1.5 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {fixedItem ? (
            <span className="text-gray-600">Item: {itemName(fixedItem)}</span>
          ) : (
            <>
              <label className="sr-only" htmlFor={`delivery-item-${delivery.orderId}`}>
                The item this delivery was for
              </label>
              <select
                id={`delivery-item-${delivery.orderId}`}
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                className="min-w-[200px] rounded-md border border-gray-300 px-2 py-1.5 text-xs"
              >
                <option value="">Choose the item</option>
                {items
                  .filter((i) => i.inventoryId)
                  .map((i) => (
                    <option key={i.inventoryId} value={i.inventoryId}>
                      {i.name ?? 'Unnamed item'}
                    </option>
                  ))}
              </select>
            </>
          )}
          {needsCount && (
            <>
              <label className="sr-only" htmlFor={`delivery-bottles-${delivery.orderId}`}>
                Bottles that came in
              </label>
              <input
                id={`delivery-bottles-${delivery.orderId}`}
                inputMode="numeric"
                value={bottles}
                onChange={(e) => setBottles(e.target.value)}
                placeholder="Bottles that came in"
                className="w-[150px] rounded-md border border-gray-300 px-2.5 py-1.5 text-xs"
              />
            </>
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-wine-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Booking' : 'Book the stock'}
          </button>
        </form>
      ) : (
        <p className="m-0 mt-1 text-gray-500">Waiting for an owner or a manager to name it. Nothing was booked.</p>
      )}
      {problem && (
        <p role="alert" data-testid="delivery-to-name-problem" className="m-0 mt-1 text-rose-700">
          {problem}
        </p>
      )}
    </li>
  )
}

/** The card on /inventory. Nothing when nothing waits; a failed read is said. */
export function DeliveriesToName({ items }: { items: NameableItem[] }) {
  const [searchParams] = useSearchParams()
  const linked = searchParams.get('name-delivery')
  // What the gateway said per delivery named here. Held by the card, because
  // the refetch after naming drops the delivery's row from the list.
  const [named, setNamed] = useState<Array<{ orderId: string; says: string }>>([])
  const list = useQuery({
    queryKey: DELIVERIES_TO_NAME_KEY,
    queryFn: fetchDeliveriesToName,
    staleTime: 60_000,
  })
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
    )
  }
  const deliveries = list.data?.deliveries ?? []
  const open = new Set(deliveries.map((d) => d.orderId))
  const namedGone = named.filter((n) => !open.has(n.orderId))
  if (deliveries.length === 0 && namedGone.length === 0) return null
  const mayName = list.data?.viewer.mayName === true
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
  )
}
