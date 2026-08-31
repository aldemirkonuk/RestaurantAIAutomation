/**
 * DocumentsReportsNext — the Sorting Office (Direction D, founder-chosen
 * 2026-08-31 after two sketch rounds; 06-pages/documents-reports.md §1b).
 *
 * The structure the founder picked: everything that arrives sorts into a
 * named, COUNTABLE drawer the moment it lands — signal floats ("Waiting on
 * you", oldest debt first), noise files itself and stays countable (the
 * routine roll), and reading keeps Direction C's cleanliness as the detail
 * pane. Built for volume: list windows are bounded, counts render as floors
 * ("≥") when a window fills, and every count is a real count from its own
 * register — a drawer never claims a number its query hasn't answered.
 *
 * Honesty rules carried: unknown counts are em dashes; OD-81's file truth
 * stands (a report whose file was never attached says so, with the control
 * disabled and the reason beside it, never a dead button); a fetch failure
 * is said in words, branch-aware.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Wordmark } from '@/components/mudavym';
import type { GeneratedReport } from '../../../hooks/queries/useReportQueries';
import { ink, settle } from '../../../lib/mudavym/motion';
import { EM, MONO, SANS, SERIF, fmtDate } from './so-format';
import { useSortingOfficeData } from './useSortingOfficeData';

function DrawerLabel({ children }: { children: string }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--ink-3, #7C7365)',
      }}
    >
      {children}
    </span>
  );
}

function Count({ value, capped = false }: { value: number | null; capped?: boolean }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--ink-1, #211C16)',
      }}
    >
      {value === null ? EM : `${capped ? '≥' : ''}${value}`}
    </span>
  );
}

const drawerStyle = {
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-1, #F3EFE6)',
  borderRadius: 12,
  padding: '12px 15px',
} as const;

/** Direction C's reading pane, kept as the detail surface. */
function ReadingPane({ report }: { report: GeneratedReport }) {
  const fileUrl = report.pdfUrl ?? report.excelUrl ?? report.csvUrl ?? null;
  const shareLink = `${window.location.origin}/documents-reports?doc=${report.id}`;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  // Both outcomes are said, and neither is permanent: the label reverts so
  // the control stays usable for the next copy.
  useEffect(() => {
    if (copyState === 'idle') return;
    const t = setTimeout(() => setCopyState('idle'), 2000);
    return () => clearTimeout(t);
  }, [copyState]);
  return (
    <div
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 12,
        background: 'var(--paper-1, #F3EFE6)',
        padding: '22px 26px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        animation: `so-settle ${settle.ms}ms ${settle.easing} both`,
        fontFamily: SANS,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <DrawerLabel>{`House report · ${report.reportType || 'report'}`}</DrawerLabel>
        <div className="flex gap-2">
          <button
            type="button"
            className="so-ink"
            onClick={() => {
              const clip = navigator.clipboard;
              if (!clip) {
                setCopyState('failed');
                return;
              }
              clip.writeText(shareLink).then(
                () => setCopyState('copied'),
                () => setCopyState('failed'),
              );
            }}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 8,
              border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
              background: 'transparent',
              color: 'var(--seal-deep, #14515C)',
              cursor: 'pointer',
            }}
          >
            {copyState === 'copied'
              ? 'Link copied'
              : copyState === 'failed'
                ? 'Copy failed — use the address bar'
                : 'Copy share link'}
          </button>
          {fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="so-ink"
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid var(--paper-2, #EAE4D8)',
                color: 'var(--ink-2, #4F473C)',
              }}
            >
              Open the file ↗
            </a>
          ) : (
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid var(--paper-2, #EAE4D8)',
                background: 'var(--paper-2, #EAE4D8)',
                color: 'var(--ink-3, #7C7365)',
              }}
            >
              No file was attached
            </span>
          )}
        </div>
      </div>
      <h2
        style={{
          margin: 0,
          fontFamily: SERIF,
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          lineHeight: 1.2,
        }}
      >
        {report.title || 'Untitled report'}
      </h2>
      <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3, #7C7365)' }}>
        {report.createdAt ? `written ${fmtDate(report.createdAt)}` : EM}
        {report.periodStart && report.periodEnd
          ? ` · covers ${fmtDate(report.periodStart)} – ${fmtDate(report.periodEnd)}`
          : ''}
      </span>
      {report.summary ? (
        report.summary.split(/\n{2,}/).map((para, i) => (
          <p
            key={i}
            style={{
              margin: i === 0 ? '6px 0 0' : 0,
              fontSize: 13.5,
              color: 'var(--ink-2, #4F473C)',
              lineHeight: 1.65,
              maxWidth: '64ch',
              whiteSpace: 'pre-line',
            }}
          >
            {para}
          </p>
        ))
      ) : (
        <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--ink-3, #7C7365)' }}>
          This report carries no written summary — only what the file would hold
          {fileUrl ? '.' : ', and its file was never attached (a recorded generation gap, not a missing download).'}
        </p>
      )}
    </div>
  );
}

export default function DocumentsReportsNext() {
  const data = useSortingOfficeData();
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [waitingOpen, setWaitingOpen] = useState(true);

  // Honour the page's own share links: ?doc=<id> preselects that report.
  const docParam = searchParams.get('doc');
  useEffect(() => {
    if (docParam) setSelectedId(docParam);
  }, [docParam]);

  const selected = data.reports.find((r) => r.id === selectedId) ?? null;

  return (
    <div
      className="mudavym min-h-screen"
      style={{ background: 'var(--paper-0, #FAF7F1)', color: 'var(--ink-1, #211C16)' }}
    >
      <style>{`
        @keyframes so-settle { from { transform: translateY(-4px); opacity: 0 } to { transform: none; opacity: 1 } }
        .so-row, .so-ink { transition: background ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing} }
        .so-row:hover, .so-ink:hover { background: var(--paper-0, #FAF7F1) }
        .so-row:focus-visible, .so-ink:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: 2px }
        @media (prefers-reduced-motion: reduce) { .so-row, .so-ink, [style*="so-settle"] { animation: none !important; transition: none !important } }
      `}</style>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Wordmark size={13} />
            <h1
              style={{
                fontFamily: SERIF,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: '-0.015em',
                lineHeight: 1.1,
                margin: '4px 0 0',
              }}
            >
              Documents &amp; Reports
            </h1>
          </div>
          <div className="flex gap-5 text-right" style={{ fontFamily: SANS }}>
            <div>
              <DrawerLabel>Needs a human</DrawerLabel>
              <Count value={data.waiting === null ? null : data.waiting.length} />
            </div>
            <div>
              <DrawerLabel>In the registers</DrawerLabel>
              <Count
                value={
                  data.paperCount === null ||
                  data.timelineCount === null ||
                  data.threadsTotal === null ||
                  !data.reportsKnown
                    ? null
                    : data.reports.length +
                      data.paperCount +
                      data.threadsTotal +
                      data.timelineCount
                }
                capped={data.paperCapped || data.timelineCapped}
              />
            </div>
          </div>
        </header>

        {data.anyError && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{
              fontFamily: SANS,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-1, #F3EFE6)',
            }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
              {data.hasData
                ? `A register could not be refreshed (${data.errorMessage}) — its drawer shows the last answer or ${EM}; the other drawers keep their own state.`
                : `The registers could not be reached (${data.errorMessage}) — every drawer shows ${EM}; nothing below is claimed.`}
            </span>
            <button
              type="button"
              className="so-ink"
              onClick={data.refetch}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[480px_minmax(0,1fr)]">
          {/* ── the drawers ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3" style={{ fontFamily: SANS }}>
            {/* signal floats: the waiting drawer leads */}
            <section
              aria-label="Waiting on you"
              style={{ ...drawerStyle, border: '1px solid var(--seal-ring, rgba(26,94,107,.32))' }}
            >
              <button
                type="button"
                className="so-ink flex w-full items-baseline gap-3"
                onClick={() => setWaitingOpen((o) => !o)}
                aria-expanded={waitingOpen}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--seal-deep, #14515C)',
                  }}
                >
                  Drawer · Waiting on you
                </span>
                <span className="ml-auto">
                  <Count value={data.waiting === null ? null : data.waiting.length} />
                </span>
              </button>
              {waitingOpen &&
                (data.waiting === null ? (
                  <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '8px 0 0' }}>
                    Its registers haven’t all answered — the queue opens only when the debt order is
                    known.
                  </p>
                ) : data.waiting.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '8px 0 0' }}>
                    Nothing needs you. The registers keep counting without you.
                  </p>
                ) : (
                  <div style={{ marginTop: 6 }}>
                    {data.waiting.slice(0, 6).map((w) => (
                      <Link
                        key={w.key}
                        to={w.href}
                        className="so-row flex items-baseline gap-3"
                        style={{
                          padding: '7px 4px',
                          borderTop: '1px solid var(--paper-2, #EAE4D8)',
                          fontSize: 12.5,
                          color: 'inherit',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{w.title}</span>
                        <span style={{ color: 'var(--ink-3, #7C7365)', fontSize: 11.5 }}>{w.detail}</span>
                        <span className="ml-auto" style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3, #7C7365)' }}>
                          {fmtDate(w.since)}
                        </span>
                      </Link>
                    ))}
                    {data.waiting.length > 6 && (
                      <p style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', margin: '6px 0 0' }}>
                        {data.waiting.length - 6} more · sorted oldest-debt first, never by arrival
                      </p>
                    )}
                  </div>
                ))}
            </section>

            {/* the registers, countable */}
            <div className="grid grid-cols-2 gap-3">
              <section aria-label="House reports" style={drawerStyle}>
                <DrawerLabel>House reports</DrawerLabel>
                <div className="flex items-baseline gap-2">
                  <Count value={data.reportsKnown ? data.reports.length : null} />
                  <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                    {data.reportsKnown && data.reports.length > 0 && data.reports[0].createdAt
                      ? `latest ${fmtDate(data.reports[0].createdAt)}`
                      : data.reportsKnown
                        ? 'none written yet'
                        : ''}
                  </span>
                </div>
                <div style={{ marginTop: 4, maxHeight: 132, overflowY: 'auto' }}>
                  {data.reports.slice(0, 20).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      aria-pressed={selectedId === r.id}
                      className="so-row block w-full text-left"
                      style={{
                        padding: '5px 4px',
                        border: 'none',
                        borderTop: '1px solid var(--paper-2, #EAE4D8)',
                        borderLeft:
                          selectedId === r.id
                            ? '3px solid var(--seal, #1A5E6B)'
                            : '3px solid transparent',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: 'var(--ink-1, #211C16)',
                        fontFamily: SANS,
                      }}
                    >
                      {r.title || 'Untitled report'}
                    </button>
                  ))}
                </div>
              </section>

              <section aria-label="Vendor paper" style={drawerStyle}>
                <DrawerLabel>Vendor paper</DrawerLabel>
                <div className="flex items-baseline gap-2">
                  <Count value={data.paperCount} capped={data.paperCapped} />
                  <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                    {data.paperNeedsReviewCount === null
                      ? ''
                      : `${data.paperNeedsReviewCapped ? '≥' : ''}${data.paperNeedsReviewCount} need review`}
                  </span>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)', display: 'block' }}>
                  invoices · slips · credit memos
                </span>
                <Link
                  to="/receipts"
                  className="so-ink"
                  style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
                >
                  Open in Receipts
                </Link>
              </section>

              <section aria-label="Conversations" style={drawerStyle}>
                <DrawerLabel>Conversations</DrawerLabel>
                <div className="flex items-baseline gap-2">
                  <Count value={data.threadsTotal} />
                  <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                    {data.draftsPending === null ? '' : `${data.draftsPending} draft${data.draftsPending === 1 ? '' : 's'} waiting`}
                  </span>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)', display: 'block' }}>
                  vendor threads, classified
                </span>
                <Link
                  to="/communications"
                  className="so-ink"
                  style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
                >
                  Open in Communications
                </Link>
              </section>

              <section aria-label="System log" style={drawerStyle}>
                <DrawerLabel>System log</DrawerLabel>
                <div className="flex items-baseline gap-2">
                  <Count value={data.timelineCount} capped={data.timelineCapped} />
                  <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                    {data.timelineCapped ? 'latest window' : 'recent entries'}
                  </span>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)', display: 'block' }}>
                  syncs · counts · agent runs
                </span>
                <Link
                  to="/logs"
                  className="so-ink"
                  style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
                >
                  Open the timeline
                </Link>
              </section>
            </div>

            {/* the noise roll: filed, countable, never deleted, never in the way */}
            <section
              aria-label="Filed itself today"
              style={{
                border: '1px dashed var(--ink-3, #7C7365)',
                borderRadius: 12,
                padding: '10px 15px',
              }}
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <DrawerLabel>Filed itself today</DrawerLabel>
                {data.todayRoutine === null ? (
                  <span style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>{EM}</span>
                ) : data.todayRoutine.count === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
                    nothing yet today
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
                    {data.todayRoutine.count} entr{data.todayRoutine.count === 1 ? 'y' : 'ies'} —{' '}
                    {Array.from(data.todayRoutine.bySource.entries())
                      .map(([s, n]) => `${n} ${s.replace(/_/g, ' ')}`)
                      .join(' · ')}
                  </span>
                )}
                <Link
                  to="/logs"
                  className="so-ink ml-auto"
                  style={{ fontSize: 11, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
                >
                  Open the drawer
                </Link>
              </div>
            </section>

            <p style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', margin: 0 }}>
              Every count is a real count from its own register; a filled window renders as a floor
              (≥), never as a total it cannot know.
            </p>
          </div>

          {/* ── C's reading pane, kept ──────────────────────────────────── */}
          <section aria-label="Reading pane">
            {selected ? (
              <ReadingPane key={selected.id} report={selected} />
            ) : data.reportsKnown && data.reports.length === 0 ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
                The house has written no reports yet — when it does, they open here, with room to
                read.
              </p>
            ) : (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3, #7C7365)' }}>
                Choose a report from the drawer — it opens here, full width, with room to read.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
