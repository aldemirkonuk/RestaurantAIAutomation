/**
 * A letter the house writes is answered where Mail can see it, and the answer
 * finds the letter (r36 mail audit, gaps 1 and 2).
 *
 * Before: a composer letter or a "Write a reply" left from the house's own
 * Gmail with no Reply-To, so a vendor's answer went to that mailbox, which
 * is often not read; and the book kept only Gmail's message id, so the
 * answer's In-Reply-To matched nothing and the letter and its answer showed
 * as two threads.
 *
 * Now the letter carries Reply-To set to the house's Mudavym address when the
 * deployment has one, and a Message-ID minted before the send; the book keeps
 * that Message-ID and Gmail's thread id. The fake database really filters
 * (fake-db.testing.ts), and the sent MIME is decoded from the request body.
 */

import {
  HouseLettersService,
  LETTER_STATUS,
  sendThroughGrant,
  sendThroughGrantWithThread,
} from "./house-letters.service";
import { HouseSenderService } from "./house-sender.service";
import { HOUSE, ME, fakeDb, grants } from "../mail-setup/fake-db.testing";

const NOW = Date.parse("2026-11-13T10:00:00Z");
const DOOR = "r-1a2b3c4d@in.example.test";

function letter() {
  return {
    id: "letter-1",
    restaurant_id: HOUSE,
    provider_id: "p-1",
    status: LETTER_STATUS.QUEUED,
    scheduled_send_at: "2026-11-13T09:58:00.000Z",
    message_text: "Merhaba",
    email_headers: { to: "vendor@vendor.test", subject: "Price list", written_by: ME },
  };
}

function build(inbound: { addressFor: jest.Mock } | undefined) {
  const db = fakeDb({
    integration_oauth_connections: { rows: grants() },
    users: { rows: [] },
    house_mail_sender_choice: { rows: [] },
    procurement_conversations: { rows: [letter()] },
  });
  const sender = new HouseSenderService(db as any, { get: () => undefined } as any);
  const oauth = { getAccessToken: jest.fn().mockResolvedValue("ya29.token") };
  const svc = new HouseLettersService(
    db as any,
    sender,
    oauth as any,
    undefined,
    undefined,
    undefined,
    inbound as any,
  );
  const sent: string[] = [];
  (globalThis as any).fetch = jest.fn(async (_url: string, init: RequestInit) => {
    sent.push(Buffer.from(JSON.parse(String(init.body)).raw, "base64url").toString("utf8"));
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "g-msg-1", threadId: "g-thread-1" }),
      text: async () => "",
    };
  });
  return { db, svc, sent };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

const sentWrite = (db: ReturnType<typeof fakeDb>) =>
  db.writes.find((w) => w.payload?.status === LETTER_STATUS.SENT)?.payload as Record<string, any> | undefined;

const headerValue = (mime: string, name: string): string | null => {
  const line = mime.split("\r\n").find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(name.length + 1).trim() : null;
};

describe("a house letter is answered where Mail can see it", () => {
  it("carries Reply-To set to the house's Mudavym address", async () => {
    const inbound = { addressFor: jest.fn().mockResolvedValue(DOOR) };
    const { svc, sent } = build(inbound);
    expect(await svc.dispatchDue(NOW)).toMatchObject({ sent: 1, failed: 0 });
    expect(inbound.addressFor).toHaveBeenCalledWith(HOUSE);
    expect(sent).toHaveLength(1);
    expect(headerValue(sent[0], "Reply-To")).toBe(DOOR);
  });

  it("carries a Message-ID minted before the send, and the book keeps the same one", async () => {
    const { db, svc, sent } = build({ addressFor: jest.fn().mockResolvedValue(DOOR) });
    await svc.dispatchDue(NOW);
    const onWire = headerValue(sent[0], "Message-ID");
    expect(onWire).toMatch(/^<mudavym-[0-9a-f-]{36}@wineops\.ai>$/);
    const write = sentWrite(db);
    expect(write?.message_id).toBe(onWire);
    expect(write?.email_headers?.message_id).toBe(onWire);
  });

  it("keeps Gmail's thread id and message id, and the Reply-To it used", async () => {
    const { db, svc } = build({ addressFor: jest.fn().mockResolvedValue(DOOR) });
    await svc.dispatchDue(NOW);
    const write = sentWrite(db);
    expect(write?.gmail_thread_id).toBe("g-thread-1");
    expect(write?.gmail_message_id).toBe("g-msg-1");
    expect(write?.email_headers?.reply_to).toBe(DOOR);
    // The letter's own headers are kept, not replaced.
    expect(write?.email_headers?.subject).toBe("Price list");
    expect(write?.email_headers?.to).toBe("vendor@vendor.test");
  });

  it("with no Mudavym address, leaves with no Reply-To and still keeps its Message-ID", async () => {
    const { db, svc, sent } = build({ addressFor: jest.fn().mockResolvedValue(null) });
    expect(await svc.dispatchDue(NOW)).toMatchObject({ sent: 1 });
    expect(headerValue(sent[0], "Reply-To")).toBeNull();
    expect(headerValue(sent[0], "Message-ID")).toMatch(/^<mudavym-/);
    const write = sentWrite(db);
    expect(write?.email_headers).not.toHaveProperty("reply_to");
    expect(write?.message_id).toMatch(/^<mudavym-/);
  });

  it("an address that could not be read never stops the letter", async () => {
    const { db, svc, sent } = build({ addressFor: jest.fn().mockRejectedValue(new Error("timeout")) });
    expect(await svc.dispatchDue(NOW)).toMatchObject({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(headerValue(sent[0], "Reply-To")).toBeNull();
    expect(sentWrite(db)?.status).toBe(LETTER_STATUS.SENT);
  });

  it("a house built without the address service sends as before", async () => {
    const { svc, sent } = build(undefined);
    expect(await svc.dispatchDue(NOW)).toMatchObject({ sent: 1 });
    expect(headerValue(sent[0], "Reply-To")).toBeNull();
  });
});

describe("sendThroughGrantWithThread", () => {
  const ok = (body: unknown) =>
    jest.fn(async () => ({ ok: true, status: 200, json: async () => body, text: async () => "" }));

  it("returns Gmail's message id and thread id", async () => {
    const out = await sendThroughGrantWithThread({
      token: "t",
      from: "",
      to: "v@vendor.test",
      subject: "s",
      text: "b",
      fetchImpl: ok({ id: "m-1", threadId: "t-1" }) as any,
    });
    expect(out).toEqual({ id: "m-1", threadId: "t-1" });
  });

  it("a reply with no thread id says null, never a blank", async () => {
    const out = await sendThroughGrantWithThread({
      token: "t",
      from: "",
      to: "v@vendor.test",
      subject: "s",
      text: "b",
      fetchImpl: ok({ id: "m-1", threadId: "" }) as any,
    });
    expect(out).toEqual({ id: "m-1", threadId: null });
  });

  it("sendThroughGrant still answers with the message id alone", async () => {
    const id = await sendThroughGrant({
      token: "t",
      from: "",
      to: "v@vendor.test",
      subject: "s",
      text: "b",
      fetchImpl: ok({ id: "m-1", threadId: "t-1" }) as any,
    });
    expect(id).toBe("m-1");
  });

  it("refuses a Message-ID with a line break before anything is sent", async () => {
    const fetchImpl = ok({ id: "m-1" });
    await expect(
      sendThroughGrantWithThread({
        token: "t",
        from: "",
        to: "v@vendor.test",
        subject: "s",
        text: "b",
        messageId: "<a@b>\r\nBcc: x@y.test",
        fetchImpl: fetchImpl as any,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
