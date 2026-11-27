/**
 * g6a (r106): outbound attachments — multipart/mixed, 3 files, 5 MB, owner and
 * manager only, uploaded bytes only. Every assertion reads the message the way
 * a receiver would: split on the declared boundary, decode each part's base64.
 */
jest.mock("googleapis", () => ({ google: {} }));

import { ConfigService } from "@nestjs/config";
import { GmailService } from "./gmail.service";
import { sendThroughGrant } from "./letters/house-letters.service";
import {
  assertMayAttach,
  AttachmentRefusedError,
  type CheckedAttachments,
  OUTBOUND_ATTACHMENT_MAX_BYTES,
  type OutboundAttachment,
} from "./mime-attachments";

const file = (name: string, n = 10, type = "application/pdf"): OutboundAttachment => ({
  filename: name,
  contentType: type,
  content: Buffer.alloc(n, 7),
});

function split(raw: string) {
  const i = raw.indexOf("\r\n\r\n");
  return { head: raw.slice(0, i), body: raw.slice(i + 4) };
}
function boundaryOf(head: string) {
  const m = /Content-Type: multipart\/(\w+); boundary="([^"]+)"/.exec(head);
  return m ? { kind: m[1], boundary: m[2] } : null;
}
function parts(body: string, boundary: string) {
  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((p) => p.replace(/^\r\n/, "").replace(/\r\n$/, ""));
}

/** The caller's step: ask the role. Over-limit sets stay unchecked so the builder's refusal is what is tested. */
function asked(files?: OutboundAttachment[]): CheckedAttachments | undefined {
  if (!files) return undefined;
  try {
    return assertMayAttach("owner", files);
  } catch {
    return files as unknown as CheckedAttachments;
  }
}

async function viaGmail(files?: OutboundAttachment[]) {
  const attachments = asked(files);
  const send = jest.fn(async (_a: { requestBody: { raw: string } }) => ({
    data: { id: "g1", threadId: "t1" },
  }));
  const svc = new GmailService({ get: () => undefined } as unknown as ConfigService);
  const s = svc as unknown as Record<string, unknown>;
  s.isConfigured = true;
  s.senderEmail = "house@example.com";
  s.gmail = { users: { messages: { send } } };
  const result = await svc.sendEmail({
    to: ["a@vendor.example"],
    subject: "Order",
    html: "<p>Hello</p>",
    attachments,
  });
  const raw = send.mock.calls.length
    ? Buffer.from(send.mock.calls[0][0].requestBody.raw, "base64url").toString("latin1")
    : "";
  return { result, raw, send };
}

async function viaGmailRaw(attachments: CheckedAttachments) {
  const send = jest.fn(async () => ({ data: { id: "g1", threadId: "t1" } }));
  const svc = new GmailService({ get: () => undefined } as unknown as ConfigService);
  const s = svc as unknown as Record<string, unknown>;
  s.isConfigured = true;
  s.senderEmail = "house@example.com";
  s.gmail = { users: { messages: { send } } };
  const result = await svc.sendEmail({ to: ["a@vendor.example"], subject: "Order", html: "<p>Hello</p>", attachments });
  return { result, send };
}

async function viaGrant(files?: OutboundAttachment[]) {
  const attachments = asked(files);
  let body = "";
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    body = String(init.body);
    return { ok: true, status: 200, json: async () => ({ id: "x" }), text: async () => "" };
  }) as unknown as typeof fetch;
  await sendThroughGrant({
    token: "t",
    from: "House <house@example.com>",
    to: "a@vendor.example",
    subject: "Order",
    text: "Hello there",
    attachments,
    fetchImpl,
  });
  return Buffer.from(JSON.parse(body).raw as string, "base64url").toString("latin1");
}

describe("g6a outbound attachments", () => {
  it("shared mailbox: files make multipart/mixed with the alternative first", async () => {
    const { result, raw } = await viaGmail([file("menu.pdf", 20)]);
    expect(result.success).toBe(true);
    const { head, body } = split(raw);
    const outer = boundaryOf(head)!;
    expect(outer.kind).toBe("mixed");
    const [first, second] = parts(body, outer.boundary);
    expect(first).toContain("Content-Type: multipart/alternative");
    expect(second).toContain("Content-Type: application/pdf");
    expect(second).toContain('filename="menu.pdf"');
    const b64 = second.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(b64, "base64").equals(Buffer.alloc(20, 7))).toBe(true);
  });

  it("house grant: text/plain first, then the file", async () => {
    const raw = await viaGrant([file("a.pdf"), file("b.png", 5, "image/png")]);
    const { head, body } = split(raw);
    const outer = boundaryOf(head)!;
    expect(outer.kind).toBe("mixed");
    const ps = parts(body, outer.boundary);
    expect(ps).toHaveLength(3);
    expect(ps[0]).toContain("text/plain");
    expect(ps[2]).toContain("image/png");
  });

  it("no files keeps the single-part and alternative shapes", async () => {
    const { raw } = await viaGmail();
    expect(boundaryOf(split(raw).head)!.kind).toBe("alternative");
    expect(await viaGrant()).toContain('Content-Type: text/plain; charset="UTF-8"');
  });

  it("refuses over 5 MB together, and sends nothing", async () => {
    const big = [file("a", OUTBOUND_ATTACHMENT_MAX_BYTES), file("b", 1)];
    const { result, send } = await viaGmail(big);
    expect(result.success).toBe(false);
    expect(send).not.toHaveBeenCalled();
    await expect(viaGrant(big)).rejects.toBeInstanceOf(AttachmentRefusedError);
    expect(() => assertMayAttach("owner", big)).toThrow(expect.objectContaining({ refusal: "too_big" }));
    expect(() => assertMayAttach("owner", big)).toThrow(/MB/);
  });

  it("accepts exactly 5 MB across 3 files", async () => {
    const each = OUTBOUND_ATTACHMENT_MAX_BYTES / 4;
    const ok = [file("a", each), file("b", each), file("c", each * 2)];
    expect((await viaGmail(ok)).result.success).toBe(true);
  });

  it("refuses a 4th file rather than dropping it", async () => {
    const four = [file("1"), file("2"), file("3"), file("4")];
    expect(() => assertMayAttach("owner", four)).toThrow(AttachmentRefusedError);
    expect(() => assertMayAttach("manager", four)).toThrow(/3 files/);
    const { result, send } = await viaGmail(four);
    expect(result.success).toBe(false);
    expect(send).not.toHaveBeenCalled();
    await expect(viaGrant(four)).rejects.toBeInstanceOf(AttachmentRefusedError);
    expect(() => assertMayAttach("owner", four)).toThrow(expect.objectContaining({ refusal: "too_many" }));
  });

  it("refuses staff (and a missing role) with files; staff may still write plain letters", () => {
    expect(() => assertMayAttach("staff", [file("a")])).toThrow(
      expect.objectContaining({ refusal: "staff" }),
    );
    expect(() => assertMayAttach(undefined, [file("a")])).toThrow(AttachmentRefusedError);
    expect(() => assertMayAttach("staff", [])).not.toThrow();
    expect(() => assertMayAttach("staff", undefined)).not.toThrow();
    expect(() => assertMayAttach("owner", [file("a")])).not.toThrow();
    expect(() => assertMayAttach("Manager", [file("a")])).not.toThrow();
  });

  it("a file name cannot start a header or name a path", async () => {
    const raw = await viaGrant([file('x"\r\nBcc: evil@e.example\r\n/../../etc/passwd.pdf')]);
    const { head, body } = split(raw);
    expect(head).not.toMatch(/^Bcc:/m);
    const filePart = parts(body, boundaryOf(head)!.boundary)[1];
    expect(filePart.split("\r\n\r\n")[0]).not.toMatch(/^Bcc:/m);
    expect(filePart).not.toContain("..");
  });

  it("a caller that never asked the role has no way to send a file", async () => {
    // a staff member's files, passed straight to both builders and cast past the type
    const unchecked = [file("a.pdf")] as unknown as CheckedAttachments;
    const { result, send } = await viaGmailRaw(unchecked);
    expect(result.success).toBe(false);
    expect(send).not.toHaveBeenCalled();
    await expect(sendThroughGrant({
      token: "t", from: "House <house@example.com>", to: "a@vendor.example", subject: "x", text: "y", attachments: unchecked,
      fetchImpl: (async () => ({ ok: true })) as unknown as typeof fetch,
    })).rejects.toMatchObject({ refusal: "unchecked" });
  });
});
