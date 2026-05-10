import { describe, it, expect } from 'vitest'
import { diffLayouts, hasLayoutChanges, getChangeSummary } from '../../../../lib/reports/layoutDiffer'
import { LayoutConfig } from '../../../../lib/reports/types'
import { DollarSign, Package, ShoppingCart } from 'lucide-react'

describe('Layout Differ', () => {
  const baseLayout: LayoutConfig = {
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

  it('detects added KPI cards', () => {
    const newLayout: LayoutConfig = {
      ...baseLayout,
      kpiCards: [
        ...baseLayout.kpiCards,
        { id: 'bottles', title: 'Bottles', key: 'bottles', icon: ShoppingCart, visible: true },
      ],
    }

    const diff = diffLayouts(baseLayout, newLayout)
    expect(diff.added).toContain('KPI: Bottles')
  })

  it('detects removed KPI cards', () => {
    const newLayout: LayoutConfig = {
      ...baseLayout,
      kpiCards: [baseLayout.kpiCards[0]],
    }

    const diff = diffLayouts(baseLayout, newLayout)
    expect(diff.removed).toContain('KPI: Orders')
  })

  it('detects reordered KPI cards', () => {
    const newLayout: LayoutConfig = {
      ...baseLayout,
      kpiCards: [...baseLayout.kpiCards].reverse(),
    }

    const diff = diffLayouts(baseLayout, newLayout)
    expect(diff.moved).toContain('KPI cards reordered')
  })

  it('detects toggled visibility', () => {
    const newLayout: LayoutConfig = {
      ...baseLayout,
      kpiCards: [
        { ...baseLayout.kpiCards[0], visible: false },
        baseLayout.kpiCards[1],
      ],
    }

    const diff = diffLayouts(baseLayout, newLayout)
    expect(diff.toggled).toContain('KPI: Revenue')
  })

  it('detects resized charts', () => {
    const newLayout: LayoutConfig = {
      ...baseLayout,
      charts: [
        { ...baseLayout.charts[0], size: 'medium' },
      ],
    }

    const diff = diffLayouts(baseLayout, newLayout)
    expect(diff.resized).toContain('Chart: Revenue')
  })

  it('returns true when changes exist', () => {
    const newLayout: LayoutConfig = {
      ...baseLayout,
      kpiCards: [...baseLayout.kpiCards].reverse(),
    }

    expect(hasLayoutChanges(baseLayout, newLayout)).toBe(true)
  })

  it('returns false when no changes', () => {
    expect(hasLayoutChanges(baseLayout, baseLayout)).toBe(false)
  })

  it('generates human-readable summary', () => {
    const newLayout: LayoutConfig = {
      ...baseLayout,
      kpiCards: [
        ...baseLayout.kpiCards,
        { id: 'bottles', title: 'Bottles', key: 'bottles', icon: ShoppingCart, visible: true },
      ],
    }

    const diff = diffLayouts(baseLayout, newLayout)
    const summary = getChangeSummary(diff)
    
    expect(summary).toContain('added')
  })

  it('returns "No changes" for identical layouts', () => {
    const diff = diffLayouts(baseLayout, baseLayout)
    const summary = getChangeSummary(diff)
    
    expect(summary).toBe('No changes')
  })
})
