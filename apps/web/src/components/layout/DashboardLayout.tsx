import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { CommandProvider } from '../command/CommandProvider'
import { GuidanceProvider } from '../../guidance/GuidanceProvider'
import { PageTipStrip } from '../../guidance/components/PageTipStrip'
import { SetupNudgeBanner } from '../../guidance/components/SetupNudgeBanner'
import { WineAgentFab } from '../../guidance/components/WineAgentFab'
import { GuidanceLiveRegion } from '../../guidance/announce'
import { useUIStore } from '../../stores/uiStore'
import { cn } from '../../lib/utils'
import { BrandMark } from '../brand/BrandMark'

interface DashboardLayoutProps {
  children?: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const location = useLocation()
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)

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
          {/* Mobile backdrop */}
          {sidebarOpen && (
            <button
              type="button"
              aria-label="Close navigation"
              className="fixed inset-0 z-[45] bg-black/40 md:hidden"
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
              <div className="flex items-center gap-2">
                <BrandMark size={24} alt="" />
                <span className="text-sm font-bold text-gray-900">WineOps AI</span>
              </div>
              <div className="w-11 h-11 shrink-0" aria-hidden />
            </div>

            <SetupNudgeBanner />
            <PageTipStrip />
            <GuidanceLiveRegion />
            <main className="min-h-screen pb-safe">{children || <Outlet />}</main>
          </div>

          <WineAgentFab />
        </div>
      </GuidanceProvider>
    </CommandProvider>
  )
}

export { Sidebar } from './Sidebar'
export { Header } from './Header'
