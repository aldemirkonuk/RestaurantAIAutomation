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
 */

import { useState } from 'react'
import type { CanonicalDocument } from '../../services/api/canonical'
import type { DoorCountLine } from '../../services/api/deliveries'
import { EM, MONO, SERIF, fmtQty, fmtReceived } from './canonical-format'

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
}

export function DoorFrame({
  doc,
  countedBy,
  countedAt,
  onSubmitCount,
  busy,
  error,
}: DoorFrameProps) {
  const adjudicated = new Map(doc.layer3.lines.map((l) => [l.lineIndex, l]))
  const anyCounted = doc.layer3.lines.some((l) => l.received !== 'not_counted')
  /**
   * Counts keyed by line index, and ABSENT means untouched.
   *
   * Deliberately not `Record<number, number>` seeded with zeros: a seeded zero
   * is a count of nothing, and it would be submitted as one.
   */
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [signedBy, setSignedBy] = useState('')
  const [note, setNote] = useState('')

  const touched = Object.keys(counts).length

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
      }
    })
    await onSubmitCount({
      lines,
      ...(signedBy.trim() ? { signedBy: signedBy.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    })
    setCounts({})
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
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        At the door · no prices on this screen
      </span>
      <h3 style={{ margin: '2px 0 0', fontFamily: SERIF, fontSize: 15, fontWeight: 600 }}>
        {doc.layer1.seller.name.value ?? 'This delivery'}
      </h3>
      <p style={{ margin: '1px 0 6px', fontSize: 10, color: 'var(--ink-2, #4F473C)' }}>
        {countedBy ? `Counted by ${countedBy}` : 'Nobody has counted this yet'}
        {countedAt ? ` · ${countedAt.slice(0, 16).replace('T', ' ')}` : ''}
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
                  color: 'var(--ink-3, #7C7365)',
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
                  {fmtQty(adj?.shipped ?? adj?.billed ?? null)}{' '}
                  {line.unit.value ?? ''}
                </strong>
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
                    color: 'var(--ink-3, #7C7365)',
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
                          ? 'var(--ink-3, #7C7365)'
                          : 'var(--ink-1, #211C16)',
                    }}
                  >
                    {fmtReceived(adj?.received ?? null)}
                  </span>
                )}
              </span>
              {short && (
                <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600, color: '#B0362C' }}>
                  Short of what the paperwork says.
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
          <p style={{ margin: 0, fontSize: 9.5, color: 'var(--ink-3, #7C7365)' }}>
            {touched === 0
              ? 'Nothing counted yet. A line you do not touch is not a zero — it stays “not counted”, and the delivery says so.'
              : `${touched} of ${doc.layer1.lines.length} line(s) counted. The rest stay “not counted”.`}
          </p>
          <button
            type="button"
            data-testid="door-submit"
            disabled={busy || touched === 0}
            onClick={() => void submit()}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 10px',
              borderRadius: 8,
              border: 0,
              background: touched === 0 ? 'var(--paper-2, #EAE4D8)' : 'var(--seal, #1A5E6B)',
              color: touched === 0 ? 'var(--ink-3, #7C7365)' : '#FFFDF8',
              cursor: busy ? 'wait' : touched === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Recording the count…' : 'Record this count'}
          </button>
        </div>
      ) : (
        <p style={{ margin: '7px 0 0', fontSize: 9.5, color: 'var(--ink-3, #7C7365)' }}>
          {anyCounted
            ? 'This count is on the record. Correcting it means recording another one — a count is never edited.'
            : 'Nothing has been counted at this door. Every “received” above says so in words, and none of them is a zero.'}
        </p>
      )}
    </section>
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
