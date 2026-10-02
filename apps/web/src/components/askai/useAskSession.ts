/**
 * What the Ask panel has asked this sitting. It is owned by whoever owns the
 * panel's open state (`useAskPanel`), so it outlives a close.
 *
 * The panel's body unmounts when it closes (`AskPanel` returns null). While
 * the question in flight lived in that body, closing mid-answer dropped it.
 * The gateway still answered and saved it, but the panel reopened blank, and
 * asking again minted a new request id, so the house paid twice (PR #575
 * audit). The gateway already charges once per request id: a repeated id
 * returns the saved folio, pending or finished (`bound-ask.service.ts`). So
 * all the client owes is to keep the question, its id and its outcome alive.
 * Founder, 2026-10-01: "Keep answering (Recommended)" (ADR 0145, amendment
 * of that date).
 *
 * An action being drafted is kept the same way. The proposer takes no
 * request id, so what stops a second call there is the panel staying busy
 * across the close.
 *
 * WHAT A CLOSE KEEPS. The question in flight and its answer; a failure that
 * offers "Check again" (the same-id retry) with the request it re-sends; and
 * the proposer's refusal of a drafted action, with the words it declined. A
 * failure with nothing to retry ("10 a minute", "not open yet") and the
 * proposer's transport error are dropped at the close. One that lands while
 * the panel is closed is the in-flight question's outcome, so it is shown on
 * the next open and dropped at that close. A proposal that was applied,
 * discarded, already handled or failed leaves the list at the close (at once,
 * if it settled while the panel was closed), so a reopen never shows it as a
 * card to seal again, even when the on-open re-read fails.
 *
 * WHOSE SITTING. One person in one house: `scope` is `<person>@<house>`, the
 * key "the house said" is bound by (`houseSaid.ts`, `HouseShell.tsx`). The
 * shell is mounted once and a branch switch happens in place, so without
 * this house A's answers showed in house B, and "Check again" re-sent house
 * A's request id in house B, where the once-per-id key includes the house:
 * a new paid call. When the scope changes the session starts again, and the
 * epoch moves on, so anything begun under the old scope (an answer, a
 * refusal, a proposal, a failure) lands nowhere and does not let go of a
 * newer request's gate. The answer itself is still in that house's book at
 * /ask.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { askApi, type AskFolio, type AskSubmit } from '../../services/api/ask'
import { proposeAction, type AskAiProposal } from '../../services/api/askAi'
import { getErrorMessage } from '../../services/api/client'
import { askFailure, type AskFailure } from '../../pages/ask/next/ask-format'

/** How many of this sitting's answers the panel keeps in view; the rest are in the book at /ask. */
const PANEL_FOLIOS = 5

/** What is being answered right now. `check` is a re-read of a saved folio, which spends nothing. */
export interface AskPending {
  kind: 'ask' | 'propose' | 'check'
  words: string
}

export interface AskSession {
  /** Whose sitting this is, `<person>@<house>`, or null before anyone is. */
  scope: string | null
  folios: AskFolio[]
  failure: AskFailure | null
  /** Set by an ask whose failure offers "Check again", which re-sends this SAME request id (the gateway never pays twice for it); cleared by its answer, or when an ask fails with nothing to retry. */
  lastRequest: AskSubmit | null
  /** The gateway's reason for declining, with the words it declined. Always rendered when present. */
  refusal: { reason: string; utterance: string } | null
  /** A transport/5xx failure from the proposer: different from a refusal, and said differently. */
  error: string | null
  proposals: AskAiProposal[]
  pending: AskPending | null
  /** Resolves true once the answer is in the session. A send while another is in flight does nothing. */
  sendAsk: (req: AskSubmit) => Promise<boolean>
  /** `words` as typed (kept for "Ask the books this instead"); `utterance` as sent, page context included. */
  sendPropose: (words: string, utterance: string) => Promise<boolean>
  checkFolio: (folio: AskFolio) => Promise<void>
  setProposals: (rows: AskAiProposal[]) => void
  /** A card was applied, discarded, already handled or failed. It leaves the list at the close. */
  settleProposal: (actionId: string) => void
  clearRefusal: () => void
}

export function useAskSession(scope: string | null, open: boolean): AskSession {
  const [folios, setFolios] = useState<AskFolio[]>([])
  const [failure, setFailure] = useState<AskFailure | null>(null)
  const [lastRequest, setLastRequest] = useState<AskSubmit | null>(null)
  const [refusal, setRefusal] = useState<{ reason: string; utterance: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [proposals, setProposals] = useState<AskAiProposal[]>([])
  const [pending, setPending] = useState<AskPending | null>(null)
  // The gate is a ref, not `pending`: a body mounted after the send began
  // reads `pending` from a later render, but two sends in one tick must
  // still see each other.
  const inFlight = useRef(false)
  /** Moves on when the scope changes. Work begun under an older epoch lands nowhere. */
  const epoch = useRef(0)
  const boundScope = useRef(scope)
  /** Cards that settled this sitting. They leave the list at the close. */
  const settled = useRef(new Set<string>())
  const isOpen = useRef(open)

  /** Takes the gate and returns the epoch the work belongs to, or null when something is already in flight. */
  const begin = useCallback((p: AskPending): number | null => {
    if (inFlight.current) return null
    inFlight.current = true
    setPending(p)
    return epoch.current
  }, [])
  /** Lets go of the gate, unless a scope change already did: a newer request may hold it now. */
  const end = useCallback((mine: number) => {
    if (mine !== epoch.current) return
    inFlight.current = false
    setPending(null)
  }, [])

  // A new person or a new house starts the sitting again: the same idiom as
  // `bindHouseSaid` and the shell's prefs (`HouseShell.tsx`). As there, the
  // first naming keeps what is already there: it is the same sitting, named.
  useEffect(() => {
    if (boundScope.current === scope) return
    const previous = boundScope.current
    boundScope.current = scope
    if (previous === null) return
    epoch.current += 1
    inFlight.current = false
    settled.current = new Set()
    setFolios([])
    setFailure(null)
    setLastRequest(null)
    setRefusal(null)
    setError(null)
    setProposals([])
    setPending(null)
  }, [scope])

  // The close: drop what the ruling does not keep (see WHAT A CLOSE KEEPS).
  useEffect(() => {
    isOpen.current = open
    if (open) return
    setFailure((f) => (f?.checkAgain ? f : null))
    setError(null)
    setProposals((rows) => rows.filter((p) => !settled.current.has(p.actionId)))
  }, [open])

  const sendAsk = useCallback(
    async (req: AskSubmit) => {
      const mine = begin({ kind: 'ask', words: req.utterance })
      if (mine === null) return false
      setFailure(null)
      try {
        const saved = await askApi.submit(req, 'panel')
        if (mine !== epoch.current) return false
        setFolios((prev) => [saved, ...prev.filter((f) => f.id !== saved.id)].slice(0, PANEL_FOLIOS))
        setLastRequest(null)
        return true
      } catch (e) {
        if (mine !== epoch.current) return false
        const f = askFailure(e)
        setFailure(f)
        setLastRequest(f.checkAgain ? req : null)
        return false
      } finally {
        end(mine)
      }
    },
    [begin, end],
  )

  const sendPropose = useCallback(
    async (words: string, utterance: string) => {
      const mine = begin({ kind: 'propose', words })
      if (mine === null) return false
      setRefusal(null)
      setError(null)
      try {
        const result = await proposeAction(utterance)
        if (mine !== epoch.current) return false
        if (!result.proposed || !result.proposal) {
          // The honest answer, shown in full. The words are kept so the
          // operator can adjust two of them instead of retyping the sentence.
          setRefusal({ reason: result.reason ?? 'Mudavym declined, without a reason.', utterance: words })
          return false
        }
        setProposals((prev) => [result.proposal!, ...prev])
        return true
      } catch (err) {
        if (mine !== epoch.current) return false
        setError(getErrorMessage(err))
        return false
      } finally {
        end(mine)
      }
    },
    [begin, end],
  )

  const checkFolio = useCallback(
    async (folio: AskFolio) => {
      const mine = begin({ kind: 'check', words: folio.utterance })
      if (mine === null) return
      try {
        const fresh = await askApi.folio(folio.id)
        // No epoch check needed here: a scope change empties `folios`, and a
        // re-read only replaces a folio already in the list.
        setFolios((prev) => prev.map((x) => (x.id === fresh.id ? fresh : x)))
      } catch (e) {
        if (mine !== epoch.current) return
        setFailure(askFailure(e))
      } finally {
        end(mine)
      }
    },
    [begin, end],
  )

  const settleProposal = useCallback((actionId: string) => {
    settled.current.add(actionId)
    // Settled after a close, its card already gone: leave now, or the next
    // open would draw it as a card to seal again.
    if (!isOpen.current) setProposals((rows) => rows.filter((p) => p.actionId !== actionId))
  }, [])

  const clearRefusal = useCallback(() => setRefusal(null), [])

  return {
    scope,
    folios,
    failure,
    lastRequest,
    refusal,
    error,
    proposals,
    pending,
    sendAsk,
    sendPropose,
    checkFolio,
    setProposals,
    settleProposal,
    clearRefusal,
  }
}
