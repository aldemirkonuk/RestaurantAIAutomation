/**
 * The Ask panel — ONE panel, two modes (ADR 0145; the founder, 2026-09-26,
 * round 6: "One panel, two modes (Recommended)" — "⌘⇧K opens the Ask panel.
 * You type; a question gets an answer from your books, and a request to do
 * something gets a proposal you seal. One door to learn.").
 *
 * It replaces `AskAiBar`, the separate ⌘⇧K propose modal: that bar's whole
 * propose flow lives here now, as the panel's second mode.
 *
 *   Ask the books      `POST /ask/folios` (origin `panel`) — the bound ask:
 *                      a reading of the house's books, saved as a folio,
 *                      role rules and refusals the gateway's own.
 *   Propose an action  `POST /ask-ai/propose` — one allowlisted action (a
 *                      reorder, a vendor draft), shown as a `ProposalCard`
 *                      whose ONLY apply is the hold bound to a server seal.
 *
 * WHO PICKS THE MODE. The person. The mode that runs is the one shown
 * selected; the panel never guesses and acts. It SUGGESTS (see `ask-mode.ts`
 * for why the words, and not a model, make the suggestion), and after an
 * answer it offers the other mode when the backend's own verdict points
 * there — a folio that matched no reading, a proposal the proposer declined.
 * Each offer is a click.
 *
 * WHICH MODE IT OPENS ON. The person's LAST USED mode (ADR 0145, founder,
 * 2026-09-26 round 7: "the Ask panel opens in the person's last used mode; a
 * person's first open is 'Ask the books'"). Kept as `askLastMode` in the
 * account's `user_preferences` row (`useUserPreferences`) — the same
 * server-side store `ground` already rides in, not a device-only
 * `localStorage` key, so the choice follows the person to another device. A
 * mode is written back only once it differs from what the account already
 * holds, so the ordinary case (nobody has ever switched away from Ask) never
 * spends a write. See the `hydratedMode` / `baselineModeRef` block below.
 *
 * WHERE IT SITS (ADR 0145, 2026-09-21 layout and 2026-09-25 fork 3):
 *   docked   at ≥ ~1280 px, in the counter's slot beside a live page; the
 *            counter folds to its counted strip. Not modal: no scrim, no
 *            focus trap, the page keeps working.
 *   overlay  below ~1280 px (and in the legacy layout), a house `Panel` that
 *            lies over the page — "The page keeps its width, and the panel is
 *            a sheet you close."
 *
 * WHAT IT NEVER DOES. Write without the seal. Nothing here applies anything;
 * `ProposalCard`'s hold is the one path, and it needs an owner's or a
 * manager's seal (`ask-ai.controller.ts` `@Roles("owner", "manager")` on
 * seal-challenge and sealed-confirm).
 */

import { useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AlertCircle, CornerDownLeft, Loader2, MapPin, Sparkles } from 'lucide-react'
import { AuthContext } from '../../contexts/AuthContext'
import { useUserPreferences } from '../../hooks/useUserPreferences'
import {
  type AskAiCandidates,
  type AskAiProposal,
  listCandidates,
  listOpenProposals,
  proposeAction,
} from '../../services/api/askAi'
import { askApi, type AskFolio, type AskSubmit } from '../../services/api/ask'
import { getErrorMessage } from '../../services/api/client'
import {
  STAFF_LINE,
  askFailure,
  fmtValue,
  folioView,
  newRequestId,
  type AskFailure,
} from '../../pages/ask/next/ask-format'
import { ProposalCard } from './ProposalCard'
import { composeUtterance, derivePageContext } from './page-context'
import { MODE_CONTRACT, MODE_WORD, suggestAskMode, type AskMode } from './ask-mode'
import type { AskOpenDetail } from './events'
import { Panel } from '../mudavym/Sheet'
import './ask-panel.css'

const EXAMPLES: Record<AskMode, string[]> = {
  ask: ['How much of the house red do we have?', 'What arrives today?'],
  propose: ['Reorder 6 bottles of the Barolo from our usual vendor', 'Draft a follow-up to Acme about the late delivery'],
}

/** Said to staff in propose mode: they may draft; the seal is an owner's or a manager's. */
export const STAFF_PROPOSE_LINE = 'You can propose an action. An owner or a manager seals it before anything runs.'

/** How many of this sitting's answers the panel keeps in view; the rest are in the book at /ask. */
const PANEL_FOLIOS = 5

export interface AskPanelProps {
  placement: 'docked' | 'overlay'
  open: boolean
  onClose: () => void
  followUp?: AskOpenDetail['followUp'] | null
  onDropFollowUp?: () => void
}

function ModeSwitch({ mode, onMode }: { mode: AskMode; onMode: (m: AskMode) => void }) {
  return (
    <div className="mdv-askp__modes" role="radiogroup" aria-label="What Enter does">
      {(['ask', 'propose'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          className="mdv-askp__mode"
          onClick={() => onMode(m)}
        >
          {MODE_WORD[m]}
        </button>
      ))}
    </div>
  )
}

function PanelFolio({
  folio,
  busy,
  onCheckAgain,
  onPropose,
}: {
  folio: AskFolio
  busy: boolean
  onCheckAgain: (f: AskFolio) => void
  onPropose: (utterance: string) => void
}) {
  const v = folioView(folio)
  return (
    <article className="mdv-askp__folio" data-tone={v.tone} data-testid="askpanel-folio" aria-label="An answer from the books">
      <p className="mdv-askp__q">{folio.utterance}</p>
      <p className="mdv-askp__title">{v.title}</p>
      {v.line && (
        <p className="mdv-askp__line" data-testid="askpanel-line">
          {v.line}
        </p>
      )}
      {v.knowledge !== null && <p className="mdv-askp__line mdv-askp__line--pre">{v.knowledge}</p>}
      {v.figures.length > 0 && (
        <dl className="mdv-askp__figs">
          {v.figures.slice(0, 4).map((c) => (
            <div key={c.id}>
              <dt>{c.label}</dt>
              <dd>{fmtValue(c)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mdv-askp__acts">
        {v.tone === 'pending' && (
          <button type="button" className="mdv-link" disabled={busy} onClick={() => onCheckAgain(folio)}>
            Check again
          </button>
        )}
        <Link className="mdv-link" to={`/ask/f/${folio.id}`}>
          {v.choices.length > 0 ? 'Pick the record on its folio' : 'Open the whole folio'}
        </Link>
        {folio.answer?.kind === 'no_reading_matched' && (
          <button
            type="button"
            className="mdv-link"
            data-testid="askpanel-offer-propose"
            disabled={busy}
            onClick={() => onPropose(folio.utterance)}
          >
            Propose this as an action instead
          </button>
        )}
      </p>
    </article>
  )
}

function AskPanelBody({
  open,
  followUp,
  onDropFollowUp,
}: {
  open: boolean
  followUp: AskOpenDetail['followUp'] | null
  onDropFollowUp?: () => void
}) {
  const location = useLocation()
  const auth = useContext(AuthContext)
  const role = auth?.activeRole ?? null
  const inputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<AskMode>('ask')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  // Which mode this open starts on: the person's LAST USED mode, never a
  // per-device guess (ADR 0145, founder round 7). `askLastMode` lives on the
  // account (`useUserPreferences`), so it follows the person to another
  // device the same way `ground` already does.
  const { preferences, isPlaceholderData: prefsUnknown, updatePreferences } = useUserPreferences()
  /** Set once this open has read (or given up reading) the account's mode. */
  const [hydratedMode, setHydratedMode] = useState(false)
  /** The mode this open started on (or last wrote back) — writes fire only
   *  when `mode` has moved past this, so the ordinary all-Ask session never
   *  spends one. */
  const baselineModeRef = useRef<AskMode>('ask')

  useEffect(() => {
    if (hydratedMode || prefsUnknown) return
    const stored: AskMode = preferences.askLastMode === 'propose' ? 'propose' : 'ask'
    baselineModeRef.current = stored
    if (stored !== mode) setMode(stored)
    setHydratedMode(true)
  }, [hydratedMode, prefsUnknown, preferences.askLastMode, mode])

  useEffect(() => {
    if (!hydratedMode) return
    if (mode === baselineModeRef.current) return
    baselineModeRef.current = mode
    updatePreferences({ askLastMode: mode })
  }, [hydratedMode, mode, updatePreferences])

  // Ask the books.
  const [folios, setFolios] = useState<AskFolio[]>([])
  const [failure, setFailure] = useState<AskFailure | null>(null)
  /** Kept so "Check again" re-sends the SAME request id (the gateway returns the saved folio, never pays twice). */
  const [lastRequest, setLastRequest] = useState<AskSubmit | null>(null)

  // Propose an action — AskAiBar's flow, moved here whole.
  /** The gateway's reason for declining, with the words it declined. Always rendered when present. */
  const [refusal, setRefusal] = useState<{ reason: string; utterance: string } | null>(null)
  /** A transport/5xx failure — different from a refusal, and said differently. */
  const [error, setError] = useState<string | null>(null)
  const [proposals, setProposals] = useState<AskAiProposal[]>([])
  /**
   * The waiting proposals could not be read. Said in words (ADR 0145 build
   * task 14: AskAiBar's `.catch(() => {})` let "none waiting" and "could not
   * read" look the same; the panel and the page cannot disagree about that).
   */
  const [proposalsUnread, setProposalsUnread] = useState<string | null>(null)
  /** `null` = no picker yet (in flight or failed): the cards fall back to read-only ids. */
  const [candidates, setCandidates] = useState<AskAiCandidates | null>(null)
  const [sendContext, setUseContext] = useState(true)

  const pageContext = derivePageContext(location.pathname, location.search)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Proposals outlive a reload: a row at `proposed` is a decision somebody
  // still owes, so the panel shows them whichever mode it opens in. A failed
  // read is said, never drawn as "none waiting"; the ask box stays usable.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setProposalsUnread(null)
    listOpenProposals()
      .then((rows) => {
        if (!cancelled) setProposals(rows)
      })
      .catch((err) => {
        if (!cancelled) setProposalsUnread(getErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // The cards' id pickers, once per open (not per card). A failure leaves
  // `null`, the read-only fallback; the sealed apply still works.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    listCandidates()
      .then((sets) => {
        if (!cancelled) setCandidates(sets)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  const sendAsk = useCallback(
    async (req: AskSubmit) => {
      setBusy(true)
      setFailure(null)
      setLastRequest(req)
      try {
        const saved = await askApi.submit(req, 'panel')
        setFolios((prev) => [saved, ...prev.filter((f) => f.id !== saved.id)].slice(0, PANEL_FOLIOS))
        setLastRequest(null)
        setText('')
        onDropFollowUp?.()
      } catch (e) {
        setFailure(askFailure(e))
      } finally {
        setBusy(false)
      }
    },
    [onDropFollowUp],
  )

  const sendPropose = useCallback(
    async (words: string) => {
      setBusy(true)
      setRefusal(null)
      setError(null)
      try {
        const result = await proposeAction(composeUtterance(words, sendContext ? pageContext : null))
        if (!result.proposed || !result.proposal) {
          // The honest answer, shown in full. The text is kept so the
          // operator can adjust two words instead of retyping the sentence.
          setRefusal({ reason: result.reason ?? 'Mudavym declined, without a reason.', utterance: words })
          return
        }
        setProposals((prev) => [result.proposal!, ...prev])
        setText('')
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [pageContext, sendContext],
  )

  const askTheBooks = useCallback(
    (words: string) =>
      sendAsk({
        requestId: newRequestId(),
        utterance: words,
        ...(followUp ? { previousFolioId: followUp.folioId } : {}),
      }),
    [followUp, sendAsk],
  )

  const submit = useCallback(() => {
    const words = text.trim()
    if (!words || busy) return
    if (mode === 'ask') void askTheBooks(words)
    else void sendPropose(words)
  }, [askTheBooks, busy, mode, sendPropose, text])

  const checkFolio = useCallback(async (f: AskFolio) => {
    setBusy(true)
    try {
      const fresh = await askApi.folio(f.id)
      setFolios((prev) => prev.map((x) => (x.id === fresh.id ? fresh : x)))
    } catch (e) {
      setFailure(askFailure(e))
    } finally {
      setBusy(false)
    }
  }, [])

  // The backends' own verdicts, offered as the other mode — a click each.
  const proposeInstead = useCallback(
    (words: string) => {
      setMode('propose')
      setText(words)
      void sendPropose(words)
    },
    [sendPropose],
  )
  const askInstead = useCallback(
    (words: string) => {
      setMode('ask')
      setRefusal(null)
      setText(words)
      void askTheBooks(words)
    },
    [askTheBooks],
  )

  const suggestion = suggestAskMode(text)
  const suggest = !busy && suggestion !== null && suggestion !== mode ? suggestion : null

  return (
    <div className="mdv-askp__body">
      <ModeSwitch
        mode={mode}
        onMode={(m) => {
          setMode(m)
          inputRef.current?.focus()
        }}
      />
      <p className="mdv-askp__contract" data-testid="askpanel-contract">
        {MODE_CONTRACT[mode]}
      </p>

      <div className="mdv-field">
        <Sparkles size={15} aria-hidden style={{ color: 'var(--seal)', flex: 'none' }} />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={mode === 'ask' ? 'Ask the books — how much of the house red is left?' : 'Ask for an action — reorder stock, draft a vendor reply…'}
          aria-label={mode === 'ask' ? 'Your question for the books' : 'The action to propose'}
          autoComplete="off"
          spellCheck={false}
          maxLength={2000}
          disabled={busy}
        />
        {busy ? <Loader2 size={14} aria-hidden style={{ color: 'var(--ink-3)', flex: 'none' }} /> : <kbd className="mdv-kbd">esc</kbd>}
      </div>

      {suggest && (
        <p className="mdv-askp__suggest" role="status" data-testid="askpanel-suggestion" data-suggests={suggest}>
          {suggest === 'propose' ? 'This reads like a request to do something.' : 'This reads like a question for the books.'}{' '}
          <button type="button" className="mdv-link" onClick={() => setMode(suggest)}>
            {suggest === 'propose' ? 'Switch to Propose an action' : 'Switch to Ask the books'}
          </button>{' '}
          <span className="mdv-askp__quiet">Enter still does what is selected above.</span>
        </p>
      )}

      {mode === 'ask' && followUp && (
        <p className="mdv-askp__note" data-testid="askpanel-followup">
          Keeping on from “{followUp.utterance}”.{' '}
          <button type="button" className="mdv-link" onClick={() => onDropFollowUp?.()}>
            Ask fresh instead
          </button>
        </p>
      )}

      {mode === 'propose' && (
        <div className="mdv-askp__context">
          <button
            type="button"
            className="mdv-chip"
            onClick={() => setUseContext((v) => !v)}
            aria-pressed={sendContext}
            title={pageContext.line}
          >
            <MapPin size={11} aria-hidden />
            {pageContext.label}
            {pageContext.recordId ? ' · this record' : ''}
          </button>
          <span className="mdv-askp__quiet">
            {sendContext ? 'sent with your ask so “this” resolves' : 'context off — only your words are sent'}
          </span>
        </div>
      )}

      {role === 'staff' && (
        <p className="mdv-askp__note" data-testid="askpanel-staff-line">
          {mode === 'ask' ? STAFF_LINE : STAFF_PROPOSE_LINE}
        </p>
      )}

      <div className="mdv-askp__results">
        {mode === 'ask' && failure && (
          <div role="alert" className="mdv-alert" data-testid="askpanel-failure" data-kind={failure.kind}>
            <p>{failure.message}</p>
            {failure.checkAgain && lastRequest && (
              <button type="button" className="mdv-link" disabled={busy} onClick={() => void sendAsk(lastRequest)}>
                Check again
              </button>
            )}
          </div>
        )}

        {mode === 'propose' && refusal && (
          <div role="status" data-testid="askai-refusal" className="mdv-alert">
            <p className="mdv-alert__head">
              <AlertCircle size={11} aria-hidden />
              Mudavym did not propose an action
            </p>
            <p>{refusal.reason}</p>
            <button
              type="button"
              className="mdv-link"
              data-testid="askpanel-offer-ask"
              disabled={busy}
              onClick={() => askInstead(refusal.utterance)}
            >
              Ask the books this instead
            </button>
          </div>
        )}

        {mode === 'propose' && error && (
          <div role="alert" data-testid="askai-error" className="mdv-alert">
            <p className="mdv-alert__head">Could not ask</p>
            <p>{error}</p>
          </div>
        )}

        {mode === 'ask' &&
          folios.map((f) => (
            <PanelFolio key={f.id} folio={f} busy={busy} onCheckAgain={(x) => void checkFolio(x)} onPropose={proposeInstead} />
          ))}

        {proposalsUnread && (
          <p className="mdv-askp__note" role="status" data-testid="askpanel-proposals-unread">
            The proposals waiting for a seal could not be read: {proposalsUnread} This does not mean none are waiting. Asking still works.
          </p>
        )}

        {/* Proposals wait whatever the mode: each is a decision someone owes,
            and its only apply is the hold bound to a server seal. */}
        {proposals.length > 0 && (
          <section aria-label="Proposals waiting for a seal" className="mdv-askp__proposals">
            <p className="mdv-askp__eyebrow">Mudavym proposes · waiting for a seal</p>
            {proposals.map((p) => (
              <ProposalCard key={p.actionId} proposal={p} candidates={candidates} />
            ))}
          </section>
        )}

        {!failure && !refusal && !error && folios.length === 0 && (mode === 'ask' || proposals.length === 0) && (
          <div>
            <ul className="mdv-askp__examples">
              {EXAMPLES[mode].map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    className="mdv-link"
                    onClick={() => {
                      setText(example)
                      inputRef.current?.focus()
                    }}
                  >
                    “{example}”
                  </button>
                </li>
              ))}
            </ul>
            <p className="mdv-askp__quiet">
              Wide answers and your past questions open on{' '}
              <Link className="mdv-link" to="/ask">
                the Ask page
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Foot() {
  return (
    <span className="mdv-askp__foot">
      <span>
        <kbd className="mdv-kbd">
          <CornerDownLeft size={9} style={{ display: 'inline', verticalAlign: 'middle' }} />
        </kbd>{' '}
        runs what is selected
      </span>
      <span>Reads and drafts only — nothing is written without a seal</span>
    </span>
  )
}

const LABEL =
  'Ask Mudavym. Ask the books reads and answers; Propose an action drafts one action. Nothing is written without a seal; closing changes nothing.'

export function AskPanel({ placement, open, onClose, followUp = null, onDropFollowUp }: AskPanelProps) {
  if (!open) return null
  const body = <AskPanelBody open={open} followUp={followUp} onDropFollowUp={onDropFollowUp} />

  if (placement === 'overlay') {
    return (
      <Panel
        open={open}
        onClose={onClose}
        label={LABEL}
        title="Ask Mudavym"
        closeLabel="Close"
        bodyClassName="mdv-ovl__body--flush"
        className="mdv-askp mdv-askp--overlay"
        footer={<Foot />}
      >
        {body}
      </Panel>
    )
  }

  // Docked: a shell region in the counter's slot, beside a LIVE page. No
  // scrim, no focus trap. Escape closes it; other keys stay inside so the
  // app's `g`-then-key navigation cannot fire while someone types here
  // (⌘-chords still reach CommandProvider, which listens in the capture phase).
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation()
  }
  return (
    <aside className="mdv-askp mdv-askp--docked mudavym" aria-label="Ask Mudavym" onKeyDown={onKeyDown}>
      <header className="mdv-askp__head">
        <span className="mdv-askp__title-h">Ask Mudavym</span>
        <button type="button" className="mdv-link" onClick={onClose}>
          Close
        </button>
      </header>
      {body}
      <footer className="mdv-askp__footer">
        <Foot />
      </footer>
    </aside>
  )
}

export default AskPanel
