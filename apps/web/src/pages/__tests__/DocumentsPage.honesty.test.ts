/**
 * OD-81 / ADR 0020 — the Documents & Reports controls must not offer an action
 * that can only fail.
 *
 * Every row on `/documents-reports` comes from `generated_reports`. The only
 * writer of that table in the whole repo is `POST /reports/generate`
 * (`apps/api-gateway/src/reports/reports.service.ts:42-71`), which inserts
 * `status: "pending"` and leaves `pdf_url` / `excel_url` / `csv_url` NULL, and
 * nothing — gateway, agent-orchestrator, self-evolution, migration or edge
 * function — ever renders a file or advances the status. So `fileUrl` is
 * structurally always undefined, and View / Download / Print used to end in
 * `alert("No file available for …")` every single time.
 *
 * `reportFileUnavailableReason` is what the buttons now consult instead. It is
 * asserted directly rather than through a render because the whole point is that
 * the decision is data-driven: it must say "unavailable" for the rows that exist
 * today, and — just as importantly — get out of the way on its own the day a
 * real generator starts filling `pdf_url`. A hard-coded `false` would satisfy
 * the first half and quietly break the feature forever.
 */

import { describe, it, expect } from 'vitest'
import {
  reportFileUnavailableReason,
  NO_REPORT_FILE_REASON,
} from '../DocumentsPage'

describe('reportFileUnavailableReason — ADR 0020', () => {
  it('gives a reason for a row with no file, which is every row today', () => {
    expect(reportFileUnavailableReason({ fileUrl: undefined })).toBe(
      NO_REPORT_FILE_REASON,
    )
  })

  it('no longer claims the writer is unbuilt, and names no place that may not have one (OD-81)', () => {
    // Until 2026-09-17 the honest sentence was "not built yet". A report export
    // now exists, so that sentence would be the lie. But the export shelf is
    // on the REDESIGNED /reports only; a house still on the legacy page before
    // cutover (ADR 0149) has none, so the sentence must not send the reader
    // there. It says what is true on every page: this entry has no file.
    expect(NO_REPORT_FILE_REASON).not.toMatch(/not built yet/i)
    expect(NO_REPORT_FILE_REASON).toMatch(/no file attached/i)
    expect(NO_REPORT_FILE_REASON).not.toMatch(/\/reports|under the sheet|shelf/i)
  })

  it('treats an empty-string url as no file rather than a usable one', () => {
    expect(reportFileUnavailableReason({ fileUrl: '' })).toBe(
      NO_REPORT_FILE_REASON,
    )
  })

  it('gets out of the way once a row really has a file', () => {
    expect(
      reportFileUnavailableReason({ fileUrl: 'https://example.test/r.pdf' }),
    ).toBeNull()
  })
})
