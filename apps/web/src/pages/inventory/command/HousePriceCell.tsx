/**
 * "Your price" — this house's own bottle and glass price, next to "Market",
 * editable in place, with the advice toward the house's target margin under it
 * (ADR 0193).
 *
 * The founder, 2026-09-21: "Dynamic means two things 1. it could be changed
 * every time a menu is updated and secondly it should be changed whenever the
 * manager wants and also ... recommendations ... advise the manager or owner
 * to increase decrease the prices so that the profit margin is where it's
 * needed. We don't want market average because that will be already shown in
 * another column."
 *
 * So: the price shown is the house's (never the market's, which stays in its
 * own column); a manager changes it here at any time; the advice line says
 * "raise to X" / "lower to Y" toward the house's own target and applies only
 * when the manager taps it. Every change is on the record server-side
 * (menu_price_versions, with who and from where). Staff see the price and
 * the advice but no controls — and the gateway refuses them regardless.
 */
import { useState } from 'react'
import { cn } from '../../../lib/utils'
import { fmtMoneyExact } from './bits'
import { updateInventoryItem } from '../../../services/api/inventory'
import { acceptPriceAdvice, type PriceAdvice, type WineAdvice } from '../../../services/api/pricing'

export type AdviceLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; byId: Map<string, WineAdvice>; targetSet: boolean }

function reasonOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string }
  if (e?.response?.status === 403) return 'Only an owner or a manager can change a price.'
  const m = e?.response?.data?.message
  if (typeof m === 'string' && m) return m
  if (Array.isArray(m) && m.length) return String(m[0])
  return e?.message || 'The price was not saved.'
}

/** '' clears the price; anything else must be a number of at least 0. */
export function parsePriceInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const t = raw.trim().replace(/^\$/, '')
  if (t === '') return { ok: true, value: null }
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return { ok: false }
  return { ok: true, value: Math.round(n * 100) / 100 }
}

const KIND_SHORT: Record<'bottle' | 'glass', string> = { bottle: 'btl', glass: 'gl' }

export function HousePriceCell({
  inventoryId,
  wineName,
  bottle,
  glass,
  advice,
  canEdit,
  onChanged,
}: {
  inventoryId: string
  wineName: string
  bottle: number | null
  glass: number | null
  advice: AdviceLoad
  canEdit: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [bottleText, setBottleText] = useState('')
  const [glassText, setGlassText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const open = () => {
    setBottleText(bottle == null ? '' : bottle.toFixed(2))
    setGlassText(glass == null ? '' : glass.toFixed(2))
    setNote(null)
    setEditing(true)
  }

  const save = async () => {
    const b = parsePriceInput(bottleText)
    const g = parsePriceInput(glassText)
    if (!b.ok || !g.ok) {
      setNote({ tone: 'error', text: 'A price is a number of 0 or more. Leave it empty to take the price off.' })
      return
    }
    const body: { menuPriceBottle?: number | null; menuPriceGlass?: number | null } = {}
    if (b.value !== bottle) body.menuPriceBottle = b.value
    if (g.value !== glass) body.menuPriceGlass = g.value
    if (Object.keys(body).length === 0) {
      setEditing(false)
      return
    }
    setBusy(true)
    setNote(null)
    try {
      const res = (await updateInventoryItem(inventoryId, body)) as { priceChange?: { outcome?: string } }
      const outcome = res?.priceChange?.outcome
      setEditing(false)
      if (outcome === 'unchanged') setNote({ tone: 'info', text: 'Already that price. Nothing changed.' })
      onChanged()
    } catch (err) {
      setNote({ tone: 'error', text: reasonOf(err) })
    } finally {
      setBusy(false)
    }
  }

  const accept = async (a: PriceAdvice) => {
    if (a.advisedPrice == null) return
    setBusy(true)
    setNote(null)
    try {
      await acceptPriceAdvice(inventoryId, a.kind, a.advisedPrice)
      onChanged()
    } catch (err) {
      setNote({ tone: 'error', text: reasonOf(err) })
    } finally {
      setBusy(false)
    }
  }

  const wine = advice.status === 'ready' ? advice.byId.get(inventoryId) : undefined
  const lines = [wine?.bottle, wine?.glass].filter((a): a is PriceAdvice => !!a)
  const actionable = lines.filter((a) => a.state === 'raise' || a.state === 'lower')

  return (
    <div className="text-right" onClick={(e) => e.stopPropagation()} data-testid={`house-price-${inventoryId}`}>
      {editing ? (
        <form
          className="flex flex-col items-end gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label className="flex items-center gap-1 text-[10px] text-gray-500">
            btl
            <input
              aria-label={`Bottle price for ${wineName}`}
              inputMode="decimal"
              value={bottleText}
              onChange={(e) => setBottleText(e.target.value)}
              className="w-[68px] rounded border border-gray-300 px-1.5 py-0.5 text-right font-mono text-xs"
              autoFocus
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-gray-500">
            gl
            <input
              aria-label={`Glass price for ${wineName}`}
              inputMode="decimal"
              value={glassText}
              onChange={(e) => setGlassText(e.target.value)}
              className="w-[68px] rounded border border-gray-300 px-1.5 py-0.5 text-right font-mono text-xs"
            />
          </label>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded px-1.5 py-0.5 text-[10.5px] text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-wine-700 px-1.5 py-0.5 text-[10.5px] font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Saving' : 'Save'}
            </button>
          </span>
        </form>
      ) : canEdit ? (
        <button
          type="button"
          onClick={open}
          title="Change your price"
          aria-label={`Change your price for ${wineName}`}
          className="font-mono text-xs text-gray-800 hover:text-wine-700 hover:underline decoration-dotted"
        >
          {fmtMoneyExact(bottle)} <span className="text-[9.5px] text-gray-400">btl</span>
          {' · '}
          {fmtMoneyExact(glass)} <span className="text-[9.5px] text-gray-400">gl</span>
        </button>
      ) : (
        <span className="font-mono text-xs text-gray-800">
          {fmtMoneyExact(bottle)} <span className="text-[9.5px] text-gray-400">btl</span>
          {' · '}
          {fmtMoneyExact(glass)} <span className="text-[9.5px] text-gray-400">gl</span>
        </span>
      )}

      {!editing && (
        <div className="mt-0.5 flex flex-col items-end gap-0.5 text-[10.5px] leading-tight">
          {advice.status === 'loading' && <span className="text-gray-300">advice…</span>}
          {advice.status === 'error' && (
            <span className="text-gray-400" title={advice.message}>
              advice unavailable
            </span>
          )}
          {advice.status === 'ready' &&
            actionable.map((a) =>
              canEdit ? (
                <button
                  key={a.kind}
                  type="button"
                  disabled={busy}
                  onClick={() => void accept(a)}
                  title={`${a.sentence} Tap to apply.`}
                  className={cn(
                    'rounded px-1 font-semibold hover:underline disabled:opacity-50',
                    a.state === 'raise' ? 'text-amber-700' : 'text-sky-700',
                  )}
                >
                  {a.state === 'raise' ? 'Raise' : 'Lower'} {KIND_SHORT[a.kind]} to {fmtMoneyExact(a.advisedPrice)}
                </button>
              ) : (
                <span key={a.kind} title={a.sentence} className="text-gray-500">
                  {a.state === 'raise' ? 'Raise' : 'Lower'} {KIND_SHORT[a.kind]} to {fmtMoneyExact(a.advisedPrice)}
                </span>
              ),
            )}
          {advice.status === 'ready' && actionable.length === 0 && lines.length > 0 && (
            <QuietState lines={lines} targetSet={advice.targetSet} />
          )}
        </div>
      )}

      {note && (
        <p
          role={note.tone === 'error' ? 'alert' : undefined}
          className={cn('mt-0.5 text-[10.5px] leading-tight', note.tone === 'error' ? 'text-rose-600' : 'text-gray-500')}
        >
          {note.text}
        </p>
      )}
    </div>
  )
}

/** One short line when there is nothing to tap: why there is no advice. */
function QuietState({ lines, targetSet }: { lines: PriceAdvice[]; targetSet: boolean }) {
  if (!targetSet) {
    return (
      <a href="/settings?tab=target-margin" className="text-gray-400 hover:text-gray-600 hover:underline">
        no target set
      </a>
    )
  }
  const states = new Set(lines.map((l) => l.state))
  if (states.has('no_cost'))
    return (
      <span className="text-gray-400" title={lines.find((l) => l.state === 'no_cost')?.sentence}>
        no cost recorded
      </span>
    )
  if (lines.every((l) => l.state === 'on_target' || l.state === 'no_price') && states.has('on_target'))
    return <span className="text-emerald-600">on target</span>
  return null
}
