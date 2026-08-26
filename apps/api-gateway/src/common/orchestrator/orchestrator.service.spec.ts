/**
 * proxyStudio path validation.
 *
 * The unit test on isSafeStudioSubPath proves the predicate; this proves the service
 * actually consults it — that a rejected path produces a 400 and, critically, that no
 * outbound request is ever issued with the caller's token attached.
 */
import { ConfigService } from "@nestjs/config";
import { OrchestratorService } from "./orchestrator.service";

describe("OrchestratorService.proxyStudio path validation", () => {
  let service: OrchestratorService;
  let request: jest.Mock;

  beforeEach(() => {
    const config = {
      get: (key: string, fallback?: string) =>
        key === "AGENT_ORCHESTRATOR_URL"
          ? "http://orchestrator.internal"
          : (fallback ?? ""),
    } as unknown as ConfigService;

    service = new OrchestratorService(config);
    request = jest.fn().mockResolvedValue({ status: 200, data: { ok: true } });
    // Replace the axios instance created in the constructor.
    (service as any).httpClient = { request };
  });

  it("forwards a legitimate studio path", async () => {
    const result = await service.proxyStudio(
      "POST",
      "invite/redeem",
      "Bearer caller",
      { token: "t" },
      {},
    );

    expect(result.status).toBe(200);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].url).toBe("/api/v1/studio/invite/redeem");
  });

  it("refuses a traversal path with 400 and issues no outbound request", async () => {
    const result = await service.proxyStudio(
      "GET",
      "a/../../../agents/execute",
      "Bearer caller",
      undefined,
      {},
    );

    expect(result.status).toBe(400);
    // The point of the fix: the caller's bearer token never leaves the gateway on a
    // request whose path escaped the /studio/ prefix.
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["../../admin", "//evil.com/x", "..%2f..%2fadmin", "/queue"])(
    "refuses %s",
    async (bad) => {
      const result = await service.proxyStudio(
        "GET",
        bad,
        "Bearer caller",
        undefined,
        {},
      );
      expect(result.status).toBe(400);
      expect(request).not.toHaveBeenCalled();
    },
  );

  describe("getAgentHealthByName", () => {
    let get: jest.Mock;

    beforeEach(() => {
      get = jest.fn().mockResolvedValue({ data: { healthy: true } });
      (service as any).httpClient = { get };
    });

    it("looks up a legitimate agent name", async () => {
      await service.getAgentHealthByName("wine-matcher");
      expect(get.mock.calls[0][0]).toBe("/api/v1/health/agents/wine-matcher");
    });

    it.each([
      // Express decodes route params, so this is what the method actually receives.
      "../../agents/execute",
      "..%2f..%2fagents",
      "..",
      "a/b",
    ])("refuses %s without issuing a request", async (bad) => {
      await expect(service.getAgentHealthByName(bad)).rejects.toThrow(
        "Invalid agent name",
      );
      // The point: X-Admin-Key never leaves the gateway on an escaped path.
      expect(get).not.toHaveBeenCalled();
    });
  });

  it("returns 503 rather than a bad request when the orchestrator URL is unset", async () => {
    const unconfigured = new OrchestratorService({
      get: (_k: string, fallback?: string) => fallback ?? undefined,
    } as unknown as ConfigService);
    const spy = jest.fn();
    (unconfigured as any).httpClient = { request: spy };

    const result = await unconfigured.proxyStudio(
      "GET",
      "queue",
      "Bearer t",
      undefined,
      {},
    );

    expect(result.status).toBe(503);
    expect(spy).not.toHaveBeenCalled();
  });
});
