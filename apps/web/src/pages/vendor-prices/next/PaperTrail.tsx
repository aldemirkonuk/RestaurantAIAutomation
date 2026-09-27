/**
 * C's paper trail, grafted onto A's ladder (ADR 0160 §112).
 *
 * Fork 6's load behaviour, answered by the founder 2026-09-18 through
 * `AskUserQuestion` ("Always on the record, loaded fresh"): the trail is
 * shown on every price record without extra clicks, and read fresh each time
 * the record opens, never served from a cache. So this component draws
 * straight from the compare read the record already made (no second request
 * to wait for, nothing behind a disclosure), and `useCompare` carries
 * `gcTime: 0` / `staleTime: 0` so reopening a record re-reads it rather than
 * serving the last copy.
 *
 * Every sighting the record holds is listed, newest first, across every
 * comparison class — the ladder groups by class to keep a consensus from
 * crossing one; the trail is chronological because a paper trail is. A
 * struck row stays on the trail, marked, never dropped.
 *
 * What a line can open today: the order and its receipt for the house's own
 * paper (fork 6b) and a recorded source link. What it cannot open yet is
 * named on the line rather than hidden (ADR 0020): fork 6(a)'s document
 * excerpt and the conversation's message and person are not built — see
 * `vendor-prices.md`.
 */

import type { VendorObservationRow } from '../../../services/api/vendorIntel'
import { MONO, SANS, dateWords } from './vp-format'
import { provenanceOf } from './vp-register'

/** Newest first; ties keep the order the gateway sent. Exported for tests. */
export function trailOrder(rows: VendorObservationRow[]): VendorObservationRow[] {
  return rows
    .map((r, i) => ({ r, i, t: Date.parse(r.observedAt) }))
    .sort((a, b) => {
      const at = Number.isNaN(a.t) ? -Infinity : a.t
      const bt = Number.isNaN(b.t) ? -Infinity : b.t
      return bt - at || a.i - b.i
    })
    .map((x) => x.r)
}

/** The words a badge carries. The words themselves ("landed", "agreed") are
 * the build's current labels; the founder's ADR 0054-wording question is
 * listed as open in `vendor-prices.md`, so each badge also says the literal
 * fact it stands for, which holds whichever label is chosen. */
function badgeFact(paper: 'landed' | 'agreed'): string {
  return paper === 'landed' ? 'receipt verified by this house' : 'order confirmed by the vendor'
}

export function PaperTrail({
  rows,
  windowDays,
  complete,
  onOpen,
}: {
  rows: VendorObservationRow[]
  windowDays: number
  complete: boolean
  onOpen: (row: VendorObservationRow) => void
}) {
  const ordered = trailOrder(rows)
  return (
    <section aria-labelledby="vp-trail-heading" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h3
          id="vp-trail-heading"
          style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4, #665D50)', margin: 0 }}
        >
          Paper trail
        </h3>
        <span style={{ fontFamily: SANS, fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
          Every sighting behind the figures above, newest first — last {windowDays} days, read fresh when this record opened.
          {complete ? '' : ' The read stopped at the gateway’s cap, so older lines may be missing.'}
        </span>
      </div>

      {ordered.length === 0 ? (
        <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)', margin: 0 }}>
          No paper on this bottle in the last {windowDays} days — no quote, receipt, order or public listing has been
          recorded for it. That is an empty trail, not an unread one.
        </p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {ordered.map((r) => {
            const p = provenanceOf(r)
            const conversational = r.sourceType === 'chat' || r.sourceType === 'social'
            return (
              <li
                key={r.id}
                data-testid="vp-trail-line"
                style={{
                  border: '1px solid var(--paper-2, #EAE4D8)',
                  borderRadius: 10,
                  padding: '8px 10px',
                  display: 'grid',
                  gap: 3,
                  fontFamily: SANS,
                  fontSize: 12,
                  color: 'var(--ink-2, #4F473C)',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: 'var(--ink-1, #211C16)' }}>
                    <span style={{ fontFamily: MONO, fontSize: 10.5 }}>{dateWords(r.observedAt)}</span> · {p.vendor} ·{' '}
                    <span style={{ fontFamily: MONO, fontSize: 10.5 }}>{p.eyebrow}</span>
                    {p.paper && (
                      <span
                        title={badgeFact(p.paper)}
                        style={{
                          marginLeft: 6,
                          fontFamily: MONO,
                          fontSize: 9,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: 'var(--seal-tint, rgba(26,94,107,.1))',
                          color: 'var(--seal-deep, #14515C)',
                        }}
                      >
                        {p.paper} — {badgeFact(p.paper)}
                      </span>
                    )}
                    {r.isOutlier && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>set aside</span>
                    )}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--ink-1, #211C16)' }}>{p.asQuoted}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' }}>
                  {p.orderId && (
                    <a href={`/receiving/${p.orderId}/door`} style={{ color: 'var(--seal-deep, #14515C)' }}>
                      Open the order and its receipt
                    </a>
                  )}
                  {p.sourceUrl && (
                    <a href={p.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--seal-deep, #14515C)' }}>
                      Open the source
                    </a>
                  )}
                  {p.unlinked && <span style={{ color: 'var(--ink-4, #665D50)' }}>{p.unlinked}</span>}
                  {conversational && (
                    <span style={{ color: 'var(--ink-4, #665D50)' }}>The message and the person it came from are not linked yet.</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpen(r)}
                    aria-label={`Open the sighting from ${p.vendor}, ${dateWords(r.observedAt)}`}
                    style={{
                      marginLeft: 'auto',
                      fontFamily: SANS,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--paper-2, #EAE4D8)',
                      background: 'transparent',
                      color: 'var(--seal-deep, #14515C)',
                      cursor: 'pointer',
                    }}
                  >
                    Details
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
