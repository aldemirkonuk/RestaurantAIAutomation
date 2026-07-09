import { describe, it, expect, beforeEach } from 'vitest'
import { loadLayout, saveLayout, clearLayout, exportLayout, importLayout } from '../../../../lib/reports/layoutEngine'
import { LayoutConfig } from '../../../../lib/reports/types'
import { DollarSign, Package } from 'lucide-react'

describe('Layout Persistence', () => {
  beforeEach(() => {
    clearLayout()
  })

  const mockLayout: LayoutConfig = {
    kpiCards: [
      { id: 'revenue', title: 'Revenue', key: 'revenue', icon: DollarSign, visible: true },
      { id: 'orders', title: 'Orders', key: 'orders', icon: Package, visible: true },
    ],
    charts: [
      { id: 'chart1', title: 'Revenue', dataSource: 'revenue', chartType: 'area', size: 'large', visible: true },
    ],
    sections: [
      { id: 'aiInsights', type: 'aiInsights', visible: true, expanded: true },
    ],
    version: 1,
  }

  it('saveLayout and loadLayout are stable no-ops (persistence via useUserPreferences)', () => {
    // The engine was refactored: saveLayout/loadLayout/clearLayout are intentional
    // no-ops; persistence is now handled by the useUserPreferences hook at the
    // component level.  Verify the API contract: saveLayout does not throw and
    // loadLayout returns null (no localStorage coupling).
    expect(() => saveLayout(mockLayout)).not.toThrow()
    expect(loadLayout()).toBeNull()
  })

  it('returns null when no layout saved', () => {
    const loaded = loadLayout()
    expect(loaded).toBeNull()
  })

  it('exports layout as JSON string', () => {
    const exported = exportLayout(mockLayout)
    const parsed = JSON.parse(exported)

    // Verify all serialisable fields survive the round-trip.
    expect(parsed.version).toBe(mockLayout.version)
    expect(parsed.charts).toEqual(mockLayout.charts)
    expect(parsed.sections).toEqual(mockLayout.sections)
    expect(parsed.kpiCards).toHaveLength(mockLayout.kpiCards.length)
    expect(parsed.kpiCards[0].id).toBe(mockLayout.kpiCards[0].id)
  })

  it('imports layout from JSON string', () => {
    const jsonString = JSON.stringify(mockLayout)
    const imported = importLayout(jsonString)

    expect(imported).not.toBeNull()
    expect(imported!.version).toBe(mockLayout.version)
    expect(imported!.charts).toEqual(mockLayout.charts)
    expect(imported!.sections).toEqual(mockLayout.sections)
    expect(imported!.kpiCards).toHaveLength(mockLayout.kpiCards.length)
    expect(imported!.kpiCards[0].id).toBe(mockLayout.kpiCards[0].id)
  })

  it('returns null for invalid JSON', () => {
    const imported = importLayout('invalid json')
    expect(imported).toBeNull()
  })

  it('clears saved layout', () => {
    saveLayout(mockLayout)
    clearLayout()
    const loaded = loadLayout()
    
    expect(loaded).toBeNull()
  })

  it('handles version mismatch', () => {
    const oldLayout = { ...mockLayout, version: 0 }
    saveLayout(oldLayout)
    const loaded = loadLayout()
    
    // Should return null for version mismatch
    expect(loaded).toBeNull()
  })
})
