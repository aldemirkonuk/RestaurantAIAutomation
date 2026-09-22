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
 *
 * ADR 0193 round 3. A LOCKED price (the founder, 2026-09-21: "add a section to
 * that where you can lock price") carries a "locked" mark with who and when;
 * its advice is still shown but has no Accept (a lock holds it); an edit that
 * reaches a locked kind is refused for that kind and said. A wine may carry
 * its own POUR ("Yes, confirmed per wine"), confirmed here by an owner or a
 * manager; empty means the house's pour.
 */
import { useState } from 'react'
import { cn } from '../../../lib/utils'
import { fmtMoneyExact } from './bits'
import { updateInventoryItem } from '../../../services/api/inventory'
import {
  acceptPriceAdvice,
  confirmWinePour,
  type PriceAdvice,
  type WineAdvice,
} from '../../../services/api/pricing'

export type AdviceLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      byId: Map<string, WineAdvice>
      targetSet: boolean
      /** false = whether a price is locked is unknown; no Accept is offered. */
      locksReadable?: boolean
      locksReason?: string | null
    }

/** What an edit did, when a lock held part of it (ADR 0193 round 3, L5). */
export function heldNote(res: {
  priceChange?: { outcome?: string; held?: Array<{ kind: string; lockedPrice: number | null }> }
}): string | null {
  const held = res?.priceChange?.held ?? []
  if (held.length === 0) return null
  const words = held
    .map((h) => `the ${h.kind} price is locked${h.lockedPrice == null ? '' : ` at ${h.lockedPrice.toFixed(2)}`}`)
    .join(' and ')
  const rest = res.priceChange?.outcome === 'changed' ? ' The rest was saved.' : ''
  return `Not changed: ${words}. Change it on Menu, under Locked prices.${rest}`
}

/**
 * What adding a wine did to the price typed with it (the gateway's
 * `priceChange`, ADR 0193). Null when the price landed or none was typed.
 * Last-call review, 2026-09-21: the add form said "added to inventory" whatever
 * this answered, so a price a lock held (a removed wine added back), a newer
 * price, or a failed write read as saved.
 */
export function addedPriceNote(
  res:
    | {
        priceChange?: {
          outcome?: string
          error?: string
          held?: Array<{ kind: string; lockedPrice: number | null }>
        }
      }
    | null
    | undefined,
): string | null {
  const pc = res?.priceChange
  if (!pc) return null
  const held = heldNote({ priceChange: pc })
  if (held) return `The wine was added. ${held}`
  if (pc.outcome === 'failed') {
    return `The wine was added, but its price was not saved (${pc.error || 'no reason was given'}). Set it under Your price.`
  }
  if (pc.outcome === 'stale') return 'The wine was added, but its price was not changed: a newer price was already set. See Your price.'
  return null
}

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
  const [pourText, setPourText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const wine = advice.status === 'ready' ? advice.byId.get(inventoryId) : undefined
  const winePour = wine?.pour?.source === 'wine' ? wine.pour.ml : null

  const open = () => {
    setBottleText(bottle == null ? '' : bottle.toFixed(2))
    setGlassText(glass == null ? '' : glass.toFixed(2))
    setPourText(winePour == null ? '' : String(winePour))
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
    // This wine's own pour (round 6c answer 3): empty = the house's pour.
    const pourRaw = pourText.trim()
    const pour = pourRaw === '' ? null : Number(pourRaw)
    if (pour !== null && (!Number.isFinite(pour) || pour < 10 || pour > 500)) {
      setNote({ tone: 'error', text: "A pour is between 10 and 500 ml. Leave it empty to use the house's pour." })
      return
    }
    const pourChanged = pour !== winePour
    const body: { menuPriceBottle?: number | null; menuPriceGlass?: number | null } = {}
    if (b.value !== bottle) body.menuPriceBottle = b.value
    if (g.value !== glass) body.menuPriceGlass = g.value
    if (Object.keys(body).length === 0 && !pourChanged) {
      setEditing(false)
      return
    }
    setBusy(true)
    setNote(null)
    let priceSaved = false
    try {
      let said: string | null = null
      if (Object.keys(body).length > 0) {
        const res = (await updateInventoryItem(inventoryId, body)) as {
          priceChange?: { outcome?: string; held?: Array<{ kind: string; lockedPrice: number | null }> }
        }
        const outcome = res?.priceChange?.outcome
        said = heldNote(res) ?? (outcome === 'unchanged' ? 'Already that price. Nothing changed.' : null)
        priceSaved = true
      }
      if (pourChanged) {
        await confirmWinePour(inventoryId, pour)
        const pourSaid =
          pour === null ? "This wine now uses the house's pour for glass advice." : `This wine's pour is confirmed at ${pour} ml.`
        said = said ? `${said} ${pourSaid}` : pourSaid
      }
      setEditing(false)
      if (said) setNote({ tone: 'info', text: said })
      onChanged()
    } catch (err) {
      // The price call answered before the pour was refused: say both, so a
      // saved price is never reported as "nothing was changed".
      setNote({
        tone: 'error',
        text: priceSaved ? `The price was saved; this wine's pour was not: ${reasonOf(err)}` : reasonOf(err),
      })
      if (priceSaved) onChanged()
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

  const lines = [wine?.bottle, wine?.glass].filter((a): a is PriceAdvice => !!a)
  const locksKnown = advice.status === 'ready' && advice.locksReadable !== false
  // A locked kind keeps its advice but offers no Accept (L7, L22).
  const actionable = lines.filter((a) => (a.state === 'raise' || a.state === 'lower') && !a.locked)
  const lockedLines = lines.filter((a) => !!a.locked)

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
          {/* Only when this wine's pour is known (the advice read it): an empty
              field would otherwise read as "the house's pour" when it may not be. */}
          {advice.status === 'ready' && (
            <label className="flex items-center gap-1 text-[10px] text-gray-500" title="This wine's own pour, for glass advice. Empty = the house's pour.">
              pour ml
              <input
                aria-label={`Pour in ml for ${wineName} (empty = the house's pour)`}
                inputMode="numeric"
                placeholder="house"
                value={pourText}
                onChange={(e) => setPourText(e.target.value)}
                className="w-[68px] rounded border border-gray-300 px-1.5 py-0.5 text-right font-mono text-xs"
              />
            </label>
          )}
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
            lockedLines.map((a) => (
              <span
                key={`locked-${a.kind}`}
                className="text-gray-600"
                data-testid={`locked-${a.kind}`}
                title={`${a.sentence} This price is locked, so advice cannot be accepted here. Change it on Menu, under Locked prices.`}
              >
                {KIND_SHORT[a.kind]} locked at {fmtMoneyExact(a.locked!.lockedPrice)} since {a.locked!.lockedAt.slice(0, 10)}
              </span>
            ))}
          {advice.status === 'ready' && !locksKnown && (
            <span className="text-gray-400" title={advice.locksReason ?? undefined}>
              locks unknown, no accept
            </span>
          )}
          {advice.status === 'ready' &&
            locksKnown &&
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
  // Glass advice waits for the house's pour (founder, 2026-09-21): said, so a
  // quiet glass is never read as on target.
  if (states.has('pour_unconfirmed'))
    return (
      <a
        href="/settings?tab=target-margin"
        className="text-gray-400 hover:text-gray-600 hover:underline"
        title={lines.find((l) => l.state === 'pour_unconfirmed')?.sentence}
      >
        glass waits for your pour size
      </a>
    )
  return null
}
