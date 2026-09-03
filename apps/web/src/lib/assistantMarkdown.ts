/**
 * Minimal, escape-first renderer for assistant chat messages.
 *
 * Why escape-first
 * ---------------
 * The previous implementation ran `message.content` through a chain of
 * markdown-ish `.replace()` calls and handed the result straight to
 * `dangerouslySetInnerHTML`. Nothing escaped the input, so any `<` in the
 * model's output reached the DOM as markup — `<img src=x onerror=...>` in an
 * assistant turn is script execution in the user's authenticated session.
 *
 * That content is not trustworthy just because it comes from our own model:
 * the prompt is built from wine names, vendor names and user questions, all of
 * which an attacker can influence, and the reply is rendered verbatim.
 *
 * So: escape the whole string first, then re-introduce the small, fixed set of
 * tags we actually want. After escaping there are no raw `<` characters left,
 * which means the markdown patterns can only ever produce the tags written
 * here — the output tag set is closed by construction rather than by trying to
 * enumerate what to strip.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Render a chat message to HTML safe for `dangerouslySetInnerHTML`.
 *
 * Supports the same subset the UI supported before: `##`/`###` headings,
 * `**bold**`, `*italic*`, and `-` / `1.` list items.
 */
export function renderAssistantMarkdown(content: string): string {
  return (
    escapeHtml(content)
      .replace(
        /^### (.+)$/gm,
        '<h3 class="text-lg font-semibold text-white mt-4 mb-2">$1</h3>',
      )
      .replace(
        /^## (.+)$/gm,
        '<h2 class="text-xl font-bold text-white mt-4 mb-3">$1</h2>',
      )
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
      .replace(/\*(.+?)\*/g, '<em class="text-gray-400">$1</em>')
      .replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
  );
}
