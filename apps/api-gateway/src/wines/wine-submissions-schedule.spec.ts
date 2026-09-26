/**
 * WineSubmissionsService runs on a schedule, not only when a browser calls
 * `POST /wines/submissions/process` — the founder's answer of 2026-09-22
 * (round 6z), verbatim pick (4): "Schedule + admin only (Recommended)".
 * The route's own gate (platform admin) is proved in wines.controller.spec.ts;
 * proved here: the scheduled run calls the same worker, and a failed run is
 * logged rather than an unhandled rejection that would take the whole
 * scheduler queue down with it.
 *
 * Real: `WineSubmissionsService`, called directly. Double: `DatabaseService`
 * (a fluent stub over the one query `processPendingSubmissions` opens with).
 */
import { WineSubmissionsService } from "./wine-submissions.service";

function fluentQuery(result: { data: any[] | null; error: { message: string } | null }) {
  const q: any = {};
  q.select = jest.fn(() => q);
  q.eq = jest.fn(() => q);
  q.order = jest.fn(() => q);
  q.limit = jest.fn(async () => result);
  return q;
}

function build(result: { data: any[] | null; error: { message: string } | null }) {
  const query = fluentQuery(result);
  const dbService = { supabase: { from: jest.fn(() => query) } } as any;
  const service = new WineSubmissionsService(dbService);
  (service as any).logger.error = jest.fn();
  (service as any).logger.log = jest.fn();
  return { service, dbService, logger: (service as any).logger };
}

describe("WineSubmissionsService.scheduledProcessPendingSubmissions", () => {
  it("calls the same worker the route calls, and logs the count when it settled something", async () => {
    const t = build({ data: [], error: null });
    await t.service.scheduledProcessPendingSubmissions();
    expect(t.dbService.supabase.from).toHaveBeenCalledWith("master_wine_library_submissions");
    // Nothing pending: processed 0, so nothing is logged (a quiet run is not
    // worth a line every five minutes forever).
    expect(t.logger.log).not.toHaveBeenCalled();
  });

  it("a failed run is logged, never thrown — an unhandled rejection would take the scheduler queue down with it", async () => {
    const t = build({ data: null, error: { message: "connection reset" } });
    await expect(t.service.scheduledProcessPendingSubmissions()).resolves.toBeUndefined();
    expect(t.logger.error).toHaveBeenCalledWith(expect.stringContaining("connection reset"));
  });
});
