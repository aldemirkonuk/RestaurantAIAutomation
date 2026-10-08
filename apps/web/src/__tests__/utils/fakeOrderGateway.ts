/**
 * A fake of the gateway's order list, for the order-book tests (ADR 0269).
 *
 * It answers the way `listOrders` does (procurement.service.ts:3150-3271):
 * `limit ?? 50`, a 400 above 100 (`OrderFilterDto`'s `@Max(100)`), an exact
 * count, `hasMore = from + rows < total`, newest `created_at` first, and the
 * `status` filter. It also answers `GET /procurement/orders/:id`, with a 500
 * for an id it does not hold (the gateway's `.single()`).
 *
 * Install it with `vi.mocked(apiClient.get).mockImplementation(gw.get)`.
 */

import type { Order, OrderWireStatus } from '../../services/api/types'
import { tokenHouse } from '../../lib/houseMemory'

export const HOUSE_A = '11111111-1111-4111-8111-111111111111'
export const HOUSE_B = '22222222-2222-4222-8222-222222222222'

/** An unsigned JWT whose claims name `house`; `tokenHouse` reads it. */
export function tokenFor(house: string): string {
  return `header.${btoa(JSON.stringify({ sub: 'user-1', restaurantId: house }))}.sig`
}

export function signInAs(house: string): void {
  localStorage.setItem('accessToken', tokenFor(house))
  localStorage.setItem('activeRestaurantId', house)
}

export interface FakeCall {
  url: string
  /** The house the session's token named when the request went out. */
  house: string | null
  params: Record<string, unknown>
  signal?: AbortSignal
}

/** What a `before` hook may answer instead of the fake's own page. */
export type FakeOverride =
  | { status: number; data?: unknown }
  | { data: unknown }
  | { wait: Promise<void> }

/** `n` orders in `house`, the first newest; `statusFor(i)` defaults to COMPLETED. */
export function makeOrders(
  house: string,
  n: number,
  statusFor: (i: number) => OrderWireStatus = () => 'COMPLETED',
  idPrefix = 'o',
): Order[] {
  const base = Date.UTC(2026, 9, 1)
  return Array.from({ length: n }, (_, i) => ({
    id: `${idPrefix}-${String(i).padStart(5, '0')}`,
    orderNumber: `PO-${i}`,
    restaurantId: house,
    inventoryId: 'inv-1',
    providerId: 'prov-1',
    quantity: 1,
    status: statusFor(i),
    createdAt: new Date(base - i * 60_000).toISOString(),
  })) as unknown as Order[]
}

function httpError(status: number, data?: unknown): Error {
  const error = new Error(`Request failed with status code ${status}`) as Error & {
    response: { status: number; data?: unknown }
  }
  error.response = { status, data }
  return error
}

function canceled(): Error {
  const error = new Error('canceled')
  error.name = 'CanceledError'
  return error
}

export class FakeOrderGateway {
  rows: Order[]
  calls: FakeCall[] = []
  /** Runs before every answer; return an override to answer differently. */
  before: ((call: FakeCall, index: number) => FakeOverride | undefined) | null = null
  /** Answer only the token's house, as the gateway does (`user.restaurantId`). */
  scopeByToken = false

  constructor(rows: Order[]) {
    this.rows = rows
  }

  /** List calls (the page reads), in order. */
  listCalls(): FakeCall[] {
    return this.calls.filter(
      (c) => c.url === '/procurement/orders/history' || c.url === '/procurement/orders',
    )
  }

  get = async (
    url: string,
    config: { params?: Record<string, unknown>; signal?: AbortSignal } = {},
  ): Promise<{ data: unknown }> => {
    const call: FakeCall = {
      url,
      house: tokenHouse(localStorage.getItem('accessToken')),
      params: { ...(config.params ?? {}) },
      signal: config.signal,
    }
    const index = this.calls.length
    this.calls.push(call)
    if (config.signal?.aborted) throw canceled()

    const override = this.before?.(call, index)
    if (override && 'wait' in override) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(canceled())
        config.signal?.addEventListener('abort', onAbort, { once: true })
        override.wait.then(() => {
          config.signal?.removeEventListener('abort', onAbort)
          resolve()
        })
      })
    } else if (override && 'status' in override) {
      throw httpError(override.status, override.data)
    } else if (override) {
      return { data: override.data }
    }

    if (url === '/procurement/orders/history' || url === '/procurement/orders') {
      return { data: this.list(call) }
    }
    const id = url.startsWith('/procurement/orders/')
      ? decodeURIComponent(url.slice('/procurement/orders/'.length))
      : null
    if (id) {
      const row = this.scoped(call).find((r) => r.id === id)
      if (!row) throw httpError(500, { message: 'Failed to fetch order' })
      return { data: row }
    }
    throw httpError(404)
  }

  private scoped(call: FakeCall): Order[] {
    return this.scopeByToken ? this.rows.filter((r) => r.restaurantId === call.house) : this.rows
  }

  private list(call: FakeCall) {
    const params = call.params
    const page = params.page === undefined ? 1 : Number(params.page)
    const limit = params.limit === undefined ? 50 : Number(params.limit)
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw httpError(400, { message: ['limit must not be greater than 100'] })
    }
    const status = params.status as string | undefined
    const matching = this.scoped(call)
      .filter((r) => !status || r.status === status)
      .slice()
      .sort((a, b) => String((b as any).createdAt).localeCompare(String((a as any).createdAt)))
    const from = (page - 1) * limit
    const orders = matching.slice(from, from + limit)
    const total = matching.length
    return { orders, total, page, limit, hasMore: from + orders.length < total }
  }
}
