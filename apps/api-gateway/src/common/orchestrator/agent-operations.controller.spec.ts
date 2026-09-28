import "reflect-metadata";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { AgentOperationsController } from "./agent-operations.controller";
import { HealthProxyController, MetricsProxyController, publicAgentHealth } from "./health-proxy.controller";
import { PlatformOperatorGuard } from "./platform-operator.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";

function fixture(options: { recordError?: any; updateError?: any; result?: any; timeout?: boolean } = {}) {
  const insert = jest.fn().mockResolvedValue({ error: options.recordError });
  const terminal = jest.fn().mockResolvedValue({ error: options.updateError });
  const firstEq = jest.fn().mockReturnValue({ eq: terminal });
  const update = jest.fn().mockReturnValue({ eq: firstEq });
  const database = { client: { from: jest.fn().mockReturnValue({ insert, update }) } };
  const operateAgent = options.timeout ? jest.fn().mockRejectedValue(new Error("sensitive remote detail")) : jest.fn().mockResolvedValue(options.result ?? { success: true });
  return { controller: new AgentOperationsController(database as any, { operateAgent } as any), insert, update, operateAgent };
}
const request = { requestId: "1ab926ce-dbb2-4e88-9782-f9eab4d9752" };

describe("agent operation receipts", () => {
  it("records actor before dispatch and records the actual success", async () => {
    const f = fixture(); const result = await f.controller.operate("inventory", "restart", request, "operator-id");
    expect(f.insert.mock.invocationCallOrder[0]).toBeLessThan(f.operateAgent.mock.invocationCallOrder[0]);
    expect(f.insert).toHaveBeenCalledWith(expect.objectContaining({ actor_id: "operator-id", status: "requested" }));
    expect(result).toMatchObject({ status: "succeeded", receiptRecorded: true });
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
    const f = fixture({ result: { success: false, error: "private content" } });
    await expect(f.controller.operate("inventory", "restart", request, "user")).rejects.toMatchObject({ status: 502, response: { status: "failed" } });
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
  it("records uncertainty after a timeout without claiming failure or retrying", async () => {
    const f = fixture({ timeout: true });
    await expect(f.controller.operate("inventory", "restart", request, "user")).rejects.toMatchObject({ status: 504, response: { status: "unknown" } });
    expect(f.operateAgent).toHaveBeenCalledTimes(1);
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

describe("platform route registry", () => {
  it.each([[AgentOperationsController, "health/agent-operations"], [MetricsProxyController, "metrics"]])("protects %s using current operator identity", (controller, path) => {
    expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe(path);
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([JwtAuthGuard, PlatformOperatorGuard]);
  });
  it("keeps house health data-free and reports missing evidence honestly", () => {
    expect(publicAgentHealth({ agent_name: "inventory", status: "idle", healthy: true, metrics: { health: { last_error: "another house" } }, subscriptions: ["private"] }))
      .toEqual({ agent_name: "inventory", status: "idle", healthy: true, version: null });
    expect(publicAgentHealth(null)).toMatchObject({ healthy: null, status: "unknown" });
  });
  it("does not turn configured provider keys into measured health", () => {
    const controller = new HealthProxyController({} as any, { get: () => "configured" } as any, {} as any);
    expect(controller.getProviderHealth().providers.every(provider => provider.healthy === null)).toBe(true);
  });
});
