/**
 * F-772: discarding a vendor letter says who discarded it and which letter it
 * was. The event is the agent's decision log's only source; it used to carry
 * `{order_id, restaurant_id}` alone, so the log recorded `conversation_id: ""`
 * and no person.
 */
import { ProcurementService } from "./procurement.service";

function serviceWith(rows: Array<{ id: string }>) {
  const writes: any[] = [];
  const chain: any = {
    update: (payload: any) => {
      writes.push(payload);
      return chain;
    },
    eq: () => chain,
    select: () => Promise.resolve({ data: rows, error: null }),
  };
  const db = { supabase: { from: () => chain } } as any;
  const orchestrator = { publishEvent: jest.fn(async () => undefined) };
  const svc = new ProcurementService(
    db,
    {} as any,
    {} as any,
    orchestrator as any,
  );
  return { svc, writes, orchestrator };
}

describe("discardDraft — who, and which letter (F-772)", () => {
  it("names the discarded letter and the person in the event", async () => {
    const { svc, writes, orchestrator } = serviceWith([{ id: "conv-9" }]);
    await svc.discardDraft("rest-1", "ord-1", "user-7");
    expect(writes).toEqual([{ status: "DISCARDED" }]);
    expect(orchestrator.publishEvent).toHaveBeenCalledWith(
      "provider.events",
      "provider.draft.discarded",
      {
        order_id: "ord-1",
        restaurant_id: "rest-1",
        conversation_id: "conv-9",
        conversation_ids: ["conv-9"],
        discarded_by: "user-7",
      },
    );
  });

  it("still refuses when there is no waiting letter", async () => {
    const { svc, orchestrator } = serviceWith([]);
    await expect(svc.discardDraft("rest-1", "ord-1", "user-7")).rejects.toThrow(
      /No PENDING_APPROVAL draft/,
    );
    expect(orchestrator.publishEvent).not.toHaveBeenCalled();
  });
});
