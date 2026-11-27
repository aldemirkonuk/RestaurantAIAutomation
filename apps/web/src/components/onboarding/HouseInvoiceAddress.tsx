import { useEffect, useRef, useState } from 'react'
import { getVendorEmail } from '../../services/api/menus'
import { useAuth } from '../../contexts/AuthContext'

/** How long "Copied" holds its slot. */
export const COPIED_HOLD_MS = 1600

type Read = { kind: 'reading' } | { kind: 'failed' } | { kind: 'read'; address: string | null }

/**
 * onboarding-r110-g1: the house's own invoice address, on /house.
 *
 * Mail an owner or manager forwards here from their own verified email lands
 * on Receipts (the gateway's member-forward path, rabbitmq-bridge). Owners
 * and managers only: a staff forward keeps the vendor path, so the row would
 * promise staff something the house does not do.
 *
 * A null address means the inbound domain is not set (inbound-address.service
 * `domain()`), so there is no row, never "not set". A failed read says so in
 * words, with Look again. "Copied" sits in a slot held open beside the
 * button, so the row never shifts, and it appears and goes with no motion.
 */
export function HouseInvoiceAddress() {
  const { user } = useAuth()
  const lead = user?.role === 'owner' || user?.role === 'manager'
  const [read, setRead] = useState<Read>({ kind: 'reading' })
  const [asked, setAsked] = useState(0)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!lead) return
    let live = true
    setRead({ kind: 'reading' })
    ;(async () => {
      try {
        const answer = await getVendorEmail()
        const address = typeof answer?.address === 'string' && answer.address.trim() ? answer.address.trim() : null
        if (live) setRead({ kind: 'read', address })
      } catch {
        if (live) setRead({ kind: 'failed' })
      }
    })()
    return () => {
      live = false
    }
  }, [lead, asked])

  useEffect(() => () => {
    if (hold.current) clearTimeout(hold.current)
  }, [])

  if (!lead || read.kind === 'reading') return null
  if (read.kind === 'read' && read.address === null) return null

  if (read.kind === 'failed') {
    return (
      <div className="py-6" data-testid="house-invoice-address">
        <p className="text-xs uppercase tracking-wider text-[#6d685f]">Your house&apos;s invoice address</p>
        <p className="mt-2 font-serif text-2xl text-[#6d685f]" data-testid="house-invoice-address-unread">
          We could not read the house&apos;s address just now.{' '}
          <button
            type="button"
            onClick={() => setAsked((n) => n + 1)}
            // The menu row has its own Look again; each says what it reads.
            aria-label="Look again for the invoice address"
            className="min-h-[44px] font-sans text-sm text-[#1a5e6b] underline underline-offset-4"
          >
            Look again
          </button>
        </p>
      </div>
    )
  }

  const address = read.address as string
  const onCopy = async () => {
    if (hold.current) clearTimeout(hold.current)
    try {
      await navigator.clipboard.writeText(address)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
    hold.current = setTimeout(() => setCopy('idle'), COPIED_HOLD_MS)
  }

  return (
    <div className="py-6" data-testid="house-invoice-address">
      <p className="text-xs uppercase tracking-wider text-[#6d685f]">Your house&apos;s invoice address</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="break-all font-mono text-lg" data-testid="house-invoice-address-value">
          {address}
        </span>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="min-h-[44px] min-w-[44px] border border-[#211f1b]/25 px-3 text-sm"
        >
          Copy
        </button>
        {/* Held open at its widest word so "Copied" never moves the row. */}
        <span
          className="inline-block min-w-[13rem] text-sm text-[#1a5e6b]"
          aria-live="polite"
          data-testid="house-invoice-address-copied"
        >
          {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Select the address to copy it.' : ''}
        </span>
      </div>
      <p className="mt-2 text-sm text-[#6d685f]">
        Forward an invoice from {user?.email || 'your own email'} and it lands on Receipts. Give it to your vendors
        too.
      </p>
    </div>
  )
}
