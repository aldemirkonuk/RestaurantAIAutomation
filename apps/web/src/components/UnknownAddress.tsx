import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ProtectedRoute } from './ProtectedRoute'
import { DashboardLayout } from './layout/DashboardLayout'
import { ShellCatchAll } from './mudavym/ShellCatchAll'

const BookNotFound = lazy(() => import('./brand/BookNotFound'))

/**
 * The catch-all route. It sits at the top level (it used to be nested under
 * DashboardLayout, whose sign-in guard turned every unknown address into the
 * sign-in screen for a visitor). Signed out: the book's 404. Anything else,
 * including while the session is still being read or held: exactly the guarded
 * shell the nested route used to render.
 */
export function UnknownAddress() {
  const { loading, isAuthenticated, sessionHeld } = useAuth()
  if (!loading && !isAuthenticated && !sessionHeld) {
    return (
      <Suspense fallback={null}>
        <BookNotFound />
      </Suspense>
    )
  }
  return (
    <Routes>
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="*" element={<ShellCatchAll />} />
      </Route>
    </Routes>
  )
}

export default UnknownAddress
