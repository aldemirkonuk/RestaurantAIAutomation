/**
 * A stock-take on paper (F-1544 lane 6), on the count's review page, for an
 * owner or a manager (ADR 0335 §3: only they import a sheet). Out: the
 * count's sheet, blind, to print or fill in. In: the filled sheet, read the
 * house's way, a preview that names every refused line and shelf, and
 * nothing sent until "Send". The sending is `countSheet.ts`.
 *
 * Each line posts as the person who loads the sheet (the token names the
 * counter, ADR 0078), at the moment the sheet says the shelf was counted.
 */

import { useContext, useState } from 'react'
import { AuthContext } from '@/contexts/AuthContext'
import {
  markCountShelfDone,
  parkCountLine,
  pullCountSession,
  type CountSession,
} from '@/services/api/countSessions'
import { getInventory, recordSpotCount } from '@/services/api/inventory'
import { parseCsvRows, readCsvFile } from '@/lib/csvImport'
import { exportDay, exportHouseWord, exportTable } from '@/lib/tableExport'
import { getHouseLocale } from '@/lib/houseCurrency'
import { useHouseZone } from '@/lib/houseZone'
import {
  countSheetColumns,
  countSheetRows,
  planCountSheet,
  sendCountSheet,
  type CountSheetPlan,
  type SheetShelfOutcome,
} from './countSheet'

const TAP = 'min-h-[56px] min-w-[56px]'
const BTN = `${TAP} rounded-xl px-4 text-base font-semibold`
const PRIMARY = `${BTN} bg-wine-600 text-white active:bg-wine-700 disabled:opacity-50`
const QUIET = `${BTN} bg-white/10 text-inkm-1 active:bg-white/20 disabled:opacity-50`
const CARD = 'rounded-xl bg-white/5 px-4 py-3'

function saidBy(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof m === 'string' && m.trim() ? m : fallback
}

const linesWords = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`

export function CountSheetPanel({ sessionId, house, onSent }: { sessionId: string; house: string; onSent: () => void }) {
  const zone = useHouseZone()
  const houseName = useContext(AuthContext)?.availableRestaurants?.find((b) => b.id === house)?.name ?? null
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<CountSession | null>(null)
  const [plan, setPlan] = useState<CountSheetPlan | null>(null)
  const [outcome, setOutcome] = useState<SheetShelfOutcome[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pull = async (): Promise<CountSession> => {
    const s = await pullCountSession(sessionId)
    setSession(s)
    return s
  }

  const download = async () => {
    setProblem(null)
    try {
      const s = session ?? (await pull())
      await exportTable({
        format: 'csv',
        rows: countSheetRows(s),
        columns: countSheetColumns,
        // Named for its house, as the exports shelf names its files (F-1631).
        filename: `mudavym-${exportHouseWord(houseName)}-count-sheet-${exportDay()}`,
        title: 'Count sheet',
      })
    } catch (err) {
      setProblem(saidBy(err, 'The sheet could not be made. Check the signal and try again.'))
    }
  }

  const choose = async (file: File | undefined) => {
    setPlan(null)
    setOutcome(null)
    setProblem(null)
    if (!file) return
    setBusy(true)
    try {
      // Read again: a shelf done or sent back since the sheet was made changes
      // what the sheet can close.
      const s = await pull()
      const items = (await getInventory(house || undefined)).map((r) => ({
        id: r.id,
        name: r.wineName?.trim() || '',
        producer: r.wineProducer ?? null,
        vintage: r.wineVintage ?? null,
      }))
      const rows = parseCsvRows(await readCsvFile(file))
      setPlan(planCountSheet(rows, { session: s, items, zone, locale: getHouseLocale(), now: Date.now() }))
    } catch (err) {
      setProblem(
        err instanceof Error && !(err as { response?: unknown }).response
          ? err.message
          : saidBy(err, 'The sheet could not be read, so nothing was sent.'),
      )
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!plan || !session) return
    setBusy(true)
    setProblem(null)
    try {
      setOutcome(
        await sendCountSheet(plan, session, {
          recordSpotCount: (id, body) => recordSpotCount(id, body, house || undefined),
          parkCountLine,
          markCountShelfDone,
        }),
      )
      setPlan(null)
      onSent()
    } catch (err) {
      setProblem(saidBy(err, 'The sheet was not sent. Load it again; what already went in is not sent twice.'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" data-ux-key="count:sheet" className={`${QUIET} w-full`} onClick={() => setOpen(true)}>
        Count on paper
      </button>
    )
  }

  const toSend = plan ? plan.shelves.reduce((n, s) => n + s.lines.length + s.parked.length, 0) : 0
  return (
    <section data-testid="count-sheet" className="space-y-3 pt-2">
      <h2 className="text-sm font-semibold text-inkm-4">Count on paper</h2>
      <p className="text-sm text-inkm-2">
        Print the sheet, count, then load it here. Write the bottles and the open bottle in tenths (5 is half). Write
        the time once per shelf, like 2026-10-13 01:30. A blank is not counted.
      </p>
      <button type="button" className={`${QUIET} w-full`} disabled={busy} onClick={() => void download()}>
        Download the sheet
      </button>
      <label className={`${CARD} block text-sm text-inkm-2`}>
        <span className="block font-semibold text-inkm-1">Load the filled sheet</span>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Filled count sheet (CSV)"
          disabled={busy}
          onChange={(e) => void choose(e.target.files?.[0])}
          className="mt-2 text-sm"
        />
      </label>
      {problem && (
        <p role="alert" className="text-sm text-amber-300">
          {problem}
        </p>
      )}
      {plan?.fileProblem && (
        <p role="alert" className="text-sm text-amber-300">
          {plan.fileProblem}
        </p>
      )}
      {plan && !plan.fileProblem && (
        <div data-testid="count-sheet-preview" className="space-y-2 text-sm">
          {plan.shelves.map((s) => (
            <div key={s.locationId} className={CARD}>
              <p className="font-semibold text-inkm-1">
                {s.name}: {linesWords(s.lines.length)}
                {s.parked.length ? `, ${s.parked.length} not on the list (for the manager)` : ''}
              </p>
              <ul className="text-inkm-2">
                {s.lines.map((l) => (
                  <li key={l.line}>
                    {l.name}: {l.sealed}
                    {l.tenths ? ` and ${l.tenths}/10 open` : ''}
                  </li>
                ))}
                {s.parked.map((p) => (
                  <li key={p.line}>
                    {p.description}: {p.sealed}, for the manager{p.openDropped ? ' (the open bottle is not kept)' : ''}
                  </li>
                ))}
              </ul>
              <p className="text-inkm-4">
                {s.alreadyDone
                  ? 'This shelf is already done. These go in as second counts for you to pick.'
                  : s.closes
                    ? 'Every item has a number, so the shelf is done.'
                    : `Stays not counted. No number for: ${s.notCounted.join(', ')}`}
              </p>
            </div>
          ))}
          {plan.refusedShelves.map((s) => (
            <p key={s.name} className="text-amber-300">
              {s.name}, not sent ({linesWords(s.lines)}): {s.reason}
            </p>
          ))}
          {plan.refused.map((r) => (
            <p key={r.line} className="text-inkm-2">
              Line {r.line}, {r.label}: {r.reason}
            </p>
          ))}
          <button
            type="button"
            data-ux-key="count:sheet-send"
            className={`${PRIMARY} w-full`}
            disabled={busy || toSend === 0}
            onClick={() => void send()}
          >
            {busy ? 'Sending…' : `Send ${linesWords(toSend)}`}
          </button>
        </div>
      )}
      {outcome && (
        <div role="status" className="space-y-2 text-sm">
          {outcome.map((o) => (
            <div key={o.name} className={CARD}>
              <p className="font-semibold text-inkm-1">
                {o.name}: {o.posted} counted
                {o.parked ? `, ${o.parked} for the manager` : ''}
                {o.done === 'closed' ? ', shelf done' : ''}
              </p>
              {o.held.length > 0 && (
                <p className="text-inkm-2">Counted twice, waiting for you to pick: {o.held.join(', ')}</p>
              )}
              {o.refused.map((r) => (
                <p key={r.name} className="text-amber-300">
                  {r.name}: {r.reason}
                </p>
              ))}
              {o.notSent.length > 0 && (
                <p className="text-amber-300">
                  Not sent: {o.notSent.join(', ')}. Load the same sheet again; what went in is not sent twice.
                </p>
              )}
              {o.done === 'not-closed' && (
                <p className="text-amber-300">{o.doneMessage ?? 'The shelf is not done. Count it again.'}</p>
              )}
            </div>
          ))}
        </div>
      )}
      <button type="button" className={`${QUIET} w-full`} onClick={() => setOpen(false)}>
        Close
      </button>
    </section>
  )
}
