/**
 * Deterministic handling of vendor-authored text on its way into, and back out
 * of, the inbound responder's prompt (wave 13 sim, F-487 / F-488 / F-489).
 *
 * The responder's only injection detector was the same model's self-report.
 * These helpers do not ask the model anything: they make the fence hold no
 * matter what a vendor writes, refuse to show a figure the mail never stated,
 * and catch a draft that tells the vendor the house's own ceiling.
 */

/** Zero-width and bidi-control characters a marker could be split with. */
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;

/**
 * Lines the prompt treats as house-authored. A vendor body that carries one is
 * quoting a heading it has no business writing, so the heading is replaced.
 */
const HOUSE_HEADINGS =
  /\b(MANAGER\s+STEERING|TRANSPORT\s+SIGNALS|ORDER\s+CONTEXT|YOUR\s+JOB|HARD\s+RULES(?:\s+FOR\s+THE\s+REPLY)?|ATTACHMENTS\s*:)/gi;

/**
 * Make one vendor-controlled string safe to paste inside the untrusted fence
 * (F-487). Three things, each closing one escape:
 *
 * 1. Every `<<` / `>>` becomes `‹‹` / `››` after NFKC folding and with
 *    invisible characters removed, so no spelling of the end marker — plain,
 *    full-width, split by a zero-width space — survives to close the fence.
 * 2. The prompt's own headings (`MANAGER STEERING`, `TRANSPORT SIGNALS`, …)
 *    are replaced, so a forged steer or transport line has no heading to
 *    borrow even inside the fence.
 * 3. Every line after the first is indented, so a body cannot start a line
 *    with `[2026-10-01] Us:` and pass as a turn the house wrote: only the
 *    transcript's own turn headers begin at the left margin.
 */
export function neutralizeVendorText(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/<</g, "‹‹")
    .replace(/>>/g, "››")
    .replace(HOUSE_HEADINGS, "[heading removed]")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .join("\n    ");
}

/** Lower-case, one space between words — so a quote spanning a line break still matches. */
const squash = (s: string) =>
  String(s ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Every reading of the numbers written in `text`. `1,090` reads as 1090;
 * `1.090,50` as 1090.5; an ambiguous `1.090` as both 1.09 and 1090 — a
 * match on either counts, because the callers below fail toward "seen".
 */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const matches = String(text ?? "").match(/\d[\d.,]*\d|\d/g) ?? [];
  for (const token of matches) {
    out.push(Number(token.replace(/,/g, ""))); // 1,090.50 → 1090.5
    out.push(Number(token.replace(/\./g, "").replace(/,/g, "."))); // 1.090,50 → 1090.5
    out.push(Number(token.replace(/[.,]/g, ""))); // separators as grouping only
  }
  return out.filter((n) => Number.isFinite(n));
}

const sameFigure = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Is this offer something the vendor actually wrote (F-488)? Its `quote` must
 * occur in the conversation, and its per-bottle price — when it has one — must
 * be a figure written in that quote. An offer the model assembled from nothing,
 * or priced with a number its own quote does not contain, is not shown as the
 * vendor's price.
 *
 * A price stated only in an attachment cannot be checked against the mail
 * text, so it reads as unverified too: the deal card then says the price was
 * not stated in the mail rather than repeating a figure nobody can point at.
 */
export function offerIsInTranscript(
  offer: { quote?: unknown; price_per_bottle?: unknown },
  transcript: string,
): boolean {
  const quote = squash(typeof offer?.quote === "string" ? offer.quote : "");
  if (!quote) return false;
  if (!squash(transcript).includes(quote)) return false;
  const raw = offer?.price_per_bottle;
  if (raw == null || raw === "") return true;
  const price = Number(raw);
  if (!Number.isFinite(price)) return false;
  return numbersIn(quote).some((n) => sameFigure(n, price));
}

/**
 * Does this draft name the house's target figure (F-489)? The target is also
 * the ceiling ("we do NOT want to pay more than this without manager
 * sign-off"), so a reply that writes it down tells the vendor the most the
 * house will pay. Fails toward "yes": a quantity that happens to equal the
 * target also holds the draft, which costs one look from a manager.
 */
export function draftNamesFigure(
  body: string,
  figure: number | null | undefined,
): boolean {
  if (figure == null || !Number.isFinite(figure)) return false;
  return numbersIn(body).some((n) => sameFigure(n, figure));
}
