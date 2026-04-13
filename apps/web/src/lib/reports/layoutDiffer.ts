/**
 * Layout Differ
 * Compare layouts and highlight changes
 */

import type { LayoutConfig, LayoutDiff, KPICard, ChartConfig, SectionConfig } from './types'

/**
 * Compare two layouts and return the differences
 */
export function diffLayouts(current: LayoutConfig, preview: LayoutConfig): LayoutDiff {
  const diff: LayoutDiff = {
    added: [],
    removed: [],
    moved: [],
    resized: [],
    toggled: [],
  }

  // Compare KPI Cards
  const currentKPIIds = new Set(current.kpiCards.map((c) => c.id))
  const previewKPIIds = new Set(preview.kpiCards.map((c) => c.id))

  // Find added KPI cards
  preview.kpiCards.forEach((card) => {
    if (!currentKPIIds.has(card.id)) {
      diff.added.push(`KPI: ${card.title}`)
    }
  })

  // Find removed KPI cards
  current.kpiCards.forEach((card) => {
    if (!previewKPIIds.has(card.id)) {
      diff.removed.push(`KPI: ${card.title}`)
    }
  })

  // Find moved KPI cards
  const currentKPIOrder = current.kpiCards.map((c) => c.id)
  const previewKPIOrder = preview.kpiCards.map((c) => c.id)
  if (JSON.stringify(currentKPIOrder) !== JSON.stringify(previewKPIOrder)) {
    diff.moved.push('KPI cards reordered')
  }

  // Find toggled visibility
  current.kpiCards.forEach((currentCard) => {
    const previewCard = preview.kpiCards.find((c) => c.id === currentCard.id)
    if (previewCard && currentCard.visible !== previewCard.visible) {
      diff.toggled.push(`KPI: ${currentCard.title}`)
    }
  })

  // Compare Charts
  const currentChartIds = new Set(current.charts.map((c) => c.id))
  const previewChartIds = new Set(preview.charts.map((c) => c.id))

  // Find added charts
  preview.charts.forEach((chart) => {
    if (!currentChartIds.has(chart.id)) {
      diff.added.push(`Chart: ${chart.title}`)
    }
  })

  // Find removed charts
  current.charts.forEach((chart) => {
    if (!previewChartIds.has(chart.id)) {
      diff.removed.push(`Chart: ${chart.title}`)
    }
  })

  // Find resized charts
  current.charts.forEach((currentChart) => {
    const previewChart = preview.charts.find((c) => c.id === currentChart.id)
    if (previewChart && currentChart.size !== previewChart.size) {
      diff.resized.push(`Chart: ${currentChart.title}`)
    }
  })

  // Find moved charts
  const currentChartOrder = current.charts.map((c) => c.id)
  const previewChartOrder = preview.charts.map((c) => c.id)
  if (JSON.stringify(currentChartOrder) !== JSON.stringify(previewChartOrder)) {
    diff.moved.push('Charts reordered')
  }

  // Find toggled chart visibility
  current.charts.forEach((currentChart) => {
    const previewChart = preview.charts.find((c) => c.id === currentChart.id)
    if (previewChart && currentChart.visible !== previewChart.visible) {
      diff.toggled.push(`Chart: ${currentChart.title}`)
    }
  })

  // Compare Sections
  current.sections.forEach((currentSection) => {
    const previewSection = preview.sections.find((s) => s.id === currentSection.id)
    if (previewSection) {
      if (currentSection.visible !== previewSection.visible) {
        diff.toggled.push(`Section: ${currentSection.type}`)
      }
      if (currentSection.expanded !== previewSection.expanded) {
        diff.toggled.push(`Section expanded: ${currentSection.type}`)
      }
    }
  })

  return diff
}

/**
 * Check if there are any differences between layouts
 */
export function hasLayoutChanges(current: LayoutConfig, preview: LayoutConfig): boolean {
  const diff = diffLayouts(current, preview)
  return (
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.moved.length > 0 ||
    diff.resized.length > 0 ||
    diff.toggled.length > 0
  )
}

/**
 * Get a human-readable summary of changes
 */
export function getChangeSummary(diff: LayoutDiff): string {
  const parts: string[] = []

  if (diff.added.length > 0) {
    parts.push(`${diff.added.length} added`)
  }
  if (diff.removed.length > 0) {
    parts.push(`${diff.removed.length} removed`)
  }
  if (diff.moved.length > 0) {
    parts.push(`${diff.moved.length} moved`)
  }
  if (diff.resized.length > 0) {
    parts.push(`${diff.resized.length} resized`)
  }
  if (diff.toggled.length > 0) {
    parts.push(`${diff.toggled.length} toggled`)
  }

  return parts.length > 0 ? parts.join(', ') : 'No changes'
}
