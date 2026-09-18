/**
 * Two options `GmailService.sendEmail` learned for the recommendations digest
 * (ADR 0149 row 26): a From display name, and RFC 2369 / RFC 8058
 * List-Unsubscribe headers.
 *
 * Pinned on both delivery paths — the Gmail API's raw MIME and the SMTP
 * fallback — because a header written on one path and not the other is a mail
 * that is unsubscribable only when OAuth happens to be healthy. And pinned
 * against every EXISTING caller: with neither option passed, the From line is
 * byte-for-byte what it was ("WineOps AI") and no List-Unsubscribe appears.
 */

jest.mock("googleapis", () => ({ google: {} }));

const sendMail = jest.fn(async (_opts: any) => ({
  messageId: "<smtp-1@test>",
}));
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({ sendMail })),
}));

import {
  GmailService,
  fromDisplayName,
  listUnsubscribeHeaders,
  safeFromName,
} from "./gmail.service";

const URL_OK =
  "https://api.mudavym.test/api/v1/recommendations/digest/unsubscribe/" +
  "a".repeat(64);

function service(env: Record<string, string> = {}) {
  const svc = new GmailService({ get: (k: string) => env[k] } as any);
  (svc as any).senderEmail = "notifications@mudavym.test";
  return svc;
}

function headersOf(mime: string): string[] {
  return mime.split("\r\n\r\n")[0].split("\r\n");
}

describe("safeFromName", () => {
  it("absent or blank is the name every existing caller already sends", () => {
    expect(safeFromName(undefined)).toBe("WineOps AI");
    expect(safeFromName("   ")).toBe("WineOps AI");
  });

  it("cannot open a second header or break out of the quoted name", () => {
    expect(safeFromName('Mudavym"\r\nBcc: all@x.test <evil>')).toBe(
      "Mudavym Bcc: all@x.test  evil",
    );
    expect(safeFromName("Mudavym")).toBe("Mudavym");
  });
});

describe("fromDisplayName (the Gmail API path writes the From header itself)", () => {
  it("writes plain names bare, so the existing From line keeps its bytes", () => {
    expect(fromDisplayName(undefined)).toBe("WineOps AI");
    expect(fromDisplayName("Mudavym")).toBe("Mudavym");
  });

  it("quotes a name carrying an RFC 5322 special, which bare would parse as two mailboxes or a group", () => {
    expect(fromDisplayName("Meyhouse, Palo Alto")).toBe(
      '"Meyhouse, Palo Alto"',
    );
    expect(fromDisplayName("Team: ops; a@b.test")).toBe(
      '"Team: ops; a@b.test"',
    );
    expect(fromDisplayName("Meyhouse Co.")).toBe('"Meyhouse Co."');
    // A quote or backslash cannot close the quoted string early.
    expect(fromDisplayName('Mey"house\\, x')).toBe('"Mey house , x"');
  });

  it("encodes a non-ASCII name as an RFC 2047 word, never raw and never inside quotes", () => {
    const word = fromDisplayName("Kaleiçi, Antalya");
    const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(word);
    expect(m).not.toBeNull();
    expect(Buffer.from(m![1], "base64").toString("utf8")).toBe(
      "Kaleiçi, Antalya",
    );
  });
});

describe("listUnsubscribeHeaders", () => {
  it("writes List-Unsubscribe, and the one-click header only when asked", () => {
    expect(listUnsubscribeHeaders({ url: URL_OK })).toEqual([
      ["List-Unsubscribe", `<${URL_OK}>`],
    ]);
    expect(listUnsubscribeHeaders({ url: URL_OK, oneClick: true })).toEqual([
      ["List-Unsubscribe", `<${URL_OK}>`],
      ["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
    ]);
  });

  it("drops anything that is not a plain http(s) URL rather than half-writing it", () => {
    for (const url of [
      "mailto:x@y.z",
      "javascript:alert(1)",
      `${URL_OK}\r\nBcc: x@y.z`,
      `${URL_OK}>`,
      "https://a b.test/x",
      "",
    ]) {
      expect(listUnsubscribeHeaders({ url, oneClick: true })).toEqual([]);
    }
    expect(listUnsubscribeHeaders(undefined)).toEqual([]);
  });
});

describe("the Gmail API path's MIME headers", () => {
  it("an existing caller's mail is unchanged: WineOps AI, no List-Unsubscribe", () => {
    const mime: string = (service() as any).createMimeMessage({
      to: ["a@b.test"],
      subject: "Low stock",
      html: "<p>x</p>",
    });
    const h = headersOf(mime);
    expect(h).toContain("From: WineOps AI <notifications@mudavym.test>");
    expect(h.some((l) => l.startsWith("List-Unsubscribe"))).toBe(false);
  });

  it("the digest's mail carries its From name and both unsubscribe headers, in the header block", () => {
    const mime: string = (service() as any).createMimeMessage({
      to: ["ana@house.test"],
      subject: "Mudavym: 1 recommendation standing at Meyhouse",
      html: "<p>x</p>",
      fromName: "Mudavym",
      listUnsubscribe: { url: URL_OK, oneClick: true },
    });
    const h = headersOf(mime);
    expect(h).toContain("From: Mudavym <notifications@mudavym.test>");
    expect(h).toContain(`List-Unsubscribe: <${URL_OK}>`);
    expect(h).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  });

  it("a display name with a comma is quoted in the raw header, so the From line stays one mailbox", () => {
    const mime: string = (service() as any).createMimeMessage({
      to: ["ana@house.test"],
      subject: "s",
      html: "<p>x</p>",
      fromName: "Meyhouse, Palo Alto",
    });
    const from = headersOf(mime).filter((l) => l.startsWith("From: "));
    expect(from).toEqual([
      'From: "Meyhouse, Palo Alto" <notifications@mudavym.test>',
    ]);
  });
});

describe("the SMTP fallback path", () => {
  beforeEach(() => sendMail.mockClear());

  it("carries the same From name and unsubscribe headers", async () => {
    const svc = service({
      GMAIL_USER: "u@x.test",
      GMAIL_APP_PASSWORD: "app-pass",
    });
    const result = await svc.sendEmail({
      to: ["ana@house.test"],
      subject: "Mudavym: digest",
      html: "<p>x</p>",
      fromName: "Mudavym",
      listUnsubscribe: { url: URL_OK, oneClick: true },
    });
    expect(result.success).toBe(true);
    const opts = sendMail.mock.calls[0][0];
    expect(opts.from).toBe('"Mudavym" <notifications@mudavym.test>');
    expect(opts.headers).toEqual({
      "List-Unsubscribe": `<${URL_OK}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("an existing caller's SMTP mail is unchanged", async () => {
    const svc = service({
      GMAIL_USER: "u@x.test",
      GMAIL_APP_PASSWORD: "app-pass",
    });
    await svc.sendEmail({ to: ["a@b.test"], subject: "s", html: "<p>x</p>" });
    const opts = sendMail.mock.calls[0][0];
    expect(opts.from).toBe('"WineOps AI" <notifications@mudavym.test>');
    expect(opts.headers).toEqual({});
  });

  it("with no delivery method configured, the answer is a failure — never a mock success", async () => {
    const result = await service().sendEmail({
      to: ["a@b.test"],
      subject: "s",
      html: "<p>x</p>",
    });
    expect(result.success).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
