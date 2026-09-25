import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../../database/database.service";
import { ReportsController } from "../reports.controller";
import { ReportsService } from "../reports.service";
import { ReportsModule } from "../reports.module";
import { ReportCuttingReader } from "./report-cutting-reader.service";
import { ReportExportsController } from "./report-exports.controller";
import { ReportExportsService } from "./report-exports.service";
import { MemorySupabase } from "./__fixtures__/memory-supabase";
import { HOUSE_A, HOUSE_B, MANAGER_A, PAYLOADS } from "./__fixtures__/cutting-payloads";

/**
 * OD-81 — `/reports/exports` over real HTTP: Nest's router, the real
 * `RolesGuard`, the global ValidationPipe as `main.ts` configures it, the real
 * service and a store that applies its filters. Only authentication is
 * replaced — the caller is whoever the `x-test-*` headers say, standing in for
 * the verified token — because what is under test is what the gateway does
 * with a caller, not how it verifies one.
 */

class HeaderUser implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const house = req.headers["x-test-house"];
    if (!house) return false;
    req.user = {
      userId: req.headers["x-test-user"] ?? MANAGER_A,
      restaurantId: house,
      role: req.headers["x-test-role"] ?? "manager",
    };
    return true;
  }
}

describe("ReportExportsController over HTTP (OD-81)", () => {
  let app: INestApplication;
  let base: string;
  let mem: MemorySupabase;
  let exportsService: ReportExportsService;

  beforeAll(async () => {
    mem = new MemorySupabase();
    mem.seed("restaurants", { id: HOUSE_A, name: "Meyhouse", currency: "TRY" });
    mem.seed("restaurants", { id: HOUSE_B, name: "Other", currency: "USD" });
    const payload = async () => PAYLOADS.ledger;

    const moduleRef = await Test.createTestingModule({
      // The module's own controller order, not a re-statement of it.
      controllers: Reflect.getMetadata("controllers", ReportsModule),
      providers: [
        ReportExportsService,
        ReportsService,
        { provide: DatabaseService, useValue: { supabase: mem.supabase } },
        {
          provide: ReportCuttingReader,
          useValue: { read: jest.fn(payload) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderUser)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, "127.0.0.1");
    base = `${await app.getUrl()}`.replace("[::1]", "127.0.0.1");
    exportsService = app.get(ReportExportsService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const call = (
    method: string,
    path: string,
    opts: { house?: string; role?: string; body?: unknown } = {},
  ) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(opts.house === undefined ? { "x-test-house": HOUSE_A } : opts.house ? { "x-test-house": opts.house } : {}),
        ...(opts.role ? { "x-test-role": opts.role } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

  /** Wait for an export's attempt to settle by reading it back. */
  async function settled(id: string) {
    for (let i = 0; i < 50; i++) {
      const row = mem.rows("report_exports").find((r) => r.id === id);
      if (row && row.status !== "queued") return row;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`export ${id} never settled`);
  }

  it("registers the exports controller ahead of GET /reports/:id, which would otherwise swallow /reports/exports", async () => {
    const controllers = Reflect.getMetadata("controllers", ReportsModule);
    expect(controllers.indexOf(ReportExportsController)).toBeLessThan(
      controllers.indexOf(ReportsController),
    );
    const res = await call("GET", "/reports/exports");
    expect(res.status).toBe(200);
    // Checked with Array.isArray: fetch's JSON arrays come from another realm,
    // where `instanceof Array` (what expect.any(Array) uses) is false.
    const list = await res.json();
    expect(Array.isArray(list.exports)).toBe(true);
    expect(typeof list.total).toBe("number");
  });

  it("pages the list with offset, and the total is exact on every page", async () => {
    for (let i = 0; i < 3; i++) {
      const started = await exportsService.requestExport(HOUSE_A, MANAGER_A, {
        cutting: "ledger",
      });
      await started.settled;
    }
    const page1 = await (await call("GET", "/reports/exports?limit=2&offset=0")).json();
    expect(page1.exports).toHaveLength(2);
    expect(page1.total).toBeGreaterThanOrEqual(3);
    const page2 = await (await call("GET", "/reports/exports?limit=2&offset=2")).json();
    expect(page2.total).toBe(page1.total);
    // No id on page 1 reappears on page 2.
    const page1Ids = new Set(page1.exports.map((e: { id: string }) => e.id));
    for (const e of page2.exports) expect(page1Ids.has(e.id)).toBe(false);
  });

  it("queues with 202, writes, and serves the CSV and the print page to its own house", async () => {
    const res = await call("POST", "/reports/exports", { body: { cutting: "ledger" } });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ cutting: "ledger", status: "queued" });
    await settled(body.id);

    const csv = await call("GET", `/reports/exports/${body.id}/download?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toMatch(/^attachment; filename="mudavym-ledger-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(csv.headers.get("cache-control")).toBe("private, no-store");
    expect(await csv.text()).toContain("Cost of goods (365d),withheld,TRY,");

    const html = await call("GET", `/reports/exports/${body.id}/download?format=html`);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await html.text()).toContain("<h1>Figures of record</h1>");
  });

  it("answers 404 to another house for the read, the download and the retry", async () => {
    const started = await exportsService.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    await started.settled;
    const id = started.export.id;
    for (const [method, path] of [
      ["GET", `/reports/exports/${id}`],
      ["GET", `/reports/exports/${id}/download?format=csv`],
      ["GET", `/reports/exports/${id}/download?format=html`],
      ["POST", `/reports/exports/${id}/retry`],
    ] as const) {
      const res = await call(method, path, { house: HOUSE_B });
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
    const list = await (await call("GET", "/reports/exports", { house: HOUSE_B })).json();
    expect(list.exports.find((e: { id: string }) => e.id === id)).toBeUndefined();
  });

  it("is for owners and managers only", async () => {
    for (const role of ["staff", "sommelier", "viewer"]) {
      const res = await call("POST", "/reports/exports", { role, body: { cutting: "ledger" } });
      expect([role, res.status]).toEqual([role, 403]);
      expect([role, (await call("GET", "/reports/exports", { role })).status]).toEqual([role, 403]);
    }
    expect((await call("GET", "/reports/exports", { role: "owner" })).status).toBe(200);
    expect((await call("GET", "/reports/exports", { house: "" })).status).toBe(403);
  });

  it("refuses a body that names a house, an unknown cutting, a bad format and a non-uuid id", async () => {
    expect((await call("POST", "/reports/exports", { body: { cutting: "ledger", restaurantId: HOUSE_B } })).status).toBe(400);
    expect((await call("POST", "/reports/exports", { body: { cutting: "writing" } })).status).toBe(400);
    expect((await call("POST", "/reports/exports", { body: { cutting: "till", days: 0 } })).status).toBe(400);
    const started = await exportsService.requestExport(HOUSE_A, MANAGER_A, { cutting: "ledger" });
    await started.settled;
    expect((await call("GET", `/reports/exports/${started.export.id}/download?format=pdf`)).status).toBe(400);
    expect((await call("GET", "/reports/exports/not-a-uuid")).status).toBe(400);
  });

  it("passes a 409 through as itself: a failed export's download names why, and never 200s", async () => {
    const id = mem.seed("report_exports", {
      restaurant_id: HOUSE_A,
      cutting: "ledger",
      title: "Figures of record",
      window_label: "w",
      status: "failed",
      failure_reason: "Not written: the register timed out",
      finished_at: new Date().toISOString(),
    }).id as string;
    const res = await call("GET", `/reports/exports/${id}/download?format=csv`);
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("This export was not written: Not written: the register timed out");
    const retry = await call("POST", `/reports/exports/${id}/retry`);
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({ id, status: "queued", attempts: 2 });
  });

  it("a store that refuses the list is a 500 with its message, not an empty 200", async () => {
    mem.failNext("report_exports", "select", "permission denied for table report_exports");
    const res = await call("GET", "/reports/exports");
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe("permission denied for table report_exports");
  });

  it("retires POST /reports/generate with 410, naming the real export, and files no phantom row", async () => {
    const before = mem.rows("generated_reports").length;
    const res = await call("POST", "/reports/generate", {
      body: { reportType: "financial_summary", title: "t", periodStart: "2026-09-01", periodEnd: "2026-09-16" },
    });
    expect(res.status).toBe(410);
    expect((await res.json()).message).toContain("POST /reports/exports");
    expect(mem.rows("generated_reports")).toHaveLength(before);
  });
});
