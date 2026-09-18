/**
 * The export desk — OD-81's real report, as the /reports page reads and writes it.
 *
 *   "Build a real export: CSV plus a print-ready page, stored, with an honest
 *    queued/ready/failed status."          — ADR 0149 row 20, 2026-09-16
 *
 * An export is one cutting of this sheet, written up by the GATEWAY from the
 * same analytics call the cutting reads (`apps/api-gateway/src/reports/
 * exports/`). This hook never writes a figure: it asks for an export, lists
 * the house's exports with the status the server holds, and hands a written
 * file to the reader.
 *
 * WHAT EACH STATE IS ALLOWED TO LOOK LIKE
 * --------------------------------------
 *  - The list is in flight, refused, or answered — never an empty list standing
 *    in for a failed read (`listFailure`).
 *  - A queued export is re-read every few seconds until it settles; nothing on
 *    this side decides it is done.
 *  - A download is offered only for `ready`; `failed` carries the server's own
 *    reason and a retry.
 *  - Exports are the owners' and managers' (the gateway's `@Roles`). Another
 *    role is told so before it presses anything, rather than after a 403.
 *  - The list is PAGED (`page`, `pageCount`, `prevPage`/`nextPage`) at the
 *    gateway's page size (`REPORT_EXPORTS_PAGE_LIMIT`, 20); `total` is the
 *    exact count over the whole house, kept for its own sake — 2026-09-17,
 *    the founder's answer also caps storage at 50 exports per house and 90
 *    days, both enforced server-side, so `total` and `pageCount` already
 *    reflect the store after both, not the shelf's own idea of a limit.
 */
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  REPORT_EXPORTS_PAGE_LIMIT,
  downloadReportExport,
  listReportExports,
  requestReportExport,
  retryReportExport,
  type ReportExport,
  type ReportExportFormat,
} from '@/services/api/reports';
import { failureOf, type Failure } from './rp-format';

/** How often a queued export is re-read. */
export const EXPORT_POLL_MS = 2500;

export interface ExportDesk {
  canExport: boolean;
  /** Why the controls are not offered, in words — null when they are. */
  readOnlyReason: string | null;
  exports: ReportExport[] | undefined;
  total: number | null;
  /** 1-indexed. The shelf shows REPORT_EXPORTS_PAGE_LIMIT (20) per page. */
  page: number;
  /** Null until `total` is known (an unreadable count leaves this null too). */
  pageCount: number | null;
  canPrevPage: boolean;
  canNextPage: boolean;
  prevPage: () => void;
  nextPage: () => void;
  loading: boolean;
  listFailure: Failure | null;
  refetch: () => void;
  /** The key of the act in flight: `new`, `retry:<id>` or `<format>:<id>`. */
  busy: string | null;
  /** The last act that did not go through, in the gateway's own words. */
  error: string | null;
  clearError: () => void;
  request: (cutting: string, days: number | null) => void;
  retry: (id: string) => void;
  download: (exp: ReportExport, format: ReportExportFormat) => void;
}

/** The gateway's sentence for a refusal, whether the body arrived parsed or as text. */
export function reasonOf(err: unknown): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string')
    return (data as { message: string }).message;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as { message?: unknown };
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      /* not JSON — fall through to the transport's message */
    }
  }
  return (err as { message?: string })?.message || 'the request failed';
}

/**
 * How long the blob URL outlives the click. `a.click()` only STARTS a download;
 * some Safari and Firefox versions abort it when the URL is revoked in the same
 * tick. Revoking later still frees the blob (up to 5 MB per file).
 */
export const REVOKE_AFTER_MS = 1000;

/** Hand a file to the reader. jsdom has neither `createObjectURL` nor a real click. */
export function saveFile(filename: string, mime: string, body: string): void {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

export function useReportExports({ queryRoot }: { queryRoot: string }): ExportDesk {
  const { activeRestaurantId, activeRole } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // The gateway also admits `admin`; the web's role type has no such value.
  const canExport = activeRole === 'owner' || activeRole === 'manager';
  const readOnlyReason = canExport
    ? null
    : activeRole == null
      ? 'Your role at this restaurant is not known yet, so exports are not offered until it is.'
      : 'Exports are written for owners and managers. Every figure is still on the sheet above.';

  const key = [queryRoot, 'exports', activeRestaurantId, page];
  const list = useQuery({
    queryKey: key,
    queryFn: () => listReportExports({ offset: (page - 1) * REPORT_EXPORTS_PAGE_LIMIT }),
    enabled: !!activeRestaurantId && canExport,
    // Re-read while anything ON THIS PAGE is still being written; stop once
    // it has settled. Queued exports are the newest, so in practice this only
    // ever fires on page 1 — but it is written against the page in view, not
    // "page 1", so it is still correct if that ever stops being true.
    refetchInterval: (query) =>
      (query.state.data?.exports ?? []).some((e) => e.status === 'queued') ? EXPORT_POLL_MS : false,
  });

  const total = list.data?.total ?? null;
  const pageCount = total === null ? null : Math.max(1, Math.ceil(total / REPORT_EXPORTS_PAGE_LIMIT));
  const currentLen = list.data?.exports?.length ?? 0;
  // The count is unreadable but the page still came back full: assume there
  // may be more rather than stranding the reader on page 1 forever.
  const canNextPage = pageCount !== null ? page < pageCount : currentLen === REPORT_EXPORTS_PAGE_LIMIT;
  const canPrevPage = page > 1;

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [queryRoot, 'exports'] });
  }, [qc, queryRoot]);

  const run = useCallback(
    async (actKey: string, what: string, fn: () => Promise<unknown>, after = true) => {
      if (!activeRestaurantId) return;
      setBusy(actKey);
      setError(null);
      try {
        await fn();
        if (after) refresh();
      } catch (err: unknown) {
        setError(`${what} did not go through: ${reasonOf(err)}`);
        refresh();
      } finally {
        setBusy(null);
      }
    },
    [activeRestaurantId, refresh],
  );

  const request = useCallback(
    (cutting: string, days: number | null) => {
      // A new export is always the newest — page 1 — regardless of where the
      // reader was paging when they asked for it.
      setPage(1);
      void run('new', 'The export', () =>
        requestReportExport(days == null ? { cutting } : { cutting, days }),
      );
    },
    [run],
  );

  const prevPage = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);
  const nextPage = useCallback(() => {
    setPage((p) => (pageCount !== null ? Math.min(pageCount, p + 1) : p + 1));
  }, [pageCount]);

  const retry = useCallback(
    (id: string) => {
      void run(`retry:${id}`, 'The retry', () => retryReportExport(id));
    },
    [run],
  );

  const download = useCallback(
    (exp: ReportExport, format: ReportExportFormat) => {
      void run(
        `${format}:${exp.id}`,
        format === 'csv' ? 'The CSV download' : 'The print page download',
        async () => {
          const file = await downloadReportExport(exp, format);
          saveFile(file.filename, file.mime, file.body);
        },
        false,
      );
    },
    [run],
  );

  return {
    canExport,
    readOnlyReason,
    exports: list.data?.exports,
    total,
    page,
    pageCount,
    canPrevPage,
    canNextPage,
    prevPage,
    nextPage,
    loading: list.isLoading && list.fetchStatus !== 'idle',
    // The gateway's own sentence, not the transport's "status code 500".
    listFailure: list.error ? { ...(failureOf(list.error) as Failure), message: reasonOf(list.error) } : null,
    refetch: () => void list.refetch(),
    busy,
    error,
    clearError: () => setError(null),
    request,
    retry,
    download,
  };
}
