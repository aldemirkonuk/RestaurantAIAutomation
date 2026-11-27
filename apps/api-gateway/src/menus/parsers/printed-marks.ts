/**
 * The marks a menu PRINTS beside a line (r108 menu-g10): a legend symbol or
 * words such as V, VG, GF, a chilli, "contains nuts".
 *
 * The session's call: a mark is kept only when its token appears in the
 * line's own raw text, the text the gateway holds for that line (a CSV row,
 * or the line a scan transcribes because it prints a mark). A mark the reader
 * worked out from the dish's name is not on the line's text and is dropped.
 * Rejected: inference ("a wrong 'no nuts' is a safety harm"; SOTA parsers'
 * EU-14 allergen tags are estimates "with confidence"), and a fixed EU-14
 * enum (a meyhane prints its own legend). Absence is never "free of".
 */

export const MAX_PRINTED_MARKS = 12;
export const MAX_MARK_CHARS = 40;
export const MAX_DESCRIPTION_CHARS = 1000;

/** A mark's token is on the text when it is not part of a longer word: "V" is in "(V, GF)", not in "Vino". */
export function markIsPrinted(mark: string, rawText: string | null | undefined): boolean {
  if (!rawText || !mark) return false;
  const escaped = mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(rawText);
}

/** A cell or a string of marks, split on , ; | and slashes. */
export function splitMarks(text: string): string[] {
  return text
    .split(/[,;|/]/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

/**
 * The marks of one line that may be stored: strings, trimmed, de-duplicated,
 * 1 to 40 characters, each found on the line's raw text. More than 12 such
 * marks is not a line's marks (it is a legend read onto a line) and is
 * refused whole: null, never the first twelve, so no printed mark is quietly
 * dropped. null when none is left.
 */
export function keepPrintedMarks(marks: unknown, rawText: string | null | undefined): string[] | null {
  const list = Array.isArray(marks) ? marks : typeof marks === "string" ? splitMarks(marks) : [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const m of list) {
    if (typeof m !== "string") continue;
    const mark = m.trim();
    if (mark.length === 0 || mark.length > MAX_MARK_CHARS) continue;
    const key = mark.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (markIsPrinted(mark, rawText)) kept.push(mark);
  }
  if (kept.length === 0 || kept.length > MAX_PRINTED_MARKS) return null;
  return kept;
}

/** A printed description, trimmed and at most 1000 characters; null when there is none. */
export function keepDescription(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > MAX_DESCRIPTION_CHARS ? `${t.slice(0, MAX_DESCRIPTION_CHARS - 1)}…` : t;
}
