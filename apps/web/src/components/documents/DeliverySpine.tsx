/**
 * DeliverySpine — Direction C's information architecture (ADR 0104 D13).
 *
 * The unit of record is the DELIVERY, so the documents on one event are cards
 * in time order — PO → despatch advice / e-İrsaliye → door count → invoice →
 * credit memo — with the state ladder above them. This is the only arrangement
 * whose screen grows the way the schema grows (D7: N documents per delivery),
 * and the only one that can state a line that exists on no document at all.
 *
 * COLLAPSED BY DEFAULT AT TWO OR FEWER DOCUMENTS, ABSENT AT NONE (D13, locked).
 * C's cost is chrome before the verdict; an invoice-only US delivery must open
 * as A's sheet. So the spine renders as one line of text until a person opens
 * it, and a document on no delivery renders nothing at all — `deliveries: []`.
 *
 * A NULL SPINE IS NOT AN EMPTY ONE. `deliveries === null` means the read failed
 * and is rendered as a failure, never as "this document is on no delivery"
 * (ADR 0067).
 */

import { useState } from 'react'
import type { DeliverySpine as Spine } from '../../services/api/canonical'
import {
  EM,
  MONO,
  ROLE_LABELS,
  STATE_LADDER,
  fmtDate,
  fmtMoney,
} from './canonical-format'

export interface DeliverySpineProps {
  /** `null` = the read failed. `[]` = the document is on no delivery. */
  deliveries: Spine[] | null
  failedRead?: string[]
  /** Which document the page is showing, so its card is marked. */
  selectedDocumentId: string
  onOpenDocument?: (documentId: string) => void
}

function Ladder({ state }: { state: string }) {
  const reached = STATE_LADDER.indexOf(state as (typeof STATE_LADDER)[number])
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {STATE_LADDER.map((s, i) => {
        // Off-ladder states (ORDERED, LAPSED, CANCELLED …) are real and must not
        // silently render as "nothing reached"; the caller prints them beside.
        const done = reached >= 0 && i <= reached
        const here = reached === i
        return (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {i > 0 && <span style={{ color: 'var(--ink-3, #ABA294)', fontSize: 9 }}>▸</span>}
            <span
              style={{
                fontFamily: MONO,
                fontSize: 8.5,
                fontWeight: 600,
                letterSpacing: '.1em',
                padding: here ? '3px 7px' : 0,
                borderRadius: here ? 5 : 0,
                background: here ? 'var(--seal, #1A5E6B)' : 'transparent',
                color: here
                  ? 'var(--paper-0, #FAF7F1)'
                  : done
                    ? 'var(--ink-2, #4F473C)'
                    : 'var(--ink-3, #ABA294)',
              }}
            >
              {s}
            </span>
          </span>
        )
      })}
    </span>
  )
}

function Card({
  doc,
  onOpen,
}: {
  doc: Spine['documents'][number]
  onOpen?: (id: string) => void
}) {
  const label = ROLE_LABELS[doc.role] ?? doc.role
  return (
    <li
      data-testid="spine-card"
      data-selected={doc.isSelected ? 'true' : 'false'}
      style={{
        flex: '1 1 0',
        minWidth: 150,
        border: doc.isSelected
          ? '1.5px solid var(--seal, #1A5E6B)'
          : '1px solid var(--paper-2, #EAE4D8)',
        background: doc.isSelected ? 'var(--seal-tint, rgba(26,94,107,.09))' : 'var(--paper-0, #FFFDF8)',
        borderRadius: 10,
        padding: '8px 10px',
        listStyle: 'none',
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-2, #4F473C)',
        }}
      >
        {label}
        {doc.isSelected ? ' · shown here' : ''}
      </span>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>
        {doc.docNumber ?? (
          <span style={{ color: 'var(--ink-3, #7C7365)', fontWeight: 400 }}>
            number not read
          </span>
        )}
      </span>
      <span
        style={{
          display: 'block',
          fontFamily: MONO,
          fontSize: 9,
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        {fmtDate(doc.docDate ?? doc.createdAt)} · {doc.status ?? 'status unrecorded'}
      </span>
      <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-2, #4F473C)' }}>
        {doc.total == null ? 'no money on this document' : fmtMoney(doc.total, doc.currency)}
      </span>
      {!doc.isSelected && onOpen && (
        <button
          type="button"
          onClick={() => onOpen(doc.documentId)}
          style={{
            marginTop: 3,
            fontSize: 10.5,
            fontWeight: 600,
            color: 'var(--seal-deep, #14515C)',
            background: 'none',
            border: 0,
            padding: 0,
            cursor: 'pointer',
          }}
        >
          Open this one →
        </button>
      )}
    </li>
  )
}

export function DeliverySpine({
  deliveries,
  failedRead,
  selectedDocumentId,
  onOpenDocument,
}: DeliverySpineProps) {
  // Collapsed by default; opened when the event is big enough to be the story.
  const [openIds, setOpenIds] = useState<string[]>([])

  if (deliveries === null)
    return (
      <section
        data-testid="spine-failed"
        role="alert"
        style={{
          border: '1px solid rgba(176,54,44,.4)',
          background: 'rgba(176,54,44,.06)',
          borderRadius: 10,
          padding: '8px 12px',
          fontSize: 11.5,
        }}
      >
        <strong>The delivery could not be read.</strong> This document may well
        sit on one — this screen does not know.{' '}
        {failedRead?.length ? failedRead.join(' ') : ''}
      </section>
    )

  // ADR 0104 D13: absent when the document sits on no delivery. The sheet is
  // then the whole page, which is exactly A's frame.
  if (deliveries.length === 0) return null

  return (
    <section aria-label="The delivery" data-testid="spine" style={{ display: 'grid', gap: 8 }}>
      {deliveries.map((d) => {
        const collapsedByDefault = d.documents.length <= 2
        const open = openIds.includes(d.deliveryId) || !collapsedByDefault
        const offLadder = !STATE_LADDER.includes(
          d.state as (typeof STATE_LADDER)[number],
        )
        return (
          <div
            key={d.deliveryId}
            data-testid="spine-delivery"
            data-open={open ? 'true' : 'false'}
            style={{
              border: '1px solid var(--paper-2, #EAE4D8)',
              borderRadius: 11,
              background: 'var(--paper-1, #F3EFE6)',
              padding: '8px 12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 11.5 }}>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 8.5,
                    fontWeight: 600,
                    letterSpacing: '.13em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3, #7C7365)',
                  }}
                >
                  One delivery ·{' '}
                </span>
                {d.documents.length}{' '}
                {d.documents.length === 1 ? 'document' : 'documents'} ·{' '}
                {d.deliveredAt ? fmtDate(d.deliveredAt) : 'not yet delivered'}
                {d.provenance === 'UNORDERED' && (
                  <strong
                    data-testid="unordered-mark"
                    style={{
                      marginLeft: 8,
                      fontFamily: MONO,
                      fontSize: 8.5,
                      letterSpacing: '.1em',
                      color: '#B0362C',
                      background: 'rgba(176,54,44,.10)',
                      padding: '2px 5px',
                      borderRadius: 4,
                    }}
                  >
                    UNORDERED · permanent
                  </strong>
                )}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Ladder state={d.state} />
                {offLadder && (
                  <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--ink-2, #4F473C)' }}>
                    now {d.state}
                  </span>
                )}
                {collapsedByDefault && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenIds((ids) =>
                        ids.includes(d.deliveryId)
                          ? ids.filter((x) => x !== d.deliveryId)
                          : [...ids, d.deliveryId],
                      )
                    }
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: 'var(--seal-deep, #14515C)',
                      background: 'none',
                      border: 0,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {open ? 'Hide the delivery' : 'Show the delivery'}
                  </button>
                )}
              </span>
            </div>

            {open && (
              <ul
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  margin: '8px 0 0',
                  padding: 0,
                }}
              >
                {d.documents.map((doc) => (
                  <Card
                    key={doc.documentId}
                    doc={{
                      ...doc,
                      isSelected: doc.documentId === selectedDocumentId,
                    }}
                    onOpen={onOpenDocument}
                  />
                ))}
              </ul>
            )}
            {!open && (
              <p style={{ margin: '3px 0 0', fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
                {d.documents
                  .map((doc) => ROLE_LABELS[doc.role] ?? doc.role)
                  .join(' · ') || EM}
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}

export default DeliverySpine
