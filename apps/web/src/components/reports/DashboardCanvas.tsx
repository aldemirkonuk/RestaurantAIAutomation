/**
 * DashboardCanvas - Main grid container using react-grid-layout.
 *
 * Features:
 * - 12-column responsive grid
 * - Drag-and-drop block reordering (edit mode)
 * - Free resize with snap-to-grid + preset sizes (edit mode)
 * - Static layout in view mode
 * - Delegates rendering to DashboardBlock
 */

import { useCallback, useMemo, useRef } from 'react'
import { Responsive, WidthProvider, type LayoutItem, type ResponsiveLayouts } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import type { DashboardBlock as DashboardBlockType } from './dashboardTypes'
import { DashboardBlock } from './DashboardBlock'
import type { WineTypeDistribution, TopWine } from './molecules'

const ResponsiveGridLayout = WidthProvider(Responsive)

// ── Props ──────────────────────────────────────────────────────────────

interface DashboardCanvasProps {
  blocks: DashboardBlockType[]
  isEditMode: boolean
  onBlocksChange: (blocks: DashboardBlockType[]) => void
  // Data pass-through
  salesData: Array<{ date: string; revenue: number; bottles: number; orders?: number; red?: number; white?: number; sparkling?: number; rose?: number; dessert?: number }>
  wineTypeDistribution: WineTypeDistribution[]
  topWines: TopWine[]
  timeRange: string
  getKPIValue: (key: string) => { value: string | number; change: number; changeType: 'increase' | 'decrease' }
  onKPIClick?: (kpiKey: string) => void
  spotlightedKPI?: string | null
  totalOrders?: number
  totalRevenue?: number
  className?: string
}

// ── Row height & column count ──────────────────────────────────────────

const ROW_HEIGHT = 80
const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }
const MARGIN: [number, number] = [16, 16]

// ── Component ──────────────────────────────────────────────────────────

export function DashboardCanvas({
  blocks,
  isEditMode,
  onBlocksChange,
  salesData,
  wineTypeDistribution,
  topWines,
  timeRange,
  getKPIValue,
  onKPIClick,
  spotlightedKPI,
  totalOrders = 0,
  totalRevenue = 0,
  className = '',
}: DashboardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Derive react-grid-layout LayoutItem[] from blocks
  const layouts = useMemo((): ResponsiveLayouts => {
    const lg: LayoutItem[] = blocks
      .filter((b) => b.visible)
      .map((b) => ({
        i: b.id,
        x: b.layout.x,
        y: b.layout.y,
        w: b.layout.w,
        h: b.layout.h,
        minW: b.layout.minW ?? 2,
        minH: b.layout.minH ?? 2,
        static: !isEditMode,
      }))
    return { lg, md: lg, sm: lg, xs: lg, xxs: lg }
  }, [blocks, isEditMode])

  // Handle layout changes from drag/resize
  const handleLayoutChange = useCallback(
    (newLayout: readonly LayoutItem[]) => {
      if (!isEditMode) return

      const layoutMap = new Map(newLayout.map((l) => [l.i, l]))
      const updated = blocks.map((block) => {
        const l = layoutMap.get(block.id)
        if (!l) return block
        return {
          ...block,
          layout: {
            ...block.layout,
            x: l.x,
            y: l.y,
            w: l.w,
            h: l.h,
          },
        }
      })
      onBlocksChange(updated)
    },
    [blocks, isEditMode, onBlocksChange],
  )

  // Block update handler
  const handleBlockUpdate = useCallback(
    (updated: DashboardBlockType) => {
      onBlocksChange(blocks.map((b) => (b.id === updated.id ? updated : b)))
    },
    [blocks, onBlocksChange],
  )

  // Block delete handler
  const handleBlockDelete = useCallback(
    (id: string) => {
      onBlocksChange(blocks.filter((b) => b.id !== id))
    },
    [blocks, onBlocksChange],
  )

  const visibleBlocks = blocks.filter((b) => b.visible)

  if (!visibleBlocks.length) {
    return (
      <div className={`flex items-center justify-center py-20 ${className}`}>
        <div className="text-center">
          <p className="text-gray-400 text-sm">No blocks configured.</p>
          {isEditMode && (
            <p className="text-gray-400 text-xs mt-1">Use the toolbar above to add blocks.</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={`dashboard-canvas ${className}`}>
      {/* Custom styles for react-grid-layout */}
      <style>{`
        .dashboard-canvas .react-grid-item {
          transition: all 200ms ease;
        }
        .dashboard-canvas .react-grid-item.react-draggable-dragging {
          z-index: 100;
          opacity: 0.9;
          box-shadow: 0 20px 50px rgba(0,0,0,0.15);
        }
        .dashboard-canvas .react-grid-item > .react-resizable-handle {
          display: ${isEditMode ? 'block' : 'none'};
        }
        .dashboard-canvas .react-grid-item > .react-resizable-handle::after {
          border-color: rgb(147 197 253);
          width: 7px;
          height: 7px;
        }
        .dashboard-canvas .react-grid-placeholder {
          background: rgb(219 234 254) !important;
          border: 2px dashed rgb(96 165 250) !important;
          border-radius: 12px !important;
          opacity: 0.6 !important;
        }
      `}</style>

      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={MARGIN}
        containerPadding={[0, 0]}
        isDraggable={isEditMode}
        isResizable={isEditMode}
        draggableHandle=".drag-handle"
        onLayoutChange={handleLayoutChange}
        useCSSTransforms
        compactType="vertical"
        preventCollision={false}
      >
        {visibleBlocks.map((block) => (
          <div key={block.id}>
            <DashboardBlock
              block={block}
              isEditMode={isEditMode}
              onUpdate={handleBlockUpdate}
              onDelete={handleBlockDelete}
              salesData={salesData}
              wineTypeDistribution={wineTypeDistribution}
              topWines={topWines}
              timeRange={timeRange}
              getKPIValue={getKPIValue}
              onKPIClick={onKPIClick}
              spotlightedKPI={spotlightedKPI}
              totalOrders={totalOrders}
              totalRevenue={totalRevenue}
            />
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  )
}
