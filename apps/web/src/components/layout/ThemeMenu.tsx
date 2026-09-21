import { useEffect, useRef, useState } from 'react'
import { Sun, Moon, Monitor, Check } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { cn } from '../../lib/utils'
import { Popover } from '../mudavym/Sheet'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import { useGroundState, setGroundChoice, type GroundState } from '../../lib/mudavym/groundChoice'

/**
 * ThemeMenu — the header's one theme control, wearing two different jobs.
 *
 * OFF a Mudavym page (`shell.on` false): unchanged since NEW-026. Light /
 * Dark / System as a dropdown menu against the app's own `ThemeContext`. The
 * trigger shows the currently-resolved theme's icon; the menu marks the
 * chosen mode (which may be "System"). Click-outside + Escape close it.
 *
 * ON a Mudavym page (`shell.on` true): ADR 0169. This is the exact control
 * `components/mudavym/PageGate.tsx`'s header comment names as missing before
 * `HouseHeader` was built ("no theme switch") — it has been mounted here
 * since, wired to `ThemeContext`, and choosing Light/Dark/System here has
 * NEVER changed a Mudavym page: `.mudavym` ignored the app theme by design
 * (ADR 0138 D1), so this control quietly did nothing on every rebuilt page —
 * which is what the founder was seeing when he said "I realized all pages
 * will be charcoal however I don't want it." Rather than add a second,
 * competing control, this branch now drives the real thing: a person's own
 * choice of Paper or Charcoal (`lib/mudavym/groundChoice.ts`), independent of
 * `ThemeContext` — the Mudavym ground is still not the app's light/dark
 * theme (ADR 0138's title), it is just no longer fixed either.
 *
 * TWO OPTIONS, NEVER THREE (founder, 2026-09-21 — "Always paper, follows
 * account"). Paper and Charcoal. There is deliberately no "System": a person
 * who has never chosen gets paper, not their laptop's night mode. The legacy
 * branch below still offers System because that is the app theme, a different
 * thing this record does not touch.
 *
 * AND IT NEVER CLAIMS AN ANSWER IT DOES NOT HAVE. The choice lives on the
 * person's account, which a page cannot read before it paints, so "paper on
 * screen" can mean four different things (`GroundState.source`). Under
 * `unknown` and `unreadable` this menu marks NO option active and says why,
 * rather than checkmarking Paper as though it had been chosen — a failed or
 * pending read is not an answer (CLAUDE.md §9).
 */

const OPTIONS = [
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'dark' as const, label: 'Dark', icon: Moon },
  { value: 'system' as const, label: 'System', icon: Monitor },
]

const GROUND_OPTIONS = [
  { value: 'paper' as const, label: 'Paper', icon: Sun },
  { value: 'charcoal' as const, label: 'Charcoal', icon: Moon },
]

/**
 * What the menu says under the two options, or null when the ground on
 * screen is simply this person's confirmed answer and needs no caveat.
 * A write failure outranks a read one: it is the thing that just happened.
 */
function groundNote(state: GroundState): string | null {
  if (state.writeError) return state.writeError
  switch (state.source) {
    case 'unknown':
      return 'Reading the ground you saved to your account. Paper until it answers.'
    case 'unreadable':
      return state.readFailed
        ? `The ground you saved could not be read (${state.detail ?? 'unknown reason'}). Paper until it can be.`
        : 'The ground you saved could not be read. Paper until it can be.'
    case 'device-cache':
      return state.readFailed
        ? `Your account could not be reached (${state.detail ?? 'unknown reason'}). This is the last ground this device saw you choose.`
        : 'This is the last ground this device saw you choose, while your account answers.'
    default:
      return null
  }
}

/** Under these, nobody has told us what this person chose — so nothing is
 *  marked chosen. `default` is NOT one of them: paper-because-they-never-
 *  chose is a real, confirmed answer. */
function groundIsKnown(state: GroundState): boolean {
  return state.source !== 'unknown' && state.source !== 'unreadable'
}

export function ThemeMenu({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const groundState = useGroundState()
  const ground = groundState.choice
  const setGround = setGroundChoice
  const note = groundNote(groundState)
  const known = groundIsKnown(groundState)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const shell = useMudavymShell()

  useEffect(() => {
    // The house Popover portals to <body>, so a click inside it is outside
    // `ref` — this listener would close the menu the moment you aimed at it.
    // The Popover owns dismissal in that branch.
    if (!open || shell.on) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, shell.on])

  const TriggerIcon = shell.on
    ? ground === 'charcoal' ? Moon : Sun
    : resolvedTheme === 'dark' ? Moon : Sun

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="rounded-xl bg-gray-100 p-2 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          shell.on
            ? known
              ? `Ground: ${ground === 'charcoal' ? 'Charcoal' : 'Paper'}`
              : 'Ground: not read yet'
            : `Theme: ${theme === 'system' ? `System (${resolvedTheme})` : theme}`
        }
      >
        <TriggerIcon className="w-5 h-5" />
      </button>

      {shell.on ? (
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          label="Ground"
          width={note ? 260 : 180}
          showClose={false}
        >
          {GROUND_OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = known && ground === value
            return (
              <button
                key={value}
                type="button"
                className="mdv-item"
                data-active={active}
                onClick={() => {
                  setGround(value)
                  setOpen(false)
                }}
              >
                <Icon size={14} aria-hidden className="mdv-item__icon" />
                <span className="mdv-item__text">{label}</span>
                {active && <Check size={14} aria-hidden style={{ color: 'var(--seal)' }} />}
              </button>
            )
          })}
          {note ? (
            <p className="mdv-menu-note" role="status" data-ground-note>
              {note}
            </p>
          ) : null}
        </Popover>
      ) : null}

      {open && !shell.on && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-xl z-50 dark:border-gray-700 dark:bg-gray-800"
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = theme === value
            return (
              <button
                key={value}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">{label}</span>
                {active && <Check className="w-4 h-4 text-wine-600" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
