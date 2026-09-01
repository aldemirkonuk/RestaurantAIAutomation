/**
 * The receiving side of every `/orders?…` deep link.
 *
 * Six controls on the dashboard (legacy Dashboard.tsx and the Mudavym
 * DayDetail / WaitingOnYou panels) plus the inventory row expansion navigate
 * here with a payload. `/orders` read none of them — it called
 * `useSearchParams` nowhere — so a "Reorder" click and a "View order" click
 * produced the same bare list.
 *
 * Parameters honoured (verified emitters, not a guess):
 *   ?orderId=<id>            Dashboard.tsx:917,924,1744 · OneTapActionCenter:189
 *   ?highlight=<id>          DayDetail.tsx:199 · WaitingOnYou.tsx:124 ·
 *                            dashboard.service.ts:744 (alert actionUrl)
 *   ?order=<id>              ReceivingHome.tsx:268 · RcManagerQueue.tsx:331
 *   &action=thread           Dashboard.tsx:920,1723,1734
 *   ?draft=new&inventoryId=&qty=      Dashboard.tsx:982,1772 · RowExpansion:215
 *   ?draft=new&inventoryIds=&qtys=    Dashboard.tsx:180 (NEW-039 multi-reorder)
 *
 * NOT claimed here, because other emitters give `draft` a different meaning:
 * `?draft=<conversationId>` (Notifications.tsx:1241) and `?draft=1`
 * (Recommendations.tsx:113) are left alone — only the literal `draft=new`
 * opens the create-order flow.
 */

import { useMemo } from 'react'
import {
  deepLinkMissingMessage,
  resolveDeepLinkTarget,
  splitCsvParam,
  useDeepLinkParams,
  type DeepLinkResolution,
} from '../../lib/deepLink'

/** One line of the NEW-038/039 reorder payload. */
export interface OrdersDraftLine {
  inventoryId: string
  /** Bottles. Always a positive integer; a payload that is not is rejected in words. */
  qty: number
}

export interface OrdersDeepLink<T> {
  /** Resolution of `orderId` / `highlight` / `order` against the loaded list. */
  order: DeepLinkResolution<T>
  /** `&action=thread` accompanied a resolvable order id. */
  openThread: boolean
  /** Parsed `draft=new` payload, or null when the link carried none. */
  draft: OrdersDraftLine[] | null
  /**
   * Everything the link asked for that this page cannot honour, in words.
   * Null when there is nothing to say. Never rendered as an empty page.
   */
  missingMessage: string | null
  /** Strip the parameters once acted on, so a refresh does not re-fire them. */
  consume: () => void
}

/** The three spellings the emitters use for "this order". First one wins. */
const ORDER_ID_KEYS = ['orderId', 'highlight', 'order'] as const

export function useOrdersDeepLink<T>(opts: {
  orders: readonly T[] | null | undefined
  /** True once the orders fetch has settled. "Missing" is not knowable before. */
  ready: boolean
  idOf: (order: T) => string
}): OrdersDeepLink<T> {
  const { searchParams, consume: consumeKeys } = useDeepLinkParams()

  const requestedOrderId = useMemo(() => {
    for (const key of ORDER_ID_KEYS) {
      const value = searchParams.get(key)
      if (value && value.trim()) return value.trim()
    }
    return null
  }, [searchParams])

  const wantsThread = searchParams.get('action') === 'thread'
  const wantsDraft = searchParams.get('draft') === 'new'
  const singleInventoryId = searchParams.get('inventoryId')
  const singleQty = searchParams.get('qty')
  const multiInventoryIds = searchParams.get('inventoryIds')
  const multiQtys = searchParams.get('qtys')

  const { idOf, orders, ready } = opts

  const order = useMemo(
    () =>
      resolveDeepLinkTarget<T>({
        value: requestedOrderId,
        items: orders,
        ready,
        match: (candidate, value) => idOf(candidate) === value,
        noun: 'the order',
      }),
    [requestedOrderId, orders, ready, idOf],
  )

  const draftParse = useMemo(() => parseDraftPayload({
    wantsDraft,
    singleInventoryId,
    singleQty,
    multiInventoryIds,
    multiQtys,
  }), [wantsDraft, singleInventoryId, singleQty, multiInventoryIds, multiQtys])

  const missingMessage =
    order.status === 'missing'
      ? order.message
      : draftParse.problem
        ? draftParse.problem
        : null

  const consume = useMemo(
    () => () =>
      consumeKeys(
        ...ORDER_ID_KEYS,
        'action',
        'draft',
        'inventoryId',
        'qty',
        'inventoryIds',
        'qtys',
        'from',
      ),
    [consumeKeys],
  )

  return {
    order,
    openThread: wantsThread && order.status === 'found',
    draft: draftParse.lines,
    missingMessage,
    consume,
  }
}

/**
 * Parse `draft=new` into lines, or explain why it cannot be parsed.
 *
 * Exported for tests: the two shapes and the three refusals are the contract.
 * A refusal never silently degrades into "open an empty draft" — that is the
 * ADR 0020 failure this whole hook exists to remove.
 */
export function parseDraftPayload(input: {
  wantsDraft: boolean
  singleInventoryId: string | null
  singleQty: string | null
  multiInventoryIds: string | null
  multiQtys: string | null
}): { lines: OrdersDraftLine[] | null; problem: string | null } {
  if (!input.wantsDraft) return { lines: null, problem: null }

  const ids = input.multiInventoryIds
    ? splitCsvParam(input.multiInventoryIds)
    : input.singleInventoryId?.trim()
      ? [input.singleInventoryId.trim()]
      : []

  if (ids.length === 0) {
    return {
      lines: null,
      problem:
        'This link asked to start a draft order but named no items, so nothing has been added. ' +
        'Pick the wines below to build the order.',
    }
  }

  const rawQtys = input.multiInventoryIds
    ? splitCsvParam(input.multiQtys)
    : input.singleQty?.trim()
      ? [input.singleQty.trim()]
      : []

  if (rawQtys.length !== ids.length) {
    return {
      lines: null,
      problem:
        `This link asked to start a draft order for ${ids.length} item(s) but carried ` +
        `${rawQtys.length} quantit${rawQtys.length === 1 ? 'y' : 'ies'}, so no quantity can be ` +
        'trusted and nothing has been added. Pick the wines below to build the order.',
    }
  }

  const lines: OrdersDraftLine[] = []
  for (let i = 0; i < ids.length; i++) {
    const qty = Number(rawQtys[i])
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      return {
        lines: null,
        problem:
          `This link asked to start a draft order with the quantity “${rawQtys[i]}”, which is not ` +
          'a number of bottles, so nothing has been added. Pick the wines below to build the order.',
      }
    }
    lines.push({ inventoryId: ids[i], qty })
  }

  return { lines, problem: null }
}

/**
 * The sentence for draft lines whose inventory rows are gone. Kept beside the
 * parser so both halves of the reorder path speak in the same voice.
 */
export function draftLinesMissingMessage(unknownIds: string[]): string {
  if (unknownIds.length === 1) {
    return deepLinkMissingMessage('the inventory item', unknownIds[0])
  }
  return (
    `This link asked for ${unknownIds.length} inventory items that are not in the list ` +
    `(${unknownIds.join(', ')}) — they may have been deleted, or they may belong to a ` +
    'different restaurant. They have been left out of the draft.'
  )
}
