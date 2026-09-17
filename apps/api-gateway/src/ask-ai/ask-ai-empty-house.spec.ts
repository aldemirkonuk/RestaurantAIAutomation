import { AskAiService } from "./ask-ai.service";

/**
 * ADR 0145 build item 8: refuse before the model call when there is nothing
 * any action could be grounded against. The property worth pinning is not the
 * sentence -- it is that the model client is never called, because a call made
 * and then rejected by grounding is still a call paid for.
 *
 * The service is built without its constructor so the test depends only on the
 * three fields `propose` touches before the gate, not on the order of every
 * provider Nest injects.
 */
function serviceWith(rows: {
  inventory: any[];
  providers: any[];
  orders: any[];
}) {
  const tableRows: Record<string, any[]> = {
    restaurant_inventory: rows.inventory,
    providers: rows.providers,
    procurement_orders: rows.orders,
  };
  const client = {
    from(table: string) {
      const result = { data: tableRows[table] ?? [], error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: any, reject: any) =>
          Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
  const svc = Object.create(AskAiService.prototype) as any;
  svc.databaseService = { getClient: () => client };
  svc.logger = { error: () => {}, warn: () => {}, log: () => {} };
  const call = jest.fn();
  svc.modelClient = { call };
  return { svc: svc as AskAiService, call };
}

describe("Ask AI refuses before the model when there is nothing to act on", () => {
  it("an empty house gets a reason and the model is never called", async () => {
    const { svc, call } = serviceWith({
      inventory: [],
      providers: [],
      orders: [],
    });
    const out = await svc.propose("r1", "u1", "order more rakı");
    expect(out.proposed).toBe(false);
    expect(out.reason).toMatch(/nothing was sent to the model/i);
    expect(call).not.toHaveBeenCalled();
  });

  it("a house with even one item still reaches the model", async () => {
    // The control. Without it, a gate that refused EVERY ask would pass the
    // test above. The model mock returns nothing parseable, so the call is
    // expected to happen and whatever follows it may refuse -- what matters is
    // that the gate did not.
    const { svc, call } = serviceWith({
      inventory: [{ id: "i1", wine_name: "Kavaklidere" }],
      providers: [],
      orders: [],
    });
    (svc as any).routing = () => ({ model: "claude-haiku-4-5" });
    call.mockResolvedValue({ content: [{ type: "text", text: "not json" }] });
    await svc.propose("r1", "u1", "order more").catch(() => undefined);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
