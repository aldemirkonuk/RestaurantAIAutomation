/**
 * onboarding-r110-g1 — an invoice the house's own owner or manager forwards
 * to the house's inbound address lands on Receipts; everyone else keeps
 * today's path (prospect capture or "not leaded").
 */
import { RabbitMqBridgeService } from "./rabbitmq-bridge.service";
import { aligned, senderAuthenticated } from "./inbound-member-forward";
import { MemberForwardIntakeService } from "../../procurement/documents/member-forward-intake.service";
import { DocumentIntakeService } from "../../procurement/documents/document-intake.service";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER_HOUSE = "99999999-9999-4999-8999-999999999999";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const PDF = Buffer.from("%PDF-1.4 invoice 42").toString("base64");
const PDF2 = Buffer.from("%PDF-1.4 credit note 7").toString("base64");
const attachments = [
  { filename: "invoice-42.pdf", mime_type: "application/pdf", data: PDF },
  { filename: "logo.png", mime_type: "image/png", data: PDF },
  { filename: "credit-7.pdf", mime_type: "application/pdf", data: PDF2 },
];

/** Postmark's own verdicts: SPF pass for the envelope sender's domain. */
const spfPass = (envelope: string) => ({
  "received-spf": `Pass (sender SPF authorized) identity=mailfrom; client-ip=209.85.160.180; envelope-from=${envelope}; receiver=inbound.test`,
});

type Row = Record<string, any>;
interface World {
  users: Row[];
  access: Row[];
}

/** A supabase client that filters rows by the calls the bridge makes. */
function client(world: World) {
  const chains: Array<{ table: string; calls: any[][] }> = [];
  const from = (table: string) => {
    const calls: any[][] = [];
    chains.push({ table, calls });
    const rows = (): Row[] => {
      let r =
        table === "users"
          ? world.users
          : table === "user_restaurant_access"
            ? world.access
            : [];
      for (const [op, col, val] of calls) {
        if (op === "eq") r = r.filter((x) => x[col] === val);
        if (op === "in") r = r.filter((x) => (val as any[]).includes(x[col]));
        if (op === "ilike")
          r = r.filter(
            (x) =>
              String(x[col]).toLowerCase() ===
              String(val).replace(/\\(.)/g, "$1").toLowerCase(),
          );
      }
      return r;
    };
    const chain: any = {};
    for (const op of ["select", "eq", "in", "ilike", "limit", "order"]) {
      chain[op] = (...args: any[]) => {
        calls.push([op, ...args]);
        return chain;
      };
    }
    chain.then = (res: any, rej: any) =>
      Promise.resolve({ data: rows(), error: null }).then(res, rej);
    return chain;
  };
  return { from, chains };
}

function setup(world: Partial<World> = {}) {
  const full: World = {
    users: [
      {
        user_id: OWNER,
        email: "Owner@Gmail.com",
        email_verified: true,
      },
    ],
    access: [
      {
        user_id: OWNER,
        restaurant_id: HOUSE,
        role: "owner",
        is_active: true,
        valid_from: "2026-01-01T00:00:00Z",
        valid_until: null,
      },
    ],
    ...world,
  };
  const db = client(full);
  const prospects = {
    domainOf: (e: string) => e.split("@")[1],
    captureFromColdEmail: jest.fn(async () => ({ captured: false })),
  };
  const bridge = new RabbitMqBridgeService(
    { get: () => undefined } as any,
    { emitRestaurantNotification: jest.fn() } as any,
    { supabase: { from: db.from } } as any,
    { persistManagerNotification: jest.fn() } as any,
    { extractAndStore: jest.fn() } as any,
    prospects as any,
  );
  (bridge as any).persistProspectAttachments = jest.fn(async () => []);
  const seen = new Map<string, string>();
  const ingest = jest.fn(async (input: any) => {
    const sha = require("crypto")
      .createHash("sha256")
      .update(input.buffer)
      .digest("hex");
    const dup = seen.has(sha);
    if (!dup) seen.set(sha, `doc-${seen.size + 1}`);
    return { documentId: seen.get(sha)!, parsed: null, duplicate: dup };
  });
  new MemberForwardIntakeService(bridge, { ingest } as any);
  const deliver = (over: Record<string, any> = {}) =>
    (bridge as any).handleInboundEmail({
      payload: {
        from: "The Owner <owner@gmail.com>",
        subject: "Fwd: Invoice 42",
        body: "see attached",
        attachments,
        message_id_header: "<m-1@mail.gmail.com>",
        headers: spfPass("owner@gmail.com"),
        source: "inbound-domain",
        restaurant_id: HOUSE,
        ...over,
      },
    });
  return { bridge, ingest, prospects, deliver, db, seen };
}

describe("a house lead's forwarded invoice lands on Receipts", () => {
  it("an owner with an aligned SPF pass: one ingest per document, no prospect", async () => {
    const w = setup();
    await w.deliver();

    expect(w.ingest).toHaveBeenCalledTimes(2);
    const refs = w.ingest.mock.calls.map((c) => c[0]);
    expect(refs.map((r) => r.filename)).toEqual([
      "invoice-42.pdf",
      "credit-7.pdf",
    ]);
    for (const r of refs) {
      expect(r).toMatchObject({ restaurantId: HOUSE, source: "email" });
      expect(r.sourceRef).toMatch(
        /^inbound:<m-1@mail\.gmail\.com>:[0-9a-f]{16}$/,
      );
    }
    expect(w.prospects.captureFromColdEmail).not.toHaveBeenCalled();
    // The membership read is scoped to the house the address resolved.
    const access = w.db.chains.find(
      (c) => c.table === "user_restaurant_access",
    )!;
    expect(access.calls).toContainEqual(["eq", "restaurant_id", HOUSE]);
  });

  it("a manager counts too; DKIM_VALID_AU (Postmark's DKIM verdict) is enough", async () => {
    const w = setup({
      access: [
        {
          user_id: OWNER,
          restaurant_id: HOUSE,
          role: "manager",
          is_active: true,
          valid_from: "2026-01-01T00:00:00Z",
          valid_until: null,
        },
      ],
    });
    await w.deliver({
      headers: { "x-spam-tests": "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU" },
    });
    expect(w.ingest).toHaveBeenCalledTimes(2);
  });

  it("the same file forwarded twice reaches intake with the same key, and intake keeps one document", async () => {
    const w = setup();
    await w.deliver();
    await w.deliver({ message_id_header: "<m-2@mail.gmail.com>" });

    expect(w.ingest).toHaveBeenCalledTimes(4);
    expect(w.seen.size).toBe(2);
    const sha = (call: any[]) => String(call[0].sourceRef).split(":").pop();
    expect(sha(w.ingest.mock.calls[0])).toBe(sha(w.ingest.mock.calls[2]));
  });

  it("at most 10 documents, and a file over 10 MB is left out", async () => {
    const w = setup();
    const many = Array.from({ length: 12 }, (_, i) => ({
      filename: `p-${i}.pdf`,
      mime_type: "application/pdf",
      data: Buffer.from(`%PDF ${i}`).toString("base64"),
    }));
    const big = {
      filename: "huge.pdf",
      mime_type: "application/pdf",
      data: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
    };
    await w.deliver({ attachments: [big, ...many] });
    expect(w.ingest).toHaveBeenCalledTimes(10);
    expect(w.ingest.mock.calls.map((c) => c[0].filename)).not.toContain(
      "huge.pdf",
    );
  });
});

describe("everyone else keeps today's path", () => {
  const cases: Array<[string, Partial<World>, Record<string, any>]> = [
    [
      "staff of the house",
      {
        access: [
          {
            user_id: OWNER,
            restaurant_id: HOUSE,
            role: "staff",
            is_active: true,
            valid_from: "2026-01-01T00:00:00Z",
          },
        ],
      },
      {},
    ],
    ["a stranger", { users: [] }, {}],
    [
      "the owner of another house",
      {
        access: [
          {
            user_id: OWNER,
            restaurant_id: OTHER_HOUSE,
            role: "owner",
            is_active: true,
            valid_from: "2026-01-01T00:00:00Z",
          },
        ],
      },
      {},
    ],
    [
      "an owner whose access has ended",
      {
        access: [
          {
            user_id: OWNER,
            restaurant_id: HOUSE,
            role: "owner",
            is_active: true,
            valid_from: "2026-01-01T00:00:00Z",
            valid_until: "2026-02-01T00:00:00Z",
          },
        ],
      },
      {},
    ],
    [
      "an owner whose email is not verified",
      {
        users: [
          { user_id: OWNER, email: "owner@gmail.com", email_verified: false },
        ],
      },
      {},
    ],
    [
      "a sender failing SPF and DKIM",
      {},
      {
        headers: {
          "received-spf": "Fail (sender not authorized) envelope-from=owner@gmail.com",
          "authentication-results": "mx.test; spf=fail; dkim=fail header.d=gmail.com",
        },
      },
    ],
    [
      "a forger whose own domain passes (unaligned SPF and DKIM)",
      {},
      {
        headers: {
          ...spfPass("bounce@forger.test"),
          "authentication-results":
            "mx.test; dkim=pass header.d=forger.test; spf=pass smtp.mailfrom=forger.test",
        },
      },
    ],
    ["mail from the Gmail mirror, not the house address", {}, { source: undefined }],
    ["an address that resolved no house", {}, { restaurant_id: null }],
  ];

  it.each(cases)("%s: no intake, the prospect path runs", async (_n, world, over) => {
    const w = setup(world);
    await w.deliver(over);
    expect(w.ingest).not.toHaveBeenCalled();
    expect(w.prospects.captureFromColdEmail).toHaveBeenCalledTimes(1);
  });
});

describe("sender authentication is aligned to the From domain", () => {
  it("reads DMARC, aligned DKIM, aligned SPF and Postmark's verdicts", () => {
    const from = "owner@house.test";
    expect(
      senderAuthenticated({ "Authentication-Results": "mx; dmarc=pass header.from=house.test" }, from),
    ).toBe(true);
    expect(
      senderAuthenticated({ "authentication-results": "mx; dkim=pass header.d=house.test" }, from),
    ).toBe(true);
    expect(
      senderAuthenticated({ "authentication-results": "mx; spf=pass smtp.mailfrom=bounce@mail.house.test" }, from),
    ).toBe(true);
    expect(senderAuthenticated(spfPass("owner@house.test"), from)).toBe(true);
    expect(senderAuthenticated({}, from)).toBe(false);
    expect(
      senderAuthenticated({ "authentication-results": "mx; spf=pass" }, from),
    ).toBe(false);
    expect(
      senderAuthenticated({ "authentication-results": "mx; dmarc=fail; dkim=pass header.d=other.test" }, from),
    ).toBe(false);
    expect(aligned("evilhouse.test", "house.test")).toBe(false);
    expect(aligned("mail.house.test", "house.test")).toBe(true);
  });
});

describe("intake's own sha256 lookup answers a repeat as a duplicate", () => {
  it("a file already on file returns duplicate and writes nothing", async () => {
    const inserts: string[] = [];
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: { id: "doc-1" }, error: null }),
      insert: (..._a: any[]) => {
        inserts.push("x");
        return chain;
      },
    };
    const service = new DocumentIntakeService(
      { getClient: () => ({ from: () => chain }) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const r = await service.ingest({
      restaurantId: HOUSE,
      source: "email",
      buffer: Buffer.from("%PDF-1.4 invoice 42"),
    });
    expect(r).toMatchObject({ documentId: "doc-1", duplicate: true });
    expect(inserts).toHaveLength(0);
  });
});

describe("the webhook keeps the receiving server's own verdict", () => {
  it("a Received-SPF the sender wrote further down cannot replace the first", () => {
    const { InboundEmailController } = require("./inbound-email.controller");
    const c = new InboundEmailController({} as any, {} as any, {} as any);
    const norm = (c as any).normalizePayload({
      From: "owner@gmail.com",
      Headers: [
        { Name: "Received-SPF", Value: "Fail (not authorized) envelope-from=owner@gmail.com" },
        { Name: "X-Spam-Tests", Value: "SPF_FAIL" },
        { Name: "Received-SPF", Value: "Pass envelope-from=owner@gmail.com" },
        { Name: "X-Spam-Tests", Value: "DKIM_VALID_AU" },
        { Name: "Subject", Value: "first" },
        { Name: "Subject", Value: "last" },
      ],
    });
    expect(norm.headers["received-spf"]).toMatch(/^Fail/);
    expect(norm.headers["x-spam-tests"]).toBe("SPF_FAIL");
    expect(senderAuthenticated(norm.headers, "owner@gmail.com")).toBe(false);
    // Other headers keep today's last-wins reading.
    expect(norm.headers["subject"]).toBe("last");
  });
});
