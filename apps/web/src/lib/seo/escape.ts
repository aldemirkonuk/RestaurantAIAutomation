/**
 * Escaping for text that lands in served HTML.
 *
 * Two contexts, two rules. A vendor's display name reaches a crawler twice on
 * `/v/:slug`: once as HTML text or an attribute value, once inside a
 * `<script type="application/ld+json">` block. HTML-escaping is wrong for the
 * second (JSON-LD is raw text; `&amp;` would be published literally) and
 * JSON.stringify alone is wrong for it too: it leaves `</script>` intact, so a
 * name of `</script><script>...` would end the block and run. These pages are
 * unauthenticated, so this is the whole XSS surface of the crawl layer.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text or a double/single-quoted attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * JSON for a `<script type="application/ld+json">` body.
 *
 * `<`, `>` and `&` become `<`-style escapes, which every JSON parser reads
 * back as the same character, so the published data is unchanged while no
 * sequence can close the script element or open a comment. U+2028 and U+2029
 * are escaped because older JavaScript engines treat them as line terminators
 * inside a string literal.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Cut `text` to at most `max` characters at a word boundary, for
 * descriptions. Whitespace is collapsed first so a vendor's line breaks do
 * not reach a search snippet.
 */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}
