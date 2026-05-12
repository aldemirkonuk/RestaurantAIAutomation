/**
 * Layout Engine
 * Core layout management logic for both legacy LayoutConfig and new DashboardBlock system.
 * Persistence is handled by the useUserPreferences hook at the component level.
 * These helpers now only deal with in-memory defaults, validation, and serialisation.
 */

import type { LayoutConfig } from './types'
import type { DashboardBlock, DashboardLayoutConfig } from '../../components/reports/dashboardTypes'
import { DEFAULT_BLOCKS } from '../../components/reports/dashboardMeta'

const LAYOUT_VERSION = 1
// Increment when DEFAULT_BLOCKS gains new block IDs that must be injected into saved layouts
const DASHBOARD_VERSION = 2

// ═══════════════════════════════════════════════════════════════════════
// Legacy layout functions
// ═══════════════════════════════════════════════════════════════════════

export function loadLayout(): LayoutConfig | null {
  return null
}

export function saveLayout(_config: LayoutConfig): void {
  /* no-op — persistence handled via useUserPreferences */
}

export function createPreviewLayout(
  currentLayout: LayoutConfig,
  changes: Partial<LayoutConfig>,
): LayoutConfig {
  return {
    ...currentLayout,
    ...changes,
    version: currentLayout.version,
  }
}

export function applyLayout(_config: LayoutConfig): void {
  /* no-op */
}

export function clearLayout(): void {
  /* no-op */
}

export function exportLayout(config: LayoutConfig): string {
  return JSON.stringify(config, null, 2)
}

export function importLayout(jsonString: string): LayoutConfig | null {
  try {
    const layout: LayoutConfig = JSON.parse(jsonString)
    if (!layout.kpiCards || !layout.charts || !layout.sections) {
      throw new Error('Invalid layout structure')
    }
    return layout
  } catch (error) {
    console.error('Failed to import layout:', error)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════
// New DashboardBlock layout functions
// ═══════════════════════════════════════════════════════════════════════

export function loadDashboardBlocks(): DashboardBlock[] | null {
  return null
}

export function saveDashboardBlocks(_blocks: DashboardBlock[]): void {
  /* no-op — persistence handled via useUserPreferences */
}

export function clearDashboardBlocks(): void {
  /* no-op */
}

export function parseLayoutFromPreferences(raw: unknown): LayoutConfig | null {
  try {
    const layout = raw as LayoutConfig
    if (layout && layout.version === LAYOUT_VERSION && layout.kpiCards && layout.charts && layout.sections) {
      return layout
    }
  } catch { /* ignore */ }
  return null
}

export function parseDashboardBlocksFromPreferences(raw: unknown): DashboardBlock[] | null {
  try {
    const config = raw as DashboardLayoutConfig
    if (config && Array.isArray(config.blocks) && config.blocks.length > 0) {
      // Merge: keep saved positions, but inject any new default blocks that are missing
      const savedIds = new Set(config.blocks.map((b) => b.id))
      const missing = DEFAULT_BLOCKS.filter((b) => !savedIds.has(b.id))
      return missing.length > 0 ? [...config.blocks, ...missing] : config.blocks
    }
  } catch { /* ignore */ }
  return null
}

export function serializeLayout(config: LayoutConfig): object {
  return { ...config, version: LAYOUT_VERSION }
}

export function serializeDashboardBlocks(blocks: DashboardBlock[]): DashboardLayoutConfig {
  return { blocks, version: DASHBOARD_VERSION }
}
