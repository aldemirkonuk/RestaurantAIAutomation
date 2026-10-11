import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/brand/BrandMark'
import { addCustomProvider } from '../services/api/vendors'
import { getOnboardingProgress, listMenuVersions, updateOnboardingProgress } from '../services/api/menus'
import { pencilledCount, readProof } from '../lib/firstProof'
import { readLastInvoiceLater, writeLastInvoiceLater } from '../lib/houseLater'
import { useAuth } from '../contexts/AuthContext'

export default function HouseContents() {
  const navigate = useNavigate()
  const { activeRestaurantId } = useAuth()
  const proof = readProof(activeRestaurantId)
  const pencilled = proof ? pencilledCount(proof.items) : 0
  const [supplier, setSupplier] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invoice, setInvoice] = useState(readLastInvoiceLater)
  const [invoiceDropping, setInvoiceDropping] = useState(false)
  // Whether the menu just read is the house's current one. An import is kept
  // as a draft, and nothing on the first run said it still had to be made
  // current, so /vendors went on asking for a menu (F-031).
  const proofMenuId = proof?.menuId ?? null
  const [standing, setStanding] = useState<'reading' | 'current' | 'draft' | 'unread'>('reading')
  useEffect(() => {
    if (!proofMenuId) return
    let live = true
    listMenuVersions()
      .then((kept) => {
        if (live) setStanding(kept.current?.menuId === proofMenuId ? 'current' : 'draft')
      })
      .catch(() => {
        if (live) setStanding('unread')
      })
    return () => {
      live = false
    }
  }, [proofMenuId])
  // With no proof in this tab, ask the house's books whether a menu is
  // already held, as /house/menu does (F-273, F-1211): a menu read in another
  // tab or on /menu is not "no menu", and reading it again adds a second copy.
  const hasProof = proof !== null
  const [held, setHeld] = useState<'checking' | 'held' | 'none' | 'unknown'>('checking')
  useEffect(() => {
    if (hasProof) return
    let live = true
    setHeld('checking')
    listMenuVersions()
      .then((v) => live && setHeld(v.current || v.versions.length > 0 ? 'held' : 'none'))
      .catch(() => live && setHeld('unknown'))
    return () => {
      live = false
    }
  }, [hasProof])
  // A supplier already on the book is not asked for again (F-1211). A failed
  // read leaves the ask up: it is optional, and the gateway keeps one name once.
  const [supplierHeld, setSupplierHeld] = useState(false)
  useEffect(() => {
    let live = true
    getOnboardingProgress()
      .then((progress) => live && setSupplierHeld(progress?.vendor_added === true))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const saveSupplier = async () => {
    if (!supplier.trim()) return
    setSaving(true)
    setError(null)
    try {
      await addCustomProvider({ name: supplier.trim() })
    } catch (cause: any) {
      setError(cause?.response?.data?.message || cause?.message || 'We could not add that supplier yet.')
      setSaving(false)
      return
    }
    // The supplier exists now, so this is the answer the owner gets (F-587).
    // The progress mark is a courtesy (the server sets it on create too); a
    // failure here must not say "could not add" and invite a second copy.
    setSaved(true)
    setSaving(false)
    try {
      await updateOnboardingProgress({ vendor_added: true })
    } catch {
      // Non-fatal: the gateway already marks vendor_added when it creates one.
    }
  }

  const keepInvoice = (file?: File) => {
    if (!file) return
    writeLastInvoiceLater(file.name)
    setInvoice({ name: file.name })
  }

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#211f1b]">
      <header className="h-14 border-b border-[#211f1b]/15 bg-white px-5 flex items-center justify-between">
        <BrandMark size={24} alt="Mudavym" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6d685f]">The house</span>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">Contents</p>
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
                {pencilled === 0 ? 'The first proof is set.' : `${pencilled} pencilled`}
              </button>
            ) : held === 'checking' ? (
              <p className="mt-2 font-serif text-2xl text-[#6d685f]">Looking for your menu…</p>
            ) : held === 'held' ? (
              <>
                <p className="mt-2 font-serif text-2xl">Your menu is already with us.</p>
                <button
                  type="button"
                  onClick={() => navigate('/menu')}
                  className="mt-2 text-sm text-[#1a5e6b] underline underline-offset-4"
                >
                  Open your menu
                </button>
              </>
            ) : held === 'unknown' ? (
              <>
                <p className="mt-2 font-serif text-2xl text-[#6d685f]">We could not check for your menu just now.</p>
                <p className="mt-2 text-sm text-[#6d685f]">
                  If you have already read one, it is on your menu page. Reading it again would add a second copy.{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/menu')}
                    className="text-[#1a5e6b] underline underline-offset-4"
                  >
                    Open your menu
                  </button>
                </p>
              </>
            ) : (
              // A way to read one, not a dead end: /get-started opens on its
              // menu step for a person whose house is already open (F-1063).
              <>
                <p className="mt-2 font-serif text-2xl text-[#6d685f]">No menu read yet.</p>
                <button
                  type="button"
                  onClick={() => navigate('/get-started')}
                  className="mt-2 text-sm text-[#1a5e6b] underline underline-offset-4"
                >
                  Read your menu
                </button>
              </>
            )}
            {proof && standing === 'draft' && (
              <p className="mt-2 text-sm text-[#6d685f]">
                Kept as a draft: it is not the house&apos;s current menu yet, and none of its prices are the
                house&apos;s.{' '}
                <button
                  type="button"
                  onClick={() => navigate('/menu')}
                  className="text-[#1a5e6b] underline underline-offset-4"
                >
                  Make it current on Menu
                </button>
              </p>
            )}
            {proof && standing === 'current' && (
              <p className="mt-2 text-sm text-[#6d685f]">It is the house&apos;s current menu.</p>
            )}
            {proof && standing === 'unread' && (
              <p className="mt-2 text-sm text-[#6d685f]">
                Whether it is the house&apos;s current menu could not be read.{' '}
                <button
                  type="button"
                  onClick={() => navigate('/menu')}
                  className="text-[#1a5e6b] underline underline-offset-4"
                >
                  Open Menu
                </button>
              </p>
            )}
          </div>

          {saved ? (
            <p className="py-6 font-serif text-2xl">{supplier.trim()} is on the book.</p>
          ) : supplierHeld ? (
            <div className="py-6">
              <p className="font-serif text-2xl">A supplier is already on the book.</p>
              <button
                type="button"
                onClick={() => navigate('/vendors')}
                className="mt-2 text-sm text-[#1a5e6b] underline underline-offset-4"
              >
                Open Vendors
              </button>
            </div>
          ) : (
            <form
              className="py-6"
              onSubmit={(event) => {
                event.preventDefault()
                void saveSupplier()
              }}
            >
              <p className="text-xs uppercase tracking-wider text-[#1a5e6b]">The one ask · optional</p>
              <label className="mt-2 block">
                <span className="font-serif text-2xl">Who supplies you?</span>
                <input
                  aria-label="Supplier"
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                  placeholder="A name is enough"
                  className="mt-3 block w-full border-b border-[#211f1b]/25 bg-transparent pb-2 text-lg outline-none"
                />
              </label>
              {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={!supplier.trim() || saving}
                className="mt-5 bg-[#1a5e6b] px-5 py-2.5 text-white disabled:opacity-40"
              >
                {saving ? 'Adding…' : 'Add this supplier'}
              </button>
            </form>
          )}

          <label
            className={`block py-6 font-serif text-2xl text-[#b7b2a8] ${
              invoiceDropping ? 'bg-white' : ''
            }`}
          >
            <span className="text-xs uppercase tracking-[0.12em]">Later · not required</span>
            <span className="mt-2 block">
              {invoice
                ? `Last invoice · noted, not kept — ${invoice.name}`
                : 'Last invoice · later'}
            </span>
            <span className="mt-1 block font-sans text-sm">
              {invoice
                ? 'We noted its name only. The file itself is not kept yet, so keep your copy.'
                : 'Drop a file when you want. We will not read it yet.'}
            </span>
            <input
              aria-label="Last invoice later"
              type="file"
              className="sr-only"
              onChange={(event) => keepInvoice(event.target.files?.[0])}
            />
            <span
              role="button"
              tabIndex={0}
              onDragEnter={() => setInvoiceDropping(true)}
              onDragOver={(event) => {
                event.preventDefault()
                setInvoiceDropping(true)
              }}
              onDragLeave={() => setInvoiceDropping(false)}
              onDrop={(event) => {
                event.preventDefault()
                setInvoiceDropping(false)
                keepInvoice(event.dataTransfer.files?.[0])
              }}
              className="mt-3 block min-h-[72px] border border-dashed border-[#211f1b]/20 px-4 py-4 font-sans text-sm"
            >
              {invoiceDropping ? 'Drop it here' : 'Drop the last invoice here, or click to choose a file.'}
            </span>
          </label>

          <p className="py-6 font-serif text-2xl text-[#b7b2a8]">
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

        {/* The way on. After the supplier step this page had no next step and
            no way into the house's pages; the only exit led to Settings (F-025). */}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-10 bg-[#1a5e6b] px-6 py-3 text-white"
        >
          Continue to the dashboard
        </button>
      </main>
    </div>
  )
}
