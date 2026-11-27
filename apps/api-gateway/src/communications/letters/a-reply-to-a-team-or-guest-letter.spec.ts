/**
 * r104 mail-gap g1 (ADR 0396): a team or guest letter can be answered from Mail.
 *
 * The composer only wrote to the vendor book. A reply with no `providerId` is
 * allowed for exactly one address: the one that wrote the letter it answers,
 * on that thread, for an owner or a manager, through the same guardrails,
 * sender line and seal. Nothing is free-typed. By-table stub, as
 * a-reply-from-mail-answers-its-letter.spec.ts: the service's own checks refuse.
 */
import {
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { HouseLettersService } from "./house-letters.service";
import { HouseSenderService, GMAIL_SEND_SCOPE } from "./house-sender.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";
const ANSWERED = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const GUEST = "jane@x.example";

const redeem = jest.fn(async (_: unknown) => ({ sealId: "seal-1" }));
const GATES = [
  {
    assertMaySend: async () => ({
      mode: "send",
      basis: "manager",
      grant: null,
      role: "manager",
    }),
    readout: async () => ({
      readable: true,
      maySend: true,
      mode: "send",
      basis: "manager",
      grant: null,
      sentence: null,
    }),
    witnessGrantUse: async () => undefined,
  },
  { redeem, issue: async () => ({}) },
] as [any, any];

function stub(rows: Record<string, unknown[]>, threadRows?: unknown[]) {
  const inserts: Record<string, any>[] = [];
  const chain = (table: string, all: unknown[]) => {
    let data = all;
    const self: any = {};
    // The thread read (eq thread_key) is the one place the table answers with
    // the thread's newest-first letters rather than the single letter asked for.
    self.eq = (col: string) => {
      if (col === "thread_key" && threadRows && table === "procurement_conversations") data = threadRows;
      return self;
    };
    for (const m of [
      "select",
      "in",
      "is",
      "or",
      "lte",
      "gte",
      "order",
      "limit",
      "update",
    ])
      self[m] = () => self;
    self.insert = (body: Record<string, any>) => (inserts.push(body), self);
    self.single = () =>
      Promise.resolve({ data: { id: "letter-1" }, error: null });
    self.maybeSingle = () =>
      Promise.resolve({ data: data[0] ?? null, error: null });
    self.then = (res: any) => Promise.resolve({ data, error: null }).then(res);
    return self;
  };
  return {
    db: { client: { from: (t: string) => chain(t, rows[t] ?? []) } } as any,
    inserts,
  };
}

const GRANT = {
  id: "conn-1",
  user_id: PERSON,
  integration_id: "gmail_send",
  provider: "google",
  account_email: "siparis@lokanta.example",
  scopes: [GMAIL_SEND_SCOPE, "openid"],
  restaurant_id: HOUSE,
  revoked_at: null,
};

const theirLetter = (o: Record<string, unknown> = {}) => ({
  id: ANSWERED,
  restaurant_id: HOUSE,
  provider_id: null,
  kind: "guest",
  from_address: GUEST,
  direction: "inbound",
  sent_at: null,
  message_id: "<g-1@x.example>",
  thread_key: "gm:18c0g1",
  email_headers: {},
  ...o,
});

function run(
  answered: unknown[],
  over: {
    to?: string;
    role?: string | null;
    dto?: Record<string, unknown>;
    thread?: unknown[];
  } = {},
) {
  const { db, inserts } = stub(
    {
      providers: [],
      provider_contacts: [],
      analytics_insights: [],
      integration_oauth_connections: [GRANT],
      procurement_conversations: answered,
    },
    over.thread,
  );
  const sender = new HouseSenderService(db, { get: () => undefined } as any);
  const oauth = {
    getAccessToken: jest.fn().mockResolvedValue("ya29.token"),
  } as any;
  const svc = new HouseLettersService(db, sender, oauth, ...GATES);
  const p = svc.queue({
    restaurantId: HOUSE,
    userId: PERSON,
    role: over.role === undefined ? "owner" : over.role,
    dto: {
      to: over.to ?? GUEST,
      subject: "Re: A table for four",
      body: "Yes, Friday at eight works.",
      answers: ANSWERED,
      ...over.dto,
    } as any,
  });
  return { p, inserts };
}

beforeEach(() => redeem.mockClear());

describe("a reply to a guest or a team letter", () => {
  it("goes to the address that wrote, on that thread, filed under that person", async () => {
    const { p, inserts } = run([theirLetter()]);
    await p;
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      provider_id: null,
      kind: "guest",
      from_address: GUEST,
      direction: "outbound",
      thread_key: "gm:18c0g1",
    });
    expect(inserts[0].email_headers).toMatchObject({
      to: GUEST,
      answers: ANSWERED,
      in_reply_to: "<g-1@x.example>",
    });
  });

  it("takes the same address in another case, and files it as stored", async () => {
    const { p, inserts } = run([theirLetter()], { to: "Jane@X.Example" });
    await p;
    expect(inserts[0].email_headers.to).toBe(GUEST);
  });

  it("answers a team letter the same way", async () => {
    const { p, inserts } = run(
      [theirLetter({ kind: "team", from_address: "deniz@h.example" })],
      { to: "deniz@h.example" },
    );
    await p;
    expect(inserts[0]).toMatchObject({
      kind: "team",
      from_address: "deniz@h.example",
      provider_id: null,
    });
  });

  it("is sealed over the letter it answers, and the hold names it", async () => {
    const { p } = run([theirLetter()]);
    await p;
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(redeem.mock.calls[0][0]).toMatchObject({
      subjectId: ANSWERED,
      args: { providerId: null, to: GUEST, answers: ANSWERED },
    });
  });
});

describe("what it may not do, refused before anything is queued", () => {
  const refused = async (
    answered: unknown[],
    cls: any,
    words: RegExp,
    over: Parameters<typeof run>[1] = {},
  ) => {
    const { p, inserts } = run(answered, over);
    await expect(p).rejects.toBeInstanceOf(cls);
    await expect(p).rejects.toThrow(words);
    expect(inserts).toHaveLength(0);
  };

  it("an address other than the one that wrote", () =>
    refused(
      [theirLetter()],
      UnprocessableEntityException,
      /address that wrote/,
      { to: "someone@elsewhere.example" },
    ));

  it("another address at the same domain", () =>
    refused(
      [theirLetter()],
      UnprocessableEntityException,
      /address that wrote/,
      { to: "jane2@x.example" },
    ));

  it("a vendor's letter (it is answered to its vendor)", () =>
    refused(
      [
        theirLetter({
          provider_id: "cccccccc-0000-4000-8000-cccccccccccc",
          kind: "vendor",
        }),
      ],
      UnprocessableEntityException,
      /a vendor's/,
    ));

  it("another house's letter", () =>
    refused(
      [theirLetter({ restaurant_id: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb" })],
      UnprocessableEntityException,
      /not one of this house's letters/,
    ));

  it("a letter that is not there", () =>
    refused(
      [],
      UnprocessableEntityException,
      /not one of this house's letters/,
    ));

  it("anyone but an owner or a manager, and a token with no role", async () => {
    await refused([theirLetter()], ForbiddenException, /owner or a manager/, {
      role: "staff",
    });
    await refused([theirLetter()], ForbiddenException, /owner or a manager/, {
      role: null,
    });
  });

  it("a letter that names no letter it answers", () =>
    refused(
      [theirLetter()],
      UnprocessableEntityException,
      /only answer a letter the house received/,
      { dto: { answers: undefined } },
    ));

  it("a draft, an order or a request carried along", async () => {
    for (const extra of [
      { draftId: "ffffffff-0000-4000-8000-ffffffffffff" },
      { orderId: "ffffffff-0000-4000-8000-ffffffffffff" },
      { requestId: "ffffffff-0000-4000-8000-ffffffffffff" },
    ]) {
      await refused(
        [theirLetter()],
        UnprocessableEntityException,
        /only answer a letter the house received/,
        { dto: extra },
      );
    }
  });

  it("a staff member's ask, which has no vendor to ask a manager about", async () => {
    const { db } = stub({});
    const svc = new HouseLettersService(
      db,
      new HouseSenderService(db, { get: () => undefined } as any),
      {} as any,
      ...GATES,
    );
    await expect(
      svc.ask({
        restaurantId: HOUSE,
        userId: PERSON,
        dto: { to: GUEST, subject: "s", body: "b", answers: ANSWERED } as any,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  // ADR 0396 / DD-r104-23: the exception is for the stored sender of the
  // thread's newest inbound letter that a person wrote, never an automatic one.
  it("a thread with only automatic mail on it (auto-submitted, or from a mailer-daemon)", async () => {
    const bounce = theirLetter({
      from_address: "mailer-daemon@x.example",
      email_headers: { from: "Mail Delivery Subsystem <mailer-daemon@x.example>" },
    });
    await refused([bounce], UnprocessableEntityException, /only automatic mail/, {
      to: "mailer-daemon@x.example",
      thread: [bounce],
    });
    const auto = theirLetter({ email_headers: { transport: { autoSubmitted: true } } });
    await refused([auto], UnprocessableEntityException, /only automatic mail/, {
      thread: [auto],
    });
  });

  it("an address that wrote an older letter, once another person wrote the newest", () =>
    refused(
      [theirLetter()],
      UnprocessableEntityException,
      /newest letter a person sent/,
      {
        thread: [
          theirLetter({ id: "newer-1", from_address: "bob@y.example" }),
          theirLetter(),
        ],
      },
    ));

  it("a newest person-written letter that is another house's", () =>
    refused(
      [theirLetter()],
      UnprocessableEntityException,
      /only automatic mail/,
      {
        thread: [
          theirLetter({ restaurant_id: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb" }),
        ],
      },
    ));

  it("is allowed at the sender of the newest person-written letter, skipping an automatic one after it", async () => {
    const { p, inserts } = run([theirLetter()], {
      thread: [
        theirLetter({ id: "auto-1", from_address: "mailer-daemon@x.example" }),
        theirLetter(),
      ],
    });
    await p;
    expect(inserts.length).toBeGreaterThan(0);
  });
});
