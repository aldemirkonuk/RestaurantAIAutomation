import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Plus, Sparkles } from 'lucide-react'
import { Button } from '../ui/button'
import { useAuth } from '../../contexts/AuthContext'
import {
  addMenuItem,
  reviewMenuItem,
  type MakeCurrentResult,
  type MenuImportResult,
  type MenuImportReviewItem,
  type PlanLine,
} from '../../services/api/menus'
import { makeCurrentSentence, MenuReadChecks } from '../../pages/menu/next/MenuVersions'
import { checkLinesFromReview, showLineById } from '../../pages/menu/next/menu-read-checks'
import { MenuPlan } from '../../pages/menu/next/MenuPlan'
import { MenuSourcePane } from '../../pages/menu/next/MenuSourcePane'
import './menu-review-source.css'
import { useHouseCurrencyCode } from '../../hooks/queries/useHouseCurrencyCode'
import { formatMoney } from '../../lib/currency'
import { isKitchenLine } from '../../lib/firstProof'
import { kindNoun } from '../../pages/menu/next/menu-line-kind'
import { useReducedMotion } from '../../lib/mudavym/motion'

interface MenuReviewScreenProps {
  result: MenuImportResult
  /** `true` when the menu was made the current one here; otherwise it stays a kept draft. */
  onConfirm: (madeCurrent?: boolean) => void
  onSkip: () => void
  /** Drawn inside a page that already has its own frame (the menu page), not as a page of its own. */
  embedded?: boolean
  /** The host's own word on who may choose the current menu; without it, the signed-in role decides. */
  canChoose?: boolean
  /** The kept file this read came from, to keep beside the lines (owner or manager only). */
  source?: { menuId: string; mime: string | null } | null
}

type LineKind = 'wine' | 'dish' | 'line'

/**
 * What a read line is, so the words say it (r108 menu-g13; the same test the
 * first proof and /menu use). A dish is a kitchen line; a wine is a section
 * read as wine; anything else is just a line, never called a wine.
 */
function kindOf(item: MenuImportReviewItem): LineKind {
  if (isKitchenLine(item)) return 'dish'
  return kindNoun({ category: item.category })[0] === 'wine' ? 'wine' : 'line'
}

const NAME_WORD: Record<LineKind, string> = { wine: 'Wine', dish: 'Dish', line: 'Line' }

/** The one noun for a set of lines: their shared kind, else "lines". */
function nounFor(items: MenuImportReviewItem[]): { one: string; many: string } {
  const kinds = new Set(items.map(kindOf))
  if (kinds.size === 1) {
    const k = [...kinds][0]
    if (k === 'wine') return { one: 'wine', many: 'wines' }
    if (k === 'dish') return { one: 'dish', many: 'dishes' }
  }
  return { one: 'line', many: 'lines' }
}

interface EditableCellProps {
  value: string | null
  placeholder: string
  onSave: (value: string) => Promise<void>
}

/** Is the primary pointer a mouse or a trackpad? A hint about keys is only for one. */
function useFinePointer(): boolean {
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: fine)').matches : false
  const [fine, setFine] = useState(read)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(pointer: fine)')
    const on = () => setFine(mql.matches)
    on()
    mql.addEventListener?.('change', on)
    return () => mql.removeEventListener?.('change', on)
  }, [])
  return fine
}

/** Click-to-edit cell. Saves on blur/Enter; reverts on Escape. */
function EditableCell({ value, placeholder, onSave }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const reduce = useReducedMotion()

  const commit = async () => {
    setEditing(false)
    if (draft === (value ?? '')) return
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(value ?? '')
            setEditing(false)
          }
        }}
        className="w-full px-2 py-1 rounded-lg border border-seal focus:outline-none focus:ring-2 focus:ring-seal-ring text-sm"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={saving}
      className={`w-full text-left px-2 py-1 rounded-lg hover:bg-paper-1 text-sm ${reduce ? '' : 'transition-colors motion-reduce:transition-none'} disabled:opacity-50`}
    >
      {saving ? (
        <Loader2 className={`w-3.5 h-3.5 ${reduce ? '' : 'animate-spin'} text-inkm-3`} />
      ) : value ? (
        <span className="text-inkm-1">{value}</span>
      ) : (
        <span className="text-inkm-3 italic">{placeholder}</span>
      )}
    </button>
  )
}

export function MenuReviewScreen({ result, onConfirm, onSkip, embedded = false, canChoose: hostCanChoose, source = null }: MenuReviewScreenProps) {
  // ADR 0193 (menu versions, founder 2026-09-21): a read menu is KEPT as a
  // draft; after the extraction the person chooses whether it becomes the
  // current menu. That choice is an owner's or a manager's; the gateway
  // refuses anyone else regardless of what this screen offers.
  const auth = useAuth()
  const role = (auth?.activeRole ?? auth?.user?.role ?? null) as string | null
  const canChoose = hostCanChoose ?? (role === 'owner' || role === 'manager')
  // What the switch did, when there is something to say: a line whose price
  // failed, or a blank price that kept the last known one. Said here and the
  // review waits for Continue, rather than moving on as if every price landed
  // (last-call review, 2026-09-21; /menu says the same sentence).
  const [madeNote, setMadeNote] = useState<string | null>(null)
  // ADR 0193 round 3 (L13): the choice goes through the same plan /menu
  // shows -- what the menu would change, a Keep switch on each price -- and
  // names the plan's fingerprint. Nothing is chosen blind.
  const [planning, setPlanning] = useState(false)
  const currency = useHouseCurrencyCode()
  const reduce = useReducedMotion()
  const madeCurrent = (made: MakeCurrentResult, lines: PlanLine[]) => {
    setPlanning(false)
    if (made.failed.length > 0 || made.flagged > 0 || (made.held?.length ?? 0) > 0) {
      setMadeNote(makeCurrentSentence(made, undefined, lines, currency))
      return
    }
    onConfirm(true)
  }
  const [items, setItems] = useState<MenuImportReviewItem[]>(result.items)
  // A photo or a PDF opens beside the lines; a sheet cannot be shown, so it waits to be asked.
  const showSource = embedded && canChoose && source !== null
  const [sourceOpen, setSourceOpen] = useState(source?.mime === 'application/pdf' || source?.mime?.startsWith('image/') === true)
  const [showClean, setShowClean] = useState(false)
  const [addingRow, setAddingRow] = useState(false)
  const [newWineName, setNewWineName] = useState('')
  const [newWineProducer, setNewWineProducer] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addingLoading, setAddingLoading] = useState(false)

  const noun = nounFor(items)
  const addWord = noun.one[0].toUpperCase() + noun.one.slice(1)
  const flagged = items.filter((i) => i.needsReview)
  const clean = items.filter((i) => !i.needsReview)

  // j / k walk the lines that need a look first, then the clean ones when that fold is open.
  // The focus ring moves instantly; the row scrolls into view smoothly only when motion is allowed.
  const [cur, setCur] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const walking = useRef(false)
  const fine = useFinePointer()
  const walkIds = [...flagged, ...(showClean ? clean : [])].map((i) => i.menuItemId)
  const stop = cur && walkIds.includes(cur) ? cur : (walkIds[0] ?? null)
  const goTo = (id: string) => {
    walking.current = true
    setCur(id)
    const at = flagged.findIndex((i) => i.menuItemId === id)
    setSaid(
      at >= 0
        ? `Line ${at + 1} of ${flagged.length} to look at`
        : `Line ${clean.findIndex((i) => i.menuItemId === id) + 1} of ${clean.length} that read cleanly`,
    )
    const el = document.getElementById(`review-line-${id}`)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (planning || e.defaultPrevented || e.ctrlKey || e.metaKey) return
      if ((e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable="true"]')) return
      const down = e.altKey ? e.key === 'ArrowDown' : e.key === 'j'
      const up = e.altKey ? e.key === 'ArrowUp' : e.key === 'k'
      if ((!down && !up) || walkIds.length === 0) return
      const at = cur ? walkIds.indexOf(cur) : -1
      e.preventDefault()
      goTo(walkIds[down ? Math.min(walkIds.length - 1, at + 1) : Math.max(0, at - 1)])
    }
    const onPointer = () => {
      walking.current = false
      setCur(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  })

  const updateField = async (
    menuItemId: string,
    fieldName: 'name' | 'producer' | 'vintage' | 'region' | 'grape_variety',
    value: string,
  ) => {
    await reviewMenuItem(menuItemId, fieldName, value)
    setItems((prev) =>
      prev.map((item) =>
        item.menuItemId === menuItemId
          ? {
              ...item,
              name: fieldName === 'name' ? value : item.name,
              producer: fieldName === 'producer' ? value : item.producer,
              vintage: fieldName === 'vintage' ? value : item.vintage,
              region: fieldName === 'region' ? value : item.region,
              grapeVariety: fieldName === 'grape_variety' ? value : item.grapeVariety,
            }
          : item,
      ),
    )
    // A save made while walking by key moves on to the next line.
    if (walking.current) {
      const at = walkIds.indexOf(menuItemId)
      const next = walkIds[at + 1] ?? walkIds[at]
      if (next) window.setTimeout(() => goTo(next), 0)
    }
  }

  const handleAddWine = async () => {
    if (!newWineName.trim()) {
      setAddError(`${addWord} name is required.`)
      return
    }
    setAddingLoading(true)
    setAddError(null)
    try {
      const created = await addMenuItem(result.menuId, {
        name: newWineName.trim(),
        producer: newWineProducer.trim() || undefined,
      })
      setItems((prev) => [...prev, created])
      setNewWineName('')
      setNewWineProducer('')
      setAddingRow(false)
    } catch (e: any) {
      setAddError(e?.response?.data?.message || e?.message || `Failed to add ${addWord.toLowerCase()}.`)
    } finally {
      setAddingLoading(false)
    }
  }

  const row = (item: MenuImportReviewItem) => {
    const kind = kindOf(item)
    const wineLike = kind !== 'dish'
    const prices = [
      item.bottlePrice !== null ? `${wineLike ? 'Bottle ' : ''}${formatMoney(item.bottlePrice, currency)}` : null,
      item.byGlassPrice !== null ? `Glass ${formatMoney(item.byGlassPrice, currency)}` : null,
    ].filter((p): p is string => p !== null)
    const section = (item.category ?? '').trim()
    return (
      <div
        key={item.menuItemId}
        id={`review-line-${item.menuItemId}`}
        tabIndex={stop === item.menuItemId ? 0 : -1}
        aria-current={cur === item.menuItemId ? 'true' : undefined}
        onKeyDown={(e) => {
          const el = e.currentTarget
          if (e.target === el) {
            const first = e.key === 'Enter' ? el.querySelector('button') : null
            if (first) {
              e.preventDefault()
              walking.current = true
              first.click()
            }
            return
          }
          // Escape (or a save) closes the cell; the focus goes back to its row, not to the page.
          if ((e.key === 'Escape' || e.key === 'Enter') && walking.current && (e.target as HTMLElement).tagName === 'INPUT') {
            window.setTimeout(() => {
              if (!el.contains(document.activeElement)) el.focus({ preventScroll: true })
            }, 0)
          }
        }}
        className="px-3 py-2 rounded-xl border border-paper-2 bg-paper-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-seal-ring"
      >
        <div
          className={
            wineLike
              ? 'grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px_minmax(0,1fr)] gap-2 items-center'
              : 'grid grid-cols-1 gap-2 items-center'
          }
        >
          <EditableCell
            value={item.name}
            placeholder={`${NAME_WORD[kind]} name`}
            onSave={(v) => updateField(item.menuItemId, 'name', v)}
          />
          {wineLike && (
            <>
              <EditableCell
                value={item.producer}
                placeholder="Producer"
                onSave={(v) => updateField(item.menuItemId, 'producer', v)}
              />
              <EditableCell
                value={item.vintage}
                placeholder="Vintage"
                onSave={(v) => updateField(item.menuItemId, 'vintage', v)}
              />
              <EditableCell
                value={item.region}
                placeholder="Region"
                onSave={(v) => updateField(item.menuItemId, 'region', v)}
              />
            </>
          )}
        </div>
        <p className="px-2 text-xs text-inkm-4 mt-1" data-testid="review-line-meta">
          {section ? `${section}. ` : ''}
          {prices.length > 0 ? prices.join(', ') : 'No price was read.'}
        </p>
        {item.rawText ? (
          <p className="px-2 text-xs text-inkm-4 mt-0.5" data-testid="review-line-raw">
            Read as: {item.rawText}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={embedded ? 'bg-paper-0 text-inkm-1 rounded-2xl border border-paper-2 flex flex-col items-center px-4 py-6' : 'min-h-screen bg-paper-0 flex flex-col items-center px-4 pt-10 pb-16'}
      data-testid="menu-read-review"
    >
      <div className={showSource ? 'mdv-rsrc' : 'contents'}>
      {showSource && source ? (
        <aside className="mdv-rsrc__pane" aria-label="The menu it was read from">
          <MenuSourcePane fold menuId={source.menuId} mime={source.mime} open={sourceOpen} onToggle={() => setSourceOpen((o) => !o)} canManage />
        </aside>
      ) : null}
      <div className="w-full max-w-2xl mdv-rsrc__lines">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-inkm-1 mb-2">Review &amp; confirm</h1>
          {flagged.length > 0 ? (
            <p className="text-inkm-4">
              Quick check — we flagged {flagged.length} of {items.length} for you.
            </p>
          ) : (
            <p className="text-inkm-4">
              All {items.length} {items.length === 1 ? noun.one : noun.many} read cleanly. Nothing needs your attention.
            </p>
          )}
        </div>

        {fine && walkIds.length > 0 ? (
          <p className="text-xs text-inkm-4 mb-2" data-testid="review-keys-hint">
            j / k to move, Enter to correct
          </p>
        ) : null}
        <span className="sr-only" role="status" aria-live="polite">
          {said}
        </span>

        <MenuReadChecks
          lines={checkLinesFromReview(items)}
          testId="review-read-checks"
          onShow={(id) => {
            // A line in the folded "look good" group is opened first, then shown.
            if (clean.some((c) => c.menuItemId === id)) setShowClean(true)
            window.setTimeout(() => showLineById(`review-line-${id}`), 0)
          }}
        />

        {flagged.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2 text-sm font-medium text-amber-700">
              <AlertTriangle className="w-4 h-4" />
              Needs a quick look
            </div>
            <div className="space-y-2">{flagged.map(row)}</div>
          </div>
        )}

        {clean.length > 0 && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowClean((v) => !v)}
              className="flex items-center gap-2 text-sm text-inkm-4 hover:text-inkm-1 mb-2"
            >
              <Check className="w-4 h-4 text-green-600" />
              {clean.length} more look good
              {reduce ? (
                showClean ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-150 ${showClean ? 'rotate-90' : ''}`} />
              )}
            </button>
            {showClean && <div className="space-y-2">{clean.map(row)}</div>}
          </div>
        )}

        {addingRow ? (
          <div className="mb-6 p-4 rounded-xl border border-paper-2 bg-paper-1">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input
                autoFocus
                value={newWineName}
                onChange={(e) => setNewWineName(e.target.value)}
                placeholder={`${addWord} name *`}
                className="px-3 py-2 rounded-lg border border-paper-2 text-sm focus:border-seal focus:outline-none focus:ring-2 focus:ring-seal-ring"
              />
              <input
                value={newWineProducer}
                onChange={(e) => setNewWineProducer(e.target.value)}
                placeholder="Producer"
                className="px-3 py-2 rounded-lg border border-paper-2 text-sm focus:border-seal focus:outline-none focus:ring-2 focus:ring-seal-ring"
              />
            </div>
            {addError && <p className="text-xs text-red-600 mb-2">{addError}</p>}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAddWine}
                disabled={addingLoading}
                className="bg-seal hover:bg-seal-deep text-white"
              >
                {addingLoading ? 'Adding...' : `Add ${addWord.toLowerCase()}`}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAddingRow(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingRow(true)}
            className="flex items-center gap-1.5 text-sm text-seal hover:text-seal-deep font-medium mb-6"
          >
            <Plus className="w-4 h-4" />
            Add a {addWord.toLowerCase()}
          </button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-paper-2">
          <button onClick={onSkip} className="text-sm text-inkm-3 hover:text-inkm-2">
            Skip review
          </button>
          {madeNote ? (
            <Button onClick={() => onConfirm(true)} className="bg-seal hover:bg-seal-deep text-white">
              Continue
            </Button>
          ) : canChoose ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => onConfirm(false)} className="border-paper-2 bg-paper-0 text-inkm-1 hover:bg-paper-1">
                Keep it, not current
              </Button>
              <Button onClick={() => setPlanning(true)} disabled={planning} className="bg-seal hover:bg-seal-deep text-white">
                <Sparkles className="w-4 h-4 mr-1.5" />
                Make this the current menu
              </Button>
            </div>
          ) : (
            <Button onClick={() => onConfirm(false)} className="bg-seal hover:bg-seal-deep text-white">
              <Sparkles className="w-4 h-4 mr-1.5" />
              Looks good, continue
            </Button>
          )}
        </div>
        <p className="text-xs text-inkm-4 mt-2">
          This menu is kept either way. Its prices reach your wines only when it is the current menu
          {canChoose ? '.' : ', which an owner or a manager chooses.'}
        </p>
        {planning && !madeNote && (
          // The same plan /menu shows (MenuPlan), in the Mudavym tokens it is drawn with.
          <div className="mudavym" style={{ background: 'transparent' }} data-testid="onboarding-menu-plan">
            <MenuPlan
              menuId={result.menuId}
              canManage={canChoose}
              onCancel={() => setPlanning(false)}
              onDone={madeCurrent}
            />
          </div>
        )}
        {madeNote && (
          <p role="status" className="text-xs text-inkm-2 mt-1">
            {madeNote}
          </p>
        )}
      </div>
      </div>
    </div>
  )
}
