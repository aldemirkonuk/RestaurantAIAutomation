import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Wine, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export function NoAccess() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50 px-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8 text-center"
      >
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 bg-wine-600 rounded-2xl flex items-center justify-center shadow-lg">
            <Wine className="w-7 h-7 text-white" />
          </div>
        </div>
        <h1 className="text-lg font-semibold text-gray-900">No restaurant access</h1>
        <p className="text-sm text-gray-500 mt-3">
          {user?.email ? (
            <>
              You&apos;re signed in as <span className="font-medium text-gray-700">{user.email}</span>, but
              you don&apos;t have access to a restaurant workspace yet.
            </>
          ) : (
            <>You don&apos;t have access to a restaurant workspace.</>
          )}
        </p>
        <p className="text-sm text-gray-500 mt-2">Ask an owner to send you an invite link.</p>
        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center justify-center gap-2 w-full bg-wine-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-wine-700"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
          <Link
            to="/login"
            className="inline-block w-full text-center border border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50"
          >
            Back to sign in
          </Link>
        </div>
      </motion.div>
    </div>
  )
}
