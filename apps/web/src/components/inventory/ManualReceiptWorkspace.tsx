/**
 * Manual receipt workspace (§3 Option C of .planning/INVENTORY_ADD_REMOVE_SCENARIOS.md).
 *
 * For stock arriving outside a tracked PO: a truck with 40 lines and no invoice,
 * a cellar load-in, a rep dropping off tasting samples. ReceivingWorkspace needs
 * a matching order and does a four-way match, and AddWineToInventoryModal is one
 * wine at a time — neither fits. A sample is just this receipt with one row and
 * the free-sample box ticked, which is why it is the same grid rather than a
 * second screen.
 *
 * Provider / reference / default location are receipt-level on purpose: the
 * manager sets them once and every row inherits them.
 *
 * ── THE HOUSE SHAPE (ADR 0112, census 102 row "A delivery without an order") ─
 * SHAPE: `Sheet · wide` (640). The founder answered fork F3 on 2026-09-05: a
 * sheet here, not a route. A delivery is one object being written, opened from
 * the register the lines are landing on — and it is the second surface in the
 * house that holds PROSE-shaped rows rather than an object's fields, so it
 * takes the 640 the email composer takes (sketch 100). 440 minus padding
 * cannot hold a wine name, a count, a cost and a zone on one line, and this is
 * precisely the case ADR 0112 anticipated when it made `wide` a boolean rather
 * than a number.
 *
 * No seal. The line-by-line write goes through the bulk endpoint, which reports
 * per-line outcomes and leaves failures on screen to fix and resubmit — a
 * resumable batch, not a single irreversible commitment. ADR 0112 rations the
 * wax; and the receipt is corrected by receiving again, not by an undo.
 *
 * The lines do NOT use `BatchReceiveGrid` on this branch. That grid is a wide
 * table built for a 6xl modal; at 640 its columns collapse into each other. The
 * house branch renders each line as a row with its fields stacked under it,
 * which is what 640 can actually hold — same rows, same validation, same
 * `batchRowsToBulkLines`, so both branches write exactly the same payload.
 *
 * Endpoint: `persistBatchToInventory` → `POST /inventory/:restaurantId/items/bulk`
 * (apps/api-gateway/src/inventory/inventory.controller.ts:77).
 *
 * The legacy branch below is frozen and renders byte-for-byte as it shipped.
 */
import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  Loader2,
  PackagePlus,
  Plus,
  Search,
  Truck,
  Wine as WineIcon,
  X,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useWines } from '../../hooks/queries'
import { useProviders } from '../../hooks/queries/useProviderQueries'
import { useStorageLocations } from '../../hooks/useStorageLocations'
import { persistBatchToInventory, type MenuScannerPersistResult } from '../../lib/menuScannerPersistence'
import { ThemedSelect } from '../ui/ThemedSelect'
import {
  BatchReceiveGrid,
  batchRowsToBulkLines,
  batchTotals,
  nextBatchRowKey,
  validateBatchRows,
  type BatchReceiveRow,
} from './BatchReceiveGrid'
import { Sheet } from '../mudavym/Sheet'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import './inventory-mudavym.css'

interface ManualReceiptWorkspaceProps {
  isOpen: boolean
  onClose: () => void
  /** Fired after at least one line was written, so the host can refresh its own view. */
  onSaved?: (result: MenuScannerPersistResult) => void
}

const EMPTY_DRAFT = { name: '', producer: '', vintage: '', country: '', region: '', grapeVariety: '' }

export function ManualReceiptWorkspace({ isOpen, onClose, onSaved }: ManualReceiptWorkspaceProps) {
  const { user, activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()
  const { locations } = useStorageLocations()
  const restaurantId = activeRestaurantId || user?.restaurantId || ''
  const { data: providers = [] } = useProviders(restaurantId)

  const [providerId, setProviderId] = useState('')
  const [reference, setReference] = useState('')
  const [defaultLocationId, setDefaultLocationId] = useState('')
  const [rows, setRows] = useState<BatchReceiveRow[]>([])
  const [search, setSearch] = useState('')
  const [showDraftForm, setShowDraftForm] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shell = useMudavymShell()
  /* A refusal is not a fault. House branch only; the legacy render never reads
     it, so the flag-off tree is byte-identical. */
  const [denied, setDenied] = useState(false)

  const { data: searchResults = [], isFetching: isSearching } = useWines({
    search: search.trim().length >= 2 ? search.trim() : undefined,
    limit: 25,
  })

  const totals = useMemo(() => batchTotals(rows), [rows])
  const issues = useMemo(() => validateBatchRows(rows), [rows])
  const alreadyOnReceipt = useMemo(
    () => new Set(rows.map((r) => r.wineId).filter(Boolean) as string[]),
    [rows],
  )

  const providerOptions = useMemo(
    () => [
      { value: '', label: 'No provider recorded' },
      ...providers.map((p) => ({ value: p.id, label: p.name })),
    ],
    [providers],
  )
  const locationOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...locations.map((l) => ({ value: l.id, label: l.name })),
    ],
    [locations],
  )

  const addLibraryWine = useCallback(
    (wine: { id: string; name: string; producer?: string; vintage?: number; price?: number }) => {
      setRows((prev) => [
        ...prev,
        {
          key: nextBatchRowKey('receipt'),
          wineId: wine.id,
          name: wine.name,
          producer: wine.producer,
          vintage: wine.vintage ?? null,
          quantity: 1,
          cost: '',
          storageLocationId: defaultLocationId || undefined,
          isSample: false,
          selected: false,
        },
      ])
      setSearch('')
    },
    [defaultLocationId],
  )

  const addDraftWine = useCallback(() => {
    const name = draft.name.trim()
    if (!name) return
    const vintage = draft.vintage.trim() ? Number(draft.vintage.trim()) : null
    setRows((prev) => [
      ...prev,
      {
        key: nextBatchRowKey('receipt'),
        draft: {
          name,
          producer: draft.producer.trim() || undefined,
          vintage: Number.isFinite(vintage) ? vintage : null,
          country: draft.country.trim() || undefined,
          region: draft.region.trim() || undefined,
          grapeVariety: draft.grapeVariety.trim() || undefined,
        },
        name,
        producer: draft.producer.trim() || undefined,
        vintage: Number.isFinite(vintage) ? vintage : null,
        quantity: 1,
        cost: '',
        storageLocationId: defaultLocationId || undefined,
        isSample: false,
        selected: false,
      },
    ])
    setDraft(EMPTY_DRAFT)
    setShowDraftForm(false)
  }, [draft, defaultLocationId])

  const close = () => {
    if (isSaving) return
    setProviderId('')
    setReference('')
    setDefaultLocationId('')
    setRows([])
    setSearch('')
    setShowDraftForm(false)
    setDraft(EMPTY_DRAFT)
    setError(null)
    onClose()
  }

  const save = async () => {
    if (isSaving || rows.length === 0 || issues.length > 0) return
    setIsSaving(true)
    setError(null)
    setDenied(false)
    try {
      const persisted = await persistBatchToInventory(
        batchRowsToBulkLines(rows, { providerId: providerId || undefined }),
        { source: 'manual_receipt', reason: reference.trim() || undefined },
      )
      queryClient.invalidateQueries({ queryKey: ['inventory'] })

      const failedByIndex = new Map(persisted.failed.map((f) => [f.index, f]))
      const landedWines =
        persisted.added.length + persisted.stockAdded.length + persisted.reactivated.length
      const landedBottles = rows.reduce(
        (sum, row, index) => (failedByIndex.has(index) ? sum : sum + row.quantity),
        0,
      )

      if (landedWines > 0) {
        onSaved?.(persisted)
        toast.success(
          `Receipt recorded — ${landedWines} wine${landedWines !== 1 ? 's' : ''}, ${landedBottles} bottle${landedBottles !== 1 ? 's' : ''}`,
          {
            description: [
              persisted.stockAdded.length > 0 && `${persisted.stockAdded.length} restocked onto existing rows`,
              persisted.provisional.length > 0 && `${persisted.provisional.length} added to the library as provisional`,
              persisted.failed.length > 0 && `${persisted.failed.length} line${persisted.failed.length !== 1 ? 's' : ''} still need attention`,
            ]
              .filter(Boolean)
              .join(' · ') || undefined,
          },
        )
      }

      if (persisted.failed.length === 0) {
        close()
        return
      }
      // Failed lines stay on screen with the server's reason so they can be fixed
      // and resubmitted; the rows that landed are dropped to avoid double-counting.
      setRows((prev) =>
        prev
          .map((row, index) => ({ ...row, error: failedByIndex.get(index)?.error ?? 'Could not be saved' }))
          .filter((_, index) => failedByIndex.has(index)),
      )
      setError(
        `${persisted.failed.length} of ${rows.length} line${rows.length !== 1 ? 's' : ''} could not be saved. Everything else was recorded — fix these and save again.`,
      )
    } catch (err: any) {
      setDenied(err?.response?.status === 403 || err?.response?.status === 401)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'Could not record this receipt. Check your connection and try again.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  const draftInput =
    'w-full h-8 px-2 text-xs border border-gray-200 rounded-lg outline-none focus:border-wine-500 focus:ring-2 focus:ring-wine-100'

  /* ── the house shape ───────────────────────────────────────────────────── */
  if (shell.on) {
    const providerName = providerId
      ? (providers.find((p) => p.id === providerId)?.name ?? 'a provider that is no longer listed')
      : 'No provider recorded'
    const setRow = (key: string, patch: Partial<BatchReceiveRow>) =>
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

    return (
      <Sheet
        open={isOpen}
        onClose={close}
        label="A delivery without an order. Recording it writes an inventory line for each row below. Leaving writes nothing."
        eyebrow="The door"
        title="A delivery without an order"
        wide
        zIndex={110}
        footer={
          <span>
            {providerName}
            {reference.trim() ? ` · ${reference.trim()}` : ''} · {totals.bottles} bottle
            {totals.bottles !== 1 ? 's' : ''} on {totals.rows} line{totals.rows !== 1 ? 's' : ''}
          </span>
        }
      >
        <div className="mdv-form">
          <p className="mdv-contract">
            Stock that arrived without a purchase order — a truck with forty lines, a cellar
            load-in, a rep leaving samples. Recording it writes one inventory line per row. Leaving
            writes nothing.
          </p>

          {error && (
            <div className="mdv-alert" role="alert">
              <p className="mdv-alert__head">{denied ? 'Not permitted' : 'Not recorded'}</p>
              <p>
                {denied
                  ? 'This account is not permitted to write inventory lines. Nothing was recorded; every line below is unchanged.'
                  : error}
              </p>
            </div>
          )}

          {/* Receipt-level: set once, inherited by every new row. */}
          <div className="mdv-pair">
            <div>
              <label className="mdv-label" htmlFor="mdv-receipt-provider">
                Provider
              </label>
              <ThemedSelect
                value={providerId}
                options={providerOptions}
                onChange={setProviderId}
                align="left"
                className="w-full"
                aria-label="Provider for this receipt"
              />
            </div>
            <div>
              <label className="mdv-label" htmlFor="mdv-receipt-ref">
                Invoice or reference
              </label>
              <input
                id="mdv-receipt-ref"
                className="mdv-input"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. INV-4471, or “walk-in samples”"
              />
            </div>
          </div>
          <div>
            <label className="mdv-label" htmlFor="mdv-receipt-loc">
              Default zone for new rows
            </label>
            <ThemedSelect
              value={defaultLocationId}
              options={locationOptions}
              onChange={setDefaultLocationId}
              align="left"
              className="w-full"
              aria-label="Default storage location for new rows"
            />
          </div>

          {/* Add a line. */}
          <div className="mdv-search">
            <label className="mdv-label" htmlFor="mdv-receipt-search">
              Add a line from the Master Wine Library
            </label>
            <input
              id="mdv-receipt-search"
              className="mdv-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearch('')
              }}
              placeholder="Search the library…"
            />
            {search.trim().length >= 2 && (
              <div className="mdv-search__list">
                {isSearching && searchResults.length === 0 && (
                  <p className="mdv-note">Searching the library…</p>
                )}
                {!isSearching && searchResults.length === 0 && (
                  <p className="mdv-note">
                    Nothing in the library matches “{search.trim()}”. Add it as a wine the library
                    does not have yet.
                  </p>
                )}
                {searchResults.map((wine) => {
                  const onReceipt = alreadyOnReceipt.has(wine.id)
                  return (
                    <button
                      key={wine.id}
                      type="button"
                      className="mdv-item"
                      disabled={onReceipt}
                      onClick={() => addLibraryWine(wine)}
                    >
                      <span className="mdv-item__text">
                        <span className="mdv-item__label">{wine.name}</span>
                        <span className="mdv-item__sub">
                          {[wine.producer, wine.vintage ?? 'NV', wine.region]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      {onReceipt && <span className="mdv-kbd">on this receipt</span>}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="mdv-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="mdv-btn"
                onClick={() => setShowDraftForm((v) => !v)}
              >
                {showDraftForm ? 'Cancel the new wine' : 'A wine the library does not have'}
              </button>
            </div>
          </div>

          {showDraftForm && (
            <div className="mdv-panelbox">
              <p className="mdv-hintline" style={{ marginTop: 0 }}>
                This creates a provisional Master Library entry so the stock can be tracked now. The
                name is all that is required; the rest only makes it easier to match up later, and a
                provisional entry stays marked as one.
              </p>
              <div className="mdv-pair" style={{ marginTop: 8 }}>
                <div>
                  <label className="mdv-label" htmlFor="mdv-draft-name">
                    Wine name
                  </label>
                  <input
                    id="mdv-draft-name"
                    className="mdv-input"
                    autoFocus
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addDraftWine()
                    }}
                  />
                </div>
                <div>
                  <label className="mdv-label" htmlFor="mdv-draft-producer">
                    Producer
                  </label>
                  <input
                    id="mdv-draft-producer"
                    className="mdv-input"
                    value={draft.producer}
                    onChange={(e) => setDraft({ ...draft, producer: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mdv-label" htmlFor="mdv-draft-vintage">
                    Vintage
                  </label>
                  <input
                    id="mdv-draft-vintage"
                    className="mdv-input"
                    value={draft.vintage}
                    onChange={(e) =>
                      setDraft({ ...draft, vintage: e.target.value.replace(/[^\d]/g, '') })
                    }
                  />
                </div>
                <div>
                  <label className="mdv-label" htmlFor="mdv-draft-region">
                    Region
                  </label>
                  <input
                    id="mdv-draft-region"
                    className="mdv-input"
                    value={draft.region}
                    onChange={(e) => setDraft({ ...draft, region: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mdv-label" htmlFor="mdv-draft-grape">
                    Grape
                  </label>
                  <input
                    id="mdv-draft-grape"
                    className="mdv-input"
                    value={draft.grapeVariety}
                    onChange={(e) => setDraft({ ...draft, grapeVariety: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mdv-label" htmlFor="mdv-draft-country">
                    Country
                  </label>
                  <input
                    id="mdv-draft-country"
                    className="mdv-input"
                    value={draft.country}
                    onChange={(e) => setDraft({ ...draft, country: e.target.value })}
                  />
                </div>
              </div>
              <div className="mdv-actions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="mdv-btn mdv-btn--seal"
                  disabled={!draft.name.trim()}
                  onClick={addDraftWine}
                >
                  Add the line
                </button>
              </div>
            </div>
          )}

          {/* The lines. */}
          <div>
            <span className="mdv-head">
              <span>On this receipt — {rows.length}</span>
              {totals.provisional > 0 && (
                <span>{totals.provisional} new to the library</span>
              )}
            </span>

            {rows.length === 0 ? (
              <p className="mdv-quiet">
                Nothing is on this receipt yet. Search the library above to add a line, or add a
                wine the library does not have. Nothing is written until you record it.
              </p>
            ) : (
              <div className="mdv-picks mdv-scroll">
                {rows.map((row) => (
                  <div key={row.key} className="mdv-pick" role="group" style={{ alignItems: 'flex-start' }}>
                    <span style={{ minWidth: 0, flex: '1 1 auto' }}>
                      <span className="mdv-pick__label" style={{ whiteSpace: 'normal' }}>
                        {row.name}
                        {row.vintage ? ` ${row.vintage}` : ''}
                      </span>
                      <span className="mdv-pick__sub">
                        {row.producer ?? 'no producer recorded'}
                        {row.draft ? ' · new to the library, carried as provisional' : ''}
                      </span>
                      {row.hint && <span className="mdv-grey">{row.hint}</span>}
                      {row.error && (
                        <span className="mdv-grey" role="alert">
                          Not saved — {row.error}
                        </span>
                      )}
                      <span className="mdv-pair" style={{ marginTop: 6 }}>
                        <span>
                          <label className="mdv-label" htmlFor={`qty-${row.key}`}>
                            Bottles
                          </label>
                          <input
                            id={`qty-${row.key}`}
                            className="mdv-input"
                            type="number"
                            min={0}
                            value={row.quantity}
                            disabled={isSaving}
                            onChange={(e) =>
                              setRow(row.key, { quantity: Math.max(0, Number(e.target.value) || 0) })
                            }
                          />
                        </span>
                        <span>
                          <label className="mdv-label" htmlFor={`cost-${row.key}`}>
                            Cost a bottle
                          </label>
                          <input
                            id={`cost-${row.key}`}
                            className="mdv-input"
                            inputMode="decimal"
                            value={row.isSample ? '' : row.cost}
                            disabled={isSaving || row.isSample}
                            placeholder={row.isSample ? 'free sample' : 'leave blank if unknown'}
                            onChange={(e) => setRow(row.key, { cost: e.target.value })}
                          />
                        </span>
                      </span>
                      <span className="mdv-hintline">
                        A blank cost is written as unknown, never as zero. A free sample is written
                        as an explicit zero and excluded from average cost.
                      </span>
                      <span className="mdv-seg" style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          className="mdv-seg__opt"
                          aria-pressed={row.isSample}
                          disabled={isSaving}
                          onClick={() => setRow(row.key, { isSample: !row.isSample })}
                        >
                          Free sample
                        </button>
                        <button
                          type="button"
                          className="mdv-seg__opt"
                          disabled={isSaving}
                          onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                        >
                          Take this line off
                        </button>
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {rows.length > 0 && (
              <span className="mdv-prov">
                {totals.rows} line{totals.rows !== 1 ? 's' : ''} · {totals.bottles} bottle
                {totals.bottles !== 1 ? 's' : ''} · {totals.samples} free sample
                {totals.samples !== 1 ? 's' : ''} · costed lines total{' '}
                {totals.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })} — lines with a
                blank cost add nothing to that figure
              </span>
            )}
          </div>

          {issues.length > 0 && (
            <div className="mdv-alert" role="status">
              <p className="mdv-alert__head">Not ready to record</p>
              {issues.map((issue, i) => (
                <p key={`${issue.key}-${i}`} className="mdv-hintline">
                  {issue.name} — {issue.reason}
                </p>
              ))}
            </div>
          )}

          <div className="mdv-actions">
            <span className="mdv-tally">
              {totals.bottles} bottle{totals.bottles !== 1 ? 's' : ''} to record
            </span>
            <button type="button" className="mdv-btn" onClick={close} disabled={isSaving}>
              Cancel
            </button>
            <button
              type="button"
              className="mdv-btn mdv-btn--seal"
              onClick={() => void save()}
              disabled={isSaving || rows.length === 0 || issues.length > 0}
            >
              {isSaving
                ? 'Recording…'
                : `Record ${totals.bottles} bottle${totals.bottles !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-3"
        onClick={close}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 16 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[94vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-50 to-wine-100 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-wine-600 rounded-xl">
                <Truck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Receive a delivery</h2>
                <p className="text-sm text-gray-500">
                  Stock that arrived without a purchase order — including free samples
                </p>
              </div>
            </div>
            <button onClick={close} disabled={isSaving} className="p-2 hover:bg-white/50 rounded-lg transition-colors disabled:opacity-50">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Receipt-level header: set once, inherited by every new row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-6 py-3 border-b border-gray-100 bg-gray-50/70 flex-shrink-0">
            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-400 mb-1">Provider</label>
              <ThemedSelect
                value={providerId}
                options={providerOptions}
                onChange={setProviderId}
                align="left"
                className="w-full"
                aria-label="Provider for this receipt"
              />
            </div>
            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                Invoice / reference
              </label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. INV-4471, or 'walk-in samples'"
                className="w-full h-[38px] px-3 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-wine-500 focus:ring-2 focus:ring-wine-100"
              />
            </div>
            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                Default location for new rows
              </label>
              <ThemedSelect
                value={defaultLocationId}
                options={locationOptions}
                onChange={setDefaultLocationId}
                align="left"
                className="w-full"
                aria-label="Default storage location for new rows"
              />
            </div>
          </div>

          {/* Add rows */}
          <div className="px-6 py-3 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-start gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[260px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setSearch('') }}
                  placeholder="Search the Master Wine Library to add a line…"
                  className="w-full h-9 pl-9 pr-8 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-wine-500 focus:ring-2 focus:ring-wine-100"
                />
                {search.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-600"
                    aria-label="Clear wine search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                {search.trim().length >= 2 && (
                  <div className="absolute z-40 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-100 rounded-xl shadow-xl">
                    {isSearching && searchResults.length === 0 && (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-gray-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
                      </div>
                    )}
                    {!isSearching && searchResults.length === 0 && (
                      <div className="px-3 py-2.5 text-xs text-gray-500">
                        Nothing in the library matches “{search.trim()}”. Add it as a new wine below.
                      </div>
                    )}
                    {searchResults.map((wine) => {
                      const onReceipt = alreadyOnReceipt.has(wine.id)
                      return (
                        <button
                          key={wine.id}
                          type="button"
                          disabled={onReceipt}
                          onClick={() => addLibraryWine(wine)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white"
                        >
                          <WineIcon className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs font-semibold text-gray-800 truncate">{wine.name}</span>
                            <span className="block text-[11px] text-gray-400 truncate">
                              {[wine.producer, wine.vintage ?? 'NV', wine.region].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          {onReceipt && (
                            <span className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                              <Check className="w-3 h-3" /> on receipt
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowDraftForm((s) => !s)}
                className="h-9 px-3 flex items-center gap-1.5 rounded-lg text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Wine not in the library
              </button>
            </div>

            {showDraftForm && (
              <div className="mt-2 p-3 rounded-xl bg-amber-50/60 border border-amber-100">
                <p className="text-[11px] text-amber-800 mb-2">
                  This creates a provisional Master Library entry so the stock can be tracked now. Name is all that's
                  required — the rest just makes it easier to match up later.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') addDraftWine() }}
                    placeholder="Wine name *"
                    className={`${draftInput} col-span-2`}
                  />
                  <input
                    value={draft.producer}
                    onChange={(e) => setDraft({ ...draft, producer: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') addDraftWine() }}
                    placeholder="Producer"
                    className={draftInput}
                  />
                  <input
                    value={draft.vintage}
                    onChange={(e) => setDraft({ ...draft, vintage: e.target.value.replace(/[^\d]/g, '') })}
                    onKeyDown={(e) => { if (e.key === 'Enter') addDraftWine() }}
                    placeholder="Vintage"
                    className={draftInput}
                  />
                  <input
                    value={draft.region}
                    onChange={(e) => setDraft({ ...draft, region: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') addDraftWine() }}
                    placeholder="Region"
                    className={draftInput}
                  />
                  <input
                    value={draft.grapeVariety}
                    onChange={(e) => setDraft({ ...draft, grapeVariety: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') addDraftWine() }}
                    placeholder="Grape"
                    className={draftInput}
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    value={draft.country}
                    onChange={(e) => setDraft({ ...draft, country: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') addDraftWine() }}
                    placeholder="Country"
                    className={`${draftInput} max-w-[160px]`}
                  />
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => { setDraft(EMPTY_DRAFT); setShowDraftForm(false) }}
                    className="h-8 px-3 rounded-lg text-xs font-semibold text-gray-500 hover:bg-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!draft.name.trim()}
                    onClick={addDraftWine}
                    className="h-8 px-3 rounded-lg text-xs font-bold text-white bg-wine-600 hover:bg-wine-700 disabled:opacity-40"
                  >
                    Add line
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Grid */}
          <div className="flex-1 min-h-0 flex flex-col px-6 py-3">
            {error && (
              <div className="mb-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <BatchReceiveGrid
              rows={rows}
              onChange={setRows}
              disabled={isSaving}
              className="flex-1 min-h-0"
              emptyState={
                <div className="max-w-sm">
                  <PackagePlus className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 font-medium">Nothing on this receipt yet</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Search the library above to add a line, or add a wine the library doesn't have yet. Set the
                    quantity, cost and location per row — or fill them all at once.
                  </p>
                </div>
              }
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 flex-shrink-0">
            <p className="text-xs text-gray-500">
              {providerId
                ? providers.find((p) => p.id === providerId)?.name
                : 'No provider recorded'}
              {reference.trim() ? ` · ${reference.trim()}` : ''}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={close}
                disabled={isSaving}
                className="h-9 px-4 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={isSaving || rows.length === 0 || issues.length > 0}
                className="h-9 px-4 flex items-center gap-1.5 rounded-lg text-xs font-bold text-white bg-wine-600 hover:bg-wine-700 disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
                {isSaving
                  ? 'Recording…'
                  : `Record ${totals.bottles} bottle${totals.bottles !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
