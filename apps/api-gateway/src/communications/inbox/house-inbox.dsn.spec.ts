/**
 * A house letter that did not arrive says so (r109 mail-gap g1). The reader
 * asks Gmail a second, bounded question, `from:(mailer-daemon OR postmaster)
 * after:<cursor>`, and keeps a notice only when (a) it came through this
 * house's grant, (b) Gmail's topmost Authentication-Results passes it, and
 * (c) it names a letter this restaurant sent. What is pinned:
 *
 *   - the query, and that a kept notice marks the letter and is never filed;
 *   - a notice about another house's letter, an unchecked or forged sender,
 *     a notice with no Message-ID, and a sender that is not a mail daemon are
 *     each dropped before any row is read or written;
 *   - a delay says delayed, and never undoes a failure;
 *   - the Message-ID is found in message/rfc822, text/rfc822-headers or In-Reply-To;
 *   - a notice that cannot be written stops the run with the cursor unmoved,
 *     and a recorded one lets the cursor pass it.
 */

import { DatabaseService } from "../../database/database.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { OrchestratorService } from "../../common/orchestrator/orchestrator.service";
import { HouseLettersService } from "../letters/house-letters.service";
import { HouseSenderService } from "../letters/house-sender.service";
import { HouseInboxService, GMAIL_READ_SCOPE } from "./house-inbox.service";
import { deliveryMark, parseNotice, replacesMark } from "./house-inbox.dsn";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const CURSOR = 1_700_000_000_000;
const AT = CURSOR + 120_000;
const OUR_ID = "<mudavym-1@wineops.ai>";
const GOOGLE_AUTH =
  "mx.google.com; dkim=pass header.i=@googlemail.com header.s=20230601; spf=pass (google.com: domain of postmaster@mail-sor-f69.google.com designates 209.85.220.69 as permitted sender) smtp.mailfrom=; dmarc=pass (p=QUARANTINE) header.from=googlemail.com";

type Row = Record<string, unknown>;
interface Write {
  table: string;
  body: Row;
  filters: Array<[string, unknown]>;
}

/** A supabase-shaped stub that honours eq/in on procurement_conversations, so the house bound is real. */
function build(rows: Record<string, Row[] | { error: { message: string } }>, failWrite = false) {
  const reads: string[] = [];
  const updates: Write[] = [];
  const inserts: Write[] = [];
  const chain = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let updating: Row | null = null;
    const self: Record<string, unknown> = {};
    const pass = () => self;
    Object.assign(self, { select: pass, is: pass, or: pass, lte: pass, gte: pass, order: pass, limit: pass });
    self.eq = (c: string, v: unknown) => (filters.push([c, v]), self);
    self.in = (c: string, v: unknown[]) => (filters.push([c, v]), self);
    self.insert = (body: Row) => (inserts.push({ table, body, filters }), self);
    self.update = (body: Row) => ((updating = body), updates.push({ table, body, filters }), self);
    const result = () => {
      const src = rows[table] ?? [];
      if (!Array.isArray(src)) return { data: null, error: src.error };
      if (updating && table === "procurement_conversations" && failWrite) return { data: null, error: { message: "connection reset" } };
      const data =
        table === "procurement_conversations"
          ? src.filter((r) => filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)))
          : src;
      if (!updating) reads.push(table);
      return { data, error: null };
    };
    self.single = () => Promise.resolve(result()).then((r) => ({ ...r, data: r.data?.[0] ?? null }));
    self.maybeSingle = self.single;
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return self;
  };
  const db = { client: { from: (t: string) => chain(t) } } as unknown as DatabaseService;
  return { db, reads, updates, inserts };
}

const b64 = (t: string) => Buffer.from(t, "utf-8").toString("base64url");
const STATUS_FAILED =
  "Reporting-MTA: dns; googlemail.com\r\n\r\nFinal-Recipient: rfc822; v@x.com\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does\r\n not exist.\r\n";
const STATUS_DELAYED =
  "Reporting-MTA: dns; googlemail.com\r\n\r\nFinal-Recipient: rfc822; v@x.com\r\nAction: delayed\r\nStatus: 4.4.7\r\n";

function notice(o: {
  id?: string;
  from?: string;
  auth?: string[];
  status?: string;
  original?: "rfc822" | "headers" | "in-reply-to" | "none";
  at?: number;
} = {}) {
  const original = o.original ?? "rfc822";
  const parts: Row[] = [
    { mimeType: "text/plain", body: { data: b64("Address not found") } },
    { mimeType: "message/delivery-status", body: { data: b64(o.status ?? STATUS_FAILED) } },
  ];
  if (original === "rfc822")
    parts.push({ mimeType: "message/rfc822", parts: [{ mimeType: "text/plain", headers: [{ name: "Message-ID", value: OUR_ID }, { name: "Subject", value: "Friday order" }] }] });
  if (original === "headers")
    parts.push({ mimeType: "text/rfc822-headers", body: { data: b64(`From: siparis@house.example\r\nMessage-ID:\r\n ${OUR_ID}\r\nSubject: Friday order\r\n`) } });
  return {
    id: o.id ?? "n1",
    threadId: "t1",
    internalDate: String(o.at ?? AT),
    payload: {
      mimeType: "multipart/report",
      headers: [
        ...(o.auth ?? [GOOGLE_AUTH]).map((value) => ({ name: "Authentication-Results", value })),
        { name: "From", value: o.from ?? "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
        { name: "Subject", value: "Delivery Status Notification (Failure)" },
        ...(original === "in-reply-to" ? [{ name: "In-Reply-To", value: OUR_ID }] : []),
      ],
      parts,
    },
  };
}

function gmail(messages: Row[]) {
  const urls: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    const q = url.includes("/messages?") ? new URL(url).searchParams.get("q") ?? "" : "";
    if (url.includes("/messages?"))
      return { ok: true, status: 200, json: async () => ({ messages: q.startsWith("from:(mailer-daemon") ? messages.map((m) => ({ id: m.id })) : [] }) };
    const id = /\/messages\/([^?/]+)/.exec(url)?.[1] ?? "";
    return { ok: true, status: 200, json: async () => messages.find((m) => m.id === id) ?? null };
  }) as unknown as typeof fetch;
  return { urls, impl };
}

const LETTER = { id: "L1", restaurant_id: HOUSE, direction: "outbound", message_id: OUR_ID, sent_at: new Date(CURSOR + 60_000).toISOString(), email_headers: { subject: "Friday order" } };

function rows(letters: Row[]) {
  return {
    integration_oauth_connections: [
      { id: GRANT, user_id: "dddddddd-0000-4000-8000-dddddddddddd", restaurant_id: HOUSE, integration_id: "gmail_read", provider: "google", scopes: [GMAIL_READ_SCOPE], revoked_at: null },
    ],
    restaurant_feature_flags: [{ enable_house_inbox_read: true }],
    providers: [{ id: "cccccccc-0000-4000-8000-cccccccccccc", name: "Bodega", contact_email: "orders@bodega.example", primary_contact: null }],
    provider_contacts: [],
    house_inbox_cursors: [{ last_internal_date: CURSOR }],
    procurement_conversations: letters,
  };
}

async function run(letters: Row[], messages: Row[], failWrite = false) {
  const t = build(rows(letters), failWrite);
  const publish = jest.fn().mockResolvedValue(undefined);
  const oauth = { getAccessToken: jest.fn().mockResolvedValue("ya29.token") } as unknown as IntegrationsOauthService;
  const letterSvc = new HouseLettersService(t.db, new HouseSenderService(t.db, { get: () => undefined } as never), oauth);
  const service = new HouseInboxService(t.db, { publishEvent: publish } as unknown as OrchestratorService, oauth, letterSvc);
  const g = gmail(messages);
  service.fetchImpl = g.impl;
  const out = await service.readDue(CURSOR + 300_000);
  const marks = t.updates.filter((u) => u.table === "procurement_conversations");
  const cursor = t.updates.filter((u) => u.table === "house_inbox_cursors").map((u) => u.body.last_internal_date);
  return { ...t, out, publish, urls: g.urls, marks, cursor };
}

describe("the second query asks for delivery notices only", () => {
  it("a notice about this house's letter marks that letter, and is never filed as one", async () => {
    const r = await run([LETTER], [notice()]);
    const asked = r.urls.filter((u) => u.includes("/messages?")).map((u) => new URL(u).searchParams.get("q"));
    expect(asked).toContain("from:(mailer-daemon OR postmaster) after:1700000000");
    expect(r.marks).toHaveLength(1);
    expect(r.marks[0].filters).toEqual(expect.arrayContaining([["id", "L1"], ["restaurant_id", HOUSE]]));
    expect(r.marks[0].body.email_headers).toEqual({
      subject: "Friday order",
      delivery: {
        state: "did_not_arrive",
        at: new Date(AT).toISOString(),
        recipient: "v@x.com",
        status: "5.1.1",
        said: "550-5.1.1 The email account that you tried to reach does not exist.",
      },
    });
    expect(r.publish).not.toHaveBeenCalled();
    expect(r.inserts.filter((i) => i.table === "procurement_conversations")).toHaveLength(0);
    // Recorded, so the cursor may pass it.
    expect(r.cursor).toEqual([AT]);
  });
});

describe("anything else is dropped unrecorded", () => {
  it("a notice about another house's letter writes nothing", async () => {
    const r = await run([{ ...LETTER, restaurant_id: OTHER }], [notice()]);
    expect(r.marks).toHaveLength(0);
  });

  it.each([
    ["no Authentication-Results", []],
    ["one written by another server", ["evil.example; dmarc=pass header.from=googlemail.com"]],
    ["a passing one under Gmail's failing one", ["mx.google.com; spf=fail; dkim=fail; dmarc=fail", GOOGLE_AUTH]],
  ])("a sender with %s is never read further", async (_label, auth) => {
    const r = await run([LETTER], [notice({ auth: auth as string[] })]);
    expect(r.marks).toHaveLength(0);
    expect(r.reads).not.toContain("procurement_conversations");
  });

  it("a checked sender that is not a mail daemon is dropped", async () => {
    const r = await run([LETTER], [notice({ from: "Bodega <orders@bodega.example>", auth: ["mx.google.com; dkim=pass header.i=@bodega.example; dmarc=pass"] })]);
    expect(r.marks).toHaveLength(0);
    expect(r.reads).not.toContain("procurement_conversations");
  });

  it("a notice that names no letter reads nothing and writes nothing", async () => {
    const r = await run([LETTER], [notice({ original: "none" })]);
    expect(r.marks).toHaveLength(0);
    expect(r.reads).not.toContain("procurement_conversations");
  });

  it("a notice older than the letter it names is not believed", async () => {
    const r = await run([{ ...LETTER, sent_at: new Date(AT + 1).toISOString() }], [notice()]);
    expect(r.marks).toHaveLength(0);
  });
});

describe("where the letter's Message-ID is found", () => {
  it.each(["headers", "in-reply-to"] as const)("from %s", async (original) => {
    const r = await run([{ ...LETTER, message_id: "mudavym-1@wineops.ai" }], [notice({ original })]);
    expect(r.marks).toHaveLength(1);
  });
});

describe("delayed is not refused", () => {
  it("a 4.x.x notice says delayed", async () => {
    const r = await run([LETTER], [notice({ status: STATUS_DELAYED })]);
    expect((r.marks[0].body.email_headers as Row).delivery).toMatchObject({ state: "delayed", status: "4.4.7" });
  });

  it("a delay never undoes a failure, and the same mark is not written twice", async () => {
    const failed = deliveryMark(parseNotice(notice().payload as never, notice().payload.headers)!, AT)!;
    const r = await run([{ ...LETTER, email_headers: { delivery: failed } }], [notice({ id: "n2", status: STATUS_DELAYED, at: AT + 60_000 })]);
    expect(r.marks).toHaveLength(0);
    expect(replacesMark(failed, failed)).toBe(false);
    expect(replacesMark({ state: "delayed", status: "4.4.7" }, failed)).toBe(true);
  });

});

describe("the cursor", () => {
  it("a notice that cannot be written stops the run where it was", async () => {
    const r = await run([LETTER], [notice()], true);
    expect(r.out.outcomes[0].outcome).toBe("error");
    expect(r.cursor).toEqual([CURSOR]);
  });

  it("a dropped notice is passed: it will never be kept", async () => {
    const r = await run([], [notice()]);
    expect(r.marks).toHaveLength(0);
    expect(r.cursor).toEqual([AT]);
  });
});
