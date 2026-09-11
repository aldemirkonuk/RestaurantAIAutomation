import { useState } from 'react'
import type { ResolvedLine } from '../../services/api/canonical'

/**
 * RememberedShelf — ADR 0104 D12 slice 4, on one document line.
 *
 * FOUR STATES, AND THEY ARE NOT THREE.
 *
 *   linked       this line names a shelf. Who put it there is in the log; the
 *                only action offered is "not this one".
 *   remembered   the memory has a pairing for this line's key. It shows the
 *                shelf and ONE SENTENCE — "Remembered from N earlier documents
 *                from this vendor, last confirmed by <name> on <date>." — and a
 *                single tick. Never a percentage, never a score: a confidence
 *                shown to a person is a number they cannot act on, and ADR 0104
 *                forbids it.
 *   unavailable  the memory could not be READ. This draws differently from
 *                "nothing remembered", because the two look identical otherwise
 *                and only one of them is true. Reporting the outage as "no
 *                suggestion" is absence-reported-as-health in the one place it
 *                would never be noticed.
 *   nothing      no pairing, and the read succeeded. The page asks.
 *
 * Nothing here books stock or writes a cost. The tick calls the link door; the
 * BOOKING still happens only where ADR 0103 A12 says it does.
 */

export interface RememberedShelfProps {
  line: ResolvedLine
  /** Item id → the name a person recognises. */
  itemName: (id: string) => string | null
  /** Ticking the proposal, or choosing a shelf by hand. */
  onLink: (
    lineId: string,
    inventoryId: string | null,
    source: 'chosen' | 'remembered',
  ) => Promise<void>
  /** Opens the picker for a line with no proposal. Optional. */
  onChoose?: (lineId: string) => void
  busy?: boolean
}

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 3,
  fontSize: 10.5,
  lineHeight: 1.35,
  color: 'var(--ink-3, #7C7365)',
}

const TICK: React.CSSProperties = {
  border: '1px solid var(--rule, #D9D2C6)',
  background: 'transparent',
  borderRadius: 3,
  padding: '1px 6px',
  fontSize: 10.5,
  cursor: 'pointer',
  color: 'inherit',
}

export function RememberedShelf({
  line,
  itemName,
  onLink,
  onChoose,
  busy,
}: RememberedShelfProps) {
  const [working, setWorking] = useState(false)
  const disabled = busy || working || !line.lineId

  const run = async (inventoryId: string | null, source: 'chosen' | 'remembered') => {
    if (!line.lineId) return
    setWorking(true)
    try {
      await onLink(line.lineId, inventoryId, source)
    } finally {
      setWorking(false)
    }
  }

  // 1. Already linked.
  if (line.inventoryId) {
    const name = itemName(line.inventoryId)
    return (
      <div style={ROW} data-testid="shelf-linked">
        <span>
          {line.inventoryIdSource === 'order'
            ? 'From the order line: '
            : 'Linked to '}
          <strong style={{ color: 'var(--ink-1, #2B2721)', fontWeight: 500 }}>
            {name ?? line.inventoryId}
          </strong>
        </span>
        <button
          type="button"
          style={TICK}
          disabled={disabled}
          onClick={() => void run(null, 'chosen')}
          data-testid="shelf-unlink"
        >
          Not this one
        </button>
      </div>
    )
  }

  // 2. The memory could not be read. Said out loud, never drawn as "nothing".
  if (line.proposalUnavailable) {
    return (
      <div style={{ ...ROW, color: 'var(--warn, #946A1A)' }} data-testid="shelf-unavailable">
        <span>
          Memory unavailable — we could not check whether this line has been
          linked before, so nothing is being proposed.
          {line.proposalUnavailableReason
            ? ` (${line.proposalUnavailableReason})`
            : ''}
        </span>
      </div>
    )
  }

  // 3. The memory has a pairing. One tick, one sentence, no number.
  if (line.proposedInventoryId) {
    const name = itemName(line.proposedInventoryId)
    return (
      <div style={ROW} data-testid="shelf-proposed">
        <button
          type="button"
          style={{ ...TICK, borderColor: 'var(--ink-2, #6B6254)' }}
          disabled={disabled}
          onClick={() => void run(line.proposedInventoryId, 'remembered')}
          data-testid="shelf-accept"
        >
          ✓ {name ?? line.proposedInventoryId}
        </button>
        <span>{line.proposedSentence}</span>
      </div>
    )
  }

  // 4. Nothing remembered, and we know that for a fact.
  return (
    <div style={ROW} data-testid="shelf-none">
      <span>Names no shelf yet.</span>
      {onChoose && line.lineId && (
        <button
          type="button"
          style={TICK}
          disabled={disabled}
          onClick={() => onChoose(line.lineId as string)}
          data-testid="shelf-choose"
        >
          Choose an item
        </button>
      )}
    </div>
  )
}
