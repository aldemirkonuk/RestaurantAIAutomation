/**
 * The platform operator boundary (ADR 0143), at the HTTP seam.
 *
 * The app below runs the REAL PlatformOperatorGuard and PlatformOperatorService against
 * an in-memory table store that applies the service's own filters, and a global
 * ValidationPipe with the options main.ts installs. Only JwtAuthGuard is replaced, by a
 * stub that sets the request.user shape JwtStrategy.validate returns from a test header.
 * The orchestrator is a jest double, so the assertion that matters — "was anything
 * dispatched?" — is observable. The server listens on 127.0.0.1 inside this process.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../../database/database.service";
import { AgentOperationsController } from "./agent-operations.controller";
import { HealthProxyController, MetricsProxyController } from "./health-proxy.controller";
import { OrchestratorService } from "./orchestrator.service";
import {
  OwnerOrPlatformOperatorGuard,
  PlatformOperatorGuard,
  PlatformOperatorService,
} from "./platform-operator.service";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OPERATOR = "22222222-2222-4222-8222-222222222222";
const DEVELOPER_ONLY = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;

function freshTables(): Record<string, Row[]> {
  return {
    platform_operator_grants: [
      { user_id: OPERATOR, enabled: true, revoked_at: null },
    ],
    user_roles: [
      { id: "r1", user_id: OPERATOR, role: "developer", revoked_at: null },
      { id: "r2", user_id: DEVELOPER_ONLY, role: "developer", revoked_at: null },
      { id: "r3", user_id: OWNER, role: "owner", revoked_at: null },
    ],
    platform_agent_operations: [],
  };
}

/** A query builder that applies eq/is/in filters and executes when awaited. */
const client = {
  from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let op: { kind: "select" } | { kind: "insert"; row: Row } | { kind: "update"; values: Row } = { kind: "select" };
    let limit: number | null = null;
    const run = () => {
      const rows = tables[table] ?? (tables[table] = []);
      if (op.kind === "insert") {
        const row = op.row;
        if (rows.some((existing) => existing.id === row.id)) return { data: null, error: { code: "23505" } };
        rows.push({ requested_at: new Date().toISOString(), completed_at: null, error_code: null, ...row });
        return { data: null, error: null };
      }
      let matched = rows.filter((row) => filters.every((keep) => keep(row)));
      if (op.kind === "update") {
        const values = op.values;
        matched.forEach((row) => Object.assign(row, values));
        return { data: null, error: null };
      }
      if (limit !== null) matched = matched.slice(0, limit);
      return { data: matched.map((row) => ({ ...row })), error: null };
    };
    const builder: any = {
      select: () => builder,
      insert: (row: Row) => { op = { kind: "insert", row }; return builder; },
      update: (values: Row) => { op = { kind: "update", values }; return builder; },
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
      order: () => builder,
      limit: (n: number) => { limit = n; return builder; },
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  },
};

const orchestrator = {
  operateAgent: jest.fn(),
  getAgentOperation: jest.fn(),
  getAgentHealthAll: jest.fn(),
  getAgentHealthByName: jest.fn(),
  getSystemMetrics: jest.fn(),
};

let app: INestApplication;
let base: string;

async function call(
  method: "GET" | "POST",
  path: string,
  userId: string,
  body?: unknown,
  role = "owner",
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": userId, "x-test-role": role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AgentOperationsController, HealthProxyController, MetricsProxyController],
    providers: [
      PlatformOperatorService,
      PlatformOperatorGuard,
      OwnerOrPlatformOperatorGuard,
      { provide: DatabaseService, useValue: { client, supabase: client } },
      { provide: OrchestratorService, useValue: orchestrator },
      { provide: ConfigService, useValue: { get: () => undefined } },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        // Every caller is an owner of some house and carries cached Studio claims; neither
        // is platform authority.
        req.user = { userId: req.headers["x-test-user"], role: req.headers["x-test-role"], studioRoles: ["developer"] };
        return true;
      },
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  tables = freshTables();
  orchestrator.operateAgent.mockResolvedValue({ httpStatus: 200, data: { success: true, request_id: REQUEST_ID } });
  orchestrator.getSystemMetrics.mockResolvedValue({ agents: {} });
  orchestrator.getAgentHealthAll.mockResolvedValue({ agents: [] });
});

describe("who may read the desk (ADR 0143 §2 / ADR 0149 row 10: owners and operators, not managers or staff)", () => {
  it.each([
    ["an owner", OWNER, "owner"],
    ["an operator who is only staff of this house", OPERATOR, "staff"],
  ])("lets %s read /health/agents", async (_label, user, role) => {
    const res = await call("GET", "/health/agents", user, undefined, role);
    expect(res.status).toBe(200);
  });

  it.each([
    ["a manager", OWNER, "manager"],
    ["a staff member with no platform grant", DEVELOPER_ONLY, "staff"],
  ])("refuses %s a read of /health/agents with 403", async (_label, user, role) => {
    const res = await call("GET", "/health/agents", user, undefined, role);
    expect(res.status).toBe(403);
    expect(orchestrator.getAgentHealthAll).not.toHaveBeenCalled();
  });

  it("refuses a manager a read of /health/providers with 403", async () => {
    const res = await call("GET", "/health/providers", OWNER, undefined, "manager");
    expect(res.status).toBe(403);
  });
});

describe("who may operate a platform agent", () => {
  it.each([
    ["a house owner with no grant", OWNER],
    ["a Studio developer with no SQL grant", DEVELOPER_ONLY],
  ])("refuses %s with 403 and dispatches nothing", async (_label, user) => {
    const res = await call("POST", "/health/agent-operations/inventory/restart", user, { requestId: REQUEST_ID });
    expect(res.status).toBe(403);
    expect(orchestrator.operateAgent).not.toHaveBeenCalled();
    expect(tables.platform_agent_operations).toHaveLength(0);
  });

  it("refuses the receipts and the metrics to an owner", async () => {
    expect((await call("GET", "/health/agent-operations", OWNER)).status).toBe(403);
    expect((await call("GET", "/metrics", OWNER)).status).toBe(403);
    expect(orchestrator.getSystemMetrics).not.toHaveBeenCalled();
  });

  it("lets an operator with both the grant and the role through, with a receipt", async () => {
    const res = await call("POST", "/health/agent-operations/inventory/restart", OPERATOR, { requestId: REQUEST_ID });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "succeeded", receiptRecorded: true });
    expect(orchestrator.operateAgent).toHaveBeenCalledWith("inventory", "restart", REQUEST_ID);
    expect(tables.platform_agent_operations[0]).toMatchObject({ actor_id: OPERATOR, status: "succeeded" });
  });

  it("stops honouring a grant the moment it is revoked", async () => {
    tables.platform_operator_grants[0] = { user_id: OPERATOR, enabled: false, revoked_at: "2026-09-17T00:00:00Z" };
    const res = await call("POST", "/health/agent-operations/inventory/stop", OPERATOR, { requestId: REQUEST_ID });
    expect(res.status).toBe(403);
    expect(orchestrator.operateAgent).not.toHaveBeenCalled();
  });

  it.each([
    ["an 11-character tail", { requestId: "1ab926ce-dbb2-4e88-9782-f9eab4d9752" }],
    ["no request id", {}],
    ["an extra field", { requestId: REQUEST_ID, force: true }],
  ])("answers 400 to an operator's request with %s, before recording or dispatching", async (_label, body) => {
    const res = await call("POST", "/health/agent-operations/inventory/stop", OPERATOR, body);
    expect(res.status).toBe(400);
    expect(orchestrator.operateAgent).not.toHaveBeenCalled();
    expect(tables.platform_agent_operations).toHaveLength(0);
  });

  it("tells an owner and an operator apart on /health/access", async () => {
    expect((await call("GET", "/health/access", OWNER)).body).toEqual({ platformOperator: false });
    expect((await call("GET", "/health/access", OPERATOR)).body).toEqual({ platformOperator: true });
  });
});
