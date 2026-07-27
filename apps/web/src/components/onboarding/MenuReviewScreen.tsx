import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Loader2, Plus, Sparkles } from 'lucide-react'
import { Button } from '../ui/button'
import {
  addMenuItem,
  reviewMenuItem,
  type MenuImportResult,
  type MenuImportReviewItem,
} from '../../services/api/menus'

interface MenuReviewScreenProps {
  result: MenuImportResult
  onConfirm: () => void
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
        className="w-full px-2 py-1 rounded-lg border border-[#B8323A] focus:outline-none focus:ring-2 focus:ring-[#B8323A]/20 text-sm"
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
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-[#B8323A] focus:outline-none focus:ring-2 focus:ring-[#B8323A]/20"
              />
              <input
                value={newWineProducer}
                onChange={(e) => setNewWineProducer(e.target.value)}
                placeholder="Producer"
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-[#B8323A] focus:outline-none focus:ring-2 focus:ring-[#B8323A]/20"
              />
            </div>
            {addError && <p className="text-xs text-red-600 mb-2">{addError}</p>}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAddWine}
                disabled={addingLoading}
                className="bg-[#B8323A] hover:bg-[#D1454C] text-white"
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
            className="flex items-center gap-1.5 text-sm text-[#B8323A] hover:text-[#D1454C] font-medium mb-6"
          >
            <Plus className="w-4 h-4" />
            Add a wine
          </button>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
          <button onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">
            Skip review
          </button>
          <Button onClick={onConfirm} className="bg-[#B8323A] hover:bg-[#D1454C] text-white">
            <Sparkles className="w-4 h-4 mr-1.5" />
            Looks good, continue
          </Button>
        </div>
      </div>
    </div>
  )
}
