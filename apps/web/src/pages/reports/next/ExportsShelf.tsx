/**
 * The shelf under the sheet — where a cutting is written up, and where what was
 * written up waits (OD-81, ADR 0149 row 20).
 *
 * It sits BELOW the sheet rather than on each cutting: while you read, the
 * sheet is plain (see `ReportsNext.tsx`), and an export control on every
 * cutting is exactly the chrome the founder's reading mode removed.
 *
 * Every row prints the status the gateway holds, and nothing else:
 *  - queued  — "being written", no download (there is no file yet);
 *  - ready   — the two files, and how many figures were written as withheld;
 *  - failed  — the gateway's reason, verbatim, and "Try again".
 * A list that could not be read says so; it is never shown as "nothing yet".
 *
 * PAGING (2026-09-17, the founder's answer alongside the 50-per-house cap and
 * the 90-day retention sweep — both server-side, `report-exports.service.ts`).
 * The shelf shows REPORT_EXPORTS_PAGE_LIMIT (20) at a time and always states
 * how many exports the house has stored — on the last page as much as the
 * first — never just the page it happens to be looking at. Previous/Next are
 * disabled honestly: Previous off on page 1, Next off once the gateway's own
 * count says there is no next page (or, when the count could not be read, once
 * a page comes back short of 20).
 */
import { CATALOGUE } from './rp-catalogue';
import type { AnalysisId } from './rp-sheet';
import { failureLine } from './rp-format';
import type { ExportDesk } from './useReportExports';
import { REPORT_EXPORTS_PAGE_LIMIT, type ReportExport } from '@/services/api/reports';
import { useState } from 'react';

/** The one analysis on the catalogue that reads no register, so has nothing to write up. */
const UNEXPORTABLE: ReadonlySet<AnalysisId> = new Set<AnalysisId>(['writing']);

export interface ExportsShelfProps {
  desk: ExportDesk;
  /** The cuttings on the sheet, in sheet order. */
  onSheet: AnalysisId[];
  /** The till's window as the reader set it on the till cutting. */
  tillDays: number;
}

/**
 * The paging footer's one sentence, computed as a string rather than built
 * inline across JSX lines — a stable string is what `getByText` (and a
 * reader) can compare, where JSX's own whitespace rules are not.
 */
export function pagingSummary(desk: Pick<ExportDesk, 'total' | 'page' | 'pageCount' | 'exports'>): string {
  const { total, page, pageCount, exports } = desk;
  if (total === null)
    return `The gateway could not count this house’s exports; page ${page} is listed.`;
  const start = (page - 1) * REPORT_EXPORTS_PAGE_LIMIT + 1;
  const end = start + (exports?.length ?? 0) - 1;
  const range = end > start ? `${start}–${end}` : String(start);
  const word = total === 1 ? 'Export' : 'Exports';
  const pageNote = pageCount !== null && pageCount > 1 ? ` Page ${page} of ${pageCount}.` : '';
  return `${word} ${range} of ${total} stored.${pageNote}`;
}

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function size(bytes: number | null): string {
  if (bytes == null) return '';
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function Row({ exp, desk }: { exp: ReportExport; desk: ExportDesk }) {
  const status =
    exp.status === 'queued' ? 'Being written' : exp.status === 'ready' ? 'Ready' : 'Not written';
  return (
    <li className="rp-export" data-status={exp.status}>
      <div className="rp-export__what">
        <p className="rp-sentence">
          <strong>{exp.title}</strong>
          <span className="rp-cap"> · {exp.windowLabel}</span>
        </p>
        <p className="rp-cap">
          Asked {when(exp.requestedAt)}
          {exp.attempts > 1 ? ` · attempt ${exp.attempts}` : ''}
          {exp.status !== 'queued' ? ` · settled ${when(exp.finishedAt)}` : ''}
        </p>
        {exp.status === 'ready' && (
          <p className="rp-cap">
            {exp.withheldCount === null
              ? 'The withheld count was not recorded.'
              : exp.withheldCount === 0
                ? 'Every figure in it was computed.'
                : `${exp.withheldCount} figure${exp.withheldCount === 1 ? ' is' : 's are'} written as “withheld” — the engine could not compute ${exp.withheldCount === 1 ? 'it' : 'them'}, and none is written as 0.`}
          </p>
        )}
        {exp.status === 'failed' && (
          <p className="rp-note" role="note">
            {exp.failureReason ?? 'The gateway recorded no reason.'}
          </p>
        )}
      </div>
      <div className="rp-row rp-export__acts">
        <span className="rp-tag" data-status={exp.status}>
          {status}
        </span>
        {exp.status === 'ready' && (
          <>
            <button
              type="button"
              className="rp-mini rp-ink rp-focus"
              disabled={desk.busy === `csv:${exp.id}`}
              onClick={() => desk.download(exp, 'csv')}
              aria-label={`Download ${exp.title} as CSV`}
            >
              CSV {size(exp.csvBytes)}
            </button>
            <button
              type="button"
              className="rp-mini rp-ink rp-focus"
              disabled={desk.busy === `html:${exp.id}`}
              onClick={() => desk.download(exp, 'html')}
              aria-label={`Download ${exp.title} as a print page`}
            >
              Print page {size(exp.htmlBytes)}
            </button>
          </>
        )}
        {exp.status === 'failed' && (
          <button
            type="button"
            className="rp-mini rp-ink rp-focus"
            disabled={desk.busy === `retry:${exp.id}`}
            onClick={() => desk.retry(exp.id)}
          >
            {desk.busy === `retry:${exp.id}` ? 'Asking…' : 'Try again'}
          </button>
        )}
      </div>
    </li>
  );
}

export default function ExportsShelf({ desk, onSheet, tillDays }: ExportsShelfProps) {
  const exportable = onSheet.filter((id) => !UNEXPORTABLE.has(id));
  const [picked, setChosen] = useState<AnalysisId | null>(null);
  // A cutting taken off the sheet is no longer on offer: the choice falls back
  // to the first one still there.
  const chosen = picked !== null && exportable.includes(picked) ? picked : (exportable[0] ?? null);

  const takesWindow = chosen !== null && CATALOGUE[chosen].takesWindow === true;

  return (
    <section id="rp-exports" className="rp-exports" aria-labelledby="rp-exports-title">
      <div className="rp-exports__head">
        <div>
          <h2 id="rp-exports-title" className="rp-cut__title">
            Written up
          </h2>
          <p className="rp-cap">
            A cutting written to a CSV and a page laid out for print, from the same register the
            sheet reads. A figure the engine could not compute is written “withheld”, never 0.
          </p>
        </div>

        {desk.canExport ? (
          exportable.length === 0 ? (
            <p className="rp-note">No cutting on the sheet reads a register, so there is nothing to write up.</p>
          ) : (
            <div className="rp-row" style={{ gap: 8 }}>
              <label className="rp-field">
                <span className="rp-eyebrow">Write up</span>
                <select
                  className="rp-select rp-focus"
                  aria-label="Cutting to write up"
                  value={chosen ?? ''}
                  onChange={(e) => setChosen(e.target.value as AnalysisId)}
                >
                  {exportable.map((id) => (
                    <option key={id} value={id}>
                      {CATALOGUE[id].title}
                    </option>
                  ))}
                </select>
              </label>
              {takesWindow && <span className="rp-cap">over the last {tillDays} days, as the till is set</span>}
              <button
                type="button"
                className="rp-btn rp-ink rp-focus"
                data-strong="true"
                disabled={chosen === null || desk.busy === 'new'}
                onClick={() => chosen && desk.request(chosen, takesWindow ? tillDays : null)}
              >
                {desk.busy === 'new' ? 'Asking…' : 'Write it up'}
              </button>
            </div>
          )
        ) : (
          <p className="rp-note" role="note">
            {desk.readOnlyReason}
          </p>
        )}
      </div>

      {desk.error && (
        <p className="rp-note" role="alert">
          {desk.error}{' '}
          <button type="button" className="rp-mini rp-ink rp-focus" onClick={desk.clearError}>
            Dismiss
          </button>
        </p>
      )}

      {desk.canExport &&
        (desk.listFailure ? (
          <p className="rp-note" role="alert">
            {failureLine('list of exports', desk.listFailure)}{' '}
            <button type="button" className="rp-mini rp-ink rp-focus" onClick={desk.refetch}>
              Read again
            </button>
          </p>
        ) : desk.exports === undefined ? (
          <p className="rp-cap" role="status">
            Reading this house’s exports…
          </p>
        ) : desk.exports.length === 0 ? (
          desk.page > 1 ? (
            // The store can shrink (the 50-per-house cap, the 90-day sweep)
            // between when this page was requested and when it is looked at
            // again; that is a stale page, not an empty house.
            <p className="rp-cap">
              Nothing on this page — the list changed since you turned to it.{' '}
              <button type="button" className="rp-mini rp-ink rp-focus" onClick={desk.prevPage}>
                Back
              </button>
            </p>
          ) : (
            <p className="rp-cap">Nothing has been written up for this house yet.</p>
          )
        ) : (
          <>
            <ul className="rp-list rp-exports__list">
              {desk.exports.map((exp) => (
                <Row key={exp.id} exp={exp} desk={desk} />
              ))}
            </ul>
            <div className="rp-row rp-exports__paging">
              <p className="rp-cap">{pagingSummary(desk)}</p>
              {(desk.canPrevPage || desk.canNextPage) && (
                <span className="rp-row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="rp-mini rp-ink rp-focus"
                    disabled={!desk.canPrevPage}
                    onClick={desk.prevPage}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="rp-mini rp-ink rp-focus"
                    disabled={!desk.canNextPage}
                    onClick={desk.nextPage}
                  >
                    Next
                  </button>
                </span>
              )}
            </div>
          </>
        ))}
    </section>
  );
}
