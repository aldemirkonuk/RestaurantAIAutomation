/**
 * ADR 0170 — a vendor-bound email body is text, never markup.
 *
 * Asserted at the wire: what GmailService.sendEmail receives from
 * sendProviderEmail(buildEmailHtml(body)). All four vendor send paths
 * (approveDraft, the scheduled auto-send, the manual reply and the deal
 * confirmation) build their HTML through buildEmailHtml.
 *
 * Before the fix a body matching /<[a-z]…>/ went out verbatim, and plain text
 * was wrapped without escaping, so an edited or LLM-drafted "<a href=…>"
 * reached the vendor as a live link under the restaurant's name.
 *
 * Run:
 *   cd apps/api-gateway && npx jest --testPathPattern vendor-mail-is-escaped
 */

import { ProcurementService } from "./procurement.service";

function harness() {
  const sendEmail = jest.fn().mockResolvedValue({ success: true });
  const svc = Object.create(ProcurementService.prototype) as any;
  svc.gmailService = { sendEmail };
  svc.inboundAddress = undefined;
  const send = async (
    body: string,
    extra: { recipientFirstName?: string; senderName?: string } = {},
  ): Promise<string> => {
    await svc.sendProviderEmail({
      to: "vendor@example.com",
      subject: "Order",
      html: svc.buildEmailHtml(body),
      ...extra,
    });
    return sendEmail.mock.calls[0][0].html as string;
  };
  return { send };
}

describe("vendor mail is escaped (ADR 0170)", () => {
  it("sends an HTML-looking body as visible text, not markup", async () => {
    const html = await harness().send(
      'Hi there,\n\nPlease pay here: <a href="https://evil.example">invoice</a>',
    );
    expect(html).not.toContain("<a ");
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
  });

  it("escapes plain text that carries angle brackets or ampersands", async () => {
    const html = await harness().send("Qty < 5 & price > $10\nthanks");
    expect(html).toContain("Qty &lt; 5 &amp; price &gt; $10<br>thanks");
    expect(html).not.toMatch(/<(?!\/?p\b|br>)/);
  });

  it("keeps the paragraph shape of plain text", async () => {
    const html = await harness().send("Hi there,\n\nLine one\nLine two");
    expect(html).toBe(
      '<p style="margin:0 0 1em 0">Hi there,</p>' +
        '<p style="margin:0 0 1em 0">Line one<br>Line two</p>',
    );
  });

  it("escapes the vendor first name spliced into the greeting", async () => {
    const html = await harness().send("Hi there,\n\nOrder attached.", {
      recipientFirstName: "<img src=x onerror=alert(1)>",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("Hi &lt;img");
  });

  it("does not read $ patterns in a vendor name as replacement tokens", async () => {
    const html = await harness().send("Hi there,\n\nOrder attached.", {
      recipientFirstName: "$&$1",
    });
    expect(html).toContain("Hi $&amp;$1,");
  });

  it("does not read $ patterns in the sender name as replacement tokens", async () => {
    const html = await harness().send("Thanks,\n[Manager Name]", {
      senderName: "$&$1 Wines",
    });
    expect(html).toContain("<br>$&amp;$1 Wines</p>");
  });

  it("escapes the sender name substituted for a signature placeholder", async () => {
    const html = await harness().send("Thanks,\n[Manager Name]", {
      senderName: '<script>x</script> & "Co"',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; &quot;Co&quot;");
  });
});
