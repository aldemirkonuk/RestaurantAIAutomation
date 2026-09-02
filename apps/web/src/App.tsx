import { lazy, Suspense, ComponentType } from 'react'

/**
 * Wraps a dynamic import so that stale-chunk errors (after a new deploy)
 * trigger a one-time page reload instead of crashing the app.
 * Covers Chromium ("Failed to fetch dynamically imported module"),
 * Firefox ("error loading dynamically imported module"), and
 * Safari ("Importing a module script failed").
 */
function isStaleChunkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const lower = message.toLowerCase()
  return (
    lower.includes('text/html') ||
    lower.includes('failed to fetch dynamically imported module') ||
    lower.includes('error loading dynamically imported module') ||
    lower.includes('importing a module script failed') ||
    lower.includes('loading chunk') ||
    lower.includes('chunkloaderror')
  )
}

function lazyWithRefresh<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory()
      .then((mod) => {
        // Successful load after a deploy-recovery reload — allow future recoveries.
        sessionStorage.removeItem('chunk_reload')
        return mod
      })
      .catch((err: Error) => {
        if (isStaleChunkError(err) && !sessionStorage.getItem('chunk_reload')) {
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
import { ForgotPassword } from './pages/ForgotPassword'
import { ResetPassword } from './pages/ResetPassword'
import { VerifyEmail } from './pages/VerifyEmail'
import { InviteLanding } from './pages/InviteLanding'
import { NoAccess } from './pages/NoAccess'
import { InventoryCommandPage } from './pages/inventory/command/InventoryCommandPage'
import { Orders } from './pages/Orders'
import { PageGate } from './components/mudavym'
import { TeamCommandPage } from './pages/team/command/TeamCommandPage'

// Onboarding pages (lazy loaded)
// Mudavym redesign variants (ADR 0044) — reachable only behind their per-page flag
const DashboardNext = lazyWithRefresh(() => import('./pages/dashboard/next/DashboardNext'))
const OrdersNext = lazyWithRefresh(() => import('./pages/orders/next/OrdersNext'))
const ReceivingNext = lazyWithRefresh(() => import('./pages/receiving/next/ReceivingNext'))
const DoorNext = lazyWithRefresh(() => import('./pages/receiving/next/DoorNext'))
const ProvidersNext = lazyWithRefresh(() => import('./pages/providers/next/ProvidersNext'))
const CommunicationsNext = lazyWithRefresh(() => import('./pages/communications/next/CommunicationsNext'))
const TeamNext = lazyWithRefresh(() => import('./pages/team/next/TeamNext'))
const ReceiptsNext = lazyWithRefresh(() => import('./pages/receipts/next/ReceiptsNext'))
const DocumentsReportsNext = lazyWithRefresh(() => import('./pages/documents-reports/next/DocumentsReportsNext'))
const GetStarted = lazyWithRefresh(() => import('./pages/GetStarted'))
const DoorReceipt = lazyWithRefresh(() => import('./pages/receiving/DoorReceipt'))
const ReceivingHome = lazyWithRefresh(() => import('./pages/receiving/ReceivingHome'))
const SimposTerminalPage = lazyWithRefresh(() => import('./pages/simpos/SimposTerminalPage'))
const SimposOrderLogPage = lazyWithRefresh(() => import('./pages/simpos/SimposOrderLogPage'))

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
const ReceiptsPage = lazyWithRefresh(() => import('./pages/ReceiptsPage'))
const LogsTimelinePage = lazyWithRefresh(() => import('./pages/LogsTimelinePage'))
const Notifications = lazyWithRefresh(() => import('./pages/Notifications'))
const CalendarModular = lazyWithRefresh(() => import('./pages/CalendarModular'))
const Onboarding = lazyWithRefresh(() => import('./pages/Onboarding').then(m => ({ default: m.Onboarding })))
const Settings = lazyWithRefresh(() => import('./pages/Settings'))
const Help = lazyWithRefresh(() => import('./pages/Help'))
const Profile = lazyWithRefresh(() => import('./pages/Profile'))
const AuthorizeIntegration = lazyWithRefresh(() => import('./pages/AuthorizeIntegration'))
const Privacy = lazyWithRefresh(() => import('./pages/Privacy'))
// Public vendor catalogue — resolved by slug, also served on a vendors.* subdomain.
const VendorPortal = lazyWithRefresh(() => import('./pages/VendorPortal'))
// Owner/manager only — vendor pricing is the restaurant's negotiating position.
const VendorPriceCompare = lazyWithRefresh(() => import('./pages/VendorPriceCompare'))
const DevTruth = lazyWithRefresh(() => import('./pages/DevTruth'))

// Dev/Test pages
const DevSandbox = lazyWithRefresh(() => import('./pages/DevSandbox'))

// Studio pages — separate layout with StudioLayout
const Studio = lazyWithRefresh(() => import('./pages/studio/Studio'))
const StudioApprovalQueue = lazyWithRefresh(() => import('./pages/studio/StudioApprovalQueue'))
const StudioCertify = lazyWithRefresh(() => import('./pages/studio/StudioCertify'))
const StudioInviteRedeem = lazyWithRefresh(() => import('./pages/studio/StudioInviteRedeem'))

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
                  <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/invite/:code" element={<InviteLanding />} />
                <Route path="/no-access" element={<NoAccess />} />
                {/* Public: linked from the auth screens and the consent page, so
                    it must be readable before you have an account. */}
                <Route path="/privacy" element={<Privacy />} />
                {/* Public vendor catalogue. No auth: this is what a vendor chose
                    to publish, and our own ingester reads it back as structured data. */}
                <Route path="/v/:slug" element={<VendorPortal />} />
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
                {/*
                  Authenticated but deliberately NOT studio-role gated (ADR 0020): the
                  invitee has no studio role yet — granting one is what this page does.
                  A logged-out invitee is bounced to /login, which returns them here via
                  location.state.from (Login.tsx:36,53), so the token survives the detour.
                */}
                <Route
                  path="/studio/invite/:token"
                  element={
                    <ProtectedRoute>
                      <StudioInviteRedeem />
                    </ProtectedRoute>
                  }
                />

                {/*
                  Door receiving — deliberately outside DashboardLayout.
                  It is full-screen and one-handed, used at a loading dock by
                  someone who is not navigating the app. Sidebar, tips and the
                  agent FAB would all be taps in the way of a driver waiting.
                */}
                <Route
                  path="/receiving/:orderId/door"
                  element={
                    <ProtectedRoute>
                      <PageGate page="receiving_door" legacy={<DoorReceipt />} next={<DoorNext />} />
                    </ProtectedRoute>
                  }
                />

                {/*
                  SimPOS terminal — chrome-free on purpose (decision C26).
                  A fake POS used to drive real traffic into Mudavym; sidebar
                  and agent chrome would break the terminal illusion. Mapped
                  to a Vercel subdomain rewrite in production.
                */}
                <Route
                  path="/simpos/:restaurantId"
                  element={
                    <ProtectedRoute>
                      {import.meta.env.PROD ? <Navigate to="/" replace /> : <SimposTerminalPage />}
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/simpos/:restaurantId/orders"
                  element={
                    <ProtectedRoute>
                      {import.meta.env.PROD ? <Navigate to="/" replace /> : <SimposOrderLogPage />}
                    </ProtectedRoute>
                  }
                />

                {/*
                  Third-party authorization consent — outside DashboardLayout on
                  purpose. It is a decision point on the way to an external
                  provider, so sidebar navigation and page tips would only offer
                  ways to wander off mid-grant.
                */}
                <Route
                  path="/authorize/:integrationId"
                  element={
                    <ProtectedRoute>
                      <AuthorizeIntegration />
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
                  <Route path="/" element={<PageGate page="dashboard" legacy={<Dashboard />} next={<DashboardNext />} />} />
                  <Route path="/inventory" element={<InventoryCommandPage />} />
                  {/* `/inventory-legacy` is retired (ADR 0019 §B). It redirects
                      rather than 404s because every capability it had was ported
                      onto `/inventory` first — a bookmark lands somewhere that can
                      still do the job. Without this it fell to the catch-all and
                      landed on the Dashboard, which reads as a broken app. */}
                  <Route path="/inventory-legacy" element={<Navigate to="/inventory" replace />} />
                  <Route path="/orders" element={<PageGate page="orders" legacy={<Orders />} next={<OrdersNext />} />} />
                  {/* One event, three renderings, chosen by role — see ReceivingHome. */}
                  <Route path="/receiving" element={<PageGate page="receiving" legacy={<ReceivingHome />} next={<ReceivingNext />} />} />
                  <Route path="/wines" element={<WineLibrary />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/recommendations" element={<Recommendations />} />
                  <Route path="/recommendations/catalog" element={<InsightCatalog />} />
                  <Route path="/providers" element={<PageGate page="providers" legacy={<Providers />} next={<ProvidersNext />} />} />
                  {/* Vendor price comparison. Role gate is enforced server-side
                      too (owner/manager on /vendor-intel/*) — a hidden route is
                      not access control. */}
                  <Route path="/vendor-prices" element={<VendorPriceCompare />} />
                  {/* dev/truth — three instruments that make the product's own
                      numbers checkable (reach · as-of · swallow). The gateway
                      routes behind them 404 in production, so this renders its
                      own failure there rather than a blank screen. Throwaway:
                      delete when the claims stop needing checking. */}
                  <Route path="/dev/truth" element={<DevTruth />} />
                  {/* Discovery moved into Providers as a tab; keep the old path
                      working so existing links and bookmarks land in the right place. */}
                  <Route
                    path="/distributors"
                    element={<Navigate to="/providers?tab=discover" replace />}
                  />
                  <Route path="/promotions" element={<Promotions />} />
                  <Route path="/team" element={<PageGate page="team" legacy={<TeamCommandPage />} next={<TeamNext />} />} />
                  <Route path="/calendar" element={<CalendarModular />} />
                  {/* Same reasoning as `/inventory-legacy` above: `/calendar-classic`
                      is retired (ADR 0019 §B) and its one exclusive — reminders that
                      actually fire — was ported onto `/calendar` first. */}
                  <Route path="/calendar-classic" element={<Navigate to="/calendar" replace />} />
                  <Route path="/communications" element={<PageGate page="communications" legacy={<Communications />} next={<CommunicationsNext />} />} />
                  <Route path="/documents-reports" element={<PageGate page="documents_reports" legacy={<DocumentsPage />} next={<DocumentsReportsNext />} />} />
                  <Route path="/receipts" element={<PageGate page="receipts" legacy={<ReceiptsPage />} next={<ReceiptsNext />} />} />
                  <Route path="/credits" element={<Navigate to="/receipts?tab=credits" replace />} />
                  <Route path="/logs" element={<LogsTimelinePage />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/help" element={<Help />} />
                  {/* Gated: the sidebar link is owner-only, but the URL was not —
                      any authenticated staff member could open the admin UI. */}
                  <Route path="/admin" element={<ProtectedRoute requiredRole="owner"><AdminPanel /></ProtectedRoute>} />
                  <Route path="/admin/health" element={<ProtectedRoute requiredRole="owner"><AdminHealth /></ProtectedRoute>} />
                  
                  {/* AI Assistants.
                      `/wine-agent` and `/wineagent` are retired (ADR 0019 §B): both
                      rendered the same under-construction placeholder with no
                      behaviour behind it. Everything that said "Wine Agent" in the
                      UI already navigated to `/sommelier`, which is the real
                      inventory & ordering help surface. */}
                  <Route path="/sommelier" element={<SommelierAI />} />
                  <Route path="/services" element={<Navigate to="/settings?tab=services" replace />} />
                  
                  {/* Dev/Test Pages */}
                  <Route path="/dev-sandbox" element={<ProtectedRoute requiredRole="owner"><DevSandbox /></ProtectedRoute>} />
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

export default App
