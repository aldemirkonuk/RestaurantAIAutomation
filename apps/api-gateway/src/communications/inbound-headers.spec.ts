/**
 * Inbound header parsing — QA round 6 (2026-11-07) N-1 sender spoof, M-10
 * multi-address headers, N-2 RFC 2047 encoded words. Ported from the QA repro
 * `round6-tests/mail.qa.spec.ts`; the N-1 and N-2 cases fail on the
 * first-`<...>` parsers this file's module replaced.
 */
import {
  addressesIn,
  decodeEncodedWords,
  displayLabel,
  parseAddressList,
  parseSender,
  senderAddress,
  senderDomain,
} from "./inbound-headers";
import { addressInFromHeader, fromHeader, headerValue } from "./gmail-mime";
import {
  deriveTransportSignals,
  extractEmailAddress,
} from "../common/orchestrator/email-triage";
import { InboundAddressService } from "../common/orchestrator/inbound-address.service";
import { InboundEmailController } from "../common/orchestrator/inbound-email.controller";
import { RabbitMqBridgeService } from "../common/orchestrator/rabbitmq-bridge.service";
import { ProspectsService } from "../common/orchestrator/prospects.service";
import { SenderReputationService } from "../common/orchestrator/sender-reputation.service";

const SPOOF = '"Sales <sales@bigdist.com>" <attacker@evil.example>';
const SUBJ = "Re: Şubat fiyat listesi çiğköfte";
const SUBJ_B = `=?UTF-8?B?${Buffer.from(SUBJ, "utf8").toString("base64")}?=`;

describe("sender: the parsed addr-spec, never a display name", () => {
  it("a quoted display name carrying the vendor's address is not the sender", () => {
    expect(senderAddress(SPOOF)).toBe("attacker@evil.example");
    expect(addressInFromHeader(SPOOF)).toBe("attacker@evil.example");
    expect(extractEmailAddress(SPOOF)).toBe("attacker@evil.example");
  });

  it("two angle-addrs outside quotes is ambiguous and names nobody", () => {
    const malformed = "Sales <sales@bigdist.com> <attacker@evil.example>";
    expect(senderAddress(malformed)).toBeNull();
    expect(addressInFromHeader(malformed)).toBeNull();
    expect(extractEmailAddress(malformed)).toBe("");
  });

  it("a From with two mailboxes names nobody", () => {
    expect(
      senderAddress("sales@bigdist.com, attacker@evil.example"),
    ).toBeNull();
  });

  it("ordinary shapes", () => {
    expect(senderAddress("john@x.com")).toBe("john@x.com");
    expect(senderAddress('"Doe, John" <John@X.com>')).toBe("john@x.com");
    expect(parseSender("<a@x.com> (Ahmet)")).toEqual({
      name: "Ahmet",
      address: "a@x.com",
    });
    expect(senderAddress("attacker@evil.example (sales@bigdist.com)")).toBe(
      "attacker@evil.example",
    );
    expect(senderAddress("Ahmet Yılmaz <ahmet@vendör.com>")).toBe(
      "ahmet@vendör.com",
    );
    expect(senderAddress("no-address")).toBeNull();
    expect(senderAddress("")).toBeNull();
    expect(senderAddress(null)).toBeNull();
  });

  it("an encoded display name is decoded after parsing and stays a name", () => {
    expect(parseSender("=?UTF-8?B?w4dhxJ9sYXI=?= <c@x.com>")).toEqual({
      name: "Çağlar",
      address: "c@x.com",
    });
    const sneaky = `=?UTF-8?B?${Buffer.from("Sales <sales@bigdist.com>").toString("base64")}?= <attacker@evil.example>`;
    const m = parseSender(sneaky);
    expect(m?.address).toBe("attacker@evil.example");
    expect(displayLabel(m)).toBeNull();
  });

  it("displayLabel refuses a name that carries another address", () => {
    expect(displayLabel(parseSender(SPOOF))).toBeNull();
    expect(
      displayLabel(
        parseSender('"Ahmet (sales@bigdist.com)" <sales@bigdist.com>'),
      ),
    ).toBe("Ahmet (sales@bigdist.com)");
    expect(displayLabel(parseSender("Acme Wines <sales@acme.example>"))).toBe(
      "Acme Wines",
    );
    expect(displayLabel(parseSender("sales@acme.example"))).toBeNull();
  });

  it("transport signals read the real sender", () => {
    const t = deriveTransportSignals({
      from: '"noreply@x.com" <ahmet@vendor.com>',
    });
    expect(t.noReplyFrom).toBe(false);
  });
});

describe("address lists (M-10)", () => {
  it("a comma list is every address, not one string", () => {
    expect(addressesIn("a@x.com, b@y.com")).toEqual(["a@x.com", "b@y.com"]);
    expect(
      addressesIn("Chef <chef@house.com>, Mudavym <R-1a2b3c4d@in.example>"),
    ).toEqual(["chef@house.com", "r-1a2b3c4d@in.example"]);
    expect(
      parseAddressList("Team: a@x.com, a@x.com, <b@y.com>;").map(
        (m) => m.address,
      ),
    ).toEqual(["a@x.com", "b@y.com"]);
  });

  it("InboundAddressService.normalize is one address or nothing", () => {
    const svc = new InboundAddressService(
      { supabase: {} } as any,
      { get: () => "in.example" } as any,
    );
    expect(svc.normalize("Mudavym <R-1@in.example>")).toBe("r-1@in.example");
    expect(svc.normalize("a@x.com, b@y.com")).toBe("");
    expect(svc.normalizeAll("a@x.com, b@y.com")).toEqual([
      "a@x.com",
      "b@y.com",
    ]);
  });

  it("resolveRestaurantId finds the house when its address is second in a To string", async () => {
    const rows = [
      { restaurant_id: "house-1", address: "r-1a2b3c4d@in.example" },
    ];
    let asked: string[] = [];
    const db = {
      supabase: {
        from: () => {
          const q: any = {
            select: () => q,
            in: (_c: string, v: string[]) => ((asked = v), q),
            eq: () => q,
            limit: () =>
              Promise.resolve({
                data: rows.filter((r) => asked.includes(r.address)),
              }),
          };
          return q;
        },
      },
    };
    const svc = new InboundAddressService(
      db as any,
      { get: () => "in.example" } as any,
    );
    await expect(
      svc.resolveRestaurantId([
        "Chef <chef@house.com>, Mudavym <r-1a2b3c4d@in.example>",
      ]),
    ).resolves.toBe("house-1");
    expect(asked).toEqual(["chef@house.com", "r-1a2b3c4d@in.example"]);
  });
});

describe("RFC 2047 encoded words (N-2)", () => {
  it("B, Q and windows-1254", () => {
    expect(decodeEncodedWords(SUBJ_B)).toBe(SUBJ);
    expect(decodeEncodedWords("=?UTF-8?Q?Re:_=C5=9Eubat_fiyat_listesi?=")).toBe(
      "Re: Şubat fiyat listesi",
    );
    expect(decodeEncodedWords("=?windows-1254?Q?Re:_=DEubat_fiyat?=")).toBe(
      "Re: Şubat fiyat",
    );
    expect(decodeEncodedWords("=?ISO-8859-9?B?3GL8?=")).toBe("Übü");
  });

  it("adjacent words join (whitespace between them dropped, split characters rejoined)", () => {
    const bytes = Buffer.from("Şubat", "utf8");
    const a = bytes.subarray(0, 1).toString("base64");
    const b = bytes.subarray(1).toString("base64");
    expect(decodeEncodedWords(`=?UTF-8?B?${a}?= =?UTF-8?B?${b}?=`)).toBe(
      "Şubat",
    );
    expect(decodeEncodedWords("Re: =?UTF-8?Q?=C5=9Eubat?= fiyat")).toBe(
      "Re: Şubat fiyat",
    );
  });

  it("plain text, unknown charsets and malformed words are left alone", () => {
    expect(decodeEncodedWords("Re: order 42")).toBe("Re: order 42");
    expect(decodeEncodedWords("=?x-unknown-cs?Q?abc?=")).toBe(
      "=?x-unknown-cs?Q?abc?=",
    );
    expect(decodeEncodedWords("=?UTF-8?B?***?=")).toBe("=?UTF-8?B?***?=");
    expect(decodeEncodedWords(null)).toBe("");
  });

  it("headerValue stays raw (From must be parsed before anything is decoded)", () => {
    expect(headerValue([{ name: "Subject", value: SUBJ_B }], "subject")).toBe(
      SUBJ_B,
    );
  });

  it("webhook: a raw Subject from the headers map is decoded", () => {
    const c: any = new InboundEmailController(
      { get: () => undefined } as any,
      {} as any,
      {} as any,
    );
    expect(
      c.normalizePayload({ From: "a@b.com", headers: { subject: SUBJ_B } })
        .subject,
    ).toBe(SUBJ);
  });
});

/* ---------- the bridge, end to end over a tiny in-memory supabase ---------- */
type Row = Record<string, any>;
function bridge(tables: Record<string, Row[]>) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op = "select";
    let payload: any;
    let single = false;
    let lim = Infinity;
    const qb: any = {
      select: () => qb,
      ilike: (c: string, v: string) => (
        filters.push(
          (r) => String(r[c] ?? "").toLowerCase() === v.toLowerCase(),
        ),
        qb
      ),
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), qb),
      in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), qb),
      not: () => qb,
      order: () => qb,
      limit: (n: number) => ((lim = n), qb),
      single: () => ((single = true), qb),
      maybeSingle: () => ((single = true), qb),
      insert: (p: any) => ((op = "insert"), (payload = p), qb),
      update: () => ((op = "update"), qb),
      then: (res: any, rej: any) => {
        let out: any;
        if (op === "insert") {
          const row = { id: `${table}-${rows.length + 1}`, ...payload };
          rows.push(row);
          inserts.push({ table, row });
          out = { data: single ? { id: row.id } : [row], error: null };
        } else if (op === "update") out = { data: [], error: null };
        else {
          const m = rows
            .filter((r) => filters.every((f) => f(r)))
            .slice(0, lim);
          out = { data: single ? (m[0] ?? null) : m, error: null };
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return qb;
  };
  const db = {
    supabase: {
      from,
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    },
  };
  const events: any[] = [];
  const ws: any = new Proxy(
    {},
    {
      get:
        (_t, k) =>
        (...a: any[]) =>
          void events.push([String(k), ...a]),
    },
  );
  const responder: any = {
    analyzeAndDraftReply: (...a: any[]) =>
      void events.push(["responder", ...a]),
    persistManagerNotification: async () => undefined,
  };
  const noop: any = new Proxy({}, { get: () => async () => undefined });
  const prospects: any = {
    domainOf: (e: string) => e.split("@")[1],
    captureFromColdEmail: async (a: any) => (
      events.push(["prospect", a]),
      { captured: false }
    ),
  };
  const svc: any = new RabbitMqBridgeService(
    { get: () => undefined } as any,
    ws,
    db as any,
    responder,
    noop,
    prospects,
  );
  svc.persistAttachments = async () => undefined;
  svc.persistProspectAttachments = async () => [];
  return { svc, inserts, events };
}
const inbound = (o: Record<string, any>) => ({
  from: "",
  subject: "Re: order",
  body: "ok",
  attachments: [],
  gmail_thread_id: "",
  gmail_message_id: "",
  message_id_header: "",
  in_reply_to: "",
  references: "",
  headers: {},
  ...o,
});
const VENDOR = {
  id: "prov-A",
  restaurant_id: "house-A",
  name: "BigDist",
  contact_email: "sales@bigdist.com",
};
const OPEN = {
  id: "oA",
  provider_id: "prov-A",
  restaurant_id: "house-A",
  status: "NEGOTIATING",
};

describe("RabbitMqBridgeService.handleInboundEmail attribution", () => {
  it("a spoofed display name never reaches the vendor's open negotiation", async () => {
    const { svc, inserts, events } = bridge({
      providers: [VENDOR],
      procurement_orders: [OPEN],
    });
    await svc.handleInboundEmail(
      inbound({
        from: SPOOF,
        gmail_message_id: "mS",
        body: "Please wire the deposit to the new IBAN",
      }),
    );
    expect(
      inserts.filter((i) => i.table === "procurement_conversations"),
    ).toEqual([]);
    expect(events.some((e) => e[0] === "responder")).toBe(false);
  });

  it("a spoofed display name never labels a cold prospect", async () => {
    const { svc, events } = bridge({
      providers: [VENDOR],
      procurement_orders: [OPEN],
    });
    await svc.handleInboundEmail(
      inbound({
        from: SPOOF,
        gmail_message_id: "mP",
        attachments: [
          { filename: "c.pdf", mime_type: "application/pdf", data: "AA==" },
        ],
      }),
    );
    const capture = events.find((e) => e[0] === "prospect")?.[1];
    expect(capture.senderEmail).toBe("attacker@evil.example");
    expect(capture.senderName).toBeNull();
  });

  it("the real vendor still attributes, and its encoded subject is stored decoded", async () => {
    const { svc, inserts, events } = bridge({
      providers: [VENDOR],
      procurement_orders: [OPEN],
    });
    await svc.handleInboundEmail(
      inbound({
        from: '"BigDist Satış" <Sales@BigDist.com>',
        subject: SUBJ_B,
        gmail_message_id: "mV",
      }),
    );
    const rows = inserts
      .filter((i) => i.table === "procurement_conversations")
      .map((i) => i.row);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider_id).toBe("prov-A");
    expect(rows[0].order_id).toBe("oA");
    expect(rows[0].message_text.startsWith(`Subject: ${SUBJ}`)).toBe(true);
    const title = events.find((e) => e[0] === "emitRestaurantNotification")?.[2]
      ?.title;
    expect(title).toContain("Şubat");
  });
});

/* ---------- QA round 22: the N-1 tail ---------- */
// The same table as services/agent-orchestrator/tests/
// test_email_sender_attribution.py, so the gateway and the Python agent cannot
// disagree on a shape. [label, From header, expected address or null]
const B64 = (t: string) =>
  `=?UTF-8?B?${Buffer.from(t, "utf8").toString("base64")}?=`;
const TAIL: Array<[string, string, string | null]> = [
  ["quoted display name", SPOOF, "attacker@evil.example"],
  [
    "comment carries vendor",
    '"x" <attacker@evil.example> (sales@bigdist.com)',
    "attacker@evil.example",
  ],
  [
    "comment with angle",
    "Sales (<sales@bigdist.com>) <attacker@evil.example>",
    "attacker@evil.example",
  ],
  ["nested comment", "attacker@evil.example (a (b <sales@bigdist.com>))", null],
  [
    "RFC 2047 name decoding to an angle",
    `${B64("Sales <sales@bigdist.com>")} <attacker@evil.example>`,
    "attacker@evil.example",
  ],
  [
    "escaped quote in name",
    '"Sales\\" <sales@bigdist.com>" <attacker@evil.example>',
    "attacker@evil.example",
  ],
  [
    "address as display name",
    "sales@bigdist.com <attacker@evil.example>",
    null,
  ],
  ["angle then bare", "<sales@bigdist.com> attacker@evil.example", null],
  ["two angles", "Sales <sales@bigdist.com> <attacker@evil.example>", null],
  ["two mailboxes", "sales@bigdist.com, attacker@evil.example", null],
  [
    "two mailboxes, attacker first",
    "attacker@evil.example, sales@bigdist.com",
    null,
  ],
  [
    "unterminated quote",
    '"Sales <sales@bigdist.com> <attacker@evil.example>',
    null,
  ],
  ["quoted local part", '"sales@bigdist.com"@evil.example', null],
  ["quoted local part, angled", 'X <"sales@bigdist.com"@evil.example>', null],
  ["source route", "<@evil.example:sales@bigdist.com>", null],
  ["group carrying vendor", "undisclosed: sales@bigdist.com;", null],
  ["group carrying attacker", "Vendors: attacker@evil.example;", null],
  ["CRLF injection", "Sales\r\nFrom: sales@bigdist.com", null],
  [
    "CRLF injection after a real address",
    "attacker@evil.example\r\nFrom: sales@bigdist.com",
    null,
  ],
  ["folded injection", "Sales\r\n From: sales@bigdist.com", null],
  ["NUL injection", "attacker@evil.example\u0000<sales@bigdist.com>", null],
  ["two bare addresses", "attacker@evil.example sales@bigdist.com", null],
  ["empty", "", null],
  ["display only", "Sales Team", null],
  ["bare", "john@x.com", "john@x.com"],
  ["upper case", "SALES@BigDist.com", "sales@bigdist.com"],
  ["quoted name with comma", '"Doe, John" <John@X.com>', "john@x.com"],
  ["angle with trailing comment", "<a@x.com> (Ahmet)", "a@x.com"],
  [
    "unicode name and domain",
    "Ahmet Yılmaz <ahmet@vendör.com>",
    "ahmet@vendör.com",
  ],
  ["folded between name and angle", "Ahmet\r\n <ahmet@x.com>", "ahmet@x.com"],
];

describe("N-1 tail (QA round 22): a From not shaped like one mailbox names nobody", () => {
  it.each(TAIL)("%s", (_label, header, want) => {
    expect(senderAddress(header)).toBe(want);
    expect(addressInFromHeader(header)).toBe(want);
    expect(extractEmailAddress(header)).toBe(want ?? "");
  });

  it("the prospect and reputation readers take the parsed sender's domain", () => {
    const prospects = new ProspectsService(
      {} as any,
      { get: () => undefined } as any,
    );
    const reputation = new SenderReputationService({} as any);
    for (const domainOf of [
      (v: string) => prospects.domainOf(v),
      (v: string) => reputation.domainOf(v),
      senderDomain,
    ]) {
      expect(domainOf('"x <a@trusted.com>" <b@evil.example>')).toBe(
        "evil.example",
      );
      expect(domainOf("<sales@bigdist.com> attacker@evil.example")).toBe("");
      expect(domainOf("undisclosed: sales@bigdist.com;")).toBe("");
      expect(domainOf("Sales <Sales@BigDist.com>")).toBe("bigdist.com");
      expect(domainOf("sales@bigdist.com")).toBe("bigdist.com");
      expect(domainOf("BigDist.com")).toBe("bigdist.com");
      expect(domainOf("not a domain")).toBe("");
      expect(domainOf(null)).toBe("");
    }
  });

  it("two From headers name nobody, whichever comes first", () => {
    const two = [
      { name: "From", value: "attacker@evil.example" },
      { name: "from", value: "sales@bigdist.com" },
    ];
    expect(senderAddress(fromHeader(two))).toBeNull();
    expect(senderAddress(fromHeader([...two].reverse()))).toBeNull();
    expect(senderAddress(fromHeader([two[1]]))).toBe("sales@bigdist.com");
    const c: any = new InboundEmailController(
      { get: () => undefined } as any,
      {} as any,
      {} as any,
    );
    const n = c.normalizePayload({
      Headers: two.map((h) => ({ Name: h.name, Value: h.value })),
    });
    expect(senderAddress(n.from)).toBeNull();
  });

  it.each([
    "<sales@bigdist.com> attacker@evil.example",
    "undisclosed: sales@bigdist.com;",
    "attacker@evil.example\r\nFrom: sales@bigdist.com",
    "attacker@evil.example\u0000<sales@bigdist.com>",
  ])("nothing is stored against the vendor for %j", async (forged) => {
    const { svc, inserts, events } = bridge({
      providers: [VENDOR],
      procurement_orders: [OPEN],
    });
    await svc.handleInboundEmail(
      inbound({ from: forged, gmail_message_id: "m-tail" }),
    );
    expect(inserts).toEqual([]);
    expect(events.some((e) => e[0] === "responder")).toBe(false);
  });
});
