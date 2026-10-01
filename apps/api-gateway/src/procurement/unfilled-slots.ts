/**
 * The blanks a template left in a letter — ORD-W7, founder ruling 2026-10-01
 * ("Approve + gateway").
 *
 * A drafted letter can still carry "[Provider First Name]" or "[Your Name]"
 * when the house never filled them in. The card on /orders already refuses to
 * hold such a letter; the gateway refuses it too, so a letter with a blank
 * cannot leave the building by any route.
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
