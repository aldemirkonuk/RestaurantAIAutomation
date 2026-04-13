import { lazy, Suspense } from 'react'
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
import { SyncStatus, OfflineBanner } from './components/ui/SyncStatus'

// Layout
import { DashboardLayout } from './components/layout/DashboardLayout'
import { ProtectedRoute } from './components/ProtectedRoute'

// Critical pages (loaded immediately)
import { Dashboard } from './pages/dashboard'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Inventory } from './pages/inventory'
import { Orders } from './pages/orders'

// Heavy pages (lazy loaded)
const Reports = lazy(() => import('./pages/Reports'))
const WineLibrary = lazy(() => import('./pages/wine-library'))
const SommelierAI = lazy(() => import('./pages/SommelierAI'))
const AdminPanel = lazy(() => import('./pages/AdminPanel'))
const AdminHealth = lazy(() => import('./pages/AdminHealth'))

// Standard pages (lazy loaded)
const Providers = lazy(() => import('./pages/Providers'))
const Communications = lazy(() => import('./pages/Communications'))
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Calendar = lazy(() => import('./pages/calendar'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const Settings = lazy(() => import('./pages/Settings'))

// Dev/Test pages
const DevSandbox = lazy(() => import('./pages/DevSandbox'))

// Studio pages — separate layout with StudioLayout
const Studio = lazy(() => import('./pages/studio/Studio'))
const StudioApprovalQueue = lazy(() => import('./pages/studio/StudioApprovalQueue'))
const StudioCertify = lazy(() => import('./pages/studio/StudioCertify'))

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
                  <Route path="/inventory" element={<Inventory />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/wines" element={<WineLibrary />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/providers" element={<Providers />} />
                  <Route path="/team" element={<PlaceholderPage title="Team" />} />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/communications" element={<Communications />} />
                  <Route path="/documents-reports" element={<DocumentsPage />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/help" element={<PlaceholderPage title="Help & Support" />} />
                  <Route path="/admin" element={<AdminPanel />} />
                  <Route path="/admin/health" element={<AdminHealth />} />
                  
                  {/* AI Assistants */}
                  <Route path="/sommelier" element={<SommelierAI />} />
                  <Route path="/wine-agent" element={<PlaceholderPage title="Wine Agent" />} />
                  
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
                
                {/* Sync Status Indicator - floating at bottom right */}
                <SyncStatus position="bottom-right" />
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
