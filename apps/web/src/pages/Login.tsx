import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui'
import { Mail, Lock, AlertCircle, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'

const fieldClass =
  'block w-full pl-11 pr-3 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 shadow-sm transition-all focus:outline-none focus:border-wine-600 focus:ring-4 focus:ring-wine-600/10 disabled:opacity-60'

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, error: authError } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const searchParams = new URLSearchParams(location.search)
  const redirectQuery = searchParams.get('redirect')
  const from = redirectQuery || (location.state as { from?: { pathname: string } })?.from?.pathname || '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell title="WineOps AI" subtitle="Sign in to manage your wine inventory">
      <AuthCard>
        {(error || authError) && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" strokeWidth={1.75} />
            <div>
              <p className="text-sm font-medium text-red-900">Login Failed</p>
              <p className="text-sm text-red-700">{error || authError}</p>
            </div>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email Address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Mail className="h-[18px] w-[18px] text-wine-400" strokeWidth={1.75} />
              </div>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClass}
                placeholder="you@restaurant.com"
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Lock className="h-[18px] w-[18px] text-wine-400" strokeWidth={1.75} />
              </div>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClass}
                placeholder="••••••••"
                disabled={loading}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-wine-600 focus:ring-wine-600/30"
              />
              <span className="ml-2 text-sm text-gray-600">Remember me</span>
            </label>
            <Link
              to="/forgot-password"
              className="text-sm font-medium text-wine-600 hover:text-wine-700 transition-colors"
            >
              Forgot password?
            </Link>
          </div>

          <Button
            type="submit"
            variant="default"
            size="lg"
            className="w-full"
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </Button>

          <button
            type="button"
            onClick={async () => {
              setError(null)
              setLoading(true)
              try {
                await login('demo@gmail.com', 'demo123')
                navigate(from, { replace: true })
              } catch (err: any) {
                setError(err.message || 'Demo login failed. Run seed script first.')
              } finally {
                setLoading(false)
              }
            }}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-wine-700 hover:text-wine-800 hover:bg-wine-50 rounded-xl transition-colors border border-wine-200/80 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4 text-wine-500" strokeWidth={1.75} />
            Try Demo (demo@gmail.com)
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Don&apos;t have an account?{' '}
            <Link
              to="/register"
              className="font-semibold text-wine-600 hover:text-wine-700 transition-colors"
            >
              Create one now
            </Link>
          </p>
        </div>
      </AuthCard>
    </AuthShell>
  )
}
