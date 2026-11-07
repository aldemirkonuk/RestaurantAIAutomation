import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const sourceImage = proof?.sourceImage ?? null

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
  const absent = sectionOrder.filter(
    (section) => !drinkItems.some((item) => item.category?.toLowerCase().trim() === section),
  )

  const place = async (item: MenuImportReviewItem, category: string) => {
    setSaving(item.menuItemId)
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
    } finally {
      setSaving(null)
    }
  }

  const addAbsent = async () => {
    const category = addSection || absent[0]
    if (!addName.trim() || !category || !proof) return
    setSaving('add')
    try {
      const created = await addMenuItem(proof.menuId, { name: addName.trim(), category })
      setItems((current) => [
        ...current,
        { ...created, category, needsReview: false, matched: true },
      ])
      setAddName('')
      setAdding(false)
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
          It&apos;s a first proof — we&apos;ve pencilled the lines worth a second look.
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
          <p><strong className="block font-serif text-3xl">{items.length - pencilled}</strong><span className="text-xs uppercase tracking-wider">set</span></p>
          <p><strong className="block font-serif text-3xl">{pencilled}</strong><span className="text-xs uppercase tracking-wider">pencilled</span></p>
        </div>

        <div className="mt-12 space-y-12">
          {grouped.map(([category, rows]) => (
            <section key={category}>
              <h2 className="border-b border-[#211f1b]/30 pb-2 font-serif text-3xl">{sectionName(category)}</h2>
              <div>
                {rows.map((item) => {
                  const expanded = open === item.menuItemId
                  return (
                    <article key={item.menuItemId} className="border-b border-[#211f1b]/15">
                      <button
                        type="button"
                        onClick={() => lineNeedsPencil(item) && setOpen(expanded ? null : item.menuItemId)}
                        className="grid w-full grid-cols-[24px_1fr_auto] items-start gap-3 py-5 text-left"
                      >
                        <span
                          aria-label={
                            markFor(item) === 'ink'
                              ? 'Set in ink'
                              : markFor(item) === 'ring'
                                ? 'Needs a place'
                                : 'Pencilled'
                          }
                          className="font-serif text-xl text-[#1a5e6b]"
                        >
                          {markFor(item) === 'ink' ? '·' : markFor(item) === 'ring' ? '○' : '⌁'}
                        </span>
                        <span>
                          <strong className="block font-serif text-xl font-normal">
                            {[item.producer, item.name, item.vintage].filter(Boolean).join(' · ')}
                          </strong>
                          {markFor(item) === 'pencil' && (
                            <span className="mt-1 block text-xs italic text-[#6d685f]">Worth a second look</span>
                          )}
                          {markFor(item) === 'ring' && (
                            <span className="mt-1 block text-xs italic text-[#6d685f]">Needs a place</span>
                          )}
                        </span>
                        <span className="font-mono text-sm">{price(item)}</span>
                      </button>
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
                                    : 'No crop of this line — the original page was not kept.'}
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
                            <p className="text-xs uppercase tracking-wider text-[#6d685f]">Place this line</p>
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

