import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { listMenuVersions, type MenuVersions } from '../../services/api/menus'
import { prefersReducedMotion } from '../../lib/mudavym/motion'

/**
 * On a computer, photograph the menu with the phone (DD-r108-56).
 *
 * The QR carries no token, only the page and the house it is for. The phone
 * signs in as itself, and its own session decides the house: a house id in a
 * URL is not a secret and is never trusted. The computer then watches for a
 * menu it did not have when the QR first showed.
 */

/** Only a computer: a fine pointer on a wide screen. A phone has its own camera. */
export const DESK_QUERY = '(pointer: fine) and (min-width: 768px)'
export const WATCH_EVERY_MS = 4_000
export const WATCH_FOR_MS = 10 * 60_000

function isDesk(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(DESK_QUERY).matches
  } catch {
    return false
  }
}

/** The address the phone opens. No credential ever rides on it. */
export function handoffAddress(origin: string, restaurantId: string): string {
  return `${origin}/get-started?from=desk&house=${encodeURIComponent(restaurantId)}`
}

/** A menu the computer did not have at the baseline, with lines read. */
export function newRead(baseline: ReadonlySet<string>, now: MenuVersions | undefined): boolean {
  return !!now?.versions.some((v) => !baseline.has(v.menuId) && (v.linesExtracted ?? 0) > 0)
}

export function PhoneHandoff({ restaurantId }: { restaurantId: string }) {
  // Decided at first paint, so the box is there from the start or never.
  const [desk] = useState(isDesk)
  if (!desk || !restaurantId) return null
  return <DeskHandoff restaurantId={restaurantId} />
}

function DeskHandoff({ restaurantId }: { restaurantId: string }) {
  const started = useRef(Date.now())
  const baseline = useRef<Set<string> | null>(null)
  const last = useRef<MenuVersions | undefined>(undefined)
  const [arrived, setArrived] = useState(false)
  const [stopped, setStopped] = useState(false)
  const line = useRef<HTMLParagraphElement>(null)

  const over = () => Date.now() - started.current >= WATCH_FOR_MS
  const versions = useQuery({
    queryKey: ['phone-handoff', restaurantId],
    // Past ten minutes no read goes out, whatever woke the query (focus,
    // visibility): the one interval is the only timer.
    queryFn: async () => {
      if (over()) {
        setStopped(true)
        return last.current ?? { current: null, lastUsed: null, versions: [] }
      }
      return listMenuVersions()
    },
    enabled: !arrived && !stopped,
    // Hidden tabs do not re-read (refetchIntervalInBackground is false); a
    // focus or a return to the tab re-reads at once.
    refetchInterval: () => (arrived || stopped || over() ? false : WATCH_EVERY_MS),
    refetchOnWindowFocus: 'always',
    retry: false,
    gcTime: 0,
    staleTime: 0,
  })

  useEffect(() => {
    const data = versions.data
    if (!data) return
    last.current = data
    if (!baseline.current) {
      // The first answer is what the house already had: an old draft is not news.
      baseline.current = new Set(data.versions.map((v) => v.menuId))
      return
    }
    if (newRead(baseline.current, data)) setArrived(true)
  }, [versions.data, versions.dataUpdatedAt])

  useEffect(() => {
    if (!arrived || !line.current || prefersReducedMotion()) return
    if (typeof line.current.animate !== 'function') return
    // Entrance only, no exit (MOTIONS.md); under reduced motion nothing runs.
    line.current.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    })
  }, [arrived])

  return (
    <figure data-testid="phone-handoff" style={{ margin: 0 }}>
      <div style={{ width: 160, height: 160 }}>
        <QRCodeSVG value={handoffAddress(window.location.origin, restaurantId)} size={160} />
      </div>
      <figcaption>Use your phone&rsquo;s camera</figcaption>
      {/* The arrival line's room is held from the first paint. */}
      <p ref={line} role="status" style={{ minHeight: '1.5em', margin: 0 }}>
        {arrived ? (
          <>
            Your phone&rsquo;s read is in.{' '}
            <Link to="/menu" className="mdv-spread-textlink">
              Check it on Menu
            </Link>
          </>
        ) : null}
      </p>
    </figure>
  )
}

/**
 * The phone opened the QR for another house than the one it is signed in to.
 * It never reads for the wrong house: ChooseHouse checks membership and
 * brings it back here.
 */
export function DeskHouseMismatch({ search }: { search: string }) {
  return (
    <div data-testid="desk-house-mismatch">
      <p role="status">This phone is signed in to another house than your computer.</p>
      <Link
        to="/choose-house"
        state={{ from: { pathname: '/get-started', search } }}
        className="mdv-spread-textlink"
        style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
      >
        Choose the house
      </Link>
    </div>
  )
}
