import { useRef, useState } from 'react'
import { getErrorStatus, isUnconfirmedWrite } from '../../services/api/client'
import { importTillHistory, type TillHistoryAnswer } from '../../services/api/posHub'

/** The gateway's limit for a till export (history-import.ts HISTORY_MAX_BYTES). */
export const TILL_EXPORT_MAX_BYTES = 5 * 1024 * 1024
/** Refused rows named on the page; the rest are counted. */
export const TILL_REFUSED_SHOWN = 5

type TillState =
  | { kind: 'ask' }
  | { kind: 'reading' }
  | { kind: 'refused'; words: string }

function fileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

const daysSaid = (n: number) => `${n} ${n === 1 ? 'day' : 'days'} read; stock was not moved.`

/**
 * /house: the till's last 90 days of item sales (r109 onboarding g3). Owner or
 * manager only (the caller draws it for them alone; the gateway refuses
 * anyone else). The sales are kept per day and item, not as checks, and no
 * stock moves. A second drop while one is on its way is ignored.
 */
export function TillHistory({ houseId }: { houseId: string | null | undefined }) {
  const [state, setState] = useState<TillState>({ kind: 'ask' })
  // The last export's answer stays on the page under the drop: a month at a
  // time is the page's own advice, so a second export must have somewhere to go.
  const [answer, setAnswer] = useState<TillHistoryAnswer | null>(null)
  const sending = useRef(false)

  const send = async (file: File | undefined) => {
    if (!file || sending.current || !houseId) return
    if (file.size > TILL_EXPORT_MAX_BYTES) {
      setState({ kind: 'refused', words: 'That file is over 5 MB. Export fewer days, or one month at a time.' })
      return
    }
    sending.current = true
    setState({ kind: 'reading' })
    try {
      const read = await importTillHistory(houseId, await fileText(file))
      if (read.fileRefused) {
        setState({ kind: 'refused', words: read.fileRefused })
      } else {
        setAnswer(read)
        setState({ kind: 'ask' })
      }
    } catch (cause) {
      const status = getErrorStatus(cause)
      setState({
        kind: 'refused',
        words: isUnconfirmedWrite(cause)
          ? 'We could not tell whether it was read: the connection dropped. Sending it again does not double a day.'
          : status === 401 || status === 403
            ? "Only an owner or a manager can bring the till's sales in."
            : 'We could not read it just now. Try again.',
      })
    } finally {
      sending.current = false
    }
  }

  return (
    <div className="py-6 font-serif text-2xl" data-testid="house-till-history">
      <span className="block text-xs uppercase tracking-[0.12em] text-[#1a5e6b]">Optional · for your counts</span>
      <span className="mt-2 block">Your till&apos;s last 90 days</span>
      {answer && state.kind !== 'reading' && (
        <div className="mt-2 font-sans text-base" role="status">
          <p>{daysSaid(answer.daysRead)}</p>
          {answer.daysHeldByChecksSaid && (
            <p className="mt-1 text-sm text-[#6d685f]" data-testid="house-till-held">
              {answer.daysHeldByChecksSaid}
            </p>
          )}
          {answer.netDropped && (
            <p className="mt-1 text-sm text-[#6d685f]">The money was left out: the house&apos;s money is not set yet.</p>
          )}
          {(answer.netForeignCount ?? 0) > 0 && (
            <div className="mt-2 text-sm text-[#6d685f]" data-testid="house-till-foreign">
              <p>
                The money was left out of {answer.netForeignCount} {answer.netForeignCount === 1 ? 'row' : 'rows'}, written in another currency than the house&apos;s:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {(answer.netForeign ?? []).slice(0, TILL_REFUSED_SHOWN).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {(answer.netForeignCount ?? 0) > TILL_REFUSED_SHOWN && (
                <p className="mt-1">and {(answer.netForeignCount ?? 0) - TILL_REFUSED_SHOWN} more.</p>
              )}
            </div>
          )}
          {answer.refusedCount > 0 && (
            <div className="mt-2 text-sm text-[#6d685f]" data-testid="house-till-refused">
              <p>
                {answer.refusedCount} {answer.refusedCount === 1 ? 'row was' : 'rows were'} not read:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {answer.refused.slice(0, TILL_REFUSED_SHOWN).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {answer.refusedCount > TILL_REFUSED_SHOWN && (
                <p className="mt-1">and {answer.refusedCount - TILL_REFUSED_SHOWN} more.</p>
              )}
            </div>
          )}
          {answer.errors.map((line) => (
            <p key={line} role="alert" className="mt-2 text-sm text-red-700">
              {line}
            </p>
          ))}
        </div>
      )}
      {state.kind === 'reading' ? (
        <p className="mt-2 text-[#6d685f]" role="status">Reading your till&apos;s sales…</p>
      ) : (
        <div
          className="mt-3 border border-dashed border-[#211f1b]/30 p-4"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void send(event.dataTransfer?.files?.[0])
          }}
        >
          <label className="flex min-h-11 cursor-pointer items-center text-xl">
            {answer
              ? 'Send another export (one month at a time).'
              : "Drop the till's item sales export here (Square, Toast or Lightspeed, as CSV)."}
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Your till's item sales export"
              className="sr-only"
              onChange={(event) => {
                const input = event.target
                const file = input.files?.[0]
                // Emptied after every pick, so choosing the same file again fires
                // change even while this input stays mounted (a file refused on
                // size never swaps the control out).
                void send(file)
                input.value = ''
              }}
            />
          </label>
          {!answer && (
            <p className="mt-2 font-sans text-sm text-[#6d685f]">
              Sales are kept by day and item. Stock is not moved: the shelf has not been counted yet.
            </p>
          )}
          {state.kind === 'refused' && (
            <p role="alert" className="mt-2 font-sans text-sm text-red-700">
              {state.words}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
