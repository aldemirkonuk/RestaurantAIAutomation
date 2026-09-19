/**
 * ADR 0172 — outbound MIME headers are RFC 2047 encoded and cannot be injected.
 *
 * Every assertion here decodes the message the way a receiver would, with a
 * decoder written in this file (not the encoder under test): unfold the header
 * block, split it on ANY line break (CRLF, bare CR, bare LF — the lenient
 * receiver's view), decode each encoded-word on its own with a FATAL UTF-8
 * decoder, and base64-decode each body part.
 */

jest.mock("googleapis", () => ({ google: {} }));

import { ConfigService } from "@nestjs/config";
import { GmailService } from "./gmail.service";
import { sendThroughGrant } from "./letters/house-letters.service";
import {
  addressListHeader,
  mailboxHeader,
  MimeHeaderError,
  threadingHeader,
  unstructuredHeader,
} from "./mime-headers";

// ---------------------------------------------------------------------------
// An independent reader
// ---------------------------------------------------------------------------

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

function decodeWord(charset: string, enc: string, payload: string): string {
  expect(charset.toUpperCase()).toBe("UTF-8");
  const bytes =
    enc.toUpperCase() === "B"
      ? Buffer.from(payload, "base64")
      : Buffer.from(
          payload
            .replace(/_/g, " ")
            .replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
              String.fromCharCode(parseInt(h, 16)),
            ),
          "latin1",
        );
  // fatal: a word that splits a UTF-8 character throws here.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** RFC 2047 §6.2: whitespace between two adjacent encoded-words is dropped. */
function decodeHeaderValue(value: string): string {
  const joined = value.replace(
    /(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)[ \t]+(?==\?)/g,
    "$1",
  );
  return joined.replace(ENCODED_WORD, (_, cs, enc, p) =>
    decodeWord(cs, enc, p),
  );
}

interface ParsedHeader {
  name: string;
  value: string;
}

function splitMessage(raw: string): { headerBlock: string; body: string } {
  const at = raw.indexOf("\r\n\r\n");
  expect(at).toBeGreaterThan(0);
  return { headerBlock: raw.slice(0, at), body: raw.slice(at + 4) };
}

/** Physical lines of a header block, split on any line break. */
function physicalLines(headerBlock: string): string[] {
  return headerBlock.split(/\r\n|\r|\n/);
}

function parseHeaders(headerBlock: string): ParsedHeader[] {
  const out: ParsedHeader[] = [];
  for (const line of physicalLines(headerBlock)) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1].value += line; // RFC 5322 §2.2.3 unfold: drop the CRLF only
      continue;
    }
    const colon = line.indexOf(":");
    expect(colon).toBeGreaterThan(0);
    out.push({ name: line.slice(0, colon), value: line.slice(colon + 1) });
  }
  return out.map((h) => ({
    name: h.name,
    value: h.value.replace(/^[ \t]+/, ""),
  }));
}

function header(headers: ParsedHeader[], name: string): string[] {
  return headers
    .filter((h) => h.name.toLowerCase() === name.toLowerCase())
    .map((h) => h.value);
}

function decodedSubject(raw: string): string {
  const subjects = header(
    parseHeaders(splitMessage(raw).headerBlock),
    "Subject",
  );
  expect(subjects).toHaveLength(1);
  return decodeHeaderValue(subjects[0]);
}

/** Split a multipart body on its boundary and decode each base64 part. */
function bodyParts(
  raw: string,
): Array<{ contentType: string; cte: string; text: string }> {
  const { headerBlock, body } = splitMessage(raw);
  const ct = header(parseHeaders(headerBlock), "Content-Type")[0];
  const boundary = /boundary="([^"]+)"/.exec(ct)![1];
  const chunks = body.split(`--${boundary}`);
  expect(chunks[chunks.length - 1].startsWith("--")).toBe(true); // close delimiter
  return chunks.slice(1, -1).map((chunk) => {
    const part = chunk.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const { headerBlock: ph, body: pb } = splitMessage(part);
    const hs = parseHeaders(ph);
    const cte = header(hs, "Content-Transfer-Encoding")[0] ?? "";
    expect(cte.toLowerCase()).toBe("base64");
    for (const line of pb.split("\r\n"))
      expect(line.length).toBeLessThanOrEqual(76);
    return {
      contentType: header(hs, "Content-Type")[0],
      cte,
      text: new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(pb.replace(/\r\n/g, ""), "base64"),
      ),
    };
  });
}

/** RFC 2047 §2 shape checks on every line of a header block. */
function expectWellFormed(headerBlock: string): void {
  // Nothing but printable ASCII, CR and LF in the header block…
  expect(/^[\x20-\x7e\r\n]*$/.test(headerBlock)).toBe(true);
  // …and every line break is a CRLF.
  expect(headerBlock.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  for (const line of physicalLines(headerBlock)) {
    const words = line.match(ENCODED_WORD) ?? [];
    if (words.length) expect(line.length).toBeLessThanOrEqual(76);
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75);
      const m = /^=\?([^?]+)\?([BbQq])\?([^?]*)\?=$/.exec(w)!;
      decodeWord(m[1], m[2], m[3]); // each word decodes ALONE, fatally
    }
  }
}

// ---------------------------------------------------------------------------
// GmailService, end to end through sendEmail → gmail.users.messages.send
// ---------------------------------------------------------------------------

function makeService() {
  const svc = new GmailService({
    get: () => undefined,
  } as unknown as ConfigService);
  const send = jest.fn(async (_args: { requestBody: { raw: string } }) => ({
    data: { id: "gmail-1", threadId: "thread-1" },
  }));
  const s = svc as unknown as Record<string, unknown>;
  s.isConfigured = true;
  s.senderEmail = "siparis@lokantamudavim.com";
  s.gmail = { users: { messages: { send } } };
  return { svc, send };
}

async function sendAndCapture(
  opts: Partial<Parameters<GmailService["sendEmail"]>[0]> = {},
): Promise<{ raw: string; encoded: string }> {
  const { svc, send } = makeService();
  const result = await svc.sendEmail({
    to: ["fikri@fikritarim.com"],
    subject: "Order",
    html: "<p>Hello</p>",
    ...opts,
  });
  expect(result.success).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
  const encoded = send.mock.calls[0][0].requestBody.raw;
  return { raw: Buffer.from(encoded, "base64url").toString("latin1"), encoded };
}

const LIRA = "₺12,300 to Trakya Direct is due Monday — Meyhouse";
const SARAP = "Şarap siparişi · İstanbul";

describe("GmailService.createMimeMessage — headers (ADR 0172)", () => {
  it("sends `raw` as base64url of the WHOLE message", async () => {
    const { raw, encoded } = await sendAndCapture({ subject: LIRA });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/); // url-safe alphabet, no padding
    expect(Buffer.from(raw, "latin1").toString("base64url")).toBe(encoded);
    expect(raw.startsWith("From: ")).toBe(true);
    expect(raw).toMatch(/--boundary_\d+--$/); // ends on the close delimiter
  });

  it.each([LIRA, SARAP])(
    "round-trips the subject %j exactly",
    async (subject) => {
      const { raw } = await sendAndCapture({ subject });
      expectWellFormed(splitMessage(raw).headerBlock);
      expect(decodedSubject(raw)).toBe(subject);
    },
  );

  it("keeps a plain ASCII subject readable, unencoded", async () => {
    const { raw } = await sendAndCapture({
      subject: "Order confirmation #1042 (Tuesday)",
    });
    expect(raw).toContain(
      "\r\nSubject: Order confirmation #1042 (Tuesday)\r\n",
    );
  });

  it("encodes a literal `=?` so it cannot be read as an encoded-word", async () => {
    const subject = "Re: =?UTF-8?B?QmNjOg==?= literal";
    const { raw } = await sendAndCapture({ subject });
    expect(decodedSubject(raw)).toBe(subject);
  });

  it("splits long subjects only on whole characters, words ≤ 75, lines ≤ 76", async () => {
    const subject = `${SARAP} — 🍷🍷🍷 ${"ğüşıöç İĞÜŞÖÇ ".repeat(12)}₺ end`;
    const { raw } = await sendAndCapture({ subject });
    const { headerBlock } = splitMessage(raw);
    expectWellFormed(headerBlock);
    expect(
      header(parseHeaders(headerBlock), "Subject")[0].match(ENCODED_WORD)!
        .length,
    ).toBeGreaterThan(3);
    expect(decodedSubject(raw)).toBe(subject);
  });

  it.each([
    "Re: invoice\r\nBcc: attacker@evil.example",
    "Re: invoice\nBcc: attacker@evil.example",
    "Re: invoice\rBcc: attacker@evil.example",
    "Re: invoice\r\n\r\nInjected body",
  ])("a CR/LF in the subject creates no header (%j)", async (subject) => {
    const { raw } = await sendAndCapture({ subject });
    const { headerBlock } = splitMessage(raw);
    expectWellFormed(headerBlock);
    const names = parseHeaders(headerBlock).map((h) => h.name.toLowerCase());
    expect(names).not.toContain("bcc");
    expect(names.filter((n) => n === "subject")).toHaveLength(1);
    expect(names).toEqual([
      "from",
      "to",
      "message-id",
      "subject",
      "mime-version",
      "content-type",
    ]);
    expect(decodedSubject(raw)).not.toMatch(/[\r\n]/);
    expect(decodedSubject(raw).startsWith("Re: invoice ")).toBe(true);
  });

  it.each([
    ["replyTo", "a@b.example\r\nBcc: attacker@evil.example"],
    ["messageIdHeader", "<a@b.example>\rBcc: attacker@evil.example"],
    ["bcc", ["a@b.example\r\nTo: attacker@evil.example"]],
  ])("refuses a line break in %s — nothing is sent", async (field, value) => {
    const { svc, send } = makeService();
    const result = await svc.sendEmail({
      to: ["fikri@fikritarim.com"],
      subject: "Order",
      html: "<p>x</p>",
      [field]: value,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/line break or control character/);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a line break in a To or Cc entry", async () => {
    for (const opts of [
      { to: ["a@b.example\r\nBcc: attacker@evil.example"] },
      { cc: ["a@b.example\nBcc: attacker@evil.example"] },
    ]) {
      const { svc, send } = makeService();
      const result = await svc.sendEmail({
        to: ["fikri@fikritarim.com"],
        subject: "Order",
        html: "<p>x</p>",
        ...opts,
      });
      expect(result.success).toBe(false);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("trims whitespace around an address but refuses one inside it", async () => {
    // A contact saved with a trailing newline or tab is not corrupt data.
    for (const to of [
      "fikri@fikritarim.com\n",
      "fikri@fikritarim.com\t",
      " fikri@fikritarim.com\r\n",
    ]) {
      const { raw } = await sendAndCapture({ to: [to] });
      const { headerBlock } = splitMessage(raw);
      expectWellFormed(headerBlock);
      expect(header(parseHeaders(headerBlock), "To")).toEqual([
        "fikri@fikritarim.com",
      ]);
    }
    // An interior line break still refuses the whole send.
    const { svc, send } = makeService();
    const result = await svc.sendEmail({
      to: ["fikri@\r\nfikritarim.com"],
      subject: "Order",
      html: "<p>x</p>",
    });
    expect(result.success).toBe(false);
    expect(result.refusedBeforeSend).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses one To entry that holds two named addresses — never drops one", async () => {
    const { svc, send } = makeService();
    const result = await svc.sendEmail({
      to: ["Fikri <fikri@fikritarim.com>, Trakya <orders@trakya.example>"],
      subject: "Order",
      html: "<p>x</p>",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/one entry holds more than one address/);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the From brand text and encodes non-ASCII recipient names", async () => {
    const { raw } = await sendAndCapture({
      to: ["Fikri Tarım <fikri@fikritarim.com>", "orders@trakya.example"],
      cc: ['"Doe, Jane" <jane@x.example>'],
      replyTo: "Meyhouse Şarap <reply@meyhouse.example>",
      inReplyTo: "<in@x.example>",
      references: "<r1@x.example> <in@x.example>",
    });
    const { headerBlock } = splitMessage(raw);
    expectWellFormed(headerBlock);
    const hs = parseHeaders(headerBlock);
    expect(header(hs, "From")).toEqual([
      "WineOps AI <siparis@lokantamudavim.com>",
    ]);
    expect(decodeHeaderValue(header(hs, "To")[0])).toBe(
      "Fikri Tarım <fikri@fikritarim.com>, orders@trakya.example",
    );
    // The address itself is never inside an encoded-word.
    expect(header(hs, "To")[0]).toContain("<fikri@fikritarim.com>");
    expect(header(hs, "Cc")).toEqual(['"Doe, Jane" <jane@x.example>']);
    expect(decodeHeaderValue(header(hs, "Reply-To")[0])).toBe(
      "Meyhouse Şarap <reply@meyhouse.example>",
    );
    expect(header(hs, "In-Reply-To")).toEqual(["<in@x.example>"]);
    expect(header(hs, "References")).toEqual(["<r1@x.example> <in@x.example>"]);
  });
});

describe("GmailService.createMimeMessage — threading headers are rebuilt, never refused (ADR 0172)", () => {
  // In-Reply-To / References are copied from the vendor's own mail, where
  // RFC 5322 folding (CRLF + WSP) is legal. Refusing them stopped every reply
  // on that thread; they are rebuilt from their <msg-id> tokens instead.
  const HEADER = {
    inReplyTo: "In-Reply-To",
    references: "References",
  } as const;
  const FIELDS = Object.keys(HEADER) as Array<keyof typeof HEADER>;

  const REBUILT: Array<[string, string, string]> = [
    [
      "folded CRLF + TAB",
      "<a@x.example>\r\n\t<b@y.example>",
      "<a@x.example> <b@y.example>",
    ],
    [
      "a bare TAB",
      "<a@x.example>\t<b@y.example>",
      "<a@x.example> <b@y.example>",
    ],
    [
      "folded CRLF + space",
      "<a@x.example>\r\n <b@y.example>",
      "<a@x.example> <b@y.example>",
    ],
    [
      "a non-ASCII id, dropped",
      "<şarap@x.example> <a@x.example>",
      "<a@x.example>",
    ],
    [
      "an injection attempt",
      "<a@x.example>\r\nBcc: evil@x.example",
      "<a@x.example>",
    ],
  ];

  describe.each(FIELDS)("%s", (field) => {
    it.each(REBUILT)("rebuilds %s", async (_label, value, expected) => {
      const { raw } = await sendAndCapture({ [field]: value });
      const { headerBlock } = splitMessage(raw);
      expectWellFormed(headerBlock);
      const hs = parseHeaders(headerBlock);
      expect(header(hs, HEADER[field])).toEqual([expected]);
      expect(hs.map((h) => h.name.toLowerCase())).not.toContain("bcc");
    });

    it.each([
      ["whitespace only", " \r\n\t "],
      ["text with no id", "not a message id"],
      ["only a non-ASCII id", "<şarap@x.example>"],
    ])(
      "omits the header for %s — the reply still goes out",
      async (_label, value) => {
        const { raw } = await sendAndCapture({ [field]: value });
        const names = parseHeaders(splitMessage(raw).headerBlock).map((h) =>
          h.name.toLowerCase(),
        );
        expect(names).toEqual([
          "from",
          "to",
          "message-id",
          "subject",
          "mime-version",
          "content-type",
        ]);
      },
    );
  });
});

describe("GmailService.createMimeMessage — body parts (ADR 0172)", () => {
  it("base64-encodes both parts and they decode to the exact UTF-8 text", async () => {
    const text = `${LIRA}\n${SARAP}\nçöüğışİ — ·`;
    const html = `<p>${LIRA}</p><p>${SARAP}</p><p>çöüğışİ — ·</p>`;
    const { raw } = await sendAndCapture({ subject: SARAP, text, html });
    // 7-bit clean on the wire: no byte above 0x7f anywhere in the message.
    expect([...Buffer.from(raw, "latin1")].every((b) => b < 0x80)).toBe(true);
    const parts = bodyParts(raw);
    expect(parts.map((p) => p.contentType)).toEqual([
      'text/plain; charset="UTF-8"',
      'text/html; charset="UTF-8"',
    ]);
    expect(parts[0].text).toBe(text);
    expect(parts[1].text).toBe(html);
  });
});

// ---------------------------------------------------------------------------
// sendThroughGrant (letters) — the second hand-built MIME message
// ---------------------------------------------------------------------------

async function grantRaw(
  subject: string,
  text: string,
  from = "Lokanta Mudavim <siparis@lokantamudavim.com>",
) {
  let body = "";
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = String(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "g-1" }),
      text: async () => "",
    };
  }) as unknown as typeof fetch;
  await sendThroughGrant({
    token: "t",
    from,
    to: "Fikri Tarım <fikri@fikritarim.com>",
    subject,
    text,
    fetchImpl,
  });
  return Buffer.from(JSON.parse(body).raw as string, "base64url").toString(
    "latin1",
  );
}

describe("sendThroughGrant — headers and body (ADR 0172)", () => {
  it.each([LIRA, SARAP])(
    "round-trips %j and the body exactly",
    async (subject) => {
      const text = `Merhaba,\n${subject}\nSaygılarımızla`;
      const raw = await grantRaw(subject, text);
      const { headerBlock, body } = splitMessage(raw);
      expectWellFormed(headerBlock);
      expect(decodedSubject(raw)).toBe(subject);
      const hs = parseHeaders(headerBlock);
      expect(header(hs, "Content-Transfer-Encoding")).toEqual(["base64"]);
      expect(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.from(body.replace(/\r\n/g, ""), "base64"),
        ),
      ).toBe(text);
      expect(decodeHeaderValue(header(hs, "To")[0])).toBe(
        "Fikri Tarım <fikri@fikritarim.com>",
      );
    },
  );

  it("writes the From header through the encoder, address never encoded", async () => {
    const raw = await grantRaw(
      "x",
      "x",
      "Lokanta Müdavim · Şarap <siparis@lokantamudavim.com>\n",
    );
    const { headerBlock } = splitMessage(raw);
    expectWellFormed(headerBlock);
    const from = header(parseHeaders(headerBlock), "From");
    expect(from).toHaveLength(1);
    expect(from[0]).toContain("<siparis@lokantamudavim.com>");
    expect(decodeHeaderValue(from[0])).toBe(
      "Lokanta Müdavim · Şarap <siparis@lokantamudavim.com>",
    );
  });

  it("omits From when the grant has no address", async () => {
    const raw = await grantRaw("x", "x", "  ");
    const names = parseHeaders(splitMessage(raw).headerBlock).map((h) =>
      h.name.toLowerCase(),
    );
    expect(names).not.toContain("from");
    expect(names[0]).toBe("to");
  });

  it("a CR/LF in the letter subject creates no header", async () => {
    const raw = await grantRaw(
      "Standing order\r\nBcc: attacker@evil.example",
      "x",
    );
    const names = parseHeaders(splitMessage(raw).headerBlock).map((h) =>
      h.name.toLowerCase(),
    );
    expect(names).not.toContain("bcc");
    expect(decodedSubject(raw)).toBe(
      "Standing order Bcc: attacker@evil.example",
    );
  });
});

// ---------------------------------------------------------------------------
// The pure encoders
// ---------------------------------------------------------------------------

describe("mime-headers encoders", () => {
  it("never splits a surrogate pair or a multi-byte character across words", () => {
    for (const s of [
      "🍷".repeat(40),
      "₺".repeat(60),
      "a₺".repeat(50),
      "İ".repeat(90),
    ]) {
      const h = unstructuredHeader("Subject", s);
      expectWellFormed(h);
      expect(
        decodeHeaderValue(h.replace(/^Subject: /, "").replace(/\r\n/g, "")),
      ).toBe(s);
    }
  });

  it("encodes a non-ASCII display name but never the address", () => {
    const h = mailboxHeader("From", "Mudavym · Şarap Evi", "a@b.example");
    expectWellFormed(h);
    expect(h).toMatch(/ <a@b\.example>$/);
    expect(
      decodeHeaderValue(h.replace(/^From: /, "").replace(/\r\n/g, "")),
    ).toBe("Mudavym · Şarap Evi <a@b.example>");
  });

  it("quotes an ASCII display name that carries specials", () => {
    expect(
      mailboxHeader("From", 'Ops "Night" Desk, Kadikoy', "a@b.example"),
    ).toBe('From: "Ops \\"Night\\" Desk, Kadikoy" <a@b.example>');
  });

  it("threadingHeader returns null when no <msg-id> survives", () => {
    for (const v of [
      undefined,
      null,
      "",
      "  \r\n\t",
      "no id here",
      "<a b@x>",
      "<şarap@x.example>",
    ]) {
      expect(threadingHeader("References", v)).toBeNull();
    }
    expect(threadingHeader("References", "<a@x>\r\nBcc: <evil@x>")).toBe(
      "References: <a@x> <evil@x>",
    );
  });

  it("mailboxHeader trims a trailing newline from the address", () => {
    expect(mailboxHeader("From", "Ops", "a@b.example\n")).toBe(
      "From: Ops <a@b.example>",
    );
  });

  it("refuses an entry with two named addresses but keeps a quoted name with <>", () => {
    expect(() =>
      addressListHeader("To", ["A <a@x.example>, B <b@x.example>"]),
    ).toThrow(/one entry holds more than one address/);
    expect(
      addressListHeader("To", ['"A <a@x.example>, B" <b@x.example>']),
    ).toBe('To: "A <a@x.example>, B" <b@x.example>');
  });

  it("throws MimeHeaderError on a control character in an address", () => {
    expect(() => addressListHeader("To", ["a@b.example\x00"])).toThrow(
      MimeHeaderError,
    );
  });
});
