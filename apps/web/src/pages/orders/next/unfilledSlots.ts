/**
 * Unfilled template slots — "[Provider First Name]", "[Your Name]" — left in a
 * house draft (ORD-W7, 2026-10-01). A hold would send them to the vendor
 * verbatim, so the card names them and keeps both holds shut until the draft
 * is changed. One to four capitalised words in square brackets; a bracketed
 * lowercase aside or a number ("[1]") is not a slot. The gateway refuses the
 * same pattern (apps/api-gateway/src/procurement/unfilled-slots.ts), but only
 * the blanks its send cannot fill. When the house has no sender name it also
 * refuses a signature blank in any case or spacing ("[your name]"), which
 * this pattern does not see. The card uses the gateway's own answer
 * (`at_send` on the draft read) and falls back to this — every Capitalised
 * blank — only while the gateway has not read the words on screen.
 */
const SLOT_RE = /\[(?:[A-Z][A-Za-z']*)(?: [A-Z][A-Za-z']*){0,3}\]/g;
export function unfilledSlots(text: string | null | undefined): string[] {
  return Array.from(new Set((text ?? "").match(SLOT_RE) ?? []));
}
