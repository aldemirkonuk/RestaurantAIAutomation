import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '../brand/BrandMark'
import { getOnboardingProgress } from '../../services/api/menus'

/**
 * What /house/menu says when this tab holds no first proof (r21, 2026-11-13).
 *
 * The proof lives only in the tab that read the menu (`firstProof.ts`,
 * sessionStorage). A new tab, another device, or a closed one used to say
 * "No menu has been read yet." with "Read a menu" → /get-started, which read
 * the menu again into a second draft. The house's own record answers the
 * question instead: a house whose menu is read (`menu_uploaded`, the
 * gateway's, per house since #1089) is sent to /menu, where the kept menu is
 * seen and chosen as current. Nothing is said until that answer is in; a
 * failed read keeps the old ask, since the page cannot tell.
 */
export function NoProofInThisTab() {
  const [kept, setKept] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    getOnboardingProgress()
      .then((progress) => {
        if (live) setKept(Boolean(progress?.menu_uploaded))
      })
      .catch(() => {
        if (live) setKept(false)
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-[#fbfaf7] px-6 py-16 text-[#211f1b]">
      <div className="mx-auto max-w-2xl" aria-busy={kept === null}>
        <Link to="/" aria-label="Mudavym, the desk">
          <BrandMark size={24} alt="" />
        </Link>
        {kept === null ? null : kept ? (
          <>
            <h1 className="mt-8 font-serif text-4xl">Your menu is read and kept.</h1>
            <p className="mt-4 text-[#6d685f]">
              The first proof shows only in the tab that read it. The menu itself is kept: see it, and
              choose it as the current menu, on Menu.
            </p>
            <Link to="/menu" className="mt-6 inline-block bg-[#1a5e6b] px-5 py-2.5 text-white">
              Open the menu
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-8 font-serif text-4xl">No menu has been read yet.</h1>
            <Link to="/get-started" className="mt-6 inline-block bg-[#1a5e6b] px-5 py-2.5 text-white">
              Read your menu
            </Link>
          </>
        )}
        {kept !== null && (
          <Link to="/" className="ml-6 mt-6 inline-block text-sm text-[#1a5e6b] underline underline-offset-4">
            Go to the desk
          </Link>
        )}
      </div>
    </div>
  )
}
