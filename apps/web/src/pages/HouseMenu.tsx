import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/brand/BrandMark'
import { useAuth } from '../contexts/AuthContext'
import {
  addMenuItem,
  listMenuVersions,
  reviewMenuItem,
  type MenuFileResult,
  type MenuImportReviewItem,
  type MenuReadNotes,
} from '../services/api/menus'
import {
  MENU_KINDS,
  absentFamilies,
  isKitchenLine,
  lineNeedsPencil,
  lineSourceCrop,
  pencilReason,
  readProof,
} from '../lib/firstProof'
import { formatHouseMoney } from '../lib/houseCurrency'
import { useHouseCurrency } from '../hooks/useHouseCurrency'
import { MenuPlan } from './menu/next/MenuPlan'
import { makeCurrentSentence } from './menu/next/MenuVersions'

// A legacy 'wine' line sorts first; every other section is the gateway's own.
const sectionOrder: string[] = ['wine', ...MENU_KINDS]

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
    orange: 'Orange wine',
    dessert: 'Dessert wine',
    fortified: 'Fortified wine',
    spirit: 'Spirits',
    'soft drink': 'Soft drinks',
    'non-alcoholic': 'Non-alcoholic',
  }
  return names[value] ?? value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

// In the house's money and marks (F-1001): "45.5 glass · 1250 bottle" read bare
// beside /menu's ₺1.250,00 for the same line.
function price(item: MenuImportReviewItem) {
  const parts = [
    item.byGlassPrice != null ? `${formatHouseMoney(item.byGlassPrice)} glass` : null,
    item.bottlePrice != null ? `${formatHouseMoney(item.bottlePrice)} bottle` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** What a spreadsheet read kept back, in a sentence each (F-017, F-683, F-684). */
function notesSaid(notes: MenuReadNotes | null | undefined): string[] {
  if (!notes) return []
  const said: string[] = []
  if (notes.ignoredColumns.length) {
    said.push(`Columns we did not read: ${notes.ignoredColumns.join(', ')}.`)
  }
  if (notes.dropped.length) {
    const rows = notes.dropped.map((d) => `row ${d.row} (${d.reason})`)
    said.push(
      `${notes.dropped.length} row${notes.dropped.length === 1 ? '' : 's'} skipped: ${rows.slice(0, 8).join('; ')}${rows.length > 8 ? `; and ${rows.length - 8} more` : ''}.`,
    )
  }
  if (notes.unreadable.length) {
    said.push(`Cells we could not read: ${notes.unreadable.slice(0, 8).join('; ')}.`)
  }
  return said
}

/** Every file sent at once, and what each one gave (F-682). */
function fileSaid(file: MenuFileResult): string {
  if ('failure' in file) return `${file.name}: not read. ${file.failure}`
  const lines = `${file.name}: ${file.itemsExtracted} line${file.itemsExtracted === 1 ? '' : 's'} read.`
  return file.partRead ? `${lines} ${partReadSaid(file.partRead)}` : lines
}

/** F-1292: a photo or PDF read only in part is not the whole menu. */
function partReadSaid(reason: string): string {
  return `Only part of this menu was read: ${reason}, so drinks may be missing. Reading it again, as a clearer photo or a smaller file, may read the rest.`
}

export default function HouseMenu() {
  const navigate = useNavigate()
  const { activeRestaurantId, activeRole, user } = useAuth()
  // Choosing the current menu is an owner's or a manager's (ADR 0193).
  const role = (activeRole ?? user?.role ?? null) as string | null
  const canManage = role === 'owner' || role === 'manager'
  // Read so the prices re-render in the house's money when the answer lands.
  useHouseCurrency()
  // Only the proof read for THIS house (F-273): after a house switch in the
  // same tab, the other house's proof is not shown.
  const proof = useMemo(() => readProof(activeRestaurantId), [activeRestaurantId])
  const [items, setItems] = useState(proof?.items ?? [])
  useEffect(() => setItems(proof?.items ?? []), [proof])
  // Ask the house's books whether a menu is already held, so a new tab never
  // invites reading the same menu twice, and which menu is current: a menu
  // read is kept, not current, until an owner or a manager chooses it (F-1295).
  const [held, setHeld] = useState<'checking' | 'held' | 'none' | 'unknown'>('checking')
  // undefined: not known (still asking, or the books could not be read).
  const [currentId, setCurrentId] = useState<string | null | undefined>(undefined)
  const [planning, setPlanning] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setHeld('checking')
    setCurrentId(undefined)
    listMenuVersions()
      .then((v) => {
        if (!live) return
        setHeld(v.current || v.versions.length > 0 ? 'held' : 'none')
        setCurrentId(v.current?.menuId ?? null)
      })
      .catch(() => live && setHeld('unknown'))
    return () => {
      live = false
    }
  }, [proof])
  const [lineError, setLineError] = useState<{ id: string; message: string } | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
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
          {held === 'checking' ? (
            <h1 className="mt-8 font-serif text-4xl">Looking for your menu…</h1>
          ) : held === 'none' ? (
            <>
              <h1 className="mt-8 font-serif text-4xl">No menu has been read yet.</h1>
              <button onClick={() => navigate('/get-started')} className="mt-6 text-[#1a5e6b] underline">
                Read a menu
              </button>
            </>
          ) : held === 'held' && currentId === null ? (
            <>
              <h1 className="mt-8 font-serif text-4xl">Your menu is read, but not yet current.</h1>
              <p className="mt-4 text-[#6d685f]">
                No price has changed. On your menu page, under Menus kept, an owner or a manager can make it the current menu.
              </p>
              <button onClick={() => navigate('/menu')} className="mt-6 text-[#1a5e6b] underline">
                Open your menu
              </button>
            </>
          ) : held === 'held' ? (
            <>
              <h1 className="mt-8 font-serif text-4xl">Your menu is already with us.</h1>
              <p className="mt-4 text-[#6d685f]">
                Its first proof stayed in the window where it was read. Every line is on your menu page.
              </p>
              <button onClick={() => navigate('/menu')} className="mt-6 text-[#1a5e6b] underline">
                Open your menu
              </button>
            </>
          ) : (
            <>
              <h1 className="mt-8 font-serif text-4xl">We could not check for your menu just now.</h1>
              <p className="mt-4 text-[#6d685f]">
                If you have already read one, it is on your menu page. Reading it again would add a second copy.
              </p>
              <div className="mt-6 flex gap-6">
                <button onClick={() => navigate('/menu')} className="text-[#1a5e6b] underline">
                  Open your menu
                </button>
                <button onClick={() => navigate('/get-started')} className="text-[#1a5e6b] underline">
                  Read a menu
                </button>
              </div>
            </>
          )}
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
  // Only a menu the books name as current is "set"; a read menu is kept until
  // it is chosen (F-1295).
  const isCurrent = currentId === proof.menuId
  const notCurrent = currentId !== undefined && !isCurrent
  // The kinds of drink with no line here, and the sections a new line for
  // them can go in (F-024).
  const absentKinds = absentFamilies(drinkItems)
  const absent = absentKinds.map((family) => family.key)
  const addChoices = absentKinds.flatMap((family) => family.kinds.filter((kind) => kind !== 'wine'))

  const place = async (item: MenuImportReviewItem, category: string) => {
    setSaving(item.menuItemId)
    setLineError(null)
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
      // F-272: said on the line, not swallowed. The line stays pencilled.
      setLineError({ id: item.menuItemId, message: 'This line was not placed. Nothing changed — try again.' })
    } finally {
      setSaving(null)
    }
  }

  const addAbsent = async () => {
    const category = addSection || addChoices[0]
    if (!addName.trim() || !category || !proof) return
    setSaving('add')
    setAddError(null)
    try {
      const created = await addMenuItem(proof.menuId, { name: addName.trim(), category })
      setItems((current) => [
        ...current,
        { ...created, category, needsReview: false, matched: true },
      ])
      setAddName('')
      setAdding(false)
    } catch {
      // F-272: the typed name stays in the box so a retry is one tap.
      setAddError('This line was not added. What you typed is still here — try again.')
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
        <h1 className="mt-3 font-serif text-5xl">
          {isCurrent ? 'Your menu, set by Mudavym.' : 'Your menu, read by Mudavym.'}
        </h1>
        <p className="mt-4 max-w-2xl text-[#6d685f]">
          It&apos;s a first proof — we&apos;ve pencilled the lines worth a second look.
        </p>
        {notCurrent && chosen === null ? (
          <div data-testid="proof-not-current" className="mt-4 max-w-2xl text-[#6d685f]">
            <p>It is read but not yet your current menu, so no price has changed.</p>
            {canManage ? (
              planning ? (
                <div className="mt-4">
                  <MenuPlan
                    menuId={proof.menuId}
                    canManage={canManage}
                    onCancel={() => setPlanning(false)}
                    onDone={(r) => {
                      setPlanning(false)
                      setChosen(makeCurrentSentence(r))
                      setCurrentId(proof.menuId)
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPlanning(true)}
                  className="mt-3 bg-[#1a5e6b] px-4 py-2 text-white"
                >
                  Make it current
                </button>
              )
            ) : (
              <p className="mt-2">An owner or a manager chooses whether it becomes the current menu.</p>
            )}
          </div>
        ) : null}
        {chosen ? (
          <p role="status" className="mt-4 max-w-2xl text-[#6d685f]">
            {chosen}
          </p>
        ) : null}
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

        {proof.files?.length || notesSaid(proof.read).length || proof.partRead ? (
          <div data-testid="proof-read-notes" className="mt-6 space-y-2 text-sm text-[#6d685f]">
            {proof.files?.map((file) => (
              <div key={file.name}>
                <p className={'failure' in file ? 'text-[#8a2b1d]' : undefined}>{fileSaid(file)}</p>
                {'failure' in file ? null : notesSaid(file.read).map((line) => <p key={line} className="ml-4">{line}</p>)}
              </div>
            ))}
            {!proof.files?.length && proof.partRead ? (
              <p className="text-[#8a2b1d]">{partReadSaid(proof.partRead)}</p>
            ) : null}
            {notesSaid(proof.read).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}

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
                            <span className="mt-1 block text-xs italic text-[#6d685f]">{pencilReason(item)}</span>
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
                              {MENU_KINDS.map((choice) => (
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
                            {lineError?.id === item.menuItemId && (
                              <p role="alert" className="mt-3 text-sm text-red-700">{lineError.message}</p>
                            )}
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
                setAddSection(addChoices[0] ?? '')
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
                    value={addSection || addChoices[0]}
                    onChange={(event) => setAddSection(event.target.value)}
                    className="mt-1 bg-transparent outline-none"
                  >
                    {addChoices.map((section) => (
                      <option key={section} value={section}>{sectionName(section)}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={!addName.trim() || saving === 'add'} className="bg-[#1a5e6b] px-3 py-1.5 text-white disabled:opacity-40">
                  {saving === 'add' ? 'Adding…' : 'Add this line'}
                </button>
                {addError && <p role="alert" className="w-full text-sm text-red-700">{addError}</p>}
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

