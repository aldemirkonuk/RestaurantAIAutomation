import { escapeHtml, textToEmailHtml } from "./escape-html";

describe("escapeHtml (ADR 0170)", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes & first, so an entity in the input stays visible text", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("renders null and undefined as empty, numbers as text", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("textToEmailHtml (ADR 0170)", () => {
  it("escapes before it paragraphises, so the only tags are its own", () => {
    const out = textToEmailHtml("<b>hi</b>\n\n<script>x</script>");
    expect(out).toBe(
      '<p style="margin:0 0 1em 0">&lt;b&gt;hi&lt;/b&gt;</p>' +
        '<p style="margin:0 0 1em 0">&lt;script&gt;x&lt;/script&gt;</p>',
    );
  });

  it("treats CRLF like LF and drops blank paragraphs", () => {
    expect(textToEmailHtml("a\r\nb\r\n\r\n\r\n  \n\nc")).toBe(
      '<p style="margin:0 0 1em 0">a<br>b</p><p style="margin:0 0 1em 0">c</p>',
    );
  });

  it("returns empty for an empty body", () => {
    expect(textToEmailHtml("")).toBe("");
    expect(textToEmailHtml(null)).toBe("");
  });
});
