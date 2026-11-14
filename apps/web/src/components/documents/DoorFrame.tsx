/**
 * DoorFrame — the same component, at the door (ADR 0104 S10, D11).
 *
 * THE COUNT IS A WRITE (slice 3 stop 2). The `−  10  +` stepper of sketch 089
 * Direction C submits a `receiving_advice` — OUR document, ADR 0104 S6 — and,
 * on request, creates the delivery it belongs to. Before this, the frame showed
 * the vendor's numbers and could record nothing, which is the invoice-centric
 * three-way match ADR 0103 rejected wearing a phone-shaped screen.
 *
 * A LINE NOBODY TOUCHED IS NOT SUBMITTED (ADR 0103 A6). There is no zero, no
 * default and no "confirm all": the receiver counts the lines they counted, and
 * every other line keeps the words "not counted" it already carries. That is the
 * whole reason the modal case — nobody counts anything — stays honest here.
 *
 * MONEY IS SUPPRESSED BY ROLE, NOT BY BREAKPOINT (D11). Nothing here reads the
 * viewport. A receiver holding a phone at 07:41 and a manager who opened the
 * door tab on a 27-inch screen see the same thing, because the rule is about who
 * is looking and what they are deciding — not about how wide their screen is.
 * There is no unit price, no line total and no document total in this file, and
 * no prop that could carry one in.
 *
 * "EXPECTED" IS THE SHIPPED NUMBER, AND IT IS LABELLED AS THE VENDOR'S. The
 * door is not told what to find; it is told what the paperwork claims, which is
 * a different sentence and the one ADR 0103 A6 depends on.
 *
 * A CASE NEEDS ITS PACK (r28 G1). A case line whose paper does not say how many
 * bottles one holds (a pack of 1 is the column's "never stated") asks the
 * person holding it, and the count is not sent until they say. The gateway
 * refuses such a count anyway; asking here is what makes it go through.
 */

import { useState } from 'react'
import type { CanonicalDocument } from '../../services/api/canonical'
import type { DoorBooking, DoorCountLine } from '../../services/api/deliveries'
import { EM, MONO, SERIF, fmtQty, fmtReceived, fmtStamp } from './canonical-format'

/** Units whose bottles depend on the pack, as the gateway names them. */
const PACKED_UNITS = new Set(['case', 'pack', 'split_case'])
const PACKED_WORD: Record<string, string> = { case: 'case', pack: 'pack', split_case: 'split case' }

/** A pack that says how many bottles: a whole number of 2 or more, else null. */
export function knownPack(n: unknown): number | null {
  const v = Number(n)
  return n != null && n !== '' && Number.isInteger(v) && v >= 2 ? v : null
}

/**
 * What the paperwork says for a line, in words (r31 walk). Layer 3's figures
 * are bottle-equivalents: a paper of 2 cases of 12 bills 24. Printed with the
 * paper's own unit word, that read "24 KOLİ" beside "12 bottles to a case".
 * With the pack known the figure goes back to the paper's count, with the
 * bottles beside it; with no pack stated the figure IS the paper's count.
 */
export function paperworkWords(
  q: number | null | undefined,
  packed: boolean,
  pack: number | null,
  printedUnit: string,
): string {
  if (q == null || !packed || pack === null) return `${fmtQty(q)} ${printedUnit}`.trim()
  if (q % pack === 0) return `${fmtQty(q / pack)} ${printedUnit} (${bottlesWords(q)})`.trim()
  return bottlesWords(q)
}

/**
 * What the door already counted, in words (r31 walk). A packed line's count
 * is booked in bottles (the gateway refuses one whose pack is unknown), so it
 * is said in bottles, never as that many cases.
 */
export function countedWords(q: number, packed: boolean, printedUnit: string): string {
  return packed ? bottlesWords(q) : `${fmtQty(q)} ${printedUnit}`.trim()
}

function bottlesWords(q: number): string {
  return `${fmtQty(q)} ${q === 1 ? 'bottle' : 'bottles'}`
}

export interface DoorFrameProps {
  doc: CanonicalDocument
  /** Who counted, when the record names them. */
  countedBy?: string | null
  countedAt?: string | null
  /**
   * Submit the lines somebody counted. Absent = the frame is read-only, which is
   * what a document that is already a door count shows.
   */
  onSubmitCount?: (input: {
    lines: DoorCountLine[]
    signedBy?: string
    note?: string
  }) => Promise<void>
  busy?: boolean
  /** The gateway's own words when it refused. */
  error?: string | null
  /** What the last count put on the shelf, and what it did not, with why (r24). */
  booking?: DoorBooking | null
  /** The house's clock (IANA zone); absent = the reader's. r34 w2 F1. */
  zone?: string | null
}

export function DoorFrame({
  doc,
  countedBy,
  countedAt,
  onSubmitCount,
  busy,
  error,
  booking,
  zone,
}: DoorFrameProps) {
  const adjudicated = new Map(doc.layer3.lines.map((l) => [l.lineIndex, l]))
  /** r24: each line's own row and pairing on the paper, by index. */
  const resolved = new Map(doc.layer2.lines.map((l) => [l.lineIndex, l]))
  const anyCounted = doc.layer3.lines.some((l) => l.received !== 'not_counted')
  /**
   * Counts keyed by line index, and ABSENT means untouched.
   *
   * Deliberately not `Record<number, number>` seeded with zeros: a seeded zero
   * is a count of nothing, and it would be submitted as one.
   */
  const [counts, setCounts] = useState<Record<number, number>>({})
  /** Bottles in one case, typed at the door, for a case the paper has no pack for. */
  const [packs, setPacks] = useState<Record<number, string>>({})
  const [signedBy, setSignedBy] = useState('')
  const [note, setNote] = useState('')

  const touched = Object.keys(counts).length

  /** The unit word when line `i` is packed, or null. */
  const packedUnit = (i: number): string | null => {
    const uom = resolved.get(i)?.canonicalUom ?? null
    return uom && PACKED_UNITS.has(uom) ? uom : null
  }
  /** The paper's own pack for line `i`, when it states one. */
  const paperPack = (i: number) => knownPack(resolved.get(i)?.packSize)
  /** Line `i` is a case the paper has no pack for. */
  const asksPack = (i: number) => packedUnit(i) !== null && paperPack(i) === null
  /** Counted case lines still waiting for their pack, by line number. */
  const packMissing = Object.entries(counts)
    .filter(([i, qty]) => qty > 0 && asksPack(Number(i)) && knownPack(packs[Number(i)]) === null)
    .map(([i]) => Number(i) + 1)

  const submit = async () => {
    if (!onSubmitCount) return
    const lines: DoorCountLine[] = Object.entries(counts).map(([i, qty]) => {
      const idx = Number(i)
      const line = doc.layer1.lines[idx]
      return {
        lineNo: idx + 1,
        description: line?.description.value ?? undefined,
        vendorSku: line?.sellerItemId.value ?? undefined,
        qty,
        uom: line?.unit.value ?? 'bottle',
        ...(line?.vintage.value != null ? { vintage: line.vintage.value } : {}),
        ...(line?.formatMl.value != null ? { formatMl: line.formatMl.value } : {}),
        // r24: the paper's own line, so the gateway books by its pairing and unit.
        ...(resolved.get(idx)?.lineId ? { sourceLineId: resolved.get(idx)!.lineId! } : {}),
        // r28 G1: the pack the door gives. Its box is drawn only where the
        // paper has none, so only those lines can carry one.
        ...(knownPack(packs[idx]) !== null ? { packSize: knownPack(packs[idx])! } : {}),
      }
    })
    await onSubmitCount({
      lines,
      ...(signedBy.trim() ? { signedBy: signedBy.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    })
    setCounts({})
    setPacks({})
    setSignedBy('')
    setNote('')
  }

  return (
    <section
      data-testid="door-frame"
      aria-label="The door view"
      className="cd-door"
      style={{
        width: 300,
        maxWidth: '100%',
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 18,
        background: 'var(--paper-0, #FAF7F1)',
        padding: '12px 14px',
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-4, #665D50)',
        }}
      >
        At the door · no prices on this screen
      </span>
      <h3 style={{ margin: '2px 0 0', fontFamily: SERIF, fontSize: 15, fontWeight: 600 }}>
        {doc.layer1.seller.name.value ?? 'This delivery'}
      </h3>
      <p style={{ margin: '1px 0 6px', fontSize: 10, color: 'var(--ink-2, #4F473C)' }}>
        {countedBy
          ? `Counted by ${countedBy}`
          : countedAt || anyCounted
            ? 'Counted at the door'
            : 'Nobody has counted this yet'}
        {countedAt
          ? ` · ${fmtStamp(countedAt, doc.jurisdiction, doc.layer1.currency.value, zone)}`
          : ''}
      </p>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
        {doc.layer1.lines.map((line, i) => {
          const adj = adjudicated.get(i)
          const short =
            typeof adj?.received === 'number' &&
            adj.shipped != null &&
            adj.received < adj.shipped
          return (
            <li
              key={i}
              data-testid="door-line"
              style={{
                border: '1px solid var(--paper-2, #EAE4D8)',
                borderRadius: 10,
                padding: '6px 9px',
                background: 'var(--paper-1, #FFFDF8)',
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 8,
                  fontWeight: 600,
                  letterSpacing: '.1em',
                  color: 'var(--ink-4, #665D50)',
                }}
              >
                Line {i + 1} of {doc.layer1.lines.length}
              </span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                {line.description.value ?? EM}
              </span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-2, #4F473C)' }}>
                The paperwork says{' '}
                <strong>
                  {paperworkWords(
                    adj?.shipped ?? adj?.billed ?? null,
                    packedUnit(i) !== null,
                    paperPack(i),
                    line.unit.value ?? '',
                  )}
                </strong>
                {packedUnit(i) && paperPack(i) !== null
                  ? ` · ${paperPack(i)} bottles to a ${PACKED_WORD[packedUnit(i)!]}`
                  : ''}
              </span>
              <span
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginTop: 2,
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 8,
                    letterSpacing: '.1em',
                    color: 'var(--ink-4, #665D50)',
                  }}
                >
                  RECEIVED
                </span>
                {onSubmitCount ? (
                  /* The stepper. Untouched means untouched: pressing − on a
                     line nobody has counted starts at 0 because the receiver
                     said 0, and clearing it removes the line from the
                     submission entirely rather than sending a zero. */
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      data-testid="door-minus"
                      aria-label={`One fewer on line ${i + 1}`}
                      onClick={() =>
                        setCounts((c) => ({
                          ...c,
                          [i]: Math.max(0, (c[i] ?? 0) - 1),
                        }))
                      }
                      style={stepper}
                    >
                      −
                    </button>
                    <input
                      data-testid="door-count-input"
                      aria-label={`Counted on line ${i + 1}`}
                      value={counts[i] ?? ''}
                      inputMode="numeric"
                      placeholder="—"
                      onChange={(e) => {
                        const raw = e.target.value.trim()
                        setCounts((c) => {
                          const next = { ...c }
                          if (raw === '') delete next[i]
                          else {
                            const n = Number(raw)
                            if (Number.isFinite(n) && n >= 0) next[i] = n
                          }
                          return next
                        })
                      }}
                      style={{
                        width: 46,
                        textAlign: 'center',
                        fontFamily: MONO,
                        fontSize: 16,
                        fontWeight: 600,
                        border: '1px solid var(--paper-2, #EAE4D8)',
                        borderRadius: 7,
                        padding: '2px 4px',
                        background: 'var(--paper-0, #FFFDF8)',
                      }}
                    />
                    <button
                      type="button"
                      data-testid="door-plus"
                      aria-label={`One more on line ${i + 1}`}
                      onClick={() =>
                        setCounts((c) => ({ ...c, [i]: (c[i] ?? 0) + 1 }))
                      }
                      style={stepper}
                    >
                      +
                    </button>
                  </span>
                ) : (
                  <span
                    data-testid="door-received"
                    style={{
                      fontFamily: adj?.received === 'not_counted' ? 'inherit' : MONO,
                      fontSize: adj?.received === 'not_counted' ? 11 : 17,
                      fontWeight: 600,
                      color:
                        adj?.received === 'not_counted'
                          ? 'var(--ink-4, #665D50)'
                          : 'var(--ink-1, #211C16)',
                    }}
                  >
                    {fmtReceived(adj?.received ?? null)}
                  </span>
                )}
              </span>
              {onSubmitCount && asksPack(i) && (
                <label
                  data-testid="door-pack"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 4, fontSize: 10.5, fontWeight: 600 }}
                >
                  <span>
                    Bottles in one {PACKED_WORD[packedUnit(i)!]}
                    <span style={{ display: 'block', fontSize: 9.5, fontWeight: 400, color: '#94661A' }}>
                      The paper does not say. Count them in one.
                    </span>
                  </span>
                  <input
                    data-testid="door-pack-input"
                    aria-label={`Bottles in one ${PACKED_WORD[packedUnit(i)!]} on line ${i + 1}`}
                    value={packs[i] ?? ''}
                    inputMode="numeric"
                    placeholder="—"
                    onChange={(e) => {
                      const raw = e.target.value.trim()
                      setPacks((p) => {
                        const next = { ...p }
                        if (raw === '') delete next[i]
                        else next[i] = raw
                        return next
                      })
                    }}
                    style={{
                      width: 46,
                      textAlign: 'center',
                      fontFamily: MONO,
                      fontSize: 14,
                      fontWeight: 600,
                      border: '1px solid var(--paper-2, #EAE4D8)',
                      borderRadius: 7,
                      padding: '2px 4px',
                      background: 'var(--paper-0, #FFFDF8)',
                    }}
                  />
                </label>
              )}
              {short && (
                <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600, color: '#B0362C' }}>
                  Short of what the paperwork says.
                </span>
              )}
              {onSubmitCount && typeof adj?.received === 'number' && (
                <span data-testid="door-counted-so-far" style={{ display: 'block', fontSize: 9.5, color: 'var(--ink-2, #4F473C)' }}>
                  Counted so far: {countedWords(adj.received, packedUnit(i) !== null, line.unit.value ?? '')}. A new count of this line replaces it.
                </span>
              )}
              {onSubmitCount && resolved.has(i) && resolved.get(i)!.inventoryIdSource !== 'line' && (
                <span data-testid="door-unpaired" style={{ display: 'block', fontSize: 9.5, color: '#94661A' }}>
                  Not paired with a good on this paper. A count of it is kept, but it goes on no
                  shelf until the line is paired on the sheet.
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {onSubmitCount ? (
        <div style={{ marginTop: 8, display: 'grid', gap: 5 }}>
          <label style={{ fontSize: 10.5, fontWeight: 600 }}>
            Who signed the vendor’s ticket
            <input
              data-testid="door-signed-by"
              value={signedBy}
              placeholder="nobody signed"
              onChange={(e) => setSignedBy(e.target.value)}
              style={doorField}
            />
          </label>
          <label style={{ fontSize: 10.5, fontWeight: 600 }}>
            Anything worth saying
            <input
              data-testid="door-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={doorField}
            />
          </label>
          {error && (
            <p data-testid="door-error" role="alert" style={{ margin: 0, fontSize: 10.5, color: '#B0362C' }}>
              {error}
            </p>
          )}
          {booking && <BookingNote booking={booking} />}
          {packMissing.length > 0 && (
            <p data-testid="door-pack-missing" role="status" style={{ margin: 0, fontSize: 10.5, color: '#94661A' }}>
              {packMissing.length === 1 ? `Line ${packMissing[0]} is` : `Lines ${packMissing.join(', ')} are`} counted
              in cases the paper gives no size for. Say how many bottles are in one (2 or more) before recording,
              or the count would go on the shelf as that many bottles.
            </p>
          )}
          <p style={{ margin: 0, fontSize: 9.5, color: 'var(--ink-4, #665D50)' }}>
            {touched === 0
              ? 'Nothing counted yet. A line you do not touch is not a zero — it stays “not counted”, and the delivery says so.'
              : `${touched} of ${doc.layer1.lines.length} line(s) counted. The rest stay “not counted”.`}
          </p>
          <button
            type="button"
            data-testid="door-submit"
            disabled={busy || touched === 0 || packMissing.length > 0}
            onClick={() => void submit()}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 10px',
              borderRadius: 8,
              border: 0,
              background: touched === 0 || packMissing.length > 0 ? 'var(--paper-2, #EAE4D8)' : 'var(--seal, #1A5E6B)',
              color: touched === 0 || packMissing.length > 0 ? 'var(--ink-4, #665D50)' : '#FFFDF8',
              cursor: busy ? 'wait' : touched === 0 || packMissing.length > 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Recording the count…' : 'Record this count'}
          </button>
        </div>
      ) : (
        <p style={{ margin: '7px 0 0', fontSize: 9.5, color: 'var(--ink-4, #665D50)' }}>
          {anyCounted
            ? 'This count is on the record. Correcting it means recording another one — a count is never edited.'
            : 'Nothing has been counted at this door. Every “received” above says so in words, and none of them is a zero.'}
        </p>
      )}
    </section>
  )
}

/** What the last count put on the shelf (r24). Every line not booked says why. */
function BookingNote({ booking }: { booking: DoorBooking }) {
  const moved = booking.booked.filter((b) => b.delta !== 0).length
  return (
    <div data-testid="door-booking" role="status" style={{ fontSize: 10.5, color: 'var(--ink-2, #4F473C)' }}>
      <p style={{ margin: 0 }}>
        {booking.failed
          ? `The count is recorded, but nothing was put on the shelf: ${booking.error ?? 'the booking failed'}.`
          : moved === 0 && booking.notBooked.length === 0
            ? 'The count is recorded. The shelf already held it, so nothing moved.'
            : `The count is recorded. ${moved} line${moved === 1 ? '' : 's'} went on the shelf.`}
      </p>
      {booking.notBooked.map((n) => (
        <p key={`${n.lineNo}-${n.label}`} style={{ margin: '2px 0 0', color: '#94661A' }}>
          Not on the shelf: {n.label} — {n.reason}
        </p>
      ))}
    </div>
  )
}

const stepper: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 8,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FFFDF8)',
  fontSize: 15,
  lineHeight: 1,
  cursor: 'pointer',
  color: 'var(--ink-1, #211C16)',
}

const doorField: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 2,
  padding: '4px 7px',
  fontSize: 12,
  border: '1px solid var(--paper-2, #EAE4D8)',
  borderRadius: 7,
  background: 'var(--paper-0, #FFFDF8)',
}

export default DoorFrame
