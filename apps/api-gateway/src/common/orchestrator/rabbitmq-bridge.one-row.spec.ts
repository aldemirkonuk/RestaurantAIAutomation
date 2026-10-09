/**
 * F-047: one inbound mail message is one procurement_conversations row.
 *
 * The bridge reads for an earlier row before it inserts, but two deliveries
 * of the same message that run at once both pass that read. The
 * one-row-per-message index (20261231700000_one_mail_message_is_one_row.sql)
 * refuses the second insert with 23505; the bridge must take that as
 * "already stored", the same answer its read gives, not as a failed write.
 */
import { RabbitMqBridgeService } from "./rabbitmq-bridge.service";

type Result = { data: any; error: any };

/** A chainable stand-in for the supabase client, answering per table. */
function fakeSupabase(answers: {
  providers: Result;
  existing: Result;
  openOrders: Result;
  insert: Result;
}) {
  const inserts: any[] = [];
  const from = (table: string) => {
    let op: "select" | "insert" = "select";
    let result: Result = { data: [], error: null };
    const b: any = {
      select: () => b,
      ilike: () => b,
      eq: () => b,
      not: () => b,
      order: () => b,
      limit: () => b,
      single: () => b,
      insert: (row: any) => {
        op = "insert";
        inserts.push({ table, row });
        return b;
      },
      then: (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => {
        if (table === "providers") result = answers.providers;
        else if (table === "procurement_orders") result = answers.openOrders;
        else if (table === "procurement_conversations")
          result = op === "insert" ? answers.insert : answers.existing;
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return b;
  };
  return { client: { from }, inserts };
}

function build(insert: Result) {
  const db = fakeSupabase({
    providers: {
      data: [{ id: "prov-1", restaurant_id: "house-1", name: "Vendor" }],
      error: null,
    },
    existing: { data: [], error: null },
    openOrders: { data: [], error: null },
    insert,
  });
  const websocketGateway = {
    emitRestaurantNotification: jest.fn(),
    emitConversationUpdated: jest.fn(),
  };
  const inboundResponder = {
    analyzeAndDraftReply: jest.fn(),
    persistManagerNotification: jest.fn(),
  };
  const promotionExtractor = { extractAndStore: jest.fn() };
  const service = new RabbitMqBridgeService(
    {} as any,
    websocketGateway as any,
    { supabase: db.client } as any,
    inboundResponder as any,
    promotionExtractor as any,
    {} as any,
  );
  const logger = (service as any).logger;
  jest.spyOn(logger, "log").mockImplementation(() => undefined);
  jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  const error = jest.spyOn(logger, "error").mockImplementation(() => undefined);
  return { service, db, websocketGateway, promotionExtractor, error, log: logger.log };
}

const message = {
  from: "Vendor <orders@vendor.example>",
  subject: "Re: order",
  body: "Confirmed.",
  gmail_message_id: "gm-1",
  gmail_thread_id: "gt-1",
};

describe("handleInboundEmail: a second copy of one message (F-047)", () => {
  it("takes the index's refusal as already stored, not as a failed write", async () => {
    const h = build({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "procurement_conversations_one_row_per_gmail_message"',
      },
    });

    await (h.service as any).handleInboundEmail(message);

    expect(h.db.inserts).toHaveLength(1);
    expect(h.error).not.toHaveBeenCalled();
    expect(h.log).toHaveBeenCalledWith(
      expect.stringContaining("already stored gmail_message_id=gm-1"),
    );
    // Nothing downstream runs for the copy that lost.
    expect(h.websocketGateway.emitRestaurantNotification).not.toHaveBeenCalled();
    expect(h.promotionExtractor.extractAndStore).not.toHaveBeenCalled();
  });

  it("still reports any other failed write as a failure", async () => {
    const h = build({
      data: null,
      error: { code: "23503", message: "violates foreign key constraint" },
    });

    await (h.service as any).handleInboundEmail(message);

    expect(h.error).toHaveBeenCalledWith(
      expect.stringContaining("DB insert failed"),
    );
    expect(h.websocketGateway.emitRestaurantNotification).not.toHaveBeenCalled();
  });
});
