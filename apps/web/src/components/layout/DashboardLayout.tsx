import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { CommandProvider } from '../command/CommandProvider'
import { AskAiSurface } from '../askai/AskAiSurface'
import { GuidanceProvider } from '../../guidance/GuidanceProvider'
import { PageTipStrip } from '../../guidance/components/PageTipStrip'
import { SetupNudgeBanner } from '../../guidance/components/SetupNudgeBanner'
import { GuidanceLiveRegion } from '../../guidance/announce'
import { useUIStore } from '../../stores/uiStore'
import { cn } from '../../lib/utils'
import { BrandMark } from '../brand/BrandMark'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import { useMudavymDesign } from '../../lib/mudavym/useMudavymDesign'
import { HouseShell } from '../mudavym/HouseShell'
import { DataTermsSignInGate } from '../settings/DataTermsSignInGate'
import '../mudavym/sheet.css'

interface DashboardLayoutProps {
  children?: React.ReactNode
}

/**
 * The layout every signed-in route renders inside.
 *
 * Gated (the founder's pick of 2026-09-21, sketch 119 direction D): with the
 * `shell` gate on — the browser override `mudavym.design.shell`, else the
 * house flag `mudavym_design_shell`, else off — the Mudavym app shell renders
 * (`HouseShell`: the rooms rail, the house header, the counter, the phone's
 * four doors). Off, the legacy layout below renders exactly as it always has,
 * including while the flag check is in flight: the gate never flashes the new
 * shell at someone who is not meant to see it (useMudavymDesign.ts).
 */
export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <>
      <ShellByGate>{children}</ShellByGate>
      {/* ADR 0207 round 5 (question 19) — every owner, at their next
          sign-in, meets the house's data-and-privacy terms. Mounted here,
          outside both shells, so the Mudavym shell and the legacy layout
          both carry it; the sheet is portalled (Panel), so its position is
          only about mounting once per authenticated layout. */}
      <DataTermsSignInGate />
    </>
  )
}

function ShellByGate({ children }: DashboardLayoutProps) {
  const shellOn = useMudavymDesign('shell')
  if (shellOn) return <HouseShell>{children}</HouseShell>
  return <LegacyDashboardLayout>{children}</LegacyDashboardLayout>
}

function LegacyDashboardLayout({ children }: DashboardLayoutProps) {
  const location = useLocation()
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const shell = useMudavymShell()

  // Close mobile drawer on route change
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname, setSidebarOpen])

  // Esc closes mobile drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSidebarOpen])

  const desktopPad = sidebarCollapsed ? 'md:pl-[72px]' : 'md:pl-[260px]'

  return (
    <CommandProvider>
      <GuidanceProvider>
        <div className="min-h-screen bg-gray-50 safe-area-pad">
          {/* Mobile backdrop. Tokens only — the scrim is the one thing here
              that reads as part of the page under it, so while a Mudavym page
              is up it uses the house scrim (warm ink on paper, black on
              charcoal) instead of a flat black/40. Same element, same classes
              otherwise; ADR 0112. */}
          {sidebarOpen && (
            <button
              type="button"
              aria-label="Close navigation"
              className={
                shell.on
                  ? 'fixed inset-0 z-[45] md:hidden mdv-scrim'
                  : 'fixed inset-0 z-[45] bg-black/40 md:hidden'
              }
              data-ground={shell.on && shell.ground === 'charcoal' ? 'charcoal' : undefined}
              onClick={() => setSidebarOpen(false)}
            />
          )}

          <Sidebar />

          <div
            className={cn(
              'transition-all duration-300',
              'pl-0',
              desktopPad,
            )}
            id="main-content"
          >
            {/* Mobile top chrome */}
            <div className="sticky top-0 z-30 flex items-center justify-between gap-2 px-3 py-2 bg-white/90 backdrop-blur-md border-b border-gray-200 md:hidden safe-area-top">
              <button
                type="button"
                aria-label="Open navigation"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-gray-700 hover:bg-gray-100"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center">
                <BrandMark size={18} alt="Mudavym" />
              </div>
              <div className="w-11 h-11 shrink-0" aria-hidden />
            </div>

            <SetupNudgeBanner />
            <PageTipStrip />
            <GuidanceLiveRegion />
            <main className="min-h-screen pb-safe">{children || <Outlet />}</main>
          </div>

          {/* Ask AI (P3.C) — opened by ⌘⇧K, which CommandProvider registers. */}
          <AskAiSurface />
        </div>
      </GuidanceProvider>
    </CommandProvider>
  )
}

export { Sidebar } from './Sidebar'
export { Header } from './Header'
