import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { documentsApi } from '../../services/api/documents'
import { canonicalApi } from '../../services/api/canonical'
import { matchVendorCatalogue, type VendorMatchCandidate } from '../../services/api/vendors'

/**
 * The last invoice dropped on /house proposes its vendor (r109 onboarding g2,
 * ADR 0144 §1 "registers proposed"). It reads, and only reads: the paper's
 * status every 4 s while the tab is visible and the paper is still being read
 * (received, extracting), for at most 3 minutes; then, once the paper is read,
 * its canonical document for the seller. Nothing is written here. A curated
 * catalogue hit is offered as a press; otherwise the seller's name goes into
 * the vendor box for the person to add (ADR 0143: only what the person sends
 * posts). The money is named only from the paper's extracted currency, never
 * from `procurement_documents.currency`, which defaults to 'USD' on an unread
 * paper (documents.ts).
 */
export const POLL_MS = 4000
export const GIVE_UP_MS = 3 * 60 * 1000
/** A catalogue row is offered only when its name is this close to the seller's. */
export const MATCH_FLOOR = 0.6

type Read =
  | { kind: 'reading' }
  | { kind: 'unread' }
  | { kind: 'late' }
  | { kind: 'seller'; seller: string; date: string | null; currency: string | null }

function dateSaid(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const at = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(at)
}

const SWAP = 'motion-safe:animate-swap-in'

export function InvoiceProposal({
  docId,
  vendorOpen,
  moneyUnset,
  busy,
  onPrefill,
  onPick,
}: {
  docId: string
  /** The house has no vendor yet and none was saved on this page. */
  vendorOpen: boolean
  moneyUnset: boolean
  busy: boolean
  onPrefill: (name: string) => void
  onPick: (row: VendorMatchCandidate) => void
}) {
  const [read, setRead] = useState<Read>({ kind: 'reading' })
  // The catalogue is asked once the seller is read AND the house is known to
  // have no vendor (the setup read may land after the paper's). undefined =
  // not asked yet; null = no row close enough.
  const [match, setMatch] = useState<VendorMatchCandidate | null | undefined>(undefined)
  const prefill = useRef(onPrefill)
  prefill.current = onPrefill
  const seller = read.kind === 'seller' ? read.seller : null
  const asked = useRef(false)
  useEffect(() => {
    if (!seller || !vendorOpen || asked.current) return
    asked.current = true
    let live = true
    matchVendorCatalogue(seller)
      .then((rows) => {
        const top = Array.isArray(rows) ? rows[0] : undefined
        return top && top.name_similarity >= MATCH_FLOOR ? top : null
      })
      .catch(() => null)
      .then((row) => {
        if (!live) return
        setMatch(row)
        if (!row) prefill.current(seller)
      })
    return () => {
      live = false
    }
  }, [seller, vendorOpen])

  useEffect(() => {
    let live = true
    let done = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const started = Date.now()
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
    const finish = (next: Read) => {
      done = true
      if (live) setRead(next)
    }

    const tick = async () => {
      timer = undefined
      if (!live || done || inFlight || !visible()) return
      if (Date.now() - started >= GIVE_UP_MS) return finish({ kind: 'late' })
      inFlight = true
      let status: string | null = null
      let paperDate: string | null = null
      try {
        const { document: paper } = await documentsApi.detail(docId)
        status = paper.status
        paperDate = paper.doc_date
      } catch {
        status = null // a passing failure: asked again on the next beat
      }
      inFlight = false
      if (!live) return
      if (status === 'needs_review' || status === 'verified') {
        try {
          const { canonical } = await canonicalApi.document(docId)
          const seller = canonical?.layer1?.seller?.name?.value?.trim()
          if (!seller) return finish({ kind: 'unread' })
          const code = canonical.layer1.currency?.value?.trim().toUpperCase() ?? null
          finish({
            kind: 'seller',
            seller,
            date: dateSaid(canonical.layer1.issueDate?.value ?? paperDate),
            currency: code && /^[A-Z]{3}$/.test(code) ? code : null,
          })
        } catch {
          finish({ kind: 'unread' })
        }
        return
      }
      if (status === 'rejected' || status === 'superseded') return finish({ kind: 'unread' })
      timer = setTimeout(() => void tick(), POLL_MS)
    }

    const onVisible = () => {
      if (visible() && timer === undefined) void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    void tick()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [docId])

  return (
    <div className="mt-3 min-h-[5.5rem] font-sans text-base" aria-live="polite" data-testid="house-invoice-proposal">
      {read.kind === 'reading' && <p className="text-[#6d685f]">Reading the seller off your invoice…</p>}
      {read.kind === 'unread' && (
        <p key="unread" className={SWAP} role="status">
          We could not read the seller off that invoice.{' '}
          {vendorOpen ? 'Add the vendor above.' : 'It is on Receipts.'}
        </p>
      )}
      {read.kind === 'late' && (
        <p key="late" className={`${SWAP} text-[#6d685f]`} role="status">
          Your invoice is still being read. Its seller will be on Receipts when it is.
        </p>
      )}
      {read.kind === 'seller' && (
        <div key="seller" className={SWAP}>
          <p>
            {read.date ? `From your invoice of ${read.date}: ` : 'From your invoice: '}
            <span className="font-serif text-xl">{read.seller}</span>
          </p>
          {vendorOpen && match && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(match)}
              className="mt-2 min-h-11 bg-[#1a5e6b] px-4 text-white disabled:opacity-40"
            >
              Make {match.name} your vendor
            </button>
          )}
          {vendorOpen && match === null && (
            <p className="mt-1 text-sm text-[#6d685f]">Its name is in the vendor box above. Press Add this vendor to keep it.</p>
          )}
          {moneyUnset && read.currency && (
            <p className="mt-1 text-sm text-[#6d685f]" data-testid="house-invoice-currency">
              This invoice is in {read.currency}.{' '}
              <Link to="/settings?tab=currency" className="text-[#1a5e6b] underline underline-offset-4">
                Set the house&apos;s money in Settings
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
