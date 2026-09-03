import { htmlToText } from "./html-to-text";

/**
 * Regression tests for ADR 0100. Each block names the CodeQL rule whose
 * finding it closes; the inputs are the exact bypasses the old regex chains
 * admitted, so these fail against the pre-fix implementation.
 */
describe("htmlToText", () => {
  describe("js/bad-tag-filter", () => {
    it("removes a script element whose close tag has trailing space", () => {
      // /<\/script>/ does not match "</script >" — the old chain left the
      // script body in the output.
      const out = htmlToText("<script >alert(1)</script >tail");
      expect(out).not.toContain("alert(1)");
      expect(out).toBe("tail");
    });

    it("removes a style element whose close tag has trailing space", () => {
      const out = htmlToText("<style >.x{color:red}</style >Hello");
      expect(out).not.toContain("color:red");
      expect(out).toBe("Hello");
    });

    it("removes a script tag carrying attributes", () => {
      const out = htmlToText('<script type="text/javascript">evil()</script>ok');
      expect(out).not.toContain("evil()");
      expect(out).toBe("ok");
    });
  });

  describe("js/incomplete-multi-character-sanitization", () => {
    it("does not let a nested tag reassemble after removal", () => {
      // A single-pass .replace() of /<[^>]+>/ turns "<scr<script>ipt>" into
      // "<script>" — the sanitizer builds the tag it was removing.
      //
      // The property that matters is that no executable markup survives into
      // the output, not that every character which *looks* like code is
      // erased: the result is text/plain, so a literal "alert(1)" in it is
      // just letters. The scanner consumes "<scr<script>" as one malformed
      // tag (the first unquoted '>' ends it), leaving "ipt>alert(1)" as text.
      const out = htmlToText("<scr<script>ipt>alert(1)</script>done");
      expect(out).not.toContain("<script>");
      expect(out).not.toContain("<scr");
      expect(out).toBe("ipt>alert(1)done");
    });
  });

  describe("js/double-escaping", () => {
    it("decodes each entity exactly once", () => {
      // Decoding &amp; before &lt; rewrites "&amp;lt;" into "<", inventing a
      // tag the document never contained.
      expect(htmlToText("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
    });

    it("decodes ordinary entities", () => {
      expect(htmlToText("Caf&eacute; &amp; Co")).toBe("Café & Co");
    });

    it("decodes numeric and hex references", () => {
      expect(htmlToText("&#8364;5 &#x20AC;6")).toBe("€5 €6");
    });

    it("leaves a bare ampersand alone", () => {
      expect(htmlToText("Tom & Jerry")).toBe("Tom & Jerry");
    });
  });

  describe("js/polynomial-redos", () => {
    it("stays linear on many '<style' prefixes", () => {
      // The old /<style[^>]*>[\s\S]*?<\/style>/ rescanned to end-of-input from
      // every '<style'. Assert the growth curve, not absolute time, so this is
      // not a machine-speed benchmark.
      const time = (n: number) => {
        const input = "<style".repeat(n);
        const start = Date.now();
        htmlToText(input);
        return Date.now() - start;
      };
      const small = time(20000);
      const large = time(80000);
      // 4x input. Quadratic would be ~16x. Floor of 50ms absorbs timer noise
      // on a fast machine where both readings round to 0.
      expect(large).toBeLessThan(Math.max(small * 8, 50));
    });

    it("terminates on an unterminated style element", () => {
      expect(htmlToText("<style>.x{" + "a".repeat(1000))).toBe("");
    });
  });

  describe("structure and content", () => {
    it("keeps text and breaks blocks onto separate lines", () => {
      // Open and close of a block each contribute a break, so paragraphs end
      // up separated by a blank line — the normal shape for a text/plain
      // alternative.
      expect(htmlToText("<p>Hello</p><p>World</p>")).toBe("Hello\n\nWorld");
    });

    it("does not end a tag at a '>' inside a quoted attribute", () => {
      expect(htmlToText('<a title="a>b">link</a>')).toBe("link");
    });

    it("drops comments including anything that looks like markup inside", () => {
      expect(htmlToText("a<!-- <script>x</script> -->b")).toBe("ab");
    });

    it("drops style and script content", () => {
      expect(htmlToText("<style>.x{color:red}</style>Hello")).toBe("Hello");
    });

    it("treats a bare '<' as literal text", () => {
      expect(htmlToText("5 < 10")).toBe("5 < 10");
    });

    it("honours maxChars", () => {
      expect(htmlToText("<p>abcdefghij</p>", 4)).toBe("abcd");
    });

    it("returns empty string for empty input", () => {
      expect(htmlToText("")).toBe("");
    });
  });
});
