/**
 * The Ask panel's two modes, and the suggestion it shows between them.
 *
 * The founder, 2026-09-26, round 6 (ADR 0145): "One panel, two modes" --
 * "⌘⇧K opens the Ask panel. You type; a question gets an answer from your
 * books, and a request to do something gets a proposal you seal."
 *
 * WHO DECIDES WHICH MODE RUNS: THE PERSON, NEVER THIS FILE
 * ---------------------------------------------------------
 * The two backends answer different contracts and spend differently:
 * `POST /ask/folios` reads the house's books and saves a folio; `POST
 * /ask-ai/propose` drafts one allowlisted action that only a seal applies.
 * Neither backend classifies "question or request" today -- measured
 * 2026-09-26: the bound ask's pick (`bound-ask.service.ts` `pick`) sorts a
 * question among Readings and sends everything else to `unrecognized`, and the
 * proposer (`ask-ai.service.ts` SYSTEM_PROMPT) declines anything that is not a
 * reorder or a vendor draft. So there is no classifier to reuse BEFORE the
 * ask, and a model call to guess would spend on every keystroke's worth of
 * doubt.
 *
 * What this file does instead is SUGGEST, from the words alone, at no cost,
 * and only ever as a visible line the person can take or leave. The mode that
 * runs is the one shown selected in the panel. The backends' own verdicts are
 * reused AFTER an ask: a folio that came back `no_reading_matched` (the pick's
 * `unrecognized`) offers "Propose this as an action instead", and a proposer's
 * decline offers "Ask the books instead" -- each a click, never automatic.
 *
 * The request vocabulary is the proposer's allowlist and nothing wider
 * (`askAi.ts` `AskAiActionType`: reorder, vendor_draft). A suggestion to
 * propose something the proposer cannot draft would be a promise the panel
 * cannot keep.
 */

export type AskMode = 'ask' | 'propose'

/** The words a person would lead with to ask for one of the two allowlisted actions. */
const REQUEST_LEAD =
  /^(?:(?:please|pls|can you|could you|would you|will you|kindly|go ahead and|let'?s|i want to|i'?d like to|we need to)\s+)*(?:re-?order|order|restock|buy|purchase|top up|draft|write|reply|respond|email|message|chase|follow[- ]up with|follow up|send)\b/i

/** The words a question leads with. */
const QUESTION_LEAD =
  /^(?:how|what|what's|whats|which|when|where|who|whose|why|is|are|was|were|do|does|did|have|has|had|should|show|list|tell me|give me)\b/i

/**
 * A suggestion from the words alone: which mode they read like, or `null`
 * when they read like neither (the panel then suggests nothing).
 *
 * A request lead wins over a trailing question mark: "can you reorder the
 * Barolo?" asks for an action, politely.
 */
export function suggestAskMode(text: string): AskMode | null {
  const t = text.trim()
  if (t.length < 3) return null
  if (REQUEST_LEAD.test(t)) return 'propose'
  if (QUESTION_LEAD.test(t) || t.endsWith('?')) return 'ask'
  return null
}

/** What each mode says it does, before anything is sent. */
export const MODE_WORD: Record<AskMode, string> = {
  ask: 'Ask the books',
  propose: 'Propose an action',
}

export const MODE_CONTRACT: Record<AskMode, string> = {
  ask: 'Reads the house’s own books and answers. Nothing is written.',
  propose:
    'Drafts one action — a reorder or a vendor reply — for you to seal. Nothing runs until an owner or manager holds to seal it.',
}
