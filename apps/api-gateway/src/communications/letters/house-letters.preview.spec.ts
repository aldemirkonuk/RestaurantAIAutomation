/**
 * r109 mail-gap g6: "See it as it leaves". `preview` shows the header block and the body of the
 * letter the composer holds, built by the same `buildLetterHeaders` the send calls. It queues
 * nothing, redeems no seal, claims no request and writes no row; it holds the same guards as `queue`.
 */
import { ConflictException, ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { HouseLettersService } from "./house-letters.service";
import { buildLetterHeaders } from "../mime-headers";
import { HouseSenderService, GMAIL_SEND_SCOPE } from "./house-sender.service";
import {
  HOUSE as FAKE_HOUSE,
  ME,
  G_MINE,
  fakeDb,
  grants,
} from "../mail-setup/fake-db.testing";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PROVIDER = "cccccccc-0000-4000-8000-cccccccccccc";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";
const ANSWERED = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";

const GATES = [
  {
    assertMaySend: async () => ({ mode: "send", basis: "manager", grant: null, role: "manager" }),
    readout: async () => ({ readable: true, maySend: true, mode: "send", basis: "manager", grant: null, sentence: null }),
    witnessGrantUse: async () => undefined,
  },
  { redeem: async () => ({ sealId: "seal-1" }), issue: async () => ({}) },
] as [any, any];

function stub(rows: Record<string, unknown[] | { error: { message: string } }>) {
  const inserts: Record<string, any>[] = [];
  const chain = (payload: unknown[] | { error: { message: string } }) => {
    const data = Array.isArray(payload) ? payload : null;
    const error = Array.isArray(payload) ? null : payload.error;
    const self: any = {};
    for (const m of ["select", "eq", "in", "is", "or", "lte", "gte", "order", "limit", "update"])
      self[m] = () => self;
    self.insert = (body: Record<string, any>) => (inserts.push(body), self);
    self.single = () => Promise.resolve({ data: { id: "letter-1" }, error: null });
    self.maybeSingle = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.then = (res: any) => Promise.resolve({ data, error }).then(res);
    return self;
  };
  const db = { client: { from: (t: string) => chain(rows[t] ?? []) } } as any;
  return { db, inserts };
}

const BOOK = {
  providers: [{ id: PROVIDER, name: "Fikri", contact_email: "fikri@fikritarim.com", primary_contact: null }],
  provider_contacts: [],
  analytics_insights: [],
  integration_oauth_connections: [
    {
      id: "conn-1",
      user_id: PERSON,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "siparis@lokanta.example",
      scopes: [GMAIL_SEND_SCOPE, "openid"],
      restaurant_id: HOUSE,
      revoked_at: null,
    },
  ],
};

const theirLetter = (o: Record<string, unknown> = {}) => ({
  id: ANSWERED,
  restaurant_id: HOUSE,
  provider_id: PROVIDER,
  direction: "inbound",
  sent_at: null,
  message_id: "<v-1@fikritarim.com>",
  thread_key: "gm:18c0ffee",
  email_headers: { references: "<o-1@mail.gmail.com>" },
  ...o,
});


const SEAL = jest.fn(async () => ({ sealId: "seal-1" }));
const gates = (assertMaySend: () => Promise<unknown> = GATES[0].assertMaySend): [any, any] => [
  { ...GATES[0], assertMaySend },
  { redeem: SEAL, issue: async () => ({}) },
];

function preview(
  answered: unknown[],
  dto: Record<string, unknown> = {},
  opts: { role?: string; assertMaySend?: () => Promise<unknown>; book?: Record<string, unknown[]> } = {},
) {
  const { db, inserts } = stub({ ...BOOK, ...(opts.book ?? {}), procurement_conversations: answered });
  const sender = new HouseSenderService(db, { get: () => undefined } as any);
  const getAccessToken = jest.fn().mockResolvedValue("ya29.token");
  const svc = new HouseLettersService(db, sender, { getAccessToken } as any, ...gates(opts.assertMaySend));
  const run = svc.preview({
    restaurantId: HOUSE,
    userId: PERSON,
    role: opts.role ?? "manager",
    dto: {
      providerId: PROVIDER,
      to: "fikri@fikritarim.com",
      subject: "Re: Order PO-12",
      body: "Thursday is fine.",
      answers: ANSWERED,
      ...dto,
    } as any,
  });
  return { run, inserts, getAccessToken };
}

describe("See it as it leaves: the headers and body the send would write", () => {
  beforeEach(() => SEAL.mockClear());

  it("shows From (the mailbox), To, Subject, the letter it answers and the body as sent", async () => {
    const { run } = preview([theirLetter({ received_at: "2026-11-20T09:30:00Z" })]);
    await expect(run).resolves.toEqual({
      from: { name: null, address: "siparis@lokanta.example" },
      to: "fikri@fikritarim.com",
      replyTo: null,
      subject: "Re: Order PO-12",
      inReplyTo: "<v-1@fikritarim.com>",
      answersAt: "2026-11-20T09:30:00Z",
      body: "Thursday is fine.",
    });
  });

  it("a new letter answers nothing: no In-Reply-To, no date", async () => {
    const { run } = preview([], { answers: undefined });
    const seen = await run;
    expect(seen.inReplyTo).toBeNull();
    expect(seen.answersAt).toBeNull();
  });

  it("queues nothing, redeems no seal and touches no mailbox token", async () => {
    const { run, inserts, getAccessToken } = preview([theirLetter()]);
    await run;
    expect(inserts).toHaveLength(0);
    expect(SEAL).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("a header the builder refuses gets the sentence the send would give", async () => {
    const badMailbox = [{ ...BOOK.integration_oauth_connections[0], account_email: "house<x>@lokanta.example" }];
    let expected = "";
    try {
      buildLetterHeaders({ from: "house<x>@lokanta.example", to: "fikri@fikritarim.com", subject: "s" });
    } catch (e) {
      expected = (e as Error).message;
    }
    expect(expected).not.toBe("");
    const { run, inserts } = preview([theirLetter()], {}, { book: { integration_oauth_connections: badMailbox } });
    await expect(run).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(run).rejects.toThrow(expected);
    await expect(run).rejects.toThrow(/Nothing was queued and nothing was sent/);
    expect(inserts).toHaveLength(0);
  });

  it("holds the guards queue holds: WHO may send", async () => {
    const { run } = preview([theirLetter()], {}, {
      assertMaySend: async () => {
        throw new ForbiddenException("not yours to send");
      },
    });
    await expect(run).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("holds the guards queue holds: a letter to a person is for an owner or a manager", async () => {
    const { run } = preview([], { providerId: undefined, answers: ANSWERED }, { role: "staff" });
    await expect(run).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("holds the guards queue holds: the recipient must be in the book", async () => {
    const { run } = preview([theirLetter()], { to: "stranger@elsewhere.example" });
    await expect(run).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("holds the guards queue holds: the house must have a sending identity", async () => {
    const { run } = preview([theirLetter()], {}, { book: { integration_oauth_connections: [] } });
    await expect(run).rejects.toBeInstanceOf(ConflictException);
  });

  it("holds the guards queue holds: the letter answered must be this house's", async () => {
    const { run } = preview([theirLetter({ restaurant_id: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb" })]);
    await expect(run).rejects.toThrow(/not one of this house's letters/);
  });
});

describe("buildLetterHeaders: the one header block send and preview share", () => {
  it("writes From only when the address is known, then To, Subject, then the threading", () => {
    expect(
      buildLetterHeaders({ from: "", to: "a@b.example", subject: "Hi", inReplyTo: "<x@y>", references: "<w@y> <x@y>" }),
    ).toEqual(["To: a@b.example", "Subject: Hi", "In-Reply-To: <x@y>", "References: <w@y> <x@y>"]);
    expect(buildLetterHeaders({ from: "me@h.example", to: ["a@b.example"], subject: "Hi" })[0]).toBe("From: me@h.example");
  });

  it("writes Cc, Bcc and Reply-To between Subject and the threading when they are given", () => {
    expect(
      buildLetterHeaders({
        to: "a@b.example",
        cc: ["c@b.example"],
        bcc: ["d@b.example"],
        subject: "Hi",
        replyTo: "r@b.example",
      }),
    ).toEqual(["To: a@b.example", "Cc: c@b.example", "Bcc: d@b.example", "Subject: Hi", "Reply-To: r@b.example"]);
  });
});
