/**
 * F-1478: the auto-send sweep discarded a scheduled vendor reply on a FAILED
 * order (a truck refused at the door) with only a log line. ADR 0125's
 * 2026-10-11 amendment says a letter may still be written about a refused
 * truck — the credit or replacement letter is the next thing the house
 * sends — and the seal and the send already let it through. A CANCELLED
 * order's reply is still discarded and never sent.
 */

import { ProcurementService } from "./procurement.service";

type Row = Record<string, any>;

function harness(orderStatus: string) {
  const updates: Row[] = [];
  const conversation = {
    id: "conv-1",
    order_id: "order-1",
    restaurant_id: "house-1",
    provider_id: "prov-1",
    content: "Thank you — we will credit the broken case.",
    message_text: null,
    gmail_thread_id: null,
    email_headers: {},
    created_at: "2026-10-10T09:00:00Z",
  };
  const order = {
    id: "order-1",
    status: orderStatus,
    ai_autonomy_paused: false,
    providers: { contact_email: "vendor@example.com", name: "Kestrel" },
    restaurant_inventory: { wine_name: "Rioja" },
  };
  const supabase = {
    from(table: string) {
      let write: Row | null = null;
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        lte: () => chain,
        limit: () => chain,
        update: (row: Row) => {
          write = row;
          updates.push({ table, ...row });
          return chain;
        },
        maybeSingle: () =>
          Promise.resolve({ data: { id: conversation.id }, error: null }),
        single: () => Promise.resolve({ data: order, error: null }),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve(
            write
              ? { data: null, error: null }
              : { data: [conversation], error: null },
          ).then(ok, ko),
      };
      return chain;
    },
  };
  const svc = Object.create(ProcurementService.prototype) as any;
  svc.databaseService = { supabase };
  svc.gmailService = { sendEmail: jest.fn() };
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc.sendProviderEmail = jest.fn().mockResolvedValue({});
  svc.newerInboundSince = jest.fn().mockResolvedValue(false);
  svc.resolveSenderName = jest.fn().mockResolvedValue("Ada");
  svc.revertScheduledToDraft = jest.fn().mockResolvedValue(undefined);
  svc.emitConvUpdate = jest.fn();
  return { svc, updates };
}

describe("a scheduled vendor reply on a refused order (F-1478)", () => {
  it("goes to the vendor — a truck refused at the door is when the house writes for its credit", async () => {
    const { svc, updates } = harness("FAILED");
    await svc.processScheduledAutoSends();
    expect(svc.sendProviderEmail).toHaveBeenCalledTimes(1);
    expect(svc.sendProviderEmail.mock.calls[0][0].to).toBe(
      "vendor@example.com",
    );
    expect(updates.map((u) => u.status)).not.toContain("DISCARDED");
    expect(updates.map((u) => u.status)).toContain("AUTO_SENT");
  });

  it("is still discarded, unsent, on a cancelled order", async () => {
    const { svc, updates } = harness("CANCELLED");
    await svc.processScheduledAutoSends();
    expect(svc.sendProviderEmail).not.toHaveBeenCalled();
    expect(updates.map((u) => u.status)).toContain("DISCARDED");
  });
});
