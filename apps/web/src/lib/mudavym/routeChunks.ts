/**
 * Route chunks that can be fetched before the click (sketch: TanStack Router
 * `preload="intent"`, Next.js hover prefetch). One factory per route: the
 * router's lazy component and the rail's intent call share it, so the module is
 * imported once and the route renders through the same promise.
 */

let reports: Promise<typeof import('../../pages/reports/next/ReportsNext')> | null = null;

/** Loads the /reports chunk; memoised so a hover and the click share one fetch. */
export const loadReports = () => {
  if (!reports) {
    reports = import('../../pages/reports/next/ReportsNext');
    // A failed fetch must not be remembered: the next try asks again.
    reports.catch(() => {
      reports = null;
    });
  }
  return reports;
};

/** A room path with a chunk that may be fetched early. */
export const ROUTE_LOADERS: Record<string, () => Promise<unknown>> = {
  '/reports': loadReports,
};
