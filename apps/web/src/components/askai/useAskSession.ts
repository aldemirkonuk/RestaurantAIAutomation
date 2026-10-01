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
 */

import { useCallback, useRef, useState } from 'react'
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
  folios: AskFolio[]
  failure: AskFailure | null
  /** Kept so "Check again" re-sends the SAME request id (the gateway returns the saved folio, never pays twice). */
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
  clearRefusal: () => void
}

export function useAskSession(): AskSession {
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

  const begin = useCallback((p: AskPending) => {
    if (inFlight.current) return false
    inFlight.current = true
    setPending(p)
    return true
  }, [])
  const end = useCallback(() => {
    inFlight.current = false
    setPending(null)
  }, [])

  const sendAsk = useCallback(
    async (req: AskSubmit) => {
      if (!begin({ kind: 'ask', words: req.utterance })) return false
      setFailure(null)
      setLastRequest(req)
      try {
        const saved = await askApi.submit(req, 'panel')
        setFolios((prev) => [saved, ...prev.filter((f) => f.id !== saved.id)].slice(0, PANEL_FOLIOS))
        setLastRequest(null)
        return true
      } catch (e) {
        setFailure(askFailure(e))
        return false
      } finally {
        end()
      }
    },
    [begin, end],
  )

  const sendPropose = useCallback(
    async (words: string, utterance: string) => {
      if (!begin({ kind: 'propose', words })) return false
      setRefusal(null)
      setError(null)
      try {
        const result = await proposeAction(utterance)
        if (!result.proposed || !result.proposal) {
          // The honest answer, shown in full. The words are kept so the
          // operator can adjust two of them instead of retyping the sentence.
          setRefusal({ reason: result.reason ?? 'Mudavym declined, without a reason.', utterance: words })
          return false
        }
        setProposals((prev) => [result.proposal!, ...prev])
        return true
      } catch (err) {
        setError(getErrorMessage(err))
        return false
      } finally {
        end()
      }
    },
    [begin, end],
  )

  const checkFolio = useCallback(
    async (folio: AskFolio) => {
      if (!begin({ kind: 'check', words: folio.utterance })) return
      try {
        const fresh = await askApi.folio(folio.id)
        setFolios((prev) => prev.map((x) => (x.id === fresh.id ? fresh : x)))
      } catch (e) {
        setFailure(askFailure(e))
      } finally {
        end()
      }
    },
    [begin, end],
  )

  const clearRefusal = useCallback(() => setRefusal(null), [])

  return {
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
    clearRefusal,
  }
}
