import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

/**
 * /house and /house/menu are the owner's first-house pages: the proof of the
 * menu, the plan, the first vendor and the invite (r36 onboarding gap 14).
 * The routes had no role, so a person on staff who typed the address, or
 * followed a "Read your menu" link (Promotions, Vendors), got the vendor and
 * menu forms and learnt only after pressing that the gateway refuses them.
 *
 * Staff are told, in words, who does this and given the desk. Not the
 * "Access Denied" card (it blames a permission and sends them to an
 * administrator), and not a silent move to the desk (a "Read your menu" link
 * that lands on the desk says nothing). An owner or a manager opens the page.
 * A role not known yet is left to the page (ProtectedRoute has already waited
 * for the session), so an owner is never turned away while it is read.
 */
export function HouseSetupOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role !== 'staff') return <>{children}</>
  return (
    <main className="min-h-screen bg-[#f7f4ee] flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-md bg-white border border-[#e4ddd0] rounded-2xl p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-[#2b2925]">The owner or a manager does this</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#5f5a52]">
          Reading the house&rsquo;s menu, adding its first vendor and inviting the team are done by the
          owner or a manager. If the menu needs reading, ask one of them.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block bg-[#1a5e6b] px-5 py-2.5 text-sm font-medium text-white rounded-lg"
        >
          Go to the desk
        </Link>
      </section>
    </main>
  )
}
