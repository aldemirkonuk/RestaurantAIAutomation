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
 *  • The ids — editable, and now with a control worth editing them through.
 *    `GET /ask-ai/candidates` returns the SAME capped set the propose prompt
 *    was handed and the confirm grounds against, so every option the picker
 *    offers is an id the server will accept. That identity is the only reason
 *    a picker is safe here: one built from a wider or differently-ordered
 *    query would offer choices that fail grounding at confirm, which is a
 *    worse control than the read-only row it replaced.
 *
 *    Two ways that set can fail to contain the proposed id — it was capped
 *    out, or the row went inactive between propose and now. The select then
 *    carries the current id as its own leading option rather than dropping it.
 *    Silently rewriting what a person is about to confirm is the one thing a
 *    confirm gate must never do; and an UNTOUCHED confirm sends no payload at
 *    all, so the stored id must still be the value showing.
 *
 *    When the candidate fetch has not landed, or failed, the ids degrade to
 *    the read-only rows they used to be. The old note still holds for that
 *    path: a bare uuid text box is not a UI, it is a trap.
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
import { isMeasuredUnit } from '../../lib/units'
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
  AskAiCandidates,
  AskAiPayload,
  AskAiProposal,
  CandidateOption,
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
  /**
   * What this restaurant's actions may point at. `AskAiBar` fetches it once
   * per open and shares it — one request for the whole stack of cards, not one
   * per card. `null` while it is in flight or after it failed, which is the
   * read-only fallback rather than an empty dropdown.
   */
  candidates?: AskAiCandidates | null
}

type Phase = 'editing' | 'working' | 'executed' | 'discarded' | 'gone' | 'failed'

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

/**
 * The id row: a picker when there is something to pick from, the old read-only
 * row when there is not.
 *
 * The degraded path is deliberate and is not an empty `<select>`. A dropdown
 * with no options looks like "you have no vendors", which is a different and
 * much more alarming claim than "the list did not load" — the same conflation
 * the gateway refuses to make by throwing instead of returning `[]`.
 *
 * `options` is `null` when the candidate fetch is in flight or failed.
 */
function IdPicker({
  label,
  value,
  options,
  capped,
  disabled,
  inputId,
  onChange,
}: {
  label: string
  value: string
  options: CandidateOption[] | null
  capped?: boolean
  disabled?: boolean
  inputId: string
  onChange: (id: string) => void
}) {
  if (!options) {
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

  // The proposed id can be outside the candidate set — capped out, or the row
  // went inactive since the proposal was made. Keep it as the selected option
  // rather than letting the select fall through to its first entry: an
  // untouched Confirm sends no payload at all, so what is showing has to be
  // what will actually run.
  const known = options.some((o) => o.id === value)

  return (
    <div className="flex items-center gap-3 py-1">
      <label className="text-xs text-gray-500 w-16 shrink-0" htmlFor={inputId}>
        {label}
      </label>
      <div className="flex-1 min-w-0">
        <select
          id={inputId}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white outline-none focus:border-wine-400 disabled:opacity-50"
        >
          {!known && (
            <option value={value}>As proposed ({shortId(value)})</option>
          )}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {capped && (
          // Not "there are more on page two" — there is no page two. This list
          // IS what the confirm grounds against, so anything past the cap is
          // out of Ask AI's reach entirely, and saying so beats a short list
          // that looks complete.
          <p className="mt-0.5 text-[11px] text-gray-400">
            Showing the first {options.length} — Ask AI cannot act on more than
            this.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Payload equality that does not care about key order — see `dirty` below for
 * why that matters. Shallow by design: every field in both payload shapes is a
 * string or a number, and `unitType` is the only optional one.
 */
function samePayload(a: AskAiPayload, b: AskAiPayload): boolean {
  const A = a as unknown as Record<string, unknown>
  const B = b as unknown as Record<string, unknown>
  // An absent `unitType` and an empty one mean the same thing to the gateway,
  // and the input renders `undefined` as "". Without this, clearing a unit that
  // was never set would count as an edit.
  const keys = new Set([...Object.keys(A), ...Object.keys(B)])
  for (const k of keys) {
    const av = A[k] ?? ''
    const bv = B[k] ?? ''
    if (av !== bv) return false
  }
  return true
}

export function ProposalCard({ proposal, candidates }: Props) {
  const isReorder = proposal.action.actionType === 'reorder'
  const original = proposal.action.payload

  // The ids are state now, not read-only reads off `original`. They still
  // START at what was proposed, so a card nobody touches confirms exactly what
  // the model put in front of the operator.
  const [inventoryId, setInventoryId] = useState<string>(
    isReorder ? ((original as ReorderPayload).inventoryId ?? '') : '',
  )
  const [providerId, setProviderId] = useState<string>(
    isReorder ? ((original as ReorderPayload).providerId ?? '') : '',
  )
  const [orderId, setOrderId] = useState<string>(
    !isReorder ? ((original as VendorDraftPayload).orderId ?? '') : '',
  )

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

  /** The payload as currently chosen, or null when a field is locally invalid. */
  const edited = useMemo<AskAiPayload | null>(() => {
    if (isReorder) {
      const n = Number(quantity)
      // A fraction is legal for a unit that MEASURES and illegal for one that
      // COUNTS, so this cannot be decided without the unit (ADR 0071). It used
      // to be: `!Number.isInteger(n)` greyed out the confirm button for 4.5 kg
      // of flour exactly as it did for 4.5 bottles.
      //
      // The client only decides whether the card is submittable. The gateway
      // decides whether the order is legal, through resolveOrderUnits, and its
      // refusal is the one the operator reads — so this test stays deliberately
      // looser than the server's rather than trying to mirror it and drifting.
      if (!quantity.trim() || !Number.isFinite(n) || n <= 0) return null
      if (!isMeasuredUnit(unitType) && !Number.isInteger(n)) return null
      if (!inventoryId || !providerId) return null
      const unit = unitType.trim()
      return {
        inventoryId,
        providerId,
        quantity: n,
        ...(unit ? { unitType: unit } : {}),
      }
    }
    if (!orderId) return null
    if (!instruction.trim()) return null
    return { orderId, instruction: instruction.trim() }
  }, [isReorder, inventoryId, providerId, orderId, quantity, unitType, instruction])

  /**
   * Did anything actually change?
   *
   * NOT `JSON.stringify(a) !== JSON.stringify(b)`. That is key-order sensitive,
   * and the two sides do not agree on key order: a card rendered from a propose
   * response carries the object this gateway built, while a card restored by
   * `GET /ask-ai/actions` carries a `jsonb` column, and Postgres normalises
   * jsonb key order (length, then bytewise) rather than preserving it. So a
   * reorder read back from the database returns as `{quantity, providerId,
   * inventoryId}` while this component builds `{inventoryId, providerId,
   * quantity}` — identical payloads, different strings.
   *
   * The consequence was not cosmetic. Every proposal that survived a reload
   * read as edited: the button said "Confirm edits", the "your version is what
   * gets confirmed" note appeared on a card nobody had touched, and the confirm
   * sent a payload — so the gateway recorded `edited: true` and filed an edit
   * verdict. That is exactly the "a human fixed it" vs "the model was right"
   * conflation the `executed_payload` column exists to keep apart, so the P3.0
   * edit-rate ledger read 100% edited for every restored reorder.
   */
  const dirty = useMemo(() => {
    if (!edited) return false
    return !samePayload(edited, original)
  }, [edited, original])

  /** Local guard only — it saves a round trip, it does not replace the server's. */
  const localProblem = useMemo(() => {
    if (edited) {
      if (isReorder && (edited as ReorderPayload).quantity > MAX_REORDER_QUANTITY) {
        return `Ask AI will not propose more than ${MAX_REORDER_QUANTITY} — place a larger order on the Orders page.`
      }
      return null
    }
    if (isReorder) {
      if (!inventoryId) return 'Pick the item to reorder.'
      if (!providerId) return 'Pick the vendor to order from.'
      // The reason has to name the unit, or it is wrong half the time: "must be
      // a whole number" is simply untrue of 4.5 kg, and an operator reading it
      // against a flour order learns the form is broken rather than what to fix.
      return isMeasuredUnit(unitType)
        ? `Quantity must be a positive number in ${unitType.trim()}, to at most three decimal places.`
        : 'Quantity must be a whole number of at least 1.'
    }
    if (!orderId) return 'Pick the order to reply on.'
    return 'The draft needs an instruction.'
  }, [edited, isReorder, inventoryId, providerId, orderId, unitType])

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
              <IdPicker
                label="Item"
                inputId={`inventory-${proposal.actionId}`}
                value={inventoryId}
                options={candidates?.inventory ?? null}
                capped={candidates?.capped.inventory}
                disabled={busy}
                onChange={setInventoryId}
              />
              <IdPicker
                label="Vendor"
                inputId={`provider-${proposal.actionId}`}
                value={providerId}
                options={candidates?.providers ?? null}
                capped={candidates?.capped.providers}
                disabled={busy}
                onChange={setProviderId}
              />
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
                  min={isMeasuredUnit(unitType) ? 0.001 : 1}
                  // The 500-unit cap was reasoned about as a COUNT ceiling —
                  // "12 cases misparsed as 1200". It is meaningless against a
                  // mass, where 500 g of saffron is a fortune and 500 kg of
                  // flour is a Tuesday, so it does not apply to a measured unit.
                  max={isMeasuredUnit(unitType) ? undefined : MAX_REORDER_QUANTITY}
                  // step=1 is what made the browser refuse 4.5 before any code
                  // ran. 0.001 is the quantity column's real precision.
                  step={isMeasuredUnit(unitType) ? 0.001 : 1}
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
              <IdPicker
                label="Order"
                inputId={`order-${proposal.actionId}`}
                value={orderId}
                options={candidates?.orders ?? null}
                capped={candidates?.capped.orders}
                disabled={busy}
                onChange={setOrderId}
              />
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
