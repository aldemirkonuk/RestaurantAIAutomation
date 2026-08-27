/**
 * The Ask AI web client — the two things it exists to get right.
 *
 *  1. `GET /ask-ai/actions` returns database rows (`action_type`) while
 *     `POST /propose` returns the TypeScript action (`actionType`). If both
 *     shapes reach React, a card renders `undefined` for its own type and the
 *     bug looks like a rendering bug.
 *  2. A confirm can fail three ways and they are NOT the same event. A 404 is
 *     the compare-and-swap working; a 400 is a rejected edit the operator must
 *     be able to fix in place; a 5xx is a real failure. Collapsing them into
 *     "something went wrong" is what turns a working gate into a scary one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AskAiActionError,
  confirmAction,
  discardAction,
  listOpenProposals,
  proposeAction,
} from './askAi'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn() },
  }
})

const http = vi.mocked(apiClient) as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

/** An axios-shaped rejection, since `getErrorMessage` reads `response.data`. */
function httpError(status: number, message: string) {
  return {
    isAxiosError: true,
    response: { status, data: { message, statusCode: status } },
    message: `Request failed with status code ${status}`,
  }
}

const INVENTORY = '11111111-1111-4111-8111-111111111111'
const PROVIDER = '22222222-2222-4222-8222-222222222222'

beforeEach(() => vi.clearAllMocks())

describe('proposeAction', () => {
  it('returns the proposal, and never touches an execute path', async () => {
    http.post.mockResolvedValue({
      data: {
        proposed: true,
        actionId: 'a-1',
        summary: 'Order 6 of the Barolo from Acme.',
        action: {
          family: 'procurement',
          actionType: 'reorder',
          payload: { inventoryId: INVENTORY, providerId: PROVIDER, quantity: 6 },
        },
      },
    })

    const result = await proposeAction('reorder the barolo')

    expect(http.post).toHaveBeenCalledTimes(1)
    expect(http.post).toHaveBeenCalledWith('/ask-ai/propose', {
      utterance: 'reorder the barolo',
    })
    expect(result.proposal?.action.actionType).toBe('reorder')
  })

  it('never sends restaurantId — the gateway takes it from the token', async () => {
    http.post.mockResolvedValue({ data: { proposed: false, reason: 'no' } })
    await proposeAction('hi')
    expect(JSON.stringify(http.post.mock.calls[0][1])).not.toMatch(/restaurant/i)
  })

  it('carries the refusal reason through instead of dropping it', async () => {
    http.post.mockResolvedValue({
      data: { proposed: false, reason: 'Could not resolve which vendor to order from.' },
    })

    const result = await proposeAction('order some wine')

    expect(result.proposed).toBe(false)
    expect(result.reason).toBe('Could not resolve which vendor to order from.')
  })

  it('substitutes a reason rather than showing a refusal with none', async () => {
    // The gateway always sets `reason`. If that ever stops being true, the UI
    // must still not render an empty dead end.
    http.post.mockResolvedValue({ data: { proposed: false } })
    const result = await proposeAction('order some wine')
    expect(result.reason).toMatch(/\S/)
  })
})

describe('listOpenProposals', () => {
  it('normalises action_type rows into the same shape a propose returns', async () => {
    http.post.mockResolvedValue({
      data: {
        proposed: true,
        actionId: 'a-1',
        summary: 'x',
        action: { family: 'communications', actionType: 'vendor_draft', payload: {} },
      },
    })
    const fromPropose = await proposeAction('x')

    http.get.mockResolvedValue({
      data: [
        {
          id: 'a-1',
          utterance: 'draft a reply',
          family: 'communications',
          action_type: 'vendor_draft',
          payload: { orderId: PROVIDER, instruction: 'chase them' },
          summary: 'x',
          status: 'proposed',
          created_at: '2026-08-27T10:00:00Z',
        },
      ],
    })
    const [fromList] = await listOpenProposals()

    expect(fromList.action.actionType).toBe(fromPropose.proposal!.action.actionType)
    expect(fromList.actionId).toBe('a-1')
    expect(fromList.createdAt).toBe('2026-08-27T10:00:00Z')
  })

  it('survives a non-array body rather than throwing inside a render', async () => {
    http.get.mockResolvedValue({ data: null })
    await expect(listOpenProposals()).resolves.toEqual([])
  })
})

describe('confirmAction', () => {
  it('omits payload entirely when confirming as proposed', async () => {
    http.post.mockResolvedValue({
      data: { executed: true, actionId: 'a-1', executionRef: 'o-9', edited: false },
    })

    await confirmAction('a-1')

    expect(http.post).toHaveBeenCalledWith('/ask-ai/actions/a-1/confirm', {})
  })

  it('sends the full payload when the operator edited it', async () => {
    http.post.mockResolvedValue({
      data: { executed: true, actionId: 'a-1', executionRef: 'o-9', edited: true },
    })

    await confirmAction('a-1', {
      inventoryId: INVENTORY,
      providerId: PROVIDER,
      quantity: 8,
    })

    expect(http.post).toHaveBeenCalledWith('/ask-ai/actions/a-1/confirm', {
      payload: { inventoryId: INVENTORY, providerId: PROVIDER, quantity: 8 },
    })
  })

  it('classifies a lost compare-and-swap as `gone`, not as a failure', async () => {
    http.post.mockRejectedValue(
      httpError(404, 'That action is no longer waiting for confirmation.'),
    )

    const error = await confirmAction('a-1').catch((e) => e as AskAiActionError)

    expect(error).toBeInstanceOf(AskAiActionError)
    expect((error as AskAiActionError).kind).toBe('gone')
    expect((error as AskAiActionError).message).toMatch(/no longer waiting/)
  })

  it('classifies a rejected edit as `rejected` and keeps the server reason', async () => {
    http.post.mockRejectedValue(
      httpError(400, 'An edit cannot change what kind of action this is.'),
    )

    const error = await confirmAction('a-1', {
      orderId: PROVIDER,
      instruction: 'x',
    }).catch((e) => e as AskAiActionError)

    expect((error as AskAiActionError).kind).toBe('rejected')
    expect((error as AskAiActionError).message).toMatch(/cannot change what kind/)
  })

  it('classifies an executor blow-up as `failed`', async () => {
    http.post.mockRejectedValue(httpError(500, 'Could not confirm that action.'))
    const error = await confirmAction('a-1').catch((e) => e as AskAiActionError)
    expect((error as AskAiActionError).kind).toBe('failed')
  })
})

describe('discardAction', () => {
  it('reports an already-handled row as `gone` too', async () => {
    http.post.mockRejectedValue(
      httpError(404, 'That action is no longer waiting for confirmation.'),
    )
    const error = await discardAction('a-1').catch((e) => e as AskAiActionError)
    expect((error as AskAiActionError).kind).toBe('gone')
  })
})
