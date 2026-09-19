/**
 * The sighting sheet — one row on the register, opened on demand.
 *
 * ADR 0160 §112: the detail behind a rung is "opened after real interest and
 * is NOT pre-fetched or eagerly cached." This component only exists in the
 * tree while a row is open (`VendorPricesNext` mounts it conditionally), and
 * its identity panel fetches nothing until then either
 * (`useSightingIdentity`'s `enabled`) — closing the sheet drops the query
 * (`gcTime: 0` on both reads), reopening it fetches fresh rather than
 * trusting a stale cache the founder explicitly ruled out caching in the
 * first place.
 *
 * ADR 0149 answer 17, the founder in session: "A new nullable
 * deciding-house column; the person's name and undo only inside that
 * house." `IdentityDecision.personShown`/`decidedIn`/`undoRefusal` (from
 * `identity.service.ts#presentDecision`) are read here exactly as the
 * gateway sent them — never re-derived, never defaulted to "shown".
 */

import type { ReactNode } from 'react'
import { Sheet } from '../../../components/mudavym/Sheet'
import { useAuth } from '../../../contexts/AuthContext'
import type { VendorObservationRow } from '../../../services/api/vendorIntel'
import { candidateMethodLabel, EM, MONO, SANS, dateWords } from './vp-format'
import { provenanceOf } from './vp-register'
import { useDecideCandidate, useSightingIdentity, useUndoDecision, type ProductRef } from './useVendorPricesNextData'

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5" style={{ fontFamily: SANS }}>
      <dt style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-1, #211C16)', textAlign: 'right', maxWidth: '65%' }}>
        {value}
      </dd>
    </div>
  )
}

/** The evidence a candidate carries — field-by-field agreement, e.g.
 * `{ producer: "agreed", name: "agreed", size: "unstated" }` — printed
 * plainly so a person decides on evidence, not a bare percent (ADR 0113). */
function evidenceWords(evidence: Record<string, unknown>): string {
  const entries = Object.entries(evidence)
  if (entries.length === 0) return 'no evidence fields recorded'
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')
}

export function SightingSheet({
  row,
  productName,
  productRef,
  onClose,
}: {
  row: VendorObservationRow
  productName: string | null
  productRef: ProductRef | null
  onClose: () => void
}) {
  const prov = provenanceOf(row)
  const { activeRole } = useAuth()
  const canUndo = activeRole === 'owner' || activeRole === 'manager'
  const { decisions, candidates } = useSightingIdentity(row.identityId, true)
  const decide = useDecideCandidate(row.identityId, productRef)
  const undo = useUndoDecision(row.identityId)

  return (
    <Sheet
      open
      onClose={onClose}
      label={`Sighting — ${prov.eyebrow}`}
      eyebrow={prov.eyebrow}
      title={productName ?? 'Product not named on the row'}
    >
      <div className="px-4 py-4" style={{ fontFamily: SANS }}>
        <p style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: '0 0 12px' }}>{prov.what}</p>

        <Row label="Vendor" value={prov.vendor} />
        <Row label="As quoted" value={<span style={{ fontFamily: MONO }}>{prov.asQuoted}</span>} />
        <Row label="Seen" value={prov.when} />
        <Row label="Verdict" value={prov.verdict} />
        <Row label="Bottle" value={prov.identityWords} />
        {prov.note && <Row label="Note" value={prov.note} />}

        <div style={{ margin: '14px 0', borderTop: '1px solid var(--paper-2, #EAE4D8)' }} />

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4, #665D50)', marginBottom: 6 }}>
          Paper
        </div>
        {prov.paper && (
          <p style={{ fontSize: 12.5, margin: '0 0 4px' }}>
            {prov.paper === 'landed' ? 'Landed — a verified receipt.' : 'Agreed — a confirmed order, not yet landed.'}
          </p>
        )}
        {prov.orderId && (
          <p style={{ fontSize: 12.5, margin: '0 0 4px' }}>
            <a href={`/receiving/${prov.orderId}/door`} style={{ color: 'var(--seal-deep, #14515C)' }}>
              Open the order and its receipt
            </a>
          </p>
        )}
        {prov.sourceUrl && (
          <p style={{ fontSize: 12.5, margin: '0 0 4px', wordBreak: 'break-all' }}>
            <a href={prov.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--seal-deep, #14515C)' }}>
              Open the source
            </a>
          </p>
        )}
        {prov.unlinked && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-4, #665D50)', margin: 0 }}>{prov.unlinked}</p>
        )}
        {!prov.orderId && !prov.sourceUrl && !prov.unlinked && !prov.paper && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-4, #665D50)', margin: 0 }}>No paper attached. This row has nothing to open.</p>
        )}
        {(row.sourceType === 'chat' || row.sourceType === 'social') && (
          <p style={{ fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: '4px 0 0' }}>
            Named absence: the message this came from is not linked. Recording a price does not yet capture
            which conversation — the WhatsApp thread, the email — it came from.
          </p>
        )}

        {row.identityId && (
          <>
            <div style={{ margin: '14px 0', borderTop: '1px solid var(--paper-2, #EAE4D8)' }} />
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4, #665D50)', marginBottom: 6 }}>
              Identity decisions on this bottle
            </div>
            {decisions.isError ? (
              <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
                Could not be read ({(decisions.error as { message?: string } | null)?.message ?? 'no reason given'}). Unknown, not "no decisions".{' '}
                <button
                  type="button"
                  onClick={() => decisions.refetch()}
                  style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Try again
                </button>
              </p>
            ) : decisions.isLoading ? (
              <p style={{ fontSize: 12, color: 'var(--ink-4, #665D50)' }}>Reading the log…</p>
            ) : decisions.data && decisions.data.items.length > 0 ? (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {decisions.data.items.map((d) => {
                  const offerUndo = canUndo && d.decidedIn === 'this_house' && d.undoRefusal === null && d.action !== 'undone'
                  return (
                    <li key={d.id} style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
                        {dateWords(d.decidedAt)}
                      </span>{' '}
                      {d.personShown ? (
                        <>— {d.action} by {d.decidedByLabel} ({d.decidedByRole})</>
                      ) : (
                        <>— {d.action} by another house, outcome shared</>
                      )}
                      {d.note ? <span style={{ color: 'var(--ink-4, #665D50)' }}> — "{d.note}"</span> : null}
                      {offerUndo && (
                        <button
                          type="button"
                          disabled={undo.isPending}
                          onClick={() => undo.mutate({ decisionId: d.id })}
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--ink-2, #4F473C)',
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: undo.isPending ? 'default' : 'pointer',
                            textDecoration: 'underline',
                          }}
                        >
                          {undo.isPending ? 'Undoing…' : 'Undo'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--ink-4, #665D50)' }}>No decision has been taken on this bottle yet.</p>
            )}
            {undo.isError && (
              <p style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)', marginTop: 4 }}>The decision was not undone — try again.</p>
            )}

            {candidates.isError ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
                  The waiting queue could not be read ({(candidates.error as { message?: string } | null)?.message ?? 'no reason given'}). Unknown, not "nothing waiting".{' '}
                  <button
                    type="button"
                    onClick={() => candidates.refetch()}
                    style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Try again
                  </button>
                </p>
              </div>
            ) : candidates.data && candidates.data.items.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4, #665D50)', marginBottom: 6 }}>
                  Waiting for a person
                </div>
                {candidates.data.items.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--paper-2, #EAE4D8)',
                      fontSize: 12,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span>
                        {Math.round(c.confidence * 100)}% match — {candidateMethodLabel(c.method)}, proposed {dateWords(c.createdAt)}
                      </span>
                    </div>
                    <span style={{ color: 'var(--ink-4, #665D50)', fontSize: 11 }}>{evidenceWords(c.evidence)}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ candidateId: c.id, decision: 'confirmed' })}
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                          background: 'transparent',
                          color: 'var(--seal-deep, #14515C)',
                          cursor: decide.isPending ? 'default' : 'pointer',
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ candidateId: c.id, decision: 'rejected' })}
                        style={{
                          fontSize: 11.5,
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--paper-2, #EAE4D8)',
                          background: 'transparent',
                          color: 'var(--ink-2, #4F473C)',
                          cursor: decide.isPending ? 'default' : 'pointer',
                        }}
                      >
                        It is something else
                      </button>
                    </span>
                  </div>
                ))}
                {decide.isError && (
                  <p style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)', marginTop: 6 }}>
                    The decision was not recorded — try again.
                  </p>
                )}
              </div>
            ) : null}
          </>
        )}

        {!row.identityId && (
          <p style={{ fontSize: 11.5, color: 'var(--ink-4, #665D50)', marginTop: 6 }}>{EM} no confirmed identity — nothing to decide yet.</p>
        )}
      </div>
    </Sheet>
  )
}
