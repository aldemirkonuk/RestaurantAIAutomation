/**
 * One stored shape for a letter's Message-ID (rfc822-message-id.ts), and the
 * inbound webhook door that stored Postmark's delivery UUID in its place.
 *
 * The orchestrator's copy of the rule is pinned by
 * services/agent-orchestrator/tests/test_rfc822_message_id.py with the same
 * table; the SQL backfill by supabase/tests/20270625100000_*_test.sql (both on
 * the stacked follow-up branch fix/mail-message-id-backfill).
 */

import { canonicalMessageId } from "./rfc822-message-id";
import { messageIdHeader, threadingHeader } from "./mime-headers";
import { InboundEmailController } from "../common/orchestrator/inbound-email.controller";

describe("canonicalMessageId", () => {
  it.each([
    ["<abc@x.example>", "<abc@x.example>"],
    ["abc@x.example", "<abc@x.example>"],
    [" < Sp@x.example >\r\n", "<Sp@x.example>"],
    ["junk <First@x.example> <second@x.example>", "<First@x.example>"],
    ["<unclosed@x.example", "<unclosed@x.example>"],
    ["closed@x.example>", "<closed@x.example>"],
    ["\tfold@x.example\r\n ", "<fold@x.example>"],
    ['<"a b"@x.example>', '<"a b"@x.example>'],
    ["< >  <real@x.example>", "<real@x.example>"],
    ["22c74902-a0c1-4511-804f-341342852c90", "<22c74902-a0c1-4511-804f-341342852c90>"],
  ])("%j is stored as %j", (raw, stored) => {
    expect(canonicalMessageId(raw)).toBe(stored);
  });

  it.each([[""], ["   "], ["<>"], ["< >"], [null], [undefined], [42]])(
    "%j holds no id: null",
    (raw) => {
      expect(canonicalMessageId(raw)).toBeNull();
    },
  );

  it("keeps case: the id is echoed back to the vendor's client as written", () => {
    expect(canonicalMessageId("CAGXpo2W+5AX@Mail.Gmail.com")).toBe(
      "<CAGXpo2W+5AX@Mail.Gmail.com>",
    );
  });

  it("is idempotent", () => {
    for (const raw of ["a@b", "<a@b>", " x <a@b> ", "<a@b"]) {
      const once = canonicalMessageId(raw);
      expect(canonicalMessageId(once)).toBe(once);
    }
  });

  it("a bracketed header value and the bare stored id are one id", () => {
    expect(canonicalMessageId("<v1@vendor.example>")).toBe(
      canonicalMessageId("v1@vendor.example"),
    );
  });
});

describe("the stored shape on the wire", () => {
  it("a bare stored id was dropped from In-Reply-To; its stored shape is kept", () => {
    // The defect: threadingHeader keeps only <...> tokens.
    expect(threadingHeader("In-Reply-To", "v1@vendor.example")).toBeNull();
    expect(
      threadingHeader("In-Reply-To", canonicalMessageId("v1@vendor.example")),
    ).toBe("In-Reply-To: <v1@vendor.example>");
  });

  it("our minted Message-ID goes out unchanged, brackets kept", () => {
    const minted = "<mudavym-0b1c2d3e-0000-4000-8000-000000000000@wineops.ai>";
    expect(canonicalMessageId(minted)).toBe(minted);
    expect(messageIdHeader("Message-ID", canonicalMessageId(minted)!)).toBe(
      `Message-ID: ${minted}`,
    );
  });
});

describe("InboundEmailController.normalizePayload — the letter's own Message-ID", () => {
  const controller = new InboundEmailController(
    { get: () => undefined } as any,
    { publishEvent: async () => undefined } as any,
    { resolveRestaurantId: async () => null } as any,
  );
  const normalize = (b: any) => (controller as any).normalizePayload(b);

  it("takes the Message-ID header, not Postmark's delivery UUID", () => {
    const norm = normalize({
      From: "vendor@example.com",
      MessageID: "22c74902-a0c1-4511-804f-341342852c90",
      Headers: [{ Name: "Message-ID", Value: "<CAGXpo2W@mail.gmail.com>" }],
    });
    expect(norm.messageId).toBe("<CAGXpo2W@mail.gmail.com>");
  });

  it("stores a bare header id in the bracketed shape", () => {
    const norm = normalize({
      from: "vendor@example.com",
      headers: { "message-id": "  bare@vendor.example " },
    });
    expect(norm.messageId).toBe("<bare@vendor.example>");
  });

  it("falls back to Postmark's id only when the letter carries none", () => {
    const norm = normalize({
      From: "vendor@example.com",
      MessageID: "22c74902-a0c1-4511-804f-341342852c90",
    });
    expect(norm.messageId).toBe("<22c74902-a0c1-4511-804f-341342852c90>");
  });

  it("no id at all is an empty string, as before", () => {
    expect(normalize({ From: "vendor@example.com" }).messageId).toBe("");
  });
});
