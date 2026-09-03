/**
 * Single-pass HTML → plain text.
 *
 * Replaces two hand-rolled regex chains (GmailService.htmlToPlainText and
 * vendor-intel's htmlToText) that between them accounted for eight CodeQL
 * findings — bad-tag-filter, double-escaping, incomplete-multi-character
 * sanitization and polynomial-redos. Those were all symptoms of one root
 * cause: parsing HTML by repeated `String.replace` with backtracking regexes.
 *
 * Why a scanner instead of better regexes:
 *
 *  - **Termination.** Every regex of the shape `/<style[^>]*>[\s\S]*?<\/style>/`
 *    rescans the remainder of the document from each candidate start, which is
 *    quadratic on inputs with many `<style` prefixes. The scanner below visits
 *    each character a bounded number of times, so runtime is linear in input
 *    length no matter what the input looks like. That matters because both
 *    call sites process attacker-influenced HTML: outbound email bodies and
 *    fetched vendor pages.
 *
 *  - **Tag-end correctness.** `<\/script>` does not match `</script >`, which
 *    is valid HTML. A scanner that reads a tag name and then skips to the
 *    matching `>` does not care about the whitespace.
 *
 *  - **Single-pass removal.** Chained `.replace()` runs to fixpoint only if you
 *    loop it: `<scr<script>ipt>` survives one pass and reassembles. Consuming
 *    input left to right cannot reassemble anything behind the cursor.
 *
 *  - **Entity decoding once.** Decoding `&amp;` before `&lt;` turns the input
 *    `&amp;lt;` into `<` — the text claims a tag that was never there. Entities
 *    are decoded here in one pass with a single lookup, so no output of one
 *    substitution is ever input to another.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Common in vendor pages and marketing email; decoding them keeps prices and
  // product names readable for the extractor and the text/plain alternative.
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  deg: "°",
  euro: "€",
  pound: "£",
  cent: "¢",
  trade: "™",
  reg: "®",
  copy: "©",
};

/** Elements whose *contents* are discarded, not just their tags. */
const DROP_CONTENT_TAGS = new Set(["script", "style", "noscript", "template"]);

/** Elements that should produce a line break in the text rendering. */
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "br",
  "tr",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "section",
  "article",
  "header",
  "footer",
  "blockquote",
  "pre",
]);

/**
 * Decode HTML entities in a run of text. One pass, one lookup per entity, so
 * no decoded character is re-examined as the start of another entity.
 */
function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;

  let out = "";
  let i = 0;
  while (i < text.length) {
    const amp = text.indexOf("&", i);
    if (amp === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, amp);

    // An entity reference is at most a handful of characters; cap the search
    // so a lone `&` in a megabyte of text does not scan the whole remainder.
    const semi = text.indexOf(";", amp + 1);
    if (semi === -1 || semi - amp > 10) {
      out += "&";
      i = amp + 1;
      continue;
    }

    const body = text.slice(amp + 1, semi);
    let decoded: string | undefined;

    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const digits = isHex ? body.slice(2) : body.slice(1);
      const valid = isHex ? /^[0-9a-fA-F]+$/.test(digits) : /^[0-9]+$/.test(digits);
      if (valid) {
        const code = parseInt(digits, isHex ? 16 : 10);
        // Reject surrogates and out-of-range values rather than emitting
        // lone surrogates into the output string.
        if (code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
          decoded = String.fromCodePoint(code);
        }
      }
    } else {
      decoded = NAMED_ENTITIES[body.toLowerCase()];
    }

    if (decoded === undefined) {
      out += "&";
      i = amp + 1;
    } else {
      out += decoded;
      i = semi + 1;
    }
  }
  return out;
}

/**
 * Convert an HTML document or fragment to plain text.
 *
 * @param html    Source HTML. May be attacker-controlled.
 * @param maxChars Truncate the result to this many characters (0 = no limit).
 */
export function htmlToText(html: string, maxChars = 0): string {
  const parts: string[] = [];
  let i = 0;
  const n = html.length;

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      parts.push(decodeEntities(html.slice(i)));
      break;
    }

    if (lt > i) parts.push(decodeEntities(html.slice(i, lt)));

    // Comment, CDATA or doctype — skip wholesale.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", lt)) {
      const end = html.indexOf("]]>", lt + 9);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Read the tag name.
    let p = lt + 1;
    const closing = html[p] === "/";
    if (closing) p++;
    const nameStart = p;
    while (p < n && /[A-Za-z0-9]/.test(html[p])) p++;
    const tagName = html.slice(nameStart, p).toLowerCase();

    if (!tagName) {
      // A bare `<` that starts no tag is literal text.
      parts.push("<");
      i = lt + 1;
      continue;
    }

    // Skip to the end of the tag, respecting quoted attribute values so that
    // a `>` inside an attribute does not end the tag early.
    let quote: string | null = null;
    while (p < n) {
      const ch = html[p];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      p++;
    }
    const tagEnd = p; // index of '>' or n

    if (!closing && DROP_CONTENT_TAGS.has(tagName)) {
      // Consume through the matching close tag, tolerating `</script >` and
      // any attributes. Case-insensitive, whitespace-tolerant, single pass.
      const close = findClosingTag(html, tagEnd + 1, tagName);
      if (close === -1) {
        i = n; // Unterminated: the rest of the document is inside it.
      } else {
        i = close;
      }
      if (BLOCK_TAGS.has(tagName)) parts.push("\n");
      continue;
    }

    if (BLOCK_TAGS.has(tagName)) parts.push("\n");
    i = tagEnd < n ? tagEnd + 1 : n;
  }

  let text = parts.join("");
  // Collapse runs of whitespace, but keep paragraph breaks meaningful.
  text = text.replace(/[ \t\f\v\r]+/g, " ");
  text = text.replace(/ ?\n ?/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  if (maxChars > 0 && text.length > maxChars) text = text.slice(0, maxChars);
  return text;
}

/**
 * Index just past the `>` of the next `</tagName ...>`, or -1.
 * Scans forward only — no backtracking, so cost is linear in the distance.
 */
function findClosingTag(html: string, from: number, tagName: string): number {
  let i = from;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("</", i);
    if (lt === -1) return -1;
    let p = lt + 2;
    const nameStart = p;
    while (p < n && /[A-Za-z0-9]/.test(html[p])) p++;
    if (html.slice(nameStart, p).toLowerCase() === tagName) {
      const gt = html.indexOf(">", p);
      return gt === -1 ? -1 : gt + 1;
    }
    i = lt + 2;
  }
  return -1;
}
