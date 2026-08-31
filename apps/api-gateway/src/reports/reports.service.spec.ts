import { PATH_METADATA } from "@nestjs/common/constants";
import { DatabaseService } from "../database/database.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * OD-45. The Documents page read and deleted `generated_reports` rows straight from
 * the browser. Routing it through this service needed a delete endpoint that did not
 * exist, and needed the response to carry the columns the page actually renders.
 */

type Filter = { column: string; value: unknown };

function makeSupabaseStub(result: { data?: unknown; error?: unknown } = {}) {
  const calls = {
    table: null as string | null,
    operation: null as string | null,
    filters: [] as Filter[],
    order: null as string | null,
  };

  const builder: Record<string, unknown> = {};

  Object.assign(builder, {
    select: jest.fn(() => {
      calls.operation ??= "select";
      return builder;
    }),
    delete: jest.fn(() => {
      calls.operation = "delete";
      return builder;
    }),
    eq: jest.fn((column: string, value: unknown) => {
      calls.filters.push({ column, value });
      return builder;
    }),
    order: jest.fn((column: string) => {
      calls.order = column;
      return builder;
    }),
    single: jest.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  });

  return {
    calls,
    databaseService: {
      supabase: { from: jest.fn((table: string) => ((calls.table = table), builder)) },
    } as unknown as DatabaseService,
  };
}

const ROW = {
  id: "report-1",
  restaurant_id: "restaurant-1",
  report_type: "inventory_summary",
  title: "March inventory",
  status: "completed",
  pdf_url: "https://example.test/r.pdf",
  excel_url: null,
  csv_url: null,
  summary: "Stock held steady.",
  report_period_start: "2026-03-01",
  report_period_end: "2026-03-31",
  created_at: "2026-04-01T00:00:00.000Z",
};

describe("ReportsService — generated_reports (OD-45)", () => {
  describe("deleteReport", () => {
    it("scopes the delete by restaurant as well as id", async () => {
      const { calls, databaseService } = makeSupabaseStub({ error: null });
      const service = new ReportsService(databaseService);

      await service.deleteReport("restaurant-1", "report-1");

      expect(calls.table).toBe("generated_reports");
      expect(calls.operation).toBe("delete");
      // The restaurant comes from the JWT, so a caller cannot delete another
      // tenant's report by guessing a uuid. The client-side delete this replaces
      // filtered on `id` alone.
      expect(calls.filters).toEqual([
        { column: "restaurant_id", value: "restaurant-1" },
        { column: "id", value: "report-1" },
      ]);
    });

    it("propagates a database error instead of reporting success", async () => {
      const { databaseService } = makeSupabaseStub({
        error: { message: "permission denied" },
      });
      const service = new ReportsService(databaseService);

      await expect(service.deleteReport("restaurant-1", "report-1")).rejects.toEqual({
        message: "permission denied",
      });
    });
  });

  describe("listReports", () => {
    it("exposes the columns the Documents page renders", async () => {
      const { databaseService } = makeSupabaseStub({
        data: [ROW],
        error: null,
        count: 1,
      } as never);
      const service = new ReportsService(databaseService);

      const { reports, total } = await service.listReports("restaurant-1");

      expect(total).toBe(1);
      // summary / periodStart / periodEnd replace the invented `metadata.description`
      // and `metadata.period` the browser used to read off a column that never existed.
      expect(reports[0]).toMatchObject({
        id: "report-1",
        title: "March inventory",
        status: "completed",
        summary: "Stock held steady.",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        pdfUrl: "https://example.test/r.pdf",
      });
    });
  });
});

describe("refileReport / getReportCrossFile (Sorting Office)", () => {
  /**
   * These two methods span three tables and one RPC, so they get their own
   * stub: per-table chainable builders plus a captured rpc mock.
   */
  function makeMultiStub(opts: {
    reportRow?: Record<string, unknown>;
    paper?: { data: unknown[]; count: number | null };
    threads?: unknown[];
  }) {
    const reportRow = opts.reportRow ?? ROW;
    const captured = {
      updates: [] as Array<Record<string, unknown>>,
      updateFilters: [] as Filter[],
      audits: [] as Array<Record<string, unknown>>,
      paperTouched: false,
      rpcArgs: [] as Array<Record<string, unknown>>,
    };

    function makeBuilder(table: string) {
      let op = "select";
      let updatePayload: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {};
      const resolve = () => {
        if (table === "procurement_documents") {
          captured.paperTouched = true;
          return {
            data: opts.paper?.data ?? [],
            count: opts.paper?.count ?? 0,
            error: null,
          };
        }
        if (op === "update") {
          return { data: { ...reportRow, ...updatePayload }, error: null };
        }
        return { data: reportRow, error: null };
      };
      Object.assign(builder, {
        select: jest.fn(() => builder),
        update: jest.fn((payload: Record<string, unknown>) => {
          op = "update";
          updatePayload = payload;
          captured.updates.push(payload);
          return builder;
        }),
        insert: jest.fn((payload: Record<string, unknown>) => {
          captured.audits.push(payload);
          return {
            then: (r: (v: unknown) => unknown) =>
              Promise.resolve({ error: null }).then(r),
          };
        }),
        eq: jest.fn((column: string, value: unknown) => {
          if (op === "update") captured.updateFilters.push({ column, value });
          return builder;
        }),
        gte: jest.fn(() => builder),
        lte: jest.fn(() => builder),
        order: jest.fn(() => builder),
        limit: jest.fn(() => builder),
        single: jest.fn(() => Promise.resolve(resolve())),
        then: (r: (v: unknown) => unknown) => Promise.resolve(resolve()).then(r),
      });
      return builder;
    }

    const rpc = jest.fn((_name: string, args: Record<string, unknown>) => {
      captured.rpcArgs.push(args);
      return Promise.resolve({ data: opts.threads ?? [], error: null });
    });

    return {
      captured,
      databaseService: {
        supabase: { from: jest.fn((table: string) => makeBuilder(table)), rpc },
      } as unknown as DatabaseService,
    };
  }

  it("refiles scoped by restaurant + id and writes the audit row the timeline reads", async () => {
    const { captured, databaseService } = makeMultiStub({});
    const service = new ReportsService(databaseService);

    const result = await service.refileReport(
      "restaurant-1",
      "report-1",
      "procurement_history" as never,
      "user-9",
    );

    expect(captured.updates).toEqual([{ report_type: "procurement_history" }]);
    expect(captured.updateFilters).toEqual([
      { column: "restaurant_id", value: "restaurant-1" },
      { column: "id", value: "report-1" },
    ]);
    // The re-file files itself: a system_audit_log row carrying from → to,
    // which the /logs timeline (and the page's System-log drawer) renders.
    expect(captured.audits).toHaveLength(1);
    expect(captured.audits[0]).toMatchObject({
      action: "report_refiled",
      entity_type: "generated_report",
      entity_id: "report-1",
      restaurant_id: "restaurant-1",
      actor_id: "user-9",
      changes: {
        report_type: { from: "inventory_summary", to: "procurement_history" },
      },
    });
    expect(result.reportType).toBe("procurement_history");
  });

  it("cross-files a period report from real counts, date-bounded", async () => {
    const { captured, databaseService } = makeMultiStub({
      paper: { data: [{ doc_number: "INV-88" }], count: 12 },
      threads: [{ total_threads: "2" }], // bigint arrives as a string
    });
    const service = new ReportsService(databaseService);

    const result = await service.getReportCrossFile("restaurant-1", "report-1");

    expect(result).toEqual({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      paper: { count: 12, sample: "INV-88" },
      conversations: { count: 2 },
    });
    expect(captured.rpcArgs[0]).toMatchObject({
      p_restaurant_id: "restaurant-1",
      p_date_from: "2026-03-01",
      p_date_to: "2026-03-31",
    });
  });

  it("a report with no period cross-files to nothing — and asks no register", async () => {
    const { captured, databaseService } = makeMultiStub({
      reportRow: { ...ROW, report_period_start: null, report_period_end: null },
    });
    const service = new ReportsService(databaseService);

    const result = await service.getReportCrossFile("restaurant-1", "report-1");

    expect(result).toEqual({
      periodStart: null,
      periodEnd: null,
      paper: null,
      conversations: null,
    });
    expect(captured.paperTouched).toBe(false);
    expect(captured.rpcArgs).toHaveLength(0);
  });
});

describe("ReportsController routing", () => {
  const pathOf = (method: string) =>
    Reflect.getMetadata(PATH_METADATA, ReportsController.prototype[method]);

  const methodOrder = Object.getOwnPropertyNames(ReportsController.prototype).filter(
    (name) => name !== "constructor",
  );

  it("declares GET /reports/schedules before the GET /reports/:id wildcard", () => {
    // Nest registers handlers in declaration order. With `:id` first, a request for
    // /reports/schedules was answered by getReport() with reportId = "schedules".
    expect(pathOf("listSchedules")).toBe("schedules");
    expect(pathOf("getReport")).toBe(":id");
    expect(methodOrder.indexOf("listSchedules")).toBeLessThan(
      methodOrder.indexOf("getReport"),
    );
  });

  it("declares DELETE /reports/schedules/:id before DELETE /reports/:id", () => {
    expect(pathOf("deleteSchedule")).toBe("schedules/:id");
    expect(pathOf("deleteReport")).toBe(":id");
    expect(methodOrder.indexOf("deleteSchedule")).toBeLessThan(
      methodOrder.indexOf("deleteReport"),
    );
  });
});
