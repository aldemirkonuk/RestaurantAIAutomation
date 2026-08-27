/**
 * Ask AI — the web client for `POST /ask-ai/*` (P3.C, FUTURES §8).
 *
 * Four calls, one rule: **this module never executes anything by itself.**
 * `propose` returns a proposal; only `confirm` executes, and only against an
 * action id a human has looked at. That is the gate ADR 0029 §5 closes P3.C on,
 * and the UI's job is to make it legible rather than to route around it.
 *
 * SHAPE NOTE — the two endpoints disagree, on purpose here
 * ------------------------------------------------------
 * `POST /propose` returns the freshly validated action in camelCase
 * (`{family, actionType, payload}` — it is the TypeScript `AskAiAction` the
 * gateway just built). `GET /actions` returns database rows, so the same action
 * arrives as `action_type` / `created_at`. Rather than let two shapes leak into
 * the components, `listOpenProposals` normalises the row into the same
 * `AskAiProposal` a propose response produces. One shape reaches React.
 *
 * `restaurantId` is never sent: every route reads it from the JWT, and
 * `apiClient` attaches that token. Passing one would be ignored at best.
 */

import { apiClient, getErrorMessage } from './client'

/** The MVP allowlist. Widening it is a founder decision, not a UI change. */
export type AskAiFamily = 'procurement' | 'communications'
export type AskAiActionType = 'reorder' | 'vendor_draft'

export interface ReorderPayload {
  inventoryId: string
  providerId: string
  quantity: number
  unitType?: string
}

export interface VendorDraftPayload {
  orderId: string
  instruction: string
}

export type AskAiPayload = ReorderPayload | VendorDraftPayload

export interface AskAiAction {
  family: AskAiFamily
  actionType: AskAiActionType
  payload: AskAiPayload
}

/** One proposal awaiting confirmation, in the single shape the UI consumes. */
export interface AskAiProposal {
  actionId: string
  summary: string
  action: AskAiAction
  /** Present on rows from `GET /actions`; absent right after a propose. */
  utterance?: string
  createdAt?: string
}

/**
 * The outcome of asking.
 *
 * Flat rather than a discriminated union because a refusal is not an error
 * path — `{proposed: false, reason}` is a first-class answer that the card
 * surface has to render, and `reason` is ALWAYS set by the gateway. A refusal
 * shown without its reason is the dead end `ask-ai-actions.ts` was written to
 * avoid, so `reason` is required on this side of the wire too.
 */
export interface AskAiProposeResult {
  proposed: boolean
  proposal?: AskAiProposal
  reason?: string
}

export interface AskAiConfirmResult {
  executed: boolean
  actionId: string
  executionRef: string
  /** True when the operator's edits were the payload that ran. */
  edited: boolean
}

/**
 * Why a confirm/discard failed, classified for the UI.
 *
 *  `gone`     — the compare-and-swap lost. A double tap, a second tab, a
 *               retry over flaky signal. NOT an error banner: exactly one
 *               execution happened, which is what the CAS is for.
 *  `rejected` — the operator's edit did not pass the allowlist or the
 *               grounding check. The gateway rolls the row back to
 *               `proposed`, so the card stays usable and shows the reason.
 *  `failed`   — the executor threw. The row is `failed` and will not appear
 *               in the open list again.
 */
export type AskAiFailureKind = 'gone' | 'rejected' | 'failed'

export class AskAiActionError extends Error {
  readonly kind: AskAiFailureKind
  constructor(kind: AskAiFailureKind, message: string) {
    super(message)
    this.name = 'AskAiActionError'
    this.kind = kind
  }
}

function status(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status
}

function classify(error: unknown): AskAiActionError {
  const code = status(error)
  const message = getErrorMessage(error)
  if (code === 404) return new AskAiActionError('gone', message)
  if (code === 400) return new AskAiActionError('rejected', message)
  return new AskAiActionError('failed', message)
}

function toAction(raw: any): AskAiAction {
  return {
    family: raw?.family,
    // `propose` says `actionType`; a row from `GET /actions` says `action_type`.
    actionType: raw?.actionType ?? raw?.action_type,
    payload: (raw?.payload ?? {}) as AskAiPayload,
  }
}

/**
 * Ask for an action. Never executes — the answer is a proposal or a reason.
 *
 * `utterance` carries the page context the caller folded in (see
 * `AskAiProvider`): the gateway takes no separate context field, so context
 * travels as words. It is stored verbatim on the row, which makes the stored
 * utterance an honest record of what the model was actually asked.
 */
export async function proposeAction(utterance: string): Promise<AskAiProposeResult> {
  const { data } = await apiClient.post<any>('/ask-ai/propose', { utterance })
  if (!data?.proposed) {
    return {
      proposed: false,
      reason:
        data?.reason ||
        'Ask AI could not turn that into an action, and did not say why.',
    }
  }
  return {
    proposed: true,
    proposal: {
      actionId: data.actionId,
      summary: data.summary,
      action: toAction(data.action),
    },
  }
}

/** Proposals still waiting for this restaurant. Survives a reload. */
export async function listOpenProposals(): Promise<AskAiProposal[]> {
  const { data } = await apiClient.get<any[]>('/ask-ai/actions')
  return (Array.isArray(data) ? data : []).map((row) => ({
    actionId: row.id,
    summary: row.summary,
    action: toAction(row),
    utterance: row.utterance,
    createdAt: row.created_at ?? row.createdAt,
  }))
}

/**
 * Confirm — the gate.
 *
 * Omit `payload` to confirm exactly what was proposed. Supply it and the
 * gateway re-runs the FULL allowlist and grounding check on it, so a partial
 * patch is not a thing that exists: send the complete payload or none.
 */
export async function confirmAction(
  actionId: string,
  payload?: AskAiPayload,
): Promise<AskAiConfirmResult> {
  try {
    const { data } = await apiClient.post<AskAiConfirmResult>(
      `/ask-ai/actions/${actionId}/confirm`,
      payload ? { payload } : {},
    )
    return data
  } catch (error) {
    throw classify(error)
  }
}

/** The operator says no. Recorded as a signal, not swallowed. */
export async function discardAction(actionId: string): Promise<void> {
  try {
    await apiClient.post(`/ask-ai/actions/${actionId}/discard`, {})
  } catch (error) {
    throw classify(error)
  }
}

export const askAiApi = {
  propose: proposeAction,
  listOpen: listOpenProposals,
  confirm: confirmAction,
  discard: discardAction,
}

export default askAiApi
