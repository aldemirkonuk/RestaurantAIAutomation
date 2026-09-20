/**
 * The one HTML escaper for outbound mail (ADR 0170).
 *
 * Every string that reaches an email's HTML from outside this codebase — a
 * vendor name, a manager's edited draft, an LLM's wording — goes through
 * `escapeHtml` or `textToEmailHtml`. Neither ever lets markup through: a body
 * that *looks* like HTML is text that happens to contain angle brackets, and
 * the recipient sees the brackets. See the ADR for why there is no allowlist
 * sanitiser here.
 */

/** Escape the five characters that let text change the shape of HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Plain text → email HTML: escape first, then paragraphise (blank line =
 * paragraph, single newline = <br>). The only markup in the output is the
 * markup this function writes.
 */
export function textToEmailHtml(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 0)
    .map(
      (p) =>
        `<p style="margin:0 0 1em 0">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}
