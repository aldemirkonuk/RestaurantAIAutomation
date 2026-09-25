import { readFileSync } from "fs";
import { join } from "path";
import { HttpException } from "@nestjs/common";
import type { DatabaseService } from "../../database/database.service";
import { ReportCuttingReader } from "./report-cutting-reader.service";
import {
  EXPORT_RETENTION_DAYS,
  MAX_EXPORTS_PER_HOUSE,
  MAX_IN_FLIGHT,
  ReportExportsService,
  STALE_QUEUED_MS,
} from "./report-exports.service";
import { MemorySupabase } from "./__fixtures__/memory-supabase";
import { HOUSE_A, HOUSE_B, MANAGER_A, PAYLOADS } from "./__fixtures__/cutting-payloads";

/**
 * OD-81 — the export lifecycle, through the REAL service and the REAL reader.
 *
 * What is doubled is only what sits under the reader: the analytics services
 * (their own specs cover their arithmetic) and the database, which is an
 * in-memory store that applies every filter and enforces the migration's
 * CHECKs (`__fixtures__/memory-supabase.ts`). A missing tenant scope therefore
 * returns the other house's row here exactly as it would in production, and a
 * `ready` row without its files is refused here exactly as Postgres refuses it.
 */

const MIGRATION = join(
  __dirname,
  "../../../../../supabase/migrations/20260917010200_a_report_export_is_written_or_says_why_not.sql",
);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function build() {
  const mem = new MemorySupabase();
  mem.seed("restaurants", { id: HOUSE_A, name: "Meyhouse", currency: "TRY" });
  mem.seed("restaurants", { id: HOUSE_B, name: "Vanilla Kaleiçi", currency: null });

  const analytics = {
    getFinancialSummary: jest.fn(async () => PAYLOADS.ledger),
    getDemandForecast: jest.fn(async () => PAYLOADS.ahead),
    getInventoryScience: jest.fn(async () => PAYLOADS.restock),
  };
  const advanced = {
    getOverview: jest.fn(async () => PAYLOADS.bench),
    getCashflow: jest.fn(async () => PAYLOADS.pacing),
    getSeasonality: jest.fn(async () => PAYLOADS.week),
    getMenuEngineering: jest.fn(async () => PAYLOADS.quadrants),
  };
  const goals = {
    getPosRevenueWindow: jest.fn(async () => PAYLOADS.till),
    listGoalsWithProgress: jest.fn(async () => PAYLOADS.goals),
  };
  const tables = {
    getTablePerformance: jest.fn(async () => PAYLOADS.seats),
    getWaiterPerformance: jest.fn(async () => PAYLOADS.service),
  };
  const insights = {
    getStored: jest.fn(async () => (PAYLOADS.reading as { insights: unknown[] }).insights),
    generate: jest.fn(async () => ({ source: "live", insights: [] })),
  };
  const reader = new ReportCuttingReader(
    analytics as never,
    advanced as never,
    goals as never,
    tables as never,
    insights as never,
  );
  const service = new ReportExportsService(
    { supabase: mem.supabase } as unknown as DatabaseService,
    reader,
  );
  return { mem, service, analytics, advanced, goals, tables, insights };
}

const exportsOf = (mem: MemorySupabase) => mem.rows("report_exports");

async function statusOf(p: Promise<unknown>): Promise<number | string> {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : `threw ${(e as Error).message}`;
  }
}

describe("ReportExportsService — a report export is written, or says why not (OD-81)", () => {
  it("records the request as queued before it reads anything, then settles ready with both files", async () => {
    const { mem, service, analytics } = build();
    const read = deferred<unknown>();
    analytics.getFinancialSummary.mockImplementationOnce(() => read.promise as never);

    const started = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    expect(started.export).toMatchObject({
      cutting: "ledger",
      title: "Figures of record",
      windowLabel: "365 days of COGS; the cellar as it stands today",
      status: "queued",
      failureReason: null,
      attempts: 1,
      finishedAt: null,
    });
    expect(exportsOf(mem)).toHaveLength(1);
    expect(exportsOf(mem)[0]).toMatchObject({ status: "queued", csv: null, html: null, requested_by: MANAGER_A });

    read.resolve(PAYLOADS.ledger);
    await started.settled;

    const row = exportsOf(mem)[0];
    expect(row.status).toBe("ready");
    expect(row.failure_reason).toBeNull();
    expect(typeof row.csv).toBe("string");
    expect(typeof row.html).toBe("string");
    expect(row.csv_bytes).toBe(Buffer.byteLength(row.csv as string, "utf8"));
    expect(row.html_bytes).toBe(Buffer.byteLength(row.html as string, "utf8"));
    expect(row.withheld_count).toBe(8);
    expect(row.finished_at).not.toBeNull();
    expect(analytics.getFinancialSummary).toHaveBeenCalledWith(HOUSE_A, 0);
  });

  it("writes the engine's nulls as withheld in both files, and the house's own currency", async () => {
    const { mem, service } = build();
    await (await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" })).settled;
    const { csv, html } = exportsOf(mem)[0] as { csv: string; html: string };

    const cogs = csv.split("\r\n").find((l) => l.startsWith("Cost of goods (365d),"));
    expect(cogs).toBe(
      "Cost of goods (365d),withheld,TRY,No delivered order came back for the window — which is either no buying or a read that failed",
    );
    expect(csv).not.toMatch(/^Cost of goods \(365d\),0,/m);
    expect(csv).toContain("House,Meyhouse");
    expect(html).toContain(`<dt>Cost of goods (365d)</dt><dd><span class="withheld">withheld</span>`);
    expect(html).toContain("8 figures marked &quot;withheld&quot; are one the engine could not compute");
  });

  it("a house with no stated currency gets no invented one", async () => {
    const { mem, service } = build();
    await (await service.requestExport(HOUSE_B, null, { cutting: "ledger" })).settled;
    const { csv } = exportsOf(mem)[0] as { csv: string };
    expect(csv).toContain("currency not recorded for this house");
    expect(csv).not.toMatch(/\bTRY\b|\bUSD\b/);
  });

  it("a register that does not answer fails the export with the reason, and writes no file", async () => {
    const { mem, service, analytics } = build();
    analytics.getFinancialSummary.mockRejectedValueOnce(new Error('relation "procurement_orders" does not exist'));

    await (await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" })).settled;

    expect(exportsOf(mem)[0]).toMatchObject({
      status: "failed",
      csv: null,
      html: null,
      withheld_count: null,
      failure_reason:
        'Not written: the Figures of record register could not be read: relation "procurement_orders" does not exist',
    });
  });

  it("retries a failed export on the SAME row, counts the attempt, and settles it ready", async () => {
    const { mem, service, analytics } = build();
    analytics.getFinancialSummary.mockRejectedValueOnce(new Error("timeout"));
    const first = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    await first.settled;
    const id = first.export.id;

    const again = await service.retryExport(HOUSE_A, id);
    expect(again.export).toMatchObject({ id, status: "queued", attempts: 2, failureReason: null, finishedAt: null });
    await again.settled;

    expect(exportsOf(mem)).toHaveLength(1);
    expect(exportsOf(mem)[0]).toMatchObject({ id, status: "ready", attempts: 2, failure_reason: null });
    // Nothing to retry once it is written, or while it is being written.
    expect(await statusOf(service.retryExport(HOUSE_A, id))).toBe(409);
  });

  it("refuses to retry an export that is still being written", async () => {
    const { service, analytics } = build();
    analytics.getFinancialSummary.mockImplementationOnce(() => new Promise(() => {}) as never);
    const started = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    expect(await statusOf(service.retryExport(HOUSE_A, started.export.id))).toBe(409);
  });

  it("a foreign house's export is not found — on read, download and retry — and is left untouched", async () => {
    const { mem, service, analytics } = build();
    analytics.getFinancialSummary.mockRejectedValueOnce(new Error("timeout"));
    const failed = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    await failed.settled;
    const ready = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    await ready.settled;
    const before = JSON.stringify(exportsOf(mem));

    expect(await statusOf(service.getExport(HOUSE_B, ready.export.id))).toBe(404);
    expect(await statusOf(service.downloadExport(HOUSE_B, ready.export.id, "csv"))).toBe(404);
    expect(await statusOf(service.downloadExport(HOUSE_B, ready.export.id, "html"))).toBe(404);
    expect(await statusOf(service.retryExport(HOUSE_B, failed.export.id))).toBe(404);
    expect((await service.listExports(HOUSE_B)).exports).toEqual([]);
    expect((await service.listExports(HOUSE_B)).total).toBe(0);

    expect(JSON.stringify(exportsOf(mem))).toBe(before);
    // And the owner still reads both.
    expect((await service.listExports(HOUSE_A)).total).toBe(2);
  });

  it("downloads only a written export: 409 while queued, 409 with the reason when failed, the file when ready", async () => {
    const { service, analytics } = build();
    const hold = deferred<unknown>();
    analytics.getFinancialSummary
      .mockImplementationOnce(() => hold.promise as never)
      .mockRejectedValueOnce(new Error("timeout"));

    const queued = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    const failed = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    await failed.settled;

    expect(await statusOf(service.downloadExport(HOUSE_A, queued.export.id, "csv"))).toBe(409);
    await expect(service.downloadExport(HOUSE_A, failed.export.id, "csv")).rejects.toThrow(
      "This export was not written: Not written: the Figures of record register could not be read: timeout",
    );

    hold.resolve(PAYLOADS.ledger);
    await queued.settled;
    const csv = await service.downloadExport(HOUSE_A, queued.export.id, "csv");
    expect(csv.contentType).toBe("text/csv; charset=utf-8");
    expect(csv.filename).toMatch(/^mudavym-ledger-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.body.startsWith("\uFEFFMudavym report export\r\n")).toBe(true);
    const html = await service.downloadExport(HOUSE_A, queued.export.id, "html");
    expect(html.contentType).toBe("text/html; charset=utf-8");
    expect(html.body.startsWith("<!doctype html>")).toBe(true);
  });

  it("fails a queued attempt that outlived the stale limit, with the reason, on the next read of that house", async () => {
    const { mem, service } = build();
    const old = new Date(Date.now() - STALE_QUEUED_MS - 60_000).toISOString();
    mem.seed("report_exports", { restaurant_id: HOUSE_A, cutting: "ledger", title: "Figures of record", window_label: "w", started_at: old, requested_at: old });
    mem.seed("report_exports", { restaurant_id: HOUSE_B, cutting: "ledger", title: "Figures of record", window_label: "w", started_at: old, requested_at: old });
    const fresh = mem.seed("report_exports", { restaurant_id: HOUSE_A, cutting: "till", window_days: 30, title: "Through the till", window_label: "w" });

    const list = await service.listExports(HOUSE_A);

    const stale = list.exports.find((e) => e.cutting === "ledger")!;
    expect(stale.status).toBe("failed");
    expect(stale.failureReason).toMatch(/^Abandoned: the export did not finish within 10 minutes/);
    expect(stale.finishedAt).not.toBeNull();
    expect(list.exports.find((e) => e.id === fresh.id)!.status).toBe("queued");
    // Another house's stale row is that house's read to correct.
    expect(exportsOf(mem).find((r) => r.restaurant_id === HOUSE_B)!.status).toBe("queued");
  });

  it("a render that finishes after the sweep failed its attempt does not flip it to ready", async () => {
    const { mem, service, analytics } = build();
    const late = deferred<unknown>();
    analytics.getFinancialSummary.mockImplementationOnce(() => late.promise as never);
    const started = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });

    exportsOf(mem)[0].started_at = new Date(Date.now() - STALE_QUEUED_MS - 1).toISOString();
    await service.listExports(HOUSE_A);
    expect(exportsOf(mem)[0].status).toBe("failed");

    late.resolve(PAYLOADS.ledger);
    await started.settled;
    expect(exportsOf(mem)[0]).toMatchObject({ status: "failed", csv: null, html: null });
    expect(exportsOf(mem)[0].failure_reason).toMatch(/^Abandoned:/);
  });

  it("a render from a superseded attempt cannot overwrite the retry", async () => {
    const { mem, service, analytics } = build();
    const first = deferred<unknown>();
    analytics.getFinancialSummary.mockImplementationOnce(() => first.promise as never);
    const started = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    exportsOf(mem)[0].started_at = new Date(Date.now() - STALE_QUEUED_MS - 1).toISOString();
    const retried = await service.retryExport(HOUSE_A, started.export.id);
    await retried.settled;
    expect(exportsOf(mem)[0]).toMatchObject({ status: "ready", attempts: 2 });

    // The first attempt's read now fails; its failure must not land on attempt 2.
    first.reject(new Error("late failure"));
    await started.settled;
    expect(exportsOf(mem)[0]).toMatchObject({ status: "ready", attempts: 2, failure_reason: null });
  });

  it("a superseded attempt's failure cannot land on a retry that is still being written", async () => {
    // The case the status='queued' guard alone does not cover: attempt 2 is
    // queued too, so only the attempts guard tells the two apart. Without it,
    // attempt 1's failure would fail attempt 2's row, and attempt 2's ready
    // write would then match nothing.
    const { mem, service, analytics } = build();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    analytics.getFinancialSummary
      .mockImplementationOnce(() => first.promise as never)
      .mockImplementationOnce(() => second.promise as never);

    const started = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    exportsOf(mem)[0].started_at = new Date(Date.now() - STALE_QUEUED_MS - 1).toISOString();
    const retried = await service.retryExport(HOUSE_A, started.export.id);
    expect(exportsOf(mem)[0]).toMatchObject({ status: "queued", attempts: 2 });

    first.reject(new Error("late failure"));
    await started.settled;
    expect(exportsOf(mem)[0]).toMatchObject({ status: "queued", attempts: 2, failure_reason: null, finished_at: null });

    second.resolve(PAYLOADS.ledger);
    await retried.settled;
    expect(exportsOf(mem)[0]).toMatchObject({ status: "ready", attempts: 2, failure_reason: null });
  });

  it("a superseded attempt's render cannot store its files on a retry that is still being written", async () => {
    const { mem, service, analytics } = build();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    analytics.getFinancialSummary
      .mockImplementationOnce(() => first.promise as never)
      .mockImplementationOnce(() => second.promise as never);

    const started = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    exportsOf(mem)[0].started_at = new Date(Date.now() - STALE_QUEUED_MS - 1).toISOString();
    const retried = await service.retryExport(HOUSE_A, started.export.id);

    first.resolve(PAYLOADS.ledger);
    await started.settled;
    expect(exportsOf(mem)[0]).toMatchObject({ status: "queued", attempts: 2, csv: null, html: null });

    second.reject(new Error("timeout"));
    await retried.settled;
    expect(exportsOf(mem)[0]).toMatchObject({
      status: "failed",
      attempts: 2,
      csv: null,
      failure_reason: "Not written: the Figures of record register could not be read: timeout",
    });
  });

  it("a ready write the store refuses fails the export in words rather than leaving it queued", async () => {
    const { mem, service, analytics } = build();
    const read = deferred<unknown>();
    analytics.getFinancialSummary.mockImplementationOnce(() => read.promise as never);
    const started = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    mem.failNext("report_exports", "update", "could not extend file: No space left on device");
    read.resolve(PAYLOADS.ledger);
    await started.settled;
    expect(exportsOf(mem)[0]).toMatchObject({
      status: "failed",
      csv: null,
      failure_reason:
        "Not stored: the files were written but saving them failed: could not extend file: No space left on device",
    });
  });

  it("refuses a fourth export in flight for the same house, and counts no other house's", async () => {
    const { mem, service } = build();
    for (let i = 0; i < MAX_IN_FLIGHT; i++)
      mem.seed("report_exports", { restaurant_id: HOUSE_A, cutting: "ledger", title: "t", window_label: "w" });
    for (let i = 0; i < MAX_IN_FLIGHT; i++)
      mem.seed("report_exports", { restaurant_id: HOUSE_B, cutting: "ledger", title: "t", window_label: "w" });

    expect(await statusOf(service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" }))).toBe(429);
    expect(exportsOf(mem).filter((r) => r.restaurant_id === HOUSE_A)).toHaveLength(MAX_IN_FLIGHT);
  });

  it("holds a retry to the same cap: a failed export is not put back in flight past it", async () => {
    const { mem, service } = build();
    const failed = mem.seed("report_exports", {
      restaurant_id: HOUSE_A,
      cutting: "ledger",
      title: "t",
      window_label: "w",
      status: "failed",
      failure_reason: "Not written: timeout",
      finished_at: new Date().toISOString(),
    });
    for (let i = 0; i < MAX_IN_FLIGHT; i++)
      mem.seed("report_exports", { restaurant_id: HOUSE_A, cutting: "ledger", title: "t", window_label: "w" });

    expect(await statusOf(service.retryExport(HOUSE_A, failed.id as string))).toBe(429);
    expect(exportsOf(mem).find((r) => r.id === failed.id)).toMatchObject({ status: "failed", attempts: 1 });
    expect(exportsOf(mem).filter((r) => r.status === "queued")).toHaveLength(MAX_IN_FLIGHT);
  });

  it("a failed count of the exports in flight is an error, not a started export", async () => {
    const { mem, service } = build();
    mem.failNext("report_exports", "select", "connection reset");
    await expect(service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" })).rejects.toMatchObject({
      message: "connection reset",
    });
    expect(exportsOf(mem)).toHaveLength(0);
  });

  it("refuses the writing desk, an invented cutting, and a window on a cutting whose window the server fixes", async () => {
    const { mem, service } = build();
    expect(await statusOf(service.requestExport(HOUSE_A, MANAGER_A, { cutting: "writing" }))).toBe(400);
    expect(await statusOf(service.requestExport(HOUSE_A, MANAGER_A, { cutting: "revenue_by_moon" }))).toBe(400);
    expect(await statusOf(service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger", days: 7 }))).toBe(400);
    expect(await statusOf(service.requestExport(HOUSE_A, MANAGER_A, { cutting: "till", days: 366 }))).toBe(400);
    expect(await statusOf(service.requestExport(HOUSE_A, MANAGER_A, { cutting: "till", days: 7.5 }))).toBe(400);
    expect(exportsOf(mem)).toHaveLength(0);
  });

  it("reads the till over the window the reader chose, and labels the export with it", async () => {
    const { service, goals } = build();
    const seven = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "till", days: 7 });
    await seven.settled;
    expect(seven.export).toMatchObject({ windowDays: 7, windowLabel: "the last 7 days of POS checks" });
    expect(goals.getPosRevenueWindow).toHaveBeenLastCalledWith(HOUSE_A, 7);

    const dflt = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "till" });
    await dflt.settled;
    expect(dflt.export.windowDays).toBe(30);
    expect(goals.getPosRevenueWindow).toHaveBeenLastCalledWith(HOUSE_A, 30);
  });

  it("lists newest first, bounded, with the exact total — and never carries the files", async () => {
    const { mem, service } = build();
    for (let i = 0; i < 5; i++)
      mem.seed("report_exports", {
        restaurant_id: HOUSE_A,
        cutting: "ledger",
        title: `t${i}`,
        window_label: "w",
        status: "ready",
        csv: "a",
        html: "b",
        finished_at: new Date().toISOString(),
        requested_at: `2026-09-1${i}T00:00:00.000Z`,
      });
    const from = mem.statements.length;
    const list = await service.listExports(HOUSE_A, { limit: 2 });
    expect(list.total).toBe(5);
    expect(list.exports.map((e) => e.title)).toEqual(["t4", "t3"]);
    for (const e of list.exports) {
      expect(e).not.toHaveProperty("csv");
      expect(e).not.toHaveProperty("html");
    }
    // The DTO dropping the bodies is not enough: the page polls this list every
    // 2.5 s while anything is queued, and a SELECT that names csv/html pulls up
    // to 100 × 10 MB per poll before toDto throws it away. Assert what the
    // statement ASKED FOR — and the same of a single read.
    await service.getExport(HOUSE_A, list.exports[0].id);
    const reads = mem.statements
      .slice(from)
      .filter((s) => s.table === "report_exports" && s.op === "select");
    expect(reads).toHaveLength(2);
    for (const s of reads) {
      expect(s.columns).toBeDefined();
      const cols = (s.columns as string).split(",").map((c) => c.trim());
      expect(cols).not.toContain("*");
      expect(cols).not.toContain("csv");
      expect(cols).not.toContain("html");
    }
  });

  it("pages past the newest batch with offset — the total stays exact on every page", async () => {
    const { mem, service } = build();
    for (let i = 0; i < 5; i++)
      mem.seed("report_exports", {
        restaurant_id: HOUSE_A,
        cutting: "ledger",
        title: `t${i}`,
        window_label: "w",
        status: "ready",
        csv: "a",
        html: "b",
        finished_at: new Date().toISOString(),
        requested_at: `2026-09-1${i}T00:00:00.000Z`,
      });
    const page2 = await service.listExports(HOUSE_A, { limit: 2, offset: 2 });
    expect(page2.total).toBe(5);
    expect(page2.exports.map((e) => e.title)).toEqual(["t2", "t1"]);
    const lastPage = await service.listExports(HOUSE_A, { limit: 2, offset: 4 });
    expect(lastPage.total).toBe(5);
    expect(lastPage.exports.map((e) => e.title)).toEqual(["t0"]);
  });

  it(`trims a house to its cap of ${MAX_EXPORTS_PER_HOUSE} after a write, oldest first, and never touches another house's`, async () => {
    const { mem, service } = build();
    for (let i = 0; i < MAX_EXPORTS_PER_HOUSE; i++)
      mem.seed("report_exports", {
        restaurant_id: HOUSE_A,
        cutting: "ledger",
        title: `existing${i}`,
        window_label: "w",
        status: "ready",
        csv: "a",
        html: "b",
        finished_at: new Date().toISOString(),
        requested_at: new Date(2026, 8, 1, 0, i).toISOString(),
      });
    const other = mem.seed("report_exports", {
      restaurant_id: HOUSE_B,
      cutting: "ledger",
      title: "another house's export",
      window_label: "w",
      status: "ready",
      csv: "a",
      html: "b",
      finished_at: new Date().toISOString(),
      requested_at: "2020-01-01T00:00:00.000Z",
    });

    const started = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    await started.settled;

    const houseA = exportsOf(mem).filter((r) => r.restaurant_id === HOUSE_A);
    expect(houseA).toHaveLength(MAX_EXPORTS_PER_HOUSE);
    // Exactly one row went over the cap of 50 already at 50: the single
    // oldest is gone; the new request and every other pre-existing row stay.
    expect(houseA.some((r) => r.title === "existing0")).toBe(false);
    expect(houseA.some((r) => r.id === started.export.id)).toBe(true);
    expect(houseA.some((r) => r.title === `existing${MAX_EXPORTS_PER_HOUSE - 1}`)).toBe(true);
    // House B's export is a different house's row; the trim never reads it.
    expect(exportsOf(mem).find((r) => r.id === other.id)).toBeDefined();
  });

  it("a house well under its cap is left alone by a write — nothing to trim", async () => {
    const { mem, service } = build();
    mem.seed("report_exports", {
      restaurant_id: HOUSE_A,
      cutting: "ledger",
      title: "only one so far",
      window_label: "w",
      status: "ready",
      csv: "a",
      html: "b",
      finished_at: new Date().toISOString(),
      requested_at: "2026-09-01T00:00:00.000Z",
    });
    const started = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    await started.settled;
    expect(exportsOf(mem).filter((r) => r.restaurant_id === HOUSE_A)).toHaveLength(2);
  });

  it(`sweepExpired deletes an export past ${EXPORT_RETENTION_DAYS} days, for every house, and leaves the rest`, async () => {
    const { mem, service } = build();
    const old = new Date(Date.now() - (EXPORT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const withinWindow = new Date(
      Date.now() - (EXPORT_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const oldA = mem.seed("report_exports", {
      restaurant_id: HOUSE_A,
      cutting: "ledger",
      title: "old, house A",
      window_label: "w",
      status: "ready",
      csv: "a",
      html: "b",
      finished_at: old,
      requested_at: old,
    });
    const oldB = mem.seed("report_exports", {
      restaurant_id: HOUSE_B,
      cutting: "ledger",
      title: "old, house B",
      window_label: "w",
      status: "ready",
      csv: "a",
      html: "b",
      finished_at: old,
      requested_at: old,
    });
    const recent = mem.seed("report_exports", {
      restaurant_id: HOUSE_A,
      cutting: "ledger",
      title: "still within the window",
      window_label: "w",
      status: "ready",
      csv: "a",
      html: "b",
      finished_at: withinWindow,
      requested_at: withinWindow,
    });

    const result = await service.sweepExpired();
    expect(result.deleted).toBe(2);
    const remainingIds = exportsOf(mem).map((r) => r.id);
    expect(remainingIds).toEqual([recent.id]);
    expect(remainingIds).not.toContain(oldA.id);
    expect(remainingIds).not.toContain(oldB.id);
  });

  it("sweepExpired is idempotent — a second run finds nothing left to delete, and does not error", async () => {
    const { service } = build();
    expect((await service.sweepExpired()).deleted).toBe(0);
    expect((await service.sweepExpired()).deleted).toBe(0);
  });

  it("a failed list read throws rather than answering an empty list", async () => {
    const { mem, service } = build();
    // The sweep's update first, then the list select.
    mem.failNext("report_exports", "select", "permission denied for table report_exports");
    await expect(service.listExports(HOUSE_A)).rejects.toMatchObject({
      message: "permission denied for table report_exports",
    });
  });

  it("writes the request to the audit log the /logs timeline reads", async () => {
    const { mem, service } = build();
    const started = await service.requestExport(HOUSE_A, MANAGER_A, { cutting: "till", days: 90 });
    await started.settled;
    expect(mem.rows("system_audit_log")).toEqual([
      expect.objectContaining({
        actor_type: "user",
        actor_id: MANAGER_A,
        action: "report_export_requested",
        entity_type: "report_export",
        entity_id: started.export.id,
        restaurant_id: HOUSE_A,
        changes: { cutting: "till", window_days: 90 },
      }),
    ]);
  });

  it("the in-memory store enforces the migration's own lifecycle CHECKs, word for word", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("check ((status = 'ready') = (csv is not null and html is not null))");
    expect(sql).toContain("check ((status = 'failed') = (failure_reason is not null))");
    expect(sql).toContain("check ((status = 'queued') = (finished_at is null))");
    expect(sql).toContain("check (status in ('queued', 'ready', 'failed'))");
    expect(sql).toContain("check (cutting ~ '^[a-z_]{1,40}$')");
    expect(sql).toContain("references public.users(user_id)");

    const mem = new MemorySupabase();
    mem.seed("restaurants", { id: HOUSE_A });
    const refused = async (row: Record<string, unknown>) =>
      (await mem.supabase.from("report_exports").insert({ restaurant_id: HOUSE_A, cutting: "ledger", title: "t", window_label: "w", ...row })).error?.message ?? "accepted";
    return Promise.all([
      refused({ status: "ready", finished_at: "x", csv: "a" }),
      refused({ status: "failed", finished_at: "x" }),
      refused({ status: "ready", csv: "a", html: "b" }),
      refused({ status: "queued" }),
    ]).then((r) =>
      expect(r).toEqual([
        expect.stringContaining("report_exports_ready_has_both_files"),
        expect.stringContaining("report_exports_failed_says_why"),
        expect.stringContaining("report_exports_settled_has_finished"),
        "accepted",
      ]),
    );
  });
});
