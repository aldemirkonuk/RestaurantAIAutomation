/**
 * The client half of "an order is delivered once".
 *
 * The gateway refuses a second delivery with `409 { reason, orderId, status,
 * deliveredAt, message }` (`procurement.service.ts` markDelivered, via
 * `delivered-once.ts`). Axios sets `error.message` to "Request failed with
 * status code 409" and puts the server's body on `error.response.data` — and
 * EVERY consumer of `markOrderDelivered` reads `.message`: the Action Center's
 * `failureMessage`, the rebuilt Orders desk's `deliverError`, the legacy desk's
 * alert. Without the promotion this module now performs, the whole sentence
 * explaining why a person was stopped is thrown away at the boundary and the
 * screen says "Request failed with status code 409".
 *
 * Asserted here rather than in a component test because a component test mocks
 * this module: it can prove the function was called and cannot see what the
 * function does with a rejection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  markOrderDelivered,
  alreadyDeliveredRefusal,
  alreadyDeliveredWords,
} from './orders'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    getActiveRestaurantId: () => 'rest-1',
  }
})

const http = vi.mocked(apiClient) as unknown as { post: ReturnType<typeof vi.fn> }

const REFUSAL =
  'Order ORD-2026-00042 was already delivered on 2026-09-04 at 14:05 UTC. ' +
  '12 recorded as received. An order is delivered once. Nothing was changed.'

const SUMMARY =
  'Delivered on 2026-09-04 at 14:05 UTC by Ada Lovelace, 12 bottles booked in.'

/**
 * The body the gateway actually sends, key for key.
 *
 * Copied from the assertion in
 * `apps/api-gateway/src/procurement/tests/delivered-once.spec.ts` — the two are
 * the only thing holding the contract, because `check_web_reads_gateway_dto_keys`
 * pairs a client TYPE with a gateway DTO CLASS and this is neither: it is an
 * ERROR body off a pure module. Named in the report as the residual gap.
 */
const EARLIER = {
  deliveredAt: '2026-09-04T14:05:00.000Z',
  receivedBy: 'user-7',
  receivedByName: 'Ada Lovelace',
  receivedByNameReason: null,
  quantityReceived: 12,
  unitType: 'bottle',
  quantityUnitWhy:
    'Stated in bottle: the order\'s own unit does not multiply.',
  bottlesTotal: 12,
  summary: SUMMARY,
}

/** What axios hands a caller for a 409 with a JSON body. */
const conflict = (earlier: unknown = EARLIER) =>
  Object.assign(new Error('Request failed with status code 409'), {
    isAxiosError: true,
    response: {
      status: 409,
      data: {
        reason: 'order_already_delivered',
        orderId: 'order-1',
        orderNumber: 'ORD-2026-00042',
        status: 'DELIVERED',
        deliveredAt: '2026-09-04T14:05:00.000Z',
        earlierDelivery: earlier,
        message: REFUSAL,
      },
    },
  })

beforeEach(() => {
  http.post.mockReset()
})

describe('markOrderDelivered — the refusal reaches the screen', () => {
  it('promotes the gateway sentence onto error.message', async () => {
    http.post.mockRejectedValue(conflict())

    await expect(markOrderDelivered('order-1')).rejects.toThrow(
      /already delivered on 2026-09-04 at 14:05 UTC/,
    )
  })

  it('keeps the status and the body so a caller can still branch on them', async () => {
    // The original error is rethrown, not replaced: `err.response.status` is
    // how LedgerRow and the Action Center tell a refusal from a lost session,
    // and `reason` is how a client branches without parsing prose.
    http.post.mockRejectedValue(conflict())

    let thrown: any
    try {
      await markOrderDelivered('order-1')
    } catch (e) {
      thrown = e
    }
    expect(thrown.response.status).toBe(409)
    expect(thrown.response.data.reason).toBe('order_already_delivered')
    expect(thrown.message).toBe(REFUSAL)
  })

  it('leaves a successful delivery exactly as it was', async () => {
    http.post.mockResolvedValue({ data: { id: 'order-1', status: 'DELIVERED' } })

    await expect(markOrderDelivered('order-1')).resolves.toEqual({
      id: 'order-1',
      status: 'DELIVERED',
    })
    expect(http.post).toHaveBeenCalledWith(
      '/procurement/orders/order-1/deliver',
      { notes: undefined },
    )
  })

  it('does not invent a sentence when the server sent none', async () => {
    // A 502 from a proxy has no `message` in its body. Axios's own text is then
    // the truest thing available, and it is left alone rather than replaced by
    // something reassuring.
    http.post.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 502'), {
        isAxiosError: true,
        response: { status: 502, data: '<html>Bad Gateway</html>' },
      }),
    )

    await expect(markOrderDelivered('order-1')).rejects.toThrow(
      /Request failed with status code 502/,
    )
  })
})

describe('alreadyDeliveredRefusal — one parser, four surfaces', () => {
  it('reads the earlier delivery off a 409', () => {
    const refused = alreadyDeliveredRefusal(conflict())
    expect(refused).not.toBeNull()
    expect(refused!.orderNumber).toBe('ORD-2026-00042')
    expect(refused!.earlierDelivery).toEqual(EARLIER)
    // What a screen prints: what already happened, then why nothing changed.
    expect(alreadyDeliveredWords(refused!)).toBe(`${SUMMARY} ${REFUSAL}`)
  })

  it('is null for anything that is not this refusal', () => {
    // A 409 from somewhere else, a 500, a network drop. None of these may
    // produce a screen claiming a delivery happened.
    expect(alreadyDeliveredRefusal(new Error('offline'))).toBeNull()
    expect(
      alreadyDeliveredRefusal({ response: { status: 500, data: { reason: 'order_already_delivered' } } })
    ).toBeNull()
    expect(
      alreadyDeliveredRefusal({ response: { status: 409, data: { reason: 'credit_already_claimed' } } })
    ).toBeNull()
  })

  it('does not invent a delivery from a 409 with an unusable body', () => {
    // A proxy answering 409 with HTML, or a body whose summary is missing. The
    // refusal still shows its sentence; it must NOT render a delivery line with
    // blanks where the facts belong.
    const htmlBody = Object.assign(new Error('conflict'), {
      isAxiosError: true,
      response: { status: 409, data: '<html>Conflict</html>' },
    })
    expect(alreadyDeliveredRefusal(htmlBody)).toBeNull()

    const noSummary = alreadyDeliveredRefusal(conflict({ ...EARLIER, summary: '' }))
    expect(noSummary).not.toBeNull()
    expect(noSummary!.earlierDelivery).toBeNull()
    expect(alreadyDeliveredWords(noSummary!)).toBe(REFUSAL)
  })

  it('keeps a failed name lookup distinct from a delivery nobody signed for', () => {
    const unnamed = alreadyDeliveredRefusal(
      conflict({
        ...EARLIER,
        receivedByName: null,
        receivedByNameReason: 'the people register could not be read (timeout)',
        summary: 'Delivered on 2026-09-04 at 14:05 UTC by someone this house could not look up, 12 bottles booked in.',
      })
    )
    expect(unnamed!.earlierDelivery!.receivedBy).toBe('user-7')
    expect(unnamed!.earlierDelivery!.receivedByName).toBeNull()
    expect(unnamed!.earlierDelivery!.receivedByNameReason).toMatch(/could not be read/)
  })
})
