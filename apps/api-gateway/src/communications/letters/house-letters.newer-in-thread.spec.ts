/**
 * The newer-in-thread guard (r110 mail-gap g2): two managers never send two
 * blind replies. A reply carries `seenThrough`, the newest letter its composer
 * showed; the queue answers 409 NEWER_IN_THREAD when, in the same thread and
 * house, another member's letter is queued, leaving or left after it, or a
 * person wrote in again. A warning with a way past it (`acknowledged`), never
 * a lock. Queue stub: by table, unfiltered (the service's own filters refuse),
 * with each query's filters recorded.
 */
import { ConflictException } from "@nestjs/common";
import { HouseLettersService, houseLetterSealArgs } from "./house-letters.service";
import { HouseSenderService, GMAIL_SEND_SCOPE } from "./house-sender.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const PROVIDER = "cccccccc-0000-4000-8000-cccccccccccc";
const VENDOR_B = "cccccccc-0000-4000-8000-00000000000b";
const ME = "dddddddd-0000-4000-8000-dddddddddddd";
const AYSE = "dddddddd-0000-4000-8000-00000000a1se";
const STRANGER = "dddddddd-0000-4000-8000-0000000000ff";
const ANSWERED = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const SEEN = { id: ANSWERED, createdAt: "2026-11-27T14:00:00.000Z" };
const THREAD = "gm:18c0ffee";

const answered = {
  id: ANSWERED,
  restaurant_id: HOUSE,
  provider_id: PROVIDER,
  direction: "inbound",
  status: "RECEIVED",
  created_at: SEEN.createdAt,
  received_at: SEEN.createdAt,
  message_id: "<v-1@fikritarim.com>",
  thread_key: THREAD,
  email_headers: {},
};

const row = (o: Record<string, any>) => ({
  restaurant_id: HOUSE,
  provider_id: PROVIDER,
  thread_key: THREAD,
  created_at: "2026-11-27T14:05:00.000Z",
  email_headers: {},
  ...o,
});
const ayseReply = (o: Record<string, any> = {}) =>
  row({
    id: "f0000000-0000-4000-8000-000000000001",
    direction: "outbound",
    status: "SENT",
    sent_at: "2026-11-27T14:05:00.000Z",
    message_text: "\n  Thursday works, thank you.\nAyşe",
    email_headers: { written_by: AYSE },
    ...o,
  });
const theyWroteAgain = (o: Record<string, any> = {}) =>
  row({
    id: "f0000000-0000-4000-8000-000000000002",
    direction: "inbound",
    status: "RECEIVED",
    created_at: "2026-11-27T14:07:00.000Z",
    received_at: "2026-11-27T14:07:00.000Z",
    message_text: "Sorry, one more thing: Friday instead?",
    ...o,
  });

function build(thread: Record<string, any>[], users: Record<string, any>[] = [{ user_id: AYSE, name: "Ayşe", restaurant_id: HOUSE }]) {
  const inserts: Record<string, any>[] = [];
  const queries: Array<{ table: string; calls: Array<[string, ...unknown[]]> }> = [];
  const tables: Record<string, unknown[]> = {
    providers: [{ id: PROVIDER, name: "Fikri", contact_email: "fikri@fikritarim.com", primary_contact: null }],
    provider_contacts: [],
    analytics_insights: [],
    procurement_conversations: [answered, ...thread],
    users,
    user_restaurant_access: [],
    integration_oauth_connections: [
      {
        id: "conn-1",
        user_id: ME,
        integration_id: "gmail_send",
        provider: "google",
        account_email: "siparis@lokanta.example",
        scopes: [GMAIL_SEND_SCOPE, "openid"],
        restaurant_id: HOUSE,
        revoked_at: null,
      },
    ],
  };
  const from = (table: string) => {
    const q = { table, calls: [] as Array<[string, ...unknown[]]> };
    queries.push(q);
    const data = tables[table] ?? [];
    const self: any = {};
    for (const m of ["select", "eq", "in", "is", "or", "lte", "gte", "gt", "order", "limit", "update"])
      self[m] = (...a: unknown[]) => (q.calls.push([m, ...a]), self);
    self.insert = (body: Record<string, any>) => (inserts.push(body), self);
    self.single = () => Promise.resolve({ data: { id: "letter-1" }, error: null });
    self.maybeSingle = () => Promise.resolve({ data: data[0] ?? null, error: null });
    self.then = (res: any) => Promise.resolve({ data, error: null }).then(res);
    return self;
  };
  const db = { client: { from } } as any;
  const sender = new HouseSenderService(db, { get: () => undefined } as any);
  const oauth = { getAccessToken: jest.fn().mockResolvedValue("ya29.token") } as any;
  const redeem = jest.fn(async () => ({ sealId: "seal-1" }));
  const authority = {
    assertMaySend: async () => ({ mode: "send", basis: "manager", grant: null, role: "manager" }),
    witnessGrantUse: async () => undefined,
  };
  const svc = new HouseLettersService(db, sender, oauth, authority as any, { redeem } as any);
  const queue = (extra: Record<string, unknown> = {}) =>
    svc.queue({
      restaurantId: HOUSE,
      userId: ME,
      role: "manager",
      dto: {
        providerId: PROVIDER,
        to: "fikri@fikritarim.com",
        subject: "Re: Delivery",
        body: "Thursday is fine.",
        answers: ANSWERED,
        seenThrough: SEEN,
        ...extra,
      } as any,
    });
  const threadQuery = () =>
    queries.find((q) => q.table === "procurement_conversations" && q.calls.some(([m, k]) => m === "gt" && k === "created_at"));
  return { queue, inserts, redeem, threadQuery };
}

async function refusal(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ConflictException);
    return (e as ConflictException).getResponse();
  }
  throw new Error("expected a 409");
}

describe("a reply over a thread that moved on since it was opened", () => {
  it("another manager's reply after the one seen: 409 with her name, the time and its first line", async () => {
    const { queue, inserts, redeem, threadQuery } = build([ayseReply()]);
    const body = await refusal(queue());
    expect(body.code).toBe("NEWER_IN_THREAD");
    expect(body.items).toEqual([
      {
        id: "f0000000-0000-4000-8000-000000000001",
        who: "Ayşe",
        at: "2026-11-27T14:05:00.000Z",
        direction: "outbound",
        status: "SENT",
        firstLine: "Thursday works, thank you.",
      },
    ]);
    expect(inserts).toHaveLength(0);
    expect(redeem).not.toHaveBeenCalled(); // before the seal: a 409 spends nothing
    const q = threadQuery()!;
    expect(q.calls).toEqual(
      expect.arrayContaining([
        ["eq", "restaurant_id", HOUSE],
        ["eq", "thread_key", THREAD],
        ["gt", "created_at", SEEN.createdAt],
      ]),
    );
  });

  it("queued, leaving and unconfirmed letters count as answered too", async () => {
    for (const status of ["HOUSE_QUEUED", "SENDING", "SEND_UNCONFIRMED"]) {
      const body = await refusal(build([ayseReply({ status })]).queue());
      expect(body.items[0].status).toBe(status);
    }
  });

  it("the person wrote again: 409, inbound, no name", async () => {
    const body = await refusal(build([theyWroteAgain()]).queue());
    expect(body.items).toEqual([
      expect.objectContaining({ who: null, direction: "inbound", at: "2026-11-27T14:07:00.000Z", firstLine: "Sorry, one more thing: Friday instead?" }),
    ]);
  });

  it("'Send mine as well': the letters shown are acknowledged and the reply is queued", async () => {
    const { queue, inserts } = build([ayseReply(), theyWroteAgain()]);
    await queue({ acknowledged: ["f0000000-0000-4000-8000-000000000001", "f0000000-0000-4000-8000-000000000002"] });
    expect(inserts).toHaveLength(1);
  });

  it("acknowledging one does not acknowledge a later one", async () => {
    const body = await refusal(build([ayseReply(), theyWroteAgain()]).queue({ acknowledged: ["f0000000-0000-4000-8000-000000000001"] }));
    expect(body.items.map((i: any) => i.direction)).toEqual(["inbound"]);
  });

  it("a name comes only from this house's members", async () => {
    const body = await refusal(
      build([ayseReply({ email_headers: { written_by: STRANGER } })], [{ user_id: STRANGER, name: "Stranger", restaurant_id: OTHER }]).queue(),
    );
    expect(body.items[0].who).toBeNull();
  });
});

describe("what is not newer, and is queued as before", () => {
  const queues = async (thread: Record<string, any>[]) => {
    const { queue, inserts } = build(thread);
    await queue();
    expect(inserts).toHaveLength(1);
  };

  it("my own reply", () => queues([ayseReply({ email_headers: { written_by: ME } })]));
  it("my own reply recorded by sent_by_user_id only", () => queues([ayseReply({ email_headers: {}, sent_by_user_id: ME })]));
  it("another's cancelled, drafted or failed letter", () =>
    queues(["HOUSE_CANCELLED", "HOUSE_DRAFT", "HOUSE_FAILED"].map((status, i) => ayseReply({ status, id: `f0000000-0000-4000-8000-00000000000${i + 3}` }))));
  it("an automatic letter (auto-submitted, or a mailer-daemon)", () =>
    queues([
      theyWroteAgain({ email_headers: { transport: { autoSubmitted: true } } }),
      theyWroteAgain({ id: "f0000000-0000-4000-8000-000000000009", from_address: "MAILER-DAEMON@x.example" }),
    ]));
  it("another house's letter on a thread of the same key", () => queues([ayseReply({ restaurant_id: OTHER })]));
  // One group price request to vendors A and B shares one mid:/gm: key; a thread is (vendor, key).
  it("another vendor's reply, and the house's letter to that vendor, on the same key", () =>
    queues([
      theyWroteAgain({ provider_id: VENDOR_B }),
      ayseReply({ provider_id: VENDOR_B, id: "f0000000-0000-4000-8000-0000000000b2" }),
    ]));
  it("a team member's or a guest's letter filed under the same key (no vendor)", () =>
    queues([theyWroteAgain({ provider_id: null, kind: "team", id: "f0000000-0000-4000-8000-0000000000b3" })]));
  it("asks only this vendor's letters in the database too", async () => {
    const { queue, threadQuery } = build([]);
    await queue();
    expect(threadQuery()!.calls).toEqual(expect.arrayContaining([["eq", "provider_id", PROVIDER]]));
  });
  it("a letter at or before the one seen, and the one seen itself", () =>
    queues([ayseReply({ created_at: SEEN.createdAt }), ayseReply({ created_at: "2026-11-27T13:00:00.000Z" })]));

  it("the letter seen is never newer than itself, even when the client's time is cut to the second", async () => {
    const { queue, inserts } = build([]);
    await queue({ seenThrough: { id: ANSWERED, createdAt: "2026-11-27T13:59:59Z" } });
    expect(inserts).toHaveLength(1);
  });

  it("a reply with no seenThrough is not asked (the old composer), and nothing is read", async () => {
    const { queue, inserts, threadQuery } = build([ayseReply()]);
    await queue({ seenThrough: undefined });
    expect(inserts).toHaveLength(1);
    expect(threadQuery()).toBeUndefined();
  });

  it("seenThrough and acknowledged are not in the seal", () => {
    const args = houseLetterSealArgs({ providerId: PROVIDER, to: "a@b.c", subject: "s", body: "b", seenThrough: SEEN, acknowledged: ["x"] } as any);
    expect(JSON.stringify(args)).not.toMatch(/seenThrough|acknowledged|14:00/);
  });
});
