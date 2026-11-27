import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { readMenuStatus } from '../../services/api/menus'
import { clearMenuReading, type MenuReadingNote } from '../../lib/houseMenuReading'

/** How often /house asks after the read, while the tab is in view. */
export const READING_POLL_MS = 5000
/** How long after the owner went on /house keeps asking. */
export const READING_ASK_FOR_MS = 10 * 60 * 1000
/** How often the elapsed time moves. */
export const READING_TICK_MS = 10_000

type Phase =
  | { kind: 'reading' }
  | { kind: 'done'; lines: number | null }
  | { kind: 'failed'; failure: string | null }
  // Ten minutes passed: the read is left to the bell and to Menu.
  | { kind: 'left' }
  // The gateway refused the question (a 4xx: the session ended, the person
  // left this house, or the read is gone). Asking again cannot answer it.
  | { kind: 'lost' }

/** A 4xx but a timeout or a throttle: asking again cannot answer it. */
function refused(err: unknown): boolean {
  const code = (err as { response?: { status?: unknown } })?.response?.status
  return typeof code === 'number' && code >= 400 && code < 500 && code !== 408 && code !== 429
}

/** "40 s", "1 min 20 s", "3 min"; null under ten seconds. */
export function elapsedWords(ms: number): string | null {
  const s = Math.floor(ms / READING_TICK_MS) * (READING_TICK_MS / 1000)
  if (s < 10) return null
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest ? `${m} min ${rest} s` : `${m} min`
}

/**
 * The /house menu row while the menu the owner left reading is read (r109
 * onboarding g4). It holds the row's slot; on a swap the new words fade in
 * (160 ms, ease-out), never under reduced motion, and there is no percent:
 * the reader reports no progress to show. Only a change of state is spoken.
 */
export function MenuReadingLine({ note }: { note: MenuReadingNote }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let live = true
    let busy = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const end = (next: Phase) => {
      live = false
      clearMenuReading()
      setPhase(next)
    }
    const ask = async () => {
      if (!live || busy) return
      // A hidden tab asks nothing; coming back into view asks at once.
      if (document.visibilityState !== 'visible') return
      if (Date.now() - note.at > READING_ASK_FOR_MS) return end({ kind: 'left' })
      busy = true
      try {
        const status = await readMenuStatus(note.menuId)
        if (!live) return
        if (status.state === 'done') {
          const reply = status.reply
          return end({ kind: 'done', lines: reply ? reply.itemsExtracted ?? reply.items.length : null })
        }
        if (status.state === 'failed') return end({ kind: 'failed', failure: status.failure })
      } catch (err) {
        if (!live) return
        if (refused(err)) return end({ kind: 'lost' })
        // A missed question (network, 5xx) is asked again on the next beat.
      } finally {
        busy = false
      }
      timer = setTimeout(() => void ask(), READING_POLL_MS)
    }
    const onShow = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(timer)
      void ask()
    }
    void ask()
    document.addEventListener('visibilitychange', onShow)
    return () => {
      live = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [note])

  useEffect(() => {
    if (phase.kind !== 'reading') return
    const tick = setInterval(() => setNow(Date.now()), READING_TICK_MS)
    return () => clearInterval(tick)
  }, [phase.kind])

  const elapsed = phase.kind === 'reading' ? elapsedWords(now - note.at) : null
  const swap = phase.kind === 'reading' ? '' : 'motion-safe:animate-swap-in'
  const link = 'font-sans text-sm text-[#1a5e6b] underline underline-offset-4'

  return (
    <div className="mt-2 min-h-[2rem]" data-testid="house-menu-reading">
      <p className="font-serif text-2xl">
        <span aria-live="polite">
          <span key={phase.kind} className={swap}>
            {phase.kind === 'reading' && 'Your menu is being read'}
            {phase.kind === 'done' && (
              <>
                {phase.lines == null
                  ? 'Your menu is read.'
                  : `Your menu is read: ${phase.lines} ${phase.lines === 1 ? 'line' : 'lines'}.`}{' '}
                <Link to="/menu" className={link}>
                  Check it on Menu
                </Link>
              </>
            )}
            {phase.kind === 'failed' && (
              <>
                Your menu could not be read.{' '}
                <Link to="/get-started" className={link}>
                  Send it again
                </Link>
              </>
            )}
            {phase.kind === 'left' && (
              <>
                Your menu is still with the reader; the bell rings when it is read.{' '}
                <Link to="/menu" className={link}>
                  Open Menu
                </Link>
              </>
            )}
            {phase.kind === 'lost' && (
              <>
                We could not ask after your menu&apos;s read.{' '}
                <Link to="/menu" className={link}>
                  Open Menu
                </Link>
              </>
            )}
          </span>
        </span>
        {elapsed && <span className="text-[#6d685f]"> · {elapsed}</span>}
      </p>
      {phase.kind === 'failed' && phase.failure && (
        <p key="why" className="mt-1 text-sm text-[#6d685f] motion-safe:animate-swap-in">
          {phase.failure}
        </p>
      )}
    </div>
  )
}
