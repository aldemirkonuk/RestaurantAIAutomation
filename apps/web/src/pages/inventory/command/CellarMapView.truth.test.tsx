/**
 * INV-W19 (founder: approved 2026-10-01). Once a house has zones, the cellar
 * map must not say what it does not know: an unread count or a missing par is
 * not green "Healthy", an unread count is not 0 in the side panel or the
 * gauge, and the first zone is selected even when zones answer after mount.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { CellarMapView } from './CellarMapView'
import { StockGauge } from './bits'
import { MAP_WORDS, mapTone } from '../next/useInventoryNextData'
import type { StorageLocation } from '../../../hooks/useStorageLocations'
import type { InventoryItem } from '../useInventoryPage'

const CELLAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const zone: StorageLocation = { id: CELLAR, name: 'Cellar', capacity: 100, currentCount: 0, color: '#be123c' }

const item = (id: string, name: string, live: number | null, par: number | null, shadow = 0, qty = 3) =>
  ({
    inventoryId: id,
    name,
    liveStock: live,
    shadowStock: shadow,
    threshold: par,
    locations: [{ locationId: CELLAR, qty, wac: null }],
  }) as unknown as InventoryItem

const tile = (name: string) =>
  within(screen.getByTestId('zone-card-Cellar')).getByText(name).closest('button') as HTMLElement

function draw(items: InventoryItem[], locations: StorageLocation[] = [zone], extra = {}) {
  return render(
    <CellarMapView items={items} locations={locations} onOpenInTable={() => {}} onManageLocations={() => {}} {...extra} />,
  )
}

describe('cellar map — unknown is not healthy (INV-W19)', () => {
  it('an unread count and a missing par get the neutral tile, not green', () => {
    draw([item('u', 'Unread', null, 6), item('n', 'No par', 5, null), item('h', 'Plenty', 12, 6)])
    expect(tile('Unread').className).toContain('bg-gray-50')
    expect(tile('No par').className).toContain('bg-gray-50')
    expect(tile('Unread').className).not.toContain('bg-emerald-50')
    expect(tile('Plenty').className).toContain('bg-emerald-50')
  })

  it('the legend carries the neutral swatch, and the page can give its own words', () => {
    draw([item('h', 'Plenty', 12, 6)], [zone], { toneOf: mapTone, toneWords: MAP_WORDS })
    for (const w of ['At or above par', 'Below par', 'Out', 'Reconcile', 'Not read, or no par set']) {
      expect(screen.getByText(w)).toBeTruthy()
    }
    expect(screen.queryByText('Healthy')).toBeNull()
    expect(screen.queryByText('Critical')).toBeNull()
  })

  it("the old page's legend keeps its words and gains the not-read swatch", () => {
    draw([item('h', 'Plenty', 12, 6)])
    for (const w of ['Healthy', 'Below par', 'Critical', 'Needs reconcile', 'Stock not read, or no par']) {
      expect(screen.getByText(w)).toBeTruthy()
    }
  })

  it("a reconcile tile's side-panel number carries no severity tint", () => {
    // Short of par with stock awaiting reconcile: the tile is violet, so the
    // number beside it is not tinted rose or amber.
    draw([item('v', 'Waiting', 1, 6, 2, 1)])
    expect(tile('Waiting').className).toContain('bg-violet-50')
    const number = screen.getByText('3')
    expect(number.className).toContain('text-gray-900')
    expect(number.className).not.toMatch(/text-(rose|amber)-600/)
  })

  it('the side panel says the total could not be read instead of counting it as 0', () => {
    draw([item('u', 'Unread', null, 6)])
    expect(screen.getByText('3 here; the total could not be read')).toBeTruthy()
    expect(screen.queryByText(/here of 0 total/)).toBeNull()
  })

  it('zones that answer after mount still select the first zone', () => {
    const { rerender } = draw([item('h', 'Plenty', 12, 6)], [], { locationsLoading: true })
    rerender(
      <CellarMapView items={[item('h', 'Plenty', 12, 6)]} locations={[zone]} onOpenInTable={() => {}} onManageLocations={() => {}} />,
    )
    expect(screen.queryByText('Select a zone to inspect it.')).toBeNull()
    expect(screen.getByRole('heading', { level: 4, name: 'Cellar' })).toBeTruthy()
  })
})

describe('stock gauge — unread is —, no par says so (INV-W19)', () => {
  it('draws — for an unread count and "no par set" with no par marker', () => {
    const { container } = render(<StockGauge item={item('u', 'U', null, null)} />)
    const g = within(container)
    expect(g.getByText('—')).toBeTruthy()
    expect(g.getByText('no par set')).toBeTruthy()
    expect(g.getByText('— live')).toBeTruthy()
    expect(container.querySelector('.absolute')).toBeNull()
  })

  it('keeps the number and the par when both were read', () => {
    render(<StockGauge item={item('r', 'R', 4, 6)} />)
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText('/ 6 par')).toBeTruthy()
  })
})

describe("the page's tint rule follows the table's standing (INV-W19)", () => {
  it('maps every standing to one tint', () => {
    expect(mapTone(item('a', 'a', 0, 4))).toBe('rose')
    expect(mapTone(item('b', 'b', 2, 6))).toBe('amber')
    expect(mapTone(item('c', 'c', 6, 6))).toBe('green')
    expect(mapTone(item('d', 'd', 12, 6))).toBe('green')
    expect(mapTone(item('e', 'e', 5, null))).toBe('neutral')
    expect(mapTone(item('f', 'f', null, 6))).toBe('neutral')
    expect(mapTone(item('g', 'g', 8, 6, 2))).toBe('violet')
  })
})
