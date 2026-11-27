import { useState } from 'react'
import { hasInstallPrompt, showInstallPrompt } from '../../lib/installPrompt'

const DISMISSED_KEY = 'mudavym:keep-on-phone-dismissed'

function matches(query: string): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  } catch {
    return false
  }
}

function dismissedBefore(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function onIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

/**
 * A folio row on /house, phones only: keep Mudavym on the Home Screen so the
 * house can reach the person with a push (iOS web push needs a Home Screen web
 * app). A row, not a dialog: ADR 0112 allows one topmost overlay and the data
 * terms sheet may be open. No motion in either mode.
 */
export function KeepOnPhone() {
  const [hidden, setHidden] = useState(dismissedBefore)
  const [asked, setAsked] = useState(false)
  const standalone =
    matches('(display-mode: standalone)') || (navigator as { standalone?: boolean }).standalone === true
  if (hidden || asked || standalone || !matches('(pointer: coarse)')) return null

  const canPrompt = hasInstallPrompt()
  if (!canPrompt && !onIos()) return null

  const notNow = () => {
    setHidden(true)
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Storage refused: the row still goes away for this visit.
    }
  }

  return (
    <div className="py-6" data-testid="keep-on-phone">
      <p className="font-serif text-2xl">Keep Mudavym on your phone</p>
      {canPrompt ? (
        <button
          type="button"
          onClick={() => {
            setAsked(true)
            void showInstallPrompt()
          }}
          className="mt-3 min-h-11 bg-[#1a5e6b] px-5 text-white"
        >
          Add to Home Screen
        </button>
      ) : (
        <>
          <p className="mt-2 text-sm text-[#6d685f]">Tap Share, then Add to Home Screen.</p>
          <p className="mt-1 text-sm text-[#6d685f]">That way the house can reach you with a push.</p>
        </>
      )}
      <button
        type="button"
        onClick={notNow}
        className="mt-3 ml-0 block min-h-11 text-sm underline underline-offset-4 text-[#6d685f]"
      >
        Not now
      </button>
    </div>
  )
}
