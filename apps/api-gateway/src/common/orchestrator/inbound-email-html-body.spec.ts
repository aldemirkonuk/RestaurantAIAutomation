/**
 * `InboundEmailController.normalizePayload()`'s HTML-only fallback.
 *
 * [Audit of PR #435 at a229848f3, 2026-09-26: this fell back to raw
 * `HtmlBody`/`html` with NO text conversion — worse than gmail-mime.ts's own
 * bug, since it did not even flatten tags. A vendor reply arriving through
 * this webhook path (Postmark/SES/Mailgun/Cloudflare, "dual-run" alongside
 * Gmail) with no plain-text part would push raw HTML — no newlines a
 * quoted-thread cut can match — into the same `email.inbound.received` event
 * the Gmail path feeds, reaching the same Jev egress in `vendor-tone/`
 * unprotected. This pins the fix: it now runs through the SAME `htmlToText`
 * gmail-mime.ts uses, so both ingest paths hand `latestPart()` the same
 * newline-delimited shape.]
 */

import { InboundEmailController } from "./inbound-email.controller";
import { latestPart } from "../../vendor-tone/tone-scale";

function makeController(): InboundEmailController {
  const configStub = { get: () => undefined } as any;
  const orchestratorStub = { publishEvent: async () => undefined } as any;
  const inboundAddressStub = { resolveRestaurantId: async () => null } as any;
  return new InboundEmailController(
    configStub,
    orchestratorStub,
    inboundAddressStub,
  );
}

describe("InboundEmailController.normalizePayload — HTML-only body", () => {
  it("converts HtmlBody to text with newlines, not raw markup", () => {
    const controller = makeController();
    const norm = (controller as any).normalizePayload({
      From: "vendor@example.com",
      Subject: "Re: order",
      HtmlBody: "<p>Line one</p><p>Line two</p>",
    });
    expect(norm.body).toBe("Line one\nLine two");
    expect(norm.body).not.toMatch(/<[^>]+>/);
  });

  it("keeps the newline shape a quoted-thread cut needs (the defect this pins)", () => {
    const controller = makeController();
    const html =
      "<div>We can meet that price.</div>" +
      "<div><br></div>" +
      "<div>On Thu, Sep 25, 2026 at 9:00 AM, House Manager &lt;manager@house.example&gt; wrote:</div>" +
      "<blockquote>Our disputed invoice #4471 still shows a $200 balance.</blockquote>";
    const norm = (controller as any).normalizePayload({
      From: "vendor@example.com",
      Subject: "Re: order",
      HtmlBody: html,
    });
    expect(norm.body).toContain("\n");
    const cut = latestPart(norm.body);
    expect(cut).toBe("We can meet that price.");
    expect(cut).not.toMatch(/\$200 balance/);
  });

  it("still prefers TextBody when both are present (unchanged behaviour)", () => {
    const controller = makeController();
    const norm = (controller as any).normalizePayload({
      From: "vendor@example.com",
      Subject: "Re: order",
      TextBody: "Plain wins.",
      HtmlBody: "<p>HTML loses.</p>",
    });
    expect(norm.body).toBe("Plain wins.");
  });
});
