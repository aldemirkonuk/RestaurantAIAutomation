import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { CommandProvider } from '../command/CommandProvider'

interface DashboardLayoutProps {
  children?: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <CommandProvider>
      <div className="min-h-screen bg-gray-50">
        {/* Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <div className="pl-[260px] transition-all duration-300" id="main-content">
          {/* Content */}
          <main className="min-h-screen">
            {children || <Outlet />}
          </main>
        </div>
      </div>
    </CommandProvider>
  )
}

// Export individual components for flexibility
export { Sidebar } from './Sidebar'
export { Header } from './Header'

