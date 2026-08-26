/**
 * StudioProxyController (ADR 0021).
 *
 * The behaviours worth pinning are the ones a passthrough gets wrong silently: dropping the
 * caller's identity, and flattening the orchestrator's status codes. redeem_invite's
 * 403/404/409/410 each tell the user something different, and a proxy that turns them all
 * into 500 makes the page unable to explain what happened.
 */
import { HttpException } from "@nestjs/common";
import { StudioProxyController } from "./studio-proxy.controller";
import { OrchestratorService } from "./orchestrator.service";

describe("StudioProxyController", () => {
  let controller: StudioProxyController;
  let proxyStudio: jest.Mock;

  const req = (method: string) => ({ method }) as any;

  beforeEach(() => {
    proxyStudio = jest.fn();
    controller = new StudioProxyController({
      proxyStudio,
    } as unknown as OrchestratorService);
  });

  it("forwards the caller's own Bearer token, not a service credential", async () => {
    proxyStudio.mockResolvedValue({ status: 200, data: { ok: true } });

    await controller.post(
      req("POST"),
      { "0": "invite/redeem" },
      {},
      { token: "tok" },
      "Bearer caller-token",
    );

    expect(proxyStudio).toHaveBeenCalledWith(
      "POST",
      "invite/redeem",
      "Bearer caller-token",
      { token: "tok" },
      {},
    );
  });

  it("relays the wildcard subpath verbatim", async () => {
    proxyStudio.mockResolvedValue({ status: 200, data: {} });

    await controller.patch(
      req("PATCH"),
      { "0": "contributors/user-123/revoke" },
      {},
      {},
      "Bearer t",
    );

    expect(proxyStudio.mock.calls[0][1]).toBe("contributors/user-123/revoke");
  });

  it("passes query params through", async () => {
    proxyStudio.mockResolvedValue({ status: 200, data: {} });

    await controller.get(req("GET"), { "0": "queue" }, { limit: "10" }, "Bearer t");

    expect(proxyStudio.mock.calls[0][4]).toEqual({ limit: "10" });
  });

  it.each([
    [403, "This invite was issued to a different email address."],
    [404, "Invite token not found"],
    [409, "Invite token already used"],
    [410, "Invite token has expired"],
  ])("preserves the orchestrator's %i instead of collapsing it", async (status, detail) => {
    proxyStudio.mockResolvedValue({ status, data: { detail } });

    await expect(
      controller.post(req("POST"), { "0": "invite/redeem" }, {}, {}, "Bearer t"),
    ).rejects.toMatchObject({ status });
  });

  it("relays the orchestrator's response body so the page can explain the failure", async () => {
    proxyStudio.mockResolvedValue({
      status: 403,
      data: { detail: "This invite was issued to a different email address." },
    });

    const err = await controller
      .post(req("POST"), { "0": "invite/redeem" }, {}, {}, "Bearer t")
      .catch((e) => e as HttpException);

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getResponse()).toEqual({
      detail: "This invite was issued to a different email address.",
    });
  });

  it("returns the payload unwrapped on success", async () => {
    proxyStudio.mockResolvedValue({
      status: 200,
      data: { role_granted: "certified_contributor" },
    });

    const result = await controller.post(
      req("POST"),
      { "0": "invite/redeem" },
      {},
      {},
      "Bearer t",
    );

    expect(result).toEqual({ role_granted: "certified_contributor" });
  });

  it("does not send a body on GET or DELETE", async () => {
    proxyStudio.mockResolvedValue({ status: 200, data: {} });

    await controller.get(req("GET"), { "0": "metrics" }, {}, "Bearer t");
    await controller.remove(req("DELETE"), { "0": "sessions/1" }, {}, "Bearer t");

    expect(proxyStudio.mock.calls[0][3]).toBeUndefined();
    expect(proxyStudio.mock.calls[1][3]).toBeUndefined();
  });
});
