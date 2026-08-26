/**
 * StudioInviteController (ADR 0021) — the gateway sends the invite rather than handing
 * the admin a link to forward.
 */
import { StudioInviteController } from "./studio-invite.controller";
import { StudioProxyController } from "./studio-proxy.controller";
import { OrchestratorService } from "./orchestrator.service";
import { GmailService } from "../../communications/gmail.service";
import { ConfigService } from "@nestjs/config";

describe("StudioInviteController", () => {
  let controller: StudioInviteController;
  let proxyStudio: jest.Mock;
  let sendStudioInviteEmail: jest.Mock;

  const body = { role: "certified_contributor", target_email: "new@example.com" };

  const minted = {
    status: 200,
    data: {
      token: "tok-abc",
      role: "certified_contributor",
      expires_at: "2026-09-02T00:00:00Z",
    },
  };

  beforeEach(() => {
    proxyStudio = jest.fn();
    sendStudioInviteEmail = jest.fn().mockResolvedValue({ success: true });
    controller = new StudioInviteController(
      { proxyStudio } as unknown as OrchestratorService,
      { sendStudioInviteEmail } as unknown as GmailService,
      { get: () => "https://app.example.com" } as unknown as ConfigService,
    );
  });

  it("mints through the orchestrator, then emails the invitee", async () => {
    proxyStudio.mockResolvedValue(minted);

    const result = await controller.createAndSend(body, "Bearer admin-token");

    expect(proxyStudio).toHaveBeenCalledWith(
      "POST",
      "invite",
      "Bearer admin-token",
      body,
      {},
    );
    expect(sendStudioInviteEmail).toHaveBeenCalledWith({
      to: "new@example.com",
      roleLabel: "Certified Contributor",
      inviteUrl: "https://app.example.com/studio/invite/tok-abc",
      expiresOn: "Sep 2, 2026",
    });
    expect(result).toEqual({
      sent: true,
      email: "new@example.com",
      role: "certified_contributor",
      expires_at: "2026-09-02T00:00:00Z",
    });
  });

  it("never returns the token on success — it belongs in the DB and the inbox only", async () => {
    proxyStudio.mockResolvedValue(minted);

    const result = await controller.createAndSend(body, "Bearer t");

    expect(JSON.stringify(result)).not.toContain("tok-abc");
  });

  it("relays the orchestrator's 403 when the caller is not a review_admin", async () => {
    proxyStudio.mockResolvedValue({
      status: 403,
      data: { detail: "Requires one of: ['review_admin']" },
    });

    await expect(
      controller.createAndSend(body, "Bearer non-admin"),
    ).rejects.toMatchObject({ status: 403 });
    expect(sendStudioInviteEmail).not.toHaveBeenCalled();
  });

  it("relays a 422 when target_email is missing, without sending anything", async () => {
    proxyStudio.mockResolvedValue({ status: 422, data: { detail: "field required" } });

    await expect(
      controller.createAndSend({ role: "developer" } as any, "Bearer t"),
    ).rejects.toMatchObject({ status: 422 });
    expect(sendStudioInviteEmail).not.toHaveBeenCalled();
  });

  it("surfaces the link as a recovery path when delivery fails", async () => {
    proxyStudio.mockResolvedValue(minted);
    sendStudioInviteEmail.mockResolvedValue({ success: false, error: "SMTP down" });

    const result = await controller.createAndSend(body, "Bearer t");

    // The row already exists, so failing silently would strand it.
    expect(result).toMatchObject({
      sent: false,
      delivery_error: "SMTP down",
      invite_url: "https://app.example.com/studio/invite/tok-abc",
    });
  });

  it("fails loudly if the orchestrator returns success with no token", async () => {
    proxyStudio.mockResolvedValue({ status: 200, data: {} });

    await expect(controller.createAndSend(body, "Bearer t")).rejects.toMatchObject({
      status: 502,
    });
    expect(sendStudioInviteEmail).not.toHaveBeenCalled();
  });
});

describe("studio route registration order", () => {
  /**
   * StudioProxyController has @Post("*") on the same `studio` prefix. Express matches in
   * registration order, so if the proxy is registered first it swallows POST
   * /studio/invite, the request still succeeds, and the email is silently never sent —
   * which looks exactly like the old behaviour. Pin the order.
   */
  it("registers StudioInviteController before StudioProxyController", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OrchestratorModule } = require("./orchestrator.module");
    const controllers: any[] = Reflect.getMetadata("controllers", OrchestratorModule);

    const inviteIdx = controllers.indexOf(StudioInviteController);
    const proxyIdx = controllers.indexOf(StudioProxyController);

    expect(inviteIdx).toBeGreaterThanOrEqual(0);
    expect(proxyIdx).toBeGreaterThanOrEqual(0);
    expect(inviteIdx).toBeLessThan(proxyIdx);
  });
});
