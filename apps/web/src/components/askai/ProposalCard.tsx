/**
 * The Ask AI proposal card — the confirm gate, made legible.
 *
 * Ask → propose → **confirm** → execute (FUTURES §8.1). Everything about this
 * component is downstream of one fact: the row behind it is `proposed`, and
 * nothing has happened yet. So the card is written to survive being wrong.
 *
 * EDITABLE, BECAUSE A NEAR-MISS SHOULD BE ONE TAP
 * ----------------------------------------------
 * "Order 6 cases" when you meant 8 is the common case, and re-asking is a
 * worse answer than fixing the number in front of you. The fields below are
 * live inputs; Confirm sends `{payload}` only when something actually changed,
 * so an untouched confirm is byte-for-byte "confirm as proposed" and the
 * gateway records `edited: false`.
 *
 * WHAT IS NOT EDITABLE, AND WHY THE UI AGREES WITH THE SERVER
 * ----------------------------------------------------------
 *  • `family` / `actionType` — the gateway refuses an edit that changes them
 *    ("An edit cannot change what kind of action this is"), because that turns
 *    "fix the quantity" into "swap in a different action a human already
 *    confirmed". There is no control here that could try.
 *  • The ids — editable on the wire, but there is no candidate endpoint for the
 *    web app to build a picker from, and a bare uuid text box is not a UI, it
 *    is a trap. They render read-only. Changing WHICH item or vendor means
 *    asking again, which is honest: the model re-grounds against the live
 *    candidate set when it does.
 *
 * THE THREE FAILURE SHAPES ARE DIFFERENT AND ARE SHOWN DIFFERENTLY
 * ---------------------------------------------------------------
 *  • **gone** (404) — the compare-and-swap lost. A double tap, another tab, a
 *    retry. Exactly one execution happened. That is the mechanism working, so
 *    it is a plain note, not a red banner.
 *  • **rejected** (400) — the edit failed re-validation. The gateway rolls the
 *    row back to `proposed`, so the card MUST stay usable and show why rather
 *    than vanishing and losing the operator's typing.
 *  • **failed** (5xx) — the executor threw. The row is terminal; the card says
 *    so and stops offering a button that cannot work.
 */

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Info,
  Loader2,
  Mail,
  ShoppingCart,
  X,
} from 'lucide-react'
import {
  AskAiActionError,
  AskAiPayload,
  AskAiProposal,
  ReorderPayload,
  VendorDraftPayload,
  confirmAction,
  discardAction,
} from '../../services/api/askAi'

/**
 * Mirrors `MAX_REORDER_QUANTITY` in `apps/api-gateway/src/ask-ai/ask-ai-actions.ts`.
 *
 * A copy, not a shared constant — the packages boundary does not carry it — so
 * treat it as a courtesy, not a rule. The gateway is the authority and rejects
 * above this regardless of what the input allows.
 */
export const MAX_REORDER_QUANTITY = 500

interface Props {
  proposal: AskAiProposal
}

type Phase = 'editing' | 'working' | 'executed' | 'discarded' | 'gone' | 'failed'

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

/** Read-only id row — enough to tell two rows apart, not a uuid to retype. */
function IdField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-gray-500">{label}</span>
      <code
        className="text-[11px] text-gray-500 font-mono truncate"
        title={value}
      >
        {shortId(value)}
      </code>
    </div>
  )
}

export function ProposalCard({ proposal }: Props) {
  const isReorder = proposal.action.actionType === 'reorder'
  const original = proposal.action.payload

  const [quantity, setQuantity] = useState<string>(
    isReorder ? String((original as ReorderPayload).quantity ?? '') : '',
  )
  const [unitType, setUnitType] = useState<string>(
    isReorder ? ((original as ReorderPayload).unitType ?? '') : '',
  )
  const [instruction, setInstruction] = useState<string>(
    !isReorder ? ((original as VendorDraftPayload).instruction ?? '') : '',
  )

  const [phase, setPhase] = useState<Phase>('editing')
  const [notice, setNotice] = useState<string | null>(null)
  const [executionRef, setExecutionRef] = useState<string | null>(null)
  const [wasEdited, setWasEdited] = useState(false)

  /** The payload as currently typed, or null when a field is locally invalid. */
  const edited = useMemo<AskAiPayload | null>(() => {
    if (isReorder) {
      const o = original as ReorderPayload
      const n = Number(quantity)
      if (!quantity.trim() || !Number.isInteger(n) || n < 1) return null
      const unit = unitType.trim()
      return {
        inventoryId: o.inventoryId,
        providerId: o.providerId,
        quantity: n,
        ...(unit ? { unitType: unit } : {}),
      }
    }
    const o = original as VendorDraftPayload
    if (!instruction.trim()) return null
    return { orderId: o.orderId, instruction: instruction.trim() }
  }, [isReorder, original, quantity, unitType, instruction])

  const dirty = useMemo(() => {
    if (!edited) return false
    return JSON.stringify(edited) !== JSON.stringify(original)
  }, [edited, original])

  /** Local guard only — it saves a round trip, it does not replace the server's. */
  const localProblem = useMemo(() => {
    if (edited) {
      if (isReorder && (edited as ReorderPayload).quantity > MAX_REORDER_QUANTITY) {
        return `Ask AI will not propose more than ${MAX_REORDER_QUANTITY} — place a larger order on the Orders page.`
      }
      return null
    }
    if (isReorder) return 'Quantity must be a whole number of at least 1.'
    return 'The draft needs an instruction.'
  }, [edited, isReorder])

  const busy = phase === 'working'
  const settled =
    phase === 'executed' || phase === 'discarded' || phase === 'gone' || phase === 'failed'

  async function onConfirm() {
    if (busy || !edited || localProblem) return
    setPhase('working')
    setNotice(null)
    try {
      // Only send a payload when something actually changed: an untouched
      // confirm must reach the gateway as "confirm as proposed".
      const result = await confirmAction(proposal.actionId, dirty ? edited : undefined)
      setWasEdited(result.edited)
      setExecutionRef(result.executionRef || null)
      setPhase('executed')
    } catch (error) {
      const err = error as AskAiActionError
      if (err?.kind === 'rejected') {
        // Rolled back to `proposed` server-side — the card stays usable.
        setPhase('editing')
        setNotice(err.message)
        return
      }
      if (err?.kind === 'gone') {
        setPhase('gone')
        setNotice(err.message)
        return
      }
      setPhase('failed')
      setNotice(err?.message ?? 'That action could not be executed.')
    }
  }

  async function onDiscard() {
    if (busy) return
    setPhase('working')
    setNotice(null)
    try {
      await discardAction(proposal.actionId)
      setPhase('discarded')
    } catch (error) {
      const err = error as AskAiActionError
      if (err?.kind === 'gone') {
        setPhase('gone')
        setNotice(err.message)
        return
      }
      setPhase('editing')
      setNotice(err?.message ?? 'That action could not be discarded.')
    }
  }

  const Icon = isReorder ? ShoppingCart : Mail

  return (
    <article
      data-testid="askai-proposal-card"
      aria-label="Ask AI proposal"
      className="rounded-xl border border-gray-200 bg-white overflow-hidden"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="shrink-0 p-2 rounded-lg bg-wine-50 text-wine-700">
          <Icon className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{proposal.summary}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">
            {proposal.action.family} · {proposal.action.actionType}
          </p>
        </div>
      </div>

      {/* ── Editable fields ───────────────────────────────────────────── */}
      {!settled && (
        <div className="px-4 pb-3 space-y-2 border-t border-gray-100 pt-3">
          {isReorder ? (
            <>
              <IdField label="Item" value={(original as ReorderPayload).inventoryId} />
              <IdField label="Vendor" value={(original as ReorderPayload).providerId} />
              <div className="flex items-center gap-3">
                <label
                  className="text-xs text-gray-500 w-16 shrink-0"
                  htmlFor={`qty-${proposal.actionId}`}
                >
                  Quantity
                </label>
                <input
                  id={`qty-${proposal.actionId}`}
                  type="number"
                  min={1}
                  max={MAX_REORDER_QUANTITY}
                  step={1}
                  value={quantity}
                  disabled={busy}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-24 px-2 py-1.5 text-sm rounded-lg border border-gray-200 outline-none focus:border-wine-400"
                />
                <label
                  className="text-xs text-gray-500 shrink-0"
                  htmlFor={`unit-${proposal.actionId}`}
                >
                  Unit
                </label>
                <input
                  id={`unit-${proposal.actionId}`}
                  type="text"
                  value={unitType}
                  disabled={busy}
                  placeholder="optional"
                  onChange={(e) => setUnitType(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg border border-gray-200 outline-none focus:border-wine-400"
                />
              </div>
            </>
          ) : (
            <>
              <IdField label="Order" value={(original as VendorDraftPayload).orderId} />
              <label
                className="block text-xs text-gray-500"
                htmlFor={`instruction-${proposal.actionId}`}
              >
                What the reply should say
              </label>
              <textarea
                id={`instruction-${proposal.actionId}`}
                rows={3}
                value={instruction}
                disabled={busy}
                onChange={(e) => setInstruction(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 outline-none focus:border-wine-400 resize-y"
              />
            </>
          )}

          {dirty && !localProblem && (
            <p className="text-[11px] text-gray-500 flex items-center gap-1">
              <Info className="w-3 h-3 shrink-0" />
              Edited — your version is what gets confirmed, and it is re-checked
              before it runs.
            </p>
          )}
          {localProblem && (
            <p className="text-[11px] text-amber-700 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {localProblem}
            </p>
          )}
        </div>
      )}

      {/* ── Server said no to the edit: keep everything, explain it ───── */}
      {notice && phase === 'editing' && (
        <div
          role="alert"
          className="mx-4 mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900"
        >
          {notice}
        </div>
      )}

      {/* ── Terminal states ──────────────────────────────────────────── */}
      {phase === 'executed' && (
        <div
          role="status"
          className="mx-4 mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Check className="w-3.5 h-3.5 shrink-0" />
            {isReorder ? 'Draft order created' : 'Draft reply staged'}
            {wasEdited ? ' from your edits' : ''}.
          </span>
          {/* Both executors produce a DRAFT. Saying otherwise would be a lie
              the operator only discovers when the vendor never replies. */}
          <span className="block mt-0.5">
            Nothing has been sent — it still needs approving
            {isReorder ? ' on the Orders page' : ' in Communications'}.
          </span>
          {executionRef && (
            <code className="block mt-1 text-[10px] font-mono opacity-70">
              ref {shortId(executionRef)}
            </code>
          )}
        </div>
      )}

      {phase === 'discarded' && (
        <div
          role="status"
          className="mx-4 mb-4 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600"
        >
          Discarded. Nothing ran.
        </div>
      )}

      {phase === 'gone' && (
        // Not an error: the compare-and-swap did its job and exactly one
        // execution happened.
        <div
          role="status"
          className="mx-4 mb-4 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600"
        >
          {notice ?? 'That action is no longer waiting for confirmation.'} It was
          already handled — nothing ran twice.
        </div>
      )}

      {phase === 'failed' && (
        <div
          role="alert"
          className="mx-4 mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-900"
        >
          {notice}
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────── */}
      {!settled && (
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100">
          <button
            type="button"
            onClick={onDiscard}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            Discard
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !!localProblem}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {dirty ? 'Confirm edits' : 'Confirm'}
          </button>
        </div>
      )}
    </article>
  )
}

export default ProposalCard
