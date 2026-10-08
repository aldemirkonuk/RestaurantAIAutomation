// SCRATCH — INV-W19 fixture harness. Never committed (founder ruling 2026-10-01).
// Renders the real Cellar map with made-up rows, inside the page's own wrapper,
// so the filled map can be seen live. ?v=before uses the pre-W19 copies.
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import '../styles/globals.css'
import '../pages/inventory/next/inventory-next.css'
import { CellarMapView } from '../pages/inventory/command/CellarMapView'
import { CellarMapView as BeforeMap } from './before/CellarMapView'
import { MAP_WORDS, mapTone } from '../pages/inventory/next/useInventoryNextData'

const v = new URLSearchParams(location.search).get('v') ?? 'after'
const zones = [
  { id: 'z1', name: 'Main cellar', capacity: 120, currentCount: 0, temperature: '12°C', color: '#7a2e3a' },
  { id: 'z2', name: 'Bar fridge', capacity: null, currentCount: 0, color: '#2f5d62' },
]
const it = (id: string, name: string, live: number | null, par: number | null, shadow: number, at: [string, number][]) => ({
  inventoryId: id, name, liveStock: live, shadowStock: shadow, threshold: par,
  locations: at.map(([locationId, qty]) => ({ locationId, qty })),
})
const items = [
  it('a', 'Barolo 2016', 2, 6, 0, [['z1', 2]]),
  it('b', 'Sancerre 2021', 0, 4, 0, []),
  it('c', 'Rioja Reserva 2018', 12, 6, 0, [['z1', 12]]),
  it('d', 'Chablis, no par', 5, null, 0, [['z1', 5]]),
  it('e', 'Malbec, unread', null, 6, 0, [['z1', 3]]),
  it('f', 'Prosecco NV', 8, 6, 2, [['z2', 8]]),
  it('g', 'Rosé 2023', 3, 5, 0, [['z2', 3]]),
] as never[]

function Harness() {
  // Zones answer a moment after the page opens, as they do live.
  const [locs, setLocs] = useState<typeof zones | null>(null)
  useEffect(() => { const t = setTimeout(() => setLocs(zones), 300); return () => clearTimeout(t) }, [])
  const common = { items, locations: (locs ?? []) as never[], locationsLoading: locs === null, onOpenInTable: () => {}, onManageLocations: () => {} }
  return (
    <div className="mudavym iv-page min-h-full" style={{ background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: "'DM Sans', system-ui, sans-serif", minHeight: '100vh' }}>
      <div className="iv-wrap" style={{ padding: 24 }}>
        <p style={{ font: '12px ui-monospace, monospace', letterSpacing: '.08em', margin: '0 0 12px' }}>
          SCRATCH FIXTURE · CELLAR MAP · {v === 'before' ? 'BEFORE (pre-W19 code)' : 'AFTER (W19 code)'} · made-up rows
        </p>
        <div className="iv-map">
          {v === 'before' ? <BeforeMap {...common} /> : <CellarMapView {...common} toneOf={mapTone} toneWords={MAP_WORDS} />}
        </div>
      </div>
    </div>
  )
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />)
