import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, History, Loader2, RotateCcw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  apiErrorMessage,
  fetchIdentityDecisions,
  retryUnlessClientError,
  undoIdentityDecision,
  type IdentityDecision,
} from '../services/api/vendorIntel'

/**
 * The house's identity decision log — ADR 0124 Q2.
 *
 * The founder, 2026-09-05: *"staff may confirm, log the decisions."* This is the
 * second half of that sentence made visible. It lives beside the price ladder on
 * /vendor-prices because that page owns `/vendor-intel`, and it is its own file
 * because the ladder is already 595 lines about a different question.
 *
 * THREE RULES IT KEEPS, EACH OF WHICH THIS REPO HAS BROKEN SOMEWHERE ELSE:
 *
 *  1. **A failed read is a failure with its reason** — not an empty list. The
 *     gateway throws on a read error rather than returning `[]`, and this view
 *     prints the reason it was given. "Nobody has decided anything" and "we
 *     could not ask" are different sentences.
 *  2. **A full page is a floor, not a total.** The gateway returns `complete`;
 *     when it is false the count reads "at least N" and the footer says the page
 *     stopped at the limit, because `items.length` behind a `.limit()` is a window
 *     (`scripts/check_windowed_figures.py`, and the six /receiving figures that
 *     guard exists for).
 *  3. **Undo is the manager's, and the gate is honest about itself.** Staff see
 *     the log — they take the decisions in it — and see no undo control, with a
 *     sentence saying why rather than a button that fails. The gateway refuses
 *     staff independently, so hiding the control is a courtesy and not the
 *     protection.
 */

const ACTION_META: Record<
  IdentityDecision['action'],
  { label: string; cls: string }
> = {
  confirmed: {
    label: 'Confirmed',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  rejected: {
    label: 'Rejected',
    cls: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  undone: {
    label: 'Undone',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
  },
}

/**
 * The standing of the bottle this decision was about.
 *
 * ADR 0124 Q3, the founder 2026-09-05: a provisional identity is printed as
 * provisional EVERYWHERE it appears, never as official. `standing` is a
 * generated column, so this reads a fact rather than a flag somebody has to
 * remember to set — and when the snapshot predates the column, it prints
 * nothing rather than guessing "official".
 */
function standingOf(d: IdentityDecision): 'library' | 'provisional' | 'source' | null {
  const s = (d.evidenceShown as { identity?: { standing?: string } })?.identity?.standing
  return s === 'library' || s === 'provisional' || s === 'source' ? s : null
}

const STANDING_META: Record<
  'library' | 'provisional' | 'source',
  { label: string; cls: string; title: string }
> = {
  provisional: {
    label: 'Provisional',
    cls: 'bg-amber-50 text-amber-800 border-amber-200',
    title:
      "This house named this bottle; it is not in the shared library yet and is waiting for Mudavym to curate it.",
  },
  library: {
    label: 'Library',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    title: 'Promoted into the shared wine library.',
  },
  source: {
    label: 'From a source file',
    cls: 'bg-sky-50 text-sky-700 border-sky-200',
    title:
      'Transcribed from a published price file, not asserted by a house and not a library entry.',
  },
}

/** What the person was shown, in one line, without pretending to know more. */
function evidenceLine(d: IdentityDecision): string {
  const e = d.evidenceShown as {
    identity?: { display_label?: string; unread?: boolean; reason?: string }
    confidence?: number
    method?: string
    subject?: { table?: string }
  }
  const bottle = e?.identity?.unread
    ? `identity not read at the time (${e.identity.reason ?? 'no reason recorded'})`
    : (e?.identity?.display_label ?? 'an identity with no label recorded')
  const conf =
    typeof e?.confidence === 'number' ? `${Math.round(e.confidence * 100)}%` : '—'
  const how = e?.method ?? 'unstated'
  const subject = e?.subject?.table ?? 'unstated'
  return `${bottle} · shown at ${conf} by ${how} · for ${subject}`
}

function fmtWhen(iso: string): string {
  const t = new Date(iso)
  return Number.isFinite(t.getTime()) ? t.toLocaleString() : iso
}

export function IdentityDecisionLog() {
  const { activeRestaurantId, activeRole, user } = useAuth()
  const role = activeRole ?? user?.role ?? null
  // No `admin` branch: the web's own role union has three values, and the
  // gateway's RolesGuard is what actually admits an admin. Hiding the control
  // is a courtesy; the refusal lives on the route.
  const canUndo = role === 'owner' || role === 'manager'

  const queryClient = useQueryClient()
  const [undoing, setUndoing] = useState<string | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)

  // Keyed by the house. `switchRestaurant` re-issues the token without
  // remounting, so a bare key would hand the next house the previous one's
  // cached log — the same class of defect `check_windowed_figures.py` enforces
  // on /receipts and /team, and this key is opted into that shape rather than
  // waiting to be added to a PageSpec.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['identity-decisions', activeRestaurantId],
    queryFn: () => fetchIdentityDecisions(50),
    retry: retryUnlessClientError,
  })

  const undo = useMutation({
    mutationFn: (decisionId: string) => undoIdentityDecision({ decisionId }),
    onMutate: (decisionId: string) => {
      setUndoing(decisionId)
      setUndoError(null)
    },
    onError: (e) => setUndoError(apiErrorMessage(e, 'The decision was not undone.')),
    onSettled: () => {
      setUndoing(null)
      void queryClient.invalidateQueries({
        queryKey: ['identity-decisions', activeRestaurantId],
      })
    },
  })

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white">
      <header className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <History className="h-4 w-4 text-gray-500" strokeWidth={2} />
        <h2 className="text-sm font-semibold text-gray-900">Identity decisions</h2>
        <span className="ml-auto text-xs text-gray-500">
          {data ? (data.complete ? `${data.items.length}` : `at least ${data.items.length}`) : ''}
        </span>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          Reading the decision log…
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-2 px-4 py-6 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <div>
            <p className="font-medium">The decision log could not be read.</p>
            <p className="mt-1 text-rose-600">
              {apiErrorMessage(error, 'No reason was given.')}
            </p>
            <p className="mt-1 text-gray-500">
              This is a failure, not an empty log — nothing here says whether this
              house has decided anything.
            </p>
          </div>
        </div>
      )}

      {data && !isError && (
        <>
          {data.items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">
              No identity decision has been taken in this house yet. The register
              is filled by people, not by a job, so this stays empty until
              somebody confirms a bottle.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.items.map((d) => {
                const meta = ACTION_META[d.action]
                return (
                  <li key={d.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-sm font-medium text-gray-900">
                        {d.decidedByLabel}
                      </span>
                      <span className="text-xs text-gray-500">({d.decidedByRole})</span>
                      <span className="text-xs text-gray-500">{fmtWhen(d.decidedAt)}</span>
                      {(() => {
                        const st = standingOf(d)
                        if (!st) return null
                        const m = STANDING_META[st]
                        return (
                          <span
                            title={m.title}
                            className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}
                          >
                            {m.label}
                          </span>
                        )
                      })()}
                      {d.undoesDecisionId && (
                        <span className="text-xs text-amber-700">
                          takes back an earlier decision
                        </span>
                      )}
                      {canUndo && d.action !== 'undone' && (
                        <button
                          type="button"
                          onClick={() => undo.mutate(d.id)}
                          disabled={undoing === d.id}
                          className="ml-auto inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {undoing === d.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                          ) : (
                            <RotateCcw className="h-3 w-3" strokeWidth={2} />
                          )}
                          Undo
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{evidenceLine(d)}</p>
                    {d.linkWritten && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        wrote {d.linkWritten}
                      </p>
                    )}
                    {d.note && (
                      <p className="mt-0.5 text-xs italic text-gray-600">“{d.note}”</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <footer className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
            {data.scope}
            {!data.complete && (
              <>
                {' '}· this page stopped at {data.limit} rows, so the count above is
                a floor rather than a total.
              </>
            )}
            {!canUndo && (
              <> · Taking a decision back is an owner or manager action.</>
            )}
          </footer>
        </>
      )}

      {undoError && (
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-rose-700">
          {undoError}
        </p>
      )}
    </section>
  )
}

export default IdentityDecisionLog
