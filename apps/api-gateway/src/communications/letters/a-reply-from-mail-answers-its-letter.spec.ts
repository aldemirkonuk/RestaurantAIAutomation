/**
 * r28 mail audit, gap 3: a letter can be answered from Mail.
 *
 * The composer's letters started a new thread: they carried no thread key of
 * the letter they answered and no In-Reply-To. `answers` names the house's
 * letter being answered; the queued letter joins its thread at once and
 * leaves with In-Reply-To and References.
 *
 * Queue: a by-table stub (it does not filter), so the service's own checks of
 * house and vendor are what refuse. Dispatch: the filtering fake database and
 * a stubbed fetch, as queued-letter-keeps-its-mailbox.spec.ts does.
 */
import {
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { HouseLettersService, LETTER_STATUS } from "./house-letters.service";
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

async function queue(answered: unknown[] | { error: { message: string } } | null, answers: string | null = ANSWERED) {
  const { db, inserts } = stub({ ...BOOK, procurement_conversations: answered ?? [] });
  const sender = new HouseSenderService(db, { get: () => undefined } as any);
  const oauth = { getAccessToken: jest.fn().mockResolvedValue("ya29.token") } as any;
  const svc = new HouseLettersService(db, sender, oauth, ...GATES);
  const run = svc.queue({
    restaurantId: HOUSE,
    userId: PERSON,
    dto: {
      providerId: PROVIDER,
      to: "fikri@fikritarim.com",
      subject: "Re: Order PO-12",
      body: "Thursday is fine.",
      ...(answers ? { answers } : {}),
    },
  });
  return { run, inserts };
}

describe("a reply queued from Mail names the letter it answers", () => {
  it("joins that letter's thread and carries its threading", async () => {
    const { run, inserts } = await queue([theirLetter()]);
    await run;
    expect(inserts).toHaveLength(1);
    expect(inserts[0].thread_key).toBe("gm:18c0ffee");
    expect(inserts[0].email_headers).toMatchObject({
      answers: ANSWERED,
      in_reply_to: "<v-1@fikritarim.com>",
      references: "<o-1@mail.gmail.com> <v-1@fikritarim.com>",
    });
  });

  it("a Message-ID stored without brackets is sent with them", async () => {
    const { run, inserts } = await queue([theirLetter({ message_id: "v-1@fikritarim.com", email_headers: {} })]);
    await run;
    expect(inserts[0].email_headers.in_reply_to).toBe("<v-1@fikritarim.com>");
    expect(inserts[0].email_headers.references).toBe("<v-1@fikritarim.com>");
  });

  it("a letter stored with no Message-ID gives no headers, and the reply still joins its thread", async () => {
    const { run, inserts } = await queue([theirLetter({ message_id: null, email_headers: {} })]);
    await run;
    expect(inserts[0].thread_key).toBe("gm:18c0ffee");
    expect(inserts[0].email_headers.in_reply_to).toBeNull();
    expect(inserts[0].email_headers.references).toBeNull();
  });

  it("References keep the last ten, its own id last", async () => {
    const prior = Array.from({ length: 12 }, (_, i) => `<r-${i}@x.example>`).join(" ");
    const { run, inserts } = await queue([theirLetter({ email_headers: { references: prior } })]);
    await run;
    const refs = String(inserts[0].email_headers.references).split(" ");
    expect(refs).toHaveLength(10);
    expect(refs[9]).toBe("<v-1@fikritarim.com>");
    expect(refs[0]).toBe("<r-3@x.example>");
  });

  it("a letter stored before the channel column, or marked email, is mail", async () => {
    for (const channel of [null, "email", "EMAIL"]) {
      const { run, inserts } = await queue([theirLetter({ channel })]);
      await run;
      expect(inserts[0].email_headers.in_reply_to).toBe("<v-1@fikritarim.com>");
    }
  });

  it("a sent letter of the house's own can be written to again", async () => {
    const { run, inserts } = await queue([
      theirLetter({ direction: "outbound", sent_at: "2026-11-01T10:00:00Z", message_id: "<o-2@mail.gmail.com>" }),
    ]);
    await run;
    expect(inserts[0].email_headers.in_reply_to).toBe("<o-2@mail.gmail.com>");
  });

  it("a letter that names nothing it answers is queued as before", async () => {
    const { run, inserts } = await queue([theirLetter()], null);
    await run;
    expect(inserts[0].thread_key).toBeUndefined();
    expect(inserts[0].email_headers).not.toHaveProperty("answers");
    expect(inserts[0].email_headers).not.toHaveProperty("in_reply_to");
  });
});

describe("what a reply may not answer, refused before anything is queued", () => {
  const refused = async (rows: unknown[] | { error: { message: string } }, cls: any, words: RegExp) => {
    const { run, inserts } = await queue(rows);
    await expect(run).rejects.toBeInstanceOf(cls);
    await expect(run).rejects.toThrow(words);
    expect(inserts).toHaveLength(0);
  };

  it("another vendor's letter", () =>
    refused([theirLetter({ provider_id: "ffffffff-0000-4000-8000-ffffffffffff" })], UnprocessableEntityException, /different vendor/));

  it("another house's letter", () =>
    refused([theirLetter({ restaurant_id: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb" })], UnprocessableEntityException, /not one of this house's letters/));

  it("a letter that is not there", () => refused([], UnprocessableEntityException, /not one of this house's letters/));

  it("a letter that came by WhatsApp", () =>
    refused([theirLetter({ channel: "whatsapp" })], UnprocessableEntityException, /did not come by mail/));

  it("a letter of the house's that has not left", () =>
    refused([theirLetter({ direction: "outbound", sent_at: null })], UnprocessableEntityException, /has not left the house/));

  it("a letter that could not be read", () =>
    refused({ error: { message: "timeout" } }, BadRequestException, /could not be read \(timeout\)/));
});

describe("the reply leaves with its threading", () => {
  function dispatch(headers: Record<string, unknown>) {
    const db = fakeDb({
      integration_oauth_connections: { rows: grants() },
      users: { rows: [] },
      house_mail_sender_choice: { rows: [] },
      procurement_conversations: {
        rows: [
          {
            id: "letter-1",
            restaurant_id: FAKE_HOUSE,
            provider_id: "p-1",
            status: LETTER_STATUS.QUEUED,
            scheduled_send_at: "2026-11-07T09:58:00.000Z",
            message_text: "Thursday is fine.",
            email_headers: {
              to: "vendor@vendor.test",
              subject: "Re: Order",
              written_by: ME,
              sender_connection_id: G_MINE,
              sender_address: "me@house.test",
              ...headers,
            },
          },
        ],
      },
    });
    const sender = new HouseSenderService(db as any, { get: () => undefined } as any);
    const svc = new HouseLettersService(db as any, sender, { getAccessToken: jest.fn().mockResolvedValue("t") } as any);
    const sent: string[] = [];
    (globalThis as any).fetch = jest.fn(async (_u: string, init: RequestInit) => {
      sent.push(Buffer.from(JSON.parse(String(init.body)).raw, "base64url").toString("utf8"));
      return { ok: true, status: 200, json: async () => ({ id: "g-1" }), text: async () => "" };
    });
    return { svc, sent };
  }
  const realFetch = globalThis.fetch;
  afterEach(() => {
    (globalThis as any).fetch = realFetch;
  });

  it("In-Reply-To and References are on the wire", async () => {
    const { svc, sent } = dispatch({
      answers: ANSWERED,
      in_reply_to: "<v-1@fikritarim.com>",
      references: "<o-1@mail.gmail.com> <v-1@fikritarim.com>",
    });
    expect(await svc.dispatchDue(Date.parse("2026-11-07T10:00:00Z"))).toMatchObject({ sent: 1 });
    expect(sent[0]).toContain("In-Reply-To: <v-1@fikritarim.com>");
    expect(sent[0]).toContain("References: <o-1@mail.gmail.com> <v-1@fikritarim.com>");
  });

  it("a letter that answers nothing has neither", async () => {
    const { svc, sent } = dispatch({});
    expect(await svc.dispatchDue(Date.parse("2026-11-07T10:00:00Z"))).toMatchObject({ sent: 1 });
    expect(sent[0]).not.toContain("In-Reply-To:");
    expect(sent[0]).not.toContain("References:");
  });
});
