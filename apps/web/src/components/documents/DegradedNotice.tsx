/**
 * DegradedNotice — the honest failure (ADR 0104 D6).
 *
 * The founder's blank-page question, answered on screen. When extraction did not
 * run, or ran and read nothing, the page shows the ORIGINAL, whatever header
 * fields exist, and an explicit NOT EXTRACTED banner. It NEVER renders an empty
 * canonical document as a complete one — a sheet with no lines and a total of
 * zero reads as "the vendor billed nothing", which is a claim nobody made.
 *
 * THE NULL VERDICT IS ITS OWN STATE. `intake_verdict` is a column with no writer
 * yet, so almost every row holds NULL. NULL means the intake gate never ran; it
 * does not mean the document failed one. Treating the two the same would flag
 * every readable document as degraded, and — worse — would teach a reader that
 * the banner means nothing. So: a non-null verdict other than `ok` degrades the
 * page; a NULL verdict is stated separately, in smaller words, as a gap in what
 * we recorded.
 */

import { MONO } from './canonical-format'

export interface DegradedNoticeProps {
  /** Why the sheet cannot be trusted as complete. */
  reasons: string[]
  /** The intake gate's own verdict, when one was recorded. */
  verdict?: string | null
  verdictReason?: string | null
  lineCount: number
}

/**
 * Does this document render as degraded?
 *
 * Exported so the page and its tests share ONE rule rather than two that drift.
 */
export function degradedReasons(input: {
  lineCount: number
  intakeVerdict?: string | null
  intakeReason?: string | null
  extractionModel?: string | null
  notes?: string[]
}): string[] {
  const reasons: string[] = []
  if (input.lineCount === 0)
    reasons.push(
      'No lines were read from this document. The line table is empty because nothing was extracted — not because the document had nothing on it.',
    )
  if (input.intakeVerdict && input.intakeVerdict !== 'ok')
    reasons.push(
      `The intake gate rejected this document as “${input.intakeVerdict}”${
        input.intakeReason ? `: ${input.intakeReason}` : '.'
      }`,
    )
  return reasons
}

export function DegradedNotice({
  reasons,
  verdict,
  verdictReason,
  lineCount,
}: DegradedNoticeProps) {
  if (reasons.length === 0) return null
  return (
    <section
      data-testid="degraded-notice"
      role="status"
      style={{
        border: '1px dashed rgba(148,102,26,.55)',
        background: 'rgba(148,102,26,.06)',
        borderRadius: 10,
        padding: '9px 13px',
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '.14em',
          color: '#94661A',
        }}
      >
        NOT EXTRACTED
      </span>
      <ul style={{ margin: '3px 0 0', paddingLeft: 16, fontSize: 11.5, lineHeight: 1.4 }}>
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--ink-2, #4F473C)' }}>
        The original is beside this notice. {lineCount === 0 ? 'Until someone types the lines or a readable copy arrives, this document proves only that it exists.' : ''}
        {verdict == null && (
          <>
            {' '}
            No intake verdict was recorded for this document, so the blank-page,
            duplicate and resolution checks are not known to have run.
          </>
        )}
        {verdict && verdictReason ? ` ${verdictReason}` : ''}
      </p>
    </section>
  )
}

export default DegradedNotice
