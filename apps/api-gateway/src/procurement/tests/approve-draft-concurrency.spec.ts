/**
 * Regression tests: approveDraft must never send a vendor two copies of the
 * same purchase order.
 *
 * Two defects this pins down:
 *   1. NO ATOMIC CLAIM — two concurrent taps both passed the
 *      `.eq("status", "PENDING_APPROVAL")` read and both reached the email
 *      send. Real money, real vendor, two orders.
 *   2. SEND BEFORE RECORD — the email went out before the status was written,
 *      so a failing status write left the email at the vendor with the row
 *      still PENDING_APPROVAL, inviting a human to tap approve again.
 *
 * The fake Supabase below holds real row state and applies a conditional
 * UPDATE the way Postgres would: filter, then mutate, in one uninterrupted
 * pass. That is what makes the claim testable — a chainable
 * `mockReturnThis()` stub cannot lose a race, so it cannot show this bug.
 *
 * Run:
 *   cd apps/api-gateway && npx jest --testPathPattern approve-draft-concurrency --runInBand
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ProcurementService } from "../procurement.service";
import { DatabaseService } from "../../database/database.service";
import { EventsService } from "../../events/events.service";
import { InventoryLedgerService } from "../../inventory-ledger/inventory-ledger.service";
import { GmailService } from "../../communications/gmail.service";

type Row = Record<string, any>;

const RESTAURANT_ID = "rest-1";
const ORDER_ID = "order-1";
const CONVERSATION_ID = "conv-1";

/** One event-loop macrotask, so concurrent callers interleave at every await. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Minimal PostgREST-shaped query builder over an in-memory store.
 * Column lists are ignored — seeded rows already carry their embedded joins.
 */
class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private isUpdate = false;
  private payload: Row = {};
  private limitN: number | null = null;

  constructor(
    private readonly store: Record<string, Row[]>,
    private readonly table: string,
  ) {}

  select() {
    return this;
  }
  order() {
    return this;
  }
  update(payload: Row) {
    this.isUpdate = true;
    this.payload = payload;
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: any) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  gt(col: string, val: any) {
    this.filters.push((r) => r[col] != null && r[col] > val);
    return this;
  }
  is(col: string, val: any) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  in(col: string, vals: any[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  /**
   * The whole filter-then-mutate pass runs synchronously after the tick, so an
   * UPDATE is atomic with respect to other in-flight callers — exactly the
   * property a conditional UPDATE has in Postgres.
   */
  private async run(): Promise<{ data: Row[]; error: any }> {
    await tick();
    const rows = (this.store[this.table] ??= []);
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.isUpdate) matched.forEach((r) => Object.assign(r, this.payload));
    const data = this.limitN == null ? matched : matched.slice(0, this.limitN);
    return { data, error: null };
  }

  then(onOk: any, onErr?: any) {
    return this.run().then(onOk, onErr);
  }

  async single() {
    const { data } = await this.run();
    if (data.length !== 1) {
      return {
        data: null,
        error: { code: "PGRST116", message: `${data.length} rows returned` },
      };
    }
    return { data: data[0], error: null };
  }

  async maybeSingle() {
    const { data } = await this.run();
    return { data: data[0] ?? null, error: null };
  }
}

function makeStore() {
  const store: Record<string, Row[]> = {
    procurement_conversations: [
      {
        id: CONVERSATION_ID,
        restaurant_id: RESTAURANT_ID,
        order_id: ORDER_ID,
        direction: "outbound",
        status: "PENDING_APPROVAL",
        content: "Dear Bordeaux Suppliers, please send 6 bottles.",
        created_at: new Date(Date.now() - 60_000).toISOString(),
        gmail_thread_id: null,
        message_id: null,
        email_headers: { subject: "Order Request: Chateau Margaux 2018" },
        sent_at: null,
        providers: {
          name: "Bordeaux Suppliers",
          contact_email: "supplier@bordeaux.com",
          contact_first_name: "Marie",
          primary_contact: null,
        },
        procurement_orders: {
          inventory: { wine_name: "Chateau Margaux 2018" },
        },
      },
    ],
    // Empty: no inbound reply pending analysis, no branding/templates, and no
    // order row for the post-send calendar step (which is best-effort anyway).
    procurement_orders: [],
    communication_templates: [],
    restaurant_branding: [],
    restaurants: [],
  };
  return store;
}

function conversationRow(store: Record<string, Row[]>): Row {
  return store.procurement_conversations[0];
}

async function buildService(
  store: Record<string, Row[]>,
  sendEmail: jest.Mock,
): Promise<ProcurementService> {
  const supabase = { from: (table: string) => new FakeQuery(store, table) };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProcurementService,
      {
        provide: DatabaseService,
        useValue: { supabase, getClient: () => supabase },
      },
      { provide: EventsService, useValue: { createEvent: jest.fn() } },
      {
        provide: InventoryLedgerService,
        useValue: { recordTransaction: jest.fn() },
      },
      { provide: GmailService, useValue: { sendEmail } },
    ],
  }).compile();

  const service = module.get<ProcurementService>(ProcurementService);
  jest.spyOn((service as any).logger, "error").mockImplementation(() => {});
  jest.spyOn((service as any).logger, "warn").mockImplementation(() => {});
  jest.spyOn((service as any).logger, "log").mockImplementation(() => {});
  return service;
}

/** A send that takes a while, so both racers are genuinely in flight at once. */
function slowSendEmail() {
  return jest.fn(async (opts: any) => {
    await tick();
    await tick();
    return {
      success: true,
      messageId: `gmail-${Math.random().toString(36).slice(2)}`,
      threadId: "thread-1",
      rfc822MessageId: opts.messageIdHeader,
    };
  });
}

describe("approveDraft — concurrent approvals (duplicate vendor send)", () => {
  it("sends exactly ONE email when two managers approve the same draft at once", async () => {
    const store = makeStore();
    const sendEmail = slowSendEmail();
    const service = await buildService(store, sendEmail);

    const results = await Promise.allSettled([
      service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any),
      service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any),
    ]);

    // The whole point: the vendor gets one purchase order, not two.
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser is told it lost, not that something broke.
    const reason: any = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason?.getStatus?.()).toBe(409);

    expect(conversationRow(store).status).toBe("SENT");
  });

  it("stamps the pre-minted RFC822 Message-ID on the row before sending", async () => {
    const store = makeStore();
    let messageIdAtSendTime: string | undefined;
    let rowIdDuringSend: string | undefined;
    const sendEmail = jest.fn(async (opts: any) => {
      // Observed mid-flight: the row already carries the id that is on the wire.
      messageIdAtSendTime = opts.messageIdHeader;
      rowIdDuringSend = conversationRow(store).message_id;
      return {
        success: true,
        messageId: "gmail-1",
        threadId: "thread-1",
        rfc822MessageId: opts.messageIdHeader,
      };
    });
    const service = await buildService(store, sendEmail);

    await service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any);

    expect(messageIdAtSendTime).toMatch(
      /^<mudavym-[0-9a-f-]{36}@wineops\.ai>$/,
    );
    expect(rowIdDuringSend).toBe(messageIdAtSendTime);
    expect(conversationRow(store).message_id).toBe(messageIdAtSendTime);
    expect(conversationRow(store).status).toBe("SENT");
  });

  it("claims the row (not PENDING_APPROVAL) for the whole duration of the send", async () => {
    const store = makeStore();
    let statusDuringSend: string | undefined;
    const sendEmail = jest.fn(async () => {
      statusDuringSend = conversationRow(store).status;
      return { success: true, messageId: "gmail-1", threadId: "thread-1" };
    });
    const service = await buildService(store, sendEmail);

    await service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any);

    // If this were still PENDING_APPROVAL, a second tap could slip through.
    expect(statusDuringSend).toBe("SENDING");
  });

  it("releases the draft for retry only on a DEFINITE refusal", async () => {
    const store = makeStore();
    // GmailService says in as many words that no transport was attempted.
    const sendEmail = jest.fn(async () => ({
      success: false,
      error:
        "No email delivery method available — OAuth failed and SMTP not configured",
    }));
    const service = await buildService(store, sendEmail);

    await expect(
      service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any),
    ).rejects.toThrow(/could not be delivered/i);

    // Nothing reached the vendor, so re-approval is safe and expected.
    expect(conversationRow(store).status).toBe("PENDING_APPROVAL");
  });

  // ── Ambiguous send failures ───────────────────────────────────────────────
  // A timeout / reset / hang-up can land AFTER the remote server accepted the
  // message. Treating those as "not sent" and releasing the draft re-opens the
  // duplicate-send hole through the error path, on a far more ordinary event
  // than two simultaneous taps.
  describe.each([
    ["a socket hang-up", "socket hang up"],
    ["a connection reset", "read ECONNRESET"],
    ["a timeout", "Client network socket disconnected: ETIMEDOUT"],
    ["an SMTP 4xx transient", "451 4.3.0 Temporary server error, try again"],
    ["an unclassifiable error", "something went sideways"],
  ])("ambiguous failure — %s", (_label, errorText) => {
    it("parks the draft as SEND_UNCONFIRMED, never back to PENDING_APPROVAL", async () => {
      const store = makeStore();
      const sendEmail = jest.fn(async () => {
        throw new Error(errorText);
      });
      const service = await buildService(store, sendEmail);

      await expect(
        service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any),
      ).rejects.toThrow(/may or may not have reached the vendor/i);

      expect(conversationRow(store).status).toBe("SEND_UNCONFIRMED");
      expect(conversationRow(store).status).not.toBe("PENDING_APPROVAL");
    });

    it("leaves the row un-re-approvable, so a second tap cannot send again", async () => {
      const store = makeStore();
      const sendEmail = jest.fn(async () => {
        throw new Error(errorText);
      });
      const service = await buildService(store, sendEmail);

      await expect(
        service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any),
      ).rejects.toThrow();

      // The human taps approve again. There must be no draft left to send.
      await expect(
        service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any),
      ).rejects.toThrow(/no pending draft/i);

      // One attempt, one delivery-at-most. Never a second copy.
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  it("reuses the stored Message-ID on retry, so a delivered-but-unrecorded copy dedupes", async () => {
    const store = makeStore();
    const seenMessageIds: string[] = [];
    // First attempt: a definite refusal, so the draft is legitimately released.
    // If that classification is ever wrong and the mail DID go, the retry must
    // carry the SAME Message-ID so the receiving server drops the duplicate.
    let attempt = 0;
    const sendEmail = jest.fn(async (opts: any) => {
      seenMessageIds.push(opts.messageIdHeader);
      attempt += 1;
      if (attempt === 1) {
        return {
          success: false,
          error:
            "No email delivery method available — OAuth failed and SMTP not configured",
        };
      }
      return {
        success: true,
        messageId: "gmail-1",
        threadId: "thread-1",
        rfc822MessageId: opts.messageIdHeader,
      };
    });
    const service = await buildService(store, sendEmail);

    await expect(
      service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any),
    ).rejects.toThrow();
    expect(conversationRow(store).status).toBe("PENDING_APPROVAL");

    // The manager retries the released draft.
    await service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any);

    expect(seenMessageIds).toHaveLength(2);
    expect(seenMessageIds[0]).toMatch(/^<mudavym-[0-9a-f-]{36}@wineops\.ai>$/);
    // The whole point: the retry is the SAME message, not a new one.
    expect(seenMessageIds[1]).toBe(seenMessageIds[0]);
    expect(conversationRow(store).status).toBe("SENT");
  });

  it("never returns a sent draft to PENDING_APPROVAL when the status write fails", async () => {
    const store = makeStore();
    const sendEmail = slowSendEmail();
    const service = await buildService(store, sendEmail);

    // Break ONLY the final record-the-outcome UPDATE (status -> SENT). The
    // claim and the SEND_UNCONFIRMED fallback still go through the real fake.
    const realFrom = (service as any).databaseService.supabase.from;
    (service as any).databaseService.supabase.from = (table: string) => {
      const q: any = realFrom(table);
      const realUpdate = q.update.bind(q);
      q.update = (payload: Row) => {
        if (payload.status !== "SENT") return realUpdate(payload);
        const failing: any = {
          eq: () => failing,
          select: () => failing,
          single: async () => ({
            data: null,
            error: { message: "connection reset by peer" },
          }),
          maybeSingle: async () => ({ data: null, error: null }),
          then: (ok: any) =>
            Promise.resolve({ data: [], error: null }).then(ok),
        };
        return failing;
      };
      return q;
    };

    await expect(
      service.approveDraft(RESTAURANT_ID, ORDER_ID, {} as any),
    ).rejects.toThrow(/WAS delivered/i);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    // The email is at the vendor. PENDING_APPROVAL here is what caused the bug.
    expect(conversationRow(store).status).not.toBe("PENDING_APPROVAL");
    expect(conversationRow(store).status).toBe("SEND_UNCONFIRMED");
  });
});
