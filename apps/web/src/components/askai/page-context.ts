/**
 * The page context Ask AI folds into an utterance.
 *
 * FUTURES §8.3: "page context (current wine, order, provider) is injected so
 * 'reorder this' resolves without hunting IDs."
 *
 * The gateway's `POST /ask-ai/propose` takes `{utterance}` and nothing else —
 * there is no context field on the wire. So context travels as WORDS, appended
 * to what the operator typed. Two consequences worth stating rather than
 * discovering later:
 *
 *  1. The stored `utterance` on `ai_proposed_actions` is what the model was
 *     actually asked, context included. That is the honest record, not a
 *     leak — the alternative is a row that cannot explain its own proposal.
 *  2. The operator SEES the context line before sending it. A hidden prefix
 *     that steers a purchase order is exactly the kind of invisible machinery
 *     the confirm gate exists to make unnecessary.
 *
 * The id case is the one that earns this feature. A route like
 * `/orders/8f3a…` or `/inventory?item=8f3a…` already names the thing the
 * operator is looking at, and the gateway only accepts ids that are in the
 * candidate set it handed the model — so passing one through is a shortcut for
 * the model, never a way around grounding. An id we invent is rejected exactly
 * as a model-invented id is.
 */

import { routeLabel } from '../command/commands'

const UUID_ANYWHERE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i

export interface AskAiPageContext {
  /** Human label, e.g. "Orders". Always present. */
  label: string
  /** A uuid the route names, when it names one. */
  recordId?: string
  /** The one line appended to the utterance. Shown to the operator verbatim. */
  line: string
}

/**
 * Derive the page context from a route.
 *
 * `pathname` and `search` come straight from react-router's location, so this
 * is a pure function of the URL and can be tested without a browser.
 */
export function derivePageContext(
  pathname: string,
  search = '',
): AskAiPageContext {
  const label = routeLabel(pathname)

  const fromPath = pathname.match(UUID_ANYWHERE)?.[0]
  const fromQuery = !fromPath ? search.match(UUID_ANYWHERE)?.[0] : undefined
  const recordId = fromPath ?? fromQuery

  const line = recordId
    ? `(Context: the operator is on the ${label} page, looking at record ${recordId}. "this" most likely means that record.)`
    : `(Context: the operator is on the ${label} page.)`

  return { label, ...(recordId ? { recordId } : {}), line }
}

/**
 * Build what actually goes on the wire.
 *
 * Returns the bare ask when context is switched off, so an operator who does
 * not want the page steering the model can turn it off and get exactly what
 * they typed.
 */
export function composeUtterance(
  ask: string,
  context: AskAiPageContext | null,
): string {
  const trimmed = ask.trim()
  if (!context) return trimmed
  return `${trimmed}\n\n${context.line}`
}
