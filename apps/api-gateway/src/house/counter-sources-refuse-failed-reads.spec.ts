import { ServiceUnavailableException } from "@nestjs/common";
import { ConversationsService } from "../conversations/conversations.service";
import { ReceivingService } from "../procurement/receiving.service";

/**
 * Two of the counter's sources turned a failed read into an answer.
 *
 *  - `ConversationsService.getPendingConversations` caught its own throw and
 *    returned `[]`, so `GET /conversations/pending/list` said `{ count: 0 }` —
 *    "no vendor is waiting on you" — over a read that never happened.
 *  - `ReceivingService.listUnverified` ignored the error of its second read
 *    (the orders' numbers and statuses). With that read failed, the filter
 *    that drops COMPLETED and CANCELLED orders saw no statuses at all and let
 *    every closed order through: an inflated queue built from nothing.
 *
 * The house counter (sketch 119 D) reads both. Each case here fails against
 * the pre-fix file; the real-zero cases pin that the fix did not turn an empty
 * register into an error. The day line's delivery source,
 * `ReceivingService.arrivedToday`, is held to the same rule in the last block.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const DB_TEXT = "canceling statement due to statement timeout";

function query(result: { data: unknown; error: { message: string } | null }) {
  const q: any = {
    select: () => q,
    eq: () => q,
    gte: () => q,
    lt: () => q,
    in: () => q,
    order: () => q,
    limit: () => q,
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
  };
  return q;
}

describe("pending conversations: a failed read is not an empty queue", () => {
  function svc(result: { data: unknown; error: { message: string } | null }) {
    const db = { supabase: { from: () => query(result) } };
    return new ConversationsService(db as any);
  }

  it("rejects with 503 when the read fails", async () => {
    await expect(
      svc({ data: null, error: { message: DB_TEXT } }).getPendingConversations(
        HOUSE,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("does not hand the database's text to the caller", async () => {
    await expect(
      svc({ data: null, error: { message: DB_TEXT } }).getPendingConversations(
        HOUSE,
      ),
    ).rejects.toThrow(/Could not read the replies waiting on this house/);
  });

  it("a queue that WAS read and is empty still answers []", async () => {
    await expect(
      svc({ data: [], error: null }).getPendingConversations(HOUSE),
    ).resolves.toEqual([]);
  });
});

describe("unverified deliveries: a failed orders read is not 'none closed'", () => {
  const EVENTS = {
    data: [
      {
        order_id: "o-closed",
        counted_qty_bottles: 12,
        occurred_at: "2026-09-21T08:00:00Z",
        stage: "case_count",
      },
    ],
    error: null,
  };

  function svc(orders: { data: unknown; error: { message: string } | null }) {
    const db = {
      getClient: () => ({
        from: (table: string) =>
          query(table === "procurement_receipt_events" ? EVENTS : orders),
      }),
    };
    return new ReceivingService(db as any);
  }

  it("rejects when the orders read fails, rather than listing a closed order", async () => {
    await expect(
      svc({ data: null, error: { message: DB_TEXT } }).listUnverified(HOUSE),
    ).rejects.toThrow(DB_TEXT);
  });

  it("still drops an order the read says is closed", async () => {
    await expect(
      svc({
        data: [{ id: "o-closed", order_number: "ORD-1", status: "COMPLETED" }],
        error: null,
      }).listUnverified(HOUSE),
    ).resolves.toEqual([]);
  });

  it("still lists an open one", async () => {
    const out = await svc({
      data: [{ id: "o-closed", order_number: "ORD-1", status: "DELIVERED" }],
      error: null,
    }).listUnverified(HOUSE);
    expect(out.map((d) => d.orderNumber)).toEqual(["ORD-1"]);
  });
});

describe("deliveries that arrived: a failed read is not 'none arrived'", () => {
  // The day line's source (`house-day.service.ts`). Either read failing must
  // reach the day line as a throw, which its register wrapper turns into
  // `unreadable` — never `{ rows: [] }`, which would print "0 arrived".
  const START = new Date("2026-09-21T05:00:00.000Z");
  const END = new Date("2026-09-22T05:00:00.000Z");
  const EVENTS = {
    data: [{ order_id: "o-1", occurred_at: "2026-09-21T16:00:00.000Z" }],
    error: null,
  };

  function svc(
    events: { data: unknown; error: { message: string } | null },
    orders: { data: unknown; error: { message: string } | null },
  ) {
    const db = {
      getClient: () => ({
        from: (table: string) =>
          query(table === "procurement_receipt_events" ? events : orders),
      }),
    };
    return new ReceivingService(db as any);
  }

  it("rejects when the door-event read fails", async () => {
    await expect(
      svc({ data: null, error: { message: DB_TEXT } }, { data: [], error: null })
        .arrivedToday(HOUSE, START, END),
    ).rejects.toThrow(DB_TEXT);
  });

  it("rejects when the order-number read fails, rather than printing numberless ticks", async () => {
    await expect(
      svc(EVENTS, { data: null, error: { message: DB_TEXT } }).arrivedToday(
        HOUSE,
        START,
        END,
      ),
    ).rejects.toThrow(DB_TEXT);
  });

  it("a day that WAS read and had no deliveries still answers an empty, uncapped read", async () => {
    await expect(
      svc({ data: [], error: null }, { data: [], error: null }).arrivedToday(
        HOUSE,
        START,
        END,
      ),
    ).resolves.toEqual({ rows: [], capped: false });
  });

  it("still names the order when both reads succeed", async () => {
    const out = await svc(EVENTS, {
      data: [{ id: "o-1", order_number: "ORD-1" }],
      error: null,
    }).arrivedToday(HOUSE, START, END);
    expect(out.rows.map((d) => d.orderNumber)).toEqual(["ORD-1"]);
  });
});
