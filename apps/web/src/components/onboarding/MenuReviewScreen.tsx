import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Loader2, Plus, Sparkles } from 'lucide-react'
import { Button } from '../ui/button'
import { useAuth } from '../../contexts/AuthContext'
import {
  addMenuItem,
  reviewMenuItem,
  type MakeCurrentResult,
  type MenuImportResult,
  type MenuImportReviewItem,
} from '../../services/api/menus'
import { makeCurrentSentence } from '../../pages/menu/next/MenuVersions'
import { MenuPlan } from '../../pages/menu/next/MenuPlan'

interface MenuReviewScreenProps {
  result: MenuImportResult
  /** `true` when the menu was made the current one here; otherwise it stays a kept draft. */
  onConfirm: (madeCurrent?: boolean) => void
  onSkip: () => void
}

interface EditableCellProps {
  value: string | null
  placeholder: string
  onSave: (value: string) => Promise<void>
}

/** Click-to-edit cell. Saves on blur/Enter; reverts on Escape. */
function EditableCell({ value, placeholder, onSave }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)

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
        className="w-full px-2 py-1 rounded-lg border border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={saving}
      className="w-full text-left px-2 py-1 rounded-lg hover:bg-gray-100 text-sm transition-colors disabled:opacity-50"
    >
      {saving ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
      ) : value ? (
        <span className="text-gray-900">{value}</span>
      ) : (
        <span className="text-gray-400 italic">{placeholder}</span>
      )}
    </button>
  )
}

export function MenuReviewScreen({ result, onConfirm, onSkip }: MenuReviewScreenProps) {
  // ADR 0193 (menu versions, founder 2026-09-21): a read menu is KEPT as a
  // draft; after the extraction the person chooses whether it becomes the
  // current menu. That choice is an owner's or a manager's; the gateway
  // refuses anyone else regardless of what this screen offers.
  const auth = useAuth()
  const role = (auth?.activeRole ?? auth?.user?.role ?? null) as string | null
  const canChoose = role === 'owner' || role === 'manager'
  // What the switch did, when there is something to say: a line whose price
  // failed, or a blank price that kept the last known one. Said here and the
  // review waits for Continue, rather than moving on as if every price landed
  // (last-call review, 2026-09-21; /menu says the same sentence).
  const [madeNote, setMadeNote] = useState<string | null>(null)
  // ADR 0193 round 3 (L13): the choice goes through the same plan /menu
  // shows -- what the menu would change, a Keep switch on each price -- and
  // names the plan's fingerprint. Nothing is chosen blind.
  const [planning, setPlanning] = useState(false)
  const madeCurrent = (made: MakeCurrentResult) => {
    setPlanning(false)
    if (made.failed.length > 0 || made.flagged > 0 || (made.held?.length ?? 0) > 0) {
      setMadeNote(makeCurrentSentence(made))
      return
    }
    onConfirm(true)
  }
  const [items, setItems] = useState<MenuImportReviewItem[]>(result.items)
  const [showClean, setShowClean] = useState(false)
  const [addingRow, setAddingRow] = useState(false)
  const [newWineName, setNewWineName] = useState('')
  const [newWineProducer, setNewWineProducer] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addingLoading, setAddingLoading] = useState(false)

  const flagged = items.filter((i) => i.needsReview)
  const clean = items.filter((i) => !i.needsReview)

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
  }

  const handleAddWine = async () => {
    if (!newWineName.trim()) {
      setAddError('Wine name is required.')
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
      setAddError(e?.response?.data?.message || e?.message || 'Failed to add wine.')
    } finally {
      setAddingLoading(false)
    }
  }

  const row = (item: MenuImportReviewItem) => (
    <div
      key={item.menuItemId}
      className="grid grid-cols-[1fr_1fr_90px_1fr] gap-2 items-center px-3 py-2 rounded-xl border border-gray-100 bg-white"
    >
      <EditableCell
        value={item.name}
        placeholder="Wine name"
        onSave={(v) => updateField(item.menuItemId, 'name', v)}
      />
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
    </div>
  )

  return (
    <div className="min-h-screen bg-white flex flex-col items-center px-4 pt-10 pb-16">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Review &amp; confirm</h1>
          {flagged.length > 0 ? (
            <p className="text-gray-500">
              Quick check — we flagged {flagged.length} of {items.length} for you.
            </p>
          ) : (
            <p className="text-gray-500">
              All {items.length} wines matched cleanly. Nothing needs your attention.
            </p>
          )}
        </div>

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
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-2"
            >
              <Check className="w-4 h-4 text-green-600" />
              {clean.length} more look good
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showClean ? 'rotate-180' : ''}`} />
            </button>
            {showClean && <div className="space-y-2">{clean.map(row)}</div>}
          </div>
        )}

        {addingRow ? (
          <div className="mb-6 p-4 rounded-xl border border-gray-200 bg-gray-50">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input
                autoFocus
                value={newWineName}
                onChange={(e) => setNewWineName(e.target.value)}
                placeholder="Wine name *"
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20"
              />
              <input
                value={newWineProducer}
                onChange={(e) => setNewWineProducer(e.target.value)}
                placeholder="Producer"
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20"
              />
            </div>
            {addError && <p className="text-xs text-red-600 mb-2">{addError}</p>}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAddWine}
                disabled={addingLoading}
                className="bg-[#1A5E6B] hover:bg-[#14515C] text-white"
              >
                {addingLoading ? 'Adding...' : 'Add wine'}
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
            className="flex items-center gap-1.5 text-sm text-[#1A5E6B] hover:text-[#14515C] font-medium mb-6"
          >
            <Plus className="w-4 h-4" />
            Add a wine
          </button>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
          <button onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">
            Skip review
          </button>
          {madeNote ? (
            <Button onClick={() => onConfirm(true)} className="bg-[#1A5E6B] hover:bg-[#14515C] text-white">
              Continue
            </Button>
          ) : canChoose ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => onConfirm(false)}>
                Keep it, not current
              </Button>
              <Button onClick={() => setPlanning(true)} disabled={planning} className="bg-[#1A5E6B] hover:bg-[#14515C] text-white">
                <Sparkles className="w-4 h-4 mr-1.5" />
                Make this the current menu
              </Button>
            </div>
          ) : (
            <Button onClick={() => onConfirm(false)} className="bg-[#1A5E6B] hover:bg-[#14515C] text-white">
              <Sparkles className="w-4 h-4 mr-1.5" />
              Looks good, continue
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2">
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
          <p role="status" className="text-xs text-gray-700 mt-1">
            {madeNote}
          </p>
        )}
      </div>
    </div>
  )
}
