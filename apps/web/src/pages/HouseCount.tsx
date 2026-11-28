import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '../components/brand/BrandMark'
import { getInventory } from '../services/api/inventory'
import { apiClient } from '../services/api/client'
import { useAuth } from '../contexts/AuthContext'
import { newClientCountId, submitSpotCount } from '../lib/spotCountOutbox'
import { prefersReducedMotion } from '../lib/mudavym/motion'
import { notCounted, readTypedCount, shelfOrder, toCountGood, unitWord, type CountGood } from '../lib/firstCount'

/** The incoming card (onboarding-r110-g2): 24 px and a fade, 200 ms. */
export const CARD_ENTER = { px: 24, ms: 200, easing: 'cubic-bezier(0.16,1,0.3,1)' } as const

/** `total` is every live good the house holds; `goods` is what is left to count. */
type Load = { kind: 'reading' } | { kind: 'failed' } | { kind: 'read'; goods: CountGood[]; total: number }
type Mark = 'counted' | 'skipped'

async function readLocationNames(houseId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  try {
    const { data } = await apiClient.get(`/storage-locations/${houseId}`)
    for (const l of Array.isArray(data) ? data : []) {
      if (typeof l?.id === 'string' && typeof l?.name === 'string' && l.name.trim()) names.set(l.id, l.name.trim())
    }
  } catch {
    // Names only order the walk; without them it still groups by shelf.
  }
  return names
}

/**
 * /house/count — the first stock count, one good per card, shelf to sheet
 * (onboarding-r110-g2). Next writes the count through the spot-count outbox;
 * Skip writes nothing, because empty is not zero; an explicit 0 is written
 * as 0. A good already counted is not in the walk, so a walk left halfway
 * resumes at what is left.
 */
export default function HouseCount() {
  // The house comes from the session, never from localStorage: the stored id is
  // written by AuthContext's own effect, which runs after this page's, and on a
  // new phone it is absent (or another of the user's houses).
  const { user } = useAuth()
  const houseId = user ? user.restaurantId || '' : null
  const [load, setLoad] = useState<Load>({ kind: 'reading' })
  const [asked, setAsked] = useState(0)
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'back'>('next')
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  // A key per good and number, made at the tap and reused on a retry of the
  // same number; a new number gets a new key, or the server keeps the first.
  const keys = useRef<Record<string, { qty: number; id: string }>>({})
  const card = useRef<HTMLDivElement | null>(null)
  const field = useRef<HTMLInputElement | null>(null)
  const endHeading = useRef<HTMLHeadingElement | null>(null)
  const moved = useRef(false)

  useEffect(() => {
    let live = true
    setLoad({ kind: 'reading' })
    if (houseId === null) return // the session has not answered yet: wait for the id
    if (houseId === '') {
      setLoad({ kind: 'failed' })
      return
    }
    ;(async () => {
      try {
        const [rows, names] = await Promise.all([getInventory(houseId), readLocationNames(houseId)])
        const goods = (Array.isArray(rows) ? rows : []).map(toCountGood).filter((g): g is CountGood => g !== null)
        if (live) setLoad({ kind: 'read', goods: shelfOrder(notCounted(goods), names), total: goods.length })
      } catch {
        if (live) setLoad({ kind: 'failed' })
      }
    })()
    return () => {
      live = false
    }
  }, [asked, houseId])

  const goods = load.kind === 'read' ? load.goods : []
  const good = goods[index] ?? null
  const done = load.kind === 'read' && goods.length > 0 && index >= goods.length

  // The new card enters from the side the walk moves toward; the old one
  // leaves at once. Under reduced motion nothing moves (ADR 0112).
  useLayoutEffect(() => {
    if (!moved.current) return
    const el = card.current
    if (el && typeof el.animate === 'function' && !prefersReducedMotion()) {
      const rtl = el.closest('[dir="rtl"]') !== null || document.documentElement.dir === 'rtl'
      const fromEnd = direction === 'next'
      const sign = (fromEnd ? 1 : -1) * (rtl ? -1 : 1)
      el.animate(
        [
          { transform: `translateX(${sign * CARD_ENTER.px}px)`, opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 },
        ],
        { duration: CARD_ENTER.ms, easing: CARD_ENTER.easing },
      )
    }
    if (field.current) field.current.focus()
    else endHeading.current?.focus()
  }, [index, direction])

  const go = useCallback((to: number, dir: 'next' | 'back') => {
    moved.current = true
    setRefusal(null)
    setDirection(dir)
    setIndex(to)
  }, [])

  const next = async () => {
    if (!good || writing) return
    const read = readTypedCount(typed[good.id] ?? '')
    if (read.kind === 'empty') {
      setRefusal('Type what is on the shelf, or Skip it for later.')
      return
    }
    if (read.kind === 'negative') {
      setRefusal('A count cannot be below zero.')
      return
    }
    if (read.kind === 'decimal') {
      setRefusal(`Whole ${unitWord(good.uom)} only: this good is counted in whole ${unitWord(good.uom)}.`)
      return
    }
    if (read.kind === 'unreadable') {
      setRefusal('That is not a number we can write. Type whole numbers only.')
      return
    }
    if (!houseId) {
      setRefusal('This count was not written. Try Next again.')
      return
    }
    const held = keys.current[good.id]
    const clientCountId = held && held.qty === read.qty ? held.id : newClientCountId()
    keys.current[good.id] = { qty: read.qty, id: clientCountId }
    setWriting(true)
    try {
      await submitSpotCount({
        itemId: good.id,
        itemLabel: good.name,
        restaurantId: houseId,
        body: { countedQty: read.qty, clientCountId, reason: 'First count' },
      })
      setMarks((m) => ({ ...m, [good.id]: 'counted' }))
      go(index + 1, 'next')
    } catch {
      setRefusal('This count was not written. Try Next again.')
    } finally {
      setWriting(false)
    }
  }

  const skip = () => {
    if (!good) return
    // Writes nothing: the good stays "not counted" (or keeps an earlier count).
    setMarks((m) => (m[good.id] === 'counted' ? m : { ...m, [good.id]: 'skipped' }))
    go(index + 1, 'next')
  }

  const counted = Object.values(marks).filter((m) => m === 'counted').length
  const progress = goods.length > 0 ? Math.min(index, goods.length) / goods.length : 0

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#211f1b]">
      <header className="h-14 border-b border-[#211f1b]/15 bg-white px-5 flex items-center justify-between">
        <Link to="/house" aria-label="Back to your house">
          <BrandMark size={24} alt="" />
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6d685f]">The first count</span>
      </header>
      <main className="mx-auto max-w-xl px-5 py-12">
        {load.kind === 'reading' ? (
          <p className="font-serif text-2xl text-[#b7b2a8]" role="status">
            Reading the goods on your shelf…
          </p>
        ) : load.kind === 'failed' ? (
          <p className="font-serif text-2xl text-[#6d685f]">
            We could not read your goods just now.{' '}
            <button
              type="button"
              onClick={() => setAsked((n) => n + 1)}
              className="min-h-[44px] font-sans text-sm text-[#1a5e6b] underline underline-offset-4"
            >
              Look again
            </button>
          </p>
        ) : goods.length === 0 ? (
          <p className="font-serif text-2xl">
            {load.total === 0 ? 'There are no goods on your shelf to count yet.' : 'Every good is counted.'}{' '}
            <Link to="/house" className="font-sans text-sm underline underline-offset-4">
              Back to your house
            </Link>
          </p>
        ) : done ? (
          <div>
            <h1 ref={endHeading} tabIndex={-1} className="font-serif text-4xl outline-none" data-testid="house-count-end">
              {counted} counted, {goods.length - counted} left for later
            </h1>
            <p className="mt-3 text-[#6d685f]">What is left stays not counted until someone counts it.</p>
            <Link to="/house" className="mt-8 inline-block bg-[#1a5e6b] px-5 py-2.5 text-white">
              Back to your house
            </Link>
          </div>
        ) : good ? (
          <>
            {/* The counter snaps: a count is a fact. */}
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]" data-testid="house-count-counter">
              {index + 1} of {goods.length}
            </p>
            <div className="mt-2 h-px w-full bg-[#211f1b]/10" aria-hidden="true">
              <div
                data-testid="house-count-hairline"
                className="h-px w-full origin-left rtl:origin-right bg-[#1a5e6b] motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
            <div key={good.id} ref={card} className="mt-8" data-testid="house-count-card" data-good={good.id}>
              <label className="block">
                <span className="block font-serif text-3xl">{good.name}</span>
                <span className="mt-1 block text-sm text-[#6d685f]">How many are on the shelf, in {unitWord(good.uom)}?</span>
                <span className="mt-3 flex items-baseline gap-3">
                  <input
                    ref={field}
                    aria-label={`Count of ${good.name}, in ${unitWord(good.uom)}`}
                    inputMode="numeric"
                    autoComplete="off"
                    value={typed[good.id] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value
                      setRefusal(null)
                      setTyped((t) => ({ ...t, [good.id]: value }))
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void next()
                      }
                    }}
                    className="block w-32 border-b border-[#211f1b]/25 bg-transparent pb-2 text-3xl tabular-nums outline-none"
                  />
                  <span className="text-lg text-[#6d685f]">{unitWord(good.uom)}</span>
                </span>
              </label>
              {/* Held open: no shift. */}
              <p className="mt-2 min-h-[1.25rem] text-sm text-red-700" role="alert">
                {refusal ?? ''}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void next()}
                  disabled={writing}
                  className="min-h-[44px] bg-[#1a5e6b] px-5 text-white disabled:opacity-40"
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={skip}
                  className="min-h-[44px] border border-[#211f1b]/25 px-5"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => go(index - 1, 'back')}
                  disabled={index === 0}
                  className="min-h-[44px] px-5 text-[#6d685f] underline underline-offset-4 disabled:opacity-40"
                >
                  Back
                </button>
              </div>
            </div>
          </>
        ) : null}
      </main>
    </div>
  )
}
