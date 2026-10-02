/**
 * The blanks a template left in a letter — ORD-W7, founder ruling 2026-10-01
 * ("Approve + gateway").
 *
 * A drafted letter can still carry "[Provider First Name]" or "[Your Name]"
 * when the house never filled them in. Some of those the send fills itself —
 * the greeting with the vendor's first name, the signature with the house's
 * sender name (`applyEmailPlaceholders`) — so a blank is refused only when it
 * would still stand in the letter as sent (founder, 2026-10-01: "Only
 * unfillable"). Every route that sends a house letter checks it: the card's
 * seal, a staff request, approveDraft, the automatic send sweep and a
 * hand-written reply (founder, 2026-10-01: "Add sweep + manual").
 *
 * The same pattern as `unfilledSlots` in apps/web/src/pages/orders/next/
 * DraftRail.tsx: a bracketed run of one to four Capitalised words. A lower-case
 * bracket ("[sic]", "[1]") is not a slot and is left alone.
 */
const SLOT_RE = /\[(?:[A-Z][A-Za-z']*)(?: [A-Z][A-Za-z']*){0,3}\]/g;

export function unfilledTemplateSlots(text: string | null | undefined): string[] {
  return Array.from(new Set((text ?? "").match(SLOT_RE) ?? []));
}

/** The sentence a refusal carries; `nothing` says what did not happen. */
export function unfilledSlotsRefusal(slots: string[], nothing: string): string {
  const one = slots.length === 1;
  return `This letter still has ${one ? "a blank" : "blanks"} the house did not fill: ${slots.join(", ")}. ${nothing}`;
}

/**
 * The signature blanks the send fills with the house's sender name — the one
 * pattern `applyEmailPlaceholders` replaces, kept here so the refusal and the
 * fill can never disagree about which blanks those are.
 */
const SIGNATURE_SLOT_SOURCE = String.raw`\[\s*(manager\s*name|your\s*name|name|signature|manager)\s*\]`;
export function signatureSlotRe(flags = "gi"): RegExp {
  return new RegExp(SIGNATURE_SLOT_SOURCE, flags);
}

/** What the send would do with a letter's blanks. */
export interface BlanksAtSend {
  /** Blanks that would reach the vendor as written: these are refused. */
  unfillable: string[];
  /** Blanks the send fills, and with what. */
  fills: { slot: string; value: string }[];
}
