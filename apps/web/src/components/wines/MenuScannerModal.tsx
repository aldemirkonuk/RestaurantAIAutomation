/**
 * "Scan a menu" on /cellar (WineRegister). Since the founder's MU-2 answer
 * (2026-11-07, "Repoint to menu reader") it opens the menu reader: see
 * MenuReaderDialog. The read is kept as a draft menu; nothing is written to
 * the cellar by reading it.
 *
 * The cellar's own next step is kept: once a read is done, the lines the wine
 * library does not know yet can be handed to the cellar's one-at-a-time
 * "Is this the bottle?" questions (`onWinesDetected`, translated by
 * `pages/cellar/next/readings.ts`, which drops a line with no name or no
 * producer). Nothing is written there until the person answers.
 */
import { useEffect, useRef, useState } from 'react'
import { MenuReaderDialog } from '../scanner/MenuReaderDialog'
import type { MenuImportResult, MenuImportReviewItem } from '../../services/api/menus'
import { isKitchenLine } from '../../lib/firstProof'

interface MenuScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onWinesDetected: (wines: any[]) => void
}

/** A read line, in the shape the cellar's questions read (`readingsFrom`). */
export function lineToDetected(i: MenuImportReviewItem): Record<string, unknown> {
  const v = (i.vintage ?? '').trim()
  return {
    name: i.name,
    producer: i.producer ?? '',
    // Only a four-digit year is a vintage; "NV" stays missing, never guessed.
    vintage: /^\d{4}$/.test(v) ? Number(v) : null,
    region: i.region ?? '',
    grapeVariety: i.grapeVariety ?? '',
  }
}

/**
 * The lines worth asking about in the cellar: drinks the library has not
 * matched. A kitchen line (a dish) is never one: the gateway keeps it out of
 * the library, and an answer here would put it there by hand (menu walk
 * 2026-11-11, "a kitchen line creates a wine-library row").
 */
export function unmatchedLines(r: MenuImportResult): MenuImportReviewItem[] {
  return (r.items ?? []).filter((i) => !i.matched && !isKitchenLine(i))
}

export function MenuScannerModal({ isOpen, onClose, onWinesDetected }: MenuScannerModalProps) {
  // The cellar step belongs to the read just made in THIS opening of the
  // dialog (batch review of #1066): it is dropped when the dialog closes and
  // when a new read begins, and a read that finishes after the dialog closed
  // offers nothing, so a reopened dialog never shows the last menu's lines
  // under an empty form.
  const [read, setRead] = useState<MenuImportResult | null>(null)
  const open = useRef(isOpen)
  useEffect(() => {
    open.current = isOpen
    if (!isOpen) setRead(null)
  }, [isOpen])
  const ask = read ? unmatchedLines(read) : []

  return (
    <MenuReaderDialog
      isOpen={isOpen}
      onClose={onClose}
      onReadStart={() => setRead(null)}
      onReadDone={(r) => {
        if (open.current) setRead(r)
      }}
      footer={
        read && ask.length > 0 ? (
          <div style={{ marginTop: 12 }} data-testid="menu-reader-cellar-step">
            <p className="cl-said">
              {ask.length} {ask.length === 1 ? 'line is' : 'lines are'} not in the wine library yet. The cellar can ask
              about {ask.length === 1 ? 'it' : 'them'} one at a time; nothing is written until you answer.
            </p>
            <button
              type="button"
              className="cl-btn cl-focus"
              style={{ marginTop: 8 }}
              onClick={() => onWinesDetected(ask.map(lineToDetected))}
            >
              Ask about {ask.length === 1 ? 'it' : `these ${ask.length}`} in the cellar
            </button>
          </div>
        ) : null
      }
    />
  )
}

export default MenuScannerModal
