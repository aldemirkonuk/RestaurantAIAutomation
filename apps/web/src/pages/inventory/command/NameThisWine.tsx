/**
 * The quiet flag on a wine whose name cannot say which wine it is, and the
 * way to name it.
 *
 * The founder, 2026-09-21 (ADR 0192's amendment): a delivered item the wine
 * library does not have is booked anyway and queued for research by its id;
 * one whose name is a placeholder ("wine 1", "house red") is skipped *"and
 * flag it. (then we create a little flag in users Ui saying if you were to
 * specify this wine, we could help you build better menus or such marketing
 * move. Users are also have features that they can edit their part of the
 * menu and wine names."*
 *
 * - The flag's words come from the gateway (`flag`), so the notice, the row
 *   and the expansion cannot word it three ways.
 * - The edit path is the house's own item name: the same PATCH every item
 *   edit uses (`updateInventoryItem`, `wineName` — ADR 0124's one alias), with
 *   the same gate that edit has today. A new name re-decides the research on
 *   the server.
 * - A failed read of the research list is said once on the page
 *   (`HouseItemResearchUnread`), never shown as "nothing to name".
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchHouseItemResearch,
  updateInventoryItem,
  type HouseItemResearch,
} from '../../../services/api/inventory'
import { getErrorMessage } from '../../../services/api/client'

export const HOUSE_ITEM_RESEARCH_KEY = ['inventory', 'research'] as const

export function useHouseItemResearch() {
  return useQuery({
    queryKey: HOUSE_ITEM_RESEARCH_KEY,
    queryFn: fetchHouseItemResearch,
    staleTime: 60_000,
  })
}

function entryFor(list: HouseItemResearch[] | undefined, inventoryId: string | undefined) {
  if (!list || !inventoryId) return undefined
  return list.find((r) => r.inventoryId === inventoryId)
}

/** One quiet line under the wine's name in its row. Nothing when there is nothing to ask. */
export function NameThisWineHint({ inventoryId }: { inventoryId?: string }) {
  const research = useHouseItemResearch()
  const entry = entryFor(research.data, inventoryId)
  if (!entry?.flag) return null
  return (
    <div data-testid="name-this-wine-hint" className="text-[11px] text-amber-700 mt-0.5 truncate" title={entry.flag}>
      {entry.flag}
    </div>
  )
}

/** In the row's expansion: the flag, and the house's own name for the wine, editable. */
export function NameThisWine({ inventoryId, currentName }: { inventoryId?: string; currentName?: string | null }) {
  const research = useHouseItemResearch()
  const queryClient = useQueryClient()
  const entry = entryFor(research.data, inventoryId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(currentName ?? '')
  const [saving, setSaving] = useState(false)
  const [says, setSays] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  if (!inventoryId) return null
  if (!entry?.flag && !says) return null

  const save = async () => {
    const name = draft.trim()
    if (!name) {
      setProblem('Write the wine\'s name, for example its producer and wine.')
      return
    }
    setSaving(true)
    setProblem(null)
    try {
      await updateInventoryItem(inventoryId, { wineName: name })
      setEditing(false)
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
      // Only what the RE-READ list says. A re-read that failed leaves the old
      // list in the cache, and reading it would word the old status as the new
      // one; it promises nothing instead (last call, 2026-09-21).
      const state = queryClient.getQueryState(HOUSE_ITEM_RESEARCH_KEY)
      const reread = !(state?.status === 'error' && state.errorUpdatedAt >= state.dataUpdatedAt)
      const fresh = reread ? queryClient.getQueryData<HouseItemResearch[]>(HOUSE_ITEM_RESEARCH_KEY) : undefined
      const now = entryFor(fresh, inventoryId)
      setSays(
        now?.status === 'not_findable'
          ? 'Saved. That name still does not say which wine this is.'
          : now?.status === 'queued'
            ? 'Saved. We will look this wine up by its new name.'
            : 'Saved.',
      )
    } catch (e) {
      setProblem(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-testid="name-this-wine"
      className="mb-3.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-xs text-gray-700"
    >
      {entry?.flag && <p className="m-0">{entry.flag}</p>}
      {entry?.flag && !editing && (
        <button
          type="button"
          onClick={() => {
            setDraft(currentName ?? '')
            setEditing(true)
            setSays(null)
          }}
          className="mt-1.5 text-xs font-semibold text-wine-700 hover:underline"
        >
          Name this wine
        </button>
      )}
      {editing && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label className="sr-only" htmlFor={`name-this-wine-${inventoryId}`}>
            The wine&apos;s name
          </label>
          <input
            id={`name-this-wine-${inventoryId}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Producer and wine, e.g. Kavaklıdere Yakut 2019"
            maxLength={200}
            className="min-w-[220px] flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-wine-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving' : 'Save the name'}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">
            Cancel
          </button>
        </form>
      )}
      {says && (
        <p role="status" data-testid="name-this-wine-says" className="m-0 mt-1.5 text-gray-600">
          {says}
        </p>
      )}
      {problem && (
        <p role="alert" data-testid="name-this-wine-problem" className="m-0 mt-1.5 text-rose-700">
          {problem}
        </p>
      )}
    </div>
  )
}

/** Said once on the page when the list cannot be read — a failed read, not "nothing to name". */
export function HouseItemResearchUnread() {
  const research = useHouseItemResearch()
  if (!research.isError) return null
  return (
    <p role="status" data-testid="house-item-research-unread" className="mt-2 text-xs text-gray-500">
      Which wines need naming could not be read ({getErrorMessage(research.error)}). That is a failed read, not
      &ldquo;nothing to name&rdquo;.
    </p>
  )
}
