import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/brand/BrandMark'
import { addCustomProvider } from '../services/api/vendors'
import { pencilledCount, readProof } from '../lib/firstProof'
import { useOnboardingProgress } from '../hooks/queries/useOnboardingProgress'

/**
 * /house: the house's contents after it opens. What it says about the menu
 * and the supplier comes from the server's read of the house itself (OB-1),
 * so a new tab, a closed tab or another device tells the same truth; the
 * tab's own first proof is only a fallback while that read is not back.
 * One next ask at a time: read the menu, choose it, then count the shelf.
 */
export default function HouseContents() {
  const navigate = useNavigate()
  const { progress, refresh } = useOnboardingProgress()
  const proof = readProof()
  const pencilled = proof ? pencilledCount(proof.items) : 0
  const [supplier, setSupplier] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const menuCurrent = progress?.menu_current === true
  const menuRead = !!progress?.menu_uploaded
  const supplierOnBook = !!progress?.vendor_added

  const saveSupplier = async () => {
    if (!supplier.trim()) return
    setSaving(true)
    setError(null)
    try {
      // One request: the house's setup reads its suppliers from the book
      // itself (OB-1), so nothing else is written. The re-read below is what
      // the sidebar checklist and the nudge then show.
      await addCustomProvider({ name: supplier.trim() })
      setSaved(true)
      void refresh()
    } catch (cause: any) {
      setError(cause?.response?.data?.message || cause?.message || 'We could not add that supplier yet.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mudavym min-h-screen bg-paper-0 text-inkm-1">
      <header className="h-14 border-b border-paper-2 bg-paper-0 px-5 flex items-center justify-between">
        <Link to="/" aria-label="Mudavym, the desk">
          <BrandMark size={24} alt="" />
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-inkm-3">The house</span>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">Contents</p>
        <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Your house.</h1>
        <p className="mt-4 text-inkm-3">One thing at a time. The rest can wait.</p>

        <div className="mt-12 divide-y divide-paper-2 border-y border-paper-2">
          <div className="py-6">
            <p className="text-xs uppercase tracking-wider text-inkm-3">Menu</p>
            {menuCurrent ? (
              <>
                <p className="mt-2 font-serif text-2xl">The menu is current.</p>
                <Link to="/menu" className="mt-2 inline-block text-sm underline underline-offset-4">
                  Open the menu
                </Link>
              </>
            ) : menuRead ? (
              <button
                type="button"
                onClick={() => navigate('/house/menu')}
                className="mt-2 block text-left font-serif text-2xl"
              >
                Your menu is read. Choose it as the current menu.
              </button>
            ) : proof ? (
              <button
                type="button"
                onClick={() => navigate('/house/menu')}
                className="mt-2 block text-left font-serif text-2xl"
              >
                {pencilled === 0 ? 'The first proof is set.' : `${pencilled} pencilled`}
              </button>
            ) : (
              <>
                <p className="mt-2 font-serif text-2xl text-inkm-3">No menu read yet.</p>
                <Link to="/get-started" className="mt-2 inline-block text-sm underline underline-offset-4">
                  Read your menu
                </Link>
              </>
            )}
          </div>

          {menuCurrent && (
            <div className="py-6">
              <p className="text-xs uppercase tracking-wider text-seal">Next</p>
              <Link to="/inventory" className="mt-2 block font-serif text-2xl underline-offset-4 hover:underline">
                Count the shelf
              </Link>
              <p className="mt-1 text-sm text-inkm-3">The menu says what you pour; a count says what you hold.</p>
            </div>
          )}

          {saved ? (
            <p className="py-6 font-serif text-2xl">{supplier.trim()} is on the book.</p>
          ) : supplierOnBook ? (
            <div className="py-6">
              <p className="text-xs uppercase tracking-wider text-inkm-3">Suppliers</p>
              <p className="mt-2 font-serif text-2xl">A supplier is on the book.</p>
              <Link to="/vendors" className="mt-2 inline-block text-sm underline underline-offset-4">
                See your suppliers
              </Link>
            </div>
          ) : (
            <form
              className="py-6"
              onSubmit={(event) => {
                event.preventDefault()
                void saveSupplier()
              }}
            >
              <p className="text-xs uppercase tracking-wider text-seal">The one ask · optional</p>
              <label className="mt-2 block">
                <span className="font-serif text-2xl">Who supplies you?</span>
                <input
                  aria-label="Supplier"
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                  placeholder="A name is enough"
                  className="mt-3 block w-full border-b border-paper-2 bg-transparent pb-2 text-lg outline-none focus:border-seal"
                />
              </label>
              {error && (
                <p role="alert" className="mt-3 text-sm text-[color:var(--alarm)]">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={!supplier.trim() || saving}
                className="mt-5 bg-seal px-5 py-2.5 text-paper-0 disabled:opacity-40"
              >
                {saving ? 'Adding…' : 'Add this supplier'}
              </button>
            </form>
          )}

          {/* H-1: nothing is kept here. Receipts is where an invoice is read. */}
          <p className="py-6 font-serif text-2xl text-inkm-3">
            <span className="block text-xs uppercase tracking-[0.12em]">Later · not required</span>
            <span className="mt-2 block">
              Your last invoice can be read on{' '}
              <Link to="/receipts" className="underline underline-offset-4">
                Receipts
              </Link>{' '}
              whenever you want.
            </span>
          </p>

          <p className="py-6 font-serif text-2xl text-inkm-3">
            <span className="block text-xs uppercase tracking-[0.12em]">Later · not a first-run step</span>
            <span className="mt-2 block">Cellar registers · later</span>
            <button
              type="button"
              onClick={() => navigate('/settings?tab=cellar')}
              className="mt-2 font-sans text-sm underline underline-offset-4"
            >
              Open later
            </button>
          </p>
        </div>

        <Link to="/" className="mt-10 inline-block bg-seal px-5 py-2.5 text-paper-0">
          Go to the desk
        </Link>
      </main>
    </div>
  )
}
