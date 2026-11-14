import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveProofItems } from '../lib/firstProof'
import { BrandMark } from '../components/brand/BrandMark'
import { NoProofInThisTab } from '../components/onboarding/NoProofInThisTab'
import {
  addMenuItem,
  readWarningSentence,
  reviewMenuItem,
  type MenuImportReviewItem,
} from '../services/api/menus'
import { isKitchenLine, lineNeedsPencil, lineSourceCrop, readProof } from '../lib/firstProof'
import { useAuth } from '../contexts/AuthContext'
import { MenuPlan } from './menu/next/MenuPlan'
import { makeCurrentSentence } from './menu/next/MenuVersions'

/**
 * What the person chose for this read, kept for the browser session so a
 * reload of the proof does not offer the choice again after it was made.
 * Per menu id: a second read in the same session gets its own choice.
 */
const choiceKey = (menuId: string) => `mudavym:first-proof-choice:${menuId}`

function readChoice(menuId: string | undefined): string | null {
  if (!menuId) return null
  try {
    return sessionStorage.getItem(choiceKey(menuId))
  } catch {
    return null
  }
}

function keepChoice(menuId: string, said: string) {
  try {
    sessionStorage.setItem(choiceKey(menuId), said)
  } catch {
    // A browser that refuses storage still shows the sentence on this screen.
  }
}

const KEPT_NOT_CURRENT =
  'Kept, not current. No price or stock changed. It waits on the menu page until an owner or a manager makes it current.'
import { settingsApi } from '../services/api/settings'
import { formatMoney } from '../lib/currency'
import { formatHouseNumber } from '../lib/house-number'
import { MenuReadNotes } from '../components/onboarding/MenuReadNotes'

const sectionOrder = [
  'wine',
  'red',
  'white',
  'rose',
  'sparkling',
  'beer',
  'cider',
  'whiskey',
  'spirit',
  'cocktail',
  'soft drink',
  'sake',
]

/**
 * A line the owner placed or added on this page. The flag lives only in the
 * proof kept in this session (saveProofItems), never on the gateway: it is
 * what lets the key say "set by you" instead of claiming the read set it.
 */
type ProofLine = MenuImportReviewItem & { setByHand?: boolean }

function markFor(item: MenuImportReviewItem): 'ink' | 'pencil' | 'ring' {
  if (!lineNeedsPencil(item)) return 'ink'
  return item.category && item.category.toLowerCase() !== 'unknown' ? 'pencil' : 'ring'
}

function sectionName(value: string) {
  const names: Record<string, string> = {
    red: 'Red wine',
    white: 'White wine',
    rose: 'Rosé',
    sparkling: 'Sparkling wine',
    spirit: 'Spirits',
    'soft drink': 'Soft drinks',
    // The heading for lines with no section (walk 2026-11-12: "Needs a place"
    // read as jargon; title-casing once gave "Needs A Place").
    'needs a place': 'No section yet',
  }
  return names[value] ?? value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/**
 * The house's money, read once for the proof's prices. `read` is false until
 * the answer is in, so a price is never said to have no currency while the
 * currency is still being asked for.
 */
type HouseMoney = { read: boolean; code: string | null }

/** A figure in the house's money; before the answer is in, the figure alone. */
function sayPrice(n: number, money: HouseMoney) {
  return money.read ? formatMoney(n, money.code) : formatHouseNumber(n, null, { digits: 2 })
}

/**
 * A dish's one figure (r28 gap 1, slice 2). The readers keep a dish's price in
 * `bottlePrice`, and "24 bottle" beside grilled octopus says a thing that is
 * not so: a dish says its figure alone, in the house's money as a drink's is
 * (r37 meet of #1469 with the menu train's proofPrice).
 */
export function dishPrice(item: Pick<MenuImportReviewItem, 'byGlassPrice' | 'bottlePrice'>, money: HouseMoney) {
  const n = item.bottlePrice ?? item.byGlassPrice
  return n == null ? '' : sayPrice(n, money)
}

/**
 * A line's prices in the house's money: "glass ₺14,00 · bottle ₺1.250,00".
 * It printed "1250 bottle" (r23 walk), a bare figure in a lira house. Before
 * the answer is in, the figure stands alone; a house with no code says so.
 */
export function proofPrice(item: Pick<MenuImportReviewItem, 'byGlassPrice' | 'bottlePrice'>, money: HouseMoney) {
  const say = (n: number) => sayPrice(n, money)
  const parts = [
    item.byGlassPrice != null ? `glass ${say(item.byGlassPrice)}` : null,
    item.bottlePrice != null ? `bottle ${say(item.bottlePrice)}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

/**
 * Read with a plain request, not react-query: the page's tests (here and in
 * ArrivalFlow) mount it with no query client, and one read is all it needs.
 * A failed read is "no code": the price says so, never a sign.
 */
function useHouseMoney(): HouseMoney {
  const [money, setMoney] = useState<HouseMoney>({ read: false, code: null })
  useEffect(() => {
    let live = true
    settingsApi
      .houseCurrency()
      .then((c) => live && setMoney({ read: true, code: c.readable ? (c.code ?? null) : null }))
      .catch(() => live && setMoney({ read: true, code: null }))
    return () => {
      live = false
    }
  }, [])
  return money
}

export default function HouseMenu() {
  const navigate = useNavigate()
  const proof = useMemo(readProof, [])
  const [items, setItems] = useState<ProofLine[]>(proof?.items ?? [])
  const [open, setOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [addSection, setAddSection] = useState('')
  const [placeError, setPlaceError] = useState<string | null>(null)
  const sourceImage = proof?.sourceImage ?? null
  // ADR 0193 item 7 (Locked): after a read the person chooses whether it
  // becomes the current menu; either way it is kept. The choice is an owner's
  // or a manager's (the gateway refuses anyone else regardless of this page).
  const { activeRole, user } = useAuth()
  const role = (activeRole ?? user?.role ?? null) as string | null
  const canManage = role === 'owner' || role === 'manager'
  const [planning, setPlanning] = useState(false)
  const [chosen, setChosen] = useState<string | null>(() => readChoice(proof?.menuId))
  // A file read before reopens its version (one upload is one version), and
  // that version may already be the current menu: then there is no choice to
  // offer. Read through a wider type: the import reply says `current: true`
  // only once the reopen path is on the branch.
  const alreadyCurrent = (proof as { current?: boolean } | null)?.current === true
  // Several files sent at once: each is read and kept as its own draft; the
  // proof shows the first, and says how many others were kept.
  const otherKeptRaw = (proof as { otherKept?: unknown } | null)?.otherKept
  const otherKept = typeof otherKeptRaw === 'number' && otherKeptRaw > 0 ? Math.floor(otherKeptRaw) : 0

  const choose = (said: string) => {
    setPlanning(false)
    setChosen(said)
    if (proof) keepChoice(proof.menuId, said)
  }
  const money = useHouseMoney()

  // Every placed or added line is kept for a reload and for /house's count.
  useEffect(() => {
    if (proof) saveProofItems(items)
  }, [proof, items])

  const kitchen = items.filter(isKitchenLine)
  const drinkItems = items.filter((item) => !isKitchenLine(item))

  const grouped = useMemo(() => {
    const map = new Map<string, MenuImportReviewItem[]>()
    for (const item of drinkItems) {
      const key = item.category?.toLowerCase().trim() || 'needs a place'
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return [...map.entries()].sort(
      ([a], [b]) =>
        (sectionOrder.indexOf(a) < 0 ? 99 : sectionOrder.indexOf(a)) -
        (sectionOrder.indexOf(b) < 0 ? 99 : sectionOrder.indexOf(b)),
    )
  }, [drinkItems])

  // No proof in this tab: the house's record says whether a menu is kept.
  if (!proof) return <NoProofInThisTab />

  if (proof.itemsExtracted === 0 && items.length === 0) {
    return (
      <div className="min-h-screen bg-[#fbfaf7] px-6 py-16 text-[#211f1b]">
        <div className="mx-auto max-w-2xl">
          <BrandMark size={24} alt="Mudavym" />
          <h1 className="mt-8 font-serif text-4xl">We couldn&apos;t read this file.</h1>
          <p className="mt-4 text-[#6d685f]">Nothing was set. Try a clearer photo or a PDF of the drinks list.</p>
          <MenuReadNotes notes={proof.notes} className="mt-4 text-sm text-[#6d685f]" />
          <button onClick={() => navigate('/get-started')} className="mt-6 text-[#1a5e6b] underline">
            Try another menu
          </button>
        </div>
      </div>
    )
  }

  const pencilled = drinkItems.filter((item) => lineNeedsPencil(item)).length
  // Walk 2026-11-12 (r13): "3 READ" sat over 2 in ink + 0 in pencil, because
  // the kitchen line was counted as read but shown in neither. The cells now
  // add up on their own: read = in ink + in pencil + set aside.
  const inkLines = drinkItems.filter((item) => markFor(item) === 'ink')
  const inkByHand = inkLines.some((item) => item.setByHand)
  const inkByRead = inkLines.some((item) => !item.setByHand)
  // The same rule the crop sentence uses: no page kept and no failure means
  // the lines were typed, so "set as read" would claim a reading that never ran.
  const typed = proof.source?.kept === false && !proof.source.failure
  // "Not on this menu" is only said once a line has a section: with every
  // line still needing a place, the read named no section at all, and
  // listing Wine, Red wine, White wine as absent claimed what it did not see.
  const anyPlaced = drinkItems.some((item) => {
    const category = item.category?.toLowerCase().trim()
    return Boolean(category) && category !== 'unknown'
  })
  const absent = anyPlaced
    ? sectionOrder.filter(
        (section) => !drinkItems.some((item) => item.category?.toLowerCase().trim() === section),
      )
    : []

  const place = async (item: MenuImportReviewItem, category: string) => {
    setSaving(item.menuItemId)
    setPlaceError(null)
    try {
      await reviewMenuItem(item.menuItemId, 'category', category)
      setItems((current) =>
        current.map((row) =>
          row.menuItemId === item.menuItemId
            ? { ...row, category, needsReview: false, matched: true, setByHand: true }
            : row,
        ),
      )
      setOpen(null)
    } catch {
      // A refused PATCH used to vanish: the line stayed open, unchanged, unsaid.
      setPlaceError('That line was not placed. Try again.')
    } finally {
      setSaving(null)
    }
  }

  const addAbsent = async () => {
    const category = addSection || absent[0]
    if (!addName.trim() || !category || !proof) return
    setSaving('add')
    setPlaceError(null)
    try {
      const created = await addMenuItem(proof.menuId, { name: addName.trim(), category })
      setItems((current) => [
        ...current,
        { ...created, category, needsReview: false, matched: true, setByHand: true },
      ])
      setAddName('')
      setAdding(false)
    } catch {
      setPlaceError('That line was not added. Try again.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#211f1b]">
      <header className="h-14 border-b border-[#211f1b]/15 bg-white px-5 flex items-center justify-between">
        <BrandMark size={24} alt="Mudavym" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">The first proof</span>
      </header>
      <main className={`mx-auto px-5 py-12 sm:py-16 ${showOriginal && sourceImage ? 'grid max-w-6xl gap-10 lg:grid-cols-2' : 'max-w-4xl'}`}>
        <div>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">House menu · first proof</p>
        {drinkItems.length === 0 && kitchen.length > 0 ? (
          <>
            {/* r28 gap 6, this page's half: "set by Mudavym" over sections
                with no drink in them, when every line read was a dish. */}
            <h1 className="mt-3 font-serif text-5xl">Your dishes, read by Mudavym.</h1>
            <p className="mt-4 max-w-2xl text-[#6d685f]">
              Every line read is a dish. They are kept on your menu as read. This page sets out drinks, and no
              drink was read.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-3 font-serif text-5xl">Your menu, set by Mudavym.</h1>
            <p className="mt-4 max-w-2xl text-[#6d685f]">
              It&apos;s a first proof. Lines in ink are set; a line in pencil is worth a second look. Tap it to
              see what was read and choose its section.
            </p>
          </>
        )}
        {sourceImage ? (
          <button
            type="button"
            onClick={() => setShowOriginal((value) => !value)}
            className="mt-4 text-sm text-[#1a5e6b] underline underline-offset-4"
          >
            {showOriginal ? 'Hide original' : 'Show my original'}
          </button>
        ) : null}
        <div
          role="group"
          aria-label="The reading count"
          className={`mt-10 grid border-y border-[#211f1b]/20 py-5 ${kitchen.length > 0 ? 'grid-cols-2 gap-y-4 sm:grid-cols-4' : 'grid-cols-3'}`}
        >
          <p><strong className="block font-serif text-3xl">{items.length}</strong><span className="text-xs uppercase tracking-wider">read</span></p>
          <p><strong className="block font-serif text-3xl">{drinkItems.length - pencilled}</strong><span className="text-xs uppercase tracking-wider">in ink</span></p>
          <p><strong className="block font-serif text-3xl">{pencilled}</strong><span className="text-xs uppercase tracking-wider">in pencil</span></p>
          {kitchen.length > 0 && (
            <p><strong className="block font-serif text-3xl">{kitchen.length}</strong><span className="text-xs uppercase tracking-wider">{kitchen.length === 1 ? 'dish' : 'dishes'}</span></p>
          )}
        </div>
        {/* Walk 2026-11-12: "set" and "pencilled" were never explained, and
            nothing said a line could be opened. ADR 0213 F6 keeps the ink /
            pencil words; this key says what each mark means and what to do. */}
        <ul aria-label="What the marks mean" className="mt-4 space-y-1 text-sm text-[#6d685f]">
          {inkByRead && (
            <li><span aria-hidden className="inline-block w-5 font-serif text-[#1a5e6b]">·</span>{typed ? 'In ink: set as you typed it.' : 'In ink: set as read.'}</li>
          )}
          {inkByHand && (
            <li><span aria-hidden className="inline-block w-5 font-serif text-[#1a5e6b]">·</span>In ink: set by you.</li>
          )}
          {drinkItems.some((item) => markFor(item) === 'pencil') && (
            <li><span aria-hidden className="inline-block w-5 font-serif text-[#1a5e6b]">⌁</span>In pencil: worth a second look. Tap the line to check it.</li>
          )}
          {drinkItems.some((item) => markFor(item) === 'ring') && (
            <li><span aria-hidden className="inline-block w-5 font-serif text-[#1a5e6b]">○</span>No section yet: tap the line to choose one.</li>
          )}
        </ul>
        {proof.warnings?.length ? (
          <ul data-testid="first-proof-warnings" className="mt-4 space-y-1 text-sm text-[#6d685f]">
            {proof.warnings.map((w, i) => (
              <li key={i}>{readWarningSentence(w)}</li>
            ))}
          </ul>
        ) : null}
        <MenuReadNotes notes={proof.notes} className="mt-4 text-sm text-[#6d685f]" />

        <div className="mt-12 space-y-12">
          {grouped.map(([category, rows]) => (
            <section key={category}>
              <h2 className="border-b border-[#211f1b]/30 pb-2 font-serif text-3xl">{sectionName(category)}</h2>
              <div>
                {rows.map((item) => {
                  const expanded = open === item.menuItemId
                  const mark = markFor(item)
                  const opens = lineNeedsPencil(item)
                  const markSpan = (
                    <span
                      aria-label={mark === 'ink' ? 'In ink' : mark === 'ring' ? 'No section yet' : 'In pencil'}
                      className="font-serif text-xl text-[#1a5e6b]"
                    >
                      {mark === 'ink' ? '·' : mark === 'ring' ? '○' : '⌁'}
                    </span>
                  )
                  const nameSpan = (
                    <strong className="block font-serif text-xl font-normal">
                      {[item.producer, item.name, item.vintage].filter(Boolean).join(' · ')}
                    </strong>
                  )
                  return (
                    <article key={item.menuItemId} className="border-b border-[#211f1b]/15">
                      {opens ? (
                        // Only a line worth a look opens, and it says so: a
                        // visible cue and aria-expanded (walk 2026-11-12:
                        // nothing showed that a line could be clicked).
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? null : item.menuItemId)}
                          className="grid w-full grid-cols-[24px_1fr_auto] items-start gap-3 py-5 text-left hover:bg-white"
                        >
                          {markSpan}
                          <span>
                            {nameSpan}
                            <span className="mt-1 block text-xs italic text-[#6d685f]">
                              {mark === 'ring' ? 'No section yet' : 'Worth a second look'}
                            </span>
                            <span className="mt-1 block text-xs text-[#1a5e6b] underline underline-offset-4">
                              {expanded ? 'Close' : mark === 'ring' ? 'Choose its section' : 'Check this line'}
                            </span>
                          </span>
                          <span className="font-mono text-sm">{proofPrice(item, money)}</span>
                        </button>
                      ) : (
                        <div className="grid w-full grid-cols-[24px_1fr_auto] items-start gap-3 py-5 text-left">
                          {markSpan}
                          <span>{nameSpan}</span>
                          <span className="font-mono text-sm">{proofPrice(item, money)}</span>
                        </div>
                      )}
                      {expanded && (
                        <div className="mb-5 ml-9 grid gap-5 border-l border-dashed border-[#1a5e6b] bg-white p-5 sm:grid-cols-2">
                          <div>
                            <p className="text-xs uppercase tracking-wider text-[#6d685f]">From the original</p>
                            {(() => {
                              const crop = lineSourceCrop(item, sourceImage)
                              if (crop) {
                                return (
                                  <img
                                    src={crop.image}
                                    alt="Crop of this line from the original"
                                    className="mt-2 max-h-48 w-full object-cover object-top"
                                  />
                                )
                              }
                              return (
                                <p className="mt-2 text-sm text-[#6d685f]">
                                  {sourceImage
                                    ? 'No crop of this line — the reading did not return a box.'
                                    : proof.source?.kept === false && !proof.source.failure
                                      ? 'No page to crop — this line was typed, not read from a photo.'
                                      : proof.source?.kept === false
                                        ? 'No crop of this line — the original page was not kept.'
                                        : 'No crop of this line — the original page is not open here.'}
                                </p>
                              )
                            })()}
                            <blockquote className="mt-2 font-serif text-lg">
                              {item.rawText || item.name}
                            </blockquote>
                            <p className="mt-3 text-sm text-[#6d685f]">
                              {item.category
                                ? `Read into ${sectionName(item.category)} from this line.`
                                : 'We could not tell which section this belongs in.'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wider text-[#6d685f]">Choose its section</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {sectionOrder.map((choice) => (
                                <button
                                  key={choice}
                                  type="button"
                                  disabled={saving === item.menuItemId}
                                  onClick={() => place(item, choice)}
                                  className="border border-dashed border-[#211f1b]/25 px-3 py-2 text-xs"
                                >
                                  {sectionName(choice)}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
        {placeError && (
          <p role="alert" className="mt-6 text-sm text-red-700">{placeError}</p>
        )}
        {/* r28 gap 1, slice 2: a dish was counted, then hidden behind "set
            aside — not Mudavym's job yet", so a kitchen that read its menu
            saw none of it. Each dish is listed with its figure, and the page
            says what is and is not done with it. */}
        {kitchen.length > 0 && (
          <section className="mt-12" aria-labelledby="house-menu-dishes">
            <h2 id="house-menu-dishes" className="border-b border-[#211f1b]/20 pb-3 font-serif text-3xl">
              Dishes
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-[#6d685f]">
              {kitchen.length} {kitchen.length === 1 ? 'dish' : 'dishes'} kept on your menu as read, apart from
              the drinks. A dish is not carried to stock or prices yet.
            </p>
            <ul>
              {kitchen.map((item) => (
                <li
                  key={item.menuItemId}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-b border-[#211f1b]/15 py-4"
                >
                  <span className="font-serif text-xl">{item.name || item.rawText}</span>
                  <span className="font-mono text-sm">{dishPrice(item, money)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {absent.length > 0 && (
          <div className="mt-12 border-t border-[#211f1b]/20 pt-6 text-sm text-[#6d685f]">
            <p>
              Not on this menu: {absent.slice(0, 4).map(sectionName).join(', ')}. Pour any of these?{' '}
              <button type="button" onClick={() => {
                setAdding((value) => !value)
                setAddSection(absent[0] ?? '')
              }} className="text-[#1a5e6b] underline">
                Add it.
              </button>
            </p>
            {adding && (
              <form
                className="mt-4 flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void addAbsent()
                }}
              >
                <label>
                  <span className="block text-xs uppercase tracking-wider">Line</span>
                  <input
                    aria-label="New menu line"
                    value={addName}
                    onChange={(event) => setAddName(event.target.value)}
                    className="mt-1 border-b border-[#211f1b]/25 bg-transparent pb-1 outline-none"
                  />
                </label>
                <label>
                  <span className="block text-xs uppercase tracking-wider">Section</span>
                  <select
                    aria-label="New line section"
                    value={addSection || absent[0]}
                    onChange={(event) => setAddSection(event.target.value)}
                    className="mt-1 bg-transparent outline-none"
                  >
                    {absent.map((section) => (
                      <option key={section} value={section}>{sectionName(section)}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={!addName.trim() || saving === 'add'} className="bg-[#1a5e6b] px-3 py-1.5 text-white disabled:opacity-40">
                  {saving === 'add' ? 'Adding…' : 'Add this line'}
                </button>
              </form>
            )}
          </div>
        )}
        <section
          aria-labelledby="first-proof-choice-h"
          data-testid="first-proof-choice"
          className="mt-12 border-t border-[#211f1b]/20 pt-6"
        >
          <h2 id="first-proof-choice-h" className="font-serif text-2xl">
            Is this the menu you pour from now?
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[#6d685f]">
            It is kept either way. Making it current sets the house&apos;s prices from it and puts its wines on the
            stock list; keeping it changes nothing.
          </p>
          {otherKept > 0 ? (
            <p data-testid="first-proof-other-kept" className="mt-2 max-w-2xl text-sm text-[#6d685f]">
              {otherKept === 1
                ? 'The other file you sent was read too and kept as its own draft, not current. It waits on the menu page.'
                : `The ${otherKept} other files you sent were read too, each kept as its own draft, not current. They wait on the menu page.`}
            </p>
          ) : null}
          {alreadyCurrent ? (
            <p role="status" data-testid="first-proof-already-current" className="mt-4 max-w-2xl text-sm">
              It is the current menu. This file was read before and is the menu you pour from now; nothing changed.
            </p>
          ) : chosen ? (
            <p role="status" data-testid="first-proof-choice-said" className="mt-4 max-w-2xl text-sm">
              {chosen}
            </p>
          ) : canManage ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={planning}
                onClick={() => setPlanning(true)}
                className="border border-[#211f1b]/40 px-4 py-2 text-sm disabled:opacity-40"
              >
                Make this the current menu
              </button>
              <button
                type="button"
                onClick={() => choose(KEPT_NOT_CURRENT)}
                className="border border-[#211f1b]/40 px-4 py-2 text-sm disabled:opacity-40"
              >
                Keep it, not current
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#6d685f]">
              An owner or a manager chooses whether it becomes the current menu. It is kept either way.
            </p>
          )}
          {planning && !chosen && !alreadyCurrent ? (
            <div className="mudavym mt-4" data-testid="first-proof-plan">
              <MenuPlan
                menuId={proof.menuId}
                canManage={canManage}
                onCancel={() => setPlanning(false)}
                onDone={(r, lines) => choose(makeCurrentSentence(r, undefined, lines, money.code))}
              />
            </div>
          ) : null}
        </section>
        <button type="button" onClick={() => navigate('/house')} className="mt-10 bg-[#1a5e6b] px-6 py-3 text-white">
          Open the house
        </button>
        </div>
        {showOriginal && sourceImage && (
          <aside className="border-l border-[#211f1b]/15 pl-6">
            <p className="text-xs uppercase tracking-wider text-[#6d685f]">Your original</p>
            <img src={sourceImage} alt="Your original menu" className="mt-4 w-full" />
          </aside>
        )}
      </main>
    </div>
  )
}

