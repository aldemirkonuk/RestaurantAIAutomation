/**
 * `extractEmailContent`'s HTML fallback, and the newline shape it hands to
 * `vendor-tone/tone-scale.ts` `latestPart()`.
 *
 * [Audit of PR #435 at a229848f3, 2026-09-26: this file did not exist. An
 * HTML-only vendor reply (no text/plain part — common for ERP/webmail/
 * ticketing senders) was flattened to one line with no newlines at all, so
 * `latestPart()`'s line-based header/"wrote:"/separator cut could never
 * fire, and the whole quoted thread — including the house's own prior
 * negotiation — reached Jev once a house had accepted the data-terms sheet.
 * These tests pin the fix: HTML block boundaries survive as `\n`, so the
 * SAME cut logic that already worked for plain-text mail works here too.]
 */

import { extractEmailContent, GmailPayloadPart, htmlToText } from "./gmail-mime";
import { latestPart } from "../vendor-tone/tone-scale";

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64url");
}

function htmlPart(html: string): GmailPayloadPart {
  return { mimeType: "text/html", body: { data: b64(html) } };
}

describe("htmlToText — block boundaries become newlines, not spaces", () => {
  it("turns <br> and closing block tags into line breaks", () => {
    expect(htmlToText("<p>Line one</p><p>Line two</p>")).toBe(
      "Line one\nLine two",
    );
    expect(htmlToText("Line one<br>Line two<br/>Line three")).toBe(
      "Line one\nLine two\nLine three",
    );
  });

  it("does not glue words across an inline tag", () => {
    expect(htmlToText("Hello<b>world</b>, plain and simple")).toBe(
      "Hello world , plain and simple",
    );
  });

  it("decodes the common entities and collapses only horizontal whitespace", () => {
    expect(htmlToText("Price&nbsp;&amp;&nbsp;terms   &lt;ok&gt;")).toBe(
      "Price & terms <ok>",
    );
  });

  it("collapses runs of blank lines but keeps the paragraph breaks", () => {
    expect(htmlToText("<p>A</p>\n\n\n\n<p>B</p>")).toBe("A\n\nB");
  });
});

describe("extractEmailContent — HTML-only message (no text/plain part)", () => {
  it("renders a plain HTML body down to text unchanged in substance", () => {
    const { text } = extractEmailContent(
      htmlPart("<p>We can do 45 cases at the quoted price.</p>"),
    );
    expect(text).toBe("We can do 45 cases at the quoted price.");
  });

  it("keeps the newline shape a quoted-thread cut needs — the defect this pins", () => {
    // A vendor's rich-compose reply, HTML-only, quoting the house's own prior
    // message underneath — the shape the audit named as reaching production.
    const html =
      "<div>Sure, 45 cases works for us at $18.40/case.</div>" +
      "<div><br></div>" +
      "<div>On Thu, Sep 25, 2026 at 9:00 AM, House Manager &lt;manager@house.example&gt; wrote:</div>" +
      "<blockquote>Can you do 45 cases at $18.40 instead of $19?<br>" +
      "Also our last invoice #4471 still shows a $200 balance we dispute.</blockquote>";

    const { text } = extractEmailContent(htmlPart(html));

    // The HTML fallback must not flatten this to one line...
    expect(text).toContain("\n");
    // ...and once it doesn't, the EXISTING cut logic (unchanged by this fix)
    // keeps only the vendor's own latest words, same as it already does for
    // a plain-text reply in the same shape.
    const cut = latestPart(text);
    expect(cut).toBe("Sure, 45 cases works for us at $18.40/case.");
    expect(cut).not.toMatch(/wrote:/);
    expect(cut).not.toMatch(/\$200 balance/);
    expect(cut).not.toMatch(/invoice #4471/);
  });

  it("still prefers text/plain when both parts are present (unchanged behaviour)", () => {
    const { text } = extractEmailContent({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Plain wins.") } },
        htmlPart("<p>HTML loses.</p>"),
      ],
    });
    expect(text).toBe("Plain wins.");
  });
});
