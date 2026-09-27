/**
 * ADR 0160 §112 fork 6(a) — the paper, its line, the message and the person,
 * drawn on the record. The same lines on the paper trail and in the sighting
 * sheet (`provenanceLines`, one function), so the two can never disagree about
 * where a price came from.
 */

import type { ProvenanceLine } from './vp-register'
import { SANS } from './vp-format'

const KIND_LABEL: Record<ProvenanceLine['kind'], string> = {
  paper: 'Paper',
  line: 'Line',
  message: 'Message',
  person: 'Person',
  note: 'Note',
}

export function ProvenanceList({ lines, compact = false }: { lines: ProvenanceLine[]; compact?: boolean }) {
  if (lines.length === 0) return null
  return (
    <ul
      data-testid="vp-provenance"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: compact ? 2 : 4, fontFamily: SANS }}
    >
      {lines.map((l, i) => (
        <li key={`${l.kind}-${i}`} style={{ fontSize: compact ? 11.5 : 12.5, color: 'var(--ink-2, #4F473C)' }}>
          {l.kind !== 'note' && (
            <span style={{ color: 'var(--ink-4, #665D50)' }}>{KIND_LABEL[l.kind]}: </span>
          )}
          <span style={l.kind === 'note' ? { color: 'var(--ink-4, #665D50)' } : undefined}>{l.text}</span>
          {l.href && (
            <>
              {' '}
              <a href={l.href} style={{ color: 'var(--seal-deep, #14515C)' }}>
                {l.hrefLabel ?? 'Open'}
              </a>
            </>
          )}
          {l.quote && (
            <blockquote
              style={{
                margin: '2px 0 0',
                padding: '2px 0 2px 8px',
                borderLeft: '2px solid var(--paper-2, #EAE4D8)',
                color: 'var(--ink-2, #4F473C)',
                fontStyle: 'italic',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {l.quote}
            </blockquote>
          )}
        </li>
      ))}
    </ul>
  )
}
