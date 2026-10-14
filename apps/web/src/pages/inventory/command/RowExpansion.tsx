/**
 * Expanded row detail — the 3a "reconcile-first" panel.
 * Cards: Live vs Shadow, Par & Reorder, Market price, Velocity 14d,
 * Busy-hours heatmap, Order history. Action bar: manual adjust (ledger
 * reconcile), transfer between locations, ledger link.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adjustStock, getItemActivity, recordPour, reconcileShadowItem, transferStock, fetchAuctionLotRecords, updateInventoryItem } from '../../../services/api/inventory'
import { getOrderBook } from '../../../services/api/orders'
import { invalidateZoneCounts, type StorageLocation } from '../../../hooks/useStorageLocations'
import { useNotificationStore } from '../../../stores'
import { ThemedSelect } from '../../../components/ui/ThemedSelect'
import { MultiLocationCell } from '../../../components/inventory/MultiLocationCell'
import { formatVolume } from '../../../utils/volumeUtils'
import { useRestaurantSettingsStore } from '../../../stores/restaurantSettingsStore'
import { cn } from '../../../lib/utils'
import { recordedCost, type InventoryItem } from '../useInventoryPage'
import { useMudavymDesign } from '../../../lib/mudavym/useMudavymDesign'
import { fmtMoneyExact, fmtOneDecimal, marketDeltaPct, daysSinceCounted, shelfCountLine, HoursHeatmap, runwayDays, reorderAdvice, velocityLabel, ASSUMED_LEAD_DAYS } from './bits'
import { getHouseLocale } from '../../../lib/houseCurrency'
import { ReceiptDepth } from './ReceiptDepth'
import { SpotCountPanel, shelvesFor } from './SpotCountPanel'
import { NameThisWine } from './NameThisWine'
import { newClientCountId } from '../../../lib/spotCountOutbox'
import { getActiveRestaurantId } from '../../../services/api/client'
import SoldOutControl from '../../cellar/next/SoldOutControl'

/** Ordered and not yet in the cellar, from awaiting approval to on the truck (F-630). */
const NOT_YET_ARRIVED = ['PENDING', 'APPROVAL_NEEDED', 'NEGOTIATING', 'APPROVED', 'CONFIRMED', 'IN_TRANSIT']

const wholeBottles = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null)

/**
 * Bottles an order still owes, or null when that cannot be counted (F-1540).
 * A not-yet-arrived order owes its bottles. A partly received one owes its
 * backorder: ordered less what the shelf holds, less what was refused at the
 * door or at the check — refused bottles were delivered and are a claim
 * against the vendor, not bottles on their way (the gateway's close-short
 * reads it the same way). Anything else owes none.
 */
function stillOwedBottles(o: any): number | null {
  const status = String(o?.status)
  if (NOT_YET_ARRIVED.includes(status)) return Number(o.bottlesTotal) > 0 ? Number(o.bottlesTotal) : null
  if (status !== 'PARTIALLY_RECEIVED') return 0
  const r = o?.received
  const backorder = wholeBottles(r?.backorderBottles)
  const doorRefused = wholeBottles(r?.rejectedAtDoorBottles)
  const deskRefused = r?.rejectedAtDeskBottles == null ? 0 : wholeBottles(r.rejectedAtDeskBottles)
  if (r?.readable !== true || backorder == null || doorRefused == null || deskRefused == null) return null
  return Math.max(0, backorder - doorRefused - deskRefused)
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <h5 className="flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider text-gray-400 mb-3">
        {title}
        {right}
      </h5>
      {children}
    </div>
  )
}

function KV({ k, v, tone }: { k: string; v: React.ReactNode; tone?: 'green' | 'amber' | 'blue' }) {
  const tones = { green: 'text-emerald-600', amber: 'text-amber-600', blue: 'text-blue-600' }
  return (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="text-gray-500">{k}</span>
      <span className={cn('font-mono font-semibold', tone ? tones[tone] : 'text-gray-700')}>{v}</span>
    </div>
  )
}

/** A read that did not answer, worded the way ReceiptDepth says it (F-705). */
function ReadFailed({ what, retry }: { what: string; retry: () => void }) {
  return (
    <p className="text-[11px] text-gray-500">
      The {what} for this wine could not be read just now — this is not an empty history.{' '}
      <button onClick={retry} className="text-blue-600 font-semibold">
        Try again
      </button>
    </p>
  )
}

const ADJUST_REASONS = [
  { value: 'Count correction', label: 'Count correction' },
  { value: 'Breakage', label: 'Breakage' },
  { value: 'Comp / gift', label: 'Comp / gift' },
  { value: 'Staff pour', label: 'Staff pour' },
  { value: 'Return to vendor', label: 'Return to vendor' },
]

/**
 * Reasons that only ever take bottles off (F-1163): a "+1 Breakage" put a
 * bottle on the books. The gateway refuses the same, in the same words.
 */
const TAKE_OFF_ONLY: Record<string, string> = {
  Breakage: 'Breakage',
  'Comp / gift': 'A comp',
  'Staff pour': 'A staff pour',
}

export function RowExpansion({
  item,
  locations,
  seesCost = true,
  // The page's seesCost IS its owner-or-manager signal (InventoryCommandPage:
  // seesCost = canEditPrice), so the par control follows it unless told.
  canSetPar = seesCost,
  startCounting = false,
}: {
  item: InventoryItem
  locations: StorageLocation[]
  /** False for a reader the gateway sends no cost (staff, ADR 0145): no "You paid" line. */
  seesCost?: boolean
  /** An owner or a manager: may change this wine's par here (F-1064). The gateway refuses anyone else. */
  canSetPar?: boolean
  /** Open with the spot count up (`/inventory?count=<id>`, F-831). */
  startCounting?: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  // Volumes render in the unit the restaurant chose in Settings. `/inventory-legacy`
  // honoured this setting and `/inventory` did not, so retiring that page silently
  // pinned an oz restaurant back to ml. Restored with the retirement (ADR 0019 §B).
  const measurementUnit = useRestaurantSettingsStore((s) => s.measurementUnit)
  const inventoryId = item.inventoryId || ''
  // The founder's named gap: receipt/invoice depth in the dropdown, gated so
  // the kept page renders byte-identically until the flag flips (ADR 0045 §5).
  const receiptDepthOn = useMudavymDesign('inventory')

  const [delta, setDelta] = useState(0)
  const [reason, setReason] = useState('Count correction')
  const [showSpotCount, setShowSpotCount] = useState(startCounting)
  const [pouring, setPouring] = useState(false)
  // F-1163: the place a manual adjust or a pour comes off, picked the way the
  // spot count picks its shelf. Unpicked, the bottle came off the oldest lot
  // anywhere -- a bottle broken at the bar was taken out of the cellar.
  const { shelves, picksShelf } = shelvesFor(item, locations)
  const [shelfId, setShelfId] = useState('')
  // F-1271: a take-off or a pour is offered only the shelves that hold this
  // wine, each with its count; bottles found may go onto any shelf.
  const shelfQty = (id: string) =>
    (item.locations ?? []).filter((l) => l.locationId === id).reduce((n, l) => n + l.qty, 0)
  const offeredShelves = delta > 0 ? shelves : shelves.filter((l) => shelfQty(l.id) > 0)
  const asksShelf = picksShelf && offeredShelves.length > 0
  const shelfMissing = asksShelf && !offeredShelves.some((l) => l.id === shelfId)
  const shelfPicked = asksShelf && !shelfMissing ? shelfId : null
  // More off one shelf than it holds would come off other shelves unsaid.
  const overShelf = shelfPicked != null && delta < 0 && -delta > shelfQty(shelfPicked)
  // The per-wine par, through the same PATCH the add path's thresholdMin uses (F-1064, F-075).
  const [parDraft, setParDraft] = useState<string | null>(null)

  // F-705: a read that failed or has not answered is said as such — never
  // drawn as an empty history ("No orders for this wine yet").
  const activityQ = useQuery({
    queryKey: ['inventory', 'activity', inventoryId],
    queryFn: () => getItemActivity(inventoryId),
    enabled: !!inventoryId,
    staleTime: 5 * 60_000,
  })
  const activity = activityQ.data

  // This wine's orders, every page (F-1538): the house's newest 50 left an
  // older wine's On order, history and suggestion short.
  const ordersQ = useQuery({
    queryKey: ['orders', 'for-item', inventoryId],
    queryFn: () => getOrderBook({ inventoryId }),
    enabled: !!inventoryId,
    staleTime: 60_000,
    select: (all) => (all || []).filter((o: any) => o.inventoryId === inventoryId),
  })
  const itemOrders = ordersQ.data ?? []
  const ordersUnread = ordersQ.isError
  const ordersRead = ordersQ.isSuccess
  const orders = itemOrders.slice(0, 4)
  // Bottles ordered and not here yet (F-630 sibling), a partly received
  // order's backorder included (F-1540). null = cannot be counted: the orders
  // could not be read, or an open order's bottles cannot be counted.
  const owed = itemOrders.map(stillOwedBottles)
  const onOrder: number | null =
    ordersUnread || !ordersRead || owed.some((n) => n == null)
      ? null
      : owed.reduce((sum: number, n) => sum + (n as number), 0)

  // An auction lot's own details, kept (founder, 2026-09-21) — see
  // AuctionLotStart.tsx's header for the full case.
  const { data: auctionLots = [] } = useQuery({
    queryKey: ['inventory', 'auction-lots', inventoryId],
    queryFn: () => fetchAuctionLotRecords(inventoryId),
    enabled: !!inventoryId,
    staleTime: 60_000,
  })

  // Every change here moves bottles on a shelf, and every zone count reads the
  // shelves' lots (F-1331), so the zone list and the cellar floor refetch too.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] })
    invalidateZoneCounts(queryClient)
  }

  // F-1166: the server reads the shadow and moves exactly that many (live +N,
  // shadow -N). Sending a count of live + shadow raised live and left shadow,
  // so on hand grew by N on every press.
  const reconcile = useMutation({
    mutationFn: () => reconcileShadowItem(inventoryId),
    onSuccess: (r) => {
      invalidate()
      toast.success(r.moved > 0 ? `${r.moved} bottle${r.moved === 1 ? '' : 's'} moved onto the shelf` : 'Nothing left to move')
      setDelta(0)
    },
    onError: (e: any) => toast.error('Not moved', e?.response?.data?.message || e?.message),
  })

  const setPar = useMutation({
    mutationFn: (thresholdMin: number) => updateInventoryItem(inventoryId, { thresholdMin }),
    onSuccess: () => {
      invalidate()
      toast.success('Par saved')
      setParDraft(null)
    },
    onError: (e: any) => toast.error('Par not saved', e?.response?.data?.message || e?.message),
  })
  const parValue = parDraft == null ? null : Number(parDraft)
  const parValid = parValue != null && parDraft !== '' && Number.isInteger(parValue) && parValue >= 0 && parValue <= 999

  // Manual adjust sends the change, not a new total (F-292). A total built from
  // the list's cached stock (refreshed once a minute) lost a second manager's
  // "-1 Breakage" and put back bottles the till had sold since the page loaded.
  const adjust = useMutation({
    mutationFn: (p: { quantityChange: number; reason: string }) =>
      adjustStock(inventoryId, {
        wineId: item.id || undefined,
        quantityChange: p.quantityChange,
        reason: p.reason,
        // A take-off leaves FROM the shelf; bottles found go TO it.
        ...(shelfPicked ? { [p.quantityChange < 0 ? 'fromLocationId' : 'toLocationId']: shelfPicked } : {}),
        idempotencyKey: `adjust:${inventoryId}:${newClientCountId()}`,
      }),
    onSuccess: () => {
      invalidate()
      toast.success('Ledger updated')
      setDelta(0)
    },
    onError: (e: any) => toast.error('Adjustment failed', e?.response?.data?.message || e?.message),
  })

  /**
   * A wine can sit in several locations at once (lots are the source of truth), so a
   * move has to name where the bottles are leaving from. This used to hard-code
   * `fromLocationId: null`, which told the server "take them from unassigned stock"
   * no matter which shelf the manager meant.
   */
  const doTransfer = async (fromLocationId: string | null, toLocationId: string, qty: number) => {
    try {
      await transferStock(inventoryId, { fromLocationId, toLocationId, qty, reason: 'manual transfer' })
      invalidate()
      toast.success(`Moved ${qty} bottle${qty === 1 ? '' : 's'}`)
    } catch (e: any) {
      toast.error('Transfer failed', e?.response?.data?.message || e?.message)
      throw e
    }
  }

  const pour = async () => {
    setPouring(true)
    try {
      await recordPour(inventoryId, {
        pours: 1,
        source: 'manual',
        reason: 'manual pour',
        ...(shelfPicked ? { locationId: shelfPicked } : {}),
      })
      invalidate()
      toast.success('Pour recorded')
    } catch (e: any) {
      toast.error('Pour failed', e?.response?.data?.message || e?.message)
    } finally {
      setPouring(false)
    }
  }

  const addsOnTakeOff = delta > 0 && reason in TAKE_OFF_ONLY
  const live = item.liveStock ?? 0
  const shadow = item.shadowStock ?? 0
  // What the house paid, never the library's price (F-1311).
  const paid = recordedCost(item)
  const menuBottle = item.menuPriceBottle
  const delta$ = marketDeltaPct(item)
  const counted = daysSinceCounted(item)
  // F-1165: a count of one shelf is that shelf's, not the whole wine's.
  const shelfCounted = shelfCountLine(item, activity?.shelfCounts, locations)
  const run = runwayDays(item)
  const velocity = item.velocityPerDay
  const { suggested, reorderPoint } = reorderAdvice(item, onOrder)

  const daily = activity?.daily ?? []
  // F-1595: the card is sales; a shelf move or a broken bottle is not one.
  const maxDaily = Math.max(1, ...daily.map((d) => d.sold ?? 0))

  return (
    <div className="bg-gray-50/70 border-b border-gray-100 px-6 py-4">
      {/* A wine whose name cannot say which wine it is (founder, 2026-09-21). */}
      <NameThisWine inventoryId={item.inventoryId} currentName={item.name} />
      {/* F-145 (S195): a drink is 86'd here as on the cellar's bottle leaf. */}
      {inventoryId && <SoldOutControl restaurantId={getActiveRestaurantId() || null} inventoryId={inventoryId} />}
      {/* info strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-3.5 mb-3.5 border-b border-gray-100">
        {[
          ['Grape', item.grape || 'Unknown'],
          ['Region', item.region || 'Unknown'],
          ['Format', formatVolume(item.bottleSizeMl ?? 750, measurementUnit)],
          ['Vintage', item.vintage || 'NV'],
        ].map(([k, v]) => (
          <div key={k as string} className="text-[11px] text-gray-400">
            {k}
            <b className="block text-xs text-gray-700 font-semibold mt-px">{v}</b>
          </div>
        ))}
        <div className="text-[11px] text-gray-400">
          Last counted
          <b className={cn('block text-xs font-semibold mt-px', counted != null && counted <= 21 ? 'text-gray-700' : 'text-amber-600')}>
            {counted == null ? 'never' : `${counted} days ago`}
          </b>
          {shelfCounted && <span className="block text-[11px] text-gray-500 mt-px">{shelfCounted}</span>}
        </div>
        {(item.openMl ?? 0) > 0 && (
          <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-3 py-1">
            {/* In the house's unit, as the count panel says it (F-1543). */}
            Open bottle: <b className="font-mono text-gray-700">{formatVolume(item.openMl ?? 0, measurementUnit)} left</b>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        {/* live vs shadow */}
        <Card title="Live vs shadow">
          <div className="flex items-stretch gap-2.5">
            <div className="flex-1 text-center py-2.5 rounded-lg bg-blue-50">
              <div className="font-mono text-xl font-bold text-blue-600">{live}</div>
              <div className="text-[10.5px] font-semibold text-blue-600 mt-0.5">Live count</div>
            </div>
            <div className="flex items-center text-[11px] font-bold text-gray-300">vs</div>
            <div className="flex-1 text-center py-2.5 rounded-lg bg-violet-50">
              <div className="font-mono text-xl font-bold text-violet-600">{shadow}</div>
              <div className="text-[10.5px] font-semibold text-violet-600 mt-0.5">Shadow count</div>
            </div>
          </div>
          {shadow > 0 ? (
            <button
              onClick={() => reconcile.mutate()}
              disabled={reconcile.isPending}
              className="w-full mt-3 h-9 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg disabled:opacity-60"
            >
              Reconcile {shadow} bottle{shadow === 1 ? '' : 's'} into live
            </button>
          ) : (
            <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">Live and shadow are in sync. No reconciliation needed.</p>
          )}
        </Card>

        {/* par & reorder */}
        <Card title="Par and reorder">
          {parDraft == null ? (
            <div className="flex items-center py-1.5 text-xs">
              <span className="flex-1 text-gray-500">Par</span>
              <span className="font-mono font-semibold text-gray-700">
                {item.threshold != null ? `${item.threshold} btl` : 'not set'}
              </span>
              {canSetPar && inventoryId && (
                <button
                  type="button"
                  onClick={() => setParDraft(String(item.threshold ?? ''))}
                  className="ml-2 text-[11px] font-semibold text-blue-600"
                >
                  {item.threshold != null ? 'Change' : 'Set'}
                </button>
              )}
            </div>
          ) : (
            <form
              className="flex items-center gap-2 py-1.5 text-xs"
              onSubmit={(e) => {
                e.preventDefault()
                if (parValid && parValue != null) setPar.mutate(parValue)
              }}
            >
              <label className="flex flex-1 items-center justify-between gap-2 text-gray-500">
                Par
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label="Par for this wine"
                  min={0}
                  max={999}
                  autoFocus
                  value={parDraft}
                  onChange={(e) => setParDraft(e.target.value)}
                  className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-right font-mono text-gray-700"
                />
              </label>
              <button
                type="submit"
                disabled={!parValid || setPar.isPending}
                className="font-semibold text-blue-600 disabled:opacity-40"
              >
                {setPar.isPending ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setParDraft(null)} className="text-gray-500">
                Cancel
              </button>
            </form>
          )}
          <KV
            k="Selling"
            v={
              velocity == null
                ? item.analyticsReadable === false ? 'could not be read' : '—'
                : item.velocityFromTill
                  ? // F-1516: the stock was here before the till began.
                    `${item.velocityIsNew ? 'early, ' : ''}${fmtOneDecimal(velocity)} btl/day over ${item.velocityDays} day${item.velocityDays === 1 ? '' : 's'} since the till's first sale`
                  : item.velocityIsNew
                    ? `new, ${fmtOneDecimal(velocity)} btl/day over ${item.velocityDays} day${item.velocityDays === 1 ? '' : 's'}`
                    : velocityLabel(item)
            }
          />
          <KV k="On order, not here yet" v={onOrder == null ? (ordersUnread ? 'could not be read' : ordersRead ? 'could not be counted' : '—') : `${onOrder} btl`} />
          <KV k="Suggested order" v={suggested == null ? 'set a par to get one' : `${suggested} btl`} />
          <KV k="Covers" v={run != null && velocity && suggested != null ? `${Math.round((live + (onOrder ?? 0) + suggested) / velocity)} days at this rate` : 'n/a'} />
          <KV k="Reorder point" v={reorderPoint == null ? 'n/a' : `${reorderPoint} btl (${ASSUMED_LEAD_DAYS}-day delivery wait)`} />
          <KV k="Runway now" v={run == null ? 'n/a' : `${Math.round(run)} day${Math.round(run) === 1 ? '' : 's'}`} tone={run != null && run <= 5 ? 'amber' : undefined} />
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
            {velocity == null
              ? 'From par alone, '
              : item.velocityFromTill
                ? `From the ${item.velocityDays} day${item.velocityDays === 1 ? '' : 's'} since the till's first sale, `
                : `From the last ${item.velocityDays ?? 30} days of sales, `}
            an assumed {ASSUMED_LEAD_DAYS}-day delivery wait and two more weeks on the shelf, less bottles already on order.
            Reports, What to buy back, uses 90 days of sales, a 7-day wait and a safety margin, so its answer can differ.
          </p>
          <button
            onClick={() =>
              navigate(
                suggested
                  ? `/orders?draft=new&inventoryId=${inventoryId}&qty=${suggested}`
                  : `/orders?draft=new&inventoryId=${inventoryId}`,
              )
            }
            className="w-full mt-2.5 h-9 bg-wine-600 hover:bg-wine-700 text-white text-xs font-bold rounded-lg"
          >
            {suggested ? `Draft order, ${suggested} btl` : 'Draft an order'}
          </button>
        </Card>

        {/* market price */}
        <Card
          title="Market price"
          right={
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 normal-case tracking-normal">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              feed {item.marketPrice ? 'connected' : 'no data'}
            </span>
          }
        >
          <KV k={`Market avg (${formatVolume(item.bottleSizeMl ?? 750, measurementUnit)})`} v={fmtMoneyExact(item.marketPrice)} />
          {seesCost && <KV k="You paid (WAC)" v={paid == null ? 'no cost recorded' : fmtMoneyExact(paid)} />}
          <KV
            k="Delta"
            v={delta$ == null ? 'n/a' : `${delta$ > 0 ? '+' : ''}${delta$.toFixed(0)}%${delta$ >= 15 ? ', appreciating, hold' : delta$ <= -5 ? ', re-quote vendor' : ''}`}
            tone={delta$ != null && delta$ > 0 ? 'green' : 'amber'}
          />
          {/* The house's own bottle price (ADR 0193), the figure the row's
              price cell shows. `menuPrice` is the library wine's and is never
              set for a house row, so this said "not set" on every row (F-390). */}
          <KV k="Menu price" v={menuBottle ? `${fmtMoneyExact(menuBottle)}${paid ? ` (${fmtOneDecimal(menuBottle / paid)}x)` : ''}` : 'not set'} tone="blue" />
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
            Alerts fire when a vendor quote exceeds market or margin slips under 1.8x.
          </p>
        </Card>

        {/* velocity 14d */}
        <Card title="Velocity, last 14 days">
          {activityQ.isError ? (
            <ReadFailed what="sales" retry={() => void activityQ.refetch()} />
          ) : activityQ.isLoading ? (
            <p className="text-[11px] text-gray-400">Reading sales…</p>
          ) : daily.length > 0 ? (
            <>
              <div className="flex items-end gap-1 h-16">
                {daily.map((d) => {
                  const sold = d.sold ?? 0
                  return (
                    <i
                      key={d.date}
                      title={`${d.date}: ${sold} sold`}
                      className={cn('flex-1 rounded-t', sold >= maxDaily * 0.75 ? 'bg-blue-600' : 'bg-blue-100')}
                      style={{ height: `${Math.max((sold / maxDaily) * 100, 4)}%` }}
                    />
                  )
                })}
              </div>
              <div className="flex justify-between font-mono text-[9px] text-gray-400 mt-1.5">
                <span>{daily[0]?.date.slice(5)}</span>
                <span>{daily[daily.length - 1]?.date.slice(5)}</span>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-gray-400">No sales recorded yet.</p>
          )}
          <KV k="Current velocity" v={velocityLabel(item)} />
        </Card>

        {/* busy hours */}
        <Card title="When it sells">
          {activityQ.isError ? (
            <ReadFailed what="sales" retry={() => void activityQ.refetch()} />
          ) : activityQ.isLoading ? (
            <p className="text-[11px] text-gray-400">Reading sales…</p>
          ) : activity?.heat?.length ? (
            <HoursHeatmap heat={activity.heat} />
          ) : (
            <p className="text-[11px] text-gray-400">Heatmap builds as POS sales come in.</p>
          )}
        </Card>

        {/* order history */}
        <Card title="Order history">
          {ordersQ.isError ? (
            <ReadFailed what="orders" retry={() => void ordersQ.refetch()} />
          ) : ordersQ.isLoading ? (
            <p className="text-[11px] text-gray-400">Reading orders…</p>
          ) : orders.length === 0 ? (
            <p className="text-[11px] text-gray-400">No orders for this wine yet.</p>
          ) : (
            <div>
              {orders.map((o: any) => (
                <div key={o.id} className="flex items-center gap-2.5 py-1.5 border-t border-gray-50 first:border-t-0 text-xs">
                  <span className="font-mono text-[11px] font-bold text-gray-700 w-16 truncate">{o.orderNumber || o.id.slice(0, 8)}</span>
                  <span className="flex-1 text-gray-500 truncate">
                    {o.createdAt ? new Date(o.createdAt).toLocaleDateString(getHouseLocale(), { month: 'numeric', day: 'numeric' }) : ''}
                  </span>
                  <span className="font-mono font-semibold text-gray-700">{o.quantity} btl</span>
                  <span
                    className={cn(
                      'text-[9px] font-bold rounded px-1.5 py-0.5',
                      String(o.status).toLowerCase().includes('deliver') || String(o.status).toLowerCase().includes('complet')
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-blue-50 text-blue-600',
                    )}
                  >
                    {String(o.status || '').toUpperCase().slice(0, 9)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* auction lot records — only when this wine actually has one; most never do */}
        {auctionLots.length > 0 && (
          <Card title="Auction lots">
            {auctionLots.map((lot) => (
              <div key={lot.id} className="py-1.5 border-t border-gray-50 first:border-t-0 text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="font-semibold text-gray-700 truncate">{lot.auctionHouse}</span>
                  {/* Optional since 2026-09-21 (founder answer 11): not stated is said, not blank. */}
                  <span className="text-gray-400">{lot.lotNumber ? `lot ${lot.lotNumber}` : 'lot number not stated'}</span>
                  <span className="flex-1 text-gray-500 truncate text-right">{lot.saleDate}</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {lot.hammerPrice} + {lot.buyersPremium} premium {lot.currency}, {lot.bottles} bottles — recorded by {lot.recordedByName}
                </div>
                {/* What the book was given, in the house's money (founder answer 10). */}
                {lot.bookedUnitCost != null && lot.houseCurrency && (
                  <div className="text-[11px] text-gray-500 mt-0.5" data-testid={`auction-lot-booked-${lot.id}`}>
                    Booked at {lot.bookedUnitCost} {lot.houseCurrency} a bottle
                    {lot.houseUnitCost != null
                      ? ', as typed'
                      : lot.exchangeRate != null
                        ? ` (1 ${lot.currency} = ${lot.exchangeRate} ${lot.houseCurrency}, as stated)`
                        : ''}
                    {lot.houseUnitCost != null && lot.exchangeRate != null
                      ? `; rate stated: 1 ${lot.currency} = ${lot.exchangeRate} ${lot.houseCurrency}`
                      : ''}
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}

        {/* Only once the orders are read: an unread list is not "no orders". */}
        {receiptDepthOn && ordersQ.isSuccess && <ReceiptDepth orders={orders} />}
      </div>

      {/* action bar */}
      <div className="flex flex-wrap items-center gap-3 mt-3.5 bg-white border border-gray-100 rounded-xl px-4 py-3">
        <button
          onClick={() => setShowSpotCount(true)}
          title={locations.length > 0 ? 'Count one shelf, or every shelf at once' : 'Count this wine on every shelf at once'}
          className="h-9 px-4 border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-lg"
        >
          {locations.length > 0 ? 'Count bottles' : 'Count every shelf'}
        </button>

        <span className="w-px h-6 bg-gray-200" />

        <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">Manual adjust</span>
        {asksShelf && (
          <select
            value={shelfId}
            onChange={(e) => setShelfId(e.target.value)}
            aria-label="Which shelf"
            className="h-9 px-2 text-xs border border-gray-200 rounded-lg bg-white text-gray-700"
          >
            <option value="" disabled>
              Which shelf?
            </option>
            {offeredShelves.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({shelfQty(l.id)})
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
          <button type="button" aria-label="Decrease manual adjustment" onClick={() => setDelta((d) => d - 1)} className="w-11 h-11 text-gray-500 hover:bg-gray-50">-</button>
          <span aria-live="polite" aria-label={`Manual adjustment ${delta > 0 ? `+${delta}` : delta}`} className={cn('w-11 text-center font-mono text-sm font-bold border-x border-gray-100 leading-[44px]', delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-gray-700')}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
          <button type="button" aria-label="Increase manual adjustment" onClick={() => setDelta((d) => d + 1)} className="w-11 h-11 text-gray-500 hover:bg-gray-50">+</button>
        </div>
        <ThemedSelect value={reason} options={ADJUST_REASONS} onChange={setReason} align="left" aria-label="Reason" />
        <button
          onClick={() => adjust.mutate({ quantityChange: delta, reason })}
          disabled={delta === 0 || adjust.isPending || shelfMissing || addsOnTakeOff || overShelf}
          title={shelfMissing ? 'Pick the shelf first' : undefined}
          className="h-9 px-4 bg-wine-600 hover:bg-wine-700 text-white text-xs font-bold rounded-lg disabled:opacity-40"
        >
          Apply
        </button>
        {addsOnTakeOff && (
          <span role="alert" className="text-[11px] text-rose-600">
            {TAKE_OFF_ONLY[reason]} only takes bottles off. Press − instead, or pick Count correction to add bottles.
          </span>
        )}
        {overShelf && shelfPicked && (
          <span role="alert" className="text-[11px] text-rose-600">
            {shelves.find((l) => l.id === shelfPicked)?.name} holds {shelfQty(shelfPicked)} of this wine. Take off {shelfQty(shelfPicked)} or fewer here, or pick another shelf.
          </span>
        )}

        <span className="w-px h-6 bg-gray-200" />

        <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">Locations</span>
        <MultiLocationCell
          totalLive={live}
          breakdown={item.locations ?? []}
          locations={locations}
          onTransfer={doTransfer}
        />

        {(item.saleType === 'glass' || item.saleType === 'both') && (live > 0 || (item.openMl ?? 0) > 0) && (
          <>
            <span className="w-px h-6 bg-gray-200" />
            <button
              onClick={() => void pour()}
              disabled={pouring || shelfMissing}
              title={shelfMissing ? 'Pick the shelf first' : 'Record one by-the-glass pour — depletes the open bottle'}
              className="h-9 px-4 border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg disabled:opacity-40"
            >
              Record pour
            </button>
          </>
        )}

        {/*
         * F-948 (F-144): no "View ledger" here. It went to /documents-reports,
         * which lists reports and mail, not this wine's movements, so it was a
         * door to the wrong room. A per-wine ledger view does not exist yet
         * (the data is at GET /inventory-ledger/inventory/:inventoryId/history);
         * when one is built, its link goes back here.
         */}
      </div>

      {showSpotCount && (
        <SpotCountPanel
          item={item}
          houseLocations={locations}
          onClose={() => setShowSpotCount(false)}
          onCommitted={invalidate}
        />
      )}
    </div>
  )
}
