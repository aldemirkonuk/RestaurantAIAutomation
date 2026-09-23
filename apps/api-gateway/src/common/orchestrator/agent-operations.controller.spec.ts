import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { AxiosError, AxiosResponse } from "axios";
import {
  AgentOperationsController,
  verdictFromAnswer,
  verdictFromError,
} from "./agent-operations.controller";
import {
  HealthProxyController,
  MetricsProxyController,
  publicAgentDetail,
  publicAgentHealth,
} from "./health-proxy.controller";
import { OrchestratorNotConfiguredError } from "./orchestrator.service";
import { PlatformOperatorGuard } from "./platform-operator.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";

const REQUEST_ID = "1ab926ce-dbb2-4e88-9782-f9eab4d97521";

function answered(status: number, data: unknown = {}): AxiosError {
  const response = { status, data, statusText: "", headers: {}, config: {} } as unknown as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_RESPONSE", undefined, undefined, response);
}
const unanswered = (code: string) => new AxiosError("no answer", code);

type Row = Record<string, any>;
function fixture(options: { recordError?: unknown; updateError?: unknown; operate?: jest.Mock; lookup?: jest.Mock; rows?: Row[] } = {}) {
  const insert = jest.fn().mockResolvedValue({ error: options.recordError ?? null });
  const updates: Array<{ values: Row; filters: Array<[string, string, unknown]> }> = [];
  const update = jest.fn((values: Row) => {
    const entry = { values, filters: [] as Array<[string, string, unknown]> };
    updates.push(entry);
    const chain: any = {
      eq: (column: string, value: unknown) => { entry.filters.push(["eq", column, value]); return chain; },
      in: (column: string, value: unknown) => { entry.filters.push(["in", column, value]); return chain; },
      then: (resolve: (v: unknown) => void) => resolve({ error: options.updateError ?? null }),
    };
    return chain;
  });
  const select = jest.fn(() => ({ order: () => ({ limit: async () => ({ data: options.rows ?? [], error: null }) }) }));
  const database = { client: { from: jest.fn().mockReturnValue({ insert, update, select }) } };
  const operateAgent = options.operate ?? jest.fn().mockResolvedValue({ httpStatus: 200, data: { success: true, request_id: REQUEST_ID } });
  const getAgentOperation = options.lookup ?? jest.fn();
  const controller = new AgentOperationsController(database as any, { operateAgent, getAgentOperation } as any);
  return { controller, insert, update, updates, operateAgent, getAgentOperation };
}
const request = { requestId: REQUEST_ID };

describe("agent operation verdicts", () => {
  it.each([
    [answered(409), "failed", "operation_in_progress", 409],
    [answered(404), "failed", "agent_not_running", 404],
    [answered(503), "failed", "orchestrator_not_running", 503],
    [answered(401), "failed", "orchestrator_rejected_credentials", 502],
    [answered(422), "failed", "orchestrator_rejected_request", 502],
    [answered(400), "failed", "orchestrator_rejected_request", 502],
    [new OrchestratorNotConfiguredError(), "failed", "orchestrator_unconfigured", 503],
    [new BadRequestException("Unknown agent operation."), "failed", "invalid_operation", 400],
    [unanswered("ECONNREFUSED"), "failed", "orchestrator_unreachable", 503],
    [unanswered("ENOTFOUND"), "failed", "orchestrator_unreachable", 503],
    [unanswered("ECONNABORTED"), "unknown", "remote_outcome_unknown", 504],
    [unanswered("ECONNRESET"), "unknown", "remote_outcome_unknown", 504],
    [answered(500), "unknown", "remote_outcome_unknown", 504],
    [answered(502), "unknown", "remote_outcome_unknown", 504],
    [new Error("anything else"), "unknown", "remote_outcome_unknown", 504],
  ])("%s => %s/%s (HTTP %s)", (error, status, errorCode, httpStatus) => {
    expect(verdictFromError(error)).toMatchObject({ status, errorCode, httpStatus });
  });

  it("reads the orchestrator's answer, and never trusts one that names another request", () => {
    expect(verdictFromAnswer({ httpStatus: 200, data: { success: true, request_id: REQUEST_ID } }, REQUEST_ID).status).toBe("succeeded");
    expect(verdictFromAnswer({ httpStatus: 200, data: { success: false, request_id: REQUEST_ID } }, REQUEST_ID)).toMatchObject({ status: "failed", errorCode: "agent_operation_failed" });
    expect(verdictFromAnswer({ httpStatus: 202, data: { success: null, state: "running", request_id: REQUEST_ID } }, REQUEST_ID)).toMatchObject({ status: "running", httpStatus: 202, errorCode: null });
    expect(verdictFromAnswer({ httpStatus: 200, data: { success: true, request_id: "another" } }, REQUEST_ID).status).toBe("unknown");
    expect(verdictFromAnswer({ httpStatus: 200, data: { request_id: REQUEST_ID } }, REQUEST_ID).status).toBe("unknown");
  });
});

describe("agent operation receipts", () => {
  it("records actor before dispatch and records the actual success", async () => {
    const f = fixture(); const result = await f.controller.operate("inventory", "restart", request, "operator-id");
    expect(f.insert.mock.invocationCallOrder[0]).toBeLessThan(f.operateAgent.mock.invocationCallOrder[0]);
    expect(f.insert).toHaveBeenCalledWith(expect.objectContaining({ actor_id: "operator-id", status: "requested" }));
    expect(result).toMatchObject({ status: "succeeded", receiptRecorded: true });
    expect(f.updates[0].values).toMatchObject({ status: "succeeded", error_code: null });
  });
  it("refuses an unrecordable request without dispatching", async () => {
    const f = fixture({ recordError: { code: "offline" } });
    await expect(f.controller.operate("inventory", "stop", request, "user")).rejects.toMatchObject({ status: 503 });
    expect(f.operateAgent).not.toHaveBeenCalled();
  });
  it("never replays the same request id", async () => {
    const f = fixture({ recordError: { code: "23505" } });
    await expect(f.controller.operate("inventory", "stop", request, "user")).rejects.toMatchObject({ status: 409 });
    expect(f.operateAgent).not.toHaveBeenCalled();
  });
  it("converts a false success flag into a failure response", async () => {
    const f = fixture({ operate: jest.fn().mockResolvedValue({ httpStatus: 200, data: { success: false, request_id: REQUEST_ID, error: "private content" } }) });
    await expect(f.controller.operate("inventory", "restart", request, "user")).rejects.toMatchObject({ status: 502, response: { status: "failed" } });
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error_code: "agent_operation_failed" }));
  });
  it("records uncertainty after a timeout without claiming failure or retrying", async () => {
    const f = fixture({ operate: jest.fn().mockRejectedValue(unanswered("ECONNABORTED")) });
    await expect(f.controller.operate("inventory", "restart", request, "user")).rejects.toMatchObject({ status: 504, response: { status: "unknown" } });
    expect(f.operateAgent).toHaveBeenCalledTimes(1);
    expect(f.updates[0].values).toMatchObject({ status: "unknown", error_code: "remote_outcome_unknown" });
  });
  it.each([
    [answered(409, { detail: "An operation is already in progress" }), 409, "operation_in_progress"],
    [answered(404, { detail: "Agent not running" }), 404, "agent_not_running"],
    [new OrchestratorNotConfiguredError(), 503, "orchestrator_unconfigured"],
  ])("a definite refusal (%s) is recorded as failed with its own code, not as unknown", async (error, httpStatus, errorCode) => {
    const f = fixture({ operate: jest.fn().mockRejectedValue(error) });
    await expect(f.controller.operate("inventory", "stop", request, "user")).rejects.toMatchObject({ status: httpStatus, response: { status: "failed", errorCode } });
    expect(f.updates[0].values).toMatchObject({ status: "failed", error_code: errorCode });
    expect(f.updates[0].values.completed_at).toEqual(expect.any(String));
    expect(f.operateAgent).toHaveBeenCalledTimes(1);
  });
  it("records a drain that is still running as running, answers 202 and leaves completion open", async () => {
    const f = fixture({ operate: jest.fn().mockResolvedValue({ httpStatus: 202, data: { success: null, state: "running", request_id: REQUEST_ID } }) });
    const res = { status: jest.fn() };
    expect(await f.controller.operate("inventory", "restart", request, "user", res as any)).toMatchObject({ status: "running" });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(f.updates[0].values).toEqual({ status: "running", completed_at: null, error_code: null });
  });
  it("reports a lost final receipt separately from a completed operation", async () => {
    const f = fixture({ updateError: { code: "offline" } });
    expect(await f.controller.operate("inventory", "stop", request, "user")).toMatchObject({ status: "succeeded", receiptRecorded: false });
  });
  it.each([["../inventory", "stop"], ["inventory", "execute"]])("rejects %s/%s before recording", async (name, action) => {
    const f = fixture(); await expect(f.controller.operate(name, action, request, "user")).rejects.toMatchObject({ status: 400 });
    expect(f.insert).not.toHaveBeenCalled();
  });
});

describe("receipt reconciliation", () => {
  const now = new Date().toISOString();
  const row = (status: string, extra: Row = {}) => ({ id: REQUEST_ID, agent_name: "inventory", action: "restart", status, requested_at: now, completed_at: null, error_code: status === "unknown" ? "remote_outcome_unknown" : null, ...extra });

  it("settles an unknown receipt from the orchestrator's record, only while it is still pending", async () => {
    const lookup = jest.fn().mockResolvedValue({ request_id: REQUEST_ID, agent: "inventory", action: "restart", state: "succeeded", finished_at: "2026-09-17T10:00:00+00:00" });
    const f = fixture({ rows: [row("unknown")], lookup });
    const { operations } = await f.controller.recent();
    expect(operations[0]).toMatchObject({ status: "succeeded", error_code: null, completed_at: "2026-09-17T10:00:00+00:00", remote: "settled" });
    expect(f.updates[0].filters).toEqual(expect.arrayContaining([["eq", "id", REQUEST_ID], ["in", "status", ["requested", "running", "unknown"]]]));
  });
  it.each([["requested"], ["unknown"]])(
    "writes a still-running orchestrator record onto a pending %s receipt, not only onto one already running",
    async (status) => {
      const lookup = jest.fn().mockResolvedValue({ request_id: REQUEST_ID, agent: "inventory", action: "restart", state: "running" });
      const f = fixture({ rows: [row(status)], lookup });
      const { operations } = await f.controller.recent();
      expect(operations[0]).toMatchObject({ status: "running", completed_at: null, error_code: null, remote: "running" });
      expect(f.updates[0].values).toEqual({ status: "running", completed_at: null, error_code: null });
      expect(f.updates[0].filters).toEqual(expect.arrayContaining([["eq", "id", REQUEST_ID], ["in", "status", ["requested", "running", "unknown"]]]));
    },
  );
  it("does not ask about a receipt that is already settled", async () => {
    const lookup = jest.fn();
    const f = fixture({ rows: [row("succeeded", { completed_at: now })], lookup });
    expect((await f.controller.recent()).operations[0]).toMatchObject({ status: "succeeded", remote: null });
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([
    [answered(404), "absent"],
    [unanswered("ECONNREFUSED"), "unreadable"],
  ])("leaves the receipt as it is when the orchestrator %s", async (error, remote) => {
    const f = fixture({ rows: [row("requested")], lookup: jest.fn().mockRejectedValue(error) });
    expect((await f.controller.recent()).operations[0]).toMatchObject({ status: "requested", remote });
    expect(f.update).not.toHaveBeenCalled();
  });
  it("refuses a record that names a different agent or action", async () => {
    const lookup = jest.fn().mockResolvedValue({ request_id: REQUEST_ID, agent: "billing", action: "restart", state: "failed" });
    const f = fixture({ rows: [row("unknown")], lookup });
    expect((await f.controller.recent()).operations[0]).toMatchObject({ status: "unknown", remote: "unreadable" });
    expect(f.update).not.toHaveBeenCalled();
  });
  it("does not ask about receipts older than the orchestrator keeps records", async () => {
    const lookup = jest.fn();
    const f = fixture({ rows: [row("requested", { requested_at: "2026-01-01T00:00:00Z" })], lookup });
    expect((await f.controller.recent()).operations[0]).toMatchObject({ status: "requested", remote: "expired" });
    expect(lookup).not.toHaveBeenCalled();
  });
  it("reports a record that could not be saved as unchanged", async () => {
    const lookup = jest.fn().mockResolvedValue({ request_id: REQUEST_ID, agent: "inventory", action: "restart", state: "failed", finished_at: now });
    const f = fixture({ rows: [row("running")], lookup, updateError: { code: "offline" } });
    expect((await f.controller.recent()).operations[0]).toMatchObject({ status: "running", remote: "unchanged" });
  });
});

describe("platform route registry", () => {
  it.each([[AgentOperationsController, "health/agent-operations"], [MetricsProxyController, "metrics"]])("protects %s using current operator identity", (controller, path) => {
    expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe(path);
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([JwtAuthGuard, PlatformOperatorGuard]);
  });
});

describe("shared agent health", () => {
  it("keeps the roster free of free text and house traffic", () => {
    expect(publicAgentHealth({ agent_name: "inventory", status: "idle", healthy: true, capabilities: ["consume_messages", "Robert's order"], metrics: { health: { last_error: "another house" } }, subscriptions: ["private"] }))
      .toEqual({ agent_name: "inventory", status: "idle", healthy: true, version: null, capabilities: ["consume_messages"] });
    expect(publicAgentHealth(null)).toMatchObject({ healthy: null, status: "unknown", capabilities: [] });
  });
  it.each(["initializing", "starting", "active", "idle", "paused", "degraded", "error", "stopping", "stopped"])("names the %s status rather than unknown", (status) => {
    expect(publicAgentHealth({ agent_name: "a", status }).status).toBe(status);
  });
  it("keeps the counters the legacy pages render and drops the error text and activity time", () => {
    const detail = publicAgentDetail({
      agent_name: "inventory", status: "active", healthy: true, version: "2.0.0", capabilities: ["database_read"],
      metrics: {
        messages: { received: 12, processed: 10, failed: 2, skipped: 0, success_rate: "83.33%" },
        timing: { avg_ms: 12.5, min_ms: 1, max_ms: 40, p95_ms: 38 },
        health: { errors: 2, last_error: "Order for Meyhouse table 4 failed", circuit_breaker_trips: 0 },
        activity: { uptime_seconds: 3600, last_activity: "2026-09-17T09:00:00", pause_count: 1, restart_count: 0 },
      },
      config: { max_concurrent_tasks: 10, max_retries: 3, circuit_breaker_enabled: true },
      subscriptions: [["inventory.events", "stock.low"]], queue_size: 0, active_tasks: 1,
      circuit_breaker: { state: "closed", available: true },
    });
    expect(detail.metrics.messages).toEqual({ received: 12, processed: 10, failed: 2, skipped: 0, success_rate: "83.33%" });
    expect(detail.metrics.timing.avg_ms).toBe(12.5);
    expect(detail.metrics.activity).toEqual({ uptime_seconds: 3600, pause_count: 1, restart_count: 0 });
    expect(detail.circuit_breaker).toEqual({ state: "closed", available: true });
    const text = JSON.stringify(detail);
    expect(text).not.toContain("Meyhouse");
    expect(text).not.toContain("last_error");
    expect(text).not.toContain("last_activity");
    expect(text).not.toContain("subscriptions");
  });
  it("reads a missing or malformed number as null, never as 0", () => {
    const detail = publicAgentDetail({ agent_name: "a", metrics: { messages: { processed: "10", success_rate: "most" } } });
    expect(detail.metrics.messages).toEqual({ received: null, processed: null, failed: null, skipped: null, success_rate: null });
    expect(detail.queue_size).toBeNull();
    expect(detail.circuit_breaker).toBeNull();
  });
  it("keeps `healthy` the legacy boolean legacy AdminPanel.tsx reads, while `status` says it was not probed", () => {
    // Legacy AdminPanel.tsx:638,649 paints its dot and badge off `service.healthy`
    // as a boolean; sending `null` there (an earlier pass on this lane did) reads
    // as falsy and paints a correctly configured provider amber. `configured` is
    // the same fact under an honest name for the next desk, which reads `status`
    // text instead and never branches on `healthy`.
    const controller = new HealthProxyController({} as any, { get: () => "configured" } as any, {} as any);
    const providers = controller.getProviderHealth().providers;
    expect(providers.every(provider => provider.healthy === true)).toBe(true);
    expect(providers.every(provider => provider.configured === true)).toBe(true);
    expect(providers.every(provider => /not probed/.test(provider.status))).toBe(true);
  });
  it("reports an unconfigured provider as unhealthy, not as unknown", () => {
    const controller = new HealthProxyController({} as any, { get: () => undefined } as any, {} as any);
    const providers = controller.getProviderHealth().providers;
    expect(providers.every(provider => provider.healthy === false)).toBe(true);
    expect(providers.every(provider => provider.configured === false)).toBe(true);
  });
  it.each([
    [new BadRequestException("Invalid agent name"), 400],
    [answered(404, { detail: "Agent 'x' not found. Running agents: ['inventory']" }), 404],
    [answered(503), 503],
    [unanswered("ECONNREFUSED"), 503],
  ])("a name lookup that fails with %s answers %s", async (error, status) => {
    const controller = new HealthProxyController({ getAgentHealthByName: jest.fn().mockRejectedValue(error) } as any, {} as any, {} as any);
    const failure = await controller.getAgentHealth("x").catch((e: unknown) => e);
    expect(failure).toMatchObject({ status });
    expect(JSON.stringify((failure as any).response)).not.toContain("Running agents");
  });
});
