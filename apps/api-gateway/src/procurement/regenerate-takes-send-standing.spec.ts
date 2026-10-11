/**
 * F-1249 (wave 42 sim, rehit of F-107): `POST /orders/:id/generate-ai-reply`
 * with `regenerate` discards the draft waiting for approval or already
 * scheduled to send, and the route carried no gate beyond sign-in, so any
 * member could throw away a letter they could not have sent.
 *
 * Coordinator call S179: a regenerate takes the existing send standing, a
 * holder of the house's money or a staff member the house lets send
 * (`sendOrAskFor().maySend`, ADR 0175 D10). No new policy.
 */
import { ForbiddenException } from "@nestjs/common";
import { ProcurementController } from "./procurement.controller";
import type { ProcurementService } from "./procurement.service";

const USER = { userId: "u-1", restaurantId: "r-1" };

function controller(maySend: boolean) {
  const service = {
    generateAiReply: jest.fn().mockResolvedValue({ triggered: true }),
    sendOrAskFor: jest.fn().mockResolvedValue({ readable: true, maySend }),
  };
  return {
    service,
    controller: new ProcurementController(
      service as unknown as ProcurementService,
    ),
  };
}

describe("regenerating a vendor reply takes the send standing (F-1249)", () => {
  it.each(["staff", null, undefined])(
    "refuses %p without a send grant and discards nothing",
    async (role) => {
      const { controller: c, service } = controller(false);
      await expect(
        c.generateAiReply("o-1", { regenerate: true }, { ...USER, role }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.generateAiReply).not.toHaveBeenCalled();
    },
  );

  it("lets a staff member the house lets send regenerate", async () => {
    const { controller: c, service } = controller(true);
    await c.generateAiReply(
      "o-1",
      { regenerate: true },
      { ...USER, role: "staff" },
    );
    expect(service.sendOrAskFor).toHaveBeenCalledWith("u-1", "r-1");
    expect(service.generateAiReply).toHaveBeenCalledWith("r-1", "o-1", {
      instruction: undefined,
      regenerate: true,
      force: undefined,
    });
  });

  it.each(["owner", "manager"])("lets a %s regenerate", async (role) => {
    const { controller: c, service } = controller(false);
    await c.generateAiReply("o-1", { regenerate: true }, { ...USER, role });
    expect(service.generateAiReply).toHaveBeenCalled();
  });

  it("a plain generate, which discards nothing, is not gated", async () => {
    const { controller: c, service } = controller(false);
    await c.generateAiReply("o-1", {}, { ...USER, role: "staff" });
    expect(service.sendOrAskFor).not.toHaveBeenCalled();
    expect(service.generateAiReply).toHaveBeenCalled();
  });
});
