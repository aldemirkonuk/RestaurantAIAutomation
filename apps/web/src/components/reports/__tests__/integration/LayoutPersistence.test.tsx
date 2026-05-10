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

  it('saves and loads layout from localStorage', () => {
    saveLayout(mockLayout)
    const loaded = loadLayout()
    
    expect(loaded).toEqual(mockLayout)
  })

  it('returns null when no layout saved', () => {
    const loaded = loadLayout()
    expect(loaded).toBeNull()
  })

  it('exports layout as JSON string', () => {
    const exported = exportLayout(mockLayout)
    const parsed = JSON.parse(exported)
    
    expect(parsed).toEqual(mockLayout)
  })

  it('imports layout from JSON string', () => {
    const jsonString = JSON.stringify(mockLayout)
    const imported = importLayout(jsonString)
    
    expect(imported).toEqual(mockLayout)
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
