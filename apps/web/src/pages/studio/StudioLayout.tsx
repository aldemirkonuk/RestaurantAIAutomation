import { Link, useLocation } from 'react-router-dom'
import { Wine } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Badge } from '../../components/ui/badge'

interface StudioLayoutProps {
  children: React.ReactNode
}

const ROLE_BADGE_MAP: Record<string, string> = {
  developer: 'Developer',
  review_admin: 'Review Admin',
  certified_contributor: 'Certified Contributor',
}

export function StudioLayout({ children }: StudioLayoutProps) {
  const { user } = useAuth()
  const location = useLocation()
  const studioRoles = user?.studioRoles ?? []
  const primaryRole = studioRoles.includes('review_admin')
    ? 'review_admin'
    : studioRoles.includes('developer')
    ? 'developer'
    : 'certified_contributor'

  const isActive = (path: string) => location.pathname === path

  return (
    <div className="min-h-screen bg-[#F7F8F9] flex flex-col">
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 h-14 flex items-center px-6">
        <div className="flex items-center gap-2 mr-8">
          <Wine className="w-5 h-5 text-wine-600" />
          <span className="font-semibold text-slate-900 text-sm">Mudavym Studio</span>
        </div>
        <nav className="flex items-center gap-1 flex-1">
          <Link
            to="/studio"
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              isActive('/studio')
                ? 'text-wine-600 border-b-2 border-wine-600'
                : 'text-slate-500 hover:text-slate-700 rounded-md'
            }`}
          >
            Studio
          </Link>
          {(primaryRole === 'review_admin' || primaryRole === 'developer') && (
            <>
              <Link
                to="/studio/queue"
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  isActive('/studio/queue')
                    ? 'text-wine-600 border-b-2 border-wine-600'
                    : 'text-slate-500 hover:text-slate-700 rounded-md'
                }`}
              >
                Queue
              </Link>
              <Link
                to="/studio/certify"
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  isActive('/studio/certify')
                    ? 'text-wine-600 border-b-2 border-wine-600'
                    : 'text-slate-500 hover:text-slate-700 rounded-md'
                }`}
              >
                Certify
              </Link>
            </>
          )}
        </nav>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs">
            {ROLE_BADGE_MAP[primaryRole] ?? 'Studio User'}
          </Badge>
          <div className="w-8 h-8 rounded-full bg-wine-100 text-wine-600 text-xs font-semibold flex items-center justify-center">
            {user?.name?.slice(0, 2).toUpperCase() ?? 'U'}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
