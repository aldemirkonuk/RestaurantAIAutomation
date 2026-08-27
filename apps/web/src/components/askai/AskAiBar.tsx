/**
 * AskAiBar — the global Ask AI surface (P3.C, FUTURES §8).
 *
 * ⌘K-adjacent by design: ⌘⇧K opens it, the overlay grammar matches
 * `CommandPalette`, and it deliberately does NOT try to be the palette. The
 * palette runs commands it already knows; this asks for one it does not, and
 * the answer is a proposal a human has to confirm. Two different contracts, two
 * different surfaces, one keyboard idiom.
 *
 * WHAT THIS SURFACE PROMISES
 * --------------------------
 *  • It never executes. `POST /propose` cannot, by construction; the only
 *    execution path in this component tree is a Confirm button on a card.
 *  • A refusal always says why. The gateway guarantees `reason` on every
 *    `{proposed: false}`, and it is rendered as the answer — not as an error,
 *    and never as a silent no-op. "Ask AI could not do that" with nothing after
 *    it is the thing that teaches people to stop opening this box.
 *  • Page context is visible before it is sent. See `page-context.ts`.
 *
 * Keyboard events are stopped at the overlay boundary so the app's global
 * `g`-then-key navigation cannot fire while someone is typing an order into
 * this box. `CommandProvider` owns those bindings; this just declines to leak
 * into them.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  AlertCircle,
  CornerDownLeft,
  Loader2,
  MapPin,
  Sparkles,
} from 'lucide-react'
import {
  AskAiProposal,
  listOpenProposals,
  proposeAction,
} from '../../services/api/askAi'
import { getErrorMessage } from '../../services/api/client'
import { ProposalCard } from './ProposalCard'
import { composeUtterance, derivePageContext } from './page-context'

const EXAMPLES = [
  'Reorder 6 bottles of the Barolo from our usual vendor',
  'Draft a follow-up to Acme about the late delivery',
]

export function AskAiBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const [ask, setAsk] = useState('')
  const [asking, setAsking] = useState(false)
  /** The gateway's reason for declining. Always rendered when present. */
  const [refusal, setRefusal] = useState<string | null>(null)
  /** A transport/5xx failure — different from a refusal, and said differently. */
  const [error, setError] = useState<string | null>(null)
  const [proposals, setProposals] = useState<AskAiProposal[]>([])
  const [useContext, setUseContext] = useState(true)

  const pageContext = derivePageContext(location.pathname, location.search)

  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement
      setRefusal(null)
      setError(null)
      // Focused synchronously, NOT in a requestAnimationFrame. React has set
      // the ref by the time an effect runs, so the frame buys nothing — and a
      // callback that lands one frame later can steal focus out of a proposal
      // card the operator has already started editing. Found by a test that
      // typed an edit into the ask box instead of the card.
      inputRef.current?.focus()
    } else {
      setAsk('')
      setProposals([])
      restoreFocusRef.current?.focus?.()
    }
  }, [open])

  // Proposals outlive a page reload: a row sitting at `proposed` is a decision
  // somebody still owes. Fails quiet — an empty list and a broken list look the
  // same to a user, so the ask box stays usable either way.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    listOpenProposals()
      .then((rows) => {
        if (!cancelled) setProposals(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  const submit = useCallback(async () => {
    const trimmed = ask.trim()
    if (!trimmed || asking) return
    setAsking(true)
    setRefusal(null)
    setError(null)
    try {
      const result = await proposeAction(
        composeUtterance(trimmed, useContext ? pageContext : null),
      )
      if (!result.proposed || !result.proposal) {
        // The honest answer, shown in full. The text is kept so the operator
        // can adjust two words instead of retyping the sentence.
        setRefusal(result.reason ?? 'Ask AI declined, without a reason.')
        return
      }
      setProposals((prev) => [result.proposal!, ...prev])
      setAsk('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setAsking(false)
    }
  }, [ask, asking, pageContext, useContext])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Ask AI"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        // Keep `g`-then-key nav and `?` from firing under this overlay.
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      <div
        className="absolute inset-0 bg-gray-900/40 motion-safe:animate-[fadeIn_120ms_ease-out]"
        aria-hidden
      />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden motion-safe:animate-[popIn_120ms_ease-out]">
        {/* Ask */}
        <div className="flex items-center gap-2.5 px-4 border-b border-gray-100">
          <Sparkles className="w-4 h-4 text-wine-600 shrink-0" />
          <input
            ref={inputRef}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder="Ask for an action — reorder stock, draft a vendor reply…"
            aria-label="Ask AI for an action"
            className="flex-1 py-3.5 text-sm bg-transparent outline-none placeholder:text-gray-400"
            autoComplete="off"
            spellCheck={false}
            disabled={asking}
          />
          {asking ? (
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin shrink-0" />
          ) : (
            <kbd className="hidden sm:inline text-[10px] font-medium text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
              esc
            </kbd>
          )}
        </div>

        {/* Page context — visible before it is sent, and switchable off. */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
          <button
            type="button"
            onClick={() => setUseContext((v) => !v)}
            aria-pressed={useContext}
            title={pageContext.line}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] border ${
              useContext
                ? 'bg-wine-50 border-wine-200 text-wine-800'
                : 'bg-gray-50 border-gray-200 text-gray-400 line-through'
            }`}
          >
            <MapPin className="w-3 h-3" />
            {pageContext.label}
            {pageContext.recordId ? ' · this record' : ''}
          </button>
          <span className="text-[11px] text-gray-400">
            {useContext
              ? 'sent with your ask so “this” resolves'
              : 'context off — only your words are sent'}
          </span>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-4 space-y-3">
          {/* A refusal IS the answer. Rendered first, in full. */}
          {refusal && (
            <div
              role="status"
              data-testid="askai-refusal"
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
            >
              <p className="text-xs font-medium text-amber-900 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Ask AI did not propose an action
              </p>
              <p className="mt-1 text-xs text-amber-900">{refusal}</p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              data-testid="askai-error"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
            >
              {error}
            </div>
          )}

          {proposals.map((p) => (
            <ProposalCard key={p.actionId} proposal={p} />
          ))}

          {!refusal && !error && proposals.length === 0 && (
            <div className="py-4 text-center">
              <p className="text-xs text-gray-400">
                Ask AI proposes; you confirm. Nothing runs until you do.
              </p>
              <ul className="mt-3 space-y-1.5">
                {EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => {
                        setAsk(example)
                        inputRef.current?.focus()
                      }}
                      className="text-xs text-gray-500 hover:text-wine-700"
                    >
                      “{example}”
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400">
          <span className="flex items-center gap-1.5">
            <kbd className="border border-gray-200 rounded px-1">
              <CornerDownLeft className="w-2.5 h-2.5 inline" />
            </kbd>
            to ask
          </span>
          <span>Drafts only — nothing reaches a vendor without a second approval</span>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn { from { opacity: 0; transform: translateY(-6px) scale(.98) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  )
}

export default AskAiBar
