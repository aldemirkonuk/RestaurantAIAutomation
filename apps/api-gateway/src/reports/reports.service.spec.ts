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
