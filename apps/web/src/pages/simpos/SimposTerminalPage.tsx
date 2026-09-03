/**
 * SimPOS terminal — chrome-free fake POS (decisions C26-C30).
 *
 * Two tabs matching the sketch:
 *   Home            — POS pane (open check + Loss) + Menu pane (wine → vintage → size → Add)
 *                     + Edit POS mode (catalog editor / drift generator) + Tables 1-20 (disabled)
 *   Receipts/Invoices — this fake restaurant's procurement_documents
 *
 * "Check logs in full page" opens /simpos/:restaurantId/orders — SimPOS's own
 * order log, distinct from the Mudavym /logs timeline.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  FlaskConical,
  ScrollText,
  X,
} from 'lucide-react'
import {
  simposApi,
  type SimposCatalogItem,
  type SimposCheckLine,
} from '../../services/api/simpos'
import { documentsApi, dashNull } from '../../services/api/documents'
import { cn } from '../../lib/utils'

type Tab = 'home' | 'receipts'

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SimposTerminalPage() {
  const { restaurantId = '' } = useParams<{ restaurantId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('home')
  const [editPos, setEditPos] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed once on mount so a brand-new sim restaurant has a menu to sell.
  useEffect(() => {
    if (!restaurantId) return
    void simposApi.seedCatalog(restaurantId).then(() => {
      void qc.invalidateQueries({ queryKey: ['simpos-catalog', restaurantId] })
    }).catch(() => undefined)
  }, [restaurantId, qc])

  const catalogQuery = useQuery({
    queryKey: ['simpos-catalog', restaurantId],
    queryFn: () => simposApi.listCatalog(restaurantId),
    enabled: !!restaurantId,
  })

  const checkQuery = useQuery({
    queryKey: ['simpos-check', restaurantId],
    queryFn: () => simposApi.getOrCreateOpenCheck(restaurantId),
    enabled: !!restaurantId && tab === 'home',
    refetchInterval: 5_000,
  })

  const tablesQuery = useQuery({
    queryKey: ['simpos-tables', restaurantId],
    queryFn: () => simposApi.listTables(restaurantId),
    enabled: !!restaurantId && tab === 'home',
  })

  const receiptsQuery = useQuery({
    queryKey: ['simpos-receipts', restaurantId],
    queryFn: () => documentsApi.list({ limit: 50 }),
    enabled: !!restaurantId && tab === 'receipts',
  })

  const check = checkQuery.data
  const catalog = catalogQuery.data ?? []

  const wines = useMemo(() => {
    const byName = new Map<string, SimposCatalogItem[]>()
    for (const item of catalog) {
      const arr = byName.get(item.wine_name) ?? []
      arr.push(item)
      byName.set(item.wine_name, arr)
    }
    return Array.from(byName.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [catalog])

  const refreshCheck = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['simpos-check', restaurantId] })
  }, [qc, restaurantId])

  const handleAdd = async (catalogId: string) => {
    if (!check) return
    setBusy(true)
    setError(null)
    try {
      await simposApi.addLine(restaurantId, check.id, catalogId, 1)
      await refreshCheck()
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Add failed')
    } finally {
      setBusy(false)
    }
  }

  const handleVoid = async (line: SimposCheckLine) => {
    setBusy(true)
    setError(null)
    try {
      await simposApi.setLineStatus(restaurantId, line.id, {
        status: line.status === 'voided' ? 'active' : 'voided',
        reason: 'voided from terminal',
      })
      await refreshCheck()
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Void failed')
    } finally {
      setBusy(false)
    }
  }

  const handleOrder = async () => {
    if (!check) return
    setBusy(true)
    setError(null)
    try {
      const result = await simposApi.closeCheck(restaurantId, check.id)
      if (!result.webhook?.ok) {
        setError(result.webhook?.error || 'Webhook delivery failed')
      }
      await refreshCheck()
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Order failed')
    } finally {
      setBusy(false)
    }
  }

  if (!restaurantId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
        Missing restaurant id
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Top nav — Home / Receipts-Invoices */}
      <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-4">
        <span className="text-xs font-bold tracking-widest text-amber-400 uppercase">
          SimPOS
        </span>
        <nav className="flex gap-1">
          {([
            ['home', 'Home'],
            ['receipts', 'Receipts / Invoices'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-3 h-8 rounded-md text-xs font-bold',
                tab === key
                  ? 'bg-amber-500 text-gray-950'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {tab === 'home' && (
            <button
              onClick={() => setEditPos((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-bold border',
                editPos
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'border-gray-700 text-gray-400 hover:bg-gray-800',
              )}
            >
              <Pencil className="w-3 h-3" />
              Edit POS
            </button>
          )}
          <Link
            to={`/simpos/${restaurantId}/orders`}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-bold border border-gray-700 text-gray-400 hover:bg-gray-800"
          >
            <ScrollText className="w-3 h-3" />
            Check logs in full page
          </Link>
          <Link
            to={`/simpos/${restaurantId}/scenarios`}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-bold border border-gray-700 text-gray-400 hover:bg-gray-800"
          >
            <FlaskConical className="w-3 h-3" />
            Scenarios
          </Link>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-rose-950 border border-rose-800 text-rose-200 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {tab === 'home' ? (
        <div className="flex-1 flex flex-col gap-4 p-4 max-w-5xl mx-auto w-full">
          {/* Tables 1-20 — visible, disabled, future (C29) */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 opacity-50 pointer-events-none select-none">
            {(tablesQuery.data?.length
              ? tablesQuery.data
              : Array.from({ length: 20 }, (_, i) => ({
                  id: `t${i + 1}`,
                  table_number: i + 1,
                  label: null,
                }))
            ).map((t) => (
              <div
                key={t.id}
                className="shrink-0 w-10 h-10 rounded-lg border border-gray-700 bg-gray-900 flex items-center justify-center text-[11px] font-bold text-gray-500"
              >
                {t.table_number}
              </div>
            ))}
            <span className="self-center text-[10px] text-gray-600 ml-2 whitespace-nowrap">
              Tables — coming soon
            </span>
          </div>

          {/* POS pane */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">
                  Open check
                </h2>
                <p className="text-[11px] text-gray-600 font-mono mt-0.5">
                  {check?.id?.slice(0, 8) ?? '…'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-rose-400 font-bold">
                  Loss
                </p>
                <p className="text-lg font-mono font-bold text-rose-300 tabular-nums">
                  {fmtMoney(check?.lossTotal ?? 0)}
                </p>
              </div>
            </div>

            <ul className="divide-y divide-gray-800 max-h-56 overflow-y-auto font-mono text-sm">
              {!check || (check.lines?.length ?? 0) === 0 ? (
                <li className="px-4 py-8 text-center text-xs text-gray-600">
                  No items — pick from the menu below
                </li>
              ) : (
                (check.lines ?? []).map((l) => (
                  <li
                    key={l.id}
                    className={cn(
                      'px-4 py-2.5 flex items-center gap-3',
                      l.status !== 'active' && 'opacity-50 line-through',
                    )}
                  >
                    <span className="flex-1 truncate">{l.item_name_snapshot}</span>
                    <span className="text-gray-500 text-[11px]">{fmtTime(l.added_at)}</span>
                    <span className="tabular-nums w-16 text-right">
                      {fmtMoney(Number(l.unit_price_snapshot) * Number(l.qty))}
                    </span>
                    <button
                      onClick={() => void handleVoid(l)}
                      disabled={busy}
                      className="text-[10px] font-bold uppercase text-rose-400 hover:text-rose-300"
                    >
                      {l.status === 'voided' ? 'Undo' : 'Void'}
                    </button>
                  </li>
                ))
              )}
            </ul>

            <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {(check?.lines?.filter((l) => l.status === 'active').length ?? 0)} active line(s)
              </p>
              <button
                onClick={() => void handleOrder()}
                disabled={busy || !check || (check.lines ?? []).every((l) => l.status !== 'active')}
                className="flex items-center gap-1.5 h-10 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 text-sm font-bold disabled:opacity-40"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Order
              </button>
            </div>
          </section>

          {/* Menu pane OR Edit POS */}
          {editPos ? (
            <EditPosPane
              restaurantId={restaurantId}
              catalog={catalog}
              onChanged={() =>
                void qc.invalidateQueries({ queryKey: ['simpos-catalog', restaurantId] })
              }
            />
          ) : (
            <MenuPane wines={wines} onAdd={(id) => void handleAdd(id)} busy={busy} />
          )}
        </div>
      ) : (
        <div className="flex-1 p-4 max-w-5xl mx-auto w-full">
          <SimposReceiptsPane
            docs={receiptsQuery.data ?? []}
            loading={receiptsQuery.isLoading}
          />
        </div>
      )}

      <footer className="border-t border-gray-800 px-4 py-2 text-[10px] text-gray-600 flex justify-between">
        <span>Synthetic test fixture — not a Mudavym feature</span>
        <button
          onClick={() => navigate('/')}
          className="hover:text-gray-400"
        >
          Exit to Mudavym
        </button>
      </footer>
    </div>
  )
}

function MenuPane({
  wines,
  onAdd,
  busy,
}: {
  wines: [string, SimposCatalogItem[]][]
  onAdd: (catalogId: string) => void
  busy: boolean
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pickedVintage, setPickedVintage] = useState<number | null>(null)
  const [pickedSku, setPickedSku] = useState<string | null>(null)

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">
          Menu
        </h2>
      </div>
      <ul className="divide-y divide-gray-800 max-h-[50vh] overflow-y-auto">
        {wines.length === 0 ? (
          <li className="px-4 py-8 text-center text-xs text-gray-600">
            Catalog empty — seed from inventory or use Edit POS
          </li>
        ) : (
          wines.map(([name, skus]) => {
            const open = expanded === name
            const vintages = Array.from(
              new Set(skus.map((s) => s.vintage).filter((v): v is number => v != null)),
            ).sort((a, b) => b - a)
            const sizesForVintage = skus.filter(
              (s) => (pickedVintage == null ? true : s.vintage === pickedVintage),
            )
            return (
              <li key={name}>
                <button
                  onClick={() => {
                    setExpanded(open ? null : name)
                    setPickedVintage(null)
                    setPickedSku(null)
                  }}
                  className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-gray-800/50"
                >
                  {open ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                  )}
                  <span className="flex-1 text-sm font-semibold">{name}</span>
                  <span className="text-[11px] text-gray-500">{skus.length} SKU(s)</span>
                </button>
                {open && (
                  <div className="px-4 pb-3 space-y-2.5 bg-gray-950/40">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px] uppercase text-gray-500 self-center mr-1">
                        Vintage
                      </span>
                      {vintages.length === 0 ? (
                        <span className="text-[11px] text-gray-600">NV</span>
                      ) : (
                        vintages.map((v) => (
                          <button
                            key={v}
                            onClick={() => {
                              setPickedVintage(v)
                              setPickedSku(null)
                            }}
                            className={cn(
                              'h-7 px-2.5 rounded-md text-[11px] font-bold border',
                              pickedVintage === v
                                ? 'bg-amber-500 text-gray-950 border-amber-500'
                                : 'border-gray-700 text-gray-300 hover:bg-gray-800',
                            )}
                          >
                            {v}
                          </button>
                        ))
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px] uppercase text-gray-500 self-center mr-1">
                        Size
                      </span>
                      {sizesForVintage.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setPickedSku(s.id)}
                          className={cn(
                            'h-7 px-2.5 rounded-md text-[11px] font-bold border',
                            pickedSku === s.id
                              ? 'bg-amber-500 text-gray-950 border-amber-500'
                              : 'border-gray-700 text-gray-300 hover:bg-gray-800',
                          )}
                        >
                          {s.size_ml}ml · {fmtMoney(s.price)}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => pickedSku && onAdd(pickedSku)}
                      disabled={!pickedSku || busy}
                      className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-gray-100 text-gray-950 text-xs font-bold disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add item
                    </button>
                  </div>
                )}
              </li>
            )
          })
        )}
      </ul>
    </section>
  )
}

function EditPosPane({
  restaurantId,
  catalog,
  onChanged,
}: {
  restaurantId: string
  catalog: SimposCatalogItem[]
  onChanged: () => void
}) {
  const [form, setForm] = useState({
    wineName: '',
    producer: '',
    vintage: '',
    sizeMl: '750',
    price: '',
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!form.wineName || !form.price) return
    setBusy(true)
    try {
      await simposApi.upsertCatalogItem(restaurantId, {
        wineName: form.wineName,
        producer: form.producer || null,
        vintage: form.vintage ? Number(form.vintage) : null,
        sizeMl: Number(form.sizeMl) || 750,
        price: Number(form.price),
      })
      setForm({ wineName: '', producer: '', vintage: '', sizeMl: '750', price: '' })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await simposApi.removeCatalogItem(restaurantId, id)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-gray-900 border border-amber-900/40 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-xs font-bold uppercase tracking-wide text-amber-400">
          Edit POS — drift generator
        </h2>
        <p className="text-[10px] text-gray-500 mt-0.5">
          Changes here diverge from Mudavym inventory. The drift agent finds them.
        </p>
      </div>

      <div className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
        {(
          [
            ['wineName', 'Wine name', 'text'],
            ['producer', 'Producer', 'text'],
            ['vintage', 'Vintage', 'number'],
            ['sizeMl', 'Size ml', 'number'],
            ['price', 'Price', 'number'],
          ] as const
        ).map(([key, label, type]) => (
          <label key={key} className="text-[10px] text-gray-500 space-y-1">
            <span>{label}</span>
            <input
              type={type}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="w-full h-9 px-2 rounded-lg bg-gray-950 border border-gray-700 text-sm text-gray-100"
            />
          </label>
        ))}
      </div>
      <div className="px-4 pb-3">
        <button
          onClick={() => void save()}
          disabled={busy || !form.wineName || !form.price}
          className="h-9 px-4 rounded-lg bg-amber-500 text-gray-950 text-xs font-bold disabled:opacity-40"
        >
          Add / reprice SKU
        </button>
      </div>

      <ul className="divide-y divide-gray-800 max-h-48 overflow-y-auto border-t border-gray-800">
        {catalog.map((c) => (
          <li key={c.id} className="px-4 py-2 flex items-center gap-2 text-xs">
            <span className="flex-1 truncate">
              {c.wine_name}
              {c.vintage ? ` ${c.vintage}` : ''} · {c.size_ml}ml
            </span>
            <span className="font-mono tabular-nums">{fmtMoney(c.price)}</span>
            <button
              onClick={() => void remove(c.id)}
              disabled={busy}
              className="text-rose-400 hover:text-rose-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SimposReceiptsPane({
  docs,
  loading,
}: {
  docs: Awaited<ReturnType<typeof documentsApi.list>>
  loading: boolean
}) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">
          Receipts / Invoices
        </h2>
        <p className="text-[10px] text-gray-500 mt-0.5">
          Documents this fake restaurant has generated — viewed from its own side
        </p>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-600">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : docs.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-gray-600">
          No documents yet
        </div>
      ) : (
        <ul className="divide-y divide-gray-800">
          {docs.map((d) => (
            <li key={d.id} className="px-4 py-3 flex items-center gap-3 text-xs">
              <span className="capitalize font-semibold">{d.doc_type.replace('_', ' ')}</span>
              <span className="text-gray-500">{dashNull(d.doc_number)}</span>
              <span className="text-gray-600 ml-auto">{d.status}</span>
              <span className="font-mono tabular-nums w-20 text-right">
                {d.total == null ? '—' : fmtMoney(d.total)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default SimposTerminalPage
