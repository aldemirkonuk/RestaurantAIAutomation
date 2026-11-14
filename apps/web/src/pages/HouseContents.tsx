import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/brand/BrandMark'
import { addCustomProvider } from '../services/api/vendors'
import { getErrorStatus, isUnconfirmedWrite } from '../services/api/client'
import { getOnboardingProgress } from '../services/api/menus'
import { proofStanding, readProof, type ProofStanding } from '../lib/firstProof'

/** The menu row's sentence for the first proof (r28 gap 6: never "in ink" over no drink). */
function proofSaid(standing: ProofStanding): string {
  switch (standing.kind) {
    case 'empty':
      return 'The first proof holds no lines yet.'
    case 'dishes-only':
      return `${standing.dishes} ${standing.dishes === 1 ? 'dish' : 'dishes'} read, set aside from the drinks. No drink was read.`
    case 'ink':
      return 'The first proof is set in ink.'
    case 'pencil':
      return `${standing.lines} ${standing.lines === 1 ? 'line' : 'lines'} in pencil, worth a second look`
  }
}

/**
 * Why a vendor was not added, in the house's words (r28 gap 13). The page
 * printed the gateway's `message` as it came: a validation refusal is an
 * array of field notes ("name must be shorter than…"), and a database
 * refusal names a constraint. Said from the status alone.
 */
function vendorNotSaved(cause: unknown, name: string): string {
  if (isUnconfirmedWrite(cause)) {
    return `We could not tell whether ${name} was saved: the connection dropped. Look on Vendors before adding it again.`
  }
  const status = getErrorStatus(cause)
  if (status === 409) {
    // The gateway names the vendor it already holds (a folded match: "ege  supply"
    // against "Ege Supply"), so the sentence names that one, not what was typed.
    const held = (cause as { response?: { data?: { existingName?: unknown } } })?.response?.data?.existingName
    const known = typeof held === 'string' && held.trim() !== '' ? held.trim() : name
    return `${known} is already on your vendors.`
  }
  if (status === 400 || status === 422) return 'That name could not be saved as it is. Try it shorter, or add the vendor on Vendors.'
  if (status === 401 || status === 403) return 'This account cannot add vendors to this house. An owner or a manager can.'
  return `We could not add ${name} just now. Try again, or add it on Vendors.`
}

export default function HouseContents() {
  const navigate = useNavigate()
  const proof = readProof()
  const standing = proof ? proofStanding(proof.items) : null
  const [supplier, setSupplier] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The supplier asked here is on the house's row (vendor_added), not in this
  // page's state: after a reload it asked "Who supplies you?" again (walk
  // 2026-11-11). A failed or absent read leaves the ask, as before.
  const [supplierOnBook, setSupplierOnBook] = useState(false)
  // The same read answers the menu row when this tab holds no first proof
  // (r21): "No menu read yet." was said, with nothing to press, to a house
  // whose menu was read in another tab, and after "Skip for now" the row
  // had no way back to reading one. Null until the read is in.
  const [menuKept, setMenuKept] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    getOnboardingProgress()
      .then((progress) => {
        if (!live) return
        if (progress?.vendor_added) setSupplierOnBook(true)
        setMenuKept(Boolean(progress?.menu_uploaded))
      })
      .catch(() => {
        if (live) setMenuKept(false)
      })
    return () => {
      live = false
    }
  }, [])

  const saveSupplier = async () => {
    if (!supplier.trim()) return
    setSaving(true)
    setError(null)
    try {
      // One request: creating the provider marks `vendor_added` on the
      // house's onboarding row itself (providers.service.ts createProvider).
      await addCustomProvider({ name: supplier.trim() })
      setSaved(true)
    } catch (cause) {
      setError(vendorNotSaved(cause, supplier.trim()))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#211f1b]">
      <header className="h-14 border-b border-[#211f1b]/15 bg-white px-5 flex items-center justify-between">
        <Link to="/" aria-label="Mudavym, the desk">
          <BrandMark size={24} alt="" />
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6d685f]">The house</span>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">The house is open</p>
        <h1 className="mt-3 font-serif text-5xl">Your house.</h1>
        <p className="mt-4 text-[#6d685f]">One thing at a time. The rest can wait.</p>

        <div className="mt-12 divide-y divide-[#211f1b]/15 border-y border-[#211f1b]/15">
          <div className="py-6">
            <p className="text-xs uppercase tracking-wider text-[#6d685f]">Menu</p>
            {proof ? (
              <button
                type="button"
                onClick={() => navigate('/house/menu')}
                className="mt-2 block text-left font-serif text-2xl"
              >
                {standing && proofSaid(standing)}
              </button>
            ) : menuKept === null ? null : menuKept ? (
              <p className="mt-2 font-serif text-2xl">
                Your menu is read and kept.{' '}
                <Link to="/menu" className="font-sans text-sm underline underline-offset-4">
                  See it on Menu
                </Link>
              </p>
            ) : (
              <p className="mt-2 font-serif text-2xl text-[#6d685f]">
                No menu read yet.{' '}
                <Link to="/get-started" className="font-sans text-sm text-[#1a5e6b] underline underline-offset-4">
                  Read your menu
                </Link>
              </p>
            )}
          </div>

          {saved ? (
            <p className="py-6 font-serif text-2xl">{supplier.trim()} is saved as your vendor.</p>
          ) : supplierOnBook ? (
            <p className="py-6 font-serif text-2xl">
              Your vendor is saved.{' '}
              <Link to="/vendors" className="font-sans text-sm underline underline-offset-4">
                See vendors
              </Link>
            </p>
          ) : (
            <form
              className="py-6"
              onSubmit={(event) => {
                event.preventDefault()
                void saveSupplier()
              }}
            >
              <p className="text-xs uppercase tracking-wider text-[#1a5e6b]">Optional</p>
              <label className="mt-2 block">
                {/* "Vendor", as the sidebar, the setup checklist and /vendors say it (r28 gap 13). */}
                <span className="font-serif text-2xl">Who is your first vendor?</span>
                <input
                  aria-label="Vendor"
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                  placeholder="A name is enough"
                  className="mt-3 block w-full border-b border-[#211f1b]/25 bg-transparent pb-2 text-lg outline-none"
                />
              </label>
              {error && (
                <p role="alert" className="mt-3 text-sm text-red-700">
                  {error}{' '}
                  <Link to="/vendors" className="underline underline-offset-4">
                    Open Vendors
                  </Link>
                </p>
              )}
              <button
                type="submit"
                disabled={!supplier.trim() || saving}
                className="mt-5 bg-[#1a5e6b] px-5 py-2.5 text-white disabled:opacity-40"
              >
                {saving ? 'Adding…' : 'Add this vendor'}
              </button>
            </form>
          )}

          {/* H-1: nothing is kept here. Receipts is where an invoice is read. */}
          <p className="py-6 font-serif text-2xl text-[#b7b2a8]">
            <span className="block text-xs uppercase tracking-[0.12em]">Later · not required</span>
            <span className="mt-2 block">
              Your last invoice can be read on{' '}
              <Link to="/receipts" className="underline underline-offset-4">
                Receipts
              </Link>{' '}
              whenever you want.
            </span>
          </p>

          <p className="py-6 font-serif text-2xl text-[#b7b2a8]">
            <span className="block text-xs uppercase tracking-[0.12em]">Later · not required</span>
            <span className="mt-2 block">Which drinks the house pours: wine, beer, spirits, cocktails.</span>
            <button
              type="button"
              onClick={() => navigate('/settings?tab=cellar')}
              className="mt-2 font-sans text-sm underline underline-offset-4"
            >
              Set it in Settings
            </button>
          </p>
        </div>

        <Link
          to="/"
          className="mt-10 inline-block bg-[#1a5e6b] px-5 py-2.5 text-white"
        >
          Go to the desk
        </Link>
      </main>
    </div>
  )
}
