import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/brand/BrandMark'
import { KeepOnPhone } from '../components/onboarding/KeepOnPhone'
import {
  addCustomProvider,
  addProviderFromCatalogue,
  matchVendorCatalogue,
  type VendorMatchCandidate,
} from '../services/api/vendors'
import { getErrorStatus, isUnconfirmedWrite } from '../services/api/client'
import { getOnboardingProgress } from '../services/api/menus'
import { proofStanding, readProof, type ProofStanding } from '../lib/firstProof'
import { menuKept, moneySetIn, type MenuStandingRead } from '../lib/menuKept'
import { settingsApi } from '../services/api/settings'
import { documentsApi } from '../services/api/documents'
import { skipFolio } from '../services/api/arrival'
import { useAuth } from '../contexts/AuthContext'

/** The web's per-file limit for a paper (main.ts body limit carries 10 MB). */
const PAPER_MAX_BYTES = 10 * 1024 * 1024

type PaperState = 'ask' | 'sending' | 'sent' | 'failed' | 'unconfirmed' | 'too-big' | 'skipped' | 'skip-unrecorded'

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

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
/**
 * A vendor's address, if one was typed (r36 onboarding gap 2): a vendor
 * saved by name alone has no address, so no order can be mailed to it and
 * no reply of theirs is matched to it. `''` = none typed; `null` = typed
 * and not a whole address, so nothing is sent.
 */
function vendorEmail(typed: string): string | null {
  const email = typed.trim()
  if (!email) return ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function vendorNotSaved(cause: unknown, name: string): string {
  if (isUnconfirmedWrite(cause)) {
    return `We could not tell whether ${name} was saved: the connection dropped. Look on Vendors before adding it again.`
  }
  const status = getErrorStatus(cause)
  if (status === 409) return `${name} is already on your vendors.`
  if (status === 400 || status === 422) return 'That name could not be saved as it is. Try it shorter, or add the vendor on Vendors.'
  if (status === 401 || status === 403) return 'This account cannot add vendors to this house. An owner or a manager can.'
  return `We could not add ${name} just now. Try again, or add it on Vendors.`
}

export default function HouseContents() {
  const navigate = useNavigate()
  // POST /arrival/skip is owner or manager only (arrival.service.ts manage()):
  // a staff skip would be refused for good, and said as a passing failure.
  const { user } = useAuth()
  const canSkip = user?.role === 'owner' || user?.role === 'manager'
  const proof = readProof()
  const standing = proof ? proofStanding(proof.items) : null
  const [supplier, setSupplier] = useState('')
  const [supplierEmail, setSupplierEmail] = useState('')
  const email = vendorEmail(supplierEmail)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // What the saved line says: the name kept and whether an email is on file for
  // orders. A curated pick brings the catalogue's email; a typed vendor, the typed one.
  const [savedAs, setSavedAs] = useState<{ name: string; email: string } | null>(null)
  // g13: the supplier ask meets the curated catalogue as the name is typed.
  // Curated rows only (the gateway's match never returns registry rows or
  // another house's custom providers); a failed match resolves to [] and shows no list.
  const [matches, setMatches] = useState<VendorMatchCandidate[]>([])
  const [listOpen, setListOpen] = useState(false)
  const countryRead = useRef<Promise<string | undefined> | null>(null)
  useEffect(() => {
    const typed = supplier.trim()
    if (typed.length < 2) {
      setMatches([])
      return
    }
    let live = true
    const timer = setTimeout(() => {
      countryRead.current ??= (async () => {
        try {
          const money = await settingsApi.houseCurrency()
          return money?.country ?? undefined
        } catch {
          return undefined
        }
      })()
      void countryRead.current
        .then((country) => matchVendorCatalogue(typed, undefined, country))
        .then((rows) => {
          if (!live) return
          setMatches(Array.isArray(rows) ? rows.slice(0, 5) : [])
          setListOpen(true)
        })
        .catch(() => {
          if (live) setMatches([])
        })
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [supplier])
  const [error, setError] = useState<string | null>(null)
  // The supplier asked here is on the house's row (vendor_added), not in this
  // page's state: after a reload it asked "Who supplies you?" again (walk
  // 2026-11-11). r41 onboarding gap 1: the ask waits for that read. It was
  // drawn before the read landed and folded into one line when the house
  // already had a vendor, so the page jumped, typed text was lost, and a fast
  // owner could save a second vendor. A failed read still leaves the ask
  // (the gateway refuses the same name twice, 409).
  const [vendorRead, setVendorRead] = useState<'reading' | 'on-book' | 'ask'>('reading')
  // The same read answers the menu row when this tab holds no first proof
  // (r21): "No menu read yet." was said, with nothing to press, to a house
  // whose menu was read in another tab, and after "Skip for now" the row
  // had no way back to reading one. Null until the read is in. A menu kept
  // as a draft is said as not current yet (r36 gap 3), never as done.
  // r41 onboarding gap 2: a read that FAILED is 'unread', never "No menu
  // read yet": that sentence sent a house whose menu is current to
  // /get-started, which saw the current menu and sent it back here.
  const [menuStanding, setMenuStanding] = useState<MenuStandingRead | null>(null)
  // r36 gap 6: a house whose money is not set cannot cost an invoice that
  // names none and comes with no order (invoice-currency.ts withholds its
  // money). Said only when a read answered that no money is set; a failed
  // read says nothing, never "not set". r41 onboarding gap 8: the setup read
  // carries that fact (`next_steps.money_set`, #1593), so the money is asked
  // on its own only when the setup read did not answer it.
  const [moneyUnset, setMoneyUnset] = useState(false)
  const [readCount, setReadCount] = useState(0)
  useEffect(() => {
    let live = true
    const askMoney = () =>
      settingsApi
        .houseCurrency()
        .then((money) => {
          if (live && money?.readable === true && money.code == null) setMoneyUnset(true)
        })
        .catch(() => {})
    getOnboardingProgress()
      .then((progress) => {
        if (!live) return
        setVendorRead(progress?.vendor_added ? 'on-book' : 'ask')
        setMenuStanding(menuKept(progress))
        const moneySet = moneySetIn(progress)
        if (moneySet === null) void askMoney()
        else setMoneyUnset(!moneySet)
      })
      .catch(() => {
        if (!live) return
        setVendorRead((now) => (now === 'on-book' ? now : 'ask'))
        setMenuStanding('unread')
        void askMoney()
      })
    return () => {
      live = false
    }
  }, [readCount])
  const lookAgain = () => {
    setMenuStanding(null)
    setReadCount((count) => count + 1)
  }

  // Folio 0 (ADR 0144 §1): the last invoice through the door, dropped here.
  // One upload per paper, with the session's house; a second drop while one is
  // on its way is ignored. Nothing is read back: proposing registers from the
  // paper is ADR 0144's known gap, and the row says so. Skippable, and the
  // skip is recorded on the house's opening book (`evidence`).
  const [paper, setPaper] = useState<PaperState>('ask')
  const paperSending = useRef(false)
  const sendPaper = async (file: File | undefined) => {
    if (!file || paperSending.current) return
    if (file.size > PAPER_MAX_BYTES) {
      setPaper('too-big')
      return
    }
    paperSending.current = true
    setPaper('sending')
    try {
      const contentBase64 = await fileBase64(file)
      await documentsApi.upload({ contentBase64, filename: file.name, mimeType: file.type || undefined, source: 'upload' })
      setPaper('sent')
    } catch (cause) {
      paperSending.current = false
      setPaper(isUnconfirmedWrite(cause) ? 'unconfirmed' : 'failed')
    }
  }
  const skipPaper = async () => {
    setPaper('skipped')
    try {
      await skipFolio('evidence')
    } catch {
      setPaper('skip-unrecorded')
    }
  }

  const saveSupplier = async () => {
    if (!supplier.trim() || email === null) return
    setSaving(true)
    setError(null)
    try {
      // One request: creating the provider marks `vendor_added` on the
      // house's onboarding row itself (providers.service.ts createProvider).
      await addCustomProvider(email ? { name: supplier.trim(), email } : { name: supplier.trim() })
      setSavedAs({ name: supplier.trim(), email: email ?? '' })
      setSaved(true)
    } catch (cause) {
      setError(vendorNotSaved(cause, supplier.trim()))
    } finally {
      setSaving(false)
    }
  }

  const pickRow = async (row: VendorMatchCandidate) => {
    setListOpen(false)
    setSaving(true)
    setError(null)
    try {
      const provider = await addProviderFromCatalogue(row.id)
      setSavedAs({ name: row.name, email: (provider?.email || row.email || '').trim() })
      setSaved(true)
    } catch (cause) {
      setError(vendorNotSaved(cause, row.name))
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
            ) : menuStanding === null ? (
              <p className="mt-2 font-serif text-2xl text-[#b7b2a8]" role="status">
                Looking at your menu…
              </p>
            ) : menuStanding === 'unread' ? (
              <>
                <p className="mt-2 font-serif text-2xl text-[#6d685f]" data-testid="house-menu-unread">
                  We could not see where your menu stands just now.{' '}
                  <button
                    type="button"
                    onClick={lookAgain}
                    className="font-sans text-sm text-[#1a5e6b] underline underline-offset-4"
                  >
                    Look again
                  </button>
                </p>
                <p className="mt-1 text-sm text-[#6d685f]">
                  Or{' '}
                  <Link to="/menu" className="underline underline-offset-4">
                    open Menu
                  </Link>
                  , which shows the house&apos;s menus.
                </p>
              </>
            ) : menuStanding === 'current' ? (
              <p className="mt-2 font-serif text-2xl">
                Your menu is the current one.{' '}
                <Link to="/menu" className="font-sans text-sm underline underline-offset-4">
                  See it on Menu
                </Link>
              </p>
            ) : menuStanding === 'draft' ? (
              <>
                <p className="mt-2 font-serif text-2xl">
                  Your menu is read, but it is not the current menu yet.{' '}
                  <Link to="/menu" className="font-sans text-sm text-[#1a5e6b] underline underline-offset-4">
                    Choose it on Menu
                  </Link>
                </p>
                <p className="mt-1 text-sm text-[#6d685f]">Stock and prices come only from the current menu.</p>
              </>
            ) : menuStanding === 'read' ? (
              // An older gateway names no current menu: said as before.
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
            <div className="py-6">
              <p className="font-serif text-2xl">{savedAs?.name ?? supplier.trim()} is saved as your vendor.</p>
              {savedAs?.email && (
                <p className="mt-1 text-sm text-[#6d685f]" data-testid="house-vendor-email-on-file">
                  Orders can go to {savedAs.email} by mail.
                </p>
              )}
              {!savedAs?.email && (
                <p className="mt-1 text-sm text-[#6d685f]">
                  With no email, orders cannot go to them by mail.{' '}
                  <Link to="/vendors" className="underline underline-offset-4">
                    Add it on Vendors
                  </Link>
                </p>
              )}
            </div>
          ) : vendorRead === 'reading' ? (
            <p className="py-6 font-serif text-2xl text-[#b7b2a8]" role="status" data-testid="house-vendor-reading">
              Looking for your vendor…
            </p>
          ) : vendorRead === 'on-book' ? (
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
              <div className="relative mt-2">
                <label className="block">
                  {/* "Vendor", as the sidebar, the setup checklist and /vendors say it (r28 gap 13). */}
                  <span className="font-serif text-2xl">Who is your first vendor?</span>
                  <input
                    aria-label="Vendor"
                    role="combobox"
                    aria-expanded={listOpen && matches.length > 0}
                    aria-controls="house-vendor-matches"
                    aria-autocomplete="list"
                    autoComplete="off"
                    value={supplier}
                    onChange={(event) => setSupplier(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && listOpen) {
                        event.preventDefault()
                        setListOpen(false)
                      }
                    }}
                    placeholder="Their name"
                    className="mt-3 block w-full border-b border-[#211f1b]/25 bg-transparent pb-2 text-lg outline-none"
                  />
                </label>
                {/* An overlay, not an in-flow list: a list landing after the keystroke would shift the form (CLS).
                    It fades in under motion, appears at once under reduced motion, and has no exit (ADR 0112). */}
                {listOpen && matches.length > 0 && (
                  <ul
                    id="house-vendor-matches"
                    role="listbox"
                    aria-label="Vendors we already know"
                    className="absolute left-0 right-0 top-full z-10 border border-[#211f1b]/15 bg-white shadow-sm motion-safe:animate-popover-in"
                  >
                    {matches.map((row) => (
                      <li key={row.id} role="option" aria-selected={false}>
                        <button
                          type="button"
                          onClick={() => void pickRow(row)}
                          className="block min-h-11 w-full px-3 py-2 text-left"
                        >
                          <span className="block text-base">{row.name}</span>
                          {row.city && <span className="block text-sm text-[#6d685f]">{row.city}</span>}
                        </button>
                      </li>
                    ))}
                    <li role="option" aria-selected={false}>
                      <button
                        type="button"
                        onClick={() => setListOpen(false)}
                        className="block min-h-11 w-full border-t border-[#211f1b]/10 px-3 py-2 text-left text-base text-[#1a5e6b]"
                      >
                        Add {supplier.trim()} as my own
                      </button>
                    </li>
                  </ul>
                )}
              </div>
              <label className="mt-4 block">
                <span className="text-sm text-[#6d685f]">Their email, if you have it: orders go there, and their replies come back here.</span>
                <input
                  aria-label="Vendor email"
                  type="email"
                  value={supplierEmail}
                  onChange={(event) => setSupplierEmail(event.target.value)}
                  placeholder="orders@vendor.com"
                  className="mt-2 block w-full border-b border-[#211f1b]/25 bg-transparent pb-2 text-lg outline-none"
                />
              </label>
              {email === null && (
                <p className="mt-2 text-sm text-red-700">That email is not complete yet.</p>
              )}
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
                disabled={!supplier.trim() || email === null || saving}
                className="mt-5 bg-[#1a5e6b] px-5 py-2.5 text-white disabled:opacity-40"
              >
                {saving ? 'Adding…' : 'Add this vendor'}
              </button>
            </form>
          )}

          {/* r36 gap 8: the checklist calls the first invoice the way to the
              house's costs, so it is not said here as "not required". The
              drop (DD-r108-10) sends the paper to Receipts; the link stays. */}
          <div className="py-6 font-serif text-2xl">
            <span className="block text-xs uppercase tracking-[0.12em] text-[#1a5e6b]">Next · for your costs</span>
            {paper === 'sent' ? (
              <p className="mt-2" role="status">
                Your last invoice is on Receipts.{' '}
                <Link to="/receipts" className="font-sans text-sm text-[#1a5e6b] underline underline-offset-4">
                  See it on Receipts
                </Link>
              </p>
            ) : paper === 'sending' ? (
              <p className="mt-2 text-[#6d685f]" role="status">Sending your last invoice…</p>
            ) : paper === 'skipped' ? (
              <p className="mt-2 text-[#6d685f]" data-testid="house-paper-skipped">Skipped for now.</p>
            ) : paper === 'skip-unrecorded' ? (
              <p className="mt-2 text-[#6d685f]" role="alert">
                Skipped here, but the house could not note the skip just now.
              </p>
            ) : (
              <div
                className="mt-3 border border-dashed border-[#211f1b]/30 p-4"
                data-testid="house-paper-drop"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  void sendPaper(event.dataTransfer?.files?.[0])
                }}
              >
                <label className="flex min-h-[44px] cursor-pointer items-center text-xl">
                  Drop your last invoice here, or choose a photo or PDF.
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    aria-label="Your last invoice"
                    className="sr-only"
                    onChange={(event) => void sendPaper(event.target.files?.[0])}
                  />
                </label>
                {paper !== 'ask' && (
                  <p role="alert" className="mt-2 font-sans text-sm text-red-700">
                    {paper === 'too-big'
                      ? 'That file is over 10 MB. Try a photo of the page, or send it on Receipts.'
                      : paper === 'unconfirmed'
                        ? 'We could not tell whether it arrived: the connection dropped. Look on Receipts before sending it again.'
                        : 'We could not send it just now. Try again, or send it on Receipts.'}
                  </p>
                )}
                {canSkip && (
                  <button
                    type="button"
                    onClick={() => void skipPaper()}
                    className="mt-2 min-h-[44px] font-sans text-sm text-[#6d685f] underline underline-offset-4"
                  >
                    Skip for now
                  </button>
                )}
              </div>
            )}
            {(paper === 'ask' || paper === 'sent') && (
              <span className="mt-2 block font-sans text-sm text-[#6d685f]">
                It is not read into the house&apos;s registers yet.
              </span>
            )}
            <span className="mt-2 block">
              Costs come from the invoices you check. Read your last one on{' '}
              <Link to="/receipts" className="underline underline-offset-4">
                Receipts
              </Link>
              .
            </span>
            {moneyUnset && (
              <span className="mt-2 block font-sans text-sm text-[#6d685f]" data-testid="house-money-unset">
                The house’s money is not set yet. An invoice that names none, and comes with no order, waits for it
                before its costs go on.{' '}
                <Link to="/settings?tab=currency" className="text-[#1a5e6b] underline underline-offset-4">
                  Set the money in Settings
                </Link>
              </span>
            )}
          </div>

          <KeepOnPhone />

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
