import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { CommandProvider } from '../command/CommandProvider'
import { GuidanceProvider } from '../../guidance/GuidanceProvider'
import { PageTipStrip } from '../../guidance/components/PageTipStrip'
import { WineAgentFab } from '../../guidance/components/WineAgentFab'
import { TourHelpButton } from '../../guidance/components/TourHelpButton'

interface DashboardLayoutProps {
  children?: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <CommandProvider>
      <GuidanceProvider>
        <div className="min-h-screen bg-gray-50">
          <Sidebar />

          <div className="pl-[260px] transition-all duration-300" id="main-content">
            <div className="sticky top-0 z-10 flex justify-end px-4 pt-2 pointer-events-none">
              <div className="pointer-events-auto">
                <TourHelpButton />
              </div>
            </div>
            <PageTipStrip />
            <main className="min-h-screen">{children || <Outlet />}</main>
          </div>

          <WineAgentFab />
        </div>
      </GuidanceProvider>
    </CommandProvider>
  )
}

export { Sidebar } from './Sidebar'
export { Header } from './Header'
