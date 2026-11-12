import {
  InboundResponderService,
  REPLY_DRAFTER_OFF,
} from "./inbound-responder.service";

/**
 * With no model switched on, the responder's `reason` reaches the page through
 * the redraft route (procurement.service.ts returns `reason: result.reason`).
 * It used to be the deployment's variable name, "ANTHROPIC_API_KEY is not
 * configured". The house now reads that drafting is not switched on here yet;
 * the variable name stays in the log.
 */
describe("inbound responder: no model switched on, in the house's words", () => {
  it("returns REPLY_DRAFTER_OFF, logs the variable, and never calls a model", async () => {
    const modelClient = { call: jest.fn() };
    const service = new InboundResponderService(
      { get: () => undefined } as any,
      {} as any,
      modelClient as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, "isNegotiationEnabled").mockResolvedValue(true);
    const warn = jest
      .spyOn((service as any).logger, "warn")
      .mockImplementation(() => undefined);

    const r = await service.analyzeAndDraftReply({
      inboundConversationId: "c-1",
      orderId: "o-1",
      restaurantId: "r-1",
      providerId: "p-1",
    } as any);

    expect(r).toEqual({ drafted: false, reason: REPLY_DRAFTER_OFF });
    expect(r.reason).toMatch(/not switched on here yet/);
    expect(r.reason).not.toMatch(/ANTHROPIC|API[\s_-]?KEY|not configured/i);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/ANTHROPIC_API_KEY/);
    expect(modelClient.call).not.toHaveBeenCalled();
  });
});
