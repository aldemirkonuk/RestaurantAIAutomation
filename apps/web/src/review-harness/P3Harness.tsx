// SCRATCH — P3 fixture harness (founder ruling 2026-10-01: fixture harness, shown
// in Safari). Never committed. Renders the real /inventory page and its sheets
// on made-up rows; every request is answered here, none leaves the page.
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import '../styles/globals.css'
import '../pages/inventory/next/inventory-next.css'
import { apiClient } from '../services/api/client'
import { AuthContext } from '../contexts/AuthContext'
import InventoryNext from '../pages/inventory/next/InventoryNext'
import { CountSheet, OrderSheet, PourSheet, TransferSheet, WriteOffSheet } from '../pages/inventory/next/InventorySheets'
import { toRow } from '../pages/inventory/next/useInventoryNextData'

// The off-screen capture view reports itself hidden, which pauses react-query's
// retries, so a failed read with retry: 1 would sit in loading forever there.
focusManager.setFocused(true)
const H = 'hh-house'
// The off-screen WebKit capture has empty storage; give it this fixture house so
// a count resolves. A browser that already holds a real house is left alone.
try { if (!localStorage.getItem('activeRestaurantId')) localStorage.setItem('activeRestaurantId', H) } catch { /* no storage */ }
const w = window as unknown as Record<string, unknown>
const log: string[] = []
w.__hlog = log
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
const wines = [
  { id: 'w1', name: 'Barolo', producer: 'Borgo Lame', vintage: 2020, category: 'Red', grapeVariety: 'Nebbiolo', bottleSizeMl: 750 },
  { id: 'w2', name: 'Montepulciano', producer: 'Riseis', vintage: 2021, category: 'Red', grapeVariety: 'Montepulciano', bottleSizeMl: 750 },
  { id: 'w3', name: 'Sancerre', producer: 'Domaine Vacheron', vintage: 2022, category: 'White', grapeVariety: 'Sauvignon Blanc', bottleSizeMl: 750 },
  { id: 'w4', name: 'Chablis', producer: 'William Fèvre', vintage: 2021, category: 'White', grapeVariety: 'Chardonnay', bottleSizeMl: 750 },
  { id: 'w5', name: 'Rioja Reserva', producer: 'La Rioja Alta', vintage: 2018, category: 'Red', grapeVariety: 'Tempranillo', bottleSizeMl: 750 },
  { id: 'w6', name: 'Prosecco', producer: 'Bisol', vintage: null, category: 'Sparkling', grapeVariety: 'Glera', bottleSizeMl: 750 },
]
const item = (id: string, wi: number, stock: number | null, par: number | null, extra: Record<string, unknown> = {}) => ({
  id, restaurantId: H, wineId: wines[wi].id, wineName: wines[wi].name, wineProducer: wines[wi].producer,
  wineVintage: wines[wi].vintage, stockLive: stock, shadowStock: 0, thresholdMin: par, reorderPoint: par === null ? null : 1,
  velocityPerDay: 0.07, daysOfCover: null, wac: null, menuPriceBottle: null, menuPriceGlass: null, pourSizeMl: 150,
  lastCountedAt: daysAgo(50), locations: stock === null ? [] : [{ locationId: null, qty: stock }],
  providerId: 'p1', providerName: 'Enoteca Rossi', analyticsReadable: true, ...extra,
})
const items = [
  item('i1', 0, 2, 6), item('i2', 1, 10, 5), item('i3', 2, 0, 4),
  item('i4', 3, 5, null), item('i5', 4, 12, 6), item('i6', 5, 8, 6),
]
// ?s=zone-*: titles across named zones, outside every zone, and at nothing on hand (INV-W34).
if ((new URLSearchParams(location.search).get('s') ?? '').startsWith('zone-')) {
  const at: Record<string, { locationId: string | null; qty: number }[]> = {
    i1: [{ locationId: 'z1', qty: 2 }],
    i2: [{ locationId: 'z1', qty: 6 }, { locationId: null, qty: 4 }],
    i3: [{ locationId: null, qty: 0 }],
    i4: [],
    i5: [{ locationId: 'z2', qty: 12 }],
    i6: [{ locationId: null, qty: 8 }],
  }
  for (const it of items) it.locations = at[it.id] ?? it.locations
}
// ?s=page-long: one title with every field at its longest (P4 long data).
if (new URLSearchParams(location.search).get('s') === 'page-long') {
  wines.push({ id: 'w7', name: 'Château Grand-Puy-Ducasse Pauillac Grand Cru Classé Cuvée Spéciale Réserve du Propriétaire', producer: 'Société Civile du Château Grand-Puy-Ducasse et des Domaines Associés', vintage: 2015, category: 'Red', grapeVariety: 'Cabernet Sauvignon, Merlot, Cabernet Franc, Petit Verdot', bottleSizeMl: 1500 })
  items.push(item('i7', 6, 12480, 9999, { velocityPerDay: 123.45, wac: 1234567.89, menuPriceBottle: 9876543.21, menuPriceGlass: 123456.78, providerName: 'Enoteca Rossi Distribuzione Vini Pregiati e Distillati Internazionali S.r.l.' }))
}
// ?s=page-drinks: a house holding more than wine (INV-W30). The library row carries
// beverageKind on every select("*") read (wines.service.ts:122,211); a spirit's
// primary_type is "unknown", as in the real library.
if (new URLSearchParams(location.search).get('s') === 'page-drinks') {
  for (const w of wines) Object.assign(w, { beverageKind: 'wine' })
  wines.push(
    { id: 'w8', name: 'Tavel', producer: 'Château d’Aqueria', vintage: 2023, category: 'Rosé', grapeVariety: 'Grenache', bottleSizeMl: 750, beverageKind: 'wine' } as never,
    { id: 'w9', name: 'Bandol', producer: 'Domaine Tempier', vintage: 2023, category: 'rose', grapeVariety: 'Mourvèdre', bottleSizeMl: 750, beverageKind: 'wine' } as never,
    { id: 'w10', name: 'Lagavulin 16', producer: 'Lagavulin', vintage: null, category: 'unknown', grapeVariety: null, bottleSizeMl: 700, beverageKind: 'spirit' } as never,
    { id: 'w11', name: 'Efes Pilsen', producer: 'Anadolu Efes', vintage: null, category: 'unknown', grapeVariety: null, bottleSizeMl: 330, beverageKind: 'beer' } as never,
    { id: 'w12', name: 'Seedlip Grove 42', producer: 'Seedlip', vintage: null, category: null, grapeVariety: null, bottleSizeMl: 700, beverageKind: 'non_alcoholic' } as never,
    { id: 'w13', name: 'House punch base', producer: null, vintage: null, category: null, grapeVariety: null, bottleSizeMl: 1000, beverageKind: 'unknown' } as never,
  )
  items.push(item('i8', 6, 6, 4), item('i9', 7, 4, 4), item('i10', 8, 3, 2), item('i11', 9, 48, 24), item('i12', 10, 2, 2), item('i13', 11, 1, null))
}
// ?s=big-*: a title past 1,000 bottles (INV-W33, digit grouping).
if ((new URLSearchParams(location.search).get('s') ?? '').startsWith('big-')) {
  wines.push({ id: 'w14', name: 'Barbaresco', producer: 'Produttori del Barbaresco', vintage: 2019, category: 'Red', grapeVariety: 'Nebbiolo', bottleSizeMl: 1500 })
  items.push(item('i14', 6, 1240, 2440, { shadowStock: 1250, reorderPoint: 1100, velocityPerDay: 40, daysOfCover: 31, openMl: 1500, providerName: 'Enoteca Rossi' }))
}
// ?s=page-nopace: the analytics join failed for the batch; the gateway then sends
// analyticsReadable: false and deadStock: false on every row (inventory.service.ts:163,265).
if ((new URLSearchParams(location.search).get('s') ?? '').includes('nopace')) {
  for (const it of items) Object.assign(it, { analyticsReadable: false, deadStock: false, velocityPerDay: null })
}
const vendors = [
  { id: 'p1', name: 'Enoteca Rossi', winePortfolio: '', phone: '', email: '' },
  { id: 'p2', name: 'Vini Bianchi', winePortfolio: '', phone: '', email: '' },
]

let state = new URLSearchParams(location.search).get('s') ?? 'page'
// ?raw=1 draws the sheets as they were before the 2026-10-01 format pass, for
// the before shots only: the inset body class is stripped and an alarm is red.
if (new URLSearchParams(location.search).get('raw') === '1') {
  new MutationObserver(() => {
    document.querySelectorAll('.iv-sheet-body').forEach((el) => el.classList.remove('iv-sheet-body'))
    document.querySelectorAll<HTMLElement>('.iv-said-alarm').forEach((el) => { el.classList.remove('iv-said-alarm'); el.style.color = 'var(--alarm)' })
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true })
}
// INV-W26: the order's email, as the gateway would answer for each state.
let sentAt: string | null = null
const LETTER = 'Dear Enoteca Rossi team,\n\nWe would like to order 6 bottles of Montepulciano (Riseis, 2021) for Fixture House. Please confirm availability, the price and the earliest delivery date.\n\nThank you,\nFixture owner\nFixture House'
const conversation = () => {
  if (state.includes('drafting')) return []
  const base = { id: 'c-fixture', orderId: 'o-fixture', direction: 'OUTBOUND', emailType: 'order_inquiry', roundCount: 0, createdAt: new Date(Date.now() - 4000).toISOString(), draftContent: LETTER, rollingSummary: null, providerName: 'Enoteca Rossi', providerEmail: state.includes('noemail') ? null : 'orders@rossi.example', aiGenerated: true }
  if (state.includes('auto')) return [{ ...base, status: 'AUTO_SENT', sentAt: new Date(Date.now() - 2000).toISOString() }]
  // INV-W37: F-106 kept the first-written pending letter and closed the newer one.
  if (state.includes('f106')) return [
    { ...base, status: 'PENDING_APPROVAL', sentAt: null, createdAt: new Date(Date.now() - 9000).toISOString() },
    { ...base, id: 'c-fixture-2', status: 'DISCARDED', sentAt: null, createdAt: new Date(Date.now() - 3000).toISOString(), draftContent: 'Dear [Vendor Name],\n\nPlease find our order attached.\n\nBest regards,\n[Your Name]' },
  ]
  return [{ ...base, status: sentAt ? 'SENT' : 'PENDING_APPROVAL', sentAt }]
}
const staff = () => state.includes('staff') || state.includes('asked')
const answer = (method: string, url: string, body: unknown): unknown => {
  if (method === 'get' && /\/orders\/o-fixture\/conversations$/.test(url)) return conversation()
  if (method === 'get' && /\/orders\/o-fixture\/draft$/.test(url)) {
    return { draft: { id: 'c-fixture', content: LETTER, send_request: null }, sendOrAsk: staff() ? { readable: true, maySend: false, mode: 'ask', basis: null, grant: null, sentence: 'A manager sends this house’s order emails.' } : { readable: true, maySend: true, mode: 'send', basis: 'owner', grant: null, sentence: null } }
  }
  if (method === 'get' && /order-approval-gate/.test(url)) {
    return { restaurantId: H, callerRole: staff() ? 'staff' : 'owner', policySet: true, policyNote: '', readable: true, reason: null, orders: [{ orderId: 'o-fixture', requiredRole: 'manager', firedBy: [], reasons: [], untestable: [], mayApprove: !staff(), sentence: staff() ? 'A manager approves orders in this house.' : null }] }
  }
  if (method === 'post' && /\/o-fixture\/seal-challenge$/.test(url)) return { challenge: 'fixture-order-seal' }
  if (method === 'post' && /\/o-fixture\/draft-seal-challenge$/.test(url)) return { challenge: 'fixture-draft-seal' }
  if (method === 'post' && /\/o-fixture\/approve$/.test(url)) return { id: 'o-fixture', status: 'approved' }
  if (method === 'post' && /\/o-fixture\/approve-draft$/.test(url)) { sentAt = new Date().toISOString(); return { ok: true } }
  if (method === 'post' && /\/o-fixture\/draft-send-request$/.test(url)) return { conversationId: 'c-fixture', requestedAt: new Date().toISOString(), told: 2, says: 'Asked. The owner and one manager were told; nothing has been sent.' }
  if (method === 'post' && /\/procurement\/orders$/.test(url)) {
    const b = body as { quantity: number; providerId: string; inventoryId: string }
    const merged = state.includes('merged')
    return { id: 'o-fixture', orderNumber: 'PO-FIXTURE', restaurantId: H, inventoryId: b.inventoryId, providerId: b.providerId, quantity: b.quantity, status: merged ? 'approved' : 'pending', requestedAt: merged ? daysAgo(2) : new Date().toISOString() }
  }
  if (method === 'post' && /\/item\/[^/]+\/count$/.test(url)) return { item: null }
  if (method !== 'get') return {}
  // Auction lots ride the /inventory/<x>? rule below unless caught first; big-* has 1,000 (INV-W33).
  if (/\/inventory\/auction-lots/.test(url)) return state.startsWith('big-') ? Array.from({ length: 1000 }, (_, i) => ({ id: `lot${i}`, saleDate: '2026-09-01' })) : []
  if (/\/inventory\/[^/?]+$/.test(url) || /\/inventory\/[^/]+\?/.test(url)) return items
  if (/\/wines/.test(url)) return wines
  if (/\/settings\/currency/.test(url)) return { readable: true, code: 'EUR' }
  if (/\/cellar\/[^/]+\/settings/.test(url)) return { restaurantId: H, holdCeremony: 'hold', holdCeremonyConfigured: true }
  if (/recommend/.test(url)) return { primary: null, alternatives: [] }
  // The till's book for the open row; big-* sells past 1,000 so the bars and hours group (INV-W33).
  if (/\/row-record/.test(url)) {
    const ledger = state.startsWith('big-')
      ? [{ at: '2026-09-29T19:00:00Z', qty: 1240, unitPrice: 10 }, { at: '2026-09-30T20:00:00Z', qty: 1180, unitPrice: 10 }]
      : []
    return { restaurantId: H, label: '', matchRule: 'name', books: [{ book: 'pos', readable: true, ledger }], named: ['pos'], nothingNamesIt: false }
  }
  if (/\/procurement\/items-to-name/.test(url)) return { viewer: { mayName: true, mayNameReason: null }, deliveries: [] }
  if (/\/procurement\/documents/.test(url)) return { items: [], order: null }
  if (/\/pricing\/advice/.test(url)) return { restaurantId: H, generatedAt: new Date().toISOString(), target: { bottlePct: null, glassPct: null, bandPct: null, set: false, pourConfirmed: false, pourMl: null }, wines: [], counts: {}, locks: { readable: true, reason: null, held: 0 } }
  if (/provider/.test(url)) return state.includes('novendor') ? [] : vendors
  if (/storage|location/.test(url)) return state.startsWith('zone-') ? zones : []
  return []
}
apiClient.defaults.adapter = async (config) => {
  const method = (config.method ?? 'get').toLowerCase()
  const url = String(config.url ?? '')
  const body = typeof config.data === 'string' ? JSON.parse(config.data || 'null') : config.data
  log.push(`${method} ${url}`)
  if (method === 'post' && state.includes('refused')) {
    const response = { data: { message: 'Only owners and managers may record a count in this house.' }, status: 403, statusText: 'Forbidden', headers: {}, config }
    throw Object.assign(new Error('Request failed with status code 403'), { isAxiosError: true, response, config })
  }
  // INV-W31: a write whose server failed, never answered, or refused with operator text.
  const fail = (status: number | null, message?: unknown): never => {
    if (status === null) throw Object.assign(new Error('Network Error'), { isAxiosError: true, request: {}, config, code: 'ERR_NETWORK' })
    const response = { data: message === undefined ? {} : { message }, status, statusText: '', headers: {}, config }
    throw Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response, config, request: {} })
  }
  if (method === 'post' && state === 'writeoff-unknown' && /inventory-ledger\/transactions/.test(url)) fail(500, 'duplicate key value violates unique constraint "inventory_transactions_idempotency_key_key"')
  if (method === 'post' && state === 'writeoff-badqty' && /inventory-ledger\/transactions/.test(url)) fail(400, ['quantityChange must be an integer number'])
  if (method === 'post' && state === 'transfer-zones-silent' && /\/transfer$/.test(url)) fail(null)
  if (method === 'post' && state === 'order-unknown' && /\/procurement\/orders$/.test(url)) fail(503)
  if (method === 'post' && state === 'order-letter-unknown' && /approve-draft$/.test(url)) fail(null)
  // INV-W28: the side reads fail (?s=page-sidefail every one, ?s=page-winefail the library only).
  // ?s=page-reading: the same side reads never answer, as on a slow or hidden tab.
  if (method === 'get' && state.includes('reading') && /\/(wines|settings\/currency|storage-locations|providers|pricing\/advice|procurement\/documents|procurement\/items-to-name)/.test(url)) return new Promise(() => undefined)
  const side = state.includes('sidefail') ? /\/(wines|settings\/currency|storage-locations|providers|pricing\/advice|procurement\/documents|procurement\/items-to-name)/ : state.includes('winefail') ? /\/wines/ : null
  if (method === 'get' && side && side.test(url) && !/\/inventory\/[^/?]+$/.test(url)) {
    const response = { data: { message: 'Internal server error' }, status: 500, statusText: 'Internal Server Error', headers: {}, config }
    throw Object.assign(new Error('Request failed with status code 500'), { isAxiosError: true, response, config })
  }
  return { data: answer(method, url, body), status: 200, statusText: 'OK', headers: {}, config, request: {} }
}

const auth = {
  activeRestaurantId: H, activeRole: 'owner', user: { id: 'u-fixture', role: 'owner', name: 'Fixture owner', email: 'fixture@example.test' },
  availableRestaurants: [{ id: H, name: 'Fixture House', role: 'owner' }], loading: false, isAuthenticated: true,
} as never

const row = (id: string) => {
  const i = items.find((x) => x.id === id)!
  return toRow(i as never, wines.find((x) => x.id === i.wineId) as never)
}
const native = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const byText = (sel: string, re: RegExp) => [...document.querySelectorAll<HTMLElement>(sel)].find((b) => re.test(b.textContent ?? ''))
const seal = async (re: RegExp) => {
  const b = byText('button', re)
  if (!b) { log.push('no seal ' + re); return }
  b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(120)
  b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}
const drive = async (s: string) => {
  await sleep(900)
  if (s === 'order-sent' || s === 'order-merged' || s === 'order-unknown' || s === 'order-asking' || s.startsWith('order-letter')) {
    // After INV-W21 the at-par row has no default; type the 6 the old sheet showed.
    const q = [...document.querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent === 'Bottles')
    if (q && q.value === '') { native(q, '6'); await sleep(300) }
    await seal(/^Hold to (order|place)/)
    await sleep(400)
    if (s === 'order-asking') return
    byText('button', /^Yes, (order|place)/)?.click()
    if (s === 'order-letter-sent' || s === 'order-letter-asked' || s === 'order-letter-unknown') {
      await sleep(1800)
      await seal(/^Hold to (approve and send|ask a manager)/)
      await sleep(900)
    }
  }
  if (s === 'count-sealed' || s === 'count-refused') {
    const inp = [...document.querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent === 'Bottles counted')
    if (inp) native(inp, '9')
    await sleep(300)
    await seal(/^Hold to record/)
  }
  const labelled = (t: string) => [...document.querySelectorAll<HTMLSelectElement>('select')].find((x) => (x.labels?.[0]?.textContent ?? '').includes(t))
  if (s.startsWith('writeoff-')) {
    const why = labelled('Why they left'); if (why) native(why, 'breakage')
    await sleep(300)
    await seal(/^Hold to write off/)
  }
  if (s === 'transfer-zones-silent') {
    const from = labelled('From'); if (from) native(from, from.options[from.options.length - 1].value)
    await sleep(300)
    const to = labelled('To'); if (to) native(to, 'z1')
    await sleep(300)
    await seal(/^Hold to move/)
  }
  if (s === 'zone-filter') { const sel = document.querySelectorAll<HTMLSelectElement>('select')[0]; if (sel) native(sel, 'none'); await sleep(300) }
  if (s === 'zone-open') { document.querySelector<HTMLElement>('[data-testid="inv-row-i3"]')?.click(); await sleep(600) }
  if (s === 'menu-down') {
    document.querySelector<HTMLElement>('[data-testid="inv-row-i3"]')?.click(); await sleep(600)
    const more = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="row-dropdown"] button')].find((b) => b.textContent?.trim() === 'More')
    more?.focus(); more?.click()
    for (let n = 0; n < 40 && document.activeElement?.getAttribute('role') !== 'menuitem'; n += 1) await sleep(50)
    // A scripted key press is not a keyboard press, so :focus-visible stays off; draw the page's own ring on :focus for the shot.
    const st = document.createElement('style'); st.textContent = '[data-h-focus]{outline:2px solid var(--seal);outline-offset:2px}'; document.head.appendChild(st)
    await sleep(200)
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); await sleep(300)
    w.__menuFocus = document.activeElement?.textContent?.trim()
    document.activeElement?.setAttribute('data-h-focus', '')
  }
  if (s === 'big-open') { document.querySelector<HTMLElement>('[data-testid="inv-row-i14"]')?.click(); await sleep(600) }
  if (s === 'big-count') {
    const inp = [...document.querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent === 'Bottles counted')
    if (inp) native(inp, '1180')
    await sleep(300)
    await seal(/^Hold to record/)
  }
  if (s === 'page-value') { const sel = document.querySelectorAll<HTMLSelectElement>('select')[2]; if (sel) native(sel, 'value') }
  if (s === 'page-filtered') {
    const sel = document.querySelectorAll<HTMLSelectElement>('select')[1]; if (sel) native(sel, 'white')
    await sleep(200)
    byText('button', /^Count due/)?.click()
  }
  w.__hdone = s
}

const zones = [
  { id: 'z1', name: 'Cellar A', restaurantId: H },
  { id: 'z2', name: 'Bar fridge', restaurantId: H },
]
function SheetFor({ s }: { s: string }) {
  const close = () => {}
  if (s === 'big-order') return <OrderSheet row={row('i14')} onClose={close} providers={vendors as never} providersError={null} restaurantId={H} />
  if (s === 'big-count') return <CountSheet row={row('i14')} onClose={close} />
  if (s.startsWith('order')) {
    return <OrderSheet row={row(s === 'order-below' ? 'i1' : 'i2')} onClose={close} providers={s.includes('novendor') ? [] : (vendors as never)} providersError={null} restaurantId={H} />
  }
  if (s.startsWith('count')) return <CountSheet row={row('i2')} onClose={close} />
  if (s.startsWith('transfer')) return <TransferSheet row={row('i2')} onClose={close} locations={s.includes('zones') ? (zones as never) : []} locationsUnavailable={false} />
  if (s.startsWith('writeoff')) return <WriteOffSheet row={row('i2')} onClose={close} />
  if (s.startsWith('pour')) return <PourSheet row={row('i2')} onClose={close} />
  return null
}
// The page sits behind every sheet, as it does on /inventory.
function View({ s }: { s: string }) {
  useEffect(() => { void drive(s) }, [s])
  return <><InventoryNext /><SheetFor s={s} /></>
}

function Harness() {
  const [s] = useState(state)
  const qc = React.useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }), [s])
  return (
    <QueryClientProvider client={qc} key={s}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[new URLSearchParams(location.search).get('path') ?? '/inventory']}>
          <div style={{ width: '100%', maxWidth: 1280, minHeight: '100vh', position: 'relative', outline: '1px dashed #bbb' }}>
            <p style={{ font: '11px ui-monospace, monospace', letterSpacing: '.08em', margin: 0, padding: '6px 12px', background: '#fff8d6', color: '#5a4a00' }}>
              SCRATCH FIXTURE · made-up rows, no network · state: {s}
            </p>
            <View s={s} />
          </div>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  )
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />)
