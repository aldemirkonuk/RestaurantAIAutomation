import { lazy, Suspense, ComponentType } from 'react'

/**
 * Wraps a dynamic import so that stale-chunk errors (after a new deploy)
 * trigger a one-time page reload instead of crashing the app with
 * "text/html is not a valid JavaScript MIME type".
 */
function lazyWithRefresh<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory().catch((err: Error) => {
      const isChunkError =
        err?.message?.includes('text/html') ||
        err?.message?.includes('Failed to fetch dynamically imported module') ||
        err?.message?.includes('error loading dynamically imported module')

      if (isChunkError && !sessionStorage.getItem('chunk_reload')) {
        sessionStorage.setItem('chunk_reload', '1')
        window.location.reload()
        // Return a never-resolving promise so React doesn't render anything
        return new Promise<never>(() => {})
      }

      throw err
    })
  )
}
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from './contexts/AuthContext'
import { RealtimeProvider } from './contexts/RealtimeContext'
import { WebSocketProvider } from './lib/websocket'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './contexts/ToastContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { PageLoader } from './components/ui/page-loader'
// SyncStatus disabled — floating bottom-right sync widget (re-enable when needed)
import { OfflineBanner } from './components/ui/SyncStatus'

// Layout
import { DashboardLayout } from './components/layout/DashboardLayout'
import { ProtectedRoute } from './components/ProtectedRoute'

// Critical pages (loaded immediately)
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { VerifyEmail } from './pages/VerifyEmail'
import { InviteLanding } from './pages/InviteLanding'
import { NoAccess } from './pages/NoAccess'
import { Inventory } from './pages/Inventory'
import { InventoryCommandPage } from './pages/inventory/command/InventoryCommandPage'
import { Orders } from './pages/Orders'
import { TeamCommandPage } from './pages/team/command/TeamCommandPage'

// Onboarding pages (lazy loaded)
const GetStarted = lazyWithRefresh(() => import('./pages/GetStarted'))

// Heavy pages (lazy loaded)
const Reports = lazyWithRefresh(() => import('./pages/Reports'))
const Recommendations = lazyWithRefresh(() => import('./pages/Recommendations'))
const InsightCatalog = lazyWithRefresh(() => import('./pages/InsightCatalog'))
const WineLibrary = lazyWithRefresh(() => import('./pages/wine-library'))
const SommelierAI = lazyWithRefresh(() => import('./pages/SommelierAI'))
const AdminPanel = lazyWithRefresh(() => import('./pages/AdminPanel'))
const AdminHealth = lazyWithRefresh(() => import('./pages/AdminHealth'))

// Standard pages (lazy loaded)
const Providers = lazyWithRefresh(() => import('./pages/Providers'))
const Promotions = lazyWithRefresh(() => import('./pages/Promotions'))
const Communications = lazyWithRefresh(() => import('./pages/Communications'))
const DocumentsPage = lazyWithRefresh(() => import('./pages/DocumentsPage'))
const Notifications = lazyWithRefresh(() => import('./pages/Notifications'))
const Calendar = lazyWithRefresh(() => import('./pages/Calendar'))
const CalendarModular = lazyWithRefresh(() => import('./pages/CalendarModular'))
const Onboarding = lazyWithRefresh(() => import('./pages/Onboarding').then(m => ({ default: m.Onboarding })))
const Settings = lazyWithRefresh(() => import('./pages/Settings'))
const Help = lazyWithRefresh(() => import('./pages/Help'))
const Profile = lazyWithRefresh(() => import('./pages/Profile'))

// Dev/Test pages
const DevSandbox = lazyWithRefresh(() => import('./pages/DevSandbox'))

// Studio pages — separate layout with StudioLayout
const Studio = lazyWithRefresh(() => import('./pages/studio/Studio'))
const StudioApprovalQueue = lazyWithRefresh(() => import('./pages/studio/StudioApprovalQueue'))
const StudioCertify = lazyWithRefresh(() => import('./pages/studio/StudioCertify'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000, // 5s - short enough that page navigations trigger background refetch
      refetchOnWindowFocus: true, // Refetch when user tabs back
      refetchOnMount: 'always', // Always refetch on component mount for fresh data
      retry: 1, // Only retry once
      throwOnError: false, // Don't throw errors to error boundary
    },
    mutations: {
      throwOnError: false, // Don't throw errors to error boundary
    },
  },
})

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AuthProvider>
              <WebSocketProvider>
                <RealtimeProvider>
                  <Router>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/invite/:code" element={<InviteLanding />} />
                <Route path="/no-access" element={<NoAccess />} />
                <Route path="/get-started" element={<GetStarted />} />
                <Route path="/onboarding" element={<Onboarding />} />

                {/* Studio routes — separate layout with StudioLayout, outside DashboardLayout */}
                <Route
                  path="/studio"
                  element={
                    <ProtectedRoute
                      requiredStudioRole={['developer', 'certified_contributor', 'review_admin']}
                    >
                      <Studio />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/queue"
                  element={
                    <ProtectedRoute requiredStudioRole={['developer', 'review_admin']}>
                      <StudioApprovalQueue />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/certify"
                  element={
                    <ProtectedRoute requiredStudioRole={['developer', 'review_admin']}>
                      <StudioCertify />
                    </ProtectedRoute>
                  }
                />

                {/* Protected Routes with Dashboard Layout */}
                <Route
                  element={
                    <ProtectedRoute>
                      <DashboardLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/inventory" element={<InventoryCommandPage />} />
                  <Route path="/inventory-legacy" element={<Inventory />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/wines" element={<WineLibrary />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/recommendations" element={<Recommendations />} />
                  <Route path="/recommendations/catalog" element={<InsightCatalog />} />
                  <Route path="/providers" element={<Providers />} />
                  <Route path="/promotions" element={<Promotions />} />
                  <Route path="/team" element={<TeamCommandPage />} />
                  <Route path="/calendar" element={<CalendarModular />} />
                  <Route path="/calendar-classic" element={<Calendar />} />
                  <Route path="/communications" element={<Communications />} />
                  <Route path="/documents-reports" element={<DocumentsPage />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/help" element={<Help />} />
                  <Route path="/admin" element={<AdminPanel />} />
                  <Route path="/admin/health" element={<AdminHealth />} />
                  
                  {/* AI Assistants */}
                  <Route path="/sommelier" element={<SommelierAI />} />
                  <Route path="/wine-agent" element={<PlaceholderPage title="Wine Agent" />} />
                  <Route path="/wineagent" element={<PlaceholderPage title="Wine Agent" />} />
                  <Route path="/services" element={<Navigate to="/settings?tab=services" replace />} />
                  
                  {/* Dev/Test Pages */}
                  <Route path="/dev-sandbox" element={<DevSandbox />} />
                </Route>

                {/* Catch all */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
                  </Router>
                </RealtimeProvider>

                {/* Toast Notifications */}
                <Toaster
                position="top-right"
                gap={12}
                toastOptions={{
                  unstyled: true,
                  classNames: {
                    toast:
                      'flex items-center gap-3 w-full max-w-sm p-4 bg-white rounded-xl border border-slate-200 shadow-lg',
                    title: 'text-sm font-semibold text-slate-900',
                    description: 'text-sm text-slate-500',
                    success: 'border-emerald-200 bg-emerald-50',
                    error: 'border-rose-200 bg-rose-50',
                    warning: 'border-amber-200 bg-amber-50',
                    info: 'border-blue-200 bg-blue-50',
                    actionButton:
                      'px-3 py-1.5 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800',
                    cancelButton: 'px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900',
                    closeButton: 'text-slate-400 hover:text-slate-600',
                  },
                }}
                closeButton
                richColors
                expand={false}
              />
                {/* Offline Banner - shows at top when offline */}
                <OfflineBanner />
                
                {/* Sync Status Indicator - disabled (was floating bottom-right)
                <SyncStatus position="bottom-right" />
                */}
              </WebSocketProvider>
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

// Placeholder page component for routes not yet implemented
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="h-16 px-6 flex items-center">
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        </div>
      </div>
      <div className="p-6">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-6">
            <span className="text-4xl">🚧</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{title}</h2>
          <p className="text-gray-500 max-w-md">
            This page is under construction. We're working hard to bring you this feature soon!
          </p>
        </div>
      </div>
    </div>
  )
}

export default App
