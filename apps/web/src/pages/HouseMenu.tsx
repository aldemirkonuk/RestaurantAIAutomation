import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveProofItems } from '../lib/firstProof'
import { BrandMark } from '../components/brand/BrandMark'
import {
  addMenuItem,
  reviewMenuItem,
  type MenuImportReviewItem,
} from '../services/api/menus'
import { isKitchenLine, lineNeedsPencil, lineSourceCrop, readProof } from '../lib/firstProof'

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

function price(item: MenuImportReviewItem) {
  const parts = [
    item.byGlassPrice != null ? `${item.byGlassPrice} glass` : null,
    item.bottlePrice != null ? `${item.bottlePrice} bottle` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

export default function HouseMenu() {
  const navigate = useNavigate()
  const proof = useMemo(readProof, [])
  const [items, setItems] = useState(proof?.items ?? [])
  const [open, setOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [addSection, setAddSection] = useState('')
  const [placeError, setPlaceError] = useState<string | null>(null)
  const sourceImage = proof?.sourceImage ?? null

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

  if (!proof) {
    return (
      <div className="min-h-screen bg-[#fbfaf7] px-6 py-16 text-[#211f1b]">
        <div className="mx-auto max-w-2xl">
          <BrandMark size={24} alt="Mudavym" />
          <h1 className="mt-8 font-serif text-4xl">No menu has been read yet.</h1>
          <button onClick={() => navigate('/get-started')} className="mt-6 text-[#1a5e6b] underline">
            Read a menu
          </button>
        </div>
      </div>
    )
  }

  if (proof.itemsExtracted === 0 && items.length === 0) {
    return (
      <div className="min-h-screen bg-[#fbfaf7] px-6 py-16 text-[#211f1b]">
        <div className="mx-auto max-w-2xl">
          <BrandMark size={24} alt="Mudavym" />
          <h1 className="mt-8 font-serif text-4xl">We couldn&apos;t read this file.</h1>
          <p className="mt-4 text-[#6d685f]">Nothing was set. Try a clearer photo or a PDF of the drinks list.</p>
          <button onClick={() => navigate('/get-started')} className="mt-6 text-[#1a5e6b] underline">
            Try another menu
          </button>
        </div>
      </div>
    )
  }

  const pencilled = drinkItems.filter((item) => lineNeedsPencil(item)).length
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
            ? { ...row, category, needsReview: false, matched: true }
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
        { ...created, category, needsReview: false, matched: true },
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
        <h1 className="mt-3 font-serif text-5xl">Your menu, set by Mudavym.</h1>
        <p className="mt-4 max-w-2xl text-[#6d685f]">
          It&apos;s a first proof. Lines in ink are set; a line in pencil is worth a second look. Tap it to
          see what was read and choose its section.
        </p>
        {sourceImage ? (
          <button
            type="button"
            onClick={() => setShowOriginal((value) => !value)}
            className="mt-4 text-sm text-[#1a5e6b] underline underline-offset-4"
          >
            {showOriginal ? 'Hide original' : 'Show my original'}
          </button>
        ) : null}
        <div role="group" aria-label="The reading count" className="mt-10 grid grid-cols-3 border-y border-[#211f1b]/20 py-5">
          <p><strong className="block font-serif text-3xl">{items.length}</strong><span className="text-xs uppercase tracking-wider">read</span></p>
          <p><strong className="block font-serif text-3xl">{drinkItems.length - pencilled}</strong><span className="text-xs uppercase tracking-wider">in ink</span></p>
          <p><strong className="block font-serif text-3xl">{pencilled}</strong><span className="text-xs uppercase tracking-wider">in pencil</span></p>
        </div>
        {/* Walk 2026-11-12: "set" and "pencilled" were never explained, and
            nothing said a line could be opened. ADR 0213 F6 keeps the ink /
            pencil words; this key says what each mark means and what to do. */}
        <ul aria-label="What the marks mean" className="mt-4 space-y-1 text-sm text-[#6d685f]">
          {drinkItems.some((item) => markFor(item) === 'ink') && (
            <li><span aria-hidden className="inline-block w-5 font-serif text-[#1a5e6b]">·</span>In ink: set as read.</li>
          )}
          {drinkItems.some((item) => markFor(item) === 'pencil') && (
            <li><span aria-hidden className="inline-block w-5 font-serif text-[#1a5e6b]">⌁</span>In pencil: worth a second look. Tap the line to check it.</li>
          )}
          {drinkItems.some((item) => markFor(item) === 'ring') && (
            <li><span aria-hidden className="inline-block w-5 font-serif text-[#1a5e6b]">○</span>No section yet: tap the line to choose one.</li>
          )}
        </ul>

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
                          <span className="font-mono text-sm">{price(item)}</span>
                        </button>
                      ) : (
                        <div className="grid w-full grid-cols-[24px_1fr_auto] items-start gap-3 py-5 text-left">
                          {markSpan}
                          <span>{nameSpan}</span>
                          <span className="font-mono text-sm">{price(item)}</span>
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
        {kitchen.length > 0 && (
          <p className="mt-10 text-sm text-[#6d685f]">
            {kitchen.length} kitchen {kitchen.length === 1 ? 'line' : 'lines'} set aside — not Mudavym&apos;s job yet.
          </p>
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

