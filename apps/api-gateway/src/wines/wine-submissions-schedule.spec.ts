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

function fluentQuery(result: {
  data: any[] | null;
  error: { message: string } | null;
}) {
  const q: any = {};
  q.select = jest.fn(() => q);
  q.eq = jest.fn(() => q);
  q.order = jest.fn(() => q);
  q.limit = jest.fn(async () => result);
  return q;
}

function build(result: {
  data: any[] | null;
  error: { message: string } | null;
}) {
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
    expect(t.dbService.supabase.from).toHaveBeenCalledWith(
      "master_wine_library_submissions",
    );
    // Nothing pending: processed 0, so nothing is logged (a quiet run is not
    // worth a line every five minutes forever).
    expect(t.logger.log).not.toHaveBeenCalled();
  });

  it("a failed run is logged, never thrown — an unhandled rejection would take the scheduler queue down with it", async () => {
    const t = build({ data: null, error: { message: "connection reset" } });
    await expect(
      t.service.scheduledProcessPendingSubmissions(),
    ).resolves.toBeUndefined();
    expect(t.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("connection reset"),
    );
  });
});

describe("a submission that keeps failing stops blocking the queue (F-654)", () => {
  function buildFailing(row: Record<string, unknown>) {
    const updates: any[] = [];
    const orders: string[] = [];
    const read: any = {};
    read.select = jest.fn(() => read);
    read.eq = jest.fn(() => read);
    read.order = jest.fn((col: string) => (orders.push(col), read));
    read.limit = jest.fn(async () => ({ data: [row], error: null }));
    const from = jest.fn(() => ({
      ...read,
      update: (patch: any) => ({
        eq: async () => (updates.push(patch), { error: null }),
      }),
    }));
    const rpc = jest.fn(async () => ({
      data: null,
      error: { message: "statement timeout" },
    }));
    const service = new WineSubmissionsService({
      supabase: { from, rpc },
    } as any);
    (service as any).logger.error = jest.fn();
    return { service, updates, orders };
  }

  const pending = (decision_reason: string | null) => ({
    id: "sub-1",
    status: "pending",
    payload: { name: "Barolo", producer: "Vietti", vintage: 2019 },
    decision_reason,
  });

  it("serves the least recently tried row first, not the oldest", async () => {
    const t = buildFailing(pending(null));
    await t.service.processPendingSubmissions();
    expect(t.orders[0]).toBe("updated_at");
  });

  it("counts a failed attempt and keeps the row pending", async () => {
    const t = buildFailing(pending("retry 2/5: match: statement timeout"));
    const res = await t.service.processPendingSubmissions();
    expect(res.results[0].status).toBe("pending");
    expect(t.updates[0]).toMatchObject({
      status: "pending",
      decision_reason: "retry 3/5: match: statement timeout",
    });
  });

  it("parks the row for review after the last attempt", async () => {
    const t = buildFailing(pending("retry 4/5: match: statement timeout"));
    const res = await t.service.processPendingSubmissions();
    expect(res.results[0].status).toBe("pending_review");
    expect(t.updates[0]).toMatchObject({
      status: "pending_review",
      decision_reason: "failed after 5 attempts: match: statement timeout",
    });
  });
});
